/**
 * Pathfinding and geometry helpers: line of sight, bolt tracing, A* and Dijkstra,
 * exploration frontiers and distance metrics.
 */

import { ALL_DIRS, CARDINAL_DIRS, isDiagonalBlocked, shuffleArray } from './util.js';

// ============================================================================
// PATHFINDING UTILITIES
// ============================================================================

/**
 * Compute a straight line path between two points using Bresenham's algorithm
 * Useful for line-of-sight, projectile paths, and aiming
 * @param {number} x0 - Starting X coordinate
 * @param {number} y0 - Starting Y coordinate
 * @param {number} x1 - Ending X coordinate
 * @param {number} y1 - Ending Y coordinate
 * @returns {Array<{x: number, y: number}>} Array of points along the line (includes start and end)
 */
export function getLinePath(x0, y0, x1, y1) {
    const points = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
        points.push({ x, y });

        if (x === x1 && y === y1) break;

        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }

    return points;
}

/**
 * Check if there's a clear line of sight between two points
 * @param {number} x0 - Starting X coordinate
 * @param {number} y0 - Starting Y coordinate
 * @param {number} x1 - Ending X coordinate
 * @param {number} y1 - Ending Y coordinate
 * @param {function(number, number): boolean} isBlocked - Callback that returns true if a tile blocks sight
 * @param {boolean} includeEndpoints - Whether to check the start and end points (default: false)
 * @returns {boolean} True if line of sight is clear
 */
export function hasLineOfSight(x0, y0, x1, y1, isBlocked, includeEndpoints = false) {
    const path = getLinePath(x0, y0, x1, y1);

    for (let i = 0; i < path.length; i++) {
        if (!includeEndpoints && (i === 0 || i === path.length - 1)) {
            continue;
        }

        if (isBlocked(path[i].x, path[i].y)) {
            return false;
        }
    }

    return true;
}

/**
 * Get the first blocking point along a line (for projectile impacts, etc.)
 * @param {number} x0 - Starting X coordinate
 * @param {number} y0 - Starting Y coordinate
 * @param {number} x1 - Ending X coordinate
 * @param {number} y1 - Ending Y coordinate
 * @param {function(number, number): boolean} isBlocked - Callback that returns true if a tile blocks
 * @param {boolean} skipStart - Whether to skip the starting point (default: true)
 * @returns {{x: number, y: number}|null} First blocking point, or null if path is clear
 */
function getFirstBlockingPoint(x0, y0, x1, y1, isBlocked, skipStart = true) {
    const path = getLinePath(x0, y0, x1, y1);

    for (let i = skipStart ? 1 : 0; i < path.length; i++) {
        if (isBlocked(path[i].x, path[i].y)) {
            return path[i];
        }
    }

    return null;
}

/**
 * Trace a bolt from (x0, y0) toward (x1, y1), passing through conductive actors,
 * stopping at non-conductive ones and bouncing off `reflective` ones.
 *
 * A bounce flips the axis of the face that was struck (both axes on a corner or a
 * lone pillar, which sends the bolt straight back). The new leg runs as far as the
 * leg before it, or for the rest of the aim if that's farther — so a bolt aimed at
 * a mirror five tiles off comes five tiles back, and can strike its own caster.
 *
 * @param {number} x0 - Starting X coordinate
 * @param {number} y0 - Starting Y coordinate
 * @param {number} x1 - Aimed X coordinate
 * @param {number} y1 - Aimed Y coordinate
 * @param {function(number, number): Actor|null} getSolidActorAt - Solid actor lookup
 * @param {object} options
 * @param {number} options.maxBounces - Bounces before a reflector stops the bolt (default: 3)
 * @param {number|null} options.maxRange - Total tiles before the bolt is out of range
 * @returns {{path: Array, blockedAt: {x,y}|null, outOfRange: boolean, bounces: Array<{x, y, actor}>}}
 *     path excludes the start tile; a blocking tile is included as the last point
 */
