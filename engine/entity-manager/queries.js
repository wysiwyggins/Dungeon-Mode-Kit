/**
 * EntityManager methods: spatial queries and the actor position cache, liquid
 * bodies, tile classification (entryways, ambush spots, niches) and viewpoint
 * lookups.
 */

import { getChebyshevDistance } from '../../core/pathfinding.js';
import { ALL_DIRS, CARDINAL_DIRS } from '../../core/util.js';
import { Actor } from '../actor/actor.js';
import { Item } from '../item.js';

export const EntityManagerQueries = {
    _getLiquidActorAt(x, y) {
        if (!this._liquidPosCache) {
            this._liquidPosCache = new Map();
            for (const a of this.actors) {
                if (!a.isDead && a.hasAttribute('liquid')) {
                    this._liquidPosCache.set(a.x * 10000 + a.y, a);
                }
            }
        }
        return this._liquidPosCache.get(x * 10000 + y) || null;
    },

    /**
     * Id of the connected body of liquid at (x, y), or null if there's none.
     * Separate lakes get different ids, so diving into one can't reveal the eel
     * living in another. Connectivity runs through any liquid, shallow or deep —
     * a lake pinched to a shallow ford is still one body, and an eel can swim
     * those shallows between its deep pools.
     *
     * Rides on _getLiquidActorAt's cache, so it is rebuilt exactly when that is.
     *
     * @param {number} x
     * @param {number} y
     * @returns {number|null}
     */
    getLiquidBodyIdAt(x, y) {
        this._getLiquidActorAt(x, y); // ensure _liquidPosCache is built
        if (this._liquidBodySource !== this._liquidPosCache) {
            this._liquidBodySource = this._liquidPosCache;
            this._liquidBodyIds = this._labelLiquidBodies();
        }
        return this._liquidBodyIds.get(x * 10000 + y) ?? null;
    },

    /**
     * Flood-fill every liquid cell into numbered connected bodies.
     * @returns {Map<number, number>} position key -> body id
     */
    _labelLiquidBodies() {
        const ids = new Map();
        // 8-way: a diagonal pinch in a cavern lake still reads as one pool.
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
        let nextId = 0;

        for (const key of this._liquidPosCache.keys()) {
            if (ids.has(key)) continue;
            const bodyId = nextId++;
            const stack = [key];
            ids.set(key, bodyId);

            while (stack.length) {
                const cur = stack.pop();
                const cx = Math.floor(cur / 10000);
                const cy = cur % 10000;
                for (const [dx, dy] of dirs) {
                    const nKey = (cx + dx) * 10000 + (cy + dy);
                    if (ids.has(nKey)) continue;
                    if (!this._liquidPosCache.has(nKey)) continue;
                    ids.set(nKey, bodyId);
                    stack.push(nKey);
                }
            }
        }
        return ids;
    },

    _getSolidActorAt(x, y) {
        if (!this._solidPosCache) {
            this._solidPosCache = new Map();
            for (const a of this.actors) {
                if (!a.isDead && a.hasAttribute('solid')) {
                    this._solidPosCache.set(a.x * 10000 + a.y, a);
                }
            }
        }
        return this._solidPosCache.get(x * 10000 + y) || null;
    },

    getEntityAt(x, y) {
        return this.entities.find(e => e.x === x && e.y === y && !(e instanceof Actor) && !(e instanceof Item));
    },

    _ensureActorPosCache() {
        if (!this._actorPosCache) {
            this._actorPosCache = new Map();
            for (const a of this.actors) {
                if (a.isDead) { a._posKey = undefined; continue; }
                const key = a.x * 10000 + a.y;
                a._posKey = key;
                const list = this._actorPosCache.get(key);
                if (list) list.push(a);
                else this._actorPosCache.set(key, [a]);
            }
        }
    },

    /**
     * Full rebuild on next lookup. Adds, removes, deaths and moves all update the
     * map in place, so this is only needed after bulk changes that bypass them.
     */
    invalidateActorPosCache() {
        this._actorPosCache = null;
    },

    // Tile buckets are copy-on-write: getActorsAt hands out the bucket itself, and
    // callers loop over it while killing/spawning actors on that tile, so a bucket
    // already handed out must never change underneath them.

    // Insert into its tile bucket, ordered by _posSeq to match this.actors.
    _posCacheInsert(actor) {
        if (!this._actorPosCache || actor.isDead) return;
        const key = actor.x * 10000 + actor.y;
        actor._posKey = key;
        const list = this._actorPosCache.get(key);
        if (!list) {
            this._actorPosCache.set(key, [actor]);
            return;
        }
        let i = list.length;
        while (i > 0 && list[i - 1]._posSeq > actor._posSeq) i--;
        const next = list.slice();
        next.splice(i, 0, actor);
        this._actorPosCache.set(key, next);
    },

    _posCacheRemove(actor) {
        const key = actor._posKey;
        actor._posKey = undefined;
        if (!this._actorPosCache || key === undefined) return;
        const list = this._actorPosCache.get(key);
        if (!list) return;
        const i = list.indexOf(actor);
        if (i === -1) return;
        if (list.length === 1) {
            this._actorPosCache.delete(key);
            return;
        }
        const next = list.slice();
        next.splice(i, 1);
        this._actorPosCache.set(key, next);
    },

    // Called by the Entity x/y setters.
    _repositionActor(actor) {
        if (!this._actorPosCache) return;
        this._posCacheRemove(actor);
        this._posCacheInsert(actor);
    },

    getActorsAt(x, y) {
        this._ensureActorPosCache();
        return this._actorPosCache.get(x * 10000 + y) || [];
    },

    getActorAt(x, y) {
        this._ensureActorPosCache();
        const list = this._actorPosCache.get(x * 10000 + y);
        return list ? list[0] : undefined;
    },

    getOtherActorAt(x, y, excludeActor) {
        const list = this.getActorsAt(x, y);
        return list.find(a => a !== excludeActor);
    },

    getSolidActorAt(x, y) {
        const list = this.getActorsAt(x, y);
        return list.find(a => a.hasAttribute('solid'));
    },

    /**
     * Does (x, y) block diagonal movement past its corner? True for a solid actor
     * with `blocks_diagonal` (the terrain and doorway types supply it), so walls
     * and closed doors stop corner-cutting while creatures, chests and open doors
     * don't. Melee obeys the same rule (Actor.isCornerBlockedTo); bolts and
     * thrown items don't.
     */
    blocksDiagonalAt(x, y) {
        return this.getActorsAt(x, y).some(a =>
            !a.isDead && a.hasAttribute('solid') && a.hasAttribute('blocks_diagonal'));
    },

    /**
     * The solid terrain at (x, y) that gas can't occupy — walls, statues, closed
     * doors, chests. Creatures and the player are solid too, but gas engulfs them,
     * so anything sentient or controlled doesn't count.
     * @returns {Actor|undefined}
     */
    blocksGasAt(x, y) {
        return this.getActorsAt(x, y).find(a =>
            !a.isDead && a.hasAttribute('solid') &&
            !a.hasAttribute('sentient') && !a.hasAttribute('controlled')
        );
    },

    /**
     * The actor at (x, y) that blocks line of sight, if any.
     *
     * Deliberately NOT the same test as getSolidActorAt. Solidity and opacity are
     * independent: a column or statue is solid but see-through (`opaque: false`),
     * and tall mushrooms are `solid: false` — you walk into them and crush them —
     * but still a head-high thicket you cannot see past. Keying sight off `solid`
     * made `opaque: true` dead data on anything walkable.
     *
     * @returns {Actor|null} The blocker, or null if sight passes.
     */
    getSightBlockerAt(x, y) {
        const list = this.getActorsAt(x, y);
        return list.find(a => !a.isDead && a.getAttribute('opaque') !== false
            && (a.hasAttribute('solid') || a.getAttribute('opaque') === true)) || null;
    },

    // --- Geometric tile classification (used by the 'ambush' behavior) ---
    // Maps carry no room/corridor metadata, so we derive it by counting how many
    // cardinal neighbors are walkable floor: a corridor/pinch has <=2, a room
    // interior has >=3.

    /** Count walkable (floor, positive tileId) cardinal neighbors of a tile. */
    _walkableCardinalCount(x, y) {
        let n = 0;
        for (const dir of CARDINAL_DIRS) {
            if (this.engine.mapManager.floorMap[y + dir.dy]?.[x + dir.dx]?.tileId > 0) n++;
        }
        return n;
    },

    /**
     * An "entryway" is a room mouth: a door tile, or a pinch point (a floor tile
     * with <=2 walkable cardinal neighbors — i.e. a corridor/opening).
     */
    isEntrywayTile(x, y) {
        if (!(this.engine.mapManager.floorMap[y]?.[x]?.tileId > 0)) return false;
        if (this.getActorsAt(x, y).some(a => a.hasAttribute?.('openable') && !a.hasAttribute?.('container'))) return true;
        return this._walkableCardinalCount(x, y) <= 2;
    },

    /**
     * An ambush spot is a room-interior floor tile (>=3 walkable cardinal
     * neighbors, no solid actor on it) that sits cardinally adjacent to an
     * entryway — i.e. just inside a room, beside its opening.
     */
    isAmbushSpot(x, y) {
        if (!(this.engine.mapManager.floorMap[y]?.[x]?.tileId > 0)) return false;
        if (this.getSolidActorAt(x, y)) return false;
        if (this._walkableCardinalCount(x, y) < 3) return false;
        for (const dir of CARDINAL_DIRS) {
            if (this.isEntrywayTile(x + dir.dx, y + dir.dy)) return true;
        }
        return false;
    },

    /**
     * A wall-niche tile: a room floor tile set against a wall, the way wall torches are
     * placed. Stairways look deliberate here and don't obstruct traffic, unlike a
     * stairway dropped in open floor or mid-corridor.
     *
     * Requires exactly 3 walkable cardinal neighbors — one side is wall (so it's flush
     * against it) while the other three are open (so it's room interior, not a corridor
     * or a corner pocket). Corners (2 walls) are excluded: they read as cramped and are
     * the spots most likely to be a dead-end nook rather than a wall run.
     *
     * @returns {boolean}
     */
    /**
     * Does this tile touch a hole in the floor (abyss, dug-out void)?
     *
     * Checks all 8 neighbours, since a diagonal step off a lip is just as fatal.
     * A cell counts as void when it has no floor AND nothing solid standing on it —
     * that distinguishes a pit from a wall, which is also floorless.
     *
     * Off-map cells don't count: the map edge is a boundary, not a fall.
     *
     * @returns {boolean}
     */
    isAdjacentToVoid(x, y) {
        const mm = this.engine.mapManager;
        for (const dir of ALL_DIRS) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            if (nx < 0 || ny < 0 || nx >= mm.width || ny >= mm.height) continue;
            if (mm.floorMap[ny]?.[nx]?.tileId > 0) continue;
            if (this.getSolidActorAt(nx, ny)) continue;   // a wall, not a pit
            return true;
        }
        return false;
    },

    isWallNicheTile(x, y) {
        if (!(this.engine.mapManager.floorMap[y]?.[x]?.tileId > 0)) return false;
        if (this.getSolidActorAt(x, y)) return false;
        if (this._walkableCardinalCount(x, y) !== 3) return false;

        // The one non-floor neighbour has to be an actual wall, not a hole.
        // _walkableCardinalCount only asks "does this cell have floor", and an abyss
        // cell has its floor removed (architect sets floorMap to null), so a tile on
        // the lip of a pit counts as a 3-neighbour niche and reads as a cosy alcove.
        // Since callers *prefer* niches, that actively steered stairways to cliff edges.
        for (const dir of CARDINAL_DIRS) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            if (this.engine.mapManager.floorMap[ny]?.[nx]?.tileId > 0) continue;
            // Found the non-floor side: it only counts as a niche wall if something
            // solid stands there. Off-map edges have no actor, so they don't qualify.
            return Boolean(this.getSolidActorAt(nx, ny));
        }
        return false;
    },

    getItemAt(x, y) {
        return this.items.find(i => i.x === x && i.y === y);
    },

    findActorByAttribute(attributeName, attributeValue) {
        return this.actors.find(a => a.getAttribute(attributeName) === attributeValue);
    },

    /**
     * All living sentient actors on the current level — creatures and the player,
     * i.e. things that take turns and can hold states (excludes walls, traps,
     * fire, clouds, etc.). The 'sentient' attribute is the same gate applyState
     * uses. Pass includeDead: true to include dead ones.
     * @param {Object} [options]
     * @param {boolean} [options.includeDead=false]
     * @returns {Actor[]}
     */
    getSentientActors({ includeDead = false } = {}) {
        return this.actors.filter(a =>
            a.hasAttribute('sentient') && (includeDead || !a.isDead)
        );
    },

    /**
     * Actors that act as the field-of-view / camera origin: the player-controlled
     * actor(s) OR any actor tagged `pov` (point of view). The `pov` attribute lets
     * a non-player actor — e.g. an AI "hero" in a zero-player observer prototype —
     * be the eyes we see through, so a dark/fog level renders around it. Used by
     * the lighting FOV pass; a single primary viewpoint is picked for the camera.
     * @returns {Array<Actor>}
     */
    getViewpointActors() {
        return this.actors.filter(a =>
            (a.hasAttribute('controlled') || a.hasAttribute('pov')) && !a.isDead
        );
    },

    /**
     * The single actor the camera should follow / center on: the controlled player
     * if present, else the first live `pov` actor, else null.
     * @returns {Actor|null}
     */
    getPrimaryViewpoint() {
        if (this.player && !this.player.isDead) return this.player;
        return this.actors.find(a => a.hasAttribute('pov') && !a.isDead) || null;
    },

    /**
     * Find the nearest controlled actor (player or ally) to a given actor
     * @param {Actor} fromActor - The actor searching for a target
     * @returns {Actor|null} The nearest controlled actor, or null if none found
     */
    findNearestPlayer(fromActor) {
        let nearest = null;
        let nearestDistance = Infinity;

        for (const actor of this.actors) {
            // Skip dead actors and the searcher itself
            if (actor.isDead || actor === fromActor) continue;

            // Only consider controlled actors (players, allies)
            if (!actor.hasAttribute('controlled')) continue;

            const distance = getChebyshevDistance(fromActor.x, fromActor.y, actor.x, actor.y);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = actor;
            }
        }

        return nearest;
    },
    
    findAdjacentTarget(actor) {
        const dirs = CARDINAL_DIRS;
        for (const dir of dirs) {
            const target = this.getActorAt(actor.x + dir.dx, actor.y + dir.dy);
            if (target && target !== actor && !target.isDead) {
                return target;
            }
        }
        return null;
    },
};
