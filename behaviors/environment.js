/**
 * Behaviors: the environment acting on its own: incineration, steam, clouds
 * (spreading, affecting, dispersing), auras, expiry, cellular transforms,
 * liquid mixing and currents, and fire (spread, burn-out, smoke).
 */

import {
    ALL_DIRS,
    CARDINAL_DIRS,
    extractRGB,
    lerpColor,
    packRGB,
    randomElement,
    rgbToHue
} from '../core/util.js';
import { Actor } from '../engine/actor/actor.js';
import { Item } from '../engine/item.js';

/**
 * Open a temporary hole under an `opens_floor` gas (descent vapor) and drop
 * everything on it to the floor below: creatures through
 * Actor.dropThroughOpenedFloor, items by falling like a thrown one over the void.
 * The hole stays `hole_turns` player actions (default 3) after the vapor last
 * touched it. Fliers hover; on the bottom floor nothing happens.
 * @param {Actor} gas - The vapor actor
 */
function openFloorUnder(gas) {
    const engine = gas.engine;
    const entityManager = engine.entityManager;
    if (!engine.hasFloorBelow()) return;
    if (!entityManager.openTemporaryHole(gas.x, gas.y, gas.getAttribute('hole_turns') ?? 3)) return;

    for (const other of [...entityManager.getActorsAt(gas.x, gas.y)]) {
        if (other === gas || other.isDead || other.stats?.health === undefined) continue;
        if (entityManager._gasDensity(other) > 0) continue;
        other.dropThroughOpenedFloor();
    }
    for (const item of entityManager.items.filter(i => i.x === gas.x && i.y === gas.y && !i.isDead)) {
        if (engine.itemFallsToNextFloor(item)) entityManager.removeEntity(item);
    }
}

