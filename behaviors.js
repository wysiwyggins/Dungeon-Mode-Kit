// ============================================================================
// PERSONALITY SYSTEM
// ============================================================================

class Personality {
    constructor(data, actor) {
        this.name = data.name || 'default';
        this.controlled = data.controlled || false;
        this.hostile = data.hostile || false;
        this.behaviors = data.behaviors || [];
        this.data = data;
        this.actor = actor;
    }

    execute(actor) {
        // Confusion overrides normal AI — move randomly instead
        if (actor.hasStateProperty('random_movement')) {
            BehaviorLibrary.random_walk(actor);
            return;
        }

        // Execute behaviors in order
        for (const behaviorName of this.behaviors) {
            const behavior = BehaviorLibrary[behaviorName];
            if (behavior && behavior(actor, this.data)) {
                break; // Behavior succeeded, stop processing
            }
        }
    }
}

// Behavior Library - Common AI routines
const BehaviorLibrary = {
    /**
     * Attack an adjacent hostile target (player or enemy faction)
     * Returns true if an attack was made
     */
    attack_adjacent: (actor) => {
        // Check all adjacent tiles (8-directional)
        for (const dir of ALL_DIRS) {
            const targetX = actor.x + dir.dx;
            const targetY = actor.y + dir.dy;
            const target = actor.engine.entityManager.getActorAt(targetX, targetY);

            // Check if target is valid - only attack controlled actors (players, allies)
            if (!target || target.isDead || !target.hasAttribute('controlled')) continue;

            // Use unified collision effects system (handles damage, sounds, flash, etc.)
            // An attack attempt (even a miss) consumes the turn
            actor.applyCollisionEffects(target);
            return true; // Attack was attempted (hit or miss)
        }

        return false; // No valid target found
    },

    patrol: (actor, data) => {
        if (actor._homeX === undefined) {
            actor._homeX = actor.x;
            actor._homeY = actor.y;
        }

        if (actor._alerted) return false;

        const target = actor.engine.entityManager.findNearestPlayer(actor);
        if (target && actor.canSeeTarget(target)) return false;

        const patrolRange = data.patrol_range || 5;
        const distFromHome = getChebyshevDistance(actor.x, actor.y, actor._homeX, actor._homeY);

        if (distFromHome >= patrolRange) {
            return actor.moveToward(actor._homeX, actor._homeY);
        }

        if (!actor._patrolSteps || actor._patrolSteps <= 0) {
            const dirs = actor.getValidMoveDirections();
            if (dirs.length === 0) return false;
            actor._patrolDir = dirs[Math.floor(ROT.RNG.getUniform() * dirs.length)];
            actor._patrolSteps = 2 + Math.floor(ROT.RNG.getUniform() * 3);
        }

        const nextX = actor.x + actor._patrolDir.dx;
        const nextY = actor.y + actor._patrolDir.dy;
        const nextDist = getChebyshevDistance(nextX, nextY, actor._homeX, actor._homeY);

        if (nextDist > patrolRange) {
            actor._patrolSteps = 0;
            return actor.moveToward(actor._homeX, actor._homeY);
        }

        const result = actor.tryMove(nextX, nextY);
        if (result.moved || result.actionTaken) {
            actor._patrolSteps--;
            return true;
        }

        actor._patrolSteps = 0;
        const dirs = actor.getValidMoveDirections();
        if (dirs.length === 0) return false;
        const dir = dirs[Math.floor(ROT.RNG.getUniform() * dirs.length)];
        const fallback = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
        return fallback.moved || fallback.actionTaken;
    },

    guard_area: (actor, data) => {
        if (actor._homeX === undefined) {
            actor._homeX = actor.x;
            actor._homeY = actor.y;
        }

        const target = actor.engine.entityManager.findNearestPlayer(actor);
        if (!target || !actor.canSeeTarget(target)) return false;

        actor._lastKnownTargetX = target.x;
        actor._lastKnownTargetY = target.y;
        actor._alertTarget = target;
        actor._alerted = true;
        actor._alertTurns = data.memory_duration || 10;

        if (data.alert_allies) {
            const alertRadius = 10;
            for (const other of actor.engine.entityManager.actors) {
                if (other === actor || other.isDead || other._alerted) continue;
                if (!other.personality?.data?.alert_allies) continue;
                if (getChebyshevDistance(actor.x, actor.y, other.x, other.y) > alertRadius) continue;
                other._alerted = true;
                other._alertTarget = target;
                other._alertTurns = other.personality.data.memory_duration || 10;
                other._lastKnownTargetX = target.x;
                other._lastKnownTargetY = target.y;
            }
        }

        return actor.moveToward(target.x, target.y);
    },

    pursue_intruders: (actor, data) => {
        if (!actor._alerted) return false;

        if (actor._alertTarget?.isDead) {
            actor._alerted = false;
            actor._alertTarget = null;
            actor._alertTurns = 0;
            return false;
        }

        if (actor._alertTarget && actor.canSeeTarget(actor._alertTarget)) {
            actor._lastKnownTargetX = actor._alertTarget.x;
            actor._lastKnownTargetY = actor._alertTarget.y;
            actor._alertTurns = data.memory_duration || 10;
            return actor.moveToward(actor._alertTarget.x, actor._alertTarget.y);
        }

        if (actor._alertTurns > 0 && actor._lastKnownTargetX !== undefined) {
            actor._alertTurns--;

            if (actor.x === actor._lastKnownTargetX && actor.y === actor._lastKnownTargetY) {
                actor._alerted = false;
                actor._alertTarget = null;
                actor._alertTurns = 0;
                return false;
            }

            return actor.moveToward(actor._lastKnownTargetX, actor._lastKnownTargetY);
        }

        actor._alerted = false;
        actor._alertTarget = null;
        actor._alertTurns = 0;
        return false;
    },

    /**
     * Pursue a visible target using A* pathfinding
     */
    pursue_target: (actor, data) => {
        // Find and move toward target
        const target = actor.engine.entityManager.findNearestPlayer(actor);
        if (target && actor.canSeeTarget(target)) {
            return actor.moveToward(target.x, target.y);
        }
        return false;
    },

    /**
     * Follow thread trail entities toward the player.
     * Gated on the actor having a 'follows_thread' attribute.
     * The monster detects thread_trail entities at its position or adjacent tiles,
     * then walks along the trail toward the player (higher index in positions array).
     */
    follow_thread: (actor, data) => {
        if (!actor.hasAttribute('follows_thread')) return false;

        const em = actor.engine.entityManager;

        // Find trail data from any controlled actor's inventory
        let trailData = null;
        for (const a of em.actors) {
            if (!a.hasAttribute('controlled') || a.isDead) continue;
            for (const item of a.inventory) {
                if (item._trailData && item._trailData.positions.length > 0) {
                    trailData = item._trailData;
                    break;
                }
            }
            if (trailData) break;
        }
        if (!trailData) return false;

        // Find the trail segment closest to the actor (at current pos or adjacent)
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < trailData.positions.length; i++) {
            const seg = trailData.positions[i];
            const dist = Math.abs(seg.x - actor.x) + Math.abs(seg.y - actor.y);
            if (dist <= 1 && dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }

        // If not adjacent to trail, check if any segment is within vision range
        // and pathfind toward the nearest visible one
        if (bestIdx < 0) {
            const visionRange = actor.getAttribute('vision_range') || 10;
            let nearestVisibleIdx = -1;
            let nearestVisibleDist = Infinity;
            for (let i = 0; i < trailData.positions.length; i++) {
                const seg = trailData.positions[i];
                const dist = Math.abs(seg.x - actor.x) + Math.abs(seg.y - actor.y);
                if (dist <= visionRange && dist < nearestVisibleDist) {
                    // Check line of sight — walls block thread awareness
                    const canSee = hasLineOfSight(actor.x, actor.y, seg.x, seg.y, (x, y) => {
                        if (!actor.hasFloorAt(x, y)) return true;
                        const actorAt = actor.engine.entityManager.getSolidActorAt(x, y);
                        return actorAt && actorAt !== actor;
                    });
                    if (canSee) {
                        nearestVisibleDist = dist;
                        nearestVisibleIdx = i;
                    }
                }
            }
            if (nearestVisibleIdx < 0) return false;
            const seg = trailData.positions[nearestVisibleIdx];
            return actor.moveToward(seg.x, seg.y);
        }

        // Move toward the player end of the trail (higher index)
        // If we're at the last segment, move toward the trail owner
        let targetX, targetY;
        if (bestIdx < trailData.positions.length - 1) {
            const next = trailData.positions[bestIdx + 1];
            targetX = next.x;
            targetY = next.y;
        } else {
            // At end of trail — head toward the trail owner
            const owner = em.actors.find(a => a.id === trailData.ownerId && !a.isDead);
            if (owner) {
                targetX = owner.x;
                targetY = owner.y;
            } else {
                return false;
            }
        }

        const result = actor.tryMove(targetX, targetY);
        return result.moved || result.actionTaken;
    },

    /**
     * Random wandering movement
     */
    random_walk: (actor) => {
        // Sighted actors only consider valid moves (avoids pits, walls, etc.)
        if (actor.hasAttribute('sighted')) {
            const validDirs = actor.getValidMoveDirections();
            if (validDirs.length === 0) {
                return false; // No valid moves available
            }
            const dir = randomElement(validDirs);
            const result = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
            return result.moved || result.actionTaken;
        }

        // Non-sighted actors pick randomly (may fall into pits)
        const dir = randomElement(CARDINAL_DIRS);
        const result = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
        return result.moved || result.actionTaken;
    },

    /**
     * Flee from danger - triggers when standing in harmful tile, hit by thrown item, or low health
     * @param {Actor} actor - The actor executing the behavior
     * @param {Object} data - Behavior parameters
     * @param {number} [data.health_threshold=0.25] - Flee when health drops below this percentage
     */
    flee_from_danger: (actor, data) => {
        const healthThreshold = data.health_threshold || 0.25;
        const entityManager = actor.engine.entityManager;

        // Helper to check if an actor is harmful (causes damage or negative effects)
        const isHarmfulActor = (other) => {
            // Check explicit damage attributes
            if (other.hasAttribute('damage_type') ||
                other.damage_per_turn > 0) {
                return true;
            }
            // Check collision_effect for negative health effects
            const collisionEffect = other.getAttribute('collision_effect');
            if (collisionEffect && typeof collisionEffect === 'object') {
                if (collisionEffect.health !== undefined && collisionEffect.health < 0) {
                    return true;
                }
            }
            return false;
        };

        // Check trigger conditions
        let shouldFlee = false;

        // Condition 1: Was hit by a thrown item this turn
        if (actor.wasHitThisTurn) {
            shouldFlee = true;
            actor.wasHitThisTurn = false; // Clear the flag
        }

        // Condition 2: Standing in a harmful non-solid actor
        if (!shouldFlee) {
            const actorsHere = entityManager.getActorsAt(actor.x, actor.y);
            for (const other of actorsHere) {
                if (other === actor || other.hasAttribute('solid')) continue;
                if (isHarmfulActor(other)) {
                    shouldFlee = true;
                    break;
                }
            }
        }

        // Condition 3: Health below threshold
        if (!shouldFlee && actor.stats?.health) {
            const health = actor.stats.health;
            const currentHealth = typeof health === 'object' ? health.current : health;
            const maxHealth = typeof health === 'object' ? health.max : health;
            if (maxHealth > 0 && currentHealth / maxHealth < healthThreshold) {
                shouldFlee = true;
            }
        }

        if (!shouldFlee) return false;

        // Find a safe adjacent tile to flee to
        const directions = shuffleArray([...ALL_DIRS]);

        // Helper to check if a tile is safe (no harmful actors)
        const isTileSafe = (x, y) => {
            for (const a of entityManager.getActorsAt(x, y)) {
                if (!a.hasAttribute('solid') && isHarmfulActor(a)) return false;
            }
            return true;
        };

        // Try each direction, preferring safe tiles
        for (const dir of directions) {
            const newX = actor.x + dir.dx;
            const newY = actor.y + dir.dy;

            if (isTileSafe(newX, newY)) {
                const result = actor.tryMove(newX, newY);
                if (result.moved || result.actionTaken) return true;
            }
        }

        // If no safe tiles, try any movement to escape
        for (const dir of directions) {
            const result = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
            if (result.moved || result.actionTaken) return true;
        }

        return false;
    },

    /**
     * Defend self - attack back if recently attacked by another actor
     * Sets _lastAttacker when damaged, clears after retaliation
     */
    defend_self: (actor) => {
        const attacker = actor._lastAttacker;
        if (!attacker || attacker.isDead) {
            actor._lastAttacker = null;
            return false;
        }

        // Check if attacker is adjacent
        const dx = Math.abs(actor.x - attacker.x);
        const dy = Math.abs(actor.y - attacker.y);
        if (dx > 1 || dy > 1) {
            // Attacker not adjacent, try to move toward them
            return actor.moveToward(attacker.x, attacker.y);
        }

        // Attack the attacker - an attack attempt (even a miss) consumes the turn
        actor.applyCollisionEffects(attacker);
        return true; // Attack was attempted
    },

    /**
     * Mine a nearby breakable wall using equipped mining tool
     */
    mine_nearby_wall: (actor) => {
        // Check if actor has a mining tool equipped
        const equippedWeapon = actor.getEquippedWeapon?.();
        if (!equippedWeapon || !equippedWeapon.hasAttribute('mining')) {
            return false;
        }

        // Check all adjacent tiles for breakable walls
        const directions = shuffleArray([...CARDINAL_DIRS]);

        for (const dir of directions) {
            const targetX = actor.x + dir.dx;
            const targetY = actor.y + dir.dy;
            const target = actor.engine.entityManager.getActorAt(targetX, targetY);

            if (target && !target.isDead && target.hasAttribute('breakable') && target.hasAttribute('lode')) {
                // Mine the wall using collision effects (which handles mining damage)
                const result = actor.applyCollisionEffects(target);
                if (result.effectApplied) {
                    return true;
                }
            }
        }

        return false;
    },

    /**
     * Wander toward the nearest breakable wall to mine
     */
    wander_to_wall: (actor) => {
        const entityManager = actor.engine.entityManager;
        const visionRange = actor.getAttribute('vision_range') || 10;

        // Find nearest breakable wall within vision range
        let nearestWall = null;
        let nearestDist = Infinity;

        for (const other of entityManager.actors) {
            if (other.isDead || !other.hasAttribute('breakable') || !other.hasAttribute('lode')) continue;

            const dist = Math.abs(other.x - actor.x) + Math.abs(other.y - actor.y);
            if (dist <= visionRange && dist < nearestDist) {
                nearestWall = other;
                nearestDist = dist;
            }
        }

        if (nearestWall) {
            return actor.moveToward(nearestWall.x, nearestWall.y);
        }

        return false;
    },

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

            console.log(`${actor.name} incinerates ${other.name}!`);

            // Show incineration message for visible actors
            if (other.hasAttribute('visible')) {
                const otherName = other.getNameWithArticle();
                actor.engine.inputManager?.showMessage(`The ${actor.name} incinerates ${otherName}!`);
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
                actor.engine.inputManager?.showMessage(`The ${actor.name} incinerates ${article} ${displayName}!`);
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
            actor.cloudLifetime = actor.lifetime || 10;
        }

        // Spread to tiles at the current distance from origin
        for (const dir of ALL_DIRS) {
            const targetX = actor.cloudOriginX + dir.dx * actor.currentSpreadDistance;
            const targetY = actor.cloudOriginY + dir.dy * actor.currentSpreadDistance;

            // Check if tile is valid (has floor, not a wall)
            const floorTile = actor.engine.mapManager?.floorMap[targetY]?.[targetX];
            if (!floorTile || floorTile.tileId <= 0) continue;

            const cloudSpawnType = data.spawn_type || actor.type;
            const existingCloud = entityManager.getActorsAt(targetX, targetY)
                .find(a => a.type === cloudSpawnType);
            if (existingCloud) continue;

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
                            if (other.type === 'cloud' || other.type === 'mist' || other.type === 'sewer_gas') continue;
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
     * Apply cloud's collision effect and/or state to any actors standing in it
     * Shows a message describing the effect for visible actors
     */
    cloud_affect_actors: (actor) => {
        const collisionEffect = actor.getAttribute('collision_effect');
        const applyStateName = actor.getAttribute('apply_state');

        // Skip if no effects to apply
        const hasCollisionEffect = collisionEffect && Object.keys(collisionEffect).length > 0;
        if (!hasCollisionEffect && !applyStateName) return false;

        const entityManager = actor.engine.entityManager;

        // Check if this tile is visible (or darkness is disabled)
        const tileIsVisible = actor.engine.isTileVisible(actor.x, actor.y);

        for (const other of entityManager.getActorsAt(actor.x, actor.y)) {
            if (other === actor) continue;
            if (other.type === 'cloud' || other.type === 'mist' || other.type === 'sewer_gas') continue;

            // Track effects applied for messaging
            const effectsApplied = [];

            // Apply collision effect (stat damage)
            if (hasCollisionEffect) {
                for (const [key, value] of Object.entries(collisionEffect)) {
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
                const gasName = actor.type === 'mist' ? 'mist' : 'clouds';

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

    /**
     * Countdown cloud lifetime and remove when expired
     */
    cloud_lifetime: (actor) => {
        // Initialize lifetime from actor data if not set
        if (actor.cloudLifetime === undefined) {
            actor.cloudLifetime = actor.lifetime || 5;
        }

        actor.cloudLifetime--;

        if (actor.cloudLifetime <= 0) {
            if (actor.isCloudOrigin && actor.engine.entityManager._sewerGasCount > 0) {
                actor.engine.entityManager._sewerGasCount--;
            }
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
            actor.cloudLifetime = actor.lifetime || 10;
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
            const remainingLifetime = actor.cloudLifetime;

            // Remove the cloud
            actor.die();

            // Spawn mist in its place
            const mist = entityManager.spawnActor(disperseTo, x, y);
            if (mist) {
                // Inherit properties from the cloud
                mist.tint = tint;
                mist.setAttribute('collision_effect', collisionEffect);
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
                if (a.type === 'mist' || a.type === 'cloud' || a.type === 'sewer_gas') {
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

        const directions = checkCardinal ? CARDINAL_DIRS : ALL_DIRS;

        const entityManager = actor.engine.entityManager;
        let matchingNeighbors = 0;

        for (const dir of directions) {
            const checkX = actor.x + dir.dx;
            const checkY = actor.y + dir.dy;

            // Find actors at this position that match the neighbor type
            const neighbor = entityManager._getLiquidActorAt(checkX, checkY);

            if (neighbor && (neighbor.type === neighborType || neighbor.type === transformTo)) {
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

        // Filter out neighbors with similar hue (e.g. sewage and deep_sewage)
        const actorHue = rgbToHue(actor.originalTint);
        const hueThreshold = 30;
        const distinctNeighbors = foreignNeighbors.filter(fn => {
            const fnHue = rgbToHue(fn.originalTint);
            let hueDiff = Math.abs(actorHue - fnHue);
            if (hueDiff > 180) hueDiff = 360 - hueDiff;
            return hueDiff > hueThreshold;
        });

        if (distinctNeighbors.length === 0) return false;

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

        // Convergence check: stop if already close enough
        const cur = extractRGB(actor.tint);
        const tgt = extractRGB(target);
        const diff = Math.abs(cur.r - tgt.r) + Math.abs(cur.g - tgt.g) + Math.abs(cur.b - tgt.b);
        if (diff <= 3) return false;

        // Incrementally shift current tint toward target
        const step = data.mix_step ?? 0.08;
        const newTint = lerpColor(actor.tint, target, step);
        actor.tint = newTint;

        // Apply directly to sprites (renderer only updates on lighting changes)
        if (actor.spriteBase) actor.spriteBase.tint = newTint;
        if (actor.spriteTop) actor.spriteTop.tint = newTint;

        return false;
    },

    /**
     * Deep water currents behavior - affects actors and items in the water
     *
     * For actors with inventory standing in this water:
     * - Random chance each turn to drop an item from inventory
     *
     * For items on the ground at this position:
     * - Random chance each turn to drift to an adjacent tile
     *
     * Data parameters:
     * - item_drop_chance: Probability (0-1) that an actor drops an item (default: 0.1)
     * - item_drift_chance: Probability (0-1) that a ground item drifts (default: 0.3)
     */
    deep_water_currents: (actor, data) => {
        const entityManager = actor.engine.entityManager;
        const dropChance = data.item_drop_chance ?? 0.1;
        const driftChance = data.item_drift_chance ?? 0.3;
        let actionTaken = false;

        // Find solid actor at this position (player, enemies, etc.)
        const other = entityManager._getSolidActorAt(actor.x, actor.y);
        if (other && other !== actor) {
            // Check if this actor has items in inventory
            if (other.inventory && other.inventory.length > 0) {
                if (ROT.RNG.getUniform() < dropChance) {
                    // Pick a random item to drop
                    const item = randomElement(other.inventory);

                    // Find an adjacent tile for the item to drift to
                    const validPositions = [];
                    for (const dir of CARDINAL_DIRS) {
                        const newX = other.x + dir.dx;
                        const newY = other.y + dir.dy;

                        // Check bounds
                        if (newX < 0 || newX >= actor.engine.mapManager.width ||
                            newY < 0 || newY >= actor.engine.mapManager.height) {
                            continue;
                        }

                        // Check for floor
                        const tile = actor.engine.mapManager.floorMap[newY]?.[newX];
                        if (!tile || !tile.tileId) continue;

                        // Check for solid actors blocking
                        if (entityManager._getSolidActorAt(newX, newY)) continue;

                        validPositions.push({x: newX, y: newY});
                    }

                    // If no valid adjacent position, drop at current position
                    let dropX = other.x;
                    let dropY = other.y;
                    if (validPositions.length > 0) {
                        const dropPos = randomElement(validPositions);
                        dropX = dropPos.x;
                        dropY = dropPos.y;
                    }

                    // Unequip if equipped
                    if (other.isItemEquipped && other.isItemEquipped(item)) {
                        other.unequipItem(item);
                    }

                    // Remove from inventory
                    const itemIndex = other.inventory.indexOf(item);
                    other.inventory.splice(itemIndex, 1);

                    // Place item at drop position
                    item.x = dropX;
                    item.y = dropY;
                    entityManager.addEntity(item);

                    // Update z-index so item floats above water if on deep water
                    actor.engine.renderer?.updateItemZIndex(item);

                    // Show message if player
                    if (other.hasAttribute('controlled')) {
                        const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                        actor.engine.inputManager?.showMessage(`The current sweeps the ${displayName} from your grasp!`);
                    }

                    console.log(`${actor.name} currents caused ${other.name} to drop ${item.name} at (${dropX}, ${dropY})`);
                    actionTaken = true;
                }
            }
        }

        // Find items on the ground at this position and potentially drift them
        const itemsHere = entityManager.items.filter(
            item => item.x === actor.x && item.y === actor.y
        );

        for (const item of itemsHere) {
            if (ROT.RNG.getUniform() < driftChance) {
                // Get valid adjacent positions (must have floor, no solid actors)
                const validPositions = [];
                for (const dir of CARDINAL_DIRS) {
                    const newX = actor.x + dir.dx;
                    const newY = actor.y + dir.dy;

                    // Check bounds
                    if (newX < 0 || newX >= actor.engine.mapManager.width ||
                        newY < 0 || newY >= actor.engine.mapManager.height) {
                        continue;
                    }

                    // Check for floor
                    const tile = actor.engine.mapManager.floorMap[newY]?.[newX];
                    if (!tile || !tile.tileId) continue;

                    // Check for solid actors blocking
                    if (entityManager._getSolidActorAt(newX, newY)) continue;

                    validPositions.push({x: newX, y: newY});
                }

                if (validPositions.length > 0) {
                    const newPos = randomElement(validPositions);
                    const oldX = item.x;
                    const oldY = item.y;
                    item.x = newPos.x;
                    item.y = newPos.y;

                    // Update sprite position and z-index
                    item.updateSpritePosition();
                    actor.engine.renderer?.updateItemZIndex(item);

                    console.log(`${item.name} drifted from (${oldX}, ${oldY}) to (${item.x}, ${item.y})`);
                    actionTaken = true;
                }
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
                actor.engine.inputManager?.showMessage(`The ${itemName} is sucked down the drain!`);
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

    /**
     * Conway's Game of Life cellular automaton step
     * Evaluates all cells simultaneously and applies Conway's rules:
     * - Live cell with 2-3 neighbors survives
     * - Dead cell with exactly 3 neighbors becomes alive
     * - All other live cells die
     *
     * Data parameters:
     * - cell_type: The actor type to look for/spawn as cells (default: "gol_cell")
     */
    game_of_life_step: (actor, data) => {
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
        const spreadChance = actor.data?.spread_chance ?? 0.3;
        const spawnType = data?.spawn_type || actor.type;
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
            // Allow spreading to bridge actors over voids
            if (!hasFloor) {
                const bridgeActor = entityManager.getActorsAt(targetX, targetY)
                    .find(a => a.hasAttribute('bridge') && a.hasAttribute('flammable'));
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
                if (newFire) newFire.fireLifetime = newFire.lifetime || 5;
                continue;
            }

            if (ROT.RNG.getUniform() > spreadChance) continue;

            const targetActor = actorsAtTarget.find(a => a.type !== actor.type);
            if (targetActor && targetActor.hasAttribute('flammable')) {
                const newFire = entityManager.spawnActor(spawnType, targetX, targetY);
                if (newFire) newFire.fireLifetime = newFire.lifetime || 5;
                continue;
            }

            // Check for flammable items at target position
            const targetItem = entityManager.items.find(
                i => i.x === targetX && i.y === targetY && !i.isDead
            );
            if (targetItem && targetItem.hasAttribute('flammable')) {
                if (targetItem.hasAttribute('explosive')) {
                    const displayName = targetItem.getDisplayName ? targetItem.getDisplayName() : targetItem.name;
                    actor.engine.inputManager?.showMessage(`The ${displayName} explodes!`);
                    actor.engine.interfaceManager?.createExplosiveCloud(targetItem, targetX, targetY);
                }
                targetItem.die();
                const newFire = entityManager.spawnActor(spawnType, targetX, targetY);
                if (newFire) newFire.fireLifetime = newFire.lifetime || 5;
            }
        }

        return false;
    },

    /**
     * Fire burn out behavior - counts down lifetime and removes fire when expired
     * Also damages entities standing in the fire
     */
    fire_burn_out: (actor) => {
        const entityManager = actor.engine.entityManager;
        const damagePerTurn = actor.data?.damage_per_turn ?? 10;

        // Fire cannot survive on void tiles (no floor)
        if (!actor.hasFloorAt(actor.x, actor.y)) {
            actor.die();
            return true;
        }

        // Initialize lifetime from actor data if not set
        if (actor.fireLifetime === undefined) {
            actor.fireLifetime = actor.lifetime || 5;
        }

        // Damage any actor standing in the fire (except fire-immune or flying actors)
        const victim = entityManager.getActorsAt(actor.x, actor.y)
            .find(a => a !== actor && !a.hasAttribute('fire_immune') && !a.hasStateProperty('flying'));

        if (victim && damagePerTurn > 0 && victim.stats?.health) {
            const oldHealth = victim.stats.health.current;
            victim.stats.health.current = Math.max(0, oldHealth - damagePerTurn);

            // Show damage message
            if (victim.hasAttribute('visible')) {
                actor.engine.inputManager?.showMessage(`The fire burns ${victim.name} for ${damagePerTurn} damage!`);
            }

            // Flash the victim
            victim.flash?.();

            // Check for death
            if (victim.stats.health.current <= 0) {
                victim.die();
            }
        }

        // Countdown and burn out
        actor.fireLifetime--;

        if (actor.fireLifetime <= 0) {
            actor.die();
            return true;
        }

        return false;
    },

    /**
     * Trap check trigger behavior - checks if an actor or item has stepped on the trap
     * Traps start invisible and become visible when triggered (Brogue-style)
     * Traps are re-triggerable but won't trigger again while same entity remains on tile
     */
    trap_check_trigger: (actor) => {
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

        // Make the trap visible (stays visible permanently)
        if (!actor.hasAttribute('visible')) {
            actor.setAttribute('visible', true);
            actor.engine.renderer?.createActorSprites(actor);
        }

        // Show trap message
        const trapMessage = actor.data?.trap_message || `A trap is sprung!`;
        actor.engine.inputManager?.showMessage(trapMessage);

        // Play trap sound
        actor.engine.playSound?.('tap2');

        // Spawn the trap effect - supports two formats:
        // 1. trap_effect: { center, radius, outer } - spell-like area effect (like fireball)
        // 2. trap_spawn: "actor_type" - simple single actor spawn
        const trapEffect = actor.data?.trap_effect;
        if (trapEffect) {
            // Spell-like area effect
            const { center, radius = 0, outer } = trapEffect;
            const x = actor.x;
            const y = actor.y;

            // Spawn center actor
            if (center) {
                entityManager.spawnActor(center, x, y);
            }

            // Spawn actors in radius
            if (radius > 0) {
                const outerType = outer || center;
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        if (dx === 0 && dy === 0) continue; // Skip center
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= radius) {
                            entityManager.spawnActor(outerType, x + dx, y + dy);
                        }
                    }
                }
            }
        } else {
            // Simple single actor spawn
            const spawnType = actor.data?.trap_spawn;
            if (spawnType) {
                const spawnedActor = entityManager.spawnActor(spawnType, actor.x, actor.y);
                if (spawnedActor) {
                    // Apply custom tint if specified
                    const trapTint = actor.data?.trap_spawn_tint;
                    if (trapTint) {
                        spawnedActor.tint = trapTint;
                        if (spawnedActor.spriteBase) spawnedActor.spriteBase.tint = PIXI.utils.string2hex(trapTint);
                        if (spawnedActor.spriteTop) spawnedActor.spriteTop.tint = PIXI.utils.string2hex(trapTint);
                    }

                    // Apply custom collision effect if specified (for clouds)
                    const trapCollisionEffect = actor.data?.trap_collision_effect;
                    if (trapCollisionEffect) {
                        spawnedActor.setAttribute('collision_effect', trapCollisionEffect);
                    }

                    // Apply state to apply if specified (for paralysis/confusion gas)
                    const trapApplyState = actor.data?.trap_apply_state;
                    if (trapApplyState) {
                        spawnedActor.setAttribute('apply_state', trapApplyState);

                        // Apply state immediately to the victim standing on the trap
                        const statesData = actor.engine.globalStates;
                        if (statesData?.[trapApplyState] && actorVictim.applyState) {
                            actorVictim.applyState(trapApplyState, statesData[trapApplyState]);
                        }
                    }

                    // Mark as origin cloud so it spreads
                    spawnedActor.isCloudOrigin = true;
                    spawnedActor.cloudOriginX = actor.x;
                    spawnedActor.cloudOriginY = actor.y;
                    spawnedActor.cloudLifetime = 8;
                }
            }
        }

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

        // Get ammunition from inventory (any item with collision_effect)
        const ammo = actor.inventory.find(item => item.getAttribute('collision_effect'));
        if (!ammo) {
            // No ammo - turret is empty
            return false;
        }

        // Remove ammo from inventory
        const ammoIndex = actor.inventory.indexOf(ammo);
        if (ammoIndex > -1) {
            actor.inventory.splice(ammoIndex, 1);
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
                actor.engine.inputManager?.showMessage(`${actorName} shoots ${targetName} with ${displayName}!`);

                // Play hit sound
                const collisionSound = ammo.getAttribute('collision_sound') || 'arrow_hit';
                actor.engine.playSound?.(collisionSound);
            } else {
                // Show miss message
                const displayName = ammo.getDisplayName ? ammo.getDisplayName() : ammo.name;
                const targetName = target.getNameWithArticle ? target.getNameWithArticle() : `the ${target.name}`;
                const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
                actor.engine.inputManager?.showMessage(`${actorName}'s ${displayName} misses ${targetName}!`);

                // Play miss sound
                actor.engine.playSound?.('arrow_miss');

                // Drop the ammo near the target (on a random adjacent floor tile)
                const adjacentTile = BehaviorLibrary._findAdjacentFloor(target.x, target.y, entityManager, actor.engine.mapManager);
                if (adjacentTile) {
                    ammo.x = adjacentTile.x;
                    ammo.y = adjacentTile.y;
                    entityManager.addEntity(ammo);
                }
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
            return actor.isPassableAt(x, y);
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

    emit_sewer_gas: (actor) => {
        if (actor.type !== 'sewage') return;
        if (ROT.RNG.getPercentage() > 3) return;

        const entityManager = actor.engine.entityManager;

        // Cap total active sewer gas clouds to prevent runaway spawning
        if (!entityManager._sewerGasCount) entityManager._sewerGasCount = 0;
        if (entityManager._sewerGasCount >= 12) return;

        // Don't emit if there's already a cloud here
        for (const a of entityManager.getActorsAt(actor.x, actor.y)) {
            if (a.personality?.name === 'Cloud') return;
        }

        const cloud = entityManager.spawnActor('sewer_gas', actor.x, actor.y);
        if (cloud) {
            cloud.isCloudOrigin = true;
            cloud.cloudOriginX = actor.x;
            cloud.cloudOriginY = actor.y;
            cloud.cloudLifetime = 6;
            entityManager._sewerGasCount++;
        }
    },

    /**
     * Steal an unequipped item from an adjacent player-controlled actor.
     * After stealing, sets _hasLoot flag so flee behaviors activate.
     */
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
            actor.engine.inputManager?.showMessage(`The ${actor.name} snatches your ${displayName}!`);
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
            if (!actor.hasFloorAt(nx, ny)) continue;
            const result = actor.tryMove(nx, ny);
            if (result.moved) return true;
        }

        return false;
    },

    // Backward-compat aliases for renamed chain behaviors
    scutigera_head_ai: (...args) => BehaviorLibrary.chain_head_ai(...args),
    scutigera_body_follow: (...args) => BehaviorLibrary.chain_body_follow(...args),
    scutigera_scatter: (...args) => BehaviorLibrary.chain_scatter(...args)
};