export function traceBoltPath(x0, y0, x1, y1, getSolidActorAt, options = {}) {
    const maxBounces = options.maxBounces ?? 3;
    const maxRange = options.maxRange ?? null;
    const path = [];
    const bounces = [];
    const result = { path, blockedAt: null, outOfRange: false, bounces };

    const isSurface = (x, y) => {
        const actor = getSolidActorAt(x, y);
        return !!actor && (actor.getAttribute('reflective') || actor.getAttribute('conductive') === false);
    };

    let from = { x: x0, y: y0 };
    let dir = { x: x1 - x0, y: y1 - y0 };
    let remaining = Math.max(Math.abs(dir.x), Math.abs(dir.y));

    while (remaining > 0) {
        // Extend the leg far enough along dir to cover what's left; the first leg
        // (k = 1) reproduces the aimed line exactly.
        const k = Math.ceil(remaining / Math.max(Math.abs(dir.x), Math.abs(dir.y)));
        const leg = getLinePath(from.x, from.y, from.x + dir.x * k, from.y + dir.y * k);
        let traveled = 0;
        let bounced = false;

        for (let i = 1; i < leg.length && traveled < remaining; i++) {
            const point = leg[i];

            if (maxRange !== null && path.length >= maxRange) {
                result.outOfRange = true;
                return result;
            }

            const actor = getSolidActorAt(point.x, point.y);
            if (actor?.getAttribute('reflective') && bounces.length < maxBounces) {
                const prev = leg[i - 1];
                const sx = point.x - prev.x;
                const sy = point.y - prev.y;
                let flipX = sx !== 0 && sy === 0;
                let flipY = sy !== 0 && sx === 0;
                if (sx !== 0 && sy !== 0) {
                    // Diagonal step: the open side tells which face was struck.
                    // Both open (a corner) or both walled (an inside corner) flips both.
                    const wallBesideX = isSurface(prev.x + sx, prev.y);
                    const wallBesideY = isSurface(prev.x, prev.y + sy);
                    flipX = wallBesideX || !wallBesideY;
                    flipY = wallBesideY || !wallBesideX;
                }
                dir = { x: flipX ? -dir.x : dir.x, y: flipY ? -dir.y : dir.y };
                bounces.push({ x: point.x, y: point.y, actor });
                remaining = Math.max(remaining - traveled, traveled);
                from = prev;
                bounced = true;
                break;
            }

            if (actor && (actor.getAttribute('reflective') || actor.getAttribute('conductive') === false)) {
                result.blockedAt = point;
                path.push(point);
                return result;
            }

            path.push(point);
            traveled++;
        }

        if (!bounced) break;
    }

    return result;
}

/**
 * Normalize an item-matching setting (`hunts`, `seeks`, a personality's
 * `item_type`, a launcher's `launches`) to a list, and expand it to the item ids
 * it covers: an id stands for itself, a type for every item declaring it. Goes through the prototype so a type with a
 * prototype-only pool (treasure) resolves the way it does when spawning.
 *
 * @param {Engine} engine
 * @param {string|string[]|undefined} setting
 * @returns {{names: string[], itemIds: Set<string>}}
 */
export function resolveQuarry(engine, setting) {
    const names = (Array.isArray(setting) ? setting : [setting]).filter(Boolean);
    const itemIds = new Set(names);
    for (const name of names) {
        for (const id of engine.currentPrototype?.getItemsOfType?.(name) || []) itemIds.add(id);
    }
    return { names, itemIds };
}

/**
 * Compute a path using A* algorithm via ROT.js
 * @param {number} fromX - Starting X coordinate
 * @param {number} fromY - Starting Y coordinate
 * @param {number} toX - Target X coordinate
 * @param {number} toY - Target Y coordinate
 * @param {function(number, number): boolean} isPassable - Callback that returns true if a tile is passable
 * @param {object} options - Optional settings
 * @param {number} options.topology - Movement topology: 4 (cardinal), 6 (hex), or 8 (including diagonals). Default: 8
 * @returns {Array<{x: number, y: number}>} Array of points from start to end (includes both), or empty array if no path
 */
