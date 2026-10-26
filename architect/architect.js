/**
 * Architect: builds a floor's map, either from a Tiled map or procedurally. This
 * file holds the map infrastructure (layers, tiles, carving, flood fill, tile
 * patterns), room records and lights, finalizing, utilities and serialization.
 * Its other method groups are installed from the sibling modules in architect/.
 */

import { ArchitectBlobs } from './blobs.js';
import { ArchitectBridges } from './bridges.js';
import { ArchitectBrogue } from './brogue.js';
import { ArchitectPalladian } from './palladian.js';
import { ArchitectProcedural } from './procedural.js';
import { ArchitectRegions } from './regions.js';
import { ArchitectSpawning } from './spawning.js';
import { ArchitectTiled } from './tiled.js';
import { installMethods } from '../core/mixin.js';
import { globalVars } from '../globals.js';

// pendingWallSpawns types that are free-standing architecture rather than part of
// a wall run. A light source replacing one becomes a `brazier`;
// everything else becomes a `wall_torch`.
const FREESTANDING_WALL_TYPES = new Set(['column']);

// Neighbour offsets used by the helpers below and by applyTilePattern's tileContext.
export const TP_DIRS4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
export const TP_DIRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * True when any of the 8 neighbours of (x, y) satisfies `pred(x, y)` — the
 * "is this cell next to floor?" test.
 * Inside a tile pattern use tileContext.any8, whose predicate also takes the context.
 */
export function anyNeighbor8(pred, x, y) {
    for (const [dx, dy] of TP_DIRS8) {
        if (pred(x + dx, y + dy)) return true;
    }
    return false;
}

/** How many of the 8 neighbours of (x, y) satisfy `pred`. */
function countNeighbors8(pred, x, y) {
    let n = 0;
    for (const [dx, dy] of TP_DIRS8) {
        if (pred(x + dx, y + dy)) n++;
    }
    return n;
}
export class Architect {
    constructor(options = {}) {
        this.width = options.width || 30;
        this.height = options.height || 30;

        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.overlayMap = this.createEmptyMap();

        this.walkableTiles = [];

        this.pendingWallSpawns = [];
        this.pendingDoorSpawns = [];
        this.pendingTorchSpawns = [];
        this.pendingBrazierSpawns = [];
        // Liquid blob cells, each carrying the actor id to spawn there ({x, y, type}).
        // One queue rather than one per liquid: the type is data, not a routing key.
        this.pendingLiquidSpawns = [];
        this.pendingPushableWallSpawns = [];
        // Secret doors, includig barred secret doors with paired levers. Kept apart from
        // pendingDoorSpawns so the blob/connectivity filters can drop them without
        // having to tell an ordinary door from a hidden one.
        this.pendingSecretDoorSpawns = [];
        this.pendingHiddenLeverSpawns = [];
        this.pendingBridgeSpawns = [];
        this.pendingCollapsingFloorSpawns = [];
        // Floor carved across an abyss to reconnect a stranded region. Tracked so
        // a collapsing floor never drops the player through their only route out.
        this._causewayCells = new Set();
        this.diggerRooms = null;
        this.claimedRoomIndices = new Set();
        // Optional generator-published regions: name -> [{x, y}] floor tiles.
        // A random_actors/random_items entry can name one to confine its spawns
        // (see Engine.spawnRandomActorsFromConfig). Generators that publish none
        // cost nothing — an unknown name falls back to the whole map.
        this.namedRegions = {};
        // Optional generator hint: which named region each stairway belongs in, e.g.
        // { up: 'portico' } so a villa's entrance stair lands in its courtyard rather
        // than in an interior room. mechanics.up_stairway_region /
        // mechanics.down_stairway_region override it (see Engine.stairwayRegionFor).
        this.suggestedStairwayRegions = {};

        this.tileWidth = 16;
        this.tileHeight = 16;
        this.objectLayers = [];

        this.actorWildcardCache = null;

        this.config = {
            defaultFloorTileId: 158,
            defaultFloorTint: null,
            ...options.config
        };
    }

    /**
     * The default generator floor tile 
     */
    _floorTile() {
        const tile = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
        if (this.config.defaultFloorTint) tile.tint = this.config.defaultFloorTint;
        return tile;
    }

