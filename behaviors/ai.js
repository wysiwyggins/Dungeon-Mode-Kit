/**
 * Behaviors: movement and fighting AI: attacking, patrolling, guarding,
 * pursuit, ambush, following, keeping distance, fleeing, healing allies,
 * seeking items, exploring, hunting and mining.
 */

import { BehaviorLibrary } from './behaviors.js';
import {
    buildExplorePassable,
    computeExploreTarget,
    getChebyshevDistance,
    getNextPathStep,
    hasLineOfSight,
    resolveQuarry
} from '../core/pathfinding.js';
import { ALL_DIRS, CARDINAL_DIRS, randomElement, shuffleArray } from '../core/util.js';

/**
 * Pick the waypoint loop for the `patrol_route` behavior.
 *
 * Floods out from the actor through tiles it could walk (counting closed,
 * unlocked doors and other creatures as open, since both clear), keeps the room
 * interior tiles — floor on all eight sides, so waypoints never sit in a
 * corridor, doorway or against a wall — and spreads `patrol_points` of them apart. The start tile is
 * always the first waypoint, so the loop comes back past where it was placed.
 *
 * @returns {Array<{x: number, y: number}>} The loop in walking order
 */
function buildPatrolRoute(actor, data) {
    const em = actor.engine.entityManager;
    const maxSteps = data.patrol_radius ?? 24;
    const count = data.patrol_points ?? 4;

    const canCross = (x, y) => {
        if (actor.isPassableAt(x, y)) return true;
        if (!actor.hasFloorAt(x, y)) return false;
        const blocker = em.getSolidActorAt(x, y);
        if (!blocker) return false;
        if (blocker.hasAttribute('sentient') || blocker.hasAttribute('controlled')) return true;
        return blocker.hasAttribute('openable') && !blocker.hasAttribute('container')
            && !blocker.hasAttribute('locked');
    };

    // Floor all the way round, diagonals included: a room mouth is open on four
    // sides too, but its diagonals are the wall the corridor cuts through.
    const floorMap = actor.engine.mapManager.floorMap;
    const isRoomInterior = (x, y) => !em.getSolidActorAt(x, y)
        && ALL_DIRS.every(d => floorMap[y + d.dy]?.[x + d.dx]?.tileId > 0);

    const start = { x: actor.x, y: actor.y };
    const seen = new Set([`${start.x},${start.y}`]);
    const candidates = [];
    let frontier = [start];
    for (let step = 0; step < maxSteps && frontier.length; step++) {
        const next = [];
        for (const tile of frontier) {
            for (const dir of CARDINAL_DIRS) {
                const x = tile.x + dir.dx;
                const y = tile.y + dir.dy;
                const key = `${x},${y}`;
                if (seen.has(key) || !canCross(x, y)) continue;
                seen.add(key);
                next.push({ x, y });
                if (isRoomInterior(x, y)) candidates.push({ x, y });
            }
        }
        frontier = next;
    }

    // Farthest-point sampling: each pick is the candidate farthest from every
    // waypoint chosen so far, which spreads the loop across separate rooms.
    const route = [start];
    while (route.length < count && candidates.length) {
        let best = -1;
        let bestDist = -1;
        candidates.forEach((c, i) => {
            const d = Math.min(...route.map(w => getChebyshevDistance(c.x, c.y, w.x, w.y)));
            if (d > bestDist) { bestDist = d; best = i; }
        });
        if (bestDist < 3) break; // the rest are too close to bother walking to
        route.push(candidates.splice(best, 1)[0]);
    }

    // Order the loop nearest-neighbor from the start so it doesn't zigzag.
    const ordered = [route.shift()];
    while (route.length) {
        const last = ordered[ordered.length - 1];
        let best = 0;
        route.forEach((w, i) => {
            if (getChebyshevDistance(last.x, last.y, w.x, w.y)
                < getChebyshevDistance(last.x, last.y, route[best].x, route[best].y)) best = i;
        });
        ordered.push(route.splice(best, 1)[0]);
    }
    return ordered;
}