export const BehaviorsEnvironment = {
    /**
     * Incinerate any entities (actors or items) sharing this actor's tile
     * Spawns a replacement actor (e.g., fire) in their place
     */
    incinerate_entities: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const spawnType = data.spawn_on_incinerate || 'fire';
        const liquidSpawnType = data.spawn_on_liquid_incinerate || 'smoke';
        let incinerated = false;

        // Find other actors at this position
        for (const other of entityManager.actors) {
            if (other === actor) continue;
            if (other.isDead) continue;
            if (other.x !== actor.x || other.y !== actor.y) continue;

            // Skip fireproof or flying actors
            if (other.hasAttribute('fireproof')) continue;
            if (other.hasStateProperty?.('flying')) continue;

            const isSolid = other.hasAttribute('solid');
            const isLiquid = other.hasAttribute('liquid');

            // Only incinerate solid actors or liquids
            if (!isSolid && !isLiquid) continue;

            // Non-flammable solids (stone walls, metal) don't burn — they soak up the
            // heat instead and carry it back out as `superheated`, igniting whatever
            // they touch for a few turns. Refreshed every turn they stay in the lava,
            // so the countdown only starts once they leave.
            if (isSolid && !other.hasAttribute('flammable')) {
                const superheated = actor.engine.globalStates?.superheated;
                if (superheated) other.applyState?.('superheated', superheated);
                continue;
            }

            console.log(`${actor.name} incinerates ${other.name}!`);

            // Show incineration message for visible actors
            if (other.hasAttribute('visible')) {
                const otherName = other.getNameWithArticle();
                actor.engine.inputManager?.showMessage(`${actor.getNameWithArticle(true)} incinerates ${otherName}!`, { x: actor.x, y: actor.y });
            }

            other.die();

            // Spawn replacement actor - smoke for liquids, fire for solids
            if (isLiquid && liquidSpawnType) {
                entityManager.spawnActor(liquidSpawnType, other.x, other.y);
                actor.engine.playSound?.('gas');
            } else if (isSolid && spawnType) {
                entityManager.spawnActor(spawnType, other.x, other.y);
                actor.engine.playSound?.('fireball');
            }

            incinerated = true;
        }

        // Find items at this position
        const itemsAtPosition = entityManager.items.filter(
            item => item.x === actor.x && item.y === actor.y
        );

        for (const item of itemsAtPosition) {
            // Skip fireproof items
            if (item.hasAttribute('fireproof')) continue;

            console.log(`${actor.name} incinerates ${item.name}!`);

            // Show incineration message for visible items
            if (item.hasAttribute('visible')) {
                const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                const article = actor.engine.inputManager?.getIndefiniteArticle(displayName) || 'a';
                actor.engine.inputManager?.showMessage(`${actor.getNameWithArticle(true)} incinerates ${article} ${displayName}!`, { x: actor.x, y: actor.y });
            }

            // Spawn fire where the item was destroyed
            entityManager.spawnActor(spawnType, item.x, item.y);
            actor.engine.playSound?.('fireball');

            entityManager.removeEntity(item);
            incinerated = true;
        }

        return incinerated;
    },

    /**
     * Steam generation - lava creates steam when adjacent to liquid actors.
     * Checks cardinal neighbors for liquid actors; for each one found,
     * spawns a steam cloud at the liquid's position and kills the liquid.
     *
     * Data parameters (from personality JSON):
     * - steam_type: Actor type to spawn (default "steam")
     * - steam_chance: Probability per adjacent liquid per turn (default 0.3)
     */
    steam_generation: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const steamType = data.steam_type || 'steam';
        const steamChance = data.steam_chance ?? 0.3;

        let generated = false;

        for (const dir of CARDINAL_DIRS) {
            const nx = actor.x + dir.dx;
            const ny = actor.y + dir.dy;

            const liquid = entityManager.getActorsAt(nx, ny)
                .find(a => a.hasAttribute('liquid'));

            if (!liquid) continue;
            if (ROT.RNG.getUniform() >= steamChance) continue;

            const lx = liquid.x;
            const ly = liquid.y;

            // Kill the liquid
            liquid.die();

            // Spawn steam at the liquid's former position
            const steam = entityManager.spawnActor(steamType, lx, ly);
            if (steam) {
                steam.isCloudOrigin = true;
                steam.cloudOriginX = lx;
                steam.cloudOriginY = ly;
            }

            actor.engine.playSound?.('match');
            generated = true;
        }

        return generated;
    },

    /**
     * Cloud spreading behavior - gradually expands to fill an area
     * Uses actor's spreadTurnsRemaining and origin position
     */
    cloud_spread: (actor, data) => {
        // Only the origin cloud spreads
        if (!actor.isCloudOrigin) return false;

        // Initialize spread tracking on first call
        if (actor.spreadTurnsRemaining === undefined) {
            actor.spreadTurnsRemaining = data.spread_turns || 4;
            actor.currentSpreadDistance = 0;
        }

        if (actor.spreadTurnsRemaining <= 0) return false;

        actor.spreadTurnsRemaining--;
        actor.currentSpreadDistance++;

        const spreadRadius = data.spread_radius || 2;
        const entityManager = actor.engine.entityManager;

        // Don't spawn beyond spread radius
        if (actor.currentSpreadDistance > spreadRadius) return false;

        // Get the origin cloud's lifetime (initialize if needed)
        if (actor.cloudLifetime === undefined) {
            actor.cloudLifetime = actor.lifetime || data.cloud_lifetime || 10;
        }

        // Directions (indices into ALL_DIRS) whose ray has hit a wall. Gas spreads
        // along 8 straight rays, so without this a puff at distance 2 would appear
        // on the far side of a wall at distance 1.
        if (!actor.blockedSpreadDirs) actor.blockedSpreadDirs = new Set();

        // Spread to tiles at the current distance from origin
        for (let i = 0; i < ALL_DIRS.length; i++) {
            if (actor.blockedSpreadDirs.has(i)) continue;
            const dir = ALL_DIRS[i];
            const targetX = actor.cloudOriginX + dir.dx * actor.currentSpreadDistance;
            const targetY = actor.cloudOriginY + dir.dy * actor.currentSpreadDistance;

            // Check if tile is valid (has floor, not a wall)
            const floorTile = actor.engine.mapManager?.floorMap[targetY]?.[targetX];
            if (!floorTile || floorTile.tileId <= 0) continue;
            if (entityManager.blocksGasAt(targetX, targetY)) {
                actor.blockedSpreadDirs.add(i);
                continue;
            }

            // Don't spread onto a tile that already holds any gas (cloud OR mist) —
            // it would only be collapsed by the merge rule anyway. Skipping avoids
            // the spawn-then-immediately-merge churn on a dense gas field.
            const cloudSpawnType = data.spawn_type || actor.type;
            const existingGas = entityManager.getActorsAt(targetX, targetY)
                .find(a => !a.isDead && entityManager._gasDensity(a) > 0);
            if (existingGas) continue;

            // Spawn a new cloud at this position
            const newCloud = entityManager.spawnActor(cloudSpawnType, targetX, targetY);
            if (newCloud) {
                // Copy properties from origin cloud
                newCloud.tint = actor.tint;
                newCloud.setAttribute('collision_effect', actor.getAttribute('collision_effect'));
                // Copy apply_state for state-applying clouds (paralysis, confusion)
                const applyState = actor.getAttribute('apply_state');
                if (applyState) {
                    newCloud.setAttribute('apply_state', applyState);
                }
                const ward = actor.getAttribute('ward');
                if (ward) newCloud.setAttribute('ward', ward);
                newCloud.setAttribute('flammable', !!actor.hasAttribute('flammable'));
                // Give spawned clouds the same remaining lifetime as the origin
                newCloud.cloudLifetime = actor.cloudLifetime;
                // Update sprites with new tint
                if (newCloud.spriteBase) newCloud.spriteBase.tint = actor.tint;
                if (newCloud.spriteTop) newCloud.spriteTop.tint = actor.tint;

                // Apply state to any actors at this position (since applySpawnDamage ran before apply_state was set)
                if (applyState) {
                    const statesData = actor.engine.globalStates;
                    if (statesData && statesData[applyState]) {
                        for (const other of entityManager.getActorsAt(targetX, targetY)) {
                            if (other === newCloud) continue;
                            if (entityManager._gasDensity(other) > 0) continue;
                            if (other.applyState) {
                                other.applyState(applyState, statesData[applyState]);
                            }
                        }
                    }
                }
            }
        }

        return true;
    },

    /**
     * Apply a named state (from `apply_state`) to any actor sharing this actor's tile,
     * each turn. Used by stationary hazards that hold/affect whoever stands on them
     * (quicksand → 'stuck'; reusable for webs, snares, tar). applyState() itself gates on
     * sentient/controlled and refreshes duration if already present, and emits the state's
     * own on_apply message — so no filtering or messaging is needed here. Returns false so
     * it composes with other behaviors (e.g. strip_inventory) without consuming the turn.
     */
    apply_state_on_tile: (actor) => {
        const stateName = actor.getAttribute('apply_state');
        if (!stateName) return false;
        const statesData = actor.engine.globalStates;
        const stateData = statesData?.[stateName];
        if (!stateData) return false;
        for (const other of actor.engine.entityManager.getActorsAt(actor.x, actor.y)) {
            if (other === actor) continue;
            other.applyState?.(stateName, stateData);
        }
        return false;
    },

    /**
     * Apply cloud's collision effect and/or state to any actors standing in it
     * Shows a message describing the effect for visible actors
     */
    cloud_affect_actors: (actor) => {
        // Descent vapor opens the ground: creatures and items here drop a floor
        if (actor.hasAttribute('opens_floor')) openFloorUnder(actor);

        const collisionEffect = actor.getAttribute('collision_effect');
        const applyStateName = actor.getAttribute('apply_state');
        // A ward (incense smoke) adds its own collision_effect, applied only to the
        // actor types it lists — the undead, say — regardless of gas_immune.
        const ward = actor.getAttribute('ward');
        const wardEffect = ward?.collision_effect;
        const hasWardEffect = !!wardEffect && Object.keys(wardEffect).length > 0;

        // Skip if no effects to apply
        const hasCollisionEffect = collisionEffect && Object.keys(collisionEffect).length > 0;
        if (!hasCollisionEffect && !applyStateName && !hasWardEffect) return false;

        const entityManager = actor.engine.entityManager;

        // Check if this tile is visible (or darkness is disabled)
        const tileIsVisible = actor.engine.isTileVisible(actor.x, actor.y);

        for (const other of entityManager.getActorsAt(actor.x, actor.y)) {
            if (other === actor) continue;
            if (entityManager._gasDensity(other) > 0) continue;

            // Track effects applied for messaging
            const effectsApplied = [];

            const statDeltas = hasCollisionEffect ? { ...collisionEffect } : {};
            if (hasWardEffect && other.matchesActorType?.(ward.types)) {
                for (const [key, value] of Object.entries(wardEffect)) {
                    statDeltas[key] = (statDeltas[key] || 0) + value;
                }
            }

            // Apply collision effect (stat damage)
            if (Object.keys(statDeltas).length > 0) {
                for (const [key, value] of Object.entries(statDeltas)) {
                    if (other.stats && other.stats[key] !== undefined) {
                        const stat = other.stats[key];
                        if (typeof stat === 'object' && stat.current !== undefined) {
                            stat.current = Math.max(0, stat.current + value);

                            // Track what happened for the message
                            const statCapitalized = key.charAt(0).toUpperCase() + key.slice(1);
                            if (value > 0) {
                                effectsApplied.push(`+${value} ${statCapitalized}`);
                            } else {
                                effectsApplied.push(`${value} ${statCapitalized}`);
                            }

                            if (key === 'health' && stat.current <= 0) {
                                other.die();
                            }
                        }
                    }
                }
            }

            // Apply state if specified (paralysis, confusion, etc.)
            if (applyStateName && other.applyState) {
                const statesData = actor.engine.globalStates;
                if (statesData && statesData[applyStateName]) {
                    const stateApplied = other.applyState(applyStateName, statesData[applyStateName]);
                    if (stateApplied) {
                        // State message is shown by applyState itself, but track for messaging purposes
                        effectsApplied.push(statesData[applyStateName].name || applyStateName);
                    }
                }
            }

            // Show effect message and flash only if effects were applied
            if (effectsApplied.length > 0) {
                const gasName = actor.name;

                // Only show generic engulf message for stat effects, not state application
                // (state application shows its own message via applyState)
                const statEffects = effectsApplied.filter(e => e.includes('+') || e.includes('-'));
                if (statEffects.length > 0) {
                    const effectStr = statEffects.join(', ');

                    if (other.hasAttribute('controlled')) {
                        // Player message
                        actor.engine.inputManager?.showMessage(`The ${gasName} engulfs you! (${effectStr})`);
                    } else if (tileIsVisible && other.hasAttribute('visible')) {
                        // Visible NPC message
                        const otherName = other.getNameWithArticle ? other.getNameWithArticle() : `the ${other.name}`;
                        actor.engine.inputManager?.showMessage(`The ${gasName} engulfs ${otherName}. (${effectStr})`);
                    }
                }

                // Flash the affected actor
                other.flash?.();
            }
        }

        return false; // Don't stop other behaviors
    },

    apply_aura: (actor, data) => {
        const auraState = data.aura_state;
        if (!auraState) return false;

        const auraChance = data.aura_chance ?? 25;
        const hostileOnly = data.aura_hostile_only !== false;
        const entityManager = actor.engine.entityManager;
        const statesData = actor.engine.statesData;
        if (!statesData?.[auraState]) return false;

        for (const dir of ALL_DIRS) {
            const other = entityManager.getSolidActorAt(actor.x + dir.dx, actor.y + dir.dy);
            if (!other || other === actor || other.isDead) continue;
            if (hostileOnly && !other.hasAttribute('controlled')) continue;
            if (ROT.RNG.getPercentage() > auraChance) continue;

            const stateData = { ...statesData[auraState] };
            if (data.aura_duration) stateData.duration = data.aura_duration;
            // Creature-only: an aura is something a creature exudes at other
            // creatures. Without this the neighbour scan would poison the walls
            // a creature happens to be standing next to.
            other.applyCreatureState(auraState, stateData);
        }

        return false;
    },

    /**
     * Countdown cloud lifetime and remove when expired
     */
    /**
     * Remove the actor once its `lifetime` (turns, default 10) runs out — for
     * temporary things that aren't gas or fire, like conjured crystal.
     */
    expire: (actor) => {
        if (actor._turnsLeft === undefined) actor._turnsLeft = actor.lifetime ?? 10;
        if (--actor._turnsLeft > 0) return false;
        actor.die();
        return true;
    },

    cloud_lifetime: (actor) => {
        // Initialize lifetime from actor data if not set
        if (actor.cloudLifetime === undefined) {
            actor.cloudLifetime = actor.lifetime || 5;
        }

        actor.cloudLifetime--;

        if (actor.cloudLifetime <= 0) {
            // Counter decrement now lives in Actor.die() (the common death path),
            // so it fires for every way a counted cloud can die, not just here.
            actor.die();
            return true;
        }

        return false;
    },

    /**
     * Cloud dispersion behavior - dense clouds disperse into mist at edges
     * Uses cellular automata rules: clouds with fewer cloud neighbors disperse first
     *
     * Data parameters:
     * - disperse_to: The actor type to transform into when dispersing (default: "mist")
     * - disperse_threshold: Maximum cloud neighbors to trigger dispersion (default: 2)
     * - disperse_chance: Probability of dispersing each turn when conditions met (default: 0.4)
     * - spawn_mist_chance: Probability of spawning mist in adjacent empty tiles (default: 0.3)
     */
    cloud_disperse: (actor, data) => {
        const disperseTo = data.disperse_to || 'mist';
        const disperseThreshold = data.disperse_threshold ?? 2;
        const disperseChance = data.disperse_chance ?? 0.4;
        const spawnMistChance = data.spawn_mist_chance ?? 0.3;

        const entityManager = actor.engine.entityManager;

        // Initialize lifetime if not set (needed for non-origin clouds)
        if (actor.cloudLifetime === undefined) {
            actor.cloudLifetime = actor.lifetime || data.cloud_lifetime || 10;
        }

        // Count cloud neighbors (same type as this actor, typically 'cloud')
        let cloudNeighbors = 0;
        const emptyNeighborPositions = [];

        for (const dir of ALL_DIRS) {
            const checkX = actor.x + dir.dx;
            const checkY = actor.y + dir.dy;

            const floorTile = actor.engine.mapManager?.floorMap[checkY]?.[checkX];
            if (!floorTile || floorTile.tileId <= 0) continue;

            const actorsHere = entityManager.getActorsAt(checkX, checkY);
            let foundGas = false;
            for (const a of actorsHere) {
                if (a.type === actor.type) {
                    cloudNeighbors++;
                    foundGas = true;
                    break;
                }
                if (a.type === disperseTo) {
                    foundGas = true;
                    break;
                }
            }
            if (!foundGas) {
                emptyNeighborPositions.push({x: checkX, y: checkY});
            }
        }

        // Clouds at the edge (fewer dense cloud neighbors) disperse into mist
        if (cloudNeighbors <= disperseThreshold && ROT.RNG.getUniform() < disperseChance) {
            const x = actor.x;
            const y = actor.y;
            const tint = actor.tint;
            const collisionEffect = actor.getAttribute('collision_effect');
            const applyState = actor.getAttribute('apply_state');
            const ward = actor.getAttribute('ward');
            const remainingLifetime = actor.cloudLifetime;

            // Remove the cloud
            actor.die();

            // Spawn mist in its place
            const mist = entityManager.spawnActor(disperseTo, x, y);
            if (mist) {
                // Inherit properties from the cloud
                mist.tint = tint;
                mist.setAttribute('collision_effect', collisionEffect);
                if (applyState) mist.setAttribute('apply_state', applyState);
                if (ward) mist.setAttribute('ward', ward);
                mist.setAttribute('flammable', !!actor.hasAttribute('flammable'));
                // Mist has shorter remaining lifetime
                mist.cloudLifetime = Math.max(2, Math.floor(remainingLifetime * 0.6));
                // Update sprites
                if (mist.spriteBase) mist.spriteBase.tint = tint;
                if (mist.spriteTop) mist.spriteTop.tint = tint;
            }

            return true;
        }

        // Mist can spawn in adjacent empty tiles (spreading outward)
        if (emptyNeighborPositions.length > 0 && ROT.RNG.getUniform() < spawnMistChance) {
            // Pick a random empty neighbor
            const pos = randomElement(emptyNeighborPositions);

            const mist = entityManager.spawnActor(disperseTo, pos.x, pos.y);
            if (mist) {
                mist.tint = actor.tint;
                mist.setAttribute('collision_effect', actor.getAttribute('collision_effect'));
                const neighborApplyState = actor.getAttribute('apply_state');
                if (neighborApplyState) mist.setAttribute('apply_state', neighborApplyState);
                const neighborWard = actor.getAttribute('ward');
                if (neighborWard) mist.setAttribute('ward', neighborWard);
                mist.setAttribute('flammable', !!actor.hasAttribute('flammable'));
                // New mist has short lifetime
                mist.cloudLifetime = Math.max(2, Math.floor((actor.cloudLifetime || 3) * 0.5));
                if (mist.spriteBase) mist.spriteBase.tint = actor.tint;
                if (mist.spriteTop) mist.spriteTop.tint = actor.tint;
            }
        }

        return false;
    },

    /**
     * Mist fading behavior - mist disperses more rapidly at edges
     *
     * Data parameters:
     * - fade_threshold: Maximum mist/cloud neighbors to trigger faster fade (default: 1)
     * - fade_chance: Probability of dying early when isolated (default: 0.3)
     */
    mist_fade: (actor, data) => {
        const fadeThreshold = data.fade_threshold ?? 1;
        const fadeChance = data.fade_chance ?? 0.3;

        const entityManager = actor.engine.entityManager;

        // Count any gas neighbors (mist or cloud)
        let gasNeighbors = 0;

        for (const dir of ALL_DIRS) {
            const checkX = actor.x + dir.dx;
            const checkY = actor.y + dir.dy;

            for (const a of entityManager.getActorsAt(checkX, checkY)) {
                if (entityManager._gasDensity(a) > 0) {
                    gasNeighbors++;
                    break;
                }
            }
        }

        // Isolated mist fades faster
        if (gasNeighbors <= fadeThreshold && ROT.RNG.getUniform() < fadeChance) {
            actor.die();
            return true;
        }

        return false;
    },

    /**
     * Cellular automata transformation behavior
     * Checks if neighbors match a condition and transforms this actor into another type
     *
     * Data parameters:
     * - neighbor_type: The actor type to check for in neighbors (e.g., "sewage")
     * - neighbor_count: Minimum number of matching neighbors required (default: 4, meaning all cardinal directions)
     * - transform_to: The actor type to transform into (e.g., "deep_sewage")
     * - check_cardinal: If true, only check 4 cardinal directions; if false, check all 8 (default: true)
     */
    cellular_transform: (actor, data) => {
        const neighborType = data.neighbor_type || actor.type;
        const requiredCount = data.neighbor_count ?? 4;
        const transformTo = data.transform_to || ('deep_' + actor.type);
        const checkCardinal = data.check_cardinal !== false;

        // Don't transform if already the target type
        if (actor.type === transformTo) return false;

        // A failed check keeps failing until something new appears next door, so
        // settle and skip until spawnActor re-wakes this tile (losing a neighbor
        // only lowers the count, so deaths never need to wake it).
        if (actor._caSettled) return false;

        const directions = checkCardinal ? CARDINAL_DIRS : ALL_DIRS;

        const entityManager = actor.engine.entityManager;
        let matchingNeighbors = 0;

        for (const dir of directions) {
            const checkX = actor.x + dir.dx;
            const checkY = actor.y + dir.dy;

            const neighbor = entityManager.getActorsAt(checkX, checkY)
                .find(a => a.type === neighborType || a.type === transformTo);

            if (neighbor) {
                matchingNeighbors++;
            }
        }

        // Check if we have enough matching neighbors to transform
        if (matchingNeighbors >= requiredCount) {
            const x = actor.x;
            const y = actor.y;

            // Remove the current actor
            actor.die();

            // Spawn the transformed actor
            const newActor = entityManager.spawnActor(transformTo, x, y);
            if (newActor) {
                console.log(`${neighborType} at (${x}, ${y}) transformed into ${transformTo} (${matchingNeighbors} neighbors)`);
            }

            return true;
        }

        actor._caSettled = true;
        return false;
    },

    /**
     * Liquid Color Mixing - Gradually blends a liquid tile's tint toward
     * adjacent liquid tiles of DIFFERENT types, simulating fluid mixing.
     * Uses weighted bidirectional mixing where larger bodies of liquid
     * exert more influence on smaller ones. Skips neighbors with similar
     * hue to preserve visual distinction between related liquid types.
     *
     * Data parameters (from personality JSON):
     * - mix_chance: Probability (0-1) that mixing occurs this turn (default 0.3)
     * - mix_step: Maximum interpolation factor per turn (default 0.08)
     *
     * Requires 'liquid' attribute on the actor.
     * Always returns false so subsequent behaviors still execute.
     */
    liquid_color_mix: (actor, data) => {
        if (!actor.hasAttribute('liquid')) return false;

        // Settled liquids (already converged, no neighbor disturbance) skip all work
        // until a cardinal neighbor's tint changes and re-wakes them. Large static
        // lakes converge in a few turns and then cost nothing.
        if (actor._mixSettled) return false;

        // Blending nobody can see is wasted work. Unseen tiles aren't marked settled,
        // so they pick up where they left off once the player sees them. (Always
        // true on lit levels, where isTileVisible has no darkness to test.)
        if (!actor.engine.isTileVisible(actor.x, actor.y)) return false;

        const mixChance = data.mix_chance ?? 0.3;
        if (ROT.RNG.getUniform() >= mixChance) return false;

        const entityManager = actor.engine.entityManager;

        let sameCount = 0;
        const foreignNeighbors = [];

        for (const dir of CARDINAL_DIRS) {
            const nx = actor.x + dir.dx;
            const ny = actor.y + dir.dy;

            const neighbor = entityManager._getLiquidActorAt(nx, ny);

            if (!neighbor) continue;

            if (neighbor.type === actor.type) {
                sameCount++;
            } else {
                foreignNeighbors.push(neighbor);
            }
        }

        // No foreign-type neighbors → nothing to blend toward; settle and bail
        // before any hue/RGB math (homogeneous pools never need to blend at all).
        if (foreignNeighbors.length === 0) {
            actor._mixSettled = true;
            return false;
        }

        // Filter out neighbors with similar hue (e.g. sewage and deep_sewage).
        // actor.originalTint never changes, so its hue is constant — memoize it.
        if (actor._originalHue === undefined) actor._originalHue = rgbToHue(actor.originalTint);
        const actorHue = actor._originalHue;
        const hueThreshold = 30;
        const distinctNeighbors = foreignNeighbors.filter(fn => {
            if (fn._originalHue === undefined) fn._originalHue = rgbToHue(fn.originalTint);
            let hueDiff = Math.abs(actorHue - fn._originalHue);
            if (hueDiff > 180) hueDiff = 360 - hueDiff;
            return hueDiff > hueThreshold;
        });

        if (distinctNeighbors.length === 0) {
            actor._mixSettled = true;
            return false;
        }

        // Weight: more foreign neighbors = stronger pull toward foreign color
        const foreignWeight = distinctNeighbors.length / (distinctNeighbors.length + sameCount + 1);

        // Average the originalTint of all foreign neighbors
        let avgR = 0, avgG = 0, avgB = 0;
        for (const fn of distinctNeighbors) {
            const rgb = extractRGB(fn.originalTint);
            avgR += rgb.r;
            avgG += rgb.g;
            avgB += rgb.b;
        }
        avgR = Math.round(avgR / distinctNeighbors.length);
        avgG = Math.round(avgG / distinctNeighbors.length);
        avgB = Math.round(avgB / distinctNeighbors.length);
        const foreignAvgColor = packRGB(avgR, avgG, avgB);

        // Target: blend between own original color and foreign average, weighted by neighbor ratio
        const target = lerpColor(actor.originalTint, foreignAvgColor, foreignWeight);

        // Convergence check: stop if already close enough. Mark settled so this
        // tile is skipped until a cardinal neighbor's tint changes and re-wakes it.
        const cur = extractRGB(actor.tint);
        const tgt = extractRGB(target);
        const diff = Math.abs(cur.r - tgt.r) + Math.abs(cur.g - tgt.g) + Math.abs(cur.b - tgt.b);
        if (diff <= 3) {
            actor._mixSettled = true;
            return false;
        }

        // Incrementally shift current tint toward target
        const step = data.mix_step ?? 0.08;
        const newTint = lerpColor(actor.tint, target, step);
        actor.tint = newTint;

        // Apply directly to sprites (renderer only updates on lighting changes)
        if (actor.spriteBase) actor.spriteBase.tint = newTint;
        if (actor.spriteTop) actor.spriteTop.tint = newTint;

        // This tile's color changed, so its cardinal liquid neighbors may now need
        // to re-blend toward it — re-wake any that had settled (conservative).
        for (const dir of CARDINAL_DIRS) {
            const neighbor = entityManager._getLiquidActorAt(actor.x + dir.dx, actor.y + dir.dy);
            if (neighbor && neighbor._mixSettled) neighbor._mixSettled = false;
        }

        return false;
    },

    strip_inventory: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const dropChance = data.item_drop_chance ?? 0.1;

        const other = entityManager._getSolidActorAt(actor.x, actor.y);
        if (!other || other === actor) return false;
        if (!other.inventory || other.inventory.length === 0) return false;

        // Only loose (unequipped) items can be swept away — worn/wielded gear stays put.
        const looseItems = other.isItemEquipped
            ? other.inventory.filter(i => !other.isItemEquipped(i))
            : other.inventory;
        if (looseItems.length === 0) return false;
        if (ROT.RNG.getUniform() >= dropChance) return false;

        const item = randomElement(looseItems);

        const validPositions = [];
        for (const dir of CARDINAL_DIRS) {
            const newX = other.x + dir.dx;
            const newY = other.y + dir.dy;
            if (newX < 0 || newX >= actor.engine.mapManager.width ||
                newY < 0 || newY >= actor.engine.mapManager.height) continue;
            const tile = actor.engine.mapManager.floorMap[newY]?.[newX];
            if (!tile || !tile.tileId) continue;
            if (entityManager._getSolidActorAt(newX, newY)) continue;
            validPositions.push({x: newX, y: newY});
        }

        let dropX = other.x;
        let dropY = other.y;
        if (validPositions.length > 0) {
            const dropPos = randomElement(validPositions);
            dropX = dropPos.x;
            dropY = dropPos.y;
        }

        const itemIndex = other.inventory.indexOf(item);
        other.inventory.splice(itemIndex, 1);

        item.x = dropX;
        item.y = dropY;
        entityManager.addEntity(item);
        actor.engine.renderer?.updateItemZIndex(item);

        if (other.hasAttribute('controlled')) {
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            actor.engine.inputManager?.showMessage(`The current sweeps the ${displayName} from your grasp!`);
        }

        return true;
    },

    drift_ground_items: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const driftChance = data.item_drift_chance ?? 0.3;
        let actionTaken = false;

        const itemsHere = entityManager.items.filter(
            item => item.x === actor.x && item.y === actor.y
        );

        for (const item of itemsHere) {
            if (ROT.RNG.getUniform() >= driftChance) continue;

            const validPositions = [];
            for (const dir of CARDINAL_DIRS) {
                const newX = actor.x + dir.dx;
                const newY = actor.y + dir.dy;
                if (newX < 0 || newX >= actor.engine.mapManager.width ||
                    newY < 0 || newY >= actor.engine.mapManager.height) continue;
                const tile = actor.engine.mapManager.floorMap[newY]?.[newX];
                if (!tile || !tile.tileId) continue;
                if (entityManager._getSolidActorAt(newX, newY)) continue;
                validPositions.push({x: newX, y: newY});
            }

            if (validPositions.length > 0) {
                const newPos = randomElement(validPositions);
                item.x = newPos.x;
                item.y = newPos.y;
                item.updateSpritePosition();
                actor.engine.renderer?.updateItemZIndex(item);
                actionTaken = true;
            }
        }

        return actionTaken;
    },

    /**
     * Drain suction behavior - pulls items on liquid tiles toward the drain
     *
     * Items within range that are floating on liquid actors are pulled toward the drain.
     * Items at distance 1 are sucked down and deleted.
     * Items at distance 2+ move one step closer.
     *
     * Data parameters:
     * - suction_range: Maximum distance to affect items (default: 2)
     */
    drain_suction: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const drainX = actor.x;
        const drainY = actor.y;

        // Find items within range (default 2 tiles)
        const range = data.suction_range ?? 2;

        // Iterate over a copy since we may remove items
        const itemsCopy = [...entityManager.items];

        for (const item of itemsCopy) {
            if (item.isDead) continue;

            // Calculate Chebyshev distance
            const dx = item.x - drainX;
            const dy = item.y - drainY;
            const distance = Math.max(Math.abs(dx), Math.abs(dy));

            if (distance === 0 || distance > range) continue;

            // Check if item is on a liquid tile
            const liquidActor = entityManager.getActorsAt(item.x, item.y)
                .find(a => a.hasAttribute('liquid'));
            if (!liquidActor) continue;

            if (distance === 1) {
                // Item is adjacent - suck it down the drain
                const itemName = item.getDisplayName ? item.getDisplayName() : item.name;
                actor.engine.inputManager?.showMessage(`The ${itemName} is sucked down the drain!`, { x: actor.x, y: actor.y });
                entityManager.removeEntity(item);
            } else {
                // Item is further away - move it one step toward drain
                const stepX = dx === 0 ? 0 : (dx > 0 ? -1 : 1);
                const stepY = dy === 0 ? 0 : (dy > 0 ? -1 : 1);

                const newX = item.x + stepX;
                const newY = item.y + stepY;

                // Only move if target tile has liquid
                const targetLiquid = entityManager.getActorsAt(newX, newY)
                    .find(a => a.hasAttribute('liquid'));
                if (targetLiquid) {
                    item.x = newX;
                    item.y = newY;
                    item.updateSpritePosition();
                    actor.engine.renderer?.updateItemZIndex(item);
                }
            }
        }

        return false; // Allow other behaviors to run
    },

    cellular_automaton_step: (actor, data) => {
        const cellType = data.cell_type || 'gol_cell';
        const entityManager = actor.engine.entityManager;
        const mapManager = actor.engine.mapManager;

        // Build Set of alive cell positions for O(1) lookup
        const aliveCells = new Set();
        const cellActors = [];

        for (const a of entityManager.actors) {
            if (a.isDead || a.type !== cellType) continue;
            aliveCells.add(`${a.x},${a.y}`);
            cellActors.push(a);
        }

        const countNeighbors = (x, y) => {
            let count = 0;
            for (const dir of ALL_DIRS) {
                if (aliveCells.has(`${x + dir.dx},${y + dir.dy}`)) count++;
            }
            return count;
        };

        const surviveMin = data.survive_min ?? 2;
        const surviveMax = data.survive_max ?? 3;
        const birthCount = data.birth_count ?? 3;

        // Phase 1: Find cells that should die (outside survival range)
        const cellsToDie = [];
        for (const cell of cellActors) {
            const n = countNeighbors(cell.x, cell.y);
            if (n < surviveMin || n > surviveMax) cellsToDie.push(cell);
        }

        // Phase 2: Find empty tiles that should birth (exactly 3 neighbors)
        const birthCandidates = new Set();
        for (const cell of cellActors) {
            for (const dir of ALL_DIRS) {
                const key = `${cell.x + dir.dx},${cell.y + dir.dy}`;
                if (!aliveCells.has(key)) birthCandidates.add(key);
            }
        }

        const cellsToBirth = [];
        for (const key of birthCandidates) {
            const [x, y] = key.split(',').map(Number);
            if (x < 0 || x >= mapManager.width || y < 0 || y >= mapManager.height) continue;
            const floorTile = mapManager.floorMap?.[y]?.[x];
            if (!floorTile || floorTile.tileId <= 0) continue;
            if (countNeighbors(x, y) === birthCount) cellsToBirth.push({x, y});
        }

        // Phase 3: Apply all changes simultaneously
        for (const cell of cellsToDie) {
            entityManager.removeEntity(cell);
        }
        for (const pos of cellsToBirth) {
            entityManager.spawnActor(cellType, pos.x, pos.y);
        }

        return true;
    },

    /**
     * Fire spreading behavior - spreads to adjacent flammable actors/items
     * Uses actor's spread_chance from actor data
     */
    fire_spread: (actor, data) => {
        const spreadChance = data.spread_chance ?? actor.data?.spread_chance ?? 0.3;
        const spawnType = data?.spawn_type || actor.type;
        const fireLifetime = data.fire_lifetime;
        const entityManager = actor.engine.entityManager;
        const mapManager = actor.engine.mapManager;

        for (const dir of CARDINAL_DIRS) {
            const targetX = actor.x + dir.dx;
            const targetY = actor.y + dir.dy;

            // Check bounds
            if (targetX < 0 || targetX >= mapManager.width) continue;
            if (targetY < 0 || targetY >= mapManager.height) continue;
            const floorTile = mapManager.floorMap?.[targetY]?.[targetX];
            const hasFloor = floorTile && floorTile.tileId > 0;
            // Allow spreading to platform actors over voids
            if (!hasFloor) {
                const bridgeActor = entityManager.getActorsAt(targetX, targetY)
                    .find(a => a.hasAttribute('platform') && a.hasAttribute('flammable'));
                if (!bridgeActor) continue;
            }

            const actorsAtTarget = entityManager.getActorsAt(targetX, targetY);

            if (actorsAtTarget.find(a => a.type === actor.type)) continue;

            const targetEntity = entityManager.entities.find(
                e => e.x === targetX && e.y === targetY && !e.isDead &&
                     !(e instanceof Actor) && !(e instanceof Item)
            );
            if (targetEntity && targetEntity.hasAttribute('flammable')) {
                targetEntity.die();
                const newFire = entityManager.spawnActor(spawnType, targetX, targetY);
                if (newFire) newFire.fireLifetime = fireLifetime ?? newFire.lifetime ?? 5;
                continue;
            }

            // Healthless flammable actors (gas, terrain props) catch deterministically,
            // like flammable entities — so fire chains through a whole gas cloud like a
            // fuse rather than crawling one tile per lucky roll. Living creatures/player
            // (health stat) stay behind the spread_chance gate below.
            const volatileActor = actorsAtTarget.find(
                a => a.type !== actor.type && a.hasAttribute('flammable') &&
                     !a.isDead && a.stats?.health === undefined && !a.hasAttribute('fireproof')
            );
            if (volatileActor) {
                const newFire = entityManager.spawnActor(spawnType, targetX, targetY);
                if (newFire) newFire.fireLifetime = fireLifetime ?? newFire.lifetime ?? 5;
                continue;
            }

            if (ROT.RNG.getUniform() > spreadChance) continue;

            const targetActor = actorsAtTarget.find(a => a.type !== actor.type);
            if (targetActor && targetActor.hasAttribute('flammable')) {
                const newFire = entityManager.spawnActor(spawnType, targetX, targetY);
                if (newFire) newFire.fireLifetime = fireLifetime ?? newFire.lifetime ?? 5;
                continue;
            }

            // Check for flammable items at target position
            const targetItem = entityManager.items.find(
                i => i.x === targetX && i.y === targetY && !i.isDead
            );
            if (targetItem && targetItem.hasAttribute('flammable')) {
                if (targetItem.hasAttribute('explosive')) {
                    const displayName = targetItem.getDisplayName ? targetItem.getDisplayName() : targetItem.name;
                    actor.engine.inputManager?.showMessage(`The ${displayName} explodes!`, { x: targetX, y: targetY });
                    actor.engine.interfaceManager?.createExplosiveCloud(targetItem, targetX, targetY);
                }
                targetItem.die();
                const newFire = entityManager.spawnActor(spawnType, targetX, targetY);
                if (newFire) newFire.fireLifetime = fireLifetime ?? newFire.lifetime ?? 5;
            }
        }

        return false;
    },

    /**
     * Fire burn out behavior - counts down lifetime and removes fire when expired
     * Also damages entities standing in the fire
     */
    fire_burn_out: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const damagePerTurn = data.damage_per_turn ?? actor.data?.damage_per_turn ?? 10;
        const burnState = data.burn_state ?? 'burning';

        // Fire cannot survive on void tiles (no floor) unless on a platform
        if (!actor.hasFloorAt(actor.x, actor.y) && !actor.hasPlatformAt(actor.x, actor.y)) {
            actor.die();
            return true;
        }

        // Initialize lifetime from actor data if not set
        if (actor.fireLifetime === undefined) {
            actor.fireLifetime = actor.lifetime || 5;
        }

        // Damage any actor standing in the fire (except fire-immune or flying actors)
        const victim = entityManager.getActorsAt(actor.x, actor.y)
            .find(a => a !== actor && a.hasAttribute('flammable') && !a.hasAttribute('fireproof') && !a.hasStateProperty('flying'));

        if (victim) {
            const statesData = actor.engine.globalStates;
            const canIgnite = !actor._isAttachedFire && victim.applyState && !victim.hasState(burnState);
            if (canIgnite && statesData?.[burnState]) {
                victim.applyState(burnState, statesData[burnState]);
            }

            // Victims that can't hold the burning state (no health, or immune to it) still take
            // direct contact damage, so terrain and fireproof-but-damageable actors
            // burn as before rather than becoming silently immune.
            if (!victim.hasState(burnState) && damagePerTurn > 0 && victim.stats?.health) {
                const burned = victim.takeFireDamageOncePerTurn(damagePerTurn);
                if (burned && victim.hasAttribute('visible')) {
                    actor.engine.inputManager?.showMessage(`The fire burns ${victim.getNameWithArticle()} for ${damagePerTurn} damage!`, { x: actor.x, y: actor.y });
                }
            }
        }

        // Consume co-located healthless flammables (gas drifting onto us, trail entities
        // laid under us, terrain) into fire. Its own filter spares creatures/the player,
        // which are handled by the damage-over-time + burning path above instead.
        entityManager.consumeFlammableAt(actor, actor.x, actor.y, actor.type, actor.fireLifetime);

        // Countdown and burn out
        actor.fireLifetime--;

        if (actor.fireLifetime <= 0) {
            actor.die();
            return true;
        }

        return false;
    },

    /**
     * Fire smoke behavior - cellular automata rule: a fire tile surrounded by
     * enough other fire gives off smoke (a cloud origin that spreads and disperses)
     *
     * Data parameters:
     * - smoke_type: The cloud actor type to spawn (default: "smoke")
     * - smoke_threshold: Minimum neighboring fire tiles required (default: 3)
     * - smoke_chance: Probability of emitting each turn when conditions met (default: 0.25)
     * - smoke_cap: Maximum smoke origins alive at once (default: 20)
     * - smoke_lifetime: Lifetime of the spawned smoke cloud (default: 8)
     * - check_cardinal: If true, only check 4 cardinal directions; if false, check all 8 (default: false)
     */
    fire_smoke: (actor, data) => {
        // Fire attached to a burning creature doesn't count as a blaze
        if (actor._isAttachedFire) return false;

        const smokeType = data.smoke_type || 'smoke';
        const threshold = data.smoke_threshold ?? 3;
        const smokeChance = data.smoke_chance ?? 0.25;
        const smokeCap = data.smoke_cap ?? 20;
        const directions = data.check_cardinal ? CARDINAL_DIRS : ALL_DIRS;

        const entityManager = actor.engine.entityManager;
        const counterKey = '_' + smokeType + 'Count';
        if (!entityManager[counterKey]) entityManager[counterKey] = 0;
        if (entityManager[counterKey] >= smokeCap) return false;

        let fireNeighbors = 0;
        for (const dir of directions) {
            const hasFire = entityManager.getActorsAt(actor.x + dir.dx, actor.y + dir.dy)
                .some(a => a.personality?.name === 'Fire' && !a.isDead);
            if (hasFire) fireNeighbors++;
        }

        if (fireNeighbors < threshold) return false;
        if (ROT.RNG.getUniform() >= smokeChance) return false;

        for (const a of entityManager.getActorsAt(actor.x, actor.y)) {
            if (a.personality?.name === 'Cloud') return false;
        }

        const smoke = entityManager.spawnActor(smokeType, actor.x, actor.y);
        if (smoke) {
            smoke.isCloudOrigin = true;
            smoke.cloudOriginX = actor.x;
            smoke.cloudOriginY = actor.y;
            smoke.cloudLifetime = data.smoke_lifetime ?? smoke.lifetime ?? 8;
            smoke._emitCounterKey = counterKey;
            entityManager[counterKey]++;
        }

        return false;
    },
};