    // ========================================================================
    // INFRASTRUCTURE
    // ========================================================================

    createEmptyMap() {
        return Array.from({ length: this.height }, () =>
            Array.from({ length: this.width }, () => null)
        );
    }
    getLayer(layerName) {
        const layers = {
            'background': this.backgroundMap,
            'floor': this.floorMap,
            'wildcards': this.wildcardMap,
            'overlay': this.overlayMap
        };
        return layers[layerName] || null;
    }

    getTile(layerName, x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return null;
        }
        const layer = this.getLayer(layerName);
        if (!layer) return null;

        const tile = layer[y][x];
        return tile ? tile.tileId : null;
    }

    setTile(layerName, x, y, tileId) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return;
        }
        const layer = this.getLayer(layerName);
        if (!layer) return;

        if (tileId === null) {
            layer[y][x] = null;
        } else {
            layer[y][x] = { tileId, layer: layerName };
        }
    }

    /**
     * Seal the outer ring so the map can't be walked off: every perimeter cell that
     * isn't floor and isn't already a queued wall becomes a metal_wall.
     *
     * @param {(x:number,y:number)=>boolean} hasFloor  is this cell floor?
     * @param {number} mapW 
     * @param {number} mapH
     */
    _fillPerimeterGaps(hasFloor, mapW, mapH) {
        const isPerimeter = (px, py) => px === 0 || px === mapW - 1 || py === 0 || py === mapH - 1;
        const pendingWallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (!isPerimeter(x, y)) continue;
                if (hasFloor(x, y)) continue;
                if (pendingWallSet.has(`${x},${y}`)) continue;
                if (!anyNeighbor8(hasFloor, x, y)) continue;

                this.floorMap[y][x] = this._floorTile();
                this.pendingWallSpawns.push({ x, y, type: 'metal_wall' });
            }
        }
    }

    /**
     * Pick from a [{ type, weight }] table, weighted by `weight`. Returns null on an
     * empty table so callers can supply their own fallback. The trailing return
     * covers floating-point remainder, where the roll never quite reaches zero.
     */
    _pickWeighted(table) {
        if (!table || table.length === 0) return null;
        const totalWeight = table.reduce((sum, wt) => sum + wt.weight, 0);
        let roll = ROT.RNG.getUniform() * totalWeight;
        for (const wt of table) {
            roll -= wt.weight;
            if (roll <= 0) return wt.type;
        }
        return table[0].type;
    }

    /** Pick a wall type from a [{ type, weight }] table, weighted by `weight`. */
    _pickWeightedWallType(wallTypes) {
        return this._pickWeighted(wallTypes) ?? 'wall';
    }

    /**
     * Is this blob type one nothing should spawn on? Drives hazardCells, which
     * _blobRebuildWalkableTiles subtracts from walkableTiles — so an item never
     * lands in lava and a monster never starts sunk in quicksand.
     *
     * Reads the list in globals rather than the actor's own `damage_type`/`deep`,
     * because blobs are placed during generation, before any actor exists to ask.
     */
    _isHazardousBlobType(type) {
        return globalVars.HAZARD_BLOB_ACTORS.includes(type);
    }

    /**
     * Normalize a blob `types` config to a [{ type, weight }] table.
     *
     * Two authored shapes. The repeated-string pool — ["water","sewage","sewage"] —
     * is how every lakes/abyss block in the repo is written today, and weights by
     * duplication; it keeps working. The object form carries real weights, which is
     * what the editor writes and what scales past a handful of entries.
     *
     * Whether each id names a real actor can't be checked here — generation runs
     * before the spawn context exists. spawnPendingLiquids does it, warning per
     * unknown type instead of silently painting water the way the old routing
     * ternary did (a typo produced a water lake and said nothing).
     */
    _normalizeBlobTypes(types) {
        if (!Array.isArray(types) || types.length === 0) return [{ type: 'water', weight: 1 }];

        const table = [];
        for (const entry of types) {
            const type = typeof entry === 'string' ? entry : entry?.type;
            if (!type) continue;
            const weight = typeof entry === 'string' ? 1 : (Number(entry.weight) || 0);
            if (weight <= 0) continue;

            const existing = table.find(t => t.type === type);
            if (existing) existing.weight += weight;
            else table.push({ type, weight });
        }
        return table.length ? table : [{ type: 'water', weight: 1 }];
    }

    _carveRect(dungeonGrid, x1, y1, x2, y2, value = 1) {
        for (let y = Math.max(0, y1); y <= Math.min(this.height - 1, y2); y++) {
            for (let x = Math.max(0, x1); x <= Math.min(this.width - 1, x2); x++) {
                if (dungeonGrid[y][x] < value) dungeonGrid[y][x] = value;
            }
        }
    }

    _carveWanderingPath(from, to, isBarrier) {
        const path = [];
        const collected = new Set();
        let x = from.x;
        let y = from.y;
        const stepCap = (Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) * 6 + 40;
        let jogDirection = null;
        let jogStepsLeft = 0;

        for (let step = 0; step < stepCap && (x !== to.x || y !== to.y); step++) {
            const towardX = Math.sign(to.x - x);
            const towardY = Math.sign(to.y - y);
            // Whichever axis has further to go; the causeway closes that one and
            // wanders on the other.
            const preferX = Math.abs(to.x - x) > Math.abs(to.y - y);
            const direct = preferX || towardY === 0 ? [towardX, 0] : [0, towardY];

            let dx;
            let dy;
            if (jogStepsLeft > 0) {
                // A jog runs for a few steps: wander only one and the next step
                // corrects it straight back.
                [dx, dy] = jogDirection;
                jogStepsLeft--;
            } else if (ROT.RNG.getUniform() < 0.3) {
                // Turn across the direction of travel and commit to it.
                const sideways = ROT.RNG.getUniform() < 0.5 ? 1 : -1;
                [dx, dy] = preferX ? [0, towardY !== 0 ? towardY : sideways]
                                   : [towardX !== 0 ? towardX : sideways, 0];
                jogDirection = [dx, dy];
                jogStepsLeft = 1 + Math.floor(ROT.RNG.getUniform() * 3);
            } else {
                [dx, dy] = direct;
            }

            // Every step is a single cardinal move, so the cells form one
            // unbroken 4-connected run. A diagonal would leave the "path" as two
            // corner-touching fragments the player cannot actually walk.
            let nx = x + dx;
            let ny = y + dy;
            if (nx < 2 || nx >= this.width - 2 || ny < 2 || ny >= this.height - 2) {
                nx = x + direct[0];
                ny = y + direct[1];
                jogStepsLeft = 0;
                if (nx < 2 || nx >= this.width - 2 || ny < 2 || ny >= this.height - 2) break;
            }

            x = nx;
            y = ny;
            const key = `${x},${y}`;
            // Only barrier cells need carving; steps that stray onto existing
            // shore are already walkable and simply carry the path along.
            if (isBarrier(x, y) && !collected.has(key)) {
                collected.add(key);
                path.push({ x, y });
            }
        }

        return path;
    }


    // 4-way flood fill over walkable cells. _dungeonBFS is not reused: it is a
    // capped-distance point-to-point search returning -1 for both "unreachable"
    // and "over budget", which cannot answer a connectivity question.
    _floodFillRegion(dungeonGrid, sx, sy) {
        const seen = new Set();
        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) return seen;
        if (dungeonGrid[sy][sx] < 1) return seen;
        const queue = [[sx, sy]];
        seen.add(`${sx},${sy}`);
        while (queue.length) {
            const [x, y] = queue.pop();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
                const k = `${nx},${ny}`;
                if (seen.has(k) || dungeonGrid[ny][nx] < 1) continue;
                seen.add(k);
                queue.push([nx, ny]);
            }
        }
        return seen;
    }

    getNeighbors(layerName, x, y) {
        return {
            n:  this.getTile(layerName, x, y - 1),
            s:  this.getTile(layerName, x, y + 1),
            e:  this.getTile(layerName, x + 1, y),
            w:  this.getTile(layerName, x - 1, y),
            ne: this.getTile(layerName, x + 1, y - 1),
            nw: this.getTile(layerName, x - 1, y - 1),
            se: this.getTile(layerName, x + 1, y + 1),
            sw: this.getTile(layerName, x - 1, y + 1)
        };
    }

    forEach(layerName, callback, includeEmpty = false) {
        const layer = this.getLayer(layerName);
        if (!layer) return;

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = layer[y][x];
                const tileId = tile ? tile.tileId : null;

                if (includeEmpty || tileId !== null) {
                    callback(x, y, tileId);
                }
            }
        }
    }

    /**
     * Paint a tile pattern onto a layer by evaluating an ordered rule list at every
     * cell — a small cellular automaton with designer-supplied rules.
     *
     * See docs/TILE_PATTERNS.md for the full rule-authoring guide.
     *
     * Writes tiles. To place entities on the floor instead, use
     * EntityManager.placeBiomeDecorations in engine/entity-manager/spawning.js.
     *
     * @param {string} layerName  background | floor | wildcards | overlay
     * @param {Array}  rules      ordered [{ when, paint, collect? }]; first match wins
     * @param {object} options    { passes, order, bounds, collect }
     *   - bounds  {x1,y1,x2,y2} inclusive. Limits which cells are visited; rules can
     *             still read, and ctx.paint can still write, anywhere on the map.
     *   - collect true -> returns Array<{x,y}>; 'set' -> returns Set<"x,y">.
     *             Painting still happens as normal. Set `collect: false` on a rule
     *             to leave the cells it matches out of the result.
     * @returns {number|Array|Set} painted count, or the matched cells when collecting
     */
    applyTilePattern(layerName, rules, options = {}) {
        const layer = this.getLayer(layerName);
        if (!layer) {
            console.warn(`applyTilePattern: unknown layer "${layerName}"`);
            return 0;
        }

        const collectMode = options.collect;
        const asSet = collectMode === 'set';
        const collected = collectMode ? (asSet ? new Set() : []) : null;
        const emptyResult = () => (collectMode ? collected : 0);

        if (!Array.isArray(rules) || rules.length === 0) return emptyResult();

        const passes = options.passes ?? 1;
        const reverse = options.order === 'reverse';
        let painted = 0;

        // Cells to visit. Defaults to the whole map.
        const b = options.bounds;
        const x1 = Math.max(0, b?.x1 ?? 0);
        const y1 = Math.max(0, b?.y1 ?? 0);
        const x2 = Math.min(this.width - 1, b?.x2 ?? this.width - 1);
        const y2 = Math.min(this.height - 1, b?.y2 ?? this.height - 1);
        if (x2 < x1 || y2 < y1) {
            // An inverted or off-map box visits nothing.
            console.warn(`applyTilePattern: empty bounds on "${layerName}"`, b);
            return emptyResult();
        }

        const matches = (tileId, value) =>
            Array.isArray(value) ? value.includes(tileId) : tileId === value;

        const tileContext = {
            width: this.width,
            height: this.height,
            inBounds: (x, y) => x >= 0 && x < this.width && y >= 0 && y < this.height,
            get: (x, y) => this.getTile(layerName, x, y),
            is: (x, y, value) => matches(this.getTile(layerName, x, y), value),
            on: (otherLayer, x, y) => this.getTile(otherLayer, x, y),
            isOn: (otherLayer, x, y, value) => matches(this.getTile(otherLayer, x, y), value),
            paint: (x, y, tileId) => {
                this.setTile(layerName, x, y, tileId);
                painted++;
            },
            // Neighbour tests. `pred` takes (tileContext, x, y) — the same shape as
            // a rule's `when`, so the two are interchangeable. Off-map neighbours are
            // passed to `pred` and read as null; check ctx.inBounds if that matters.
            count4: (pred, x, y) => {
                let n = 0;
                for (const [dx, dy] of TP_DIRS4) if (pred(tileContext, x + dx, y + dy)) n++;
                return n;
            },
            count8: (pred, x, y) => {
                let n = 0;
                for (const [dx, dy] of TP_DIRS8) if (pred(tileContext, x + dx, y + dy)) n++;
                return n;
            },
            any4: (pred, x, y) => TP_DIRS4.some(([dx, dy]) => pred(tileContext, x + dx, y + dy)),
            any8: (pred, x, y) => TP_DIRS8.some(([dx, dy]) => pred(tileContext, x + dx, y + dy))
        };

        for (let pass = 0; pass < passes; pass++) {
            for (let i = 0; i <= y2 - y1; i++) {
                const y = reverse ? y2 - i : y1 + i;
                for (let j = 0; j <= x2 - x1; j++) {
                    const x = reverse ? x2 - j : x1 + j;

                    for (const rule of rules) {
                        if (!rule || typeof rule.when !== 'function') continue;
                        if (!rule.when(tileContext, x, y)) continue;

                        const tileId = typeof rule.paint === 'function'
                            ? rule.paint(tileContext, x, y)
                            : rule.paint;
                        if (tileId !== null && tileId !== undefined) {
                            this.setTile(layerName, x, y, tileId);
                            painted++;
                        }
                        // A rule can both paint and be collected. collect:false
                        // matches the cell but keeps it out of the result.
                        if (collected && rule.collect !== false) {
                            if (asSet) collected.add(`${x},${y}`);
                            else collected.push({ x, y });
                        }
                        break; // first match wins
                    }
                }
            }
        }

        return collected ?? painted;
    }

    _finalizeMap(dungeonGrid, rooms, mapW, mapH, cfg, secretWalls = []) {
        const secretWallSet = new Set(secretWalls.map(p => `${p.x},${p.y}`));
        const floorSet = new Set();

        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (dungeonGrid[y][x] >= 1) {
                    this.floorMap[y][x] = this._floorTile();
                    this.walkableTiles.push({ x, y });
                    floorSet.add(`${x},${y}`);
                }
            }
        }

        const hasFloor = (fx, fy) => floorSet.has(`${fx},${fy}`);
        const wallTypes = cfg.wall_types;
        const isPerimeter = (px, py) => px === 0 || px === mapW - 1 || py === 0 || py === mapH - 1;

        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (floorSet.has(`${x},${y}`)) continue;
                const adj = anyNeighbor8(hasFloor, x, y);

                if (adj && y > 0) {
                    this.floorMap[y][x] = this._floorTile();
                    if (secretWallSet.has(`${x},${y}`)) {
                        // Every dead-end shortcut becomes a findable door.
                        //
                        // These cells are the wall at the end of a blind corridor
                        // with floor 2-3 tiles behind it — the one spot the player
                        // will actually think to search. Handing most of them to
                        // pushable walls (which read as solid rock) is what leaves
                        // hallways looking like they simply stop: in Brogue a dead
                        // end is nearly always a room hiding behind a secret door,
                        // not a shove puzzle. secretDoorChance still gates the
                        // *interior-wall* pass below, where a wall between two open
                        // spaces is a fair coin toss; here it is not.
                        this.pendingSecretDoorSpawns.push({ x, y });
                    } else {
                        const wallType = this._pickWeightedWallType(wallTypes);
                        this.pendingWallSpawns.push({ x, y, type: isPerimeter(x, y) ? 'metal_wall' : wallType });
                    }
                }
            }
        }

        this._fillPerimeterGaps(hasFloor, mapW, mapH);

        // Door spawns
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (dungeonGrid[y][x] === 2 && y > 0 && ROT.RNG.getPercentage() <= cfg.doorChance) {
                    this.pendingDoorSpawns.push({ x, y });
                }
            }
        }

        // Room lighting: wall torches per room, count scaled to room size and spaced
        // apart, plus a centre brazier in halls big enough to warrant one.
        for (const room of rooms) {
            if (ROT.RNG.getPercentage() > cfg.torchChance) continue;
            const roomWalls = [];
            for (const wallPos of this.pendingWallSpawns) {
                if (wallPos.type === 'metal_wall') continue;
                if (wallPos.x >= room._x1 - 1 && wallPos.x <= room._x2 + 1 &&
                    wallPos.y >= room._y1 - 1 && wallPos.y <= room._y2 + 1) {
                    roomWalls.push(wallPos);
                }
            }
            if (roomWalls.length > 0) {
                this.queueRoomLights(
                    roomWalls, this.countRoomFloorTiles(room, floorSet), room, floorSet
                );
            }
        }

        this.diggerRooms = rooms;
        this.publishRoomRegions(rooms, floorSet);
    }

    /**
     * Publish generic room-based named regions, so `"region": "..."` on a spawn entry
     * works on ordinary generated floors and not just the ones with bespoke regions.
     *
     * `largest_room` is the biggest single room by floor area — a natural arena for a
     * guaranteed boss or a hoard. Skipped when a generator has already published a
     * region of the same name, so bespoke regions always win.
     *
     * @param {Array} rooms - room records (the diggerRooms duck type)
     * @param {Set<string>} floorSet - "x,y" keys of actual floor, since a room's bbox
     *   can include non-floor cells for L/T/+ shaped rooms
     */
    publishRoomRegions(rooms, floorSet) {
        if (!rooms || rooms.length === 0) return;

        const tilesOf = (room) => {
            const tiles = [];
            for (let y = room._y1; y <= room._y2; y++) {
                for (let x = room._x1; x <= room._x2; x++) {
                    if (floorSet.has(`${x},${y}`)) tiles.push({ x, y });
                }
            }
            return tiles;
        };

        let best = null, bestTiles = null;
        for (const room of rooms) {
            const tiles = tilesOf(room);
            if (!bestTiles || tiles.length > bestTiles.length) { best = room; bestTiles = tiles; }
        }
        if (best && bestTiles.length > 0 && !this.namedRegions.largest_room) {
            this.namedRegions.largest_room = bestTiles;
        }
    }

    /**
     * Floor cells a room actually owns. A shaped (L/T/+) room's bounding box
     * includes cells that were never dug, so bbox area overstates its real size.
     *
     * @param {{_x1:number,_y1:number,_x2:number,_y2:number}} room
     * @param {Set<string>} floorSet - "x,y" keys of real floor
     * @returns {number}
     */
    countRoomFloorTiles(room, floorSet) {
        if (!floorSet) {
            // No floor set available: fall back to bbox area.
            return (room._x2 - room._x1 + 1) * (room._y2 - room._y1 + 1);
        }
        let count = 0;
        for (let y = room._y1; y <= room._y2; y++) {
            for (let x = room._x1; x <= room._x2; x++) {
                if (floorSet.has(`${x},${y}`)) count++;
            }
        }
        return count;
    }

    /**
     * Light one room: wall-mounted `wall_torch` actors spaced around its walls, plus a
     * freestanding `brazier` in the middle of a very large room.
     *
     * Torch count scales with floor area, not the bounding box. Wall placement is
     * farthest-point: seed with a random eligible wall, then repeatedly take the
     * candidate maximising distance to the nearest torch already chosen.
     *
     * Chosen wall cells are removed from pendingWallSpawns, since the torch actor
     * replaces the wall actor there. The centre brazier sits on floor and takes no
     * wall cell.
     *
     * @param {Array<{x:number,y:number}>} roomWalls - eligible wall cells for this
     *   room, already filtered by the caller (mask, wall type, etc.)
     * @param {number} floorTileCount - floor cells belonging to this room
     * @param {{_x1:number,_y1:number,_x2:number,_y2:number}} [room] - for centring
     *   the brazier; omit to skip the centre brazier entirely
     * @param {Set<string>} [floorSet] - "x,y" keys of real floor, so the brazier
     *   lands on floor and not in the notch of a shaped room
     * @returns {{torches:number, braziers:number}}
     */
    queueRoomLights(roomWalls, floorTileCount, room = null, floorSet = null) {
        if (!roomWalls || roomWalls.length === 0) return { torches: 0, braziers: 0 };

        // One torch per ~35 floor tiles: a 5x5 closet keeps its single light, while
        // a 12x12 hall earns four. Capped so a cavernous room does not turn into a
        // ring of fire, and by the eligible wall count.
        const TILES_PER_TORCH = 35;
        const MAX_TORCHES = 4;
        const target = Math.min(
            MAX_TORCHES,
            roomWalls.length,
            Math.max(1, Math.round(floorTileCount / TILES_PER_TORCH))
        );

        const candidates = [...roomWalls];
        const chosen = [];
        const firstIndex = Math.floor(ROT.RNG.getUniform() * candidates.length);
        chosen.push(candidates.splice(firstIndex, 1)[0]);

        while (chosen.length < target && candidates.length > 0) {
            let bestIndex = 0;
            let bestDistance = -1;
            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i];
                let nearest = Infinity;
                for (const placed of chosen) {
                    const distance = Math.max(
                        Math.abs(candidate.x - placed.x),
                        Math.abs(candidate.y - placed.y)
                    );
                    if (distance < nearest) nearest = distance;
                }
                if (nearest > bestDistance) {
                    bestDistance = nearest;
                    bestIndex = i;
                }
            }
            // Two torches on adjacent wall cells look like a mistake rather than a
            // design, so stop early instead of padding out to the target.
            if (bestDistance < 3) break;
            chosen.push(candidates.splice(bestIndex, 1)[0]);
        }

        // The light replaces the actor on the chosen cell, so it must match that
        // actor's opacity. Wall-run cells become `wall_torch` (opaque, like the wall
        // it replaces); free-standing architecture becomes a `brazier` (non-opaque,
        // like the column), preserving sightlines through a colonnade.
        let extraBraziers = 0;
        for (const pos of chosen) {
            if (FREESTANDING_WALL_TYPES.has(pos.type)) {
                this.pendingBrazierSpawns.push({ x: pos.x, y: pos.y });
                extraBraziers++;
            } else {
                this.pendingTorchSpawns.push({ x: pos.x, y: pos.y });
            }
            const idx = this.pendingWallSpawns.findIndex(p => p.x === pos.x && p.y === pos.y);
            if (idx !== -1) this.pendingWallSpawns.splice(idx, 1);
        }

        const braziers = (this.queueCentreBrazier(room, floorTileCount, floorSet) ? 1 : 0)
            + extraBraziers;
        return { torches: chosen.length - extraBraziers, braziers };
    }

    /**
     * Put a brazier at the middle of a room, but only when the room is big enough
     * that a centrepiece reads as deliberate rather than as an obstacle.
     *
     * Prefers the exact bbox centre and walks outward to the nearest real floor
     * cell, so a shaped room whose geometric centre falls in the missing arm of an
     * L still gets a sensible spot. Gives up rather than placing badly.
     *
     * @returns {boolean} whether a brazier was queued
     */
    queueCentreBrazier(room, floorTileCount, floorSet) {
        // A brazier is a centrepiece for a hall, not furniture for an ordinary room.
        const MIN_FLOOR_FOR_BRAZIER = 100;
        if (!room || floorTileCount < MIN_FLOOR_FOR_BRAZIER) return false;

        const centreX = Math.floor((room._x1 + room._x2) / 2);
        const centreY = Math.floor((room._y1 + room._y2) / 2);
        const isFree = (x, y) => {
            if (x < room._x1 || x > room._x2 || y < room._y1 || y > room._y2) return false;
            if (floorSet && !floorSet.has(`${x},${y}`)) return false;
            if (!floorSet && !this.isWalkable(x, y)) return false;
            // Never bury a doorway or another queued feature under the brazier.
            if (this.pendingDoorSpawns.some(p => p.x === x && p.y === y)) return false;
            if (this.pendingTorchSpawns.some(p => p.x === x && p.y === y)) return false;
            if (this.pendingBrazierSpawns.some(p => p.x === x && p.y === y)) return false;
            return true;
        };

        // Spiral outward from the centre until a free floor cell turns up.
        const maxRadius = Math.max(room._x2 - room._x1, room._y2 - room._y1);
        for (let radius = 0; radius <= maxRadius; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    // Only the ring at this radius; inner rings were already tried.
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                    const x = centreX + dx;
                    const y = centreY + dy;
                    if (isFree(x, y)) {
                        this.pendingBrazierSpawns.push({ x, y });
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    getRandomWalkableTile() {
        if (this.walkableTiles.length === 0) return { x: 0, y: 0 };
        return this.walkableTiles[Math.floor(ROT.RNG.getUniform() * this.walkableTiles.length)];
    }

    isWalkable(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        return this.floorMap[y][x]?.tileId === this.config.defaultFloorTileId;
    }

    /**
     * One of the visually opinionated things that DMK does is draw background tiles in areas with no floor
     * to make it look like there are hard diagonal shadows on cliff faces.
     * 
     **/
    addBaseAndShadows(bounds = null) {
        // The three tile values live in globalVars (globals.js)
        const SHADE = globalVars.VOID_SHADE;
        const DIAGONAL = globalVars.VOID_DIAGONAL;

        // Flat void on the FLOOR layer means void, not walkable floor.
        const hasFloor = (tileContext, x, y) => {
            const t = tileContext.on('floor', x, y);
            return t !== null && !globalVars.VOID_FLOOR_FILLS.includes(t);
        };

        // Void this pass hasn't painted over yet. Excluding the paint values is what
        // stops the automaton re-reading its own output as fresh input.
        const isUnpaintedVoid = (tileContext, x, y) => {
            const bg = tileContext.get(x, y);
            if (bg === null || bg === SHADE || bg === DIAGONAL) return false;
            return globalVars.VOID_TILE_IDS.includes(bg);
        };

        // Only unpainted void with no floor is eligible; every rule below assumes it.
        const eligible = (tileContext, x, y) =>
            isUnpaintedVoid(tileContext, x, y) && !hasFloor(tileContext, x, y);

        this.applyTilePattern('background', [
            // 1. Start a diagonal at the top-left corner of a cliff drop.
            {
                when: (tileContext, x, y) => eligible(tileContext, x, y) &&
                    hasFloor(tileContext, x, y - 1) &&
                    (hasFloor(tileContext, x - 1, y) || !hasFloor(tileContext, x - 1, y - 1)),
                paint: DIAGONAL
            },

            // 2. Continue the diagonal down-right: reads the cell rule 1 wrote
            //    up-left of here, plus shade already laid down directly above.
            {
                when: (tileContext, x, y) => eligible(tileContext, x, y) &&
                    tileContext.is(x - 1, y - 1, DIAGONAL) &&
                    tileContext.is(x, y - 1, SHADE),
                paint: DIAGONAL
            },

            // 3. Flood the shadow body rightward from a diagonal edge, for as long as
            //    the run stays void, floorless and sheltered from above. Paints the
            //    whole run itself, so it returns null to avoid a second write here.
            {
                when: (tileContext, x, y) => eligible(tileContext, x, y) &&
                    tileContext.is(x - 1, y, DIAGONAL) &&
                    (hasFloor(tileContext, x, y - 1) || tileContext.is(x, y - 1, SHADE)),
                paint: (tileContext, x, y) => {
                    for (let xPos = x; xPos < tileContext.width; xPos++) {
                        if (!eligible(tileContext, xPos, y)) break;
                        if (!hasFloor(tileContext, xPos, y - 1) && !tileContext.is(xPos, y - 1, SHADE)) break;
                        tileContext.paint(xPos, y, SHADE);
                    }
                    return null;
                }
            }
        ], bounds ? { bounds } : {});
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    serializeMap() {
        return {
            width: this.width,
            height: this.height,
            floorMap: this.floorMap,
            backgroundMap: this.backgroundMap,
            wildcardMap: this.wildcardMap,
            overlayMap: this.overlayMap,
            walkableTiles: this.walkableTiles
        };
    }

    deserializeMap(data) {
        this.width = data.width;
        this.height = data.height;
        this.floorMap = data.floorMap;
        this.backgroundMap = data.backgroundMap;
        this.wildcardMap = data.wildcardMap;
        this.overlayMap = data.overlayMap || this.createEmptyMap();
        this.walkableTiles = data.walkableTiles;
    }

    cleanup() {
        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.overlayMap = this.createEmptyMap();
        this.walkableTiles = [];
        this.pendingWallSpawns = [];
        this.pendingDoorSpawns = [];
        // Wall-mounted torch actors; centre braziers are freestanding, tracked apart.
        this.pendingTorchSpawns = [];
        this.pendingBrazierSpawns = [];
        // Liquid blob cells, each carrying the actor id to spawn there ({x, y, type}).
        // One queue rather than one per liquid: the type is data, not a routing key.
        this.pendingLiquidSpawns = [];
        this.pendingPushableWallSpawns = [];
        this.pendingSecretDoorSpawns = [];
        this.pendingHiddenLeverSpawns = [];
        this.pendingBridgeSpawns = [];
        this.pendingCollapsingFloorSpawns = [];
        // Floor carved across an abyss to reconnect a stranded region. Tracked so
        // a collapsing floor never drops the player through their only route out.
        this._causewayCells = new Set();
        this.diggerRooms = null;
        this.claimedRoomIndices = new Set();
        this.namedRegions = {};
        this.suggestedStairwayRegions = {};
        this.actorWildcardCache = null;
    }
}

installMethods(Architect, ArchitectTiled, ArchitectProcedural, ArchitectBlobs, ArchitectBridges, ArchitectRegions, ArchitectSpawning, ArchitectBrogue, ArchitectPalladian);
