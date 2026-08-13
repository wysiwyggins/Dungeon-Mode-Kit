// ============================================================================
// PERSONALITY SYSTEM
// ============================================================================

class Personality {
    constructor(data, actor) {
        this.name = data.name || 'default';
        this.controlled = data.controlled || false;
        this.hostile = data.hostile || false;
        // Faction tag (e.g. "goblin"). Actors sharing a faction are allies; an
        // actor with a faction treats everyone else — including the player, who
        // has none — as an enemy. null = no faction = legacy "attack only the
        // player" behavior. See Actor.isEnemyOf in engine.js.
        this.faction = data.faction || null;
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

            // Attack any adjacent enemy. For unfactioned actors isEnemyOf() means
            // "the player" (unchanged); for factioned actors (e.g. goblins) it also
            // means adjacent non-allies like other monsters.
            if (!target || target.isDead || !actor.isEnemyOf(target)) continue;

            // Only attack actual combatants (things with health). Otherwise a
            // factioned monster treats inert scenery — walls, doors, breakable
            // fixtures, all of which have no faction and no health — as an "enemy"
            // and would flail at an adjacent wall every turn, never moving.
            if (target.stats?.health === undefined) continue;

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
     * Ambush: lie in wait just inside a room, beside its entryway, and only
     * spring when the player comes into view. Keeps ambushers out of corridors
     * and off arbitrary wall corners (which have no tactical value).
     *
     * Falls through (returns false) whenever the actor should instead pursue:
     * the target is visible, or the actor is already alerted (e.g. was hit).
     * If not on an ambush spot, it walks toward the nearest one within
     * ambush_radius; if none exists, it falls through to normal pursuit/wander.
     */
    ambush: (actor, data) => {
        const em = actor.engine.entityManager;
        const target = em.findNearestPlayer(actor);

        // Player in view, or already provoked → pursue instead of waiting.
        if (target && actor.canSeeTarget(target)) return false;
        if (actor._alerted) return false;

        // Standing on a good ambush spot with no target in sight → hold as bait.
        if (em.isAmbushSpot(actor.x, actor.y)) return true; // turn consumed, no move

        // Otherwise seek the nearest ambush spot within range.
        const radius = data.ambush_radius ?? 6;
        let best = null;
        let bestDist = Infinity;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx === 0 && dy === 0) continue;
                const tx = actor.x + dx;
                const ty = actor.y + dy;
                const d = getChebyshevDistance(actor.x, actor.y, tx, ty);
                if (d > radius) continue;
                if (!em.isAmbushSpot(tx, ty)) continue;
                if (d < bestDist) {
                    bestDist = d;
                    best = { x: tx, y: ty };
                }
            }
        }
        if (best) return actor.moveToward(best.x, best.y);

        return false; // no ambush spot found → let pursuit/wander handle it
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
                        if (!actor.hasFloorAt(x, y) && !actor.hasPlatformAt(x, y)) return true;
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

    maintain_distance: (actor, data) => {
        const preferredDist = data.preferred_distance ?? 3;
        const target = actor.engine.entityManager.findNearestPlayer(actor);
        if (!target || !actor.canSeeTarget(target)) return false;

        const dist = getChebyshevDistance(actor.x, actor.y, target.x, target.y);

        if (dist < preferredDist) {
            const dx = actor.x - target.x;
            const dy = actor.y - target.y;
            const dirs = shuffleArray([...CARDINAL_DIRS]);
            dirs.sort((a, b) => {
                const distA = Math.abs(actor.x + a.dx - target.x) + Math.abs(actor.y + a.dy - target.y);
                const distB = Math.abs(actor.x + b.dx - target.x) + Math.abs(actor.y + b.dy - target.y);
                return distB - distA;
            });
            for (const dir of dirs) {
                const result = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
                if (result.moved) return true;
            }
            return false;
        }

        if (dist > preferredDist + 1) {
            return actor.moveToward(target.x, target.y);
        }

        return false;
    },

    avoid_crowding: (actor) => {
        const entityManager = actor.engine.entityManager;

        // Check if another actor of the same type shares this tile
        const colocated = entityManager.getActorsAt(actor.x, actor.y)
            .some(a => a !== actor && a.type === actor.type);
        if (!colocated) return false;

        // Score each direction by how many same-type actors are there (prefer 0)
        const dirs = shuffleArray([...ALL_DIRS]);
        let bestDir = null;
        let bestScore = Infinity;

        for (const dir of dirs) {
            const nx = actor.x + dir.dx;
            const ny = actor.y + dir.dy;
            if (!actor.hasFloorAt(nx, ny) && !actor.hasPlatformAt(nx, ny)) continue;
            if (entityManager.getSolidActorAt(nx, ny)) continue;
            const sameTypeCount = entityManager.getActorsAt(nx, ny)
                .filter(a => a.type === actor.type).length;
            if (sameTypeCount < bestScore) {
                bestScore = sameTypeCount;
                bestDir = dir;
                if (bestScore === 0) break;
            }
        }

        if (!bestDir) return false;
        const result = actor.tryMove(actor.x + bestDir.dx, actor.y + bestDir.dy);
        return result.moved;
    },

    /**
     * Cloud/mist specific anti-stacking. Unlike avoid_crowding (which jellies use
     * to scatter and which only moves same-type actors apart), this collapses any
     * gas sharing this tile down to a single actor with two density levels:
     * cloud (dense) absorbs everything; two+ mists concentrate into one cloud.
     * Delegates to EntityManager.resolveGasStacking so the spawn-time hook and the
     * per-turn pass share identical rules. Returns true (turn consumed) only if
     * this actor was merged away, so the now-dead actor stops running behaviors.
     */
    merge_clouds: (actor) => {
        const em = actor.engine.entityManager;
        if (em._gasDensity(actor) === 0) return false;
        // Only do work when something else is actually sharing the tile.
        const here = em.getActorsAt(actor.x, actor.y)
            .filter(a => a !== actor && !a.isDead && em._gasDensity(a) > 0);
        if (here.length === 0) return false;
        em.resolveGasStacking(actor.x, actor.y);
        return actor.isDead;
    },

    random_walk: (actor) => {
        const isConfused = actor.hasStateProperty('random_movement');

        // A sentient, non-confused actor watches where it's going: only consider
        // valid moves, so it won't wander off a cliff or into a wall.
        //
        // Gated on `sentient` rather than a separate `sighted` attribute. `sighted`
        // was read in this one place despite being documented as controlling AI
        // line-of-sight, and most creatures (rat, deer, jelly, wraith, ...) never
        // declared it — so they took the reckless branch below and walked into the
        // abyss. `sentient` is the attribute that already means "this thing has a
        // mind" (it gates states and telepathy too), and every random-walking
        // creature already sets it.
        if (actor.hasAttribute('sentient') && !isConfused) {
            const validDirs = actor.getValidMoveDirections();
            if (validDirs.length === 0) {
                return false;
            }
            const dir = randomElement(validDirs);
            const result = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
            return result.moved || result.actionTaken;
        }

        // Mindless or confused actors stumble: they may fall into pits or walk into
        // hazards. That's the intended behavior for a confused creature.
        const dir = randomElement(CARDINAL_DIRS);
        const result = actor.tryMove(actor.x + dir.dx, actor.y + dir.dy);
        return result.moved || result.actionTaken;
    },

    /**
     * Gate for aquatic actors (eels): if stranded out of liquid, the actor is
     * helpless — it consumes its turn doing nothing so no later behavior (attack,
     * pursue, wander) runs. Place this FIRST in an aquatic personality's behavior
     * list. Returns true to halt the chain when stranded, false to act normally
     * while in liquid. Pairs with the engine-level movement guards that keep the
     * actor from beaching itself in the first place, and the getEffectiveDefense
     * penalty that leaves it defenseless on dry land.
     * @param {Actor} actor - The actor executing the behavior
     */
    requires_liquid: (actor) => {
        return actor.isOutOfLiquid();
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

    heal_ally: (actor, data) => {
        const healAmount = data.heal_amount ?? 5;
        const healSound = data.heal_sound || 'tone5';
        const entityManager = actor.engine.entityManager;

        let mostWounded = null;
        let lowestRatio = 1;

        for (const dir of ALL_DIRS) {
            const other = entityManager.getSolidActorAt(actor.x + dir.dx, actor.y + dir.dy);
            if (!other || other === actor || other.isDead) continue;
            if (other.hasAttribute('controlled')) continue;
            if (!other.stats?.health) continue;

            const h = other.stats.health;
            const ratio = h.current / h.max;
            if (ratio < 1 && ratio < lowestRatio) {
                lowestRatio = ratio;
                mostWounded = other;
            }
        }

        if (!mostWounded) return false;

        const h = mostWounded.stats.health;
        h.current = Math.min(h.max, h.current + healAmount);
        actor.engine.playSound?.(healSound);

        const allyName = mostWounded.getNameWithArticle ? mostWounded.getNameWithArticle() : `the ${mostWounded.name}`;
        const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
        actor.engine.inputManager?.showMessage(`${actorName} heals ${allyName}.`, { x: actor.x, y: actor.y });

        return true;
    },

    seek_item: (actor, data) => {
        const searchRadius = data.search_radius ?? 10;
        const itemType = data.item_type;
        const entityManager = actor.engine.entityManager;
        const maxInventory = actor.getAttribute('inventory') || 1;
        if (actor.inventory.length >= maxInventory) return false;

        let nearest = null;
        let nearestDist = Infinity;

        for (const item of entityManager.items) {
            if (item.isDead) continue;
            if (itemType && item.type !== itemType) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, item.x, item.y);
            if (dist > searchRadius || dist >= nearestDist) continue;
            nearest = item;
            nearestDist = dist;
        }

        if (!nearest) return false;

        if (nearestDist <= 1) {
            actor.pickUpItem?.(nearest);
            return true;
        }

        return actor.moveToward(nearest.x, nearest.y);
    },

    /**
     * Auto-explore: head toward the nearest place this actor hasn't been yet
     * (or a nearby item), like a player pressing (x)plore. Used by the "hero"
     * personality to drive an actor through a level on its own. Shares the
     * engine-level computeExploreTarget core with the player's (x)plore action;
     * differs only in its notion of "explored": since a personality-driven actor
     * has no player fog-of-war, it keeps its OWN visited-tile memory on
     * actor._exploreVisited. Returns true if it moved toward a target, false if
     * there's nothing left to explore (so the chain falls through to random_walk).
     * @param {Actor} actor - The actor executing the behavior
     * @param {Object} data - Behavior parameters
     * @param {number} [data.explore_mark_radius=1] - How far around the actor to mark "visited" each turn
     */
    explore: (actor, data) => {
        const markRadius = data?.explore_mark_radius ?? 1;
        const engine = actor.engine;
        const em = engine.entityManager;

        // Per-actor visited memory (independent of any player fog-of-war).
        if (!actor._exploreVisited) actor._exploreVisited = new Set();
        // Frontier tiles we've given up on (unreachable / stuck) so we stop
        // re-picking them and oscillating.
        if (!actor._exploreGivenUp) actor._exploreGivenUp = new Set();
        const visited = actor._exploreVisited;
        const givenUp = actor._exploreGivenUp;
        for (let dy = -markRadius; dy <= markRadius; dy++) {
            for (let dx = -markRadius; dx <= markRadius; dx++) {
                visited.add(`${actor.x + dx},${actor.y + dy}`);
            }
        }

        // Stuck detector: if we haven't moved since last explore turn while
        // pursuing the same target, that target is unreachable in practice —
        // blacklist it and pick a different one this turn.
        const posKey = `${actor.x},${actor.y}`;
        if (actor._exploreLastPos === posKey && actor._exploreLastTarget) {
            givenUp.add(actor._exploreLastTarget);
        }

        const visionRange = actor.getAttribute('vision_range') || 10;
        const target = computeExploreTarget(engine, actor, {
            isExplored: (x, y) => visited.has(`${x},${y}`) || givenUp.has(`${x},${y}`),
            canSeeItem: (item) => getChebyshevDistance(actor.x, actor.y, item.x, item.y) <= visionRange
        });
        if (!target) {
            actor._exploreLastPos = posKey;
            actor._exploreLastTarget = null;
            return false;
        }

        actor._exploreLastPos = posKey;
        actor._exploreLastTarget = target.kind === 'frontier' ? `${target.x},${target.y}` : null;

        // Adjacent item → grab it, mirroring seek_item.
        if (target.kind === 'item' &&
            getChebyshevDistance(actor.x, actor.y, target.x, target.y) <= 1) {
            const item = em.getItemAt(target.x, target.y);
            if (item) { actor.pickUpItem?.(item); return true; }
        }

        // Find the next step toward the target using the explore-passable
        // predicate (which routes THROUGH pushable walls the actor can shove).
        // If that step lands on a pushable wall, step onto it so tryMove pushes it
        // aside; otherwise defer to moveToward's normal A*.
        const passable = buildExplorePassable(engine, actor);
        const hasFloor = (x, y) => actor.hasFloorAt(x, y) || actor.hasPlatformAt(x, y);
        const isCornerWall = (x, y) => !!em.getSolidActorAt(x, y);
        const step = getNextPathStep(actor.x, actor.y, target.x, target.y, passable,
            { hasFloor, isCornerBlocker: isCornerWall });

        if (step) {
            const solidAtStep = em.getSolidActorAt(step.x, step.y);
            if (solidAtStep && solidAtStep.hasAttribute('pushable')) {
                // tryMove onto a pushable wall performs the push (attack-on-bump
                // path handles it). If the push fails, fall through to moveToward.
                const result = actor.tryMove(step.x, step.y);
                if (result.moved || result.actionTaken) return true;
            }
        }

        return actor.moveToward(target.x, target.y);
    },

    /**
     * Hunt a specific quarry named by the actor's `hunts` attribute — an actor
     * TYPE to kill (e.g. "rat") or an item TYPE to collect (e.g. "meat"). The
     * actor pursues the nearest matching, visible quarry and moves onto it;
     * moving onto a hunted actor triggers the normal attack-on-bump (a kill over
     * repeated turns), and moving onto a hunted item picks it up. This is
     * independent of the faction/`isEnemyOf` system, so a hunter can chase quarry
     * it is not otherwise hostile to while a preceding `attack_adjacent` keeps its
     * normal enemies (e.g. the player). Returns true if it acted toward the
     * quarry, false if none is in sight (chain falls through to pursue/wander).
     *
     * Place AFTER attack_adjacent/defend_self (so it defends itself first) and
     * BEFORE pursue_target/random_walk (so hunting outranks idle wandering).
     * @param {Actor} actor - The actor executing the behavior
     */
    hunt: (actor) => {
        const quarry = actor.getAttribute('hunts');
        if (!quarry) return false;

        const em = actor.engine.entityManager;

        // 1) Hunt an actor type → pursue & attack the nearest visible one.
        let bestActor = null, bestActorDist = Infinity;
        for (const other of em.actors) {
            if (other === actor || other.isDead) continue;
            if (other.type !== quarry) continue;
            if (!actor.canSeeTarget(other)) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, other.x, other.y);
            if (dist < bestActorDist) { bestActor = other; bestActorDist = dist; }
        }
        if (bestActor) {
            // moveToward the quarry's tile; when adjacent, tryMove's attack-on-bump
            // bites it (kills over repeated turns). Same mechanism as pursue_target.
            return actor.moveToward(bestActor.x, bestActor.y);
        }

        // 2) Hunt an item type → seek & collect the nearest visible one (only if
        // the hunter has room to carry it, mirroring seek_item).
        const maxInventory = actor.getAttribute('inventory') || 0;
        if (actor.inventory.length >= maxInventory) return false;

        const visionRange = actor.getAttribute('vision_range') || 10;
        let bestItem = null, bestItemDist = Infinity;
        for (const item of em.items) {
            if (item.isDead) continue;
            if (item.type !== quarry) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, item.x, item.y);
            if (dist > visionRange || dist >= bestItemDist) continue;
            bestItem = item; bestItemDist = dist;
        }
        if (bestItem) {
            if (bestItemDist <= 1) { actor.pickUpItem?.(bestItem); return true; }
            return actor.moveToward(bestItem.x, bestItem.y);
        }

        return false;
    },

    mine_nearby_wall: (actor) => {
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
                actor.engine.inputManager?.showMessage(`The ${actor.name} incinerates ${otherName}!`, { x: actor.x, y: actor.y });
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
                actor.engine.inputManager?.showMessage(`The ${actor.name} incinerates ${article} ${displayName}!`, { x: actor.x, y: actor.y });
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

        // Spread to tiles at the current distance from origin
        for (const dir of ALL_DIRS) {
            const targetX = actor.cloudOriginX + dir.dx * actor.currentSpreadDistance;
            const targetY = actor.cloudOriginY + dir.dy * actor.currentSpreadDistance;

            // Check if tile is valid (has floor, not a wall)
            const floorTile = actor.engine.mapManager?.floorMap[targetY]?.[targetX];
            if (!floorTile || floorTile.tileId <= 0) continue;

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
                    actor.engine.inputManager?.showMessage(`The fire burns ${victim.name} for ${damagePerTurn} damage!`, { x: actor.x, y: actor.y });
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

        // Make the trap visible (stays visible permanently)
        if (!actor.hasAttribute('visible')) {
            actor.setAttribute('visible', true);
            actor.engine.renderer?.createActorSprites(actor);
        }

        // Show trap message
        const trapMessage = actor.data?.trap_message || `A trap is sprung!`;
        actor.engine.inputManager?.showMessage(trapMessage, { x: actor.x, y: actor.y });

        // Play trap sound
        actor.engine.playSound?.(data.trap_sound ?? 'tap2');

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
                    spawnedActor.cloudLifetime = data.trap_cloud_lifetime ?? 8;
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
            if (!actor.hasFloorAt(nx, ny) && !actor.hasPlatformAt(nx, ny)) continue;
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
        actor.engine.renderer?.effectRunner?.apply(data.blink_effect ?? 'blink');

        if (data.blink_spawn) {
            entityManager.spawnActor(data.blink_spawn, prevX, prevY);
        }

        return true;
    },

    bolt_attack: (actor, data) => {
        const entityManager = actor.engine.entityManager;

        const attackRange = data?.attack_range || actor.getAttribute('attack_range') || 8;
        const cooldown = data?.bolt_cooldown || actor.getAttribute('bolt_cooldown') || 4;
        const boltDamage = data?.bolt_damage || actor.getAttribute('bolt_damage') || -15;

        if (!actor._boltCooldownCounter) actor._boltCooldownCounter = 0;
        actor._boltCooldownCounter++;

        if (actor._boltCooldownCounter < cooldown) return false;

        let target = null;
        let nearestDist = Infinity;

        for (const other of entityManager.actors) {
            if (other === actor) continue;
            if (other.isDead) continue;
            if (!other.hasAttribute('controlled')) continue;

            const dx = other.x - actor.x;
            const dy = other.y - actor.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= attackRange && dist < nearestDist) {
                const isBlocked = (x, y) => {
                    const actorAt = entityManager.getSolidActorAt(x, y);
                    return actorAt && actorAt !== actor && actorAt !== other;
                };
                if (hasLineOfSight(actor.x, actor.y, other.x, other.y, isBlocked)) {
                    target = other;
                    nearestDist = dist;
                }
            }
        }

        if (!target) return false;

        actor._boltCooldownCounter = 0;

        const path = getLinePath(actor.x, actor.y, target.x, target.y);
        const boltPath = path.slice(1);

        if (boltPath.length === 0) return false;

        actor.engine.playSound?.(data.bolt_sound ?? 'squarewave');
        actor.engine.renderer?.effectRunner.apply(data.bolt_effect ?? 'lightning_bolt', actor, { path: boltPath });

        const fillDuration = boltPath.length * 25 + 100;
        setTimeout(() => {
            for (const point of boltPath) {
                const victim = entityManager.getSolidActorAt(point.x, point.y);
                if (victim && victim !== actor && !victim.isDead && victim.stats?.health) {
                    victim.modifyStat('health', boltDamage, { source: actor });
                    const victimName = victim.getNameWithArticle ? victim.getNameWithArticle() : `the ${victim.name}`;
                    const actorName = actor.getNameWithArticle ? actor.getNameWithArticle() : `The ${actor.name}`;
                    const pos = victim.hasAttribute('controlled') ? null : { x: victim.x, y: victim.y };
                    actor.engine.inputManager?.showMessage(`${actorName}'s lightning bolt strikes ${victimName}!`, pos);
                    victim.flash?.();
                    if (victim.getStat?.('health') <= 0) victim.die();
                }
            }
            actor.engine.interfaceManager?.updateSidebar();
        }, fillDuration);

        return true;
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
                if (isBlocked(point.x, point.y)) break; // walls stop this ray
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

    // Backward-compat aliases
    scutigera_head_ai: (...args) => BehaviorLibrary.chain_head_ai(...args),
    scutigera_body_follow: (...args) => BehaviorLibrary.chain_body_follow(...args),
    scutigera_scatter: (...args) => BehaviorLibrary.chain_scatter(...args),
    game_of_life_step: (...args) => BehaviorLibrary.cellular_automaton_step(...args),
    emit_sewer_gas: (...args) => BehaviorLibrary.emit_cloud(...args),
    deep_water_currents: (...args) => {
        BehaviorLibrary.strip_inventory(...args);
        return BehaviorLibrary.drift_ground_items(...args);
    },
    clock_tick: (actor, data) => {
        BehaviorLibrary.countdown(actor, data);
        BehaviorLibrary.countdown_display(actor, { ...data, countdown_display: 'digit' });
        return true;
    }
};
