/**
 * Behaviors: chain creatures, cloud emitters, summoning, pickpockets, blinking,
 * bolts, web spraying, bouncing, countdowns and switch toggling.
 */

import { BehaviorLibrary } from './behaviors.js';
import {
    getChebyshevDistance,
    getLinePath,
    getNextPathStep,
    hasLineOfSight
} from '../core/pathfinding.js';
import { ALL_DIRS, CARDINAL_DIRS, randomElement, shuffleArray } from '../core/util.js';

const _warned = new Set();
function warnOnce(key, message) {
    if (_warned.has(key)) return;
    _warned.add(key);
    console.warn(message);
}

/**
 * The spells.json entry a bolt_attack personality names with `spell`, or null.
 * Only bolt-delivery spells fit: bolt_attack's own keys are all about bolts (use
 * cast_spell for anything else).
 * @param {Actor} actor
 * @param {Object} data - Personality data
 * @returns {Object|null}
 */
function boltSpellFor(actor, data) {
    const id = data?.spell;
    if (!id) return null;
    const spell = actor.engine.currentPrototype?.spells?.[id];
    if (!spell) {
        warnOnce(`bolt:${id}`, `bolt_attack names unknown spell '${id}'; using its own bolt_* values`);
        return null;
    }
    if (spell.delivery !== 'bolt') {
        warnOnce(`bolt:${id}`, `bolt_attack names '${id}', which isn't a bolt spell (use cast_spell); using its own bolt_* values`);
        return null;
    }
    return spell;
}

/**
 * Cast `spell` at the nearest enemy `actor` can see within `range`, once its
 * cooldown has run. The cooldown counts this actor's turns under `counterKey`
 * and resets only when a cast goes off, so a caster with no target fires as
 * soon as one appears. Enemies are creatures isEnemyOf names: the player for an
 * unfactioned monster, rival factions, anyone at all while discordant.
 * @param {Actor} actor
 * @param {Object} spell - A spells.json-shaped spell
 * @param {{range: number, cooldown: number, counterKey: string}} options
 * @returns {boolean} True if a spell was cast
 */
function castAtNearestEnemy(actor, spell, { range, cooldown, counterKey }) {
    actor[counterKey] = (actor[counterKey] || 0) + 1;
    if (actor[counterKey] < cooldown) return false;

    const entityManager = actor.engine.entityManager;
    let target = null;
    let nearestDist = Infinity;
    for (const other of entityManager.actors) {
        if (other === actor || other.isDead || !actor.isEnemyOf(other)) continue;
        // Creatures only: to a factioned caster, walls and doors aren't in its faction either.
        if (!other.isPlayerControlled() && !other.hasAttribute('sentient')) continue;
        const dist = Math.hypot(other.x - actor.x, other.y - actor.y);
        if (dist > range || dist >= nearestDist) continue;
        const isBlocked = (x, y) => {
            const actorAt = entityManager.getSolidActorAt(x, y);
            return actorAt && actorAt !== actor && actorAt !== other;
        };
        if (hasLineOfSight(actor.x, actor.y, other.x, other.y, isBlocked)) {
            target = other;
            nearestDist = dist;
        }
    }
    if (!target) return false;

    if (!actor.engine.castSpell({ caster: actor, spell, target: { x: target.x, y: target.y } })) return false;
    actor[counterKey] = 0;
    return true;
}

