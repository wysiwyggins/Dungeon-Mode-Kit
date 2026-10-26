/**
 * Behaviors: traps springing, and shooting/ranged attacks with their
 * projectile animation.
 */

import { BehaviorLibrary, springTrapPayload } from './behaviors.js';
import { getLinePath, hasLineOfSight } from '../core/pathfinding.js';
import { ALL_DIRS, shuffleArray } from '../core/util.js';

export const BehaviorsRanged = {
    /**
     * Trap check trigger behavior - checks if an actor or item has stepped on the trap
     * Traps start invisible and become visible when triggered (Brogue-style)
     * Traps are re-triggerable but won't trigger again while same entity remains on tile
     */
    trap_check_trigger: (actor, data) => {
        const entityManager = actor.engine.entityManager;

        // Initialize tracking set for entities that have triggered while on this tile
        if (!actor._triggeredBy) actor._triggeredBy = new Set();

        // Check if anything is currently on the trap
        const itemOnTrap = entityManager.items.find(
            i => i.x === actor.x && i.y === actor.y && !i.isDead
        );
        const solidActorOnTrap = entityManager.getActorsAt(actor.x, actor.y)
            .find(a => a !== actor && !a.hasAttribute('trap') && a.hasAttribute('solid') && !a.hasStateProperty('flying'));

        // If trap needs reset (was triggered by item), check if tile is now empty
        if (actor._needsReset) {
            if (!itemOnTrap && !solidActorOnTrap) {
                // Tile is empty, trap resets
                actor._needsReset = false;
                actor._triggeredBy.clear();
            }
            // Still needs reset, don't trigger
            return false;
        }

        // Clean up: remove entities no longer on this tile
        for (const entity of actor._triggeredBy) {
            if (entity.isDead || entity.x !== actor.x || entity.y !== actor.y) {
                actor._triggeredBy.delete(entity);
            }
        }

        // Find any actor standing on this trap that hasn't triggered it yet
        // Skip non-solid actors (fire, clouds, etc.) - only solid actors trigger traps
        const actorVictim = solidActorOnTrap && !actor._triggeredBy.has(solidActorOnTrap)
            ? solidActorOnTrap : null;

        if (!actorVictim) return false;

        // Mark this entity as having triggered
        actor._triggeredBy.add(actorVictim);

        // Springing a trap discovers it, permanently. reveal() handles the hidden
        // case (building the sprites a concealed trap never had); the fallback
        // covers a trap authored as plain `visible: false` with no hidden state.
        if (actor.hasAttribute('hidden')) {
            actor.reveal({ silent: true });
        } else if (!actor.hasAttribute('visible')) {
            actor.setAttribute('visible', true);
            actor.engine.renderer?.createActorSprites(actor);
        }

        springTrapPayload(actor, actorVictim, data || {});

        // Trap remains on tile (Brogue-style) - no die() call

        return true;
    },

    /**
     * Shoot a projectile at a visible target within range
     * Used by stationary ranged attackers like turrets
     * Requires ammunition in inventory (items with collision_effect)
     */
    shoot_at_target: (actor, data) => {
        const entityManager = actor.engine.entityManager;

        // Recharge between shots so the turret fires periodically, not every turn.
        const cooldown = data?.shoot_cooldown ?? 2;
        if (!actor._shootCooldown) actor._shootCooldown = 0;
        actor._shootCooldown++;
        if (actor._shootCooldown < cooldown) return false;

        // Get attack range from personality data or default to 8
        const attackRange = data?.attack_range || actor.getAttribute('attack_range') || 8;

        // Find nearest hostile target (player or controlled actor)
        let target = null;
        let nearestDist = Infinity;

        for (const other of entityManager.actors) {
            if (other === actor) continue;
            if (other.isDead) continue;
            if (!other.hasAttribute('controlled')) continue; // Only target player-controlled

            const dx = other.x - actor.x;
            const dy = other.y - actor.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= attackRange && dist < nearestDist) {
                // Check line of sight - callback checks if a tile is blocked by solid actors
                const isBlocked = (x, y) => {
                    const actorAtTile = entityManager.getSolidActorAt(x, y);
                    return actorAtTile && actorAtTile !== actor && actorAtTile !== other;
                };
                if (hasLineOfSight(actor.x, actor.y, other.x, other.y, isBlocked)) {
                    target = other;
                    nearestDist = dist;
                }
            }
        }

        if (!target) return false;

        // Shot is committed - start the recharge over.
        actor._shootCooldown = 0;

        // Ammo item defines the dart's look and damage, but is NOT consumed - a
        // clockwork turret fires indefinitely (rate-limited only by the cooldown).
        const ammo = actor.inventory.find(item => item.getAttribute('collision_effect'));
        if (!ammo) {
            // No dart definition - can't fire.
            return false;
        }

        // Calculate hit chance using same formula as melee/throw
        const accuracy = actor.getEffectiveAccuracy?.() ?? actor.getAttribute('accuracy') ?? 50;
        const defense = target.getEffectiveDefense?.() ?? target.getAttribute('defense') ?? 0;
        const rawProbability = accuracy * Math.pow(0.987, defense);
        const hitChance = Math.max(5, Math.min(95, Math.round(rawProbability)));
        const roll = ROT.RNG.getPercentage();
        const hits = roll <= hitChance;

        console.log(`${actor.name} shoots at ${target.name}: accuracy ${accuracy} vs defense ${defense} = ${hitChance}% chance, rolled ${roll}, ${hits ? 'HIT' : 'MISS'}`);

        // Get the line path for the projectile
        const path = getLinePath(actor.x, actor.y, target.x, target.y);
        // Remove the starting position
        const projectilePath = path.slice(1);

        if (projectilePath.length === 0) return false;

        // Animate the projectile
        BehaviorLibrary._animateRangedAttack(actor, ammo, projectilePath, target, hits, () => {
            if (hits) {
                // Apply damage
                const collisionEffect = ammo.getAttribute('collision_effect');
                if (collisionEffect && target.stats) {
                    for (const [key, rawValue] of Object.entries(collisionEffect)) {
                        const value = actor.resolveAttributeValue?.(rawValue, actor) ?? rawValue;

                        if (target.stats[key] !== undefined) {
                            const stat = target.stats[key];
                            if (typeof stat === 'object' && stat.current !== undefined) {
                                stat.current = Math.min(stat.max, Math.max(0, stat.current + value));
                                if (key === 'health' && stat.current <= 0) {
                                    target.die();
                                }
                            }
                        }
                    }
                    target.flash?.();
                }

                // Show hit message
                const displayName = ammo.getDisplayName ? ammo.getDisplayName() : ammo.name;
                const targetName = target.getNameWithArticle ? target.getNameWithArticle() : `the ${target.name}`;
                const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
                const hitPos = (actor.hasAttribute('controlled') || target.hasAttribute('controlled')) ? null : { x: target.x, y: target.y };
                actor.engine.inputManager?.showMessage(`${actorName} shoots ${targetName} with ${displayName}!`, hitPos);

                // Play hit sound
                const collisionSound = ammo.getAttribute('collision_sound') || data.hit_sound || 'arrow_hit';
                actor.engine.playSound?.(collisionSound);
            } else {
                // Show miss message
                const displayName = ammo.getDisplayName ? ammo.getDisplayName() : ammo.name;
                const targetName = target.getNameWithArticle ? target.getNameWithArticle() : `the ${target.name}`;
                const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
                const missPos = (actor.hasAttribute('controlled') || target.hasAttribute('controlled')) ? null : { x: target.x, y: target.y };
                actor.engine.inputManager?.showMessage(`${actorName}'s ${displayName} misses ${targetName}!`, missPos);

                // Play miss sound
                actor.engine.playSound?.(data.miss_sound ?? 'arrow_miss');

                // Note: the dart is not dropped - the turret's ammo is not consumed,
                // so its magazine item stays in inventory and a missed dart just vanishes.
            }

            // Update sidebar
            actor.engine.interfaceManager?.updateSidebar();
        });

        return true; // Action taken
    },

    /**
     * Helper: Animate a ranged attack projectile
     * @private
     */
    _animateRangedAttack: (shooter, ammo, path, _target, _willHit, onComplete) => {
        const renderer = shooter.engine.renderer;
        if (!renderer || path.length === 0) {
            onComplete();
            return;
        }

        const tileWidth = shooter.engine.config.tileWidth;
        const tileHeight = shooter.engine.config.tileHeight;
        const tileset = PIXI.Loader.shared.resources.tiles;

        if (!tileset || !ammo.tileIndex) {
            onComplete();
            return;
        }

        // Create projectile sprite
        const rect = new PIXI.Rectangle(
            ammo.tileIndex.x * tileWidth,
            ammo.tileIndex.y * tileHeight,
            tileWidth,
            tileHeight
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const projectileSprite = new PIXI.Sprite(texture);

        // Apply ammo tint if present
        if (ammo.tint !== undefined && ammo.tint !== null) {
            projectileSprite.tint = ammo.tint;
        }

        projectileSprite.zIndex = 100;
        renderer.uiContainer.addChild(projectileSprite);

        // Animate through path
        let currentIndex = 0;
        const frameDelay = 25;

        const animateFrame = () => {
            if (currentIndex >= path.length) {
                renderer.uiContainer.removeChild(projectileSprite);
                projectileSprite.destroy();
                onComplete();
                return;
            }

            const point = path[currentIndex];
            projectileSprite.x = point.x * tileWidth;
            projectileSprite.y = point.y * tileHeight;

            currentIndex++;
            setTimeout(animateFrame, frameDelay);
        };

        animateFrame();
    },

    /**
     * Helper: Find an adjacent floor tile
     * @private
     */
    _findAdjacentFloor: (x, y, entityManager, mapManager) => {
        const directions = shuffleArray([...ALL_DIRS]);

        for (const dir of directions) {
            const tx = x + dir.dx;
            const ty = y + dir.dy;

            const floorTile = mapManager?.floorMap?.[ty]?.[tx];
            if (!floorTile || floorTile.tileId <= 0) continue;

            const actor = entityManager?.getSolidActorAt(tx, ty);
            if (actor) continue;

            return { x: tx, y: ty };
        }

        return null;
    },

    ranged_attack: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const attackRange = data.attack_range ?? 5;
        const cooldown = data.ranged_cooldown ?? 2;

        if (!actor._rangedCooldown) actor._rangedCooldown = 0;
        actor._rangedCooldown++;
        if (actor._rangedCooldown < cooldown) return false;

        let target = null;
        let nearestDist = Infinity;

        for (const other of entityManager.actors) {
            if (other === actor || other.isDead) continue;
            if (!other.hasAttribute('controlled')) continue;

            const dist = Math.sqrt(
                (other.x - actor.x) ** 2 + (other.y - actor.y) ** 2
            );
            if (dist > attackRange || dist >= nearestDist) continue;

            const isBlocked = (x, y) => {
                const a = entityManager.getSolidActorAt(x, y);
                return a && a !== actor && a !== other;
            };
            if (hasLineOfSight(actor.x, actor.y, other.x, other.y, isBlocked)) {
                target = other;
                nearestDist = dist;
            }
        }

        if (!target) return false;

        actor._rangedCooldown = 0;

        const collisionEffect = actor.getAttribute('collision_effect');
        if (!collisionEffect) return false;

        const accuracy = actor.getEffectiveAccuracy?.() ?? actor.getAttribute('accuracy') ?? 50;
        const defense = target.getEffectiveDefense?.() ?? target.getAttribute('defense') ?? 0;
        const rawProb = accuracy * Math.pow(0.987, defense);
        const hitChance = Math.max(5, Math.min(95, Math.round(rawProb)));
        const hits = ROT.RNG.getPercentage() <= hitChance;

        const path = getLinePath(actor.x, actor.y, target.x, target.y);
        const projectilePath = path.slice(1);
        if (projectilePath.length === 0) return false;

        const weapon = actor.getEquippedWeapon?.();
        const ammo = weapon || actor;

        BehaviorLibrary._animateRangedAttack(actor, ammo, projectilePath, target, hits, () => {
            if (hits) {
                for (const [key, rawValue] of Object.entries(collisionEffect)) {
                    const value = actor.resolveAttributeValue?.(rawValue, actor) ?? rawValue;
                    if (target.stats?.[key] !== undefined) {
                        const stat = target.stats[key];
                        if (typeof stat === 'object' && stat.current !== undefined) {
                            stat.current = Math.min(stat.max, Math.max(0, stat.current + value));
                            if (key === 'health' && stat.current <= 0) target.die();
                        }
                    }
                }
                target.flash?.();
                const targetName = target.getNameWithArticle ? target.getNameWithArticle() : `the ${target.name}`;
                const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
                actor.engine.inputManager?.showMessage(`${actorName} strikes ${targetName}!`);
                actor.engine.playSound?.(data.hit_sound ?? 'arrow_hit');
            } else {
                const targetName = target.getNameWithArticle ? target.getNameWithArticle() : `the ${target.name}`;
                const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
                actor.engine.inputManager?.showMessage(`${actorName}'s attack misses ${targetName}!`);
                actor.engine.playSound?.(data.miss_sound ?? 'arrow_miss');
            }
            actor.engine.interfaceManager?.updateSidebar();
        });

        return true;
    },
};