export const BehaviorsAI = {
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

            // No swinging round a wall corner (same rule as moving round one)
            if (actor.isCornerBlockedTo(targetX, targetY)) continue;

            // Use unified collision effects system (handles damage, sounds, flash, etc.)
            // An attack attempt (even a miss) consumes the turn
            actor.applyCollisionEffects(target);
            return true; // Attack was attempted (hit or miss)
        }

        return false; // No valid target found
    },

    /**
     * Discordant AI (Brogue's STATUS_DISCORDANT): attack an adjacent creature,
     * otherwise close on the nearest visible one. isEnemyOf treats everyone as
     * an enemy while discordant, so attack_adjacent does the swinging. Run by
     * Personality.execute ahead of the behavior chain rather than listed in it.
     * Returns false when there is nobody to fight.
     */
    discord_attack: (actor) => {
        if (BehaviorLibrary.attack_adjacent(actor)) return true;

        let nearest = null;
        let nearestDist = Infinity;
        for (const other of actor.engine.entityManager.actors) {
            if (other === actor || other.isDead || other.stats?.health === undefined) continue;
            if (!actor.canSeeTarget(other)) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, other.x, other.y);
            if (dist < nearestDist) {
                nearest = other;
                nearestDist = dist;
            }
        }
        if (!nearest) return false;
        return actor.moveToward(nearest.x, nearest.y);
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

    /**
     * Walk a fixed loop of waypoints, over and over. Unlike `patrol` (random
     * wandering near home) or `explore` (one pass over unvisited ground), the
     * route repeats, so the player can watch it and time a dash past.
     *
     * The route is picked on the first turn: up to `patrol_points` room tiles
     * reachable within `patrol_radius` steps, spread apart by farthest-point
     * sampling and ordered nearest-neighbor from the actor's start. Falls through
     * (returns false) when the target is in sight or the actor is alerted, so
     * pursuit behaviors placed after it take over; the next calm turn it heads
     * back to the waypoint it was walking toward.
     */
    patrol_route: (actor, data) => {
        if (actor._alerted) return false;
        const target = actor.engine.entityManager.findNearestPlayer(actor);
        if (target && actor.canSeeTarget(target)) return false;

        if (!actor._patrolRoute) actor._patrolRoute = buildPatrolRoute(actor, data);
        const route = actor._patrolRoute;
        if (route.length < 2) return false;

        if (actor._patrolIndex === undefined) actor._patrolIndex = 1;
        let waypoint = route[actor._patrolIndex];
        if (actor.x === waypoint.x && actor.y === waypoint.y) {
            actor._patrolIndex = (actor._patrolIndex + 1) % route.length;
            actor._patrolStuck = 0;
            waypoint = route[actor._patrolIndex];
        }

        if (actor.moveToward(waypoint.x, waypoint.y)) {
            actor._patrolStuck = 0;
            return true;
        }

        // Blocked (a creature parked on the waypoint, a door locked since):
        // give it a few turns, then skip ahead rather than stand there forever.
        actor._patrolStuck = (actor._patrolStuck || 0) + 1;
        if (actor._patrolStuck >= 3) {
            actor._patrolIndex = (actor._patrolIndex + 1) % route.length;
            actor._patrolStuck = 0;
        }
        return false;
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
            // trailData.owner is the actor itself (engine/actor/passives.js processTrailEffect), so
            // no lookup is needed — only the liveness check. This used to scan for
            // `a.id === trailData.ownerId`; both sides were undefined, so it matched
            // the first living actor in spawn order and sent the follower after it.
            const owner = trailData.owner?.isDead === false ? trailData.owner : null;
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
                if (actor.isHazardAt(actor.x + dir.dx, actor.y + dir.dy)) continue;
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
            if (actor.isHazardAt(nx, ny)) continue;
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
        const isConfused = actor.isConfused();

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

        // If no safe tiles, try any movement to escape — short of lava or fire
        for (const dir of directions) {
            if (actor.isHazardAt(actor.x + dir.dx, actor.y + dir.dy)) continue;
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
        if (dx > 1 || dy > 1 || actor.isCornerBlockedTo(attacker.x, attacker.y)) {
            // Attacker not adjacent, or round a wall corner: close in instead
            return actor.moveToward(attacker.x, attacker.y);
        }

        // Attack the attacker - an attack attempt (even a miss) consumes the turn
        actor.applyCollisionEffects(attacker);
        return true; // Attack was attempted
    },

    heal_ally: (actor, data) => {
        // brogue has abilities like this as inherent in specific monsters,
        //  but should dmk depend on objects with charges like the player's? 
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
        // The actor's own `seeks` / `search_radius` override the personality's
        // `item_type` / `search_radius`, so actors sharing a personality can want
        // different things. `seeks` takes ids or types, singly or as a list.
        const searchRadius = actor.getAttribute('search_radius') ?? data.search_radius ?? 10;
        const { names, itemIds } = resolveQuarry(actor.engine, actor.getAttribute('seeks') ?? data.item_type);
        const entityManager = actor.engine.entityManager;
        const maxInventory = actor.getAttribute('inventory') || 1;
        if (actor.inventory.length >= maxInventory) return false;

        let nearest = null;
        let nearestDist = Infinity;

        for (const item of entityManager.items) {
            if (item.isDead) continue;
            if (names.length && !itemIds.has(item.type)) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, item.x, item.y);
            if (dist > searchRadius || dist >= nearestDist) continue;
            if (!actor.canSeeTarget(item)) continue;
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
        const isCornerWall = (x, y) => em.blocksDiagonalAt(x, y);
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
     * Hunt the quarry named by the actor's `hunts` attribute — actors to kill
     * and items to collect, each named by id ("rat", "meat") or by type ("prey",
     * "food"), singly or as a list. The actor pursues the nearest matching, visible quarry and moves onto it;
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
        // `hunts` names one quarry or a list. Each entry is an actor or item id
        // ("rat", "meat") or a type covering many ("prey", "food").
        const { names: quarry, itemIds: quarryItemIds } = resolveQuarry(actor.engine, actor.getAttribute('hunts'));
        if (quarry.length === 0) return false;

        const em = actor.engine.entityManager;

        // 1) Hunt an actor → pursue & attack the nearest visible one.
        let bestActor = null, bestActorDist = Infinity;
        for (const other of em.actors) {
            if (other === actor || other.isDead) continue;
            if (!other.matchesActorType(quarry)) continue;
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

        // Same sight test as actor quarry: vision range, dimmed by darkness,
        // blocked by walls.
        let bestItem = null, bestItemDist = Infinity;
        for (const item of em.items) {
            if (item.isDead) continue;
            if (!quarryItemIds.has(item.type)) continue;
            const dist = getChebyshevDistance(actor.x, actor.y, item.x, item.y);
            if (dist >= bestItemDist || !actor.canSeeTarget(item)) continue;
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
};