export const BehaviorsSpecial = {
    // ========================================================================
    // CHAIN CREATURE BEHAVIORS
    // ========================================================================

    /**
     * Head AI: pursue the player via A* pathfinding, recording position history
     * for body segments to follow. Avoids own body segments in both pathfinding
     * and random walk fallback, producing snake-like movement.
     */
    chain_head_ai: (actor, _data) => {
        // Scale strength by number of connected living segments
        let segCount = 0;
        let node = actor._chainNext;
        while (node && !node.isDead) {
            segCount++;
            node = node._chainNext;
        }
        const baseSegments = actor.getAttribute('segment_count') || 4;
        const baseStrength = actor.getAttribute('chain_base_strength') ?? 5;
        const perSegment = actor.getAttribute('chain_strength_per_segment') ?? 2.5;
        const scaledStrength = Math.round(baseStrength + segCount * perSegment);
        actor.setAttribute('strength', Math.min(scaledStrength, baseStrength + baseSegments * perSegment));

        // Collect body segment positions so the head avoids them
        const bodyPositions = new Set();
        node = actor._chainNext;
        while (node && !node.isDead) {
            bodyPositions.add(`${node.x},${node.y}`);
            node = node._chainNext;
        }

        const target = actor.engine.entityManager.findNearestPlayer(actor);

        if (!actor._pathHistory) actor._pathHistory = [];
        const maxHistory = (actor.getAttribute('segment_count') || 4) + 2;

        // Passability check that also avoids own body segments
        const isPassable = (x, y) => {
            if (bodyPositions.has(`${x},${y}`)) return false;
            return actor.isPassableAt(x, y) && !actor.isHazardAt(x, y);
        };

        // Helper: record position in history only when the head actually moves
        const recordMove = () => {
            actor._pathHistory.unshift({ x: beforeX, y: beforeY });
            if (actor._pathHistory.length > maxHistory) {
                actor._pathHistory.length = maxHistory;
            }
        };

        const beforeX = actor.x, beforeY = actor.y;

        // Pursue player if visible — use body-aware pathfinding
        if (target && actor.canSeeTarget(target)) {
            const targetX = target.x;
            const targetY = target.y;

            // Allow target tile even if a body segment is on it
            const isPassableForPursuit = (x, y) => {
                if (x === targetX && y === targetY) return true;
                return isPassable(x, y);
            };

            const nextStep = getNextPathStep(actor.x, actor.y, targetX, targetY, isPassableForPursuit);
            if (nextStep) {
                const result = actor.tryMove(nextStep.x, nextStep.y);
                if (result.moved) {
                    recordMove();
                    return true;
                }
                if (result.actionTaken) return true; // attacked but didn't move — don't record
            }
        }

        // No target or path failed — random walk avoiding body
        const directions = shuffleArray([...CARDINAL_DIRS]);
        for (const dir of directions) {
            const nx = actor.x + dir.dx;
            const ny = actor.y + dir.dy;
            if (bodyPositions.has(`${nx},${ny}`)) continue;
            if (actor.isHazardAt(nx, ny)) continue;
            const result = actor.tryMove(nx, ny);
            if (result.moved) {
                recordMove();
                return true;
            }
        }

        return false;
    },

    /**
     * Body follow: each segment reads the head's position history by chain index
     * and moves to the tile the head (or preceding segment) vacated.
     * If disconnected from a living head, falls through to scatter.
     */
    chain_body_follow: (actor, _data) => {
        const prev = actor._chainPrev;

        // If no prev link or prev is dead, we're disconnected
        if (!prev || prev.isDead) {
            actor._chainPrev = null;
            actor._chainHead = null;
            return false; // Fall through to scatter
        }

        // If head is dead, sever chain
        const head = actor._chainHead;
        if (!head || head.isDead) {
            actor._chainHead = null;
            return false; // Fall through to scatter
        }

        // Find our index in the chain (0 = first segment after head)
        let index = 0;
        let node = head._chainNext;
        while (node && node !== actor) {
            index++;
            node = node._chainNext;
        }

        // Get target position from head's path history
        const history = head._pathHistory;
        if (!history || index >= history.length) {
            // Not enough history — move toward prev segment directly
            if (Math.abs(actor.x - prev.x) > 1 || Math.abs(actor.y - prev.y) > 1) {
                return actor.moveToward(prev.x, prev.y);
            }
            return false;
        }

        const target = history[index];

        // Already at target position
        if (actor.x === target.x && actor.y === target.y) return false;

        const dx = Math.abs(actor.x - target.x);
        const dy = Math.abs(actor.y - target.y);

        // If target is adjacent (1 tile away), use tryMove directly
        if (dx <= 1 && dy <= 1) {
            const result = actor.tryMove(target.x, target.y);
            return result.moved || result.actionTaken;
        }

        // Target is too far — use pathfinding to catch up
        return actor.moveToward(target.x, target.y);
    },

    /**
     * Scatter: random walk for body segments disconnected from a living head.
     * Only activates when the segment has no living head reference.
     */
    chain_scatter: (actor, _data) => {
        // Only scatter if disconnected from a living head
        if (actor._chainHead && !actor._chainHead.isDead) return false;

        // Random 4-directional movement
        const directions = shuffleArray([...CARDINAL_DIRS]);
        for (const dir of directions) {
            const result = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
            if (result.moved) return true;
        }
        return false;
    },

    emit_cloud: (actor, data) => {
        const emitFromType = data.emit_from_type;
        if (emitFromType && actor.type !== emitFromType) return;

        const emitChance = data.emit_chance ?? 3;
        if (ROT.RNG.getPercentage() > emitChance) return;

        const entityManager = actor.engine.entityManager;
        const emitType = data.emit_type || 'sewer_gas';
        const emitCap = data.emit_cap ?? 12;
        const counterKey = '_' + emitType + 'Count';

        if (!entityManager[counterKey]) entityManager[counterKey] = 0;
        if (entityManager[counterKey] >= emitCap) return;

        for (const a of entityManager.getActorsAt(actor.x, actor.y)) {
            if (a.personality?.name === 'Cloud') return;
        }

        const cloud = entityManager.spawnActor(emitType, actor.x, actor.y);
        if (cloud) {
            cloud.isCloudOrigin = true;
            cloud.cloudOriginX = actor.x;
            cloud.cloudOriginY = actor.y;
            cloud.cloudLifetime = data.cloud_lifetime ?? 6;
            cloud._emitCounterKey = counterKey;
            entityManager[counterKey]++;
        }
    },

    summon_actor: (actor, data) => {
        const summonType = data.summon_type;
        if (!summonType) return false;

        const cooldown = data.summon_cooldown ?? 5;
        const cap = data.summon_cap ?? 3;
        const summonSound = data.summon_sound;

        if (!actor._summonCooldown) actor._summonCooldown = 0;
        actor._summonCooldown++;
        if (actor._summonCooldown < cooldown) return false;

        const entityManager = actor.engine.entityManager;
        let activeCount = 0;
        for (const a of entityManager.actors) {
            if (a.isDead || a.type !== summonType) continue;
            if (a._summonedBy === actor) activeCount++;
        }
        if (activeCount >= cap) return false;

        const spawnTile = BehaviorLibrary._findAdjacentFloor(
            actor.x, actor.y, entityManager, actor.engine.mapManager
        );
        if (!spawnTile) return false;

        actor._summonCooldown = 0;
        const summoned = entityManager.spawnActor(summonType, spawnTile.x, spawnTile.y);
        if (summoned) {
            summoned._summonedBy = actor;
            if (summonSound) actor.engine.playSound?.(summonSound);
        }

        return true;
    },

    pickpocket_adjacent: (actor, data) => {
        const entityManager = actor.engine.entityManager;

        for (const dir of ALL_DIRS) {
            const target = entityManager.getActorAt(actor.x + dir.dx, actor.y + dir.dy);
            if (!target || target.isDead || !target.hasAttribute('controlled')) continue;

            const stealable = target.inventory.filter(i => !target.isItemEquipped(i));
            if (stealable.length === 0) continue;

            const maxInventory = actor.getAttribute('inventory') || 1;
            if (actor.inventory.length >= maxInventory) continue;

            const stolen = randomElement(stealable);

            // Transfer item
            const idx = target.inventory.indexOf(stolen);
            if (idx > -1) target.inventory.splice(idx, 1);
            stolen.owner = actor;
            actor.inventory.push(stolen);

            actor._hasLoot = true;

            const displayName = stolen.getDisplayName ? stolen.getDisplayName() : stolen.name;
            actor.engine.inputManager?.showMessage(`${actor.getNameWithArticle(true)} snatches your ${displayName}!`);
            actor.engine.playSound?.('grab');

            return true;
        }

        return false;
    },

    /**
     * Flee away from the nearest player, preferring directions toward deep liquid.
     * If standing on deep liquid with loot, drop the item and stop fleeing.
     */
    flee_with_loot: (actor, data) => {
        if (!actor._hasLoot || actor.inventory.length === 0) return false;

        const entityManager = actor.engine.entityManager;

        // If standing on deep liquid, drop the stolen item into it
        const deepHere = entityManager.getActorsAt(actor.x, actor.y)
            .find(a => a !== actor && !a.hasAttribute('solid') && a.hasAttribute('deep'));
        if (deepHere) {
            const item = actor.inventory[actor.inventory.length - 1];
            actor.inventory.pop();
            item.owner = null;
            item.x = actor.x;
            item.y = actor.y;
            entityManager.addEntity(item);
            actor.engine.renderer?.updateItemZIndex(item);

            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            actor.engine.inputManager?.showMessage(
                `The ${actor.name} drops your ${displayName} into the ${deepHere.name}!`
            );

            actor._hasLoot = actor.inventory.length > 0;
            return true;
        }

        const player = entityManager.findNearestPlayer(actor);
        if (!player) return false;

        // Find nearest deep liquid within search radius for a secondary goal
        const searchRadius = data.loot_search_radius || 20;
        let nearestDeep = null;
        let nearestDeepDist = Infinity;
        for (const a of entityManager.actors) {
            if (a.isDead || a.hasAttribute('solid') || !a.hasAttribute('deep')) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, a.x, a.y);
            if (dist < nearestDeepDist && dist <= searchRadius) {
                nearestDeepDist = dist;
                nearestDeep = a;
            }
        }

        // If deep liquid is reachable and we're not too close to the player, head for it
        if (nearestDeep) {
            const distToPlayer = getChebyshevDistance(actor.x, actor.y, player.x, player.y);
            if (distToPlayer > 2) {
                return actor.moveToward(nearestDeep.x, nearestDeep.y);
            }
        }

        // Otherwise flee away from the player
        const dx = Math.sign(actor.x - player.x);
        const dy = Math.sign(actor.y - player.y);

        // Try fleeing in prioritized order: away, diagonals, perpendicular
        const fleeDirs = shuffleArray([...ALL_DIRS]);
        fleeDirs.sort((a, b) => {
            const scoreA = a.dx * dx + a.dy * dy;
            const scoreB = b.dx * dx + b.dy * dy;
            return scoreB - scoreA;
        });

        for (const dir of fleeDirs) {
            const nx = actor.x + dir.dx;
            const ny = actor.y + dir.dy;
            if (!actor.hasFloorAt(nx, ny) && !actor.hasPlatformAt(nx, ny)) continue;
            if (actor.isHazardAt(nx, ny)) continue;
            const result = actor.tryMove(nx, ny);
            if (result.moved) return true;
        }

        return false;
    },

    blink_away: (actor, data) => {
        const blinkRange = data.blink_range ?? 8;
        const cooldown = data.blink_cooldown ?? 5;
        const prefDist = data.preferred_distance ?? 4;

        if (!actor._blinkCooldown) actor._blinkCooldown = 0;
        actor._blinkCooldown++;
        if (actor._blinkCooldown < cooldown) return false;

        const entityManager = actor.engine.entityManager;
        const mapManager = actor.engine.mapManager;
        let target = null;
        let nearestDist = Infinity;

        for (const other of entityManager.actors) {
            if (other === actor || other.isDead) continue;
            if (!other.hasAttribute('controlled')) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, other.x, other.y);
            if (dist <= blinkRange && dist < nearestDist) {
                nearestDist = dist;
                target = other;
            }
        }

        if (!target) return false;

        // Destination tiles are empty, so only the path between matters: anything
        // solid other than the blinker itself blocks the line.
        const isBlocked = (x, y) => {
            if (!actor.hasFloorAt(x, y) && !actor.hasPlatformAt(x, y)) return true;
            const actorAt = entityManager.getSolidActorAt(x, y);
            return actorAt && actorAt !== actor;
        };

        const candidates = [];

        if (nearestDist <= 1) {
            // Adjacent to target — blink away to preferred distance
            for (const tile of mapManager.walkableTiles) {
                const dist = getChebyshevDistance(tile.x, tile.y, target.x, target.y);
                if (dist < prefDist - 1 || dist > prefDist + 1) continue;
                if (entityManager.getSolidActorAt(tile.x, tile.y)) continue;
                if (!hasLineOfSight(actor.x, actor.y, tile.x, tile.y, isBlocked)) continue;
                candidates.push(tile);
            }
        } else {
            // Far from target — blink to a tile adjacent to them
            for (const dir of ALL_DIRS) {
                const tx = target.x + dir.dx;
                const ty = target.y + dir.dy;
                if (!actor.hasFloorAt(tx, ty) && !actor.hasPlatformAt(tx, ty)) continue;
                if (entityManager.getSolidActorAt(tx, ty)) continue;
                if (!hasLineOfSight(actor.x, actor.y, tx, ty, isBlocked)) continue;
                candidates.push({ x: tx, y: ty });
            }
        }

        if (candidates.length === 0) return false;

        const dest = randomElement(candidates);
        const prevX = actor.x;
        const prevY = actor.y;
        actor._blinkCooldown = 0;
        actor.x = dest.x;
        actor.y = dest.y;
        actor.updateSpritePosition();
        actor.engine.lightingManager?.computeLighting();
        actor.engine.playSound?.(data.blink_sound ?? 'magic');
        actor.engine.renderer?.effectRunner?.apply(data.blink_vfx ?? data.blink_effect ?? 'blink');

        if (data.blink_spawn) {
            entityManager.spawnActor(data.blink_spawn, prevX, prevY);
        }

        return true;
    },

    /**
     * Fire a bolt at the nearest enemy in range and in sight (the lightning mage,
     * the dynamo). A personality `spell` names a bolt spell in spells.json for the
     * damage, range, sound and vfx; any bolt_* key on the personality overrides
     * it, as an item's own attributes override its spell. Without one it's a
     * plain lightning bolt. Personality data: spell, attack_range, bolt_cooldown,
     * bolt_damage, bolt_sound, bolt_vfx.
     */
    bolt_attack: (actor, data) => {
        const base = boltSpellFor(actor, data);
        const spell = {
            name: 'Lightning',
            ...base,
            delivery: 'bolt',
            cast_sound: data?.bolt_sound ?? base?.cast_sound ?? 'squarewave',
            vfx: data?.bolt_vfx ?? data?.bolt_effect ?? base?.vfx ?? 'lightning_bolt',
            effect: {
                ...base?.effect,
                bolt_damage: data?.bolt_damage || actor.getAttribute('bolt_damage') || base?.effect?.bolt_damage || -15
            }
        };
        return castAtNearestEnemy(actor, spell, {
            range: data?.attack_range || actor.getAttribute('attack_range') || base?.range || 8,
            cooldown: data?.bolt_cooldown || actor.getAttribute('bolt_cooldown') || 4,
            counterKey: '_boltCooldownCounter'
        });
    },

    /**
     * Cast any spell from spells.json at the nearest enemy in range and in sight:
     * a projectile lands its effect on them (fireball, poison, slowness...), a
     * bolt strikes along the line. Spells that act on the caster still aim at the
     * enemy, so blinking blinks toward them. Personality data: spell (required),
     * spell_range (default: the spell's range, else attack_range, else 8),
     * spell_cooldown (turns between casts, default 4).
     */
    cast_spell: (actor, data) => {
        const spell = actor.engine.currentPrototype?.spells?.[data?.spell];
        if (!spell) {
            warnOnce(`cast_spell:${data?.spell}`, `cast_spell: unknown or missing spell '${data?.spell}'`);
            return false;
        }
        return castAtNearestEnemy(actor, spell, {
            range: data.spell_range ?? spell.range ?? data.attack_range ?? 8,
            cooldown: data.spell_cooldown ?? 4,
            counterKey: '_spellCooldownCounter'
        });
    },

    /**
     * Spray a cone of webs toward the nearest player-controlled target.
     * The webs are non-solid actors that apply the 'stuck' state on contact,
     * so the target walks into the patch and must struggle free.
     * Cooldown-gated and line-of-sight gated, modeled on bolt_attack.
     * Personality data: spray_range, spray_cooldown, spray_arc (tiles of
     * half-width at max range), web_type, spray_sound.
     */
    spray_web: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const mapManager = actor.engine.mapManager;

        const attackRange = data?.spray_range || actor.getAttribute('spray_range') || 6;
        const minDistance = data?.spray_min_distance ?? 0;
        const cooldown = data?.spray_cooldown || actor.getAttribute('spray_cooldown') || 4;
        const arc = data?.spray_arc ?? 2;
        const webType = data?.web_type || 'web';

        if (!actor._sprayCooldownCounter) actor._sprayCooldownCounter = 0;
        actor._sprayCooldownCounter++;
        if (actor._sprayCooldownCounter < cooldown) return false;

        // Find nearest visible player-controlled target in range
        let target = null;
        let nearestDist = Infinity;

        for (const other of entityManager.actors) {
            if (other === actor || other.isDead) continue;
            if (!other.hasAttribute('controlled')) continue;

            const dx = other.x - actor.x;
            const dy = other.y - actor.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const isBlocked = (x, y) => {
                const actorAt = entityManager.getSolidActorAt(x, y);
                return actorAt && actorAt !== actor && actorAt !== other;
            };
            if (dist >= minDistance && dist <= attackRange && dist < nearestDist &&
                hasLineOfSight(actor.x, actor.y, other.x, other.y, isBlocked)) {
                target = other;
                nearestDist = dist;
            }
        }

        if (!target) return false;
        actor._sprayCooldownCounter = 0;

        // Unit direction from spider toward target
        const tdx = target.x - actor.x;
        const tdy = target.y - actor.y;
        const len = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
        const ux = tdx / len;
        const uy = tdy / len;
        // Perpendicular unit vector, for fanning the cone sideways
        const px = -uy;
        const py = ux;

        // Project a fan of endpoints across the cone's width at max range,
        // trace a line to each, and lay webs on valid floor tiles.
        const webTiles = new Map(); // key "x,y" -> {x, y}
        for (let offset = -arc; offset <= arc; offset++) {
            const endX = Math.round(actor.x + ux * attackRange + px * offset);
            const endY = Math.round(actor.y + uy * attackRange + py * offset);
            const path = getLinePath(actor.x, actor.y, endX, endY).slice(1); // skip spider's tile
            for (const point of path) {
                // Walls stop this ray (the targeting loop's isBlocked is scoped to that loop).
                const blocker = entityManager.getSolidActorAt(point.x, point.y);
                if (blocker && blocker !== actor && blocker !== target) break;
                const floorTile = mapManager?.floorMap?.[point.y]?.[point.x];
                if (!floorTile || floorTile.tileId <= 0) continue;
                webTiles.set(`${point.x},${point.y}`, point);
            }
        }

        let spawnedAny = false;
        for (const point of webTiles.values()) {
            // Don't stack a web where one already is, or on a solid blocker
            if (entityManager.getSolidActorAt(point.x, point.y)) continue;
            if (entityManager.getActorsAt(point.x, point.y).some(a => a.type === webType)) continue;
            if (entityManager.spawnActor(webType, point.x, point.y)) spawnedAny = true;
        }

        if (!spawnedAny) return false;

        actor.engine.playSound?.(data?.spray_sound ?? 'gas');
        const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
        actor.engine.inputManager?.showMessage(`${actorName} sprays a web!`, { x: actor.x, y: actor.y });

        return true;
    },

    horizontal_bounce: (actor) => {
        if (actor._bounceDir === undefined) actor._bounceDir = -1;

        const nextX = actor.x + actor._bounceDir;
        const result = actor.tryMove(nextX, actor.y);
        if (result.moved || result.actionTaken) return true;

        actor._bounceDir *= -1;
        const retryResult = actor.tryMove(actor.x + actor._bounceDir, actor.y);
        return retryResult.moved || retryResult.actionTaken;
    },

    vertical_bounce: (actor) => {
        if (actor._bounceDir === undefined) actor._bounceDir = -1;

        const nextY = actor.y + actor._bounceDir;
        const result = actor.tryMove(actor.x, nextY);
        if (result.moved || result.actionTaken) return true;

        actor._bounceDir *= -1;
        const retryResult = actor.tryMove(actor.x, actor.y + actor._bounceDir);
        return retryResult.moved || retryResult.actionTaken;
    },

    countdown: (actor, data) => {
        if (actor._paused) return false;

        if (actor._countdownCounter === undefined) {
            actor._countdownCounter = data.interval ?? actor.getAttribute('clock_interval') ?? 5;
        }

        actor._countdownCounter--;

        if (actor._countdownCounter <= 0) {
            actor._countdownCounter = data.interval ?? actor.getAttribute('clock_interval') ?? 5;

            const eventName = data.countdown_event ?? 'toggle_and_propagate';
            const eventBehavior = BehaviorLibrary[eventName];
            if (eventBehavior) eventBehavior(actor, data);

            if (data.countdown_sound) actor.engine.playSound?.(data.countdown_sound);
        }

        return false;
    },

    countdown_display: (actor, data) => {
        if (data.countdown_display === 'digit') {
            const counter = actor._countdownCounter ?? (data.interval ?? 5);
            const digit = Math.min(counter, 9);
            actor.updateTileIndex(`DIGIT_${digit}`, 'base');
        }
        return true;
    },

    toggle_and_propagate: (actor) => {
        const nowToggled = !actor.hasAttribute('toggled');
        actor.setAttribute('toggled', nowToggled);
        actor._propagateSwitchEffects(nowToggled);
        return true;
    },
};