export function findPathAStar(fromX, fromY, toX, toY, isPassable, options = {}) {
    const topology = options.topology ?? 8;
    const hasFloor = options.hasFloor;
    // What counts as a corner wall for "no cutting corners". Defaults to
    // "cell lacks floor" (legacy behavior) but callers should pass a wall-aware
    // predicate so open voids don't block diagonal corner moves.
    const isCornerBlocker = options.isCornerBlocker ?? ((x, y) => !hasFloor(x, y));
    const path = [];

    const astar = new ROT.Path.AStar(toX, toY, isPassable, { topology });

    astar.compute(fromX, fromY, (x, y) => {
        path.push({ x, y });
    });

    if (hasFloor && path.length > 1) {
        // ROT's A* cuts corners freely (it only knows per-tile passability, not the
        // "no diagonal past a wall corner" edge rule). Repair each illegal diagonal
        // by inserting an orthogonal detour tile — but the detour must itself be
        // walkable (floor AND passable), or the followed path would just bump into
        // the detour tile. If neither orthogonal side is walkable the diagonal
        // can't be legalized here, so replan cardinally to guarantee a bump-free
        // path the stepper can follow blindly.
        const walkable = (x, y) => hasFloor(x, y) && isPassable(x, y);
        let needsCardinalReplan = false;
        for (let i = path.length - 2; i >= 0; i--) {
            if (isDiagonalBlocked(path[i + 1].x, path[i + 1].y, path[i].x, path[i].y, isCornerBlocker)) {
                const mid = { x: path[i].x, y: path[i + 1].y };
                const alt = { x: path[i + 1].x, y: path[i].y };
                if (walkable(mid.x, mid.y)) {
                    path.splice(i + 1, 0, mid);
                } else if (walkable(alt.x, alt.y)) {
                    path.splice(i + 1, 0, alt);
                } else {
                    needsCardinalReplan = true;
                    break;
                }
            }
        }
        // Fall back to a cardinal-only (topology 4) path, which has no diagonals and
        // therefore no corner-cuts to repair. Only done when the diagonal path
        // couldn't be legalized, so the common case still uses shorter diagonals.
        if (needsCardinalReplan && topology === 8) {
            const cardinal = [];
            const astar4 = new ROT.Path.AStar(toX, toY, isPassable, { topology: 4 });
            astar4.compute(fromX, fromY, (x, y) => { cardinal.push({ x, y }); });
            if (cardinal.length > 1) return cardinal;
        }
    }

    return path;
}

/**
 * Compute a path using Dijkstra's algorithm via ROT.js
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {function(number, number): boolean} isPassable
 * @param {object} options
 * @param {number} options.topology - Movement topology: 4 (cardinal), 6 (hex), or 8 (including diagonals). Default: 8
 * @returns {Array<{x: number, y: number}>} Array of points from start to end (includes both), or empty array if no path
 */
function findPathDijkstra(fromX, fromY, toX, toY, isPassable, options = {}) {
    const topology = options.topology ?? 8;
    const path = [];

    const dijkstra = new ROT.Path.Dijkstra(toX, toY, isPassable, { topology });

    dijkstra.compute(fromX, fromY, (x, y) => {
        path.push({ x, y });
    });

    return path;
}

/**
 * Check if a path exists between two points (without computing the full path)
 * Uses A* for efficiency
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {function(number, number): boolean} isPassable
 * @param {object} options
 * @param {number} options.topology - Movement topology: 4, 6, or 8. Default: 8
 * @returns {boolean} True if a path exists
 */
function pathExists(fromX, fromY, toX, toY, isPassable, options = {}) {
    const path = findPathAStar(fromX, fromY, toX, toY, isPassable, options);
    return path.length > 0;
}

/**
 * Get the next step along a path from one point to another
 * Useful for AI movement - returns just the next tile to move to
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {function(number, number): boolean} isPassable
 * @param {object} options
 * @param {number} options.topology - Movement topology: 4, 6, or 8. Default: 8
 * @returns {{x: number, y: number}|null} Next point to move to, or null if no path or already at target
 */
