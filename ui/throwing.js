/**
 * InterfaceManager methods: throw aiming, the projectile and weapon-swing
 * animations, and where a thrown item lands: traps, collapsing floors,
 * explosive clouds and fire explosions it sets off.
 */

import { resolveTemplate } from '../core/util.js';
import { Item } from '../engine/item.js';
import { THROW_DEFAULT_TARGETS } from './interface-manager.js';

export const UIThrowing = {
    // ========================================================================
    // THROW AIMING MODE
    // ========================================================================

    /**
     * Enter throw aiming mode for an item
     * @param {Item} item - The item to throw
     */
    enterThrowAimingMode(item) {
        this.throwAimingMode = true;
        this.throwItem = item;
        this.aimTargets = null;
        this.aimTargetIndex = -1;

        // Close the menus but keep player reference
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        // Start aimed at the nearest valid target so the mode is usable without a
        // mouse — hoveredTile sits at -1,-1 until the pointer moves over the canvas,
        // which would otherwise leave a keyboard player with nothing aimed at.
        const seeded = this.seedAimTarget(THROW_DEFAULT_TARGETS);

        const im = this.engine.inputManager;
        const cycleKey = im?.getKeyForAction('cycle_target', 'Tab') || 'Tab';
        const confirmKey = im?.getKeyForAction('confirm_target', 'Enter') || 'Enter';
        const verb = this.currentPlayer?.getLauncherFor(item) ? 'fire' : 'throw';
        this.showTextBox('throw_instructions',
            `[${cycleKey}] to target, [${confirmKey}] or click to ${verb}. Esc to cancel.`, {
            dismissOnMove: false
        });

        // Update the throw path based on current mouse position
        this.updateThrowPath();
        if (seeded) this.announceAimTarget(seeded);
    },

    /**
     * Exit throw aiming mode without throwing
     */
    exitThrowAimingMode() {
        this.throwAimingMode = false;
        this.throwItem = null;

        // Hide the line path
        this.engine.renderer?.hideLinePath();

        // Remove instruction message
        this.removeTextBox('throw_instructions');

        // Re-enable normal tile highlight
        this.engine.renderer?.hideTileHighlight();

        // Restore walk path display for current hovered tile
        const inputManager = this.engine.inputManager;
        if (inputManager && inputManager.hoveredTile.x >= 0) {
            inputManager.updateWalkPath(inputManager.hoveredTile.x, inputManager.hoveredTile.y);
        }
    },

    /**
     * Calculate the maximum throw range for an actor
     * Base range is 10 tiles + actor's strength attribute, or the wielded
     * launcher's `launch_range` when it fires this item
     * @param {Actor} actor - The actor throwing
     * @param {Item} [item] - The item being thrown
     * @returns {number} Maximum throw range in tiles
     */
    getThrowRange(actor, item = null) {
        const launcher = actor.getLauncherFor?.(item);
        if (launcher) return launcher.getAttribute('launch_range') ?? 20;
        const baseRange = 10;
        const strength = actor.getAttribute('strength') || 0;
        return baseRange + strength;
    },

    /**
     * Roll to determine if a thrown item misses its target
     * Uses the thrower's accuracy vs target's defense (same formula as melee)
     * @param {Actor} thrower - The actor throwing the item
     * @param {Actor} target - The target being thrown at
     * @param {number} [bonus=0] - Extra accuracy, e.g. a launcher's launch_accuracy
     * @returns {boolean} True if the throw MISSED, false if it hit
     */
    rollThrowAccuracy(thrower, target, bonus = 0) {
        // Get thrower's accuracy (default 50 if not set - throwing is harder than melee)
        const accuracy = (thrower.getEffectiveAccuracy?.() ?? thrower.getAttribute('accuracy') ?? 50) + bonus;

        // If thrower has no accuracy concept, always hit
        if (accuracy === null) return false;

        // Get target's defense
        const defense = target.getEffectiveDefense?.() ?? target.getAttribute('defense') ?? 0;

        // Use same formula as melee: accuracy * 0.987^defense
        const rawProbability = accuracy * Math.pow(0.987, defense);

        // Clamp to 5-95%
        const hitChance = Math.max(5, Math.min(95, Math.round(rawProbability)));

        // Roll for hit
        const roll = ROT.RNG.getPercentage(); // Returns 1-100
        const missed = roll > hitChance;

        console.log(`Throw accuracy: ${accuracy} vs defense ${defense} = ${hitChance}% hit chance, rolled ${roll}, ${missed ? 'MISS' : 'HIT'}`);

        return missed;
    },

    /**
     * Find an adjacent floor tile to a given position
     * Used for placing missed thrown items
     * @param {number} x - Center X position
     * @param {number} y - Center Y position
     * @returns {{x: number, y: number}|null} Adjacent floor position or null if none found
     */
    findAdjacentFloorTile(x, y) {
        const directions = [
            { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
            { dx: -1, dy: 0 },                     { dx: 1, dy: 0 },
            { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 }
        ];

        // Shuffle directions for random placement
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        const mapManager = this.engine.mapManager;
        const entityManager = this.engine.entityManager;

        for (const dir of directions) {
            const tx = x + dir.dx;
            const ty = y + dir.dy;

            // Check if this is a valid floor tile
            const floorTile = mapManager?.floorMap?.[ty]?.[tx];
            if (!floorTile || floorTile.tileId <= 0) continue;

            // Check if there's a solid actor blocking
            const actor = entityManager?.getActorAt(tx, ty);
            if (actor && !actor.isDead && actor.hasAttribute('solid')) continue;

            return { x: tx, y: ty };
        }

        return null;
    },

    /**
     * Update the throw path line based on current mouse position
     */
    updateThrowPath() {
        if (!this.throwAimingMode || !this.currentPlayer) return;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return;

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't draw path if mouse is off-screen or on player
        if (targetX < 0 || targetY < 0) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        if (targetX === this.currentPlayer.x && targetY === this.currentPlayer.y) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        // Calculate throw range (10 + strength, or the launcher's range)
        const maxRange = this.getThrowRange(this.currentPlayer, this.throwItem);

        // Show the line path from player to target with range limit
        this.engine.renderer?.showLinePath(
            this.currentPlayer.x,
            this.currentPlayer.y,
            targetX,
            targetY,
            0xFF0000, // Red color for throw path
            maxRange
        );
    },

    /**
     * Execute the throw at the current target position
     */
    executeThrow() {
        if (!this.throwAimingMode || !this.currentPlayer || !this.throwItem) return;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return;

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't throw if mouse is off-screen or on player
        if (targetX < 0 || targetY < 0) return;
        if (targetX === this.currentPlayer.x && targetY === this.currentPlayer.y) return;

        // Calculate throw range (10 + strength, or the launcher's range)
        const maxRange = this.getThrowRange(this.currentPlayer, this.throwItem);

        // Get the actual landing position (may be blocked by solid actor or range limit)
        const pathResult = this.engine.renderer?.showLinePath(
            this.currentPlayer.x,
            this.currentPlayer.y,
            targetX,
            targetY,
            0xFF0000,
            maxRange
        );

        if (!pathResult || pathResult.path.length === 0) return;

        // Don't allow throwing if target is out of range
        if (pathResult.outOfRange) {
            const verb = this.currentPlayer.getLauncherFor(this.throwItem) ? 'fire' : 'throw';
            this.engine.inputManager?.showMessage(`That's too far to ${verb}!`);
            return;
        }

        // Store references before exiting aiming mode
        let item = this.throwItem;
        const player = this.currentPlayer;
        const path = pathResult.path;
        // Resolved while the ammo is still in the pack; the launcher stays wielded
        const launcher = player.getLauncherFor(item);

        // Unequip item if it's being worn
        if (player.isItemEquipped(item)) {
            player.unequipItem(item, { silent: true });  // the throw message says it
        }

        // Remove item from inventory (stack-aware)
        if (item.count > 1) {
            item.count--;
            const itemData = this.engine.currentPrototype?.getItemData(item.type);
            if (itemData) {
                item = new Item(-1, -1, item.type, itemData, this.engine);
            }
        } else {
            const index = player.inventory.indexOf(item);
            if (index > -1) {
                player.inventory.splice(index, 1);
            }
        }

        // Exit aiming mode (hides line path)
        this.exitThrowAimingMode();

        // Determine if we'll potentially hit something
        const landingPoint = path[path.length - 1];
        const hitActor = this.engine.entityManager?.getActorAt(landingPoint.x, landingPoint.y);
        const willHit = hitActor && !hitActor.isDead && hitActor.hasAttribute('solid');

        if (launcher) this.engine.playSound(launcher.getAttribute('launch_sound') || 'bow');

        // Animate the projectile, then apply effects (sound plays in completeThrow after accuracy roll)
        this.animateProjectile(item, path, () => {
            this.completeThrow(item, player, path, willHit, launcher);
        });
    },

    /**
     * Animate a projectile moving along a path
     * @param {Item} item - The item being thrown
     * @param {Array} path - Array of {x, y} points
     * @param {Function} onComplete - Callback when animation finishes
     */
    animateProjectile(item, path, onComplete) {
        const renderer = this.engine.renderer;
        if (!renderer || path.length === 0) {
            onComplete();
            return;
        }

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;
        const tileset = PIXI.Loader.shared.resources.tiles;

        if (!tileset || !item.tileIndex) {
            onComplete();
            return;
        }

        // Create projectile sprite
        const rect = new PIXI.Rectangle(
            item.tileIndex.x * tileWidth,
            item.tileIndex.y * tileHeight,
            tileWidth,
            tileHeight
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const projectileSprite = new PIXI.Sprite(texture);

        // Apply item tint if present
        if (item.tint !== undefined && item.tint !== null) {
            projectileSprite.tint = item.tint;
        }

        // Apply flip if present
        if (item.flipH || item.flipV) {
            projectileSprite.anchor.set(0.5, 0.5);
            projectileSprite.scale.x = item.flipH ? -1 : 1;
            projectileSprite.scale.y = item.flipV ? -1 : 1;
        }

        projectileSprite.zIndex = 100; // Above everything
        renderer.uiContainer.addChild(projectileSprite);

        // Animate through path
        let currentIndex = 0;
        const frameDelay = 25; // milliseconds per tile

        const animateFrame = () => {
            if (currentIndex >= path.length) {
                // Animation complete - remove sprite and call callback
                renderer.uiContainer.removeChild(projectileSprite);
                projectileSprite.destroy();
                onComplete();
                return;
            }

            const point = path[currentIndex];

            // Position sprite (account for anchor if flipped)
            if (item.flipH || item.flipV) {
                projectileSprite.x = point.x * tileWidth + tileWidth / 2;
                projectileSprite.y = point.y * tileHeight + tileHeight / 2;
            } else {
                projectileSprite.x = point.x * tileWidth;
                projectileSprite.y = point.y * tileHeight;
            }

            currentIndex++;
            setTimeout(animateFrame, frameDelay);
        };

        // Start animation
        animateFrame();
    },

    /**
     * Show a brief weapon swing visual at the target position
     * @param {Item} weapon - The weapon being swung
     * @param {number} targetX - Target tile X coordinate
     * @param {number} targetY - Target tile Y coordinate
     * @param {number} duration - How long to display (ms), default 100
     * @param {number|null} fromX - Attacker tile X, used to point the swing at the
     *   target. Omit for an unaimed swing (the weapon's authored flip is used as-is).
     * @param {number|null} fromY - Attacker tile Y, the vertical half of the same aim.
     */
    showWeaponSwing(weapon, targetX, targetY, duration = 100, fromX = null, fromY = null) {
        const renderer = this.engine.renderer;
        if (!renderer || !weapon?.tileIndex) return;

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;
        const tileset = PIXI.Loader.shared.resources.tiles;

        if (!tileset) return;

        // Create weapon sprite from tile
        const rect = new PIXI.Rectangle(
            weapon.tileIndex.x * tileWidth,
            weapon.tileIndex.y * tileHeight,
            tileWidth,
            tileHeight
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const weaponSprite = new PIXI.Sprite(texture);

        // Apply weapon tint if present
        if (weapon.tint !== undefined && weapon.tint !== null) {
            weaponSprite.tint = weapon.tint;
        }

        // Point the swing at whoever is being hit. Weapon art is drawn pointing up and
        // to the left, so a blow struck rightward or downward needs the tile mirrored on
        // that axis — otherwise every swing reads up-left no matter which neighbour took
        // it. Each axis is toggled independently, so a diagonal attack flips both.
        //
        // The aimed flip is XORed against the weapon's authored flip rather than
        // replacing it: most weapons ship `flipV: true`, and that orientation is the
        // baseline the mirroring is relative to. A caller that passes no origin (or an
        // attack with no displacement on an axis) keeps the authored value for it.
        let flipH = !!weapon.flipH;
        let flipV = !!weapon.flipV;
        if (fromX !== null && targetX !== fromX) {
            flipH = flipH !== (targetX > fromX);
        }
        if (fromY !== null && targetY !== fromY) {
            flipV = flipV !== (targetY > fromY);
        }

        // Apply flip if present
        if (flipH || flipV) {
            weaponSprite.anchor.set(0.5, 0.5);
            weaponSprite.scale.x = flipH ? -1 : 1;
            weaponSprite.scale.y = flipV ? -1 : 1;
            // Position at center of tile when using anchor
            weaponSprite.x = targetX * tileWidth + tileWidth / 2;
            weaponSprite.y = targetY * tileHeight + tileHeight / 2;
        } else {
            weaponSprite.x = targetX * tileWidth;
            weaponSprite.y = targetY * tileHeight;
        }

        weaponSprite.zIndex = 100; // Above everything
        renderer.uiContainer.addChild(weaponSprite);

        // Remove after duration
        setTimeout(() => {
            renderer.uiContainer.removeChild(weaponSprite);
            weaponSprite.destroy();
        }, duration);
    },

    /**
     * Complete the throw after animation - apply effects and place item
     * @param {Item} item - The thrown item
     * @param {Actor} player - The player who threw it
     * @param {Array} path - The path the item traveled
     * @param {boolean} willHit - Whether the throw hits a solid actor
     */
    completeThrow(item, player, path, willHit, launcher = null) {
        const landingPoint = path[path.length - 1];
        const isExplosive = item.hasAttribute('explosive');

        // Handle explosive items - they create a cloud and are always destroyed
        // Explosive items always hit (they explode on the tile regardless of accuracy)
        // Only breakable explosives (e.g. potions) detonate on throw; non-breakable ones (e.g. powder kegs) require fire
        if (isExplosive && item.hasAttribute('breakable')) {
            // Play break sound (e.g. glass shattering)
            const breakSound = item.getAttribute('break_sound');
            if (breakSound) this.engine.playSound(breakSound);
            // Play explode sound (e.g. gas cloud puff) — fire explosions play their own sound in createFireExplosion
            const explodeSound = item.getAttribute('explode_sound');
            if (explodeSound) this.engine.playSound(explodeSound);

            this.createExplosiveCloud(item, landingPoint.x, landingPoint.y);
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            this.engine.inputManager?.showMessage(`The ${displayName} explodes!`);

            // This counts as a player action
            this.engine.inputManager?.onPlayerAction();
            return;
        }

        // burst_into: the item is used up where it lands and spawns that actor
        // instead — no accuracy roll, no weapon damage (Brogue's incendiary dart).
        // Breakable explosives with burst_into (gas potions) took the branch above.
        // It bursts on a creature or a flammable obstruction (a tree);
        // other walls stop it a tile short.
        if (item.getAttribute('burst_into')) {
            const blocker = this.engine.entityManager?.getSolidActorAt(landingPoint.x, landingPoint.y);
            const burstsOnBlocker = !blocker || blocker.isDead ||
                blocker.stats?.health !== undefined || blocker.hasAttribute('flammable');
            const spot = burstsOnBlocker ? landingPoint
                : (path.length > 1 ? path[path.length - 2] : { x: player.x, y: player.y });

            if (this.isVoidLanding(spot.x, spot.y)) {
                this.placeThrownItem(item, spot.x, spot.y);
            } else {
                const burstDescription = item.getAttribute('burst_description');
                const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                this.engine.inputManager?.showMessage(burstDescription
                    ? resolveTemplate(burstDescription, item, { providers: { item_name: () => displayName } })
                    : `The ${displayName} bursts!`, { x: spot.x, y: spot.y });
                this.burstItemAt(item, spot.x, spot.y);
            }

            this.engine.inputManager?.onPlayerAction();
            return;
        }

        if (willHit) {
            // Get the actor we're hitting
            const hitActor = this.engine.entityManager?.getActorAt(landingPoint.x, landingPoint.y);

            if (hitActor) {
                // Perform accuracy roll for thrown items
                const throwMissed = this.rollThrowAccuracy(player, hitActor,
                    launcher?.getAttribute('launch_accuracy') || 0);

                if (throwMissed) {
                    // Play miss sound
                    this.engine.playSound('arrow_miss');

                    // Throw missed
                    const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                    const targetName = hitActor.getNameWithArticle ? hitActor.getNameWithArticle() : `the ${hitActor.name}`;
                    this.engine.inputManager?.showMessage(`The ${displayName} misses ${targetName}!`);

                    if (item.hasAttribute('breakable')) {
                        // Breakable item shatters on miss
                        const breakSound = item.getAttribute('break_sound');
                        if (breakSound) this.engine.playSound(breakSound);
                        this.engine.inputManager?.showMessage(`The ${displayName} shatters! Its contents leak out harmlessly on the ground.`);
                    } else {
                        // Non-breakable item lands on adjacent floor tile
                        const missLandingPoint = this.findAdjacentFloorTile(landingPoint.x, landingPoint.y);
                        if (missLandingPoint) {
                            item.x = missLandingPoint.x;
                            item.y = missLandingPoint.y;
                        } else if (path.length > 1) {
                            // Fallback: land on tile before target
                            const landBeforeHit = path[path.length - 2];
                            item.x = landBeforeHit.x;
                            item.y = landBeforeHit.y;
                        } else {
                            // Last resort: land at player's feet
                            item.x = player.x;
                            item.y = player.y;
                        }
                        this.engine.entityManager.addEntity(item);
                    }
                } else {
                    // Play hit sound
                    const collisionSound = item.getAttribute('collision_sound') || 'arrow_hit';
                    this.engine.playSound(collisionSound);

                    // Throw hit - apply damage and effects
                    // Mark actor as hit this turn for flee_from_danger behavior
                    hitActor.wasHitThisTurn = true;

                    // Apply collision effect if the item has one
                    const collisionEffect = item.getAttribute('collision_effect');
                    if (collisionEffect) {
                        for (const [key, rawValue] of Object.entries(collisionEffect)) {
                            let value = player.resolveAttributeValue(rawValue, player);

                            // Fired from a launcher: (ammo + bow enchantment) × multiplier.
                            // Enchantment goes in before the multiplier, as in Moria. Capped
                            // at 0 so a badly cursed bow can't turn a hit into healing.
                            if (launcher && key === 'health' && value < 0) {
                                value = Math.min(0, (value - (launcher.enchantment || 0)) * (launcher.getAttribute('launch_multiplier') ?? 1));
                            }

                            if (hitActor.stats && hitActor.stats[key] !== undefined) {
                                const stat = hitActor.stats[key];
                                if (typeof stat === 'object' && stat.current !== undefined) {
                                    stat.current = Math.min(stat.max, Math.max(0, stat.current + value));
                                    if (key === 'health' && stat.current <= 0) {
                                        hitActor.die();
                                    }
                                }
                            }
                        }
                        hitActor.flash?.();
                        this.updateSidebar();
                    }

                    // Show hit message
                    const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                    const targetName = hitActor.getNameWithArticle ? hitActor.getNameWithArticle() : `the ${hitActor.name}`;
                    this.engine.inputManager?.showMessage(`The ${displayName} hits ${targetName}!`);

                    // A shot that lands teaches you about the bow, like a melee blow
                    launcher?.noteCombatUse(player);

                    // Item lands at the tile before the hit (or destroyed if breakable).
                    // Ammo with a break_chance rolls it, so most of it can be recovered;
                    // anything else is breakable_on_throw by default (like Brogue)
                    // unless explicitly set to false.
                    const breakChance = item.getAttribute('break_chance');
                    const breaks = breakChance !== undefined
                        ? ROT.RNG.getPercentage() <= breakChance
                        : item.getAttribute('breakable_on_throw') !== false;
                    if (breaks) {
                        // Play break sound (e.g. glass shattering)
                        const breakSound = item.getAttribute('break_sound');
                        if (breakSound) this.engine.playSound(breakSound);

                        // Item is destroyed on impact
                        const displayName2 = item.getDisplayName ? item.getDisplayName() : item.name;
                        this.engine.inputManager?.showMessage(breakChance !== undefined
                            ? `The ${displayName2} breaks.`
                            : `The ${displayName2} shatters!`);
                    } else if (path.length > 1) {
                        // Land one tile before the blocked tile
                        const landBeforeHit = path[path.length - 2];
                        item.x = landBeforeHit.x;
                        item.y = landBeforeHit.y;
                        this.engine.entityManager.addEntity(item);
                    } else {
                        // Path was only 1 tile, land at player's feet
                        item.x = player.x;
                        item.y = player.y;
                        this.engine.entityManager.addEntity(item);
                    }
                }
            }
        } else {
            // No hit - item lands at target
            if (item.hasAttribute('breakable')) {
                // Breakable item shatters on landing
                const breakSound = item.getAttribute('break_sound');
                if (breakSound) this.engine.playSound(breakSound);
                const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                this.engine.inputManager?.showMessage(`You throw the ${displayName}. It shatters! Its contents leak out harmlessly on the ground.`);
            } else {
                const fell = this.placeThrownItem(item, landingPoint.x, landingPoint.y);
                if (!fell) {
                    this.engine.playSound('arrow_miss');
                    const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                    this.engine.inputManager?.showMessage(`You ${launcher ? 'fire' : 'throw'} the ${displayName}.`);
                }
            }
        }

        // If thrown item has 'ignites' (e.g. lit torch), start fire at landing position
        if (item.hasAttribute('ignites')) {
            const entityManager = this.engine.entityManager;
            // Use item.x/y if it landed on ground; fall back to landingPoint if it shattered
            const wasAdded = entityManager?.items?.includes(item);
            const fx = wasAdded ? item.x : landingPoint.x;
            const fy = wasAdded ? item.y : landingPoint.y;
            const newFire = entityManager?.spawnActor('fire', fx, fy);
            if (newFire) newFire.fireLifetime = newFire.lifetime || 5;
            // Directly ignite flammable items at the same tile (fire_spread only checks adjacent)
            const itemsHere = entityManager?.items?.filter(
                i => i.x === fx && i.y === fy && i !== item && i.hasAttribute('flammable') && !i.isDead
            ) ?? [];
            for (const flammableItem of itemsHere) {
                if (flammableItem.hasAttribute('explosive')) {
                    const name = flammableItem.getDisplayName?.() ?? flammableItem.name;
                    this.engine.inputManager?.showMessage(`The ${name} explodes!`);
                    this.createExplosiveCloud(flammableItem, fx, fy);
                }
                flammableItem.die();
            }
        }

        // If the item landed on a collapsible floor, collapse it first and let the
        // item fall through (may remove the item, so run before the trap check).
        this.checkCollapseTrigger(landingPoint.x, landingPoint.y, item);

        // A thrown item presses a plate it lands on (unless the floor gave way under it)
        if (this.engine.entityManager.items.includes(item)) {
            this.engine.entityManager.notifyTileEntered(item, landingPoint.x, landingPoint.y);
        }

        // This counts as a player action
        this.engine.inputManager?.onPlayerAction();
    },

    /**
     * True if (x,y) is a void tile: no floor tile and no platform actor there.
     * A thrown/dropped item on such a tile should fall to the floor below.
     * @param {number} x - Tile X
     * @param {number} y - Tile Y
     * @returns {boolean}
     */
    isVoidLanding(x, y) {
        const mapManager = this.engine.mapManager;
        if (!mapManager) return false;
        const hasFloor = !!mapManager.floorMap?.[y]?.[x]?.tileId;
        if (hasFloor) return false;
        const hasPlatform = this.engine.entityManager?.getActorsAt(x, y)
            .some(a => !a.isDead && a.hasAttribute('platform') && a.hasAttribute('visible'));
        return !hasPlatform;
    },

    /**
     * Place a thrown/landed item at (x,y). If that tile is void, the item falls to
     * the next floor instead of resting mid-air; otherwise it is added normally.
     * Returns true if the item fell through (so the caller can adjust messaging).
     * @param {Item} item - The item to place
     * @param {number} x - Landing tile X
     * @param {number} y - Landing tile Y
     * @returns {boolean} True if the item fell to a lower floor / was lost to the void
     */
    placeThrownItem(item, x, y) {
        if (this.isVoidLanding(x, y)) {
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            const fell = this.engine.itemFallsToNextFloor(item);
            this.engine.playSound('arrow_miss');
            this.engine.inputManager?.showMessage(
                fell
                    ? `The ${displayName} plunges into the depths!`
                    : `The ${displayName} vanishes into the void.`
            );
            return true;
        }
        item.x = x;
        item.y = y;
        this.engine.entityManager.addEntity(item);
        return false;
    },

    /**
     * If a thrown item landed on a collapsible floor actor, activate the collapse
     * first (matching what happens when an actor steps onto it), then let the item
     * fall through the resulting void to the floor below.
     *
     * @param {number} x - Landing tile X
     * @param {number} y - Landing tile Y
     * @param {Item} item
     */
    checkCollapseTrigger(x, y, item) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        const collapsibles = entityManager.getActorsAt(x, y)
            .filter(a => !a.isDead && a.hasAttribute('collapsible'));
        if (collapsibles.length === 0) return;

        // Activate the collapse first (same feedback as an actor stepping on it).
        this.engine.renderer?.effectRunner?.apply('collapse_shake');
        this.engine.playSound('push1');
        for (const floor of collapsibles) {
            floor.collapse();
        }

        // If the item is still on this floor (not shattered/burned up), it now has
        // no floor beneath it — send it down through the fresh void.
        const stillPlaced = entityManager.items.includes(item) && !item.isDead;
        if (stillPlaced) {
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            const fell = this.engine.itemFallsToNextFloor(item);
            entityManager.removeEntity(item);
            this.engine.inputManager?.showMessage(
                fell
                    ? `The floor gives way and the ${displayName} plunges into the depths!`
                    : `The floor gives way and the ${displayName} vanishes into the void.`
            );
        }
    },

    /**
     * Create an explosive cloud from a thrown item
     * Spawns a cloud actor with the item's tint and use_effect as collision_effect
     * @param {Item} item - The explosive item
     * @param {number} x - Landing X coordinate
     * @param {number} y - Landing Y coordinate
     */
    createExplosiveCloud(item, x, y) {
        if (item.getAttribute('fire_explosion')) {
            this.createFireExplosion(item, x, y);
            return;
        }

        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        // An item with burst_into releases that actor (caustic_gas, ...), whose
        // own tint and effects stand. Without it, a generic cloud is built from
        // the item's tint and use_effect — the path random-effect potions take.
        if (item.getAttribute('burst_into')) {
            this.burstItemAt(item, x, y);
            return;
        }

        const cloud = entityManager.spawnActor('cloud', x, y);
        if (!cloud) return;
        this._configureGenericCloud(cloud, item);
        this._startCloud(cloud, item, x, y);
    },

    /**
     * Spawn an item's burst_into actor at (x, y): a dart's fire, a potion's gas,
     * or any other actor. Gas is started as a spreading cloud and fire gets its
     * burn time; anything else just appears. Consuming the item is the caller's job.
     * @param {Item} item - The item that burst
     * @param {number} x
     * @param {number} y
     * @returns {Actor|null} The spawned actor
     */
    burstItemAt(item, x, y) {
        const entityManager = this.engine.entityManager;
        const spawned = entityManager?.spawnActor(item.getAttribute('burst_into'), x, y);
        if (!spawned) return null;
        if (entityManager._gasDensity(spawned) > 0) this._startCloud(spawned, item, x, y);
        if (spawned.hasAttribute('ignites')) spawned.fireLifetime = spawned.lifetime || 5;
        return spawned;
    },

    /**
     * Make a freshly spawned gas actor a spreading origin cloud.
     * @param {Actor} cloud
     * @param {Item} item - Source item; its cloud_lifetime overrides the gas's own
     * @param {number} x
     * @param {number} y
     */
    _startCloud(cloud, item, x, y) {
        cloud.isCloudOrigin = true;
        cloud.cloudOriginX = x;
        cloud.cloudOriginY = y;
        cloud.cloudLifetime = item.getAttribute('cloud_lifetime') || cloud.lifetime || 10;
    },

    /**
     * Dress a generic `cloud` as the gas of an item with no burst_into: the
     * item's tint, its use_effect as the cloud's collision_effect/apply_state,
     * and cloud_flammable.
     * @param {Actor} cloud - The freshly spawned cloud
     * @param {Item} item - The item that released it
     */
    _configureGenericCloud(cloud, item) {
        cloud.tint = item.tint;

        // Use the item's use_effect as the cloud's collision_effect
        const useEffect = item.getAttribute('use_effect');
        if (useEffect && typeof useEffect === 'object') {
            // Extract apply_state separately from stat effects
            if (useEffect.apply_state) {
                cloud.setAttribute('apply_state', useEffect.apply_state);
            }

            // Set remaining properties as collision_effect (for stat damage)
            const collisionEffect = { ...useEffect };
            delete collisionEffect.apply_state;
            if (Object.keys(collisionEffect).length > 0) {
                cloud.setAttribute('collision_effect', collisionEffect);
            }
        }

        // Clouds don't burn unless the item says its gas is fuel
        if (item.getAttribute('cloud_flammable')) cloud.setAttribute('flammable', true);

        // Update sprite tints
        if (cloud.spriteBase) cloud.spriteBase.tint = item.tint;
        if (cloud.spriteTop) cloud.spriteTop.tint = item.tint;
    },

    /**
     * Create a fire explosion from an item with fire_explosion attribute.
     * Spawns intense_fire at the center and nearby tiles, regular fire at the outer
     * radius, and gives breakable solid actors a chance to be destroyed.
     * @param {Item} item - The explosive item
     * @param {number} x - Center X coordinate
     * @param {number} y - Center Y coordinate
     */
    createFireExplosion(item, x, y) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        this.engine.playSound?.('fireball');

        const radius = item.getAttribute('explosion_radius') || 2;
        const mapManager = this.engine.mapManager;

        // Spawn fire at all tiles within radius
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const tx = x + dx;
                const ty = y + dy;

                // Check floor exists
                const floorTile = mapManager?.floorMap[ty]?.[tx];
                if (!floorTile || floorTile.tileId <= 0) continue;

                // Skip if fire already present
                const existingFire = entityManager.actors.find(
                    a => a.x === tx && a.y === ty && (a.type === 'fire' || a.type === 'intense_fire') && !a.isDead
                );
                if (existingFire) continue;

                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const fireType = dist <= 1 ? 'intense_fire' : 'fire';
                entityManager.spawnActor(fireType, tx, ty);
            }
        }

        // Destroy nearby breakable solid actors
        for (const other of entityManager.actors) {
            if (other.isDead) continue;
            if (!other.hasAttribute('breakable') || !other.hasAttribute('solid')) continue;
            if (other.hasAttribute('fireproof')) continue;

            const dist = Math.max(Math.abs(other.x - x), Math.abs(other.y - y));
            if (dist > radius) continue;

            if (Math.random() < 0.6) {
                if (other.hasAttribute('visible')) {
                    const otherName = other.getNameWithArticle ? other.getNameWithArticle() : `the ${other.name}`;
                    this.engine.inputManager?.showMessage(`The explosion destroys ${otherName}!`);
                }
                other.die();
            }
        }
    },

    /**
     * Handle keyboard input during throw aiming mode
     * @param {string} key - The key pressed
     * @returns {boolean} True if key was handled
     */
    handleThrowKey(key, event) {
        if (!this.throwAimingMode) return false;

        if (key === 'Escape') {
            this.exitThrowAimingMode();
            return true;
        }

        if (this.isCycleTargetKey(event)) {
            this.cycleAimTarget();
            return true;
        }

        if (this.isConfirmTargetKey(event)) {
            this.executeThrow();
            return true;
        }

        return true; // Consume all keys while in throw mode
    },

    /**
     * Handle mouse click during throw aiming mode
     * @returns {boolean} True if click was handled
     */
    handleThrowClick() {
        if (!this.throwAimingMode) return false;

        this.executeThrow();
        return true;
    },

    /**
     * Check if in throw aiming mode
     * @returns {boolean}
     */
    isThrowAiming() {
        return this.throwAimingMode;
    },
};