export function getNextPathStep(fromX, fromY, toX, toY, isPassable, options = {}) {
    if (fromX === toX && fromY === toY) {
        return null;
    }
    const path = findPathAStar(fromX, fromY, toX, toY, isPassable, options);
    if (path.length > 1) {
        return path[1];
    }

    return null;
}

/**
 * Whether a solid actor is a closed door an actor can open just by walking into
 * it — i.e. openable, currently closed, not hidden, not locked, not spiked. Auto-routing
 * (explore + click-to-walk) treats these tiles as passable because the mover
 * bumps them open and steps through; locked/spiked doors need a key or attacking
 * and stay impassable.
 *
 * The `hidden` test is what keeps auto-routing honest. An undiscovered secret
 * door is openable, closed and unlocked, so without it explore and the walk-path
 * preview both path straight through a wall the player has no reason to believe
 * is a door — which gives the secret away and makes searching pointless. It
 * reads as a wall to the router until something reveals it. (`isTravelTarget` in
 * input.js already refuses hidden actors for the same reason on the Tab-cycle
 * side.) Barred secret doors were only ever safe here by accident, via `locked`.
 * @param {Actor} solid - the solid actor occupying the tile
 * @returns {boolean}
 */
export function isOpenableDoorTile(solid) {
    return !!solid &&
           solid.hasAttribute?.('openable') &&
           !solid.hasAttribute('container') &&
           !solid.hasAttribute('hidden') &&
           !solid.hasAttribute('open') &&
           !solid.hasAttribute('locked') &&
           !solid.hasAttribute('spiked');
}

/**
 * Build the passability predicate used for auto-explore routing. Mirrors the
 * predicate Renderer.showWalkPath uses (floor present, no blocking solid actor,
 * avoid hazardous actors unless the mover is immune) so the explore preview, the
 * hotkey stepper, and the hero personality all agree on where the actor can walk.
 * @param {object} engine
 * @param {Actor} actor - the exploring actor (its immunities gate hazards)
 * @returns {function(number, number): boolean}
 */
export function buildExplorePassable(engine, actor) {
    const mm = engine.mapManager;
    const em = engine.entityManager;
    const pusherStrength = actor.getAttribute('strength') || 0;
    return (x, y) => {
        if (x < 0 || y < 0 || x >= mm.width || y >= mm.height) return false;
        // Own tile is always "passable" (it's the flood root).
        if (x === actor.x && y === actor.y) {
            const f = mm.floorMap[y]?.[x];
            return !!(f && f.tileId > 0);
        }
        const solid = em.getSolidActorAt(x, y);
        if (solid && solid !== actor) {
            // A closed but unlocked door is routable: the actor bumps it open, then
            // steps through on the next tick (the stepper retries on an `opened`
            // result). Locked or spiked doors can't be opened by walking, so they
            // stay impassable and explore won't strand a target behind them.
            if (isOpenableDoorTile(solid)) return true;
            // A pushable wall the actor can shove is treated as passable so explore
            // routes THROUGH it (the actor steps in and pushes it aside).
            if (pusherStrength > 0 && solid.hasAttribute('pushable')) {
                for (const d of CARDINAL_DIRS) {
                    const px = x + d.dx, py = y + d.dy;
                    if (px < 0 || py < 0 || px >= mm.width || py >= mm.height) continue;
                    const farFloor = mm.floorMap[py]?.[px];
                    if (farFloor && farFloor.tileId > 0 && !em.getSolidActorAt(px, py)) {
                        return true; // can be pushed clear in some direction → routable
                    }
                }
            }
            return false;
        }
        // Route around teleporters: stepping on one mid-route would fling the
        // explorer across the map. Reaching one on purpose is still possible
        // (travel and click-to-walk exempt the endpoint).
        if (em.getActorsAt(x, y).some(a => !a.isDead && a.hasAttribute('teleporter'))) return false;
        // Avoid hazardous actors unless the mover is immune.
        if (actor.isHazardAt(x, y)) return false;
        const floor = mm.floorMap[y]?.[x];
        return !!(floor && floor.tileId > 0);
    };
}

/**
 * Find the exploration frontier: walkable tiles that are NOT "explored" yet but
 * border at least one explored, walkable tile (so they're reachable from known
 * space). "Explored" is supplied by the caller, because the two consumers have
 * different notions of it:
 *   - the player (x)plore action passes engine.isTileExplored (fog-of-war memory);
 *   - the AI "hero" personality passes its own per-actor visited-tile memory
 *     (there is no player/FOV in an observer prototype).
 * When everything is already explored (fully-lit level with fog-of-war memory,
 * or the hero has walked everywhere), this returns [] → "nothing left."
 * @param {object} engine
 * @param {function(number,number):boolean} isExplored
 * @returns {Array<{x:number,y:number}>}
 */
function findFrontierTiles(engine, isExplored) {
    const mm = engine.mapManager;
    const frontier = [];
    const hasFloor = (x, y) => {
        const f = mm.floorMap[y]?.[x];
        return !!(f && f.tileId > 0);
    };
    for (let y = 0; y < mm.height; y++) {
        for (let x = 0; x < mm.width; x++) {
            if (!hasFloor(x, y)) continue;
            if (isExplored(x, y)) continue;
            // Unexplored floor tile — is it adjacent to explored, walkable space?
            let bordersKnown = false;
            for (const d of ALL_DIRS) {
                const nx = x + d.dx, ny = y + d.dy;
                if (hasFloor(nx, ny) && isExplored(nx, ny)) {
                    bordersKnown = true;
                    break;
                }
            }
            if (bordersKnown) frontier.push({ x, y });
        }
    }
    return frontier;
}

/**
 * Compute where an auto-exploring actor should head next. Uses a single
 * ROT.Path.Dijkstra flood rooted at the actor (target = actor position; ROT's
 * Dijkstra floods to find any source, and caches per (fromX,fromY) so repeated
 * compute() calls to the same root are cheap). Reachable pickable items the actor
 * can currently perceive are preferred over raw frontier tiles (loot bias, à la
 * Brogue's item weighting); within a kind, the nearest reachable candidate wins.
 *
 * The two "sense" inputs are injected so one core serves both consumers:
 *   - opts.isExplored(x,y): what counts as already-seen (fog-of-war vs. hero memory).
 *   - opts.canSeeItem(item): whether the actor perceives a given ground item.
 * @param {object} engine
 * @param {Actor} actor
 * @param {object} opts
 * @param {function(number,number):boolean} opts.isExplored
 * @param {function(object):boolean} [opts.canSeeItem] - default: item tile is visible to the player
 * @param {function(number,number):boolean} [opts.isPassable] - default: buildExplorePassable
 * @returns {{x:number,y:number,kind:'item'|'frontier'}|null} target, or null if nothing to explore
 */
export function computeExploreTarget(engine, actor, opts = {}) {
    const isExplored = opts.isExplored || ((x, y) => engine.isTileExplored(x, y));
    const canSeeItem = opts.canSeeItem || ((item) => engine.isTileVisible(item.x, item.y));
    const passable = opts.isPassable || buildExplorePassable(engine, actor);
    const em = engine.entityManager;

    // ROT Dijkstra rooted at the actor's tile. We only need reachability + hop
    // count, read off the number of points the path callback emits.
    const dijkstra = new ROT.Path.Dijkstra(actor.x, actor.y, passable, { topology: 8 });
    const reachDist = (tx, ty) => {
        if (tx === actor.x && ty === actor.y) return null; // already there
        let steps = 0;
        dijkstra.compute(tx, ty, () => { steps++; });
        // A path of length > 1 (start + at least one step) means reachable.
        return steps > 1 ? steps : null;
    };

    // 1) Nearest reachable perceivable pickable item (loot bias).
    let bestItem = null, bestItemDist = Infinity;
    for (const item of em.items) {
        if (item.isDead) continue;
        if (!canSeeItem(item)) continue;
        const d = reachDist(item.x, item.y);
        if (d != null && d < bestItemDist) { bestItem = item; bestItemDist = d; }
    }
    if (bestItem) return { x: bestItem.x, y: bestItem.y, kind: 'item' };

    // 2) Nearest reachable frontier tile.
    const frontier = findFrontierTiles(engine, isExplored);
    let bestF = null, bestFDist = Infinity;
    for (const cell of frontier) {
        const d = reachDist(cell.x, cell.y);
        if (d != null && d < bestFDist) { bestF = cell; bestFDist = d; }
    }
    if (bestF) return { x: bestF.x, y: bestF.y, kind: 'frontier' };

    return null;
}

/**
 * Calculate Manhattan distance between two points
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {number} Manhattan distance
 */
function getManhattanDistance(x0, y0, x1, y1) {
    return Math.abs(x1 - x0) + Math.abs(y1 - y0);
}

/**
 * Calculate Chebyshev distance between two points (diagonal distance)
 * This is the number of king moves on a chessboard
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {number} Chebyshev distance
 */
export function getChebyshevDistance(x0, y0, x1, y1) {
    return Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
}

/**
 * Calculate Euclidean distance between two points
 * @param {number} x0 - First X coordinate
 * @param {number} y0 - First Y coordinate
 * @param {number} x1 - Second X coordinate
 * @param {number} y1 - Second Y coordinate
 * @returns {number} Euclidean distance
 */
export function getEuclideanDistance(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if an actor is "important" enough that obscuring actors should go transparent.
 */
export function isImportantActor(actor) {
    // Nothing concealed is "important" yet — fading the map art that covers a
    // hidden door would spotlight the very tile the player is meant to find.
    if (actor.hasAttribute('hidden')) return false;

    return actor.personality ||
           actor.hasAttribute('openable') ||
           actor.hasAttribute('stairway') ||
           actor.hasAttribute('portal') ||
           actor.hasAttribute('teleporter') ||
           actor.hasAttribute('controlled');
}

/**
 * Find a walkable, unoccupied tile adjacent to the given actor (cardinal only).
 * Directions are shuffled using ROT.RNG for deterministic randomness.
 */
export function findAdjacentWalkable(actor, entityManager) {
    const dirs = shuffleArray([...CARDINAL_DIRS]);
    for (const dir of dirs) {
        const nx = actor.x + dir.dx;
        const ny = actor.y + dir.dy;
        // Check floor or platform exists
        if (!actor.hasFloorAt(nx, ny) && !actor.hasPlatformAt(nx, ny)) continue;
        // Only skip tiles with solid actors (ignore non-solid like water/sewage)
        const occupant = entityManager.getSolidActorAt(nx, ny);
        if (occupant) continue;
        return { x: nx, y: ny };
    }
    return null;
}

/**
 * For multi-actor centepedes etc- spawn a chain of body segments behind a chain_head actor.
 * Sets up _chainPrev/_chainNext/_chainHead links and _pathHistory on the head.
 * Uses entityManager.spawnActor() so each segment gets sprites + scheduler registration.
 */
export function spawnChainSegments(head, entityManager) {
    const segmentCount = head.getAttribute('segment_count') || 4;
    const segmentType = head.getAttribute('chain_segment_type');
    if (!segmentType) return;

    head._chainNext = null;
    head._chainPrev = null;
    head._chainHead = head;
    head._pathHistory = [];

    let prev = head;

    for (let i = 0; i < segmentCount; i++) {
        const spawnPos = findAdjacentWalkable(prev, entityManager);
        if (!spawnPos) break;

        const segment = entityManager.spawnActor(segmentType, spawnPos.x, spawnPos.y);
        if (!segment) break;

        segment._chainPrev = prev;
        segment._chainNext = null;
        segment._chainHead = head;
        prev._chainNext = segment;

        prev = segment;
    }

}
