const TILED_FLIP_MASK = 0x1FFFFFFF;
const TILED_FLIP_H = 0x80000000;
const TILED_FLIP_V = 0x40000000;
const TILED_FLIP_D = 0x20000000;

// pendingWallSpawns types that are free-standing architecture rather than part of
// a wall run. A light source replacing one becomes a `brazier`;
// everything else becomes a `wall_torch`.
const FREESTANDING_WALL_TYPES = new Set(['column']);

// Neighbour offsets used by the helpers below and by applyTilePattern's tileContext.
const TP_DIRS4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const TP_DIRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * True when any of the 8 neighbours of (x, y) satisfies `pred(x, y)` — the
 * "is this cell next to floor?" test.
 * Inside a tile pattern use tileContext.any8, whose predicate also takes the context.
 */
function anyNeighbor8(pred, x, y) {
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

class Architect {
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
        this.pendingLavaSpawns = [];
        this.pendingLakeSpawns = [];
        this.pendingSewageSpawns = [];
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
            ...options.config
        };
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

                this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                this.pendingWallSpawns.push({ x, y, type: 'metal_wall' });
            }
        }
    }

    /** Pick a wall type from a [{ type, weight }] table, weighted by `weight`. */
    _pickWeightedWallType(wallTypes) {
        if (!wallTypes || wallTypes.length === 0) return 'wall';
        const totalWeight = wallTypes.reduce((sum, wt) => sum + wt.weight, 0);
        let roll = ROT.RNG.getUniform() * totalWeight;
        for (const wt of wallTypes) {
            roll -= wt.weight;
            if (roll <= 0) return wt.type;
        }
        return wallTypes[0].type;
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


    // 4-way flood fill over walkable cells. _brogueBFS is not reused: it is a
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
     * EntityManager.placeBiomeDecorations in engine.js.
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

    // ========================================================================
    // TILED MAP LOADING
    // ========================================================================

    async loadTiledMap(mapPath, options = {}) {
        console.log(`Loading Tiled map: ${mapPath}`);

        try {
            const response = await fetch(mapPath);
            const tiledData = await response.json();

            this.width = tiledData.width;
            this.height = tiledData.height;
            this.tileWidth = tiledData.tilewidth;
            this.tileHeight = tiledData.tileheight;

            this.backgroundMap = this.createEmptyMap();
            this.floorMap = this.createEmptyMap();
            this.wildcardMap = this.createEmptyMap();
            this.overlayMap = this.createEmptyMap();

            this.objectLayers = [];

            console.log(`Map dimensions: ${this.width}x${this.height}`);

            for (const layer of tiledData.layers) {
                if (layer.type === 'tilelayer') {
                    if (layer.name === 'floor' && !options.skipFloorLayer) {
                        this.processFloorLayer(layer);
                    } else if (layer.name === 'background') {
                        this.processBackgroundLayer(layer);
                    } else if (layer.name === 'wildcards' && !options.skipFloorLayer) {
                        console.log('Found wildcards layer, processing...');
                        this.processWildcardLayer(layer);
                    } else if (layer.name === 'overlay') {
                        this.processOverlayLayer(layer);
                    }
                } else if (layer.type === 'objectgroup') {
                    this.objectLayers.push(layer);
                }
            }

            console.log(`Tiled map loaded successfully`);
            console.log(`Walkable tiles: ${this.walkableTiles.length}`);
            console.log(`Object layers: ${this.objectLayers.length}`);
        } catch (error) {
            console.error('Failed to load Tiled map:', error);
            throw error;
        }
    }

    parseTileGID(rawId) {
        return {
            tileId: rawId & TILED_FLIP_MASK,
            flipH: (rawId & TILED_FLIP_H) !== 0,
            flipV: (rawId & TILED_FLIP_V) !== 0,
            flipD: (rawId & TILED_FLIP_D) !== 0,
        };
    }

    processBackgroundLayer(layer) {
        console.log('Processing background layer...');
        //why are we still doing this remap? globals already has both opaque and transparent background tiles
        //and we don't use the transparent for background any more, just fix it
        const VOID_REMAP = {
            217: globalVars.VOID_FILL,      // FULL_BLOCK
            178: globalVars.VOID_SHADE,     // DARK_SHADE
            128: globalVars.VOID_DIAGONAL   // shadow diagonal
        };

        let remapped = 0;
        for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
                const index = y * layer.width + x;
                const { tileId, flipH, flipV, flipD } = this.parseTileGID(layer.data[index]);

                if (tileId > 0) {
                    let id = tileId;
                    if (VOID_REMAP[id] !== undefined && VOID_REMAP[id] !== id) {
                        id = VOID_REMAP[id];
                        remapped++;
                    }
                    this.backgroundMap[y][x] = { tileId: id, layer: 'background', flipH, flipV, flipD };
                }
            }
        }

        if (remapped > 0) {
            console.log(`Background: remapped ${remapped} authored void tiles to the opaque set`);
        }
    }

    processOverlayLayer(layer) {
        console.log('Processing overlay layer...');
        for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
                const index = y * layer.width + x;
                const { tileId, flipH, flipV, flipD } = this.parseTileGID(layer.data[index]);

                if (tileId > 0) {
                    this.overlayMap[y][x] = { tileId, layer: 'overlay', flipH, flipV, flipD };
                }
            }
        }
    }

    processFloorLayer(layer) {
        console.log('Processing floor layer...');
        for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
                const index = y * layer.width + x;
                const { tileId, flipH, flipV, flipD } = this.parseTileGID(layer.data[index]);

                if (tileId > 0) {
                    this.floorMap[y][x] = { tileId, layer: 'floor', flipH, flipV, flipD };
                    this.backgroundMap[y][x] = null;
                    this.walkableTiles.push({ x, y });
                }
            }
        }
    }

    processWildcardLayer(layer) {
        let wildcardCount = 0;
        const typeCounts = {};

        for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
                const index = y * layer.width + x;
                const tileId = layer.data[index] & TILED_FLIP_MASK;

                if (tileId > 0) {
                    const type = this.getWildcardType(tileId);
                    this.wildcardMap[y][x] = { type, tileId };
                    wildcardCount++;
                    typeCounts[type] = (typeCounts[type] || 0) + 1;
                }
            }
        }

        console.log(`Processed ${wildcardCount} wildcard tiles:`, typeCounts);
    }

    getWildcardType(tileId, context = null) {
        const builtinWildcards = {
            210: 'maze',
            9: 'dungeon',
            16: 'dungeon',
            152: 'dungeon',
            10: 'cave',
            230: 'infernal',
            143: 'room',
            144: 'room',
            226: 'palladian',       // CROWN
            12: 'item_spawn',
            3: 'actor_spawn',
            218: 'abyss'
        };

        if (builtinWildcards[tileId]) {
            return builtinWildcards[tileId];
        }

        if (context) {
            const actorType = this.getActorWildcardType(tileId, context);
            if (actorType) return actorType;
        }

        return 'unknown';
    }

    getActorWildcardType(tileId, context) {
        if (!context || !context.getPrototypeActors || !context.getTileIdByName) {
            return null;
        }

        if (!this.actorWildcardCache) {
            this.actorWildcardCache = {};
            const actors = context.getPrototypeActors();
            if (actors) {
                for (const [actorType, actorData] of Object.entries(actors)) {
                    const paintTile = actorData.attributes?.paint_tile;
                    if (paintTile) {
                        const paintTileId = context.getTileIdByName(paintTile);
                        if (paintTileId) {
                            this.actorWildcardCache[paintTileId] = actorType;
                        }
                    }
                }
            }
        }
        return this.actorWildcardCache[tileId] || null;
    }

    clearWildcardCache() {
        this.actorWildcardCache = null;
    }

    resolveUnknownWildcards(context) {
        let resolvedCount = 0;
        const typeCounts = {};

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const wildcard = this.wildcardMap[y][x];
                if (wildcard && wildcard.type === 'unknown') {
                    const resolvedType = this.getWildcardType(wildcard.tileId, context);
                    if (resolvedType !== 'unknown') {
                        wildcard.type = resolvedType;
                        resolvedCount++;
                        typeCounts[resolvedType] = (typeCounts[resolvedType] || 0) + 1;
                    }
                }
            }
        }

        if (resolvedCount > 0) {
            console.log(`Resolved ${resolvedCount} unknown wildcards:`, typeCounts);
        }
    }

    // ========================================================================
    // PROCEDURAL GENERATION
    // ========================================================================

    generateProceduralMap(generatorConfig = {}) {
        const generatorType = generatorConfig.type || 'digger';
        const options = generatorConfig.options || {};

        if (options.map_width) this.width = options.map_width;
        if (options.map_height) this.height = options.map_height;

        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.overlayMap = this.createEmptyMap();
        this.walkableTiles = [];

        console.log(`Generating procedural map with ${generatorType} generator (${this.width}x${this.height})`);

        let generator;

        switch (generatorType) {
            case 'cellular': {
                generator = new ROT.Map.Cellular(this.width, this.height, {
                    born: options.born || [5, 6, 7, 8],
                    survive: options.survive || [4, 5, 6, 7, 8],
                    topology: options.topology || 8
                });
                generator.randomize(options.probability || 0.5);
                const iterations = options.iterations || 4;
                for (let i = 0; i < iterations - 1; i++) {
                    generator.create();
                }
                const floorTiles = new Set();
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                        floorTiles.add(`${x},${y}`);
                    }
                });
                if (options.connected !== false) {
                    generator.connect((x, y, value) => {
                        if (value === 0 && !this.floorMap[y][x]) {
                            this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                            this.walkableTiles.push({ x, y });
                            floorTiles.add(`${x},${y}`);
                        }
                    }, 1);
                }
                const wallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (!floorTiles.has(`${x},${y}`)) {
                            this.pendingWallSpawns.push({ x, y, type: this._pickWeightedWallType(wallTypes) });
                        }
                    }
                }
                break;
            }

            case 'uniform':
                generator = new ROT.Map.Uniform(this.width, this.height, {
                    roomWidth: options.roomWidth || [3, 9],
                    roomHeight: options.roomHeight || [3, 5],
                    roomDugPercentage: options.roomDugPercentage || 0.1
                });
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'rogue':
                generator = new ROT.Map.Rogue(this.width, this.height, {
                    cellWidth: options.cellWidth || 3,
                    cellHeight: options.cellHeight || 3,
                    roomWidth: options.roomWidth || [3, 9],
                    roomHeight: options.roomHeight || [3, 5]
                });
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'divided_maze':
                generator = new ROT.Map.DividedMaze(this.width, this.height);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'icey_maze':
                generator = new ROT.Map.IceyMaze(this.width, this.height, options.regularity || 0);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'eller_maze':
                generator = new ROT.Map.EllerMaze(this.width, this.height);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'arena':
                generator = new ROT.Map.Arena(this.width, this.height);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'infernal': {
                const infernalCave = new ROT.Map.Cellular(this.width, this.height, {
                    born: options.born || [5, 6, 7, 8],
                    survive: options.survive || [4, 5, 6, 7, 8],
                    topology: options.topology || 8
                });

                infernalCave.randomize(options.probability || 0.5);

                const infernalIterations = options.iterations || 4;
                for (let i = 0; i < infernalIterations; i++) {
                    infernalCave.create();
                }

                const infernalFloorTiles = new Set();

                infernalCave.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                        infernalFloorTiles.add(`${x},${y}`);
                    }
                });

                if (options.connected !== false) {
                    infernalCave.connect((x, y, value) => {
                        if (value === 0 && !this.floorMap[y][x]) {
                            this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                            this.walkableTiles.push({ x, y });
                            infernalFloorTiles.add(`${x},${y}`);
                        }
                    }, 1);
                }

                const infernalWallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];


                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (!infernalFloorTiles.has(`${x},${y}`)) {
                            this.pendingWallSpawns.push({ x, y, type: this._pickWeightedWallType(infernalWallTypes) });
                        }
                    }
                }

                console.log(`Infernal map generated: ${infernalFloorTiles.size} floor tiles`);
                break;
            }

            case 'brogue': {
                // maxRooms is optional in prototype data: when omitted, scale it to
                // the map area (~200 tiles per room+corridor footprint), clamped so
                // tiny/huge maps stay sane. The divisor leaves gaps between rooms
                // for corridors to snake through. An explicit maxRooms wins.
                const autoMaxRooms = Math.min(120, Math.max(8,
                    Math.round((this.width * this.height) / 200)));
                const autoMaxAttempts = Math.min(600, Math.max(50, autoMaxRooms * 4));
                const autoWindingCorridors = Math.min(16, Math.max(3,
                    Math.round((this.width * this.height) / 1250)));
               
                options.secretWallChance ??= 3;
                const brogueCfg = {
                    maxRooms: options.maxRooms || autoMaxRooms,
                    maxAttempts: options.maxAttempts || autoMaxAttempts,
                    corridorChance: options.corridorChance ?? 55,
                    corridorLength: options.corridorLength || [3, 9],

                    maxWindingCorridors: options.maxWindingCorridors ?? autoWindingCorridors,
                    windingLength: options.windingLength || [6, 22],
                    windingBranchChance: options.windingBranchChance ?? 25,
                    loopMinDistance: options.loopMinDistance || 20,
                    maxLoops: options.maxLoops || 5,
                    doorChance: options.doorChance ?? 50,
                    torchChance: options.torchChance ?? 30,

                    secretDoorChance: options.secretDoorChance ?? 35,
                    wall_types: options.wall_types || [{ type: 'wall', weight: 100 }],
                    roomWeights: {
                        rectangle: options.roomWeights?.rectangle ?? 30,
                        cross: options.roomWeights?.cross ?? 25,
                        circular: options.roomWeights?.circular ?? 20,
                        cavern: options.roomWeights?.cavern ?? 25
                    },
                    rectWidth: options.rectWidth || [3, 12],
                    rectHeight: options.rectHeight || [3, 8],
                    crossWidth: options.crossWidth || [7, 16],
                    crossHeight: options.crossHeight || [7, 14],
                    circularRadius: options.circularRadius || [2, 5],
                    hollowChance: options.hollowChance ?? 20,
                    cavernWidth: options.cavernWidth || [8, 20],
                    cavernHeight: options.cavernHeight || [8, 15],
                };

                const dungeonGrid = Array.from({ length: this.height }, () => new Uint8Array(this.width));
                const rooms = [];

                // Seed the first room in a randomly-chosen corner. Rooms attach
                // outward from the seed, so a corner seed spreads them across the
                // whole map instead of clustering them in the middle. (margin keeps
                // the room's 1-tile wall border off the map edge.)
                const firstType = this._brogueMakeRoom('rectangle', brogueCfg);
                const margin = 2;
                const cornerX = ROT.RNG.getUniform() < 0.5;  // true = left, false = right
                const cornerY = ROT.RNG.getUniform() < 0.5;  // true = top,  false = bottom
                // Clamp to >=1 so an oversized first room on a small map never
                // yields a negative offset (which would write out of bounds).
                const cx = Math.max(1, cornerX
                    ? margin
                    : this.width - firstType.width - margin);
                const cy = Math.max(1, cornerY
                    ? margin
                    : this.height - firstType.height - margin);
                for (let ry = 0; ry < firstType.height; ry++) {
                    for (let rx = 0; rx < firstType.width; rx++) {
                        if (firstType.grid[ry][rx] === 1) {
                            dungeonGrid[cy + ry][cx + rx] = 1;
                        }
                    }
                }
                rooms.push(this._brogueMakeRoomRecord(firstType.grid, firstType.width, firstType.height, cx, cy, []));

                // Attach rooms via cellophane sliding
                let roomsBuilt = 1;
                let consecutiveFails = 0;
                let totalFails = 0;
                let attemptsUsed = 0;
                let corridorAttempts = 0;
                let corridorsPlaced = 0;
                let corridorFails = 0;
                let stopReason = 'maxAttempts reached';
                let attempt = 0;
                for (attempt = 0; attempt < brogueCfg.maxAttempts && roomsBuilt < brogueCfg.maxRooms; attempt++) {
                    attemptsUsed = attempt + 1;
                    const type = this._broguePickRoomType(brogueCfg.roomWeights);
                    let room = this._brogueMakeRoom(type, brogueCfg);
                    let doorSites = this._brogueFindDoorSites(room.grid, room.width, room.height);
                    if (doorSites.length === 0) continue;

                    const corrResult = this._brogueMaybeAddCorridor(room.grid, room.width, room.height, doorSites, brogueCfg);
                    const hadCorridor = corrResult.hasCorridor;
                    if (hadCorridor) corridorAttempts++;
                    room = { grid: corrResult.grid, width: corrResult.width, height: corrResult.height };
                    doorSites = corrResult.doorSites;

                    const placement = this._broguePlaceRoom(dungeonGrid, room.grid, room.width, room.height, doorSites, this.width, this.height, corrResult.corridorCells);
                    if (!placement) {
                        consecutiveFails++;
                        totalFails++;
                        if (hadCorridor) corridorFails++;
                        if (consecutiveFails > 10) { stopReason = `10 consecutive placement failures (attempt ${attemptsUsed})`; break; }
                        continue;
                    }
                    consecutiveFails = 0;
                    if (hadCorridor) corridorsPlaced++;

                    // Stamp room onto dungeon grid
                    for (let ry = 0; ry < room.height; ry++) {
                        for (let rx = 0; rx < room.width; rx++) {
                            if (room.grid[ry][rx] === 1) {
                                dungeonGrid[placement.offsetY + ry][placement.offsetX + rx] = 1;
                            }
                        }
                    }
                    dungeonGrid[placement.doorWorldY][placement.doorWorldX] = 2;

                    const record = this._brogueMakeRoomRecord(
                        room.grid, room.width, room.height,
                        placement.offsetX, placement.offsetY,
                        [{ x: placement.doorWorldX, y: placement.doorWorldY }]
                    );
                    rooms.push(record);
                    roomsBuilt++;
                }

                if (roomsBuilt >= brogueCfg.maxRooms) stopReason = `maxRooms reached (${brogueCfg.maxRooms})`;

                // Create loops
                this._brogueMakeLoops(dungeonGrid, rooms, this.width, this.height, brogueCfg);

                const winding = this._brogueCarveWindingCorridors(
                    dungeonGrid, rooms, this.width, this.height, brogueCfg
                );
                const secretWalls = this._brogueFixDeadEnds(dungeonGrid, this.width, this.height);

                // Convert to framework output
                this._brogueFinalizeMap(dungeonGrid, rooms, this.width, this.height, brogueCfg, secretWalls);

                const mapArea = this.width * this.height;
                const fillPct = ((this.walkableTiles.length / mapArea) * 100).toFixed(1);
                const maxRoomsSource = options.maxRooms ? 'explicit' : 'auto';
                console.log(
                    `Brogue map ${this.width}x${this.height} (${mapArea} tiles): ` +
                    `${roomsBuilt} rooms placed (maxRooms ${brogueCfg.maxRooms} [${maxRoomsSource}], ` +
                    `maxAttempts ${brogueCfg.maxAttempts}) — stopped: ${stopReason}. ` +
                    `${attemptsUsed} attempts, ${totalFails} placement fails. ` +
                    `Corridors: ${corridorsPlaced} placed / ${corridorAttempts} tried ` +
                    `(${corridorFails} rejected; chance ${brogueCfg.corridorChance}%, len ${brogueCfg.corridorLength[0]}-${brogueCfg.corridorLength[1]}). ` +
                    `${this.walkableTiles.length} floor tiles (${fillPct}% fill), ` +
                    `${this.pendingDoorSpawns.length} doors, ` +
                    `Winding: ${winding.carved} carved / ${winding.attempted} attempted ` +
                    `(${winding.branches} branched, max ${brogueCfg.maxWindingCorridors}). ` +
                    `${this.pendingSecretDoorSpawns.length} secret doors so far (dead ends).`
                );
                break;
            }

            case 'palladian': {
                // a bilaterally symmetric villa with a north-south axis, with a grand axial room. 
                // Intended for a boss floor or a reward vault. Experimental
               
                const palCfg = {
                    // Stage 1 — the tartan grid.
                    bayColumns: options.bayColumns || [3, 7],
                    bayRows: options.bayRows || [2, 4],
                    bayWidth: options.bayWidth || [4, 11],
                    bayHeight: options.bayHeight || [4, 9],
                    centralBias: options.centralBias ?? 150,
                    // Stage 3 — room layout.
                    mergeChance: options.mergeChance ?? 45,
                    sanctumChance: options.sanctumChance ?? 70,
                    sanctumShapes: options.sanctumShapes || ['cross', 'tee', 'eye'],
                    // Stage 5/6 — portico and colonnade.
                    porticoStyle: options.porticoStyle || 'prostyle',
                    porticoDepth: options.porticoDepth ?? 3,
                    columnSpacing: options.columnSpacing ?? 2,
                    // Stage 7 — openings. doorChance/torchChance/wall_types are
                    // consumed by _brogueFinalizeMap. brick_wall as the default
                    // also disables the shared pushable-wall conversion pass below
                    // (it skips any type !== 'wall'); switch to 'wall' to get
                    // secret passages in the villa walls.
                    doorChance: options.doorChance ?? 55,
                    torchChance: options.torchChance ?? 40,
                    wall_types: options.wall_types || [{ type: 'brick_wall', weight: 100 }],
                    // Stage 7b — concealed passages between apartments the plan
                    // left unconnected, and the share of those barred by a hidden
                    // lever rather than opening on discovery.
                    secretPassageChance: options.secretPassageChance ?? 40,
                    secretPassageLeverChance: options.secretPassageLeverChance ?? 35,
                };

                const dungeonGrid = Array.from({ length: this.height }, () => new Uint8Array(this.width));
                const plan = this._palladianBuildGrid(palCfg);

                if (!plan) {
                    // Degradation floor: the map is too small for even a 1x1 villa.
                    // Fall back to an arena rather than throwing — a generator that
                    // throws breaks loadFloor.
                    console.warn(`Palladian: map ${this.width}x${this.height} too small for a villa; falling back to a single hall`);
                    for (let y = 2; y < this.height - 2; y++) {
                        for (let x = 2; x < this.width - 2; x++) dungeonGrid[y][x] = 1;
                    }
                    this._brogueFinalizeMap(dungeonGrid, [], this.width, this.height, palCfg);
                    break;
                }

                this._palladianCarveBays(dungeonGrid, plan);
                const rooms = this._palladianLayoutRooms(dungeonGrid, plan, palCfg);
                const portico = this._palladianAddPortico(dungeonGrid, plan, palCfg);
                const openings = this._palladianAddOpenings(dungeonGrid, plan, rooms, portico, palCfg);
                this._palladianEnsureConnected(dungeonGrid, plan, rooms, portico);
                // After EnsureConnected: a secret passage is a bonus route, never
                // the one that makes the villa traversable. The connectivity pass
                // must have already succeeded without it.
                const secrets = this._palladianAddSecretPassages(dungeonGrid, plan, rooms, palCfg);

                const records = this._palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings);
                this._brogueFinalizeMap(dungeonGrid, records, this.width, this.height, palCfg);
                this._palladianQueueSecrets(secrets);

                // Decoration runs AFTER finalize on purpose: finalize's torch pass
                // would otherwise convert a column into a wall torch, and its
                // perimeter rule would rewrite one as metal_wall.
                this._palladianPlaceColumns(plan, portico, palCfg);
                this._palladianPlaceWindows(openings);
                this._palladianPublishRegions(dungeonGrid, plan, records, portico);
                // Exposed for tools/palladian-dump.js, which asserts symmetry about
                // the axis and cannot reliably infer it from tile extents.
                this.palladianPlan = plan;

                const sanctum = records.find(r => r.isSanctum);
                console.log(
                    `Palladian villa ${plan.nCols}x${plan.nRows} bays ` +
                    `(${plan.footprintW}x${plan.footprintH} tiles at ${plan.left},${plan.top}, axis x=${plan.axisX}): ` +
                    `${records.length} rooms, ` +
                    `sanctum ${sanctum ? sanctum.shape : 'none'}, ` +
                    `portico ${portico ? portico.style : 'none'}, ` +
                    `${openings.windows.length} windows, ${this.pendingDoorSpawns.length} doors, ` +
                    `${secrets.doors.length} secret passages (${secrets.levers.length} lever-barred), ` +
                    `${this.walkableTiles.length} floor tiles.`
                );
                break;
            }

            case 'digger':
            default: {
                const diggerFloorTiles = new Set();
                generator = new ROT.Map.Digger(this.width, this.height, {
                    roomWidth: options.roomWidth || [3, 9],
                    roomHeight: options.roomHeight || [3, 5],
                    corridorLength: options.corridorLength || [3, 10],
                    dugPercentage: options.dugPercentage || 0.2
                });
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x, y });
                        diggerFloorTiles.add(`${x},${y}`);
                    }
                });

                const diggerWallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];


                const hasDiggerFloor = (fx, fy) => diggerFloorTiles.has(`${fx},${fy}`);

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (diggerFloorTiles.has(`${x},${y}`)) continue;

                        const adjacentToFloor = anyNeighbor8(hasDiggerFloor, x, y);

                        if (adjacentToFloor && y > 0) {
                            this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                            this.pendingWallSpawns.push({ x, y, type: this._pickWeightedWallType(diggerWallTypes) });
                        }
                    }
                }

                const isPerimeter = (px, py) =>
                    px === 0 || px === this.width - 1 || py === 0 || py === this.height - 1;

                for (const wall of this.pendingWallSpawns) {
                    if (isPerimeter(wall.x, wall.y)) {
                        wall.type = 'metal_wall';
                    }
                }

                this._fillPerimeterGaps(hasDiggerFloor, this.width, this.height);

                const rooms = generator.getRooms();
                this.diggerRooms = rooms;
                this.publishRoomRegions(rooms, diggerFloorTiles);
                const wallPositions = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));

                for (const room of rooms) {
                    room.getDoors((x, y) => {
                        if (y > 0 && ROT.RNG.getPercentage() <= 50) {
                            this.pendingDoorSpawns.push({ x, y });
                        }
                    });

                    if (ROT.RNG.getPercentage() <= 30) {
                        const roomWalls = [];
                        const left = room.getLeft();
                        const right = room.getRight();
                        const top = room.getTop();
                        const bottom = room.getBottom();

                        for (const wallPos of this.pendingWallSpawns) {
                            if (wallPos.x >= left - 1 && wallPos.x <= right + 1 &&
                                wallPos.y >= top - 1 && wallPos.y <= bottom + 1) {
                                roomWalls.push(wallPos);
                            }
                        }

                        if (roomWalls.length > 0) {
                            // ROT digger rooms are rectangles, so the getters give the
                            // real floor extent; the helpers want the _x1 form.
                            const bounds = { _x1: left, _y1: top, _x2: right, _y2: bottom };
                            this.queueRoomLights(
                                roomWalls,
                                this.countRoomFloorTiles(bounds, diggerFloorTiles),
                                bounds,
                                diggerFloorTiles
                            );
                        }
                    }
                }

                console.log(`Digger map: ${diggerFloorTiles.size} floors, ${this.pendingWallSpawns.length} walls, ${this.pendingDoorSpawns.length} doors, ${this.pendingTorchSpawns.length} torches`);
                break;
            }
        }

        if (options.lakes) {
            this.generateOverlayBlobs(options.lakes);
        }
        if (options.abyss) {
            this.generateOverlayBlobs(options.abyss);
        }

        // Blobs carve without asking whether the map survives it, so connectivity
        // is restored here rather than protected up front. Must precede
        // generateBridges, whose worthiness gate measures the walk-around distance
        // and should be measuring the repaired map.
        if (options.lakes || options.abyss) {
            this.repairBlobConnectivity(options.connectivity_repair || {});
        }

        if (options.bridges) {
            this.generateBridges(options.bridges);
        }

        if (options.collapsing_floors) {
            this.generateCollapsingFloors(options.collapsing_floors);
            // Collapsing floors punch fresh holes in ground the repair above
            // already signed off on, and a patch across a corridor mouth severs the
            // map just as an abyss blob would. Sweep again.
            this.repairBlobConnectivity(options.connectivity_repair || {});
        }

        // Snapshot before the interior-wall pass so the summary below can report
        // dead-end and interior-wall secret doors as one total.
        const secretDoorsFromDeadEnds = this.pendingSecretDoorSpawns.length;

        if (this.pendingWallSpawns.length > 0) {
            const hasFloor = (x, y) => {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
                return this.floorMap[y][x] !== null;
            };
            const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
            const converted = [];
            let secretConverted = 0;
            let secretRejected = 0;
            let pushRejected = 0;
            // How far apart the two sides must already be for a hidden door between
            // them to be worth finding. 0 (the default) disables the test.
            //
            // Off by default because of what the candidate pool actually contains:
            // the betweenFloors test below requires both opposing neighbours to be
            // non-wall floor, which a wall *inside a wall run* never satisfies — its
            // neighbours along the run are walls. So every candidate is an isolated
            // stub tip poking into open floor, and measuring 3322 of them across
            // caves and depths gave a detour of exactly 4 for 100% of them. Turning
            // this gate on therefore rejects the entire pool and reinstates the
            // secret-door drought rather than improving placement.
            //
            // Fixing that means widening betweenFloors to admit walls within a run,
            // which also changes which walls become pushable — a bigger change than
            // this gate. Until then the gate is here, correct, and dormant; set
            // secretWallMinDetour to enable it once the pool is worth filtering.
            const minDetour = options.secretWallMinDetour ?? 0;
            // Pushable walls get the gate the secret-door path can't use. Their
            // candidates come from the same pool, but unlike secret doors they are
            // not load-bearing for anything, so thinning them costs nothing: half
            // the raw pool measured as 4-tile walk-around stubs. 0 disables.
            const pushMinDetour = options.pushableWallMinDetour ?? 8;
            for (let i = this.pendingWallSpawns.length - 1; i >= 0; i--) {
                const wall = this.pendingWallSpawns[i];
                if (wall.type && wall.type !== 'wall') continue;
                const betweenFloors =
                    (hasFloor(wall.x - 1, wall.y) && hasFloor(wall.x + 1, wall.y) &&
                     !wallSet.has(`${wall.x - 1},${wall.y}`) && !wallSet.has(`${wall.x + 1},${wall.y}`)) ||
                    (hasFloor(wall.x, wall.y - 1) && hasFloor(wall.x, wall.y + 1) &&
                     !wallSet.has(`${wall.x},${wall.y - 1}`) && !wallSet.has(`${wall.x},${wall.y + 1}`));
                if (!betweenFloors) continue;

                // A wall with floor on both sides is a passage waiting to happen.
                // The two chances are independent rolls against the same candidate
                // pool, not a split of one: pushableWallChance is deliberately tiny
                // (2%), so taking a share of it would make secret doors vanishingly
                // rare. secretWallChance is its own rate, off by default so existing
                // maps are unchanged. (Distinct from the brogue generator's
                // secretDoorChance, which splits dead-end shortcuts.)
                const secret = ROT.RNG.getPercentage() <= (options.secretWallChance ?? 0);
                if (!secret && ROT.RNG.getPercentage() > (options.pushableWallChance ?? 2)) continue;

                if (secret) {
                    // A secret door is only worth finding if it actually saves the
                    // player a walk. Without this the pass happily hides a door
                    // between two rooms already joined by an open corridor three
                    // tiles away — mechanically a secret, practically a shortcut to
                    // nowhere. Same test _brogueMakeLoops applies to its loops:
                    // reject when the two sides are already close together.
                    if (!this._isWorthwhileShortcut(wall, minDetour)) {
                        secretRejected++;
                        continue;
                    }
                    this.pendingSecretDoorSpawns.push({ x: wall.x, y: wall.y });
                    secretConverted++;
                } else {
                    // Same test, and for the same reason: a pushable wall you can
                    // simply step around is scenery, not a puzzle. Measured on the
                    // raw pool, half of these were stub tips with a 4-tile detour.
                    if (!this._isWorthwhileShortcut(wall, pushMinDetour)) {
                        pushRejected++;
                        continue;
                    }
                    this.pendingPushableWallSpawns.push({ x: wall.x, y: wall.y });
                }
                this.pendingWallSpawns.splice(i, 1);
                converted.push(wall);
            }
            if (converted.length > 0 || secretRejected > 0) {
                console.log(
                    `Pushable wall generation: ${converted.length - secretConverted} pushable walls, ` +
                    `${secretConverted} secret doors` +
                    (secretRejected + pushRejected > 0
                        ? ` (${secretRejected + pushRejected} rejected as pointless shortcuts)` : '')
                );
            }
        }

        // The authoritative secret-door count. The per-pass lines above each see
        // only their own share, and the dead-end one reads 0 on most maps, so state
        // the total and its breakdown once, here, where both are known.
        const secretDoorTotal = this.pendingSecretDoorSpawns.length;
        console.log(
            `Procedural map generated with ${this.walkableTiles.length} walkable tiles, ` +
            `${secretDoorTotal} secret doors ` +
            `(${secretDoorsFromDeadEnds} dead-end, ${secretDoorTotal - secretDoorsFromDeadEnds} interior-wall)`
        );
    }

    /**
     * Would a hidden door in this wall actually open a shortcut?
     *
     * Answers by walking the finished map from one side of the wall to the other,
     * *without* going through the wall itself: if the detour is already short, the
     * door saves nobody anything and shouldn't be a secret. This is the same
     * judgement _brogueMakeLoops makes about loops, but it can't share
     * _brogueBFS — that one reads the generator's dungeonGrid, which is out of
     * scope by the time this pass runs and is stale anyway, since lakes, abysses,
     * bridges and connectivity repair have all reshaped the map since. Walking
     * floorMap instead measures the map the player will actually be dropped into,
     * and gets abyss handling for free: blob cells clear floorMap, so a path is
     * never routed across a chasm.
     *
     * Returns true when the sides are far apart, unreachable from each other, or
     * beyond the search cap — all cases where the door is a genuine discovery.
     *
     * @param {{x:number,y:number}} wall     the candidate wall cell
     * @param {number} minDetour  required existing walking distance; 0 disables
     */
    _isWorthwhileShortcut(wall, minDetour) {
        if (!minDetour || minDetour <= 0) return true;

        // floorMap alone is NOT walkability: a wall actor sits on a floor tile, so
        // floorMap[y][x] is non-null for walls too. Testing it by itself lets the
        // search walk straight through walls, which makes every detour look short
        // and the whole test a no-op. The pending wall set is what makes it mean
        // what it says.
        const blocked = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const walkable = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            if (x === wall.x && y === wall.y) return false;   // never through the door
            if (blocked.has(`${x},${y}`)) return false;
            return this.floorMap[y][x] !== null;
        };

        // The pair of opposing floor cells this wall sits between. betweenFloors
        // has already established that one of these axes holds.
        const [a, b] = walkable(wall.x - 1, wall.y) && walkable(wall.x + 1, wall.y)
            ? [{ x: wall.x - 1, y: wall.y }, { x: wall.x + 1, y: wall.y }]
            : [{ x: wall.x, y: wall.y - 1 }, { x: wall.x, y: wall.y + 1 }];

        // Cap the search at the distance we care about: anything further is "far
        // enough" and there's no reason to keep expanding. Bounds the cost of
        // running this per candidate wall.
        const cap = minDetour;
        const visited = new Set([`${a.x},${a.y}`]);
        let frontier = [a];
        let dist = 0;

        while (frontier.length > 0 && dist < cap) {
            dist++;
            const next = [];
            for (const cell of frontier) {
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    const nx = cell.x + dx, ny = cell.y + dy;
                    if (!walkable(nx, ny)) continue;
                    const key = `${nx},${ny}`;
                    if (visited.has(key)) continue;
                    // Reached the far side within the cap — the detour is short, so
                    // the door would be a shortcut to nowhere.
                    if (nx === b.x && ny === b.y) return false;
                    visited.add(key);
                    next.push({ x: nx, y: ny });
                }
            }
            frontier = next;
        }

        return true;
    }

    /**
     * Lakes and abysses, generated the way Brogue does it (designLakes,
     * Architect.c:2562): the shape is built off-map by a cellular automaton and
     * then stamped at a random position, carving through whatever it lands on —
     * rock, room wall or floor alike. Nothing here consults room bounds.
     *
     * config: { count, types, minSize, maxSize, mask?, requireFloorOverlap? }
     * `mask` (a Set of "x,y") hard-confines every cell a blob may write, used by
     * generateAbyssAt to keep a wildcard region's blobs off the authored map.
     */
    generateOverlayBlobs(config) {
        if (!config || !config.count) return;

        const count = Array.isArray(config.count)
            ? ROT.RNG.getUniformInt(config.count[0], config.count[1])
            : config.count;
        if (count <= 0) return;

        const types = config.types || ['water'];
        const minSize = config.minSize || 10;
        const maxSize = config.maxSize || 60;

        // Brogue insets lake placement by 1 cell (Architect.c:2585). We need 2:
        // the outermost ring is metal_wall, and a blob abutting it would leave
        // the map edge with no rock behind the wall.
        const INSET = 2;
        const PLACEMENT_ATTEMPTS = 20;
        // Not a passability gate (blobs are committed unconditionally and any
        // damage is repaired later by repairBlobConnectivity). This only proves
        // the lake landed near the dungeon rather than marooned in solid rock
        // where the player would never find it.
        const minFloorOverlap = config.requireFloorOverlap ?? 8;

        const perimeterProtected = this._blobProtectedPerimeter();
        // Brogue's accumulating lakeMap (Architect.c:2595): each new blob is
        // placed against the ones already committed, so two blobs of different
        // liquid types never overlap and fight over the same cell.
        const claimedCells = new Set();

        const allVoidCells = new Set();
        const allLiquidCells = new Set();
        const hazardCells = new Set();
        let totalPlaced = 0;

        for (let i = 0; i < count; i++) {
            const type = types[Math.floor(ROT.RNG.getUniform() * types.length)];
            const shape = this._brogueMakeCavern(this._blobPickCanvas(minSize, maxSize));

            let placed = null;
            for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
                const maxOriginX = this.width - shape.width - INSET;
                const maxOriginY = this.height - shape.height - INSET;
                if (maxOriginX < INSET || maxOriginY < INSET) break; // shape larger than the map
                const originX = ROT.RNG.getUniformInt(INSET, maxOriginX);
                const originY = ROT.RNG.getUniformInt(INSET, maxOriginY);

                const cells = [];
                let floorOverlap = 0;
                let blocked = false;
                for (let localY = 0; localY < shape.height && !blocked; localY++) {
                    for (let localX = 0; localX < shape.width; localX++) {
                        if (shape.grid[localY][localX] !== 1) continue;
                        const x = originX + localX;
                        const y = originY + localY;
                        const key = `${x},${y}`;
                        if (config.mask && !config.mask.has(key)) { blocked = true; break; }
                        if (perimeterProtected.has(key)) { blocked = true; break; }
                        if (claimedCells.has(key)) { blocked = true; break; }
                        cells.push({ x, y, key });
                        if (this.floorMap[y][x]) floorOverlap++;
                    }
                }
                if (blocked || cells.length === 0) continue;
                if (floorOverlap < Math.min(minFloorOverlap, cells.length)) continue;
                placed = cells;
                break;
            }

            if (!placed) {
                console.log(`  ${type} blob: no placement found in ${PLACEMENT_ATTEMPTS} attempts`);
                continue;
            }

            this._blobStampAt(placed, type);
            totalPlaced += placed.length;
            for (const cell of placed) {
                claimedCells.add(cell.key);
                if (type === 'abyss') allVoidCells.add(cell.key);
                else allLiquidCells.add(cell.key);
                if (type === 'lava') hazardCells.add(cell.key);
            }

            console.log(`  ${type} blob: ${placed.length} tiles`);
        }

        const allBlobCells = new Set([...allLiquidCells, ...allVoidCells]);
        if (allBlobCells.size === 0) {
            console.log(`Overlay generation: 0 tiles placed in ${count} attempted blobs`);
            return;
        }

        // Anything a blob covered is gone: walls bitten open, doors drowned,
        // torches and braziers swallowed. Every spawn array gets the same
        // treatment.
        const covered = (p) => allBlobCells.has(`${p.x},${p.y}`);
        this.pendingWallSpawns = this.pendingWallSpawns.filter(p => !covered(p));
        this.pendingDoorSpawns = this.pendingDoorSpawns.filter(p => !covered(p));
        this.pendingTorchSpawns = this.pendingTorchSpawns.filter(p => !covered(p));
        this.pendingBrazierSpawns = this.pendingBrazierSpawns.filter(p => !covered(p));
        this.pendingPushableWallSpawns = this.pendingPushableWallSpawns.filter(p => !covered(p));
        this.pendingSecretDoorSpawns = this.pendingSecretDoorSpawns.filter(p => !covered(p));
        this.pendingHiddenLeverSpawns = this.pendingHiddenLeverSpawns.filter(p => !covered(p));
        // Liquid needs a floor to lie on. Testing the map rather than this call's
        // own void set also catches water queued by the earlier lakes pass on a
        // cell this pass has since turned into chasm — otherwise the actor spawns
        // hanging in the middle of the void.
        const hasFloor = (p) => !!this.floorMap[p.y][p.x];
        this.pendingLavaSpawns = this.pendingLavaSpawns.filter(hasFloor);
        this.pendingLakeSpawns = this.pendingLakeSpawns.filter(hasFloor);
        this.pendingSewageSpawns = this.pendingSewageSpawns.filter(hasFloor);

        this._blobRingBoundaryWalls(allBlobCells, perimeterProtected);
        this._blobRebuildWalkableTiles(allLiquidCells, hazardCells);

        console.log(`Overlay generation: ${totalPlaced} total tiles in ${count} blobs`);
    }

    /**
     * Cells no blob may ever touch: the metal_wall ring that seals the map, plus
     * the outermost row and column outright. Row 0 matters on its own: every
     * wall-spawn site in this file is guarded `y > 0`, so a blob up there would
     * leave floor with no wall above it.
     */
    _blobProtectedPerimeter() {
        const protectedCells = new Set();
        for (const wall of this.pendingWallSpawns) {
            if (wall.type === 'metal_wall') protectedCells.add(`${wall.x},${wall.y}`);
        }
        for (let x = 0; x < this.width; x++) {
            protectedCells.add(`${x},0`);
            protectedCells.add(`${x},${this.height - 1}`);
        }
        for (let y = 0; y < this.height; y++) {
            protectedCells.add(`0,${y}`);
            protectedCells.add(`${this.width - 1},${y}`);
        }
        return protectedCells;
    }

    /**
     * Translates the cell-count sizing the config files use (minSize/maxSize)
     * into the canvas dimensions _brogueMakeCavern wants. A B5678/S45678 blob
     * settles at roughly half its canvas, so a canvas of area (target / 0.5)
     * lands near the requested size — near, not exact. The random aspect keeps
     * every lake from sharing one silhouette; Brogue's own run 30x15 down to 20x10.
     */
    _blobPickCanvas(minSize, maxSize) {
        const targetCells = ROT.RNG.getUniformInt(minSize, maxSize);
        const area = Math.max(16, Math.round(targetCells / 0.5));
        const aspect = 0.6 + ROT.RNG.getUniform() * 1.3;
        let canvasWidth = Math.round(Math.sqrt(area * aspect));
        let canvasHeight = Math.round(area / Math.max(1, canvasWidth));
        canvasWidth = Math.max(5, Math.min(canvasWidth, Math.floor(this.width * 0.55)));
        canvasHeight = Math.max(5, Math.min(canvasHeight, Math.floor(this.height * 0.55)));
        return {
            cavernWidth: [canvasWidth, canvasWidth],
            cavernHeight: [canvasHeight, canvasHeight],
            // _brogueMakeCavern falls back to _brogueMakeRectangle when the
            // automaton produces fewer than 6 cells, and that reads these.
            rectWidth: [Math.max(2, Math.floor(canvasWidth / 2)), Math.max(3, canvasWidth - 1)],
            rectHeight: [Math.max(2, Math.floor(canvasHeight / 2)), Math.max(3, canvasHeight - 1)]
        };
    }

    /**
     * Writes one blob's cells. The shape wins over whatever was there: rock, room
     * wall and open floor all become part of the lake or chasm (Brogue's
     * designLakes sets DUNGEON = FLOOR for every covered cell).
     */
    _blobStampAt(cells, type) {
        const isAbyss = (type === 'abyss');
        const liquidTarget = type === 'lava' ? this.pendingLavaSpawns
            : type === 'sewage' ? this.pendingSewageSpawns
            : this.pendingLakeSpawns;

        for (const { x, y } of cells) {
            if (isAbyss) {
                // The abyss layer contract addBaseAndShadows keys off: floorless,
                // void background, nothing above it.
                this.floorMap[y][x] = null;
                this.backgroundMap[y][x] = { tileId: globalVars.VOID_FILL, layer: 'background' };
                this.overlayMap[y][x] = null;
                continue;
            }

            // Liquid sits on ordinary floor. Rock has no floor at all, so carving
            // into it means writing one; clearing the background stops the cell
            // keeping whatever art was behind the rock.
            if (!this.floorMap[y][x] || this.floorMap[y][x].tileId !== this.config.defaultFloorTileId) {
                this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
            }
            this.backgroundMap[y][x] = null;
            this.overlayMap[y][x] = null;
            liquidTarget.push({ x, y });
        }
    }

    /**
     * Rings the carved region with walls, giving the lake a cliff edge where it
     * borders raw rock.
     *
     * Walls get floor written under them, per this file's convention, which is
     * what lets generateBridges punch a boundary wall into a landing. The pushed
     * entry is typeless: spawnPendingWalls defaults it to 'wall', and the bridge
     * landing test looks for exactly that.
     */
    _blobRingBoundaryWalls(blobCells, perimeterProtected) {
        const existingWallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
        let boundaryWalls = 0;

        for (const key of blobCells) {
            const [bx, by] = key.split(',').map(Number);
            for (const [dx, dy] of dirs) {
                const nx = bx + dx;
                const ny = by + dy;
                if (nx < 1 || nx >= this.width - 1 || ny < 1 || ny >= this.height - 1) continue;
                const nk = `${nx},${ny}`;
                if (blobCells.has(nk)) continue;
                if (existingWallSet.has(nk)) continue;
                if (perimeterProtected.has(nk)) continue;
                if (this.floorMap[ny][nx]) continue;
                // Void carved by an earlier pass (lakes run before abyss) is
                // already a legitimate edge. Papering floor back over it would
                // strand a walled cell mid-chasm and stop the cliff shading.
                const background = this.backgroundMap[ny][nx];
                if (background && globalVars.VOID_TILE_IDS.includes(background.tileId)) continue;

                this.floorMap[ny][nx] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                this.pendingWallSpawns.push({ x: nx, y: ny });
                existingWallSet.add(nk);
                boundaryWalls++;
            }
        }

        if (boundaryWalls > 0) {
            console.log(`  Boundary walls added: ${boundaryWalls}`);
        }
    }

    _blobRebuildWalkableTiles(liquidCells, hazardCells) {
        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const seen = new Set();
        const rebuilt = [];

        const admit = (x, y) => {
            const key = `${x},${y}`;
            if (seen.has(key)) return;
            if (hazardCells.has(key)) return;
            if (wallSet.has(key)) return;
            if (!this.isWalkable(x, y)) return; // abyss drops out here
            seen.add(key);
            rebuilt.push({ x, y });
        };

        for (const tile of this.walkableTiles) admit(tile.x, tile.y);
        // Shore carved out of rock was never in the list to begin with.
        for (const key of liquidCells) {
            const [x, y] = key.split(',').map(Number);
            admit(x, y);
        }

        this.walkableTiles = rebuilt;
    }

    repairBlobConnectivity(config = {}) {
        const minOrphanSize = config.minOrphanSize ?? 6;
        const maxNeckLength = config.maxNeckLength ?? 40;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && globalVars.VOID_TILE_IDS.includes(bg.tileId) && this.floorMap[y][x] === null;
        };

        let causeways = 0;
        let ignoredLedges = 0;

        for (let round = 0; ; round++) {
            const { regions, label } = this._blobLabelOpenRegions();
            const orphans = regions
                .filter(r => r.cells.length >= minOrphanSize)
                .sort((a, b) => b.cells.length - a.cells.length);
            if (orphans.length <= 1) {
                ignoredLedges = regions.length - orphans.length;
                break;
            }
            // A causeway can fail to land, so cap the rounds instead of trusting
            // every pass to make progress.
            if (round >= orphans.length + 4) {
                console.warn(
                    `  Connectivity: gave up with ${orphans.length} regions still separate`
                );
                break;
            }

            const mainland = orphans[0];
            const connectedLabels = new Set([mainland.id]);
            let joinedAny = false;

            for (let i = 1; i < orphans.length; i++) {
                const orphan = orphans[i];
                const neck = this._blobFindNeck(orphan, label, connectedLabels, isAbyss, maxNeckLength);
                if (!neck) {
                    console.warn(
                        `  Connectivity: ${orphan.cells.length}-cell region near ` +
                        `(${orphan.cells[0].x},${orphan.cells[0].y}) has no crossing within ${maxNeckLength} tiles`
                    );
                    continue;
                }

                // The wandering walk is for looks and can wander itself into a
                // dead end; the neck's own BFS chain is the crossing that is
                // guaranteed to join the two shores. Take the scenic route only
                // when it actually reaches the far side.
                const scenic = this._carveWanderingPath(neck.from, neck.to, isAbyss);
                const reaches = scenic.length > 0 && scenic.some(c =>
                    Math.abs(c.x - neck.to.x) + Math.abs(c.y - neck.to.y) === 1);
                const path = reaches ? scenic : neck.cells;
                if (path.length === 0) {
                    console.warn(`  Connectivity: causeway from (${neck.from.x},${neck.from.y}) carved nothing`);
                    continue;
                }

                for (const cell of path) {
                    this.floorMap[cell.y][cell.x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    // Stop being a chasm in every sense: leaving the void background
                    // would keep addBaseAndShadows shading this as a pit, and would
                    // leave generateBridges and generateCollapsingFloors still
                    // seeing abyss here.
                    this.backgroundMap[cell.y][cell.x] = null;
                    this.walkableTiles.push({ x: cell.x, y: cell.y });
                    this._causewayCells.add(`${cell.x},${cell.y}`);
                }
                causeways++;
                joinedAny = true;
                // Only one carve per round: the labelling this loop is reading is
                // now out of date, and the next round will see the new ground.
                break;
            }

            if (!joinedAny) break;
        }

        if (ignoredLedges > 0) {
            console.log(`  Connectivity: ${ignoredLedges} ledge(s) under ${minOrphanSize} cells left as scenery`);
        }
        if (causeways > 0) {
            console.log(`Connectivity repair: ${causeways} causeway(s) carved`);
        }
    }

    /**
     * Labels every connected region of open floor. Modelled on
     * _floodFillRegion, but reads live map state instead of a grid so it can
     * run after carving, and labels all components rather than one.
     *
     * Liquid counts as open, only the abyss actually blocks. Pass
     * extraBlocked to treat something else as a barrier too (the lava dry-path
     * pass uses it to ask which regions are reachable without walking through fire).
     */
    _blobLabelOpenRegions(extraBlocked = null) {
        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const isOpen = (x, y) => {
            if (x < 1 || x >= this.width - 1 || y < 1 || y >= this.height - 1) return false;
            const key = `${x},${y}`;
            if (wallSet.has(key)) return false;
            if (extraBlocked && extraBlocked.has(key)) return false;
            return this.isWalkable(x, y);
        };

        const label = new Map();
        const regions = [];

        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const key = `${x},${y}`;
                if (label.has(key) || !isOpen(x, y)) continue;

                const id = regions.length;
                const cells = [];
                const stack = [{ x, y }];
                label.set(key, id);
                while (stack.length > 0) {
                    const cell = stack.pop();
                    cells.push(cell);
                    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                        const nx = cell.x + dx;
                        const ny = cell.y + dy;
                        const nk = `${nx},${ny}`;
                        if (label.has(nk) || !isOpen(nx, ny)) continue;
                        label.set(nk, id);
                        stack.push({ x: nx, y: ny });
                    }
                }
                regions.push({ id, cells });
            }
        }

        return { regions, label };
    }

    /**
     * Finds the shortest crossing from an orphaned region to anything already
     * connected — the narrowest neck, so the causeway is a short hop rather than
     * a trek across the widest part of the chasm.
     *
     * A breadth-first flood through the barrier itself, rather than a cardinal
     * ray, so it finds a crossing at any angle: an abyss that severs a room
     * complex usually leaves it touching the void along a ragged diagonal.
     */
    _blobFindNeck(orphan, label, connectedLabels, isBarrier, maxNeckLength) {
        const cardinalDirs = [[1,0],[-1,0],[0,1],[0,-1]];
        const cameFrom = new Map();
        const queue = [];
        let head = 0;

        // Seed with every barrier cell touching the orphan's shore, remembering
        // which shore cell each came from so the crossing has both endpoints.
        for (const cell of orphan.cells) {
            for (const [dx, dy] of cardinalDirs) {
                const nx = cell.x + dx;
                const ny = cell.y + dy;
                const key = `${nx},${ny}`;
                if (cameFrom.has(key) || !isBarrier(nx, ny)) continue;
                cameFrom.set(key, { x: nx, y: ny, shore: cell, steps: 1, parent: null });
                queue.push(key);
            }
        }

        while (head < queue.length) {
            const node = cameFrom.get(queue[head++]);
            if (node.steps >= maxNeckLength) continue;

            for (const [dx, dy] of cardinalDirs) {
                const nx = node.x + dx;
                const ny = node.y + dy;
                if (nx < 1 || nx >= this.width - 1 || ny < 1 || ny >= this.height - 1) continue;
                const key = `${nx},${ny}`;

                // Reached open ground: a win only if it belongs to a region that
                // is already joined to the mainland.
                if (!isBarrier(nx, ny)) {
                    const landing = label.get(key);
                    if (landing !== undefined && connectedLabels.has(landing)) {
                        // Walk the parent chain back to the shore. This is the
                        // guaranteed-contiguous crossing; the wandering walk is
                        // layered on top of it only when there is room to wander.
                        const cells = [];
                        for (let step = node; step; step = step.parent) {
                            cells.push({ x: step.x, y: step.y });
                        }
                        cells.reverse();
                        return { from: node.shore, to: { x: nx, y: ny }, steps: node.steps, cells };
                    }
                    continue;
                }

                if (cameFrom.has(key)) continue;
                cameFrom.set(key, { x: nx, y: ny, shore: node.shore, steps: node.steps + 1, parent: node });
                queue.push(key);
            }
        }

        return null;
    }
    generateBridges(config) {
        const maxBridges = config.max || 1;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && globalVars.VOID_TILE_IDS.includes(bg.tileId) && this.floorMap[y][x] === null;
        };

        const hasFloor = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            return this.floorMap[y][x] !== null;
        };

        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const isLandable = (x, y) => hasFloor(x, y) && !wallSet.has(`${x},${y}`);
        // A boundary wall (added around abyss blobs) always has true floor under it,
        // so it can be "punched" into a landing by removing it from the wall spawns.
        const isBoundaryWall = (x, y) => hasFloor(x, y) && wallSet.has(`${x},${y}`);

        const cardinalDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        // 1. Flood-fill abyss cells into connected components (blobs).
        const blobId = new Map();
        const blobs = [];
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const key = `${x},${y}`;
                if (!isAbyss(x, y) || blobId.has(key)) continue;
                const id = blobs.length;
                const cells = [];
                let minX = x, maxX = x, minY = y, maxY = y;
                const stack = [{ x, y }];
                blobId.set(key, id);
                while (stack.length > 0) {
                    const cell = stack.pop();
                    cells.push(cell);
                    if (cell.x < minX) minX = cell.x;
                    if (cell.x > maxX) maxX = cell.x;
                    if (cell.y < minY) minY = cell.y;
                    if (cell.y > maxY) maxY = cell.y;
                    for (const [dx, dy] of cardinalDirs) {
                        const nx = cell.x + dx, ny = cell.y + dy;
                        const nk = `${nx},${ny}`;
                        if (isAbyss(nx, ny) && !blobId.has(nk)) {
                            blobId.set(nk, id);
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }
                blobs.push({ id, cells, minX, maxX, minY, maxY });
            }
        }

        if (blobs.length === 0) return;

        const belongsTo = (x, y, id) => blobId.get(`${x},${y}`) === id;

        // Resolve a landing just outside an abyss run. Returns null if there is no
        // walkable shore. Otherwise returns { punch, stand } where `punch` is the
        // boundary-wall cell to open (or null when the shore is already floor) and
        // `stand` is the walkable floor cell the bridge actually connects to.
        const resolveLanding = (x, y, dx, dy) => {
            if (isLandable(x, y)) return { punch: null, stand: { x, y } };
            if (isBoundaryWall(x, y) && isLandable(x + dx, y + dy)) {
                // One wall between the abyss and real floor: punchable.
                return { punch: { x, y }, stand: { x: x + dx, y: y + dy } };
            }
            return null;
        };

        // Brogue-style connectivity gate: a bridge is only worth building if walking
        // AROUND the abyss (over existing floor, treating abyss + walls as blockers)
        // is much longer than crossing it. Bounded BFS from one shore to the other;
        // if the far shore is unreachable within `cap` steps (or at all), the detour
        // is long enough and the bridge earns its place.
        const minDetourRatio = config.minDetourRatio != null ? config.minDetourRatio : 3;
        const isWalkAroundOpen = (x, y) => isLandable(x, y) && !isAbyss(x, y);
        const detourExceeds = (fromCell, toCell, bridgeLength) => {
            if (minDetourRatio <= 0) return true; // gate disabled
            const cap = Math.ceil(bridgeLength * minDetourRatio);
            const startKey = `${fromCell.x},${fromCell.y}`;
            const goalKey = `${toCell.x},${toCell.y}`;
            const visited = new Set([startKey]);
            let frontier = [fromCell];
            let dist = 0;
            while (frontier.length > 0) {
                if (dist > cap) return true; // walk-around already too long -> build
                const next = [];
                for (const cell of frontier) {
                    if (`${cell.x},${cell.y}` === goalKey) return false; // cheap walk exists -> skip
                    for (const [dx, dy] of cardinalDirs) {
                        const nx = cell.x + dx, ny = cell.y + dy;
                        const nk = `${nx},${ny}`;
                        if (visited.has(nk)) continue;
                        if (!isWalkAroundOpen(nx, ny)) continue;
                        visited.add(nk);
                        next.push({ x: nx, y: ny });
                    }
                }
                frontier = next;
                dist++;
            }
            return true; // far shore unreachable on foot -> definitely bridge
        };

        // 2. Find the best full-width/full-height crossing for a single blob.
        // Returns { h, v } — the best horizontal and best vertical crossing that
        // each pass the connectivity gate (either may be null). Placing both forms
        // an intersection where they share a cell.
        const chooseCrossing = (blob) => {
            const blobWidth = blob.maxX - blob.minX + 1;
            const blobHeight = blob.maxY - blob.minY + 1;
            const hCandidates = [];
            const vCandidates = [];

            // Horizontal crossings: for each row, the run must equal the blob's
            // full horizontal cross-section on that row (shore-to-shore).
            for (let y = blob.minY; y <= blob.maxY; y++) {
                let rowMinX = Infinity, rowMaxX = -Infinity;
                for (let x = blob.minX; x <= blob.maxX; x++) {
                    if (belongsTo(x, y, blob.id)) {
                        if (x < rowMinX) rowMinX = x;
                        if (x > rowMaxX) rowMaxX = x;
                    }
                }
                if (rowMinX === Infinity) continue;
                // Reject rows where the blob is not one solid band (interior floor island).
                let solid = true;
                for (let x = rowMinX; x <= rowMaxX; x++) {
                    if (!belongsTo(x, y, blob.id)) { solid = false; break; }
                }
                if (!solid) continue;
                const length = rowMaxX - rowMinX + 1;
                if (length < Math.max(2, Math.ceil(blobWidth * 0.4))) continue;
                const west = resolveLanding(rowMinX - 1, y, -1, 0);
                const east = resolveLanding(rowMaxX + 1, y, 1, 0);
                if (!west || !east) continue;
                const cells = [];
                for (let x = rowMinX; x <= rowMaxX; x++) cells.push({ x, y });
                hCandidates.push({
                    cells, dir: 'h', length,
                    punches: [west.punch, east.punch].filter(Boolean),
                    standA: west.stand, standB: east.stand
                });
            }

            // Vertical crossings: symmetric, per column.
            for (let x = blob.minX; x <= blob.maxX; x++) {
                let colMinY = Infinity, colMaxY = -Infinity;
                for (let y = blob.minY; y <= blob.maxY; y++) {
                    if (belongsTo(x, y, blob.id)) {
                        if (y < colMinY) colMinY = y;
                        if (y > colMaxY) colMaxY = y;
                    }
                }
                if (colMinY === Infinity) continue;
                let solid = true;
                for (let y = colMinY; y <= colMaxY; y++) {
                    if (!belongsTo(x, y, blob.id)) { solid = false; break; }
                }
                if (!solid) continue;
                const length = colMaxY - colMinY + 1;
                if (length < Math.max(2, Math.ceil(blobHeight * 0.4))) continue;
                const north = resolveLanding(x, colMinY - 1, 0, -1);
                const south = resolveLanding(x, colMaxY + 1, 0, 1);
                if (!north || !south) continue;
                const cells = [];
                for (let y = colMinY; y <= colMaxY; y++) cells.push({ x, y });
                vCandidates.push({
                    cells, dir: 'v', length,
                    punches: [north.punch, south.punch].filter(Boolean),
                    standA: north.stand, standB: south.stand
                });
            }

            // For each axis independently: prefer the narrowest neck, then the
            // crossing that needs no punches, then a little randomness for variety;
            // and keep only a crossing whose two shores are not already cheaply
            // connected on foot (Brogue's bridgeRatio test). Returns the narrowest
            // crossing on that axis that earns its place, or null.
            const pickBest = (candidates) => {
                candidates.sort((a, b) =>
                    a.length - b.length ||
                    a.punches.length - b.punches.length ||
                    (ROT.RNG.getUniform() - 0.5)
                );
                for (const candidate of candidates) {
                    if (detourExceeds(candidate.standA, candidate.standB, candidate.length)) {
                        return candidate;
                    }
                }
                return null;
            };

            // A horizontal and a vertical crossing that each pass the gate are placed
            // together as an intersection (they share a cell). Either may be null.
            return { h: pickBest(hCandidates), v: pickBest(vCandidates) };
        };

        // 3. Place one bridge per blob, largest abyss first, up to the global cap.
        blobs.sort((a, b) => b.cells.length - a.cells.length);

        const usedCells = new Set();
        let placed = 0;
        // Distinguishes one crossing's cells from another's in spawnPendingBridges.
        // The two crossings of the SAME blob deliberately share this id so their
        // shared cell still resolves to a "+" junction; unrelated bridges that merely
        // run next to each other get different ids and cannot bend each other's tiles.
        let crossingGroupId = 0;

        for (const blob of blobs) {
            if (placed >= maxBridges) break;
            const { h, v } = chooseCrossing(blob);
            // Take whichever crossings earned their place. When both exist they cross
            // this blob on opposite axes and are placed together as an intersection;
            // they may share one cell (the crossing point), rendered as a "+" tile.
            const crossings = [h, v].filter(Boolean);
            if (crossings.length === 0) continue;
            // Only reject a crossing if it collides with an ALREADY-placed bridge from
            // another blob. The two crossings of THIS blob are allowed to overlap each
            // other (that overlap is the intersection).
            if (crossings.some(cr => cr.cells.some(c => usedCells.has(`${c.x},${c.y}`)))) continue;

            crossingGroupId++;

            for (const crossing of crossings) {
                // Open any boundary walls the bridge lands on so the shore is walkable.
                for (const punch of crossing.punches) {
                    this.pendingWallSpawns = this.pendingWallSpawns.filter(p => !(p.x === punch.x && p.y === punch.y));
                    wallSet.delete(`${punch.x},${punch.y}`);
                }

                for (const c of crossing.cells) {
                    // The intersection cell is shared by both crossings; only queue it
                    // once so we don't stack two rope_bridge actors on one tile.
                    const ck = `${c.x},${c.y}`;
                    if (usedCells.has(ck)) continue;
                    // Leave the cell as abyss (floorMap null, void background) and let the
                    // rope_bridge platform actor provide footing — like a collapsing_floor.
                    // Do NOT lay real floor here: it would make addBaseAndShadows skip the
                    // cliffside shadow, and leave a floor tile behind when the bridge burns
                    // instead of revealing the void below.
                    // Orientation (dir) is recorded per cell, but the final box-drawing
                    // tile is chosen from bridge-cell adjacency in spawnPendingBridges so
                    // the intersection cell becomes a "+" junction. crossingGroup scopes
                    // that adjacency test to this blob's own crossings.
                    this.pendingBridgeSpawns.push({
                        x: c.x, y: c.y, dir: crossing.dir, crossingGroup: crossingGroupId
                    });
                    usedCells.add(ck);
                }
                console.log(`  Bridge: ${crossing.length} tiles (${crossing.dir === 'h' ? 'horizontal' : 'vertical'})`);
            }
            // One abyss consumes one slot even when it gets a crossing on both axes.
            placed++;
        }

        if (placed > 0) {
            console.log(`Bridge generation: ${placed} bridge(s)`);
        }
    }

    generateCollapsingFloors(config) {
        const maxPatches = config.max || 2;
        const minPatchSize = config.minSize || 2;
        const maxPatchSize = config.maxSize || 5;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && globalVars.VOID_TILE_IDS.includes(bg.tileId) && this.floorMap[y][x] === null;
        };

        const hasFloor = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            return this.floorMap[y][x] !== null;
        };

        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const bridgeSet = new Set(this.pendingBridgeSpawns.map(p => `${p.x},${p.y}`));
        // Collapsing a floor out from under a lake would leave the water actor
        // hanging over the void.
        const liquidSet = new Set([
            ...this.pendingLakeSpawns,
            ...this.pendingSewageSpawns,
            ...this.pendingLavaSpawns
        ].map(p => `${p.x},${p.y}`));

        // Collect the floor tiles sitting on the lip of an abyss. Nothing is
        // painted; the rule only marks cells.
        const edgeTiles = this.applyTilePattern('floor', [{
            when: (ctx, x, y) => {
                if (!hasFloor(x, y)) return false;
                if (wallSet.has(`${x},${y}`)) return false;
                if (bridgeSet.has(`${x},${y}`)) return false;
                if (liquidSet.has(`${x},${y}`)) return false;
                // A causeway is somebody's only way home; don't drop it out.
                if (this._causewayCells.has(`${x},${y}`)) return false;
                return ctx.any4((c, nx, ny) => isAbyss(nx, ny), x, y);
            },
            paint: null
        }], {
            collect: true,
            bounds: { x1: 1, y1: 1, x2: this.width - 2, y2: this.height - 2 }
        });

        if (edgeTiles.length === 0) return;

        // Patches grow cardinally out from each seed tile.
        const cardinalDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        for (let i = edgeTiles.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [edgeTiles[i], edgeTiles[j]] = [edgeTiles[j], edgeTiles[i]];
        }

        const usedCells = new Set();
        let placed = 0;

        for (const seed of edgeTiles) {
            if (placed >= maxPatches) break;
            if (usedCells.has(`${seed.x},${seed.y}`)) continue;

            const patchSize = minPatchSize + Math.floor(ROT.RNG.getUniform() * (maxPatchSize - minPatchSize + 1));
            const patch = [seed];
            const patchSet = new Set([`${seed.x},${seed.y}`]);
            const frontier = [];

            const canCollapse = (x, y) => {
                const key = `${x},${y}`;
                return hasFloor(x, y) && !wallSet.has(key) && !bridgeSet.has(key)
                    && !liquidSet.has(key) && !this._causewayCells.has(key);
            };

            for (const [dx, dy] of cardinalDirs) {
                const nx = seed.x + dx, ny = seed.y + dy;
                if (canCollapse(nx, ny)) {
                    frontier.push({ x: nx, y: ny });
                }
            }

            while (patch.length < patchSize && frontier.length > 0) {
                const idx = Math.floor(ROT.RNG.getUniform() * frontier.length);
                const cell = frontier.splice(idx, 1)[0];
                const key = `${cell.x},${cell.y}`;
                if (patchSet.has(key) || usedCells.has(key)) continue;

                patch.push(cell);
                patchSet.add(key);

                for (const [dx, dy] of cardinalDirs) {
                    const nx = cell.x + dx, ny = cell.y + dy;
                    if (!patchSet.has(`${nx},${ny}`) && canCollapse(nx, ny)) {
                        frontier.push({ x: nx, y: ny });
                    }
                }
            }

            if (patch.length < minPatchSize) continue;

            for (const c of patch) {
                this.floorMap[c.y][c.x] = null;
                this.backgroundMap[c.y][c.x] = { tileId: globalVars.VOID_FILL, layer: 'background' };
                this.pendingCollapsingFloorSpawns.push(c);
                usedCells.add(`${c.x},${c.y}`);
            }

            placed++;
            console.log(`  Collapsing floor: ${patch.length} tiles`);
        }

        this.walkableTiles = this.walkableTiles.filter(
            t => !usedCells.has(`${t.x},${t.y}`)
        );

        if (placed > 0) {
            console.log(`Collapsing floor generation: ${placed} patch(es)`);
        }
    }

    // ========================================================================
    // WILDCARD PROCESSING
    // ========================================================================

    async processWildcards(context = null) {
        if (context) {
            this.resolveUnknownWildcards(context);
        }

        const regions = [];
        const processed = new Set();

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const key = `${x},${y}`;
                if (processed.has(key)) continue;

                const wildcard = this.wildcardMap[y][x];
                if (wildcard && wildcard.type !== 'unknown') {
                    const region = this.findWildcardRegion(x, y, wildcard.type, processed);
                    regions.push({ region, type: wildcard.type });
                }
            }
        }

        const mazes = regions.filter(r => r.type === 'maze');
        const rooms = regions.filter(r => r.type === 'room');
        const abysses = regions.filter(r => r.type === 'abyss');
        const others = regions.filter(r => r.type !== 'maze' && r.type !== 'room' && r.type !== 'abyss');

        for (const { region, type } of [...mazes, ...rooms, ...others, ...abysses]) {
            await this.generateWildcardContent(region, type, context);
        }
    }

    findWildcardRegion(startX, startY, type, processed) {
        let minX = startX, maxX = startX, minY = startY, maxY = startY;
        const stack = [{ x: startX, y: startY }];

        while (stack.length > 0) {
            const { x, y } = stack.pop();
            const key = `${x},${y}`;

            if (processed.has(key)) continue;
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;

            const wildcard = this.wildcardMap[y][x];
            if (!wildcard || wildcard.type !== type) continue;

            processed.add(key);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);

            stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    }

    async generateWildcardContent(region, type, context = null) {
        console.log(`Generating ${type} at (${region.x}, ${region.y}) size ${region.width}x${region.height}`);

        switch (type) {
            case 'maze':
                this.generateMazeAt(region.x, region.y, region.width, region.height);
                break;
            case 'dungeon':
                this.generateDungeonAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'cave':
                this.generateCaveAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'infernal':
                this.generateInfernalAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'room':
                this.generateRoomAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'palladian':
                this.generatePalladianAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'abyss':
                this.generateAbyssAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'item_spawn':
                break;
            case 'actor_spawn':
                break;
            default:
                if (context && context.getActorData) {
                    const actorData = context.getActorData(type);
                    if (actorData) {
                        this.spawnActorsAt(region, type, context);
                    }
                }
                break;
        }
    }

    spawnActorsAt(region, actorType, context) {
        if (!context || !context.getActorData || !context.createActor) {
            console.warn(`Cannot spawn actors without context`);
            return;
        }

        const actorData = context.getActorData(actorType);
        if (!actorData) {
            console.warn(`No actor data found for wildcard type '${actorType}'`);
            return;
        }

        for (let y = region.y; y < region.y + region.height; y++) {
            for (let x = region.x; x < region.x + region.width; x++) {
                const wildcard = this.wildcardMap[y][x];
                if (wildcard && wildcard.type === actorType) {
                    context.createActor(x, y, actorType, actorData);
                }
            }
        }
    }

    // ========================================================================
    // REGIONAL GENERATION METHODS
    // ========================================================================

    generateMazeAt(startX, startY, width, height) {
        const maze = new ROT.Map.EllerMaze(width, height);
        maze.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'maze') {
                    return;
                }

                if (value === 0) {
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.walkableTiles.push({ x: worldX, y: worldY });
                }
            }
        });
    }

    generateDungeonAt(startX, startY, width, height, context = null) {
        const minDimension = Math.min(width, height);

        const maxRoomWidth = Math.min(12, Math.max(7, Math.floor(width / 4)));
        const maxRoomHeight = Math.min(10, Math.max(5, Math.floor(height / 5)));
        const maxCorridorLength = Math.min(8, Math.max(5, Math.floor(minDimension / 8)));
        const dugPercentage = Math.min(0.5, 0.25 + (minDimension / 200));

        const dungeon = new ROT.Map.Digger(width, height, {
            roomWidth: [3, maxRoomWidth],
            roomHeight: [3, maxRoomHeight],
            corridorLength: [2, maxCorridorLength],
            dugPercentage: dugPercentage
        });

        console.log(`Dungeon generation: ${width}x${height}, rooms ${3}-${maxRoomWidth} x ${3}-${maxRoomHeight}, corridors 2-${maxCorridorLength}, dug ${(dugPercentage * 100).toFixed(0)}%`);

        const floorCells = new Set();
        const wallPositions = [];
        const doorPositions = [];

        dungeon.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'dungeon') {
                    return;
                }

                if (value === 0) {
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.walkableTiles.push({ x: worldX, y: worldY });
                    floorCells.add(`${x},${y}`);
                }
            }
        });

        const hasFloor = (lx, ly) => floorCells.has(`${lx},${ly}`);
        const inBounds = (lx, ly) => lx >= 0 && lx < width && ly >= 0 && ly < height;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (hasFloor(x, y)) continue;

                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX >= this.width || worldY >= this.height) continue;

                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'dungeon') continue;

                const adjacentToFloor =
                    (inBounds(x - 1, y) && hasFloor(x - 1, y)) ||
                    (inBounds(x + 1, y) && hasFloor(x + 1, y)) ||
                    (inBounds(x, y - 1) && hasFloor(x, y - 1)) ||
                    (inBounds(x, y + 1) && hasFloor(x, y + 1)) ||
                    (inBounds(x - 1, y - 1) && hasFloor(x - 1, y - 1)) ||
                    (inBounds(x + 1, y - 1) && hasFloor(x + 1, y - 1)) ||
                    (inBounds(x - 1, y + 1) && hasFloor(x - 1, y + 1)) ||
                    (inBounds(x + 1, y + 1) && hasFloor(x + 1, y + 1));

                if (adjacentToFloor && worldY > 0) {
                    wallPositions.push({ x: worldX, y: worldY });
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                }
            }
        }

        const rooms = dungeon.getRooms();
        const torchPositions = [];

        for (const room of rooms) {
            const roomWalls = [];

            room.getDoors((x, y) => {
                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX < this.width && worldY < this.height && worldY > 0) {
                    const wildcard = this.wildcardMap[worldY][worldX];
                    if (wildcard && wildcard.type === 'dungeon') {
                        if (ROT.RNG.getPercentage() <= 50) {
                            doorPositions.push({ x: worldX, y: worldY });
                        }
                    }
                }
            });

            const roomLeft = room.getLeft();
            const roomRight = room.getRight();
            const roomTop = room.getTop();
            const roomBottom = room.getBottom();

            for (const wallPos of wallPositions) {
                const localX = wallPos.x - startX;
                const localY = wallPos.y - startY;

                const isOnRoomPerimeter = (
                    (localX >= roomLeft - 1 && localX <= roomRight + 1 &&
                     localY >= roomTop - 1 && localY <= roomBottom + 1) &&
                    (localX === roomLeft - 1 || localX === roomRight + 1 ||
                     localY === roomTop - 1 || localY === roomBottom + 1)
                );

                if (isOnRoomPerimeter) {
                    roomWalls.push(wallPos);
                }
            }

            if (roomWalls.length > 0 && ROT.RNG.getPercentage() <= 30) {
                const torchIndex = Math.floor(ROT.RNG.getUniform() * roomWalls.length);
                const torchPos = roomWalls[torchIndex];
                torchPositions.push(torchPos);
            }
        }

        const torchSet = new Set(torchPositions.map(p => `${p.x},${p.y}`));
        const filteredWallPositions = wallPositions.filter(p => !torchSet.has(`${p.x},${p.y}`));

        this.pendingWallSpawns.push(...filteredWallPositions);
        this.pendingDoorSpawns.push(...doorPositions);
        this.pendingTorchSpawns.push(...torchPositions);

        console.log(`Dungeon generated: ${floorCells.size} floor tiles, ${filteredWallPositions.length} walls, ${doorPositions.length} doors, ${torchPositions.length} torches`);
    }

    /**
     * Carve a cellular-automaton cave inside a wildcard region, queueing walls
     * around its edges. `wildcardType` is which region cells to claim; `label` names
     * the generator in the log. Anything else the biome adds, such as lava lakes,
     * is applied by the caller afterwards.

    */
    _generateCaveRegion(wildcardType, label, startX, startY, width, height, context = null) {
        const mapGenConfig = context?.getMapGeneratorConfig?.() || {};

        const cave = new ROT.Map.Cellular(width, height, {
            born: mapGenConfig.born || [5, 6, 7, 8],
            survive: mapGenConfig.survive || [4, 5, 6, 7, 8],
            topology: mapGenConfig.topology || 8
        });

        cave.randomize(mapGenConfig.probability || 0.5);

        const iterations = mapGenConfig.iterations || 4;
        for (let i = 0; i < iterations; i++) {
            cave.create();
        }

        const floorCells = new Set();
        const wallPositions = [];

        // The region is a hole in an authored map, so only carve cells it claims.
        const claims = (worldX, worldY) =>
            worldX < this.width && worldY < this.height &&
            this.wildcardMap[worldY][worldX]?.type === wildcardType;

        const carveFloor = (worldX, worldY, localX, localY) => {
            this.backgroundMap[worldY][worldX] = null;
            this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
            this.walkableTiles.push({ x: worldX, y: worldY });
            floorCells.add(`${localX},${localY}`);
        };

        cave.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;
            if (value === 0 && claims(worldX, worldY)) carveFloor(worldX, worldY, x, y);
        });

        cave.connect((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;
            if (value === 0 && claims(worldX, worldY) && !this.floorMap[worldY][worldX]) {
                carveFloor(worldX, worldY, x, y);
            }
        }, 1);

        // Whatever the automaton left solid becomes a wall, on a floor tile so it
        // sits on ground rather than over the void.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (floorCells.has(`${x},${y}`)) continue;
                const worldX = startX + x;
                const worldY = startY + y;
                if (!claims(worldX, worldY)) continue;

                this.backgroundMap[worldY][worldX] = null;
                this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                wallPositions.push({ x: worldX, y: worldY });
            }
        }

        const wallTypes = mapGenConfig.wall_types || [{ type: 'wall', weight: 100 }];
        for (const pos of wallPositions) {
            this.pendingWallSpawns.push({ x: pos.x, y: pos.y, type: this._pickWeightedWallType(wallTypes) });
        }

        console.log(`${label} generated: ${floorCells.size} floor tiles, ${wallPositions.length} walls`);
        return { floorCells, wallPositions };
    }

    generateCaveAt(startX, startY, width, height, context = null) {
        return this._generateCaveRegion('cave', 'Cave', startX, startY, width, height, context);
    }

    generateInfernalAt(startX, startY, width, height, context = null) {
        return this._generateCaveRegion('infernal', 'Infernal cave', startX, startY, width, height, context);
    }

    generateAbyssAt(startX, startY, width, height, context = null) {
        // The region's cells, in world coordinates. Reads wildcardMap directly
        // rather than ctx.get, which returns a tileId and not the wildcard's type.
        const regionSet = this.applyTilePattern('wildcards', [{
            when: (ctx, x, y) =>
                this.wildcardMap[y][x]?.type === 'abyss' && !!this.floorMap[y][x],
            paint: null
        }], {
            collect: 'set',
            bounds: { x1: startX, y1: startY, x2: startX + width - 1, y2: startY + height - 1 }
        });

        if (regionSet.size === 0) return;

        // `mask` fences the blobs to the region: they stamp a shape wherever it
        // lands and eat rock on the way, so an unfenced blob would chew through the
        // hand-authored map around the region. requireFloorOverlap is dropped
        // because the region is entirely floor already.
        const config = {
            count: [1, Math.max(1, Math.floor(regionSet.size / 40))],
            types: ['abyss'],
            minSize: Math.min(10, Math.floor(regionSet.size / 4)),
            maxSize: Math.floor(regionSet.size / 2),
            mask: regionSet,
            requireFloorOverlap: 0
        };

        this.generateOverlayBlobs(config);
    }

    generateRoomAt(startX, startY, width, height, context = null) {
        const wallPositions = [];

        const hasMazeFloor = (wx, wy) => {
            if (wx < 0 || wx >= this.width || wy < 0 || wy >= this.height) return false;
            const floor = this.floorMap[wy][wx];
            return floor && floor.tileId === this.config.defaultFloorTileId;
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX < this.width && worldY < this.height) {
                    this.backgroundMap[worldY][worldX] = null;

                    const isPerimeter = (x === 0 || x === width - 1 || y === 0 || y === height - 1);

                    let hasAdjacentMazePath = false;
                    if (isPerimeter) {
                        if (x === 0 && hasMazeFloor(worldX - 1, worldY)) hasAdjacentMazePath = true;
                        if (x === width - 1 && hasMazeFloor(worldX + 1, worldY)) hasAdjacentMazePath = true;
                        if (y === 0 && hasMazeFloor(worldX, worldY - 1)) hasAdjacentMazePath = true;
                        if (y === height - 1 && hasMazeFloor(worldX, worldY + 1)) hasAdjacentMazePath = true;
                    }

                    if (isPerimeter && !hasAdjacentMazePath) {
                        if (worldY > 0) {
                            wallPositions.push({ x: worldX, y: worldY });
                        }
                        this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    } else {
                        this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x: worldX, y: worldY });
                    }
                }
            }
        }

        this.pendingWallSpawns.push(...wallPositions);
    }

    /**
     * Wildcard counterpart to the full-floor 'palladian' case: drops a villa inside a
     * single wildcard region, so a temple can be one feature of a larger floor.
     *
     * Reuses every stage helper unchanged by having _palladianBuildGrid center the plan
     * inside the region's bounding box — the plan it returns is in world coordinates, so
     * carving, openings, columns and windows all work as they do on a full floor. Only
     * the finalize step differs (see _palladianFinalizeRegion).
     */
    generatePalladianAt(startX, startY, width, height, context = null) {
        const mapGenConfig = context?.getMapGeneratorConfig?.() || {};
        const cfg = {
            bayColumns: mapGenConfig.bayColumns || [3, 5],
            bayRows: mapGenConfig.bayRows || [2, 3],
            bayWidth: mapGenConfig.bayWidth || [3, 7],
            bayHeight: mapGenConfig.bayHeight || [3, 6],
            centralBias: mapGenConfig.centralBias ?? 150,
            mergeChance: mapGenConfig.mergeChance ?? 45,
            sanctumChance: mapGenConfig.sanctumChance ?? 70,
            sanctumShapes: mapGenConfig.sanctumShapes || ['cross', 'tee', 'eye'],
            // A wildcard villa sits inside an existing floor, so a projecting portico
            // would push its colonnade into whatever is already there. In-antis keeps
            // the whole composition inside the region footprint.
            porticoStyle: mapGenConfig.porticoStyle || 'in_antis',
            porticoDepth: mapGenConfig.porticoDepth ?? 2,
            columnSpacing: mapGenConfig.columnSpacing ?? 2,
            doorChance: mapGenConfig.doorChance ?? 55,
            torchChance: mapGenConfig.torchChance ?? 40,
            wall_types: mapGenConfig.wall_types || [{ type: 'brick_wall', weight: 100 }],
            secretPassageChance: mapGenConfig.secretPassageChance ?? 40,
            secretPassageLeverChance: mapGenConfig.secretPassageLeverChance ?? 35,
        };

        // The mask is the region as authored, which may be an irregular blob. The plan
        // is fitted to the bounding box, so a non-rectangular region can clip it; the
        // mask keeps that clip from corrupting neighbouring geometry.
        // The region's cells, in world coordinates. Reads wildcardMap directly
        // rather than ctx.get, which returns a tileId and not the wildcard's type.
        const mask = this.applyTilePattern('wildcards', [{
            when: (ctx, x, y) => this.wildcardMap[y][x]?.type === 'palladian',
            paint: null
        }], {
            collect: 'set',
            bounds: { x1: startX, y1: startY, x2: startX + width - 1, y2: startY + height - 1 }
        });
        if (mask.size === 0) return;

        const plan = this._palladianBuildGrid(cfg, { x: startX, y: startY, width, height });
        if (!plan) {
            // Too small for even a 1x1 villa. Carve the region as a plain hall rather
            // than leaving a hole in the floor the player can't cross.
            console.warn(`Palladian wildcard: region ${width}x${height} at (${startX},${startY}) too small for a villa; carving a plain hall`);
            for (const key of mask) {
                const [hx, hy] = key.split(',').map(Number);
                this.backgroundMap[hy][hx] = null;
                this.floorMap[hy][hx] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                this.walkableTiles.push({ x: hx, y: hy });
            }
            return;
        }

        const dungeonGrid = Array.from({ length: this.height }, () => new Uint8Array(this.width));
        this._palladianCarveBays(dungeonGrid, plan);
        const rooms = this._palladianLayoutRooms(dungeonGrid, plan, cfg);
        const portico = this._palladianAddPortico(dungeonGrid, plan, cfg);
        const openings = this._palladianAddOpenings(dungeonGrid, plan, rooms, portico, cfg);
        this._palladianEnsureConnected(dungeonGrid, plan, rooms, portico);
        const secrets = this._palladianAddSecretPassages(dungeonGrid, plan, rooms, cfg);

        const records = this._palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings);
        this._palladianFinalizeRegion(dungeonGrid, records, mask, cfg);
        this._palladianQueueSecrets(secrets);

        // Same ordering rule as the full-floor path: decoration must run after
        // finalize, or the torch pass converts a column into a wall torch.
        this._palladianPlaceColumns(plan, portico, cfg);
        this._palladianPlaceWindows(openings);
        this._palladianPublishRegions(dungeonGrid, plan, records, portico);
        this.palladianPlan = plan;

        const sanctum = records.find(r => r.isSanctum);
        console.log(
            `Palladian wildcard villa ${plan.nCols}x${plan.nRows} bays ` +
            `(${plan.footprintW}x${plan.footprintH} tiles at ${plan.left},${plan.top}, axis x=${plan.axisX}) ` +
            `in region ${width}x${height} at (${startX},${startY}): ` +
            `${records.length} rooms, sanctum ${sanctum ? sanctum.shape : 'none'}, ` +
            `portico ${portico ? portico.style : 'none'}, ${openings.windows.length} windows.`
        );
    }

    /**
     * Region-scoped variant of _brogueFinalizeMap.
     *
     * Differs in three ways that matter, all of them consequences of there being a
     * map outside the villa:
     *   - iteration and every write are clipped to `mask`, so the pass cannot repaint
     *     the surrounding floor;
     *   - there is no perimeter/metal_wall rule. That rule exists to seal the edge of
     *     the world; inside a floor it would wall the villa off from its surroundings;
     *   - rooms and regions are APPENDED. _brogueFinalizeMap assigns this.diggerRooms,
     *     which would discard the rooms of every other generator on the floor.
     */
    _palladianFinalizeRegion(dungeonGrid, rooms, mask, cfg) {
        const floorSet = new Set();
        const inMask = (x, y) => mask.has(`${x},${y}`);

        for (const key of mask) {
            const [x, y] = key.split(',').map(Number);
            if (dungeonGrid[y][x] >= 1) {
                this.backgroundMap[y][x] = null;
                this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                this.walkableTiles.push({ x, y });
                floorSet.add(key);
            }
        }

        const hasFloor = (fx, fy) => floorSet.has(`${fx},${fy}`);
        const wallTypes = cfg.wall_types;
        const pickWallType = () => this._pickWeightedWallType(wallTypes);

        for (const key of mask) {
            const [x, y] = key.split(',').map(Number);
            if (floorSet.has(key)) continue;
            const adj = anyNeighbor8(hasFloor, x, y);
            if (!adj || y === 0) continue;

            this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
            this.pendingWallSpawns.push({ x, y, type: pickWallType() });
        }

        // Doors: dungeonGrid marks them with 2. Clipped to the mask like everything else.
        for (const key of mask) {
            const [x, y] = key.split(',').map(Number);
            if (dungeonGrid[y][x] === 2 && y > 0 && ROT.RNG.getPercentage() <= cfg.doorChance) {
                this.pendingDoorSpawns.push({ x, y });
            }
        }

        for (const room of rooms) {
            if (ROT.RNG.getPercentage() > cfg.torchChance) continue;
            const roomWalls = this.pendingWallSpawns.filter(p =>
                p.type !== 'metal_wall' && inMask(p.x, p.y) &&
                p.x >= room._x1 - 1 && p.x <= room._x2 + 1 &&
                p.y >= room._y1 - 1 && p.y <= room._y2 + 1
            );
            if (roomWalls.length === 0) continue;
            this.queueRoomLights(
                roomWalls, this.countRoomFloorTiles(room, floorSet), room, floorSet
            );
        }

        this.diggerRooms = [...(this.diggerRooms || []), ...rooms];
        this.publishRoomRegions(rooms, floorSet);
    }

    // ========================================================================
    // ENTITY SPAWNING
    // ========================================================================

    spawnPendingWalls(context) {
        if (!this.pendingWallSpawns || this.pendingWallSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn walls without context');
            return;
        }

        const actorDataCache = {};
        const typeCounts = {};

        for (const pos of this.pendingWallSpawns) {
            if (context.getActorAt) {
                const existingActor = context.getActorAt(pos.x, pos.y);
                if (existingActor && existingActor.hasAttribute('stairway')) {
                    continue;
                }
            }

            const wallType = pos.type || 'wall';

            if (!actorDataCache[wallType]) {
                actorDataCache[wallType] = context.getActorData(wallType);
                if (!actorDataCache[wallType]) {
                    console.warn(`No actor data found for wall type: ${wallType}`);
                    continue;
                }
                typeCounts[wallType] = 0;
            }

            const actorData = actorDataCache[wallType];
            if (!actorData) continue;

            context.createActor(pos.x, pos.y, wallType, actorData);
            typeCounts[wallType]++;
        }

        const summary = Object.entries(typeCounts).map(([type, count]) => `${count} ${type}`).join(', ');
        console.log(`Spawned wall actors: ${summary}`);
        this.pendingWallSpawns = [];
    }

    spawnPendingDoors(context) {
        if (!this.pendingDoorSpawns || this.pendingDoorSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn doors without context');
            return;
        }

        const actorData = context.getActorData('door');
        if (!actorData) {
            console.warn('No door actor data found');
            return;
        }

        for (const pos of this.pendingDoorSpawns) {
            context.createActor(pos.x, pos.y, 'door', actorData);
        }

        console.log(`Spawned ${this.pendingDoorSpawns.length} door actors`);
        this.pendingDoorSpawns = [];
    }

    spawnPendingTorches(context) {
        if (!this.pendingTorchSpawns || this.pendingTorchSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn torches without context');
            return;
        }

        // Wall mounts use the `wall_torch` actor (display name "mounted torch"),
        // distinct from the takeable `torch` item. The freestanding centrepiece is
        // a `brazier`, spawned separately.
        const actorData = context.getActorData('wall_torch');
        if (!actorData) {
            console.warn('No wall_torch actor data found');
            return;
        }

        for (const pos of this.pendingTorchSpawns) {
            context.createActor(pos.x, pos.y, 'wall_torch', actorData);
        }

        console.log(`Spawned ${this.pendingTorchSpawns.length} wall torch actors`);
        this.pendingTorchSpawns = [];
    }

    spawnPendingBraziers(context) {
        if (!this.pendingBrazierSpawns || this.pendingBrazierSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn braziers without context');
            return;
        }

        const actorData = context.getActorData('brazier');
        if (!actorData) {
            console.warn('No brazier actor data found');
            return;
        }

        for (const pos of this.pendingBrazierSpawns) {
            context.createActor(pos.x, pos.y, 'brazier', actorData);
        }

        console.log(`Spawned ${this.pendingBrazierSpawns.length} centre brazier actors`);
        this.pendingBrazierSpawns = [];
    }

    spawnPendingLava(context) {
        if (!this.pendingLavaSpawns || this.pendingLavaSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn lava without context');
            return;
        }

        const actorData = context.getActorData('lava');
        if (!actorData) {
            console.warn('No lava actor data found');
            return;
        }

        for (const pos of this.pendingLavaSpawns) {
            context.createActor(pos.x, pos.y, 'lava', actorData);
        }

        console.log(`Spawned ${this.pendingLavaSpawns.length} lava actors`);
        this.pendingLavaSpawns = [];
    }

    spawnPendingLakes(context) {
        if (!this.pendingLakeSpawns || this.pendingLakeSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn lakes without context');
            return;
        }

        const actorData = context.getActorData('water');
        if (!actorData) {
            console.warn('No water actor data found');
            return;
        }

        for (const pos of this.pendingLakeSpawns) {
            context.createActor(pos.x, pos.y, 'water', actorData);
        }

        console.log(`Spawned ${this.pendingLakeSpawns.length} water actors`);
        this.pendingLakeSpawns = [];
    }

    spawnPendingSewage(context) {
        if (!this.pendingSewageSpawns || this.pendingSewageSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn sewage without context');
            return;
        }

        const actorData = context.getActorData('sewage');
        if (!actorData) {
            console.warn('No sewage actor data found');
            return;
        }

        for (const pos of this.pendingSewageSpawns) {
            context.createActor(pos.x, pos.y, 'sewage', actorData);
        }

        console.log(`Spawned ${this.pendingSewageSpawns.length} sewage actors`);
        this.pendingSewageSpawns = [];
    }

    spawnPendingPushableWalls(context) {
        if (!this.pendingPushableWallSpawns || this.pendingPushableWallSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn pushable walls without context');
            return;
        }

        const actorData = context.getActorData('pushable_wall');
        if (!actorData) {
            console.warn('No pushable_wall actor data found');
            return;
        }

        for (const pos of this.pendingPushableWallSpawns) {
            context.createActor(pos.x, pos.y, 'pushable_wall', actorData);
        }

        console.log(`Spawned ${this.pendingPushableWallSpawns.length} pushable wall actors`);
        this.pendingPushableWallSpawns = [];
    }

    /**
     * Secret doors and the concealed levers that work them.
     *
     * Both spawn as ordinary actors carrying `hidden: true`; the search action
     * (see EPISTEMOLOGY.md) is what turns them up. A lever is linked to its door
     * by machine_id, written here because the pair is only known at generation
     * time — the actor data cannot name a partner it has not been placed beside.
     */
    spawnPendingSecretDoors(context) {
        if (!this.pendingSecretDoorSpawns || this.pendingSecretDoorSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn secret doors without context');
            return;
        }

        // A lever-driven passage uses the barred variant, which is locked: revealing
        // it is not enough, the lever has to be found too. Without a lever the plain
        // variant opens on a bump once discovered.
        const plainData = context.getActorData('hidden_door');
        if (!plainData) {
            console.warn('No hidden_door actor data found');
            return;
        }
        const barredData = context.getActorData('barred_hidden_door');

        for (const pos of this.pendingSecretDoorSpawns) {
            // No barred data means no locked door, and an unlocked door would open
            // on a bump — so drop the lever's machine link rather than ship a
            // passage whose lever does nothing.
            const barred = !!pos.machine_id && !!barredData;
            if (pos.machine_id && !barredData) {
                console.warn('No barred_hidden_door actor data; secret door will not be lever-locked');
            }
            context.createActor(
                pos.x, pos.y,
                barred ? 'barred_hidden_door' : 'hidden_door',
                this._withMachineId(barred ? barredData : plainData, barred ? pos.machine_id : null)
            );
        }

        console.log(`Spawned ${this.pendingSecretDoorSpawns.length} secret door actors`);
        this.pendingSecretDoorSpawns = [];
    }

    spawnPendingHiddenLevers(context) {
        if (!this.pendingHiddenLeverSpawns || this.pendingHiddenLeverSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn hidden levers without context');
            return;
        }

        const actorData = context.getActorData('hidden_lever');
        if (!actorData) {
            console.warn('No hidden_lever actor data found');
            return;
        }

        for (const pos of this.pendingHiddenLeverSpawns) {
            context.createActor(pos.x, pos.y, 'hidden_lever', this._withMachineId(actorData, pos.machine_id));
        }

        console.log(`Spawned ${this.pendingHiddenLeverSpawns.length} hidden lever actors`);
        this.pendingHiddenLeverSpawns = [];
    }

    // Shallow copy of actor data with a machine_id folded into its attributes.
    // Returns the original untouched when there is no id to add, so the common
    // case allocates nothing.
    _withMachineId(actorData, machineId) {
        if (!machineId) return actorData;
        return {
            ...actorData,
            attributes: { ...(actorData.attributes || {}), machine_id: machineId }
        };
    }

    spawnPendingBridges(context) {
        if (!this.pendingBridgeSpawns || this.pendingBridgeSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn bridges without context');
            return;
        }

        const actorData = context.getActorData('rope_bridge');
        if (!actorData) {
            console.warn('No rope_bridge actor data found');
            return;
        }

        // Choose each cell's box-drawing tile from which of its four neighbours are
        // also bridge cells. Straight runs stay straight; where a horizontal and a
        // vertical crossing meet, the shared cell becomes a "+" (or a T at a wall)
        // junction. Endpoints (one connection) fall back to the straight tile for
        // their axis. Every pattern maps to a tile in data/static-tiles.json.
        // Keyed by crossing group, not by bare position, so two unrelated bridges
        // running alongside each other don't read as connected. Cells of one blob's
        // h and v crossings share a group, so a real intersection resolves to "+".
        const cellSet = new Set(
            this.pendingBridgeSpawns.map(p => `${p.crossingGroup}:${p.x},${p.y}`)
        );
        const has = (group, x, y) => cellSet.has(`${group}:${x},${y}`);
        const tileNameFor = (pos) => {
            const n = has(pos.crossingGroup, pos.x, pos.y - 1);
            const s = has(pos.crossingGroup, pos.x, pos.y + 1);
            const e = has(pos.crossingGroup, pos.x + 1, pos.y);
            const w = has(pos.crossingGroup, pos.x - 1, pos.y);
            const count = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);
            if (count >= 3) {
                if (n && s && e && w) return 'WHITE_BOX_VERTICAL_HORIZONTAL'; // +
                if (e && w && s) return 'WHITE_BOX_DOWN_HORIZONTAL';  // T pointing down
                if (e && w && n) return 'WHITE_BOX_UP_HORIZONTAL';    // T pointing up
                if (n && s && e) return 'WHITE_BOX_RIGHT_VERTICAL';   // T pointing right
                return 'WHITE_BOX_LEFT_VERTICAL';                     // n && s && w -> T pointing left
            }
            if (count === 2) {
                if (e && w) return 'WHITE_BOX_HORIZONTAL';
                if (n && s) return 'WHITE_BOX_VERTICAL';
                // Corners — named by where the corner sits; lines extend the two
                // connected directions.
                if (n && e) return 'WHITE_BOX_BOTTOM_LEFT';   // lines up + right
                if (n && w) return 'WHITE_BOX_BOTTOM_RIGHT';  // lines up + left
                if (s && e) return 'WHITE_BOX_TOP_LEFT';      // lines down + right
                return 'WHITE_BOX_TOP_RIGHT';                 // s && w -> lines down + left
            }
            // 0 or 1 connection (endpoint / lone cell): straight tile for the axis.
            return pos.dir === 'v' ? 'WHITE_BOX_VERTICAL' : 'WHITE_BOX_HORIZONTAL';
        };

        // Clone the shared actorData per-tile so we never mutate the catalog entry.
        for (const pos of this.pendingBridgeSpawns) {
            const data = { ...actorData, tileIndexBase: tileNameFor(pos) };
            context.createActor(pos.x, pos.y, 'rope_bridge', data);
        }

        console.log(`Spawned ${this.pendingBridgeSpawns.length} rope bridge actors`);
        this.pendingBridgeSpawns = [];
    }

    spawnPendingCollapsingFloors(context) {
        if (!this.pendingCollapsingFloorSpawns || this.pendingCollapsingFloorSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn collapsing floors without context');
            return;
        }

        const actorData = context.getActorData('collapsing_floor');
        if (!actorData) {
            console.warn('No collapsing_floor actor data found');
            return;
        }

        for (const pos of this.pendingCollapsingFloorSpawns) {
            context.createActor(pos.x, pos.y, 'collapsing_floor', actorData);
        }

        console.log(`Spawned ${this.pendingCollapsingFloorSpawns.length} collapsing floor actors`);
        this.pendingCollapsingFloorSpawns = [];
    }

    // ========================================================================
    // SWITCH PUZZLES
    // ========================================================================

    spawnSwitchPuzzles(config, context) {
        if (!config || !this.diggerRooms || this.diggerRooms.length === 0) return [];
        if (!context?.createActor || !context?.getActorData) return [];

        const min = config.min ?? 0;
        const max = config.max ?? min;
        const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        if (count <= 0 || !config.patterns || config.patterns.length === 0) return [];

        const totalWeight = config.patterns.reduce((sum, p) => sum + (p.weight ?? 1), 0);
        const results = [];

        for (let i = 0; i < count; i++) {
            let roll = ROT.RNG.getUniform() * totalWeight;
            let pattern = config.patterns[0];
            for (const p of config.patterns) {
                roll -= (p.weight ?? 1);
                if (roll <= 0) { pattern = p; break; }
            }

            const machineId = `switch_puzzle_${i}`;
            let result = null;

            switch (pattern.type) {
                case 'gated_room':
                    result = this._placeSwitchPuzzle_gatedRoom(pattern, machineId, context);
                    break;
                case 'gated_corridor':
                    result = this._placeSwitchPuzzle_gatedCorridor(pattern, machineId, context);
                    break;
            }

            if (result) {
                results.push(result);
                console.log(`Switch puzzle "${pattern.type}" placed with machine_id="${machineId}"`);
            }
        }

        return results;
    }

    _placeSwitchPuzzle_gatedRoom(pattern, machineId, context) {
        const eligibleRooms = this.diggerRooms
            .map((room, idx) => ({ room, idx }))
            .filter(({ idx }) => !this.claimedRoomIndices.has(idx))
            .filter(({ room }) => {
                let doorCount = 0;
                room.getDoors(() => doorCount++);
                return doorCount >= 1;
            });

        if (eligibleRooms.length === 0) return null;

        const { room, idx } = eligibleRooms[Math.floor(ROT.RNG.getUniform() * eligibleRooms.length)];
        this.claimedRoomIndices.add(idx);

        const doors = [];
        room.getDoors((x, y) => doors.push({ x, y }));
        const chosenDoor = doors[Math.floor(ROT.RNG.getUniform() * doors.length)];

        this.pendingDoorSpawns = this.pendingDoorSpawns.filter(
            p => !(p.x === chosenDoor.x && p.y === chosenDoor.y)
        );

        const switchActorType = pattern.switch_actor || 'gate_lever';
        const targetActorType = pattern.target_actor || 'gate';

        const targetData = context.getActorData(targetActorType);
        if (!targetData) return null;

        const gateData = {
            ...targetData,
            attributes: {
                ...(targetData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(chosenDoor.x, chosenDoor.y, targetActorType, gateData);

        const switchData = context.getActorData(switchActorType);
        if (!switchData) return null;

        const leverPos = this._findLeverPosition(room, chosenDoor);
        if (!leverPos) return null;

        const leverData = {
            ...switchData,
            switch_effects: pattern.switch_effects || switchData.switch_effects || { locked: false, open: true },
            switch_message: pattern.switch_message || switchData.switch_message || 'You pull [name].',
            attributes: {
                ...(switchData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(leverPos.x, leverPos.y, switchActorType, leverData);

        this.walkableTiles = this.walkableTiles.filter(
            t => !(t.x === leverPos.x && t.y === leverPos.y) && !(t.x === chosenDoor.x && t.y === chosenDoor.y)
        );

        return { machineId, type: 'gated_room', gate: chosenDoor, lever: leverPos };
    }

    _findLeverPosition(room, doorPos) {
        const roomLeft = room.getLeft();
        const roomRight = room.getRight();
        const roomTop = room.getTop();
        const roomBottom = room.getBottom();

        const isInsideRoom = (x, y) =>
            x >= roomLeft && x <= roomRight && y >= roomTop && y <= roomBottom;

        const candidates = [];
        for (const dir of [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 }]) {
            const nx = doorPos.x + dir.dx;
            const ny = doorPos.y + dir.dy;
            if (!isInsideRoom(nx, ny) && this.isWalkable(nx, ny)) {
                for (const step of [
                    { dx: dir.dx, dy: dir.dy },
                    { dx: dir.dy, dy: dir.dx },
                    { dx: -dir.dy, dy: -dir.dx }
                ]) {
                    const lx = nx + step.dx;
                    const ly = ny + step.dy;
                    if (this.isWalkable(lx, ly) && !isInsideRoom(lx, ly)) {
                        const hasWallNeighbor = [
                            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
                            { dx: 0, dy: -1 }, { dx: 0, dy: 1 }
                        ].some(d => !this.isWalkable(lx + d.dx, ly + d.dy));
                        if (hasWallNeighbor) {
                            candidates.push({ x: lx, y: ly });
                        }
                    }
                }
                if (candidates.length === 0) {
                    candidates.push({ x: nx, y: ny });
                }
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
    }

    _placeSwitchPuzzle_gatedCorridor(pattern, machineId, context) {
        const roomTileSet = new Set();
        for (const room of this.diggerRooms) {
            for (let y = room.getTop(); y <= room.getBottom(); y++) {
                for (let x = room.getLeft(); x <= room.getRight(); x++) {
                    roomTileSet.add(`${x},${y}`);
                }
            }
        }

        const corridorTiles = this.walkableTiles.filter(
            t => !roomTileSet.has(`${t.x},${t.y}`)
        );

        if (corridorTiles.length < 3) return null;

        const gatePos = corridorTiles[Math.floor(ROT.RNG.getUniform() * corridorTiles.length)];

        const plateCandidates = corridorTiles.filter(t => {
            const dist = Math.abs(t.x - gatePos.x) + Math.abs(t.y - gatePos.y);
            return dist >= 2 && dist <= 6;
        });

        if (plateCandidates.length === 0) return null;

        const platePos = plateCandidates[Math.floor(ROT.RNG.getUniform() * plateCandidates.length)];

        const targetActorType = pattern.target_actor || 'gate';
        const switchActorType = pattern.switch_actor || 'trap_plate';

        const targetData = context.getActorData(targetActorType);
        const switchData = context.getActorData(switchActorType);
        if (!targetData || !switchData) return null;

        const gateData = {
            ...targetData,
            attributes: {
                ...(targetData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(gatePos.x, gatePos.y, targetActorType, gateData);

        const plateData = {
            ...switchData,
            switch_effects: pattern.switch_effects || switchData.switch_effects || { locked: true, open: false },
            switch_message: pattern.switch_message || switchData.switch_message || 'A stone depresses.',
            attributes: {
                ...(switchData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(platePos.x, platePos.y, switchActorType, plateData);

        this.walkableTiles = this.walkableTiles.filter(
            t => !(t.x === gatePos.x && t.y === gatePos.y)
        );

        return { machineId, type: 'gated_corridor', gate: gatePos, plate: platePos };
    }

    // ========================================================================
    // TREASURE ROOM
    // ========================================================================

    spawnTreasureRoom() {
        if (!this.diggerRooms || this.diggerRooms.length === 0) {
            return null;
        }

        // Skip rooms another feature has already taken — a switch puzzle's gated
        // room, or a generator-reserved room like a palladian sanctum. Landing on
        // one would wall off its extra entrances and lock the door.
        // (_placeSwitchPuzzle_gatedRoom already honours this set.)
        const eligibleRooms = this.diggerRooms.filter((room, idx) => {
            if (this.claimedRoomIndices.has(idx)) return false;
            let count = 0;
            room.getDoors(() => count++);
            return count > 0;
        });

        if (eligibleRooms.length === 0) {
            return null;
        }

        const treasureRoom = eligibleRooms[Math.floor(ROT.RNG.getUniform() * eligibleRooms.length)];
        const roomIndex = this.diggerRooms.indexOf(treasureRoom);
        if (roomIndex >= 0) this.claimedRoomIndices.add(roomIndex);

        const roomTiles = [];
        for (let y = treasureRoom.getTop(); y <= treasureRoom.getBottom(); y++) {
            for (let x = treasureRoom.getLeft(); x <= treasureRoom.getRight(); x++) {
                if (this.floorMap[y] && this.floorMap[y][x]) {
                    roomTiles.push({ x, y });
                }
            }
        }

        const allEntrances = [];
        treasureRoom.getDoors((x, y) => allEntrances.push({ x, y }));

        if (allEntrances.length === 0) return null;

        const chosenDoor = allEntrances[0];
        const doorSet = new Set(this.pendingDoorSpawns.map(p => `${p.x},${p.y}`));

        for (const entrance of allEntrances) {
            if (doorSet.has(`${entrance.x},${entrance.y}`)) {
                this.pendingDoorSpawns = this.pendingDoorSpawns.filter(
                    p => !(p.x === entrance.x && p.y === entrance.y)
                );
            }
            if (entrance !== chosenDoor) {
                this.pendingWallSpawns.push({ x: entrance.x, y: entrance.y, type: 'metal_wall' });
                this.walkableTiles = this.walkableTiles.filter(
                    t => !(t.x === entrance.x && t.y === entrance.y)
                );
            }
        }

        const left = treasureRoom.getLeft() - 1;
        const right = treasureRoom.getRight() + 1;
        const top = treasureRoom.getTop() - 1;
        const bottom = treasureRoom.getBottom() + 1;
        const inSeal = (p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
        for (const wall of this.pendingWallSpawns) {
            if (inSeal(wall)) {
                wall.type = 'metal_wall';
            }
        }

        // A vault wall is not sealed just because it looks like one. A secret door
        // or a pushable wall in the ring is a way in that this sweep used to miss
        // entirely — it only ever upgraded pendingWallSpawns — so the loot could be
        // reached by searching or shoving instead of by finding the key. Both
        // queues are drained into metal_wall here, which is the whole point of the
        // vault: exactly one way in, through the locked door.
        const breaches = [];
        this.pendingSecretDoorSpawns = this.pendingSecretDoorSpawns.filter(p => {
            if (!inSeal(p)) return true;
            breaches.push(p);
            return false;
        });
        this.pendingPushableWallSpawns = this.pendingPushableWallSpawns.filter(p => {
            if (!inSeal(p)) return true;
            breaches.push(p);
            return false;
        });
        for (const p of breaches) {
            this.pendingWallSpawns.push({ x: p.x, y: p.y, type: 'metal_wall' });
            this.walkableTiles = this.walkableTiles.filter(t => !(t.x === p.x && t.y === p.y));
        }

        // Finally, close any bare gap in the ring *around* the vault's own floor.
        // Everything above can only upgrade a cell some queue already owns; a cell
        // that is simply open floor belongs to nothing and survived every sweep.
        //
        // The ring is derived from the vault's actual tiles, not from the bbox
        // border: for a cavern or cross-shaped room the bbox border cuts straight
        // through the room's own interior, and sealing that walls the vault off
        // from the inside — the door opens onto a plugged room.
        const vaultTiles = new Set(roomTiles.map(t => `${t.x},${t.y}`));
        const sealed = new Set(this.pendingWallSpawns.map(w => `${w.x},${w.y}`));
        let gapsClosed = 0;
        for (const t of roomTiles) {
            for (const [dx, dy] of TP_DIRS8) {
                const x = t.x + dx, y = t.y + dy;
                if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
                if (vaultTiles.has(`${x},${y}`)) continue;              // the room itself
                if (x === chosenDoor.x && y === chosenDoor.y) continue; // the way in
                if (sealed.has(`${x},${y}`)) continue;
                if (!this.floorMap[y] || this.floorMap[y][x] === null) continue;  // void
                this.pendingWallSpawns.push({ x, y, type: 'metal_wall' });
                this.walkableTiles = this.walkableTiles.filter(c => !(c.x === x && c.y === y));
                sealed.add(`${x},${y}`);
                gapsClosed++;
            }
        }

        // Publish the vault as a named region so a spawn entry can target it with
        // `"region": "treasure_room"` — e.g. a guardian inside the locked vault.
        //
        // Filtered against walkableTiles rather than reusing roomTiles: roomTiles comes
        // from floorMap, which has an entry for WALL tiles too (a wall sits on a floor
        // tile), so it spans the room's walls as well as its interior.
        const walkableKeys = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
        this.namedRegions.treasure_room = roomTiles
            .filter(t => walkableKeys.has(`${t.x},${t.y}`))
            .map(t => ({ x: t.x, y: t.y }));

        console.log(`Treasure room: ${roomTiles.length} floor tiles, locked door at (${chosenDoor.x}, ${chosenDoor.y}), ${allEntrances.length - 1} extra entrance(s) walled off` +
            (breaches.length > 0 ? `, ${breaches.length} secret/pushable breach(es) sealed` : '') +
            (gapsClosed > 0 ? `, ${gapsClosed} open ring gap(s) closed` : ''));
        return { roomTiles, doorPos: chosenDoor };
    }

    // ========================================================================
    // BROGUE GENERATOR HELPERS
    // ========================================================================

    _brogueMakeRoom(type, cfg) {
        switch (type) {
            case 'cross': return this._brogueMakeCross(cfg);
            case 'circular': return this._brogueMakeCircular(cfg);
            case 'cavern': return this._brogueMakeCavern(cfg);
            case 'rectangle':
            default: return this._brogueMakeRectangle(cfg);
        }
    }

    _broguePickRoomType(weights) {
        const entries = Object.entries(weights);
        const total = entries.reduce((s, [, w]) => s + w, 0);
        let roll = ROT.RNG.getUniform() * total;
        for (const [type, weight] of entries) {
            roll -= weight;
            if (roll <= 0) return type;
        }
        return entries[0][0];
    }

    _brogueMakeRectangle(cfg) {
        const w = ROT.RNG.getUniformInt(cfg.rectWidth[0], cfg.rectWidth[1]);
        const h = ROT.RNG.getUniformInt(cfg.rectHeight[0], cfg.rectHeight[1]);
        const grid = Array.from({ length: h }, () => new Uint8Array(w).fill(1));
        return { grid, width: w, height: h };
    }

    _brogueMakeCross(cfg) {
        const totalW = ROT.RNG.getUniformInt(cfg.crossWidth[0], cfg.crossWidth[1]);
        const totalH = ROT.RNG.getUniformInt(cfg.crossHeight[0], cfg.crossHeight[1]);
        const grid = Array.from({ length: totalH }, () => new Uint8Array(totalW));

        const hBarH = ROT.RNG.getUniformInt(2, Math.max(3, Math.floor(totalH * 0.5)));
        const hBarTop = Math.floor((totalH - hBarH) / 2);
        for (let y = hBarTop; y < hBarTop + hBarH; y++) {
            for (let x = 0; x < totalW; x++) grid[y][x] = 1;
        }

        const vBarW = ROT.RNG.getUniformInt(2, Math.max(3, Math.floor(totalW * 0.5)));
        const vBarLeft = Math.floor((totalW - vBarW) / 2);
        for (let y = 0; y < totalH; y++) {
            for (let x = vBarLeft; x < vBarLeft + vBarW; x++) grid[y][x] = 1;
        }

        return { grid, width: totalW, height: totalH };
    }

    _brogueMakeCircular(cfg) {
        const radius = ROT.RNG.getUniformInt(cfg.circularRadius[0], cfg.circularRadius[1]);
        const size = radius * 2 + 1;
        const grid = Array.from({ length: size }, () => new Uint8Array(size));
        const center = radius;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - center;
                const dy = y - center;
                if (dx * dx + dy * dy < radius * radius + radius) {
                    grid[y][x] = 1;
                }
            }
        }

        if (radius >= 4 && ROT.RNG.getPercentage() <= cfg.hollowChance) {
            const innerR = radius - 2;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const dx = x - center;
                    const dy = y - center;
                    if (dx * dx + dy * dy < innerR * innerR) {
                        grid[y][x] = 0;
                    }
                }
            }
        }

        return { grid, width: size, height: size };
    }

    _brogueMakeCavern(cfg) {
        const w = ROT.RNG.getUniformInt(cfg.cavernWidth[0], cfg.cavernWidth[1]);
        const h = ROT.RNG.getUniformInt(cfg.cavernHeight[0], cfg.cavernHeight[1]);
        let grid = Array.from({ length: h }, () => {
            const row = new Uint8Array(w);
            for (let x = 0; x < w; x++) row[x] = ROT.RNG.getUniform() < 0.55 ? 1 : 0;
            return row;
        });

        // B5678/S45678 cellular automata, 5 iterations
        for (let iter = 0; iter < 5; iter++) {
            const next = Array.from({ length: h }, () => new Uint8Array(w));
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let neighbors = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny][nx] === 1) neighbors++;
                        }
                    }
                    if (grid[y][x] === 1) {
                        next[y][x] = neighbors >= 4 ? 1 : 0; // survive with 4+
                    } else {
                        next[y][x] = neighbors >= 5 ? 1 : 0; // birth with 5+
                    }
                }
            }
            grid = next;
        }

        // Flood-fill to find largest connected component
        const visited = Array.from({ length: h }, () => new Uint8Array(w));
        let bestBlob = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] !== 1 || visited[y][x]) continue;
                const blob = [];
                const stack = [{ x, y }];
                while (stack.length > 0) {
                    const cell = stack.pop();
                    if (cell.x < 0 || cell.x >= w || cell.y < 0 || cell.y >= h) continue;
                    if (visited[cell.y][cell.x] || grid[cell.y][cell.x] !== 1) continue;
                    visited[cell.y][cell.x] = 1;
                    blob.push(cell);
                    stack.push({ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y },
                               { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 });
                }
                if (blob.length > bestBlob.length) bestBlob = blob;
            }
        }

        // Rebuild grid with only the largest blob
        const result = Array.from({ length: h }, () => new Uint8Array(w));
        for (const cell of bestBlob) result[cell.y][cell.x] = 1;

        // If blob is too small, fall back to rectangle
        if (bestBlob.length < 6) return this._brogueMakeRectangle(cfg);

        return { grid: result, width: w, height: h };
    }

    _brogueFindDoorSites(grid, w, h) {
        const dirs = [
            { name: 'north', dx: 0, dy: -1 },
            { name: 'south', dx: 0, dy: 1 },
            { name: 'east', dx: 1, dy: 0 },
            { name: 'west', dx: -1, dy: 0 }
        ];

        // Work on a padded grid so edge-adjacent floor cells get door candidates
        const pw = w + 2, ph = h + 2;
        const padded = Array.from({ length: ph }, () => new Uint8Array(pw));
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                padded[y + 1][x + 1] = grid[y][x];
            }
        }

        const candidates = { north: [], south: [], east: [], west: [] };

        for (let y = 0; y < ph; y++) {
            for (let x = 0; x < pw; x++) {
                if (padded[y][x] !== 0) continue;
                for (const dir of dirs) {
                    const ix = x - dir.dx, iy = y - dir.dy;
                    const ox = x + dir.dx, oy = y + dir.dy;
                    if (ix < 0 || ix >= pw || iy < 0 || iy >= ph) continue;
                    if (padded[iy][ix] !== 1) continue;
                    if (ox >= 0 && ox < pw && oy >= 0 && oy < ph && padded[oy][ox] !== 0) continue;
                    // Convert back to original grid coordinates (offset by -1)
                    candidates[dir.name].push({ localX: x - 1, localY: y - 1, direction: dir.name });
                }
            }
        }

        const result = [];
        for (const dir of dirs) {
            const cands = candidates[dir.name];
            if (cands.length > 0) {
                result.push(cands[Math.floor(ROT.RNG.getUniform() * cands.length)]);
            }
        }
        return result;
    }

    _brogueMaybeAddCorridor(grid, w, h, doorSites, cfg) {
        if (ROT.RNG.getPercentage() > cfg.corridorChance || doorSites.length === 0) {
            return { grid, width: w, height: h, doorSites, hasCorridor: false, corridorCells: [] };
        }

        const dirNames = ['north', 'south', 'east', 'west'];
        const dirVecs = { north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 }, east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 } };
        const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };

        // Pick a random door site that has enough room for a corridor
        const shuffled = [...doorSites];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        let site = null;
        for (const s of shuffled) {
            const dv = dirVecs[s.direction];
            const endX = s.localX + dv.dx * cfg.corridorLength[1];
            const endY = s.localY + dv.dy * cfg.corridorLength[1];
            if (endX >= -w && endX < w * 2 && endY >= -h && endY < h * 2) {
                site = s;
                break;
            }
        }
        if (!site) return { grid, width: w, height: h, doorSites, hasCorridor: false, corridorCells: [] };

        const dv = dirVecs[site.direction];
        const len = ROT.RNG.getUniformInt(cfg.corridorLength[0], cfg.corridorLength[1]);

        // Calculate new grid dimensions. Extend to i = len + 1 (one past the
        // corridor tip) so the forward-facing door site — which sits at tip + dv —
        // lands INSIDE the padded grid.
        let padLeft = 0, padRight = 0, padTop = 0, padBottom = 0;
        for (let i = 1; i <= len + 1; i++) {
            const nx = site.localX + dv.dx * i;
            const ny = site.localY + dv.dy * i;
            if (nx < 0) padLeft = Math.max(padLeft, -nx);
            if (nx >= w) padRight = Math.max(padRight, nx - w + 1);
            if (ny < 0) padTop = Math.max(padTop, -ny);
            if (ny >= h) padBottom = Math.max(padBottom, ny - h + 1);
        }

        const newW = w + padLeft + padRight;
        const newH = h + padTop + padBottom;
        const newGrid = Array.from({ length: newH }, () => new Uint8Array(newW));

        // Copy old grid with offset
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                newGrid[y + padTop][x + padLeft] = grid[y][x];
            }
        }

        // Draw corridor, recording each corridor cell (local coords). i=0 is the
        // room's own door cell — skip it; only i>=1 are true corridor tiles that
        // should get the relaxed adjacency rule at placement time.
        const corridorCells = [];
        for (let i = 0; i <= len; i++) {
            const cx = site.localX + padLeft + dv.dx * i;
            const cy = site.localY + padTop + dv.dy * i;
            newGrid[cy][cx] = 1;
            if (i >= 1) corridorCells.push({ x: cx, y: cy });
        }

        // Last interior cell of the corridor
        const lastX = site.localX + padLeft + dv.dx * len;
        const lastY = site.localY + padTop + dv.dy * len;

        // Replace ALL door sites with ones radiating from corridor end (Brogue's approach).
        // Forward-facing (same dir as corridor) is always kept.
        // Perpendicular exits only 15% of the time. Opposite dir (back into room) never.
        const allowOblique = ROT.RNG.getPercentage() <= 15;
        const newDoorSites = [];
        for (const dirName of dirNames) {
            const ddv = dirVecs[dirName];
            const doorX = lastX + ddv.dx;
            const doorY = lastY + ddv.dy;

            if (doorX < 0 || doorX >= newW || doorY < 0 || doorY >= newH) continue;
            if (newGrid[doorY][doorX] === 1) continue;

            if (dirName === site.direction) {
                newDoorSites.push({ localX: doorX, localY: doorY, direction: dirName });
            } else if (dirName !== opposite[site.direction] && allowOblique) {
                newDoorSites.push({ localX: doorX, localY: doorY, direction: dirName });
            }
        }

        return { grid: newGrid, width: newW, height: newH, doorSites: newDoorSites, hasCorridor: true, corridorCells };
    }

    _broguePlaceRoom(dungeonGrid, roomGrid, roomW, roomH, doorSites, mapW, mapH, corridorCells = []) {
        const dirVecs = { north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 }, east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 } };
        // Corridor cells get a relaxed adjacency rule: unlike room bodies (which
        // must keep a clear 3x3 gap so they don't fuse), a 1-wide corridor is
        // meant to run alongside walls and thread past room corners. For corridor
        // cells only ORTHOGONAL adjacency to foreign floor is forbidden (prevents
        // fusing two passages side-by-side); diagonal proximity is allowed.
        const corridorSet = new Set(corridorCells.map(c => c.x + ',' + c.y));

        // Collect attachment targets: empty cells adjacent to existing floor
        const targets = [];
        for (let y = 1; y < mapH - 1; y++) {
            for (let x = 1; x < mapW - 1; x++) {
                if (dungeonGrid[y][x] !== 0) continue;
                const adjFloor =
                    (y > 0 && dungeonGrid[y - 1][x] >= 1) ||
                    (y < mapH - 1 && dungeonGrid[y + 1][x] >= 1) ||
                    (x > 0 && dungeonGrid[y][x - 1] >= 1) ||
                    (x < mapW - 1 && dungeonGrid[y][x + 1] >= 1);
                if (adjFloor) targets.push({ x, y });
            }
        }

        // Fisher-Yates shuffle
        for (let i = targets.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [targets[i], targets[j]] = [targets[j], targets[i]];
        }

        // Also shuffle door sites to avoid directional bias
        const shuffledDoors = [...doorSites];
        for (let i = shuffledDoors.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [shuffledDoors[i], shuffledDoors[j]] = [shuffledDoors[j], shuffledDoors[i]];
        }

        const maxTargets = Math.min(targets.length, 300);

        for (let ti = 0; ti < maxTargets; ti++) {
            const target = targets[ti];
            for (const doorSite of shuffledDoors) {
                const dv = dirVecs[doorSite.direction];

                // Door's outward direction must point toward existing floor
                const floorX = target.x + dv.dx;
                const floorY = target.y + dv.dy;
                if (floorX < 0 || floorX >= mapW || floorY < 0 || floorY >= mapH) continue;
                if (dungeonGrid[floorY][floorX] < 1) continue;

                const offsetX = target.x - doorSite.localX;
                const offsetY = target.y - doorSite.localY;

                // Validate placement
                let valid = true;
                for (let ry = 0; ry < roomH && valid; ry++) {
                    for (let rx = 0; rx < roomW && valid; rx++) {
                        if (roomGrid[ry][rx] !== 1) continue;
                        const wx = offsetX + rx;
                        const wy = offsetY + ry;

                        if (wx < 1 || wx >= mapW - 1 || wy < 1 || wy >= mapH - 1) { valid = false; break; }
                        if (dungeonGrid[wy][wx] !== 0) { valid = false; break; }

                        const isCorridorCell = corridorSet.has(rx + ',' + ry);
                        if (isCorridorCell) {
                            // Relaxed rule: only forbid ORTHOGONAL adjacency to foreign
                            // floor (keeps corridors from fusing side-by-side into a
                            // 2-wide passage or merging rooms); diagonal proximity is
                            // fine, so the corridor can hug walls and pass room corners.
                            for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                                if (!valid) break;
                                const nx = wx + ox, ny = wy + oy;
                                if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                                if (nx === target.x && ny === target.y) continue;
                                const nrx = nx - offsetX, nry = ny - offsetY;
                                if (nrx >= 0 && nrx < roomW && nry >= 0 && nry < roomH && roomGrid[nry][nrx] === 1) continue;
                                if (dungeonGrid[ny][nx] >= 1) valid = false;
                            }
                        } else {
                            // Room-body cell: strict 3x3 separation so rooms don't fuse.
                            for (let dy = -1; dy <= 1 && valid; dy++) {
                                for (let dx = -1; dx <= 1 && valid; dx++) {
                                    if (dx === 0 && dy === 0) continue;
                                    const nx = wx + dx, ny = wy + dy;
                                    if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                                    if (nx === target.x && ny === target.y) continue;
                                    // Check if this neighbor is also a room floor cell
                                    const nrx = nx - offsetX, nry = ny - offsetY;
                                    if (nrx >= 0 && nrx < roomW && nry >= 0 && nry < roomH && roomGrid[nry][nrx] === 1) continue;
                                    if (dungeonGrid[ny][nx] >= 1) valid = false;
                                }
                            }
                        }
                    }
                }

                if (valid) {
                    return { offsetX, offsetY, doorWorldX: target.x, doorWorldY: target.y, doorSite };
                }
            }
        }

        return null;
    }

    _brogueMakeRoomRecord(roomGrid, w, h, offsetX, offsetY, doors) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (roomGrid[y][x] === 1) {
                    const wx = offsetX + x, wy = offsetY + y;
                    if (wx < minX) minX = wx;
                    if (wx > maxX) maxX = wx;
                    if (wy < minY) minY = wy;
                    if (wy > maxY) maxY = wy;
                }
            }
        }

        const record = {
            _x1: minX, _y1: minY, _x2: maxX, _y2: maxY,
            _doors: {},
            getLeft() { return this._x1; },
            getRight() { return this._x2; },
            getTop() { return this._y1; },
            getBottom() { return this._y2; },
            getDoors(cb) {
                for (const key in this._doors) {
                    const parts = key.split(',');
                    cb(parseInt(parts[0]), parseInt(parts[1]));
                }
                return this;
            },
            addDoor(x, y) { this._doors[`${x},${y}`] = 1; return this; }
        };

        for (const door of doors) {
            record.addDoor(door.x, door.y);
        }

        return record;
    }

    _brogueMakeLoops(dungeonGrid, rooms, mapW, mapH, cfg) {
        const candidates = [];
        for (let y = 1; y < mapH - 1; y++) {
            for (let x = 1; x < mapW - 1; x++) {
                if (dungeonGrid[y][x] !== 0) continue;
                // Check horizontal: floor on both east and west
                if (dungeonGrid[y][x - 1] >= 1 && dungeonGrid[y][x + 1] >= 1) {
                    candidates.push({ x, y, side1: { x: x - 1, y }, side2: { x: x + 1, y } });
                }
                // Check vertical: floor on both north and south
                if (dungeonGrid[y - 1][x] >= 1 && dungeonGrid[y + 1][x] >= 1) {
                    candidates.push({ x, y, side1: { x, y: y - 1 }, side2: { x, y: y + 1 } });
                }
            }
        }

        // Shuffle candidates
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        let loopsCreated = 0;
        for (const cand of candidates) {
            if (loopsCreated >= cfg.maxLoops) break;
            const dist = this._brogueBFS(dungeonGrid, cand.side1.x, cand.side1.y, cand.side2.x, cand.side2.y, mapW, mapH, cfg.loopMinDistance * 2);
            if (dist >= 0 && dist < cfg.loopMinDistance) continue;
            // dist === -1 means unreachable or exceeded cap — that's a good loop candidate too
            dungeonGrid[cand.y][cand.x] = 2;
            loopsCreated++;

            // Add to nearest room's doors
            let bestRoom = null, bestDist = Infinity;
            for (const room of rooms) {
                const rcx = (room._x1 + room._x2) / 2;
                const rcy = (room._y1 + room._y2) / 2;
                const d = Math.abs(rcx - cand.x) + Math.abs(rcy - cand.y);
                if (d < bestDist) { bestDist = d; bestRoom = room; }
            }
            if (bestRoom) bestRoom.addDoor(cand.x, cand.y);
        }

        if (loopsCreated > 0) console.log(`Brogue loops: ${loopsCreated} secondary connections`);
    }

    _brogueBFS(dungeonGrid, x1, y1, x2, y2, mapW, mapH, maxDist) {
        if (x1 === x2 && y1 === y2) return 0;
        const visited = new Set();
        visited.add(`${x1},${y1}`);
        let frontier = [{ x: x1, y: y1 }];
        let dist = 0;
        const cardinals = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        while (frontier.length > 0 && dist < maxDist) {
            dist++;
            const next = [];
            for (const cell of frontier) {
                for (const [dx, dy] of cardinals) {
                    const nx = cell.x + dx, ny = cell.y + dy;
                    if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                    if (dungeonGrid[ny][nx] < 1) continue;
                    const key = `${nx},${ny}`;
                    if (visited.has(key)) continue;
                    if (nx === x2 && ny === y2) return dist;
                    visited.add(key);
                    next.push({ x: nx, y: ny });
                }
            }
            frontier = next;
        }

        return -1;
    }

    /**
     * Carves winding corridors through the rock left over after room accretion.
     *
     * The generator's other corridors (_brogueMaybeAddCorridor) are straight stubs
     * glued onto a room's local grid *before* placement, so room and corridor have
     * to fit as one rigid piece — which is why long ones mostly fail to place, and
     * why none of them can ever turn. This pass works the other way round: the
     * rooms are already down, so it treats the leftover rock as material and cuts
     * into it. That is what makes a hallway able to wind.
     *
     * Corridors are meant to end in rock. A dead-end passage is the point, not a
     * defect: _brogueFixDeadEnds runs straight after this and looks 2-3 tiles past
     * each dead end for floor, turning it into a secret-door candidate. That is the
     * Brogue shape where a corridor peters out and the wall at the end is a door.
     *
     * Must run AFTER _brogueMakeLoops (which would otherwise punch through the
     * fresh 1-tile walls this creates and dissolve the dead ends) and BEFORE
     * _brogueFixDeadEnds (which is what harvests them).
     *
     * Writes only to dungeonGrid. _brogueFinalizeMap derives floorMap, walls and
     * walkableTiles from the finished grid, so a carved cell gets its wall ring
     * for free.
     */
    _brogueCarveWindingCorridors(dungeonGrid, rooms, mapW, mapH, cfg) {
        const budget = cfg.maxWindingCorridors ?? 0;
        if (budget <= 0 || rooms.length === 0) return { carved: 0, attempted: 0 };

        const [minLen, maxLen] = cfg.windingLength || [6, 22];
        // Keep clear of the map edge: _brogueFinalizeMap skips row 0 when building
        // its wall ring (its `y > 0` guard), so floor carved too near the top would
        // never get capped. _carveWanderingPath clamps to the same inset.
        const inBounds = (x, y) => x >= 2 && y >= 2 && x <= mapW - 3 && y <= mapH - 3;
        const isRock = (x, y) => inBounds(x, y) && dungeonGrid[y][x] === 0;
        const isFloor = (x, y) =>
            x >= 0 && y >= 0 && x < mapW && y < mapH && dungeonGrid[y][x] >= 1;

        // Cells this corridor has already claimed. Kept separate from the grid so a
        // rejected path leaves nothing behind.
        let claimed = new Set();

        // Every room's wall ring, minus the cells that are the room itself. A
        // corridor may pierce this ring at its own mouth but must never run along
        // it: a passage carved flush against a room leaves no wall cell between the
        // two, and spawnTreasureRoom's seal only upgrades cells that are ALREADY
        // walls (it rewrites pendingWallSpawns entries inside the room's bbox+1).
        // With no wall there to upgrade, a vault picked on that room keeps a wide
        // open side and the loot is free. Reserving the ring keeps the wall that
        // the seal depends on.
        const roomRing = new Set();
        const ringOf = [];
        for (let r = 0; r < rooms.length; r++) {
            const room = rooms[r];
            const own = new Set();
            for (let y = room._y1 - 1; y <= room._y2 + 1; y++) {
                for (let x = room._x1 - 1; x <= room._x2 + 1; x++) {
                    if (x < 0 || y < 0 || x >= mapW || y >= mapH) continue;
                    if (dungeonGrid[y][x] === 0) { roomRing.add(`${x},${y}`); own.add(`${x},${y}`); }
                }
            }
            ringOf.push(own);
        }

        // The 1-tile-wall rule. Eight neighbours, not four: a corridor that slips
        // diagonally past a room corner would leave no wall cell between them, and
        // _brogueFinalizeMap's anyNeighbor8 wall pass would then quietly fuse the
        // corridor into the room.
        const clearOfOtherFloor = (x, y, allowed) => {
            for (const [dx, dy] of TP_DIRS8) {
                const nx = x + dx, ny = y + dy;
                const key = `${nx},${ny}`;
                if (allowed.has(key)) continue;
                if (isFloor(nx, ny)) return false;
            }
            return true;
        };

        // Seeds: a rock cell in a room's wall ring with the room on exactly one
        // side and somewhere to go on the other. Carving here reads as a doorway
        // punched in the room wall.
        const seeds = [];
        for (let r = 0; r < rooms.length; r++) {
            const room = rooms[r];
            for (let y = room._y1 - 1; y <= room._y2 + 1; y++) {
                for (let x = room._x1 - 1; x <= room._x2 + 1; x++) {
                    if (!isRock(x, y)) continue;
                    for (const [dx, dy] of TP_DIRS4) {
                        // floor behind, rock ahead and beyond
                        if (!isFloor(x - dx, y - dy)) continue;
                        if (!isRock(x + dx, y + dy)) continue;
                        if (!isRock(x + dx * 2, y + dy * 2)) continue;
                        seeds.push({ x, y, dx, dy, roomIndex: r });
                        break;
                    }
                }
            }
        }

        // Fisher-Yates, matching _brogueMakeLoops. Not a sort: under a seeded RNG a
        // stable order would carve every map from the same corner outward.
        for (let i = seeds.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
        }

        let carved = 0;
        let attempted = 0;
        let branches = 0;
        const attemptCap = budget * 8;
        let cursor = 0;

        while (carved < budget && attempted < attemptCap) {
            attempted++;

            // Most corridors start at a room; the rest branch off the tip of one
            // already carved, which turns a single dead end into a fork.
            let seed = null;
            const wantBranch = carved > 0 &&
                ROT.RNG.getPercentage() <= (cfg.windingBranchChance ?? 0);
            if (wantBranch) seed = this._brogueFindCorridorTip(dungeonGrid, mapW, mapH, isRock);
            while (!seed && cursor < seeds.length) {
                const cand = seeds[cursor++];
                if (dungeonGrid[cand.y][cand.x] === 0) seed = cand;
            }
            if (!seed) break;   // out of seeds entirely

            // Aim at another room, not at empty rock. A corridor that stops in
            // open rock is a bare dead end: there is nothing on the far side of
            // its last wall, so _brogueFixDeadEnds finds no floor within 2-3 tiles
            // and never turns it into a secret door. Brogue almost never leaves a
            // hallway hanging — a dead end is where a room is hiding. Targeting a
            // room means the corridor peters out one wall short of something, and
            // that wall is exactly what becomes the secret door.
            const target = this._brogueFindCorridorTarget(rooms, seed, minLen, maxLen);
            if (!target) continue;
            const goal = target.goal;

            claimed = new Set([`${seed.x},${seed.y}`]);
            // The mouth is allowed to touch its own room; nothing else is.
            const mouthAllowance = new Set([`${seed.x - seed.dx},${seed.y - seed.dy}`]);
            // ...and the corridor has to be able to leave. The seed's own room ring
            // wraps the mouth on every side, so treating it as off-limits stopped
            // every path within two or three cells of where it started.
            const ownRing = seed.roomIndex === undefined ? null : ringOf[seed.roomIndex];
            // Same for the room's floor: the first corridor cell sits right beside
            // it by construction, so the separation test has to know that this one
            // room is allowed to be there. Only for the first couple of cells —
            // after that the corridor is clear and the normal rule applies.
            const ownFloor = seed.roomIndex === undefined ? null : rooms[seed.roomIndex];

            // isBarrier stays deliberately loose — is this cell rock? Putting the
            // separation rule in here instead would make the walk *skip* cells it
            // isn't allowed to collect while still stepping past them, returning a
            // list full of holes that the contiguity check below then cuts at the
            // first one. (That bug cost ~90% of every path: 7 cells raw, 0.8 kept.)
            // The rule belongs in the truncation pass, which can see the run so far.
            const raw = this._carveWanderingPath(seed, goal, (x, y) => isRock(x, y));

            // Walk the returned cells in order and stop at the first one that
            // breaks a rule. _carveWanderingPath cannot do this itself: it still
            // steps through cells it declines to collect, and its `collected` set
            // is private, so it can neither keep off existing floor nor notice the
            // path doubling back alongside itself.
            const path = [];
            let prev = seed;
            for (const cell of raw) {
                // A gap means the walk crossed ground it didn't collect; whatever
                // follows is a disconnected fragment, not more corridor.
                if (Math.abs(cell.x - prev.x) + Math.abs(cell.y - prev.y) !== 1) break;
                // Stopping *against* a room is the goal, not a failure: the wall
                // between this cell and the room is what _brogueFixDeadEnds turns
                // into a secret door. So take the cell, then stop — the corridor
                // ends here, one wall short of somewhere worth getting to.
                // (Carving THROUGH the ring is still forbidden; that would fuse the
                // corridor into the room and leave no wall to hide.)
                const touchesRing = roomRing.has(`${cell.x},${cell.y}`) &&
                    !(ownRing && ownRing.has(`${cell.x},${cell.y}`));
                // Everything this corridor already owns is exempt from the
                // separation test — a passage is obviously adjacent to itself.
                // Only the seed's own room is additionally allowed.
                if (touchesRing) break;
                const allowed = new Set(claimed);
                for (const k of mouthAllowance) allowed.add(k);
                if (ownFloor && path.length < 2) {
                    for (let yy = ownFloor._y1; yy <= ownFloor._y2; yy++)
                        for (let xx = ownFloor._x1; xx <= ownFloor._x2; xx++)
                            allowed.add(`${xx},${yy}`);
                }
                if (!clearOfOtherFloor(cell.x, cell.y, allowed)) break;
                claimed.add(`${cell.x},${cell.y}`);
                path.push(cell);
                prev = cell;
            }

            if (path.length < minLen) continue;

            // Commit. Body cells are plain floor; the mouth is a door cell so
            // finalize can roll it against doorChance like any other doorway.
            for (const cell of path) this._carveRect(dungeonGrid, cell.x, cell.y, cell.x, cell.y, 1);
            this._carveRect(dungeonGrid, seed.x, seed.y, seed.x, seed.y, seed.roomIndex === undefined ? 1 : 2);

            // Register the mouth on its room. This is load-bearing for
            // spawnTreasureRoom, which builds its entrance list purely from
            // getDoors(): a mouth it cannot see is an unsealed back way into the
            // vault. Append only — that call keeps allEntrances[0] as the room's
            // original door and walls off the rest, and `_doors` preserves
            // insertion order because "x,y" keys are not integer indices.
            if (seed.roomIndex !== undefined) rooms[seed.roomIndex].addDoor(seed.x, seed.y);
            else branches++;

            carved++;
        }

        return { carved, attempted, branches };
    }

    /**
     * Pick a room for a corridor to head toward, and return an aim point just
     * short of it.
     *
     * The aim point matters more than it looks. `_carveWanderingPath` stops when
     * it reaches the goal, and the separation rule stops it one cell before it
     * touches the room's wall ring — so aiming at the room's edge leaves the
     * corridor ending against the room with a single wall between them. That wall
     * is what `_brogueFixDeadEnds` sees floor behind, and what becomes the secret
     * door. Aiming at bare rock instead is what produced hallways that simply
     * stopped.
     *
     * Rooms nearer than minLen are skipped (nothing to wind through) and rooms
     * further than maxLen * 2 are skipped (the walk would cap out before
     * arriving, stranding the corridor in rock again).
     */
    _brogueFindCorridorTarget(rooms, seed, minLen, maxLen) {
        const candidates = [];
        for (const room of rooms) {
            const cx = Math.round((room._x1 + room._x2) / 2);
            const cy = Math.round((room._y1 + room._y2) / 2);
            const dist = Math.abs(cx - seed.x) + Math.abs(cy - seed.y);
            if (dist < minLen || dist > maxLen * 2) continue;
            // Prefer rooms roughly ahead of the mouth: a target directly behind
            // would send the corridor straight back around its own room.
            const ahead = (cx - seed.x) * seed.dx + (cy - seed.y) * seed.dy;
            if (ahead <= 0) continue;
            candidates.push({ x: cx, y: cy, dist });
        }
        if (candidates.length === 0) return null;
        const pick = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
        return { goal: { x: pick.x, y: pick.y }, dist: pick.dist };
    }

    /**
     * A carved corridor's far tip: floor with exactly one floor neighbour, with
     * rock ahead to keep going into. Same shape as the dead-end test in
     * _brogueFixDeadEnds, but looking for somewhere to branch rather than
     * somewhere to hide a door.
     */
    _brogueFindCorridorTip(dungeonGrid, mapW, mapH, isRock) {
        const tips = [];
        for (let y = 2; y <= mapH - 3; y++) {
            for (let x = 2; x <= mapW - 3; x++) {
                if (dungeonGrid[y][x] < 1) continue;
                let open = 0;
                for (const [dx, dy] of TP_DIRS4) {
                    if (dungeonGrid[y + dy][x + dx] >= 1) open++;
                }
                if (open !== 1) continue;
                for (const [dx, dy] of TP_DIRS4) {
                    if (dungeonGrid[y + dy][x + dx] >= 1) continue;
                    if (isRock(x + dx, y + dy) && isRock(x + dx * 2, y + dy * 2)) {
                        tips.push({ x: x + dx, y: y + dy, dx, dy });
                    }
                }
            }
        }
        if (tips.length === 0) return null;
        return tips[Math.floor(ROT.RNG.getUniform() * tips.length)];
    }

    _brogueFixDeadEnds(dungeonGrid, mapW, mapH) {
        const cardinals = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const secretWalls = [];

        for (let y = 1; y < mapH - 1; y++) {
            for (let x = 1; x < mapW - 1; x++) {
                if (dungeonGrid[y][x] < 1) continue;
                let floorNeighbors = 0;
                for (const [dx, dy] of cardinals) {
                    if (dungeonGrid[y + dy][x + dx] >= 1) floorNeighbors++;
                }
                if (floorNeighbors !== 1) continue;

                // Dead end found — look for a room/corridor through a wall
                for (const [dx, dy] of cardinals) {
                    if (dungeonGrid[y + dy][x + dx] >= 1) continue; // skip the open side
                    const wallX = x + dx, wallY = y + dy;
                    if (wallX < 1 || wallX >= mapW - 1 || wallY < 1 || wallY >= mapH - 1) continue;
                    // Check 1-3 tiles beyond the wall for floor
                    for (let dist = 2; dist <= 3; dist++) {
                        const beyondX = x + dx * dist, beyondY = y + dy * dist;
                        if (beyondX < 0 || beyondX >= mapW || beyondY < 0 || beyondY >= mapH) break;
                        if (dungeonGrid[beyondY][beyondX] >= 1) {
                            secretWalls.push({ x: wallX, y: wallY });
                            break;
                        }
                    }
                    if (secretWalls.length > 0 && secretWalls[secretWalls.length - 1].x === wallX && secretWalls[secretWalls.length - 1].y === wallY) break;
                }
            }
        }

        if (secretWalls.length > 0) console.log(`Brogue dead ends: ${secretWalls.length} shortcuts placed`);
        return secretWalls;
    }

    // ========================================================================
    // PALLADIAN GENERATOR
    // ========================================================================
    //
    // Stage 1: the tartan grid.
    //
    // A (2m+1) x n array of variously-dimensioned rectangles ("bays"), mirrored
    // about a north-south axis, with adjacent bays separated by exactly ONE wall
    // thickness. The odd count is on the columns, since the axis is N-S.
    //
    // Two invariants everything downstream leans on:
    //
    //  - The central column's interior width is ODD, which makes axisX an exact
    //    tile column and mirror(x) = 2*axisX - x exact.
    //
    //  - Symmetry is MIRROR-BY-CONSTRUCTION: roll the west half, assign the east
    //    half from it. There is no "mirror afterwards" pass. Every later stage
    //    follows the same discipline.

    /**
     * @param {object} cfg - palladian config
     * @param {object} [bounds] - sub-rectangle to fit the villa into, for the wildcard
     *   path. Defaults to the whole map, which is the full-floor generator's behavior.
     *   The villa is centered inside these bounds and every returned coordinate is
     *   still absolute/world, so downstream stages need no offsetting.
     */
    _palladianBuildGrid(cfg, bounds = null) {
        const area = bounds || { x: 0, y: 0, width: this.width, height: this.height };
        const rollRange = (range, lo = 1) => {
            const a = Math.max(lo, Math.min(range[0], range[1]));
            const b = Math.max(lo, Math.max(range[0], range[1]));
            return ROT.RNG.getUniformInt(a, b);
        };

        let nCols = rollRange(cfg.bayColumns, 1);
        if (nCols % 2 === 0) nCols++;               // the grammar requires 2m+1
        let nRows = rollRange(cfg.bayRows, 1);

        const axisCol = (nCols - 1) / 2;

        // Roll the WEST half only, then assign the east half by mirror.
        const widths = new Array(nCols).fill(0);
        for (let c = 0; c < axisCol; c++) widths[c] = rollRange(cfg.bayWidth, 2);
        let centerWidth = Math.round(rollRange(cfg.bayWidth, 2) * (cfg.centralBias / 100));
        centerWidth = Math.max(2, centerWidth);
        if (centerWidth % 2 === 0) centerWidth++;   // must be odd to be bisected
        widths[axisCol] = centerWidth;
        for (let k = 1; k <= axisCol; k++) widths[axisCol + k] = widths[axisCol - k];

        // Rows need no symmetry — the axis is N-S. That freedom is what lets a
        // villa have a deep portico row and a shallow service row.
        const heights = [];
        for (let r = 0; r < nRows; r++) heights.push(rollRange(cfg.bayHeight, 2));

        // Only a projecting portico needs extra height reserved; an in-antis one is
        // recessed into the mass and costs nothing. 'random' may resolve either
        // way later, so reserve for the worst case.
        const projects = cfg.porticoStyle === 'prostyle' || cfg.porticoStyle === 'random';
        const porticoDepth = projects ? Math.max(1, cfg.porticoDepth) : 0;
        const sum = (arr) => arr.reduce((a, b) => a + b, 0);
        // nCols + 1 walls: one between each adjacent pair, plus the two exterior.
        const footprint = () => ({
            w: sum(widths) + nCols + 1,
            h: sum(heights) + nRows + 1
        });
        // MARGIN of 2, not 1. The villa's own exterior wall must not sit at x=1 or
        // y=1: _brogueFinalizeMap's perimeter gap-fill (its pass 3) writes a
        // metal_wall in any perimeter cell adjacent to floor, which would land at
        // x=0/y=0 — outside the reserve, and on row 0 where `y > 0` guards apply.
        const MARGIN = 2;
        const fits = () => {
            const { w, h } = footprint();
            return w <= area.width - 2 * MARGIN && h + porticoDepth <= area.height - 2 * MARGIN;
        };

        // Degradation ladder. Never throws: a generator that throws breaks
        // loadFloor. Shrink dimensions first (keeps the silhouette), then drop
        // column PAIRS (preserving oddness and symmetry), then rows.
        let guard = 0;
        while (!fits() && guard++ < 200) {
            // axisCol moves as columns are dropped, so recompute it each pass.
            const mid = (nCols - 1) / 2;
            const shrinkable = widths.some((w, c) => w > (c === mid ? 3 : 2))
                || heights.some(h => h > 2);
            if (shrinkable) {
                for (let c = 0; c < nCols; c++) {
                    if (c === mid) {
                        // The central column must stay ODD to be bisected by the
                        // axis, so it shrinks by 2 rather than rounding back up.
                        widths[c] = Math.max(3, widths[c] - 2);
                    } else {
                        widths[c] = Math.max(2, widths[c] - 1);
                    }
                }
                for (let k = 1; k <= mid; k++) widths[mid + k] = widths[mid - k];
                for (let r = 0; r < nRows; r++) heights[r] = Math.max(2, heights[r] - 1);
                continue;
            }
            if (nCols > 1) {
                // Drop the outermost pair. splice() lops off the two EAST-most
                // entries, which shifts the centre, so re-establish both invariants
                // afterwards: the new centre must be odd, and the surviving east
                // half must be re-mirrored from the west.
                nCols -= 2;
                widths.splice(nCols);
                const newAxis = (nCols - 1) / 2;
                if (widths[newAxis] % 2 === 0) widths[newAxis]++;
                for (let k = 1; k <= newAxis; k++) widths[newAxis + k] = widths[newAxis - k];
                continue;
            }
            if (nRows > 1) {
                nRows -= 1;
                heights.splice(nRows);
                continue;
            }
            break;
        }
        if (!fits()) return null;

        // Dropping column pairs shifts the axis, so recompute it.
        const finalAxisCol = (nCols - 1) / 2;

        // Every downstream stage assumes bilateral symmetry; check it here while a
        // violation is still one array to inspect.
        if (widths[finalAxisCol] % 2 === 0) {
            console.error(`Palladian: central width ${widths[finalAxisCol]} is even; cannot be bisected`);
            return null;
        }
        for (let k = 1; k <= finalAxisCol; k++) {
            if (widths[finalAxisCol - k] !== widths[finalAxisCol + k]) {
                console.error(`Palladian: asymmetric widths ${JSON.stringify(widths)} about column ${finalAxisCol}`);
                return null;
            }
        }
        const { w: footprintW, h: footprintH } = footprint();

        // Center the FOOTPRINT and derive the axis from it. Centering axisX on
        // this.width/2 instead introduces off-by-one asymmetry when the map width
        // and the footprint width differ in parity.
        const X0 = area.x + Math.max(MARGIN, Math.floor((area.width - footprintW) / 2));
        const Y0 = area.y + Math.max(MARGIN, Math.floor((area.height - footprintH - porticoDepth) / 2));

        const colX = [];
        let x = X0 + 1;
        for (let c = 0; c < nCols; c++) {
            colX.push([x, x + widths[c] - 1]);
            x += widths[c] + 1;                     // +1 for the wall between bays
        }
        const rowY = [];
        let y = Y0 + 1;
        for (let r = 0; r < nRows; r++) {
            rowY.push([y, y + heights[r] - 1]);
            y += heights[r] + 1;
        }

        // Pins the one-wall-thickness scheme; catches off-by-ones at their source
        // rather than as a 2-tile-thick wall much later.
        for (let c = 0; c + 1 < nCols; c++) {
            if (colX[c + 1][0] !== colX[c][1] + 2) {
                console.error(`Palladian: column spacing broken at ${c} (${colX[c][1]} -> ${colX[c + 1][0]})`);
                return null;
            }
        }
        for (let r = 0; r + 1 < nRows; r++) {
            if (rowY[r + 1][0] !== rowY[r][1] + 2) {
                console.error(`Palladian: row spacing broken at ${r} (${rowY[r][1]} -> ${rowY[r + 1][0]})`);
                return null;
            }
        }

        const axisX = colX[finalAxisCol][0] + (widths[finalAxisCol] - 1) / 2;

        const bays = [];
        for (let r = 0; r < nRows; r++) {
            const row = [];
            for (let c = 0; c < nCols; c++) {
                row.push({ col: c, row: r, x1: colX[c][0], y1: rowY[r][0], x2: colX[c][1], y2: rowY[r][1] });
            }
            bays.push(row);
        }

        return {
            nCols, nRows, axisCol: finalAxisCol, axisX,
            colX, rowY, bays, widths, heights,
            footprintW, footprintH,
            left: X0,
            right: X0 + footprintW - 1,
            top: Y0,
            bottom: Y0 + footprintH - 1,
            porticoDepth
        };
    }

    // Stage 2 is implicit: dungeonGrid starts all-zero, we carve only interiors,
    // and the surrounding ring of zeros IS the exterior wall — _brogueFinalizeMap
    // turns it into wall actors for free.
    _palladianCarveBays(dungeonGrid, plan) {
        for (let r = 0; r < plan.nRows; r++) {
            for (let c = 0; c < plan.nCols; c++) {
                const b = plan.bays[r][c];
                this._carveRect(dungeonGrid, b.x1, b.y1, b.x2, b.y2);
            }
        }
    }
    // Stage 3: room layout by concatenation.
    //
    // Start with one room per bay, then merge adjacent bays. The paper permits AT
    // MOST ONE non-rectangular room, bisected by the axis — the sanctum. Enforced
    // structurally: phase A builds it, phase B rejects any merge creating a second.
    //
    // Bays in a column share an x-span and bays in a row share a y-span, so a
    // bay-set that is a rectangle in GRID space is always a rectangle in TILE
    // space too — which makes the rectangularity test pure integer bookkeeping.
    _palladianLayoutRooms(dungeonGrid, plan, cfg) {
        const { nCols, nRows, axisCol } = plan;
        const key = (c, r) => `${c},${r}`;

        // Union-find over bay keys, tracking each set's grid extent and size so
        // the rectangularity test is O(1).
        const parent = new Map();
        const meta = new Map();
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const k = key(c, r);
                parent.set(k, k);
                meta.set(k, { colMin: c, colMax: c, rowMin: r, rowMax: r, size: 1 });
            }
        }
        const find = (k) => {
            while (parent.get(k) !== k) {
                parent.set(k, parent.get(parent.get(k)));
                k = parent.get(k);
            }
            return k;
        };
        const isRect = (m) => m.size === (m.colMax - m.colMin + 1) * (m.rowMax - m.rowMin + 1);

        const union = (ka, kb) => {
            const ra = find(ka), rb = find(kb);
            if (ra === rb) return true;
            const ma = meta.get(ra), mb = meta.get(rb);
            const m = {
                colMin: Math.min(ma.colMin, mb.colMin), colMax: Math.max(ma.colMax, mb.colMax),
                rowMin: Math.min(ma.rowMin, mb.rowMin), rowMax: Math.max(ma.rowMax, mb.rowMax),
                size: ma.size + mb.size
            };
            parent.set(rb, ra);
            meta.set(ra, m);
            return true;
        };
        // A merge is legal only if the result stays a grid-rectangle. Trying it
        // on a scratch copy avoids having to undo a real union.
        const wouldStayRect = (ka, kb) => {
            const ra = find(ka), rb = find(kb);
            if (ra === rb) return true;
            const ma = meta.get(ra), mb = meta.get(rb);
            return isRect({
                colMin: Math.min(ma.colMin, mb.colMin), colMax: Math.max(ma.colMax, mb.colMax),
                rowMin: Math.min(ma.rowMin, mb.rowMin), rowMax: Math.max(ma.rowMax, mb.rowMax),
                size: ma.size + mb.size
            });
        };

        // ---- Phase A: the sanctum, the one permitted non-rectangular room ----
        const sanctumKeys = new Set();
        let sanctumShape = null;
        if (ROT.RNG.getPercentage() <= cfg.sanctumChance && nRows >= 2) {
            const pool = Array.isArray(cfg.sanctumShapes) && cfg.sanctumShapes.length
                ? cfg.sanctumShapes : ['cross', 'tee', 'eye'];
            let want = pool[Math.floor(ROT.RNG.getUniform() * pool.length)];
            // Fall back down the ladder when the grid can't host the shape.
            const order = ['cross', 'tee', 'eye'];
            let idx = order.indexOf(want);
            if (idx < 0) idx = 0;
            for (let attempt = 0; attempt < order.length; attempt++) {
                const shape = order[(idx + attempt) % order.length];
                if (shape === 'cross' && (nRows < 3 || nCols < 3)) continue;
                if (shape === 'tee' && nCols < 3) continue;
                if (shape === 'eye' && nRows < 2) continue;
                want = shape;
                sanctumShape = shape;
                break;
            }

            if (sanctumShape) {
                // Every shape is built as a bay-set symmetric about axisCol, so it
                // is bisected by the axis automatically.
                const addAxial = (r0, r1) => {
                    for (let r = r0; r <= r1; r++) sanctumKeys.add(key(axisCol, r));
                };
                const addFullRow = (r) => {
                    for (let c = 0; c < nCols; c++) sanctumKeys.add(key(c, r));
                };
                if (sanctumShape === 'cross') {
                    // Axial column across a run, plus one full interior row.
                    const r0 = 0, r1 = nRows - 1;
                    addAxial(r0, r1);
                    const rm = r0 + 1 + Math.floor(ROT.RNG.getUniform() * (r1 - r0 - 1));
                    addFullRow(rm);
                } else if (sanctumShape === 'tee') {
                    // Axial column plus the full first row: a T opening on the front.
                    addAxial(0, nRows - 1);
                    addFullRow(0);
                } else {
                    // 'eye' (I): axial column plus the full first and last rows.
                    addAxial(0, nRows - 1);
                    addFullRow(0);
                    addFullRow(nRows - 1);
                }

                // Union every sanctum bay together, recording the adjacencies so
                // their dividing walls get carved away below.
                const keys = [...sanctumKeys];
                for (const k of keys) {
                    const [c, r] = k.split(',').map(Number);
                    for (const [dc, dr] of [[1, 0], [0, 1]]) {
                        const nk = key(c + dc, r + dr);
                        if (!sanctumKeys.has(nk)) continue;
                        union(k, nk);
                    }
                }
            }
        }

        // ---- Phase B: rectangular merges, always applied as mirror pairs ----
        const mirrorCol = (c) => 2 * axisCol - c;
        const touchesSanctum = (c, r) => sanctumKeys.has(key(c, r));

        const tryMerge = (a, b) => {
            const ka = key(a.c, a.r), kb = key(b.c, b.r);
            if (touchesSanctum(a.c, a.r) || touchesSanctum(b.c, b.r)) return false;
            if (!wouldStayRect(ka, kb)) return false;
            union(ka, kb);
            return true;
        };

        // West-half adjacencies plus vertical adjacencies inside the axial column.
        // An axis-CROSSING adjacency is deliberately never offered here: applying
        // one unpaired would break bilateral symmetry. The only axis-crossing
        // merge allowed is a full-row merge, which is self-mirror (below).
        const candidates = [];
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                // East-west, both bays strictly west of the axis.
                if (c + 1 < axisCol) candidates.push({ kind: 'pair', a: { c, r }, b: { c: c + 1, r } });
                // North-south, west half or on the axis (the latter is self-mirror).
                if (r + 1 < nRows && c <= axisCol) {
                    candidates.push({ kind: c === axisCol ? 'self' : 'pair', a: { c, r }, b: { c, r: r + 1 } });
                }
            }
        }
        for (const cand of candidates) {
            if (ROT.RNG.getPercentage() > cfg.mergeChance) continue;
            // One roll decides both twins: apply to both or neither.
            tryMerge(cand.a, cand.b);
            if (cand.kind === 'pair') {
                tryMerge(
                    { c: mirrorCol(cand.a.c), r: cand.a.r },
                    { c: mirrorCol(cand.b.c), r: cand.b.r }
                );
            }
        }
        // Full-row merges: all nCols bays of one row into a single hall. Self-mirror,
        // so this is the one way a room may legally span the axis in phase B.
        for (let r = 0; r < nRows; r++) {
            if (ROT.RNG.getPercentage() > cfg.mergeChance) continue;
            let ok = true;
            for (let c = 0; c < nCols; c++) if (touchesSanctum(c, r)) { ok = false; break; }
            if (!ok) continue;
            for (let c = 0; c + 1 < nCols; c++) tryMerge({ c, r }, { c: c + 1, r });
        }

        // Carve away the dividing walls, driven by FINAL room membership rather
        // than the log of attempted merges: union-find makes bays same-room
        // transitively (merge A-B and B-C and A is C's roommate without A|C ever
        // appearing in the log).
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const here = find(key(c, r));
                // East-west divider.
                if (c + 1 < nCols && find(key(c + 1, r)) === here) {
                    const wallX = plan.colX[c][1] + 1;
                    this._carveRect(dungeonGrid, wallX, plan.rowY[r][0], wallX, plan.rowY[r][1]);
                }
                // North-south divider.
                if (r + 1 < nRows && find(key(c, r + 1)) === here) {
                    const wallY = plan.rowY[r][1] + 1;
                    this._carveRect(dungeonGrid, plan.colX[c][0], wallY, plan.colX[c][1], wallY);
                }
            }
        }
        // Carving strips leaves the wall CORNERS where a vertical and a horizontal
        // strip cross. A corner belongs to the room iff all four bays around it do.
        for (let r = 0; r + 1 < nRows; r++) {
            for (let c = 0; c + 1 < nCols; c++) {
                const roots = [
                    find(key(c, r)), find(key(c + 1, r)),
                    find(key(c, r + 1)), find(key(c + 1, r + 1))
                ];
                if (!roots.every(root => root === roots[0])) continue;
                this._carveRect(
                    dungeonGrid,
                    plan.colX[c][1] + 1, plan.rowY[r][1] + 1,
                    plan.colX[c][1] + 1, plan.rowY[r][1] + 1
                );
            }
        }

        // Collect the resulting rooms.
        const byRoot = new Map();
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const root = find(key(c, r));
                if (!byRoot.has(root)) byRoot.set(root, []);
                byRoot.get(root).push(plan.bays[r][c]);
            }
        }

        const rooms = [];
        for (const [root, bayList] of byRoot) {
            const isSanctum = sanctumKeys.size > 0 && bayList.some(b => sanctumKeys.has(key(b.col, b.row)));
            const m = meta.get(root);
            rooms.push({
                id: rooms.length,
                bays: bayList,
                bayKeys: new Set(bayList.map(b => key(b.col, b.row))),
                x1: Math.min(...bayList.map(b => b.x1)),
                y1: Math.min(...bayList.map(b => b.y1)),
                x2: Math.max(...bayList.map(b => b.x2)),
                y2: Math.max(...bayList.map(b => b.y2)),
                shape: isSanctum ? sanctumShape : 'rect',
                isSanctum,
                isRectangular: isRect(m),
                doors: []
            });
        }
        return rooms;
    }

    // Stage 5: the principal entrance.
    //
    // On the SOUTH elevation: the player conventionally arrives from below, and it
    // keeps the portico well clear of the row-0 hazard in _brogueFinalizeMap. The
    // span is the central bay's interior, so it is symmetric about the axis by
    // construction.
    _palladianAddPortico(dungeonGrid, plan, cfg) {
        let style = cfg.porticoStyle;
        if (style === 'none') return null;
        if (style === 'random') style = ROT.RNG.getUniform() < 0.5 ? 'prostyle' : 'in_antis';
        if (style !== 'prostyle' && style !== 'in_antis') style = 'prostyle';

        const spanX1 = plan.colX[plan.axisCol][0];
        const spanX2 = plan.colX[plan.axisCol][1];
        if ((spanX1 + spanX2) !== 2 * plan.axisX) {
            console.error(`Palladian: portico span ${spanX1}-${spanX2} not symmetric about axis ${plan.axisX}`);
            return null;
        }

        let depth = Math.max(1, cfg.porticoDepth);
        if (style === 'prostyle' && plan.bottom + depth > this.height - 2) {
            depth = Math.max(1, this.height - 2 - plan.bottom);
            if (plan.bottom + depth > this.height - 2) style = 'in_antis';
        }
        if (style === 'in_antis') {
            // Clamp the recess to the south row's interior. Any deeper and it eats
            // north through interior walls, which is not what "in antis" means and
            // on a shallow plan would breach the top of the villa entirely.
            const southRow = plan.rowY[plan.nRows - 1];
            depth = Math.min(depth, southRow[1] - southRow[0] + 1);
        }

        // The whole opening is carved as plain floor (1), never as a door
        // candidate (2): finalize rolls doorChance on 2-cells, and a wide portico
        // must never sprout a door actor in the middle of it.
        let colonnadeY;
        if (style === 'prostyle') {
            // Carves through the exterior wall row at plan.bottom — that gap is the
            // principal doorway. The projecting block's own walls are the
            // surrounding zeros, which finalize turns into walls for free.
            this._carveRect(dungeonGrid, spanX1, plan.bottom, spanX2, plan.bottom + depth);
            colonnadeY = plan.bottom + depth;
        } else {
            // In antis: the recess eats the southern part of the south-row axial
            // bay, which is exactly what the term means. Enclosing walls come free.
            this._carveRect(dungeonGrid, spanX1, plan.bottom - depth, spanX2, plan.bottom);
            colonnadeY = plan.bottom;
        }

        return { style, depth, spanX1, spanX2, colonnadeY, innerY: Math.min(this.height - 2, plan.bottom - 1) };
    }

    // Stage 6: the colonnade.
    //
    // Pushed to pendingWallSpawns AFTER _brogueFinalizeMap, so finalize's torch
    // pass can't convert a column into a wall torch and its perimeter rule can't
    // rewrite one as metal_wall. The column tiles stay in walkableTiles, which is
    // correct: spawnPendingWalls creates solid actors there before any random
    // spawning, and getAvailableTiles filters by actor occupancy.
    _palladianPlaceColumns(plan, portico, cfg) {
        if (!portico || cfg.columnSpacing <= 0) return;
        const { spanX1, spanX2, colonnadeY } = portico;
        const span = spanX2 - spanX1 + 1;
        if (span < 2) return;

        let n = Math.floor((span - 1) / (cfg.columnSpacing + 1)) + 1;
        // An odd count puts a column ON the axis, blocking the principal doorway.
        // The axis is always an intercolumniation.
        if (n % 2 === 1) n--;
        if (n < 2) return;

        for (let i = 0; i < n; i++) {
            const x = spanX1 + Math.round((i * (span - 1)) / (n - 1));
            if (x === plan.axisX) continue;      // belt and braces
            this.pendingWallSpawns.push({ x, y: colonnadeY, type: 'column' });
        }
    }

    // Stage 7: windows, doors, and enfilade. This stage also delivers connectivity.
    //
    // Doors are positioned BY ALIGNMENT, not randomly. Two registries hold the
    // sight-lines established so far, seeded from the exterior window centres;
    // each interior door prefers to reuse an existing line and only establishes a
    // new one when it must. That greedy rule is the enfilade mechanism: doors
    // chain onto the window centres, giving a straight sight-line from a window on
    // one flank, through every intervening room, out the other side.
    _palladianAddOpenings(dungeonGrid, plan, rooms, portico, cfg) {
        const { axisX } = plan;
        const mirrorX = (x) => 2 * axisX - x;
        const mirrorCol = (c) => 2 * plan.axisCol - c;
        const hAxes = new Set();     // y values with an established east-west line
        const vAxes = new Set();     // x values with an established north-south line
        const windows = [];

        const roomAt = (c, r) => rooms.find(rm => rm.bayKeys.has(`${c},${r}`));

        // ---- Exterior windows ----
        // Generated for the WEST flank and mirrored; never computed independently
        // on the east side.
        const addWindow = (x, y) => {
            if (x < 1 || x > this.width - 2 || y < 1 || y > this.height - 2) return;
            if (dungeonGrid[y][x] >= 1) return;
            dungeonGrid[y][x] = 1;
            windows.push({ x, y });
        };

        // Left and right walls: one opening per row, at the row's centre.
        const sideOpenings = [];
        for (let r = 0; r < plan.nRows; r++) {
            const cy = Math.floor((plan.rowY[r][0] + plan.rowY[r][1]) / 2);
            sideOpenings.push(cy);
        }
        // The paper's rule: an odd number of openings per elevation. If even, drop
        // the one furthest from the axis — that is what makes elevations read as
        // classical.
        if (sideOpenings.length % 2 === 0 && sideOpenings.length > 0) {
            const midY = (plan.top + plan.bottom) / 2;
            let worst = 0;
            for (let i = 1; i < sideOpenings.length; i++) {
                if (Math.abs(sideOpenings[i] - midY) > Math.abs(sideOpenings[worst] - midY)) worst = i;
            }
            sideOpenings.splice(worst, 1);
        }
        for (const cy of sideOpenings) {
            addWindow(plan.left, cy);
            addWindow(plan.right, cy);       // mirror of the left wall
            hAxes.add(cy);                   // seeds the east-west sight-lines
        }

        // Top wall: one opening per column, generated for x <= axisX and mirrored.
        const topOpenings = [];
        for (let c = 0; c <= plan.axisCol; c++) {
            topOpenings.push(Math.floor((plan.colX[c][0] + plan.colX[c][1]) / 2));
        }
        for (const cx of topOpenings) {
            if (cx === axisX) {
                // The axial opening is the principal rear door: always open, so the
                // north-south sight-line is never interrupted.
                addWindow(axisX, plan.top);
            } else {
                addWindow(cx, plan.top);
                addWindow(mirrorX(cx), plan.top);
            }
            vAxes.add(cx);
            vAxes.add(mirrorX(cx));
        }
        vAxes.add(axisX);

        // ---- Interior doors ----
        // Pick the position that reuses an existing sight-line if one crosses the
        // shared wall; otherwise establish a new line at the overlap's centre.
        const pickAligned = (axes, lo, hi) => {
            let best = null;
            const mid = Math.floor((lo + hi) / 2);
            for (const v of axes) {
                if (v < lo || v > hi) continue;
                if (best === null || Math.abs(v - mid) < Math.abs(best - mid)) best = v;
            }
            if (best !== null) return best;
            axes.add(mid);
            return mid;
        };

        // East-west adjacencies (a vertical wall between two bays): walk the west
        // half and mirror.
        //
        // A mirrored pair is decided ATOMICALLY — one y for both twins, and the
        // twin is carved even if this side turned out not to need a door. Testing
        // each side independently would leave a lone door with no counterpart.
        for (let r = 0; r < plan.nRows; r++) {
            for (let c = 0; c + 1 < plan.nCols; c++) {
                const wallX = plan.colX[c][1] + 1;
                if (wallX > axisX) continue;                       // handled by the mirror
                const mc = mirrorCol(c);
                const needsWest = this._palladianNeedsDoor(roomAt(c, r), roomAt(c + 1, r));
                const needsEast = this._palladianNeedsDoor(roomAt(mc - 1, r), roomAt(mc, r));
                if (!needsWest && !needsEast) continue;
                // Both bays are in the same row, so they share a y-span exactly.
                const y = pickAligned(hAxes, plan.rowY[r][0], plan.rowY[r][1]);
                this._palladianRegisterDoor(dungeonGrid, plan, rooms, wallX, y, false);
                const mx = mirrorX(wallX);
                if (mx !== wallX) this._palladianRegisterDoor(dungeonGrid, plan, rooms, mx, y, false);
            }
        }

        // North-south adjacencies (a horizontal wall). An adjacency crossed at
        // x === axisX is self-mirror, and placing it there is what runs the axial
        // enfilade from the rear door, through the sanctum, out the portico.
        for (let r = 0; r + 1 < plan.nRows; r++) {
            // Only the west half and the axial column: the east half is produced by
            // mirroring, never computed independently.
            for (let c = 0; c <= plan.axisCol; c++) {
                const onAxis = (c === plan.axisCol);
                const mc = mirrorCol(c);
                const needsWest = this._palladianNeedsDoor(roomAt(c, r), roomAt(c, r + 1));
                const needsEast = onAxis
                    ? needsWest
                    : this._palladianNeedsDoor(roomAt(mc, r), roomAt(mc, r + 1));
                if (!needsWest && !needsEast) continue;
                const wallY = plan.rowY[r][1] + 1;
                const lo = plan.colX[c][0], hi = plan.colX[c][1];
                // The axial column's door sits exactly on the axis, which is what
                // runs the enfilade from the rear door, through the sanctum, out
                // through the portico.
                const x = onAxis ? axisX : pickAligned(vAxes, lo, hi);
                this._palladianRegisterDoor(dungeonGrid, plan, rooms, x, wallY, onAxis);
                if (!onAxis) {
                    this._palladianRegisterDoor(dungeonGrid, plan, rooms, mirrorX(x), wallY, false);
                }
            }
        }

        return { windows, hAxes, vAxes };
    }

    /**
     * Stage 7b — concealed passages.
     *
     * A tartan grid has no dead ends, so the Brogue generator's secret-door trick
     * (a shortcut hidden at the end of a blind corridor) has nowhere to go here.
     * The villa's version is a doorway that reads as blank wall: the door pass
     * connects every pair of adjacent rooms, so the raw material is an ordinary
     * interior door, disguised rather than a passage cut somewhere new.
     *
     * Concealing a door changes the reading of the plan: an apartment whose other
     * entrance is concealed becomes a private cabinet, which is the point of the
     * type. Two rules keep it from also changing whether the villa is playable.
     * Every room keeps at least one door that can simply be walked through, so a
     * search is always a shortcut. And a lever-barred passage — which genuinely
     * does block until its lever is pulled — only ever sites that lever where it
     * can be reached with the door shut, counting every barred door already placed,
     * so two passages can never hold each other's lever.
     *
     * The axial door is never touched. It carries the enfilade from the rear door
     * through the sanctum and out the portico, and hiding it would break the one
     * sight-line the generator exists to produce. Mirrored twins are converted as
     * a pair, so the villa is never asymmetric about its axis.
     */
    _palladianAddSecretPassages(dungeonGrid, plan, rooms, cfg) {
        const chance = cfg.secretPassageChance ?? 0;
        if (chance <= 0) return { doors: [], levers: [] };

        const { axisX } = plan;
        const mirrorX = (x) => 2 * axisX - x;

        // Interior doors only: grid 2. Exterior windows and the axial opening are
        // carved as 1 and so are excluded automatically.
        const interior = [];
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (dungeonGrid[y][x] !== 2) continue;
                if (x === axisX) continue;               // never hide the enfilade
                interior.push({ x, y });
            }
        }
        if (interior.length === 0) return { doors: [], levers: [] };

        const roomsAt = (x, y) => rooms.filter(rm =>
            rm.doors.some(d => d.x === x && d.y === y));

        // A room must keep at least one door the player can simply walk through, or
        // the secret stops being a shortcut and becomes the only way in. Counting is
        // done against a live set of concealed tiles rather than a per-room tally:
        // a door is shared by the rooms on both sides (and the sanctum touches many),
        // so decrementing per-room counters miscounts as soon as one door is claimed
        // by two rooms.
        const concealed = new Set();
        const wouldStrand = (pts) => {
            const trial = new Set([...concealed, ...pts.map(q => `${q.x},${q.y}`)]);
            const affected = new Set(pts.flatMap(q => roomsAt(q.x, q.y)));
            for (const rm of affected) {
                if (!rm.doors.some(d => !trial.has(`${d.x},${d.y}`))) return true;
            }
            return false;
        };

        const doors = [], levers = [];
        const taken = new Set();
        // Every barred cell placed so far, so later passages account for them.
        const barredSoFar = [];
        // Wall cells already given to a lever. Two passages can otherwise pick the
        // same cell and stack two levers on one tile.
        const leverCells = new Set();

        for (const pt of interior) {
            const key = `${pt.x},${pt.y}`;
            if (taken.has(key)) continue;                // already claimed as a twin
            if (pt.x > axisX) continue;                  // west half drives; east mirrors
            if (ROT.RNG.getPercentage() > chance) continue;

            const twin = { x: mirrorX(pt.x), y: pt.y };
            const pair = (twin.x !== pt.x && dungeonGrid[twin.y]?.[twin.x] === 2)
                ? [pt, twin] : [pt];

            // Both twins must survive the last-door test, or neither is hidden.
            if (wouldStrand(pair)) continue;

            for (const q of pair) concealed.add(`${q.x},${q.y}`);
            for (const q of pair) {
                taken.add(`${q.x},${q.y}`);
                // Grid 1, not 2: finalize turns a 2 into an ordinary visible door.
                dungeonGrid[q.y][q.x] = 1;
            }

            // Bar the pair or neither, and site the west lever only — the twin's
            // lever is its mirror image. Rolling each side independently would put
            // the two levers in unrelated places, which is visible asymmetry.
            //
            // A barred door DOES block passage until its lever is pulled, so unlike a
            // plain concealed door it can strand: put the lever behind the door it
            // opens and the room is sealed for good. The lever therefore has to go in
            // whichever of the two rooms is still reachable with this door treated as
            // wall — checked against the live grid, so earlier passages in this same
            // pass are already accounted for.
            // Reachability is tested against THIS pair plus every barred door already
            // placed. Testing only this pair lets two passages each hold the other's
            // lever — a deadlock neither search can break, since a barred door has no
            // other opener.
            this._palladianRegionCache = null;
            const barred = ROT.RNG.getPercentage() <= (cfg.secretPassageLeverChance ?? 0);
            const shut = [...pair, ...barredSoFar];
            const hostRooms = barred
                ? this._palladianRoomsReachableWithout(dungeonGrid, roomsAt(pt.x, pt.y), shut)
                : [];
            const candidate = (barred && hostRooms.length > 0)
                ? this._palladianFindHiddenLeverSpot(dungeonGrid, plan, hostRooms, pt, leverCells)
                : null;
            // A reachable room is not enough: the lever is in a wall cell, and that
            // cell has to border the part of the room that is still reachable.
            const spot = (candidate &&
                this._palladianCellReachableWithout(dungeonGrid, candidate, shut))
                ? candidate : null;
            // The twin's lever is the mirror of this one. The mirror of a wall cell is
            // a wall cell, but only inside the villa envelope — and mirroring does not
            // preserve reachability, since the twin door blocks a different region. So
            // the reflected cell is checked for both.
            const twinSpot = spot
                ? { x: mirrorX(spot.x), y: spot.y }
                : null;
            const twinSpotOk = twinSpot &&
                twinSpot.x >= 1 && twinSpot.x < this.width - 1 &&
                dungeonGrid[twinSpot.y]?.[twinSpot.x] < 1 &&
                !leverCells.has(`${twinSpot.x},${twinSpot.y}`) &&
                this._palladianCellReachableWithout(dungeonGrid, twinSpot, shut);

            if (!spot || (pair.length > 1 && !twinSpotOk)) {
                doors.push(...pair);
                continue;
            }

            const spots = pair.length > 1 ? [spot, twinSpot] : [spot];
            pair.forEach((q, i) => {
                const machineId = `palladian_secret_${doors.length}`;
                doors.push({ ...q, machine_id: machineId });
                levers.push({ ...spots[i], machine_id: machineId });
                leverCells.add(`${spots[i].x},${spots[i].y}`);
                barredSoFar.push({ x: q.x, y: q.y });
            });
        }

        return { doors, levers };
    }

    /**
     * Hand the finished secret passages to the spawn queues.
     *
     * Runs AFTER finalize, for the same reason the colonnade does: finalize
     * queues a wall on every void cell touching floor, which includes the tile a
     * hidden lever wants. Claiming the tile here — and dropping the wall finalize
     * queued for it — is what stops the two actors landing on top of each other.
     */
    _palladianQueueSecrets(secrets) {
        if (!secrets) return;
        if (secrets.levers.length > 0) {
            const claimed = new Set(secrets.levers.map(l => `${l.x},${l.y}`));
            const free = (p) => !claimed.has(`${p.x},${p.y}`);
            this.pendingWallSpawns = this.pendingWallSpawns.filter(free);
            // Finalize's torch pass draws from pendingWallSpawns, so it may already
            // have picked this tile before the wall itself was dropped.
            this.pendingTorchSpawns = this.pendingTorchSpawns.filter(free);
        }
        this.pendingSecretDoorSpawns.push(...secrets.doors);
        this.pendingHiddenLeverSpawns.push(...secrets.levers);
    }

    /**
     * Which of a passage's two rooms are still reachable with that passage shut.
     *
     * Flood-fills the live grid from the largest open region with the barred cells
     * treated as wall, then keeps the rooms that region touches. A lever sited in a
     * room this returns can always be reached, so a barred passage can never seal
     * itself off — the failure mode is permanent, since nothing else opens it.
     */
    _palladianRoomsReachableWithout(dungeonGrid, candidateRooms, barredCells) {
        if (candidateRooms.length === 0) return [];
        const region = this._palladianOpenRegionWithout(dungeonGrid, barredCells);
        if (region.size === 0) return [];

        // A room counts as reached when any of its own bay cells is in the region;
        // its doors are not enough, since a door can be the barred cell itself.
        return candidateRooms.filter(rm => rm.bays.some(b => {
            for (let y = b.y1; y <= b.y2; y++) {
                for (let x = b.x1; x <= b.x2; x++) {
                    if (region.has(`${x},${y}`)) return true;
                }
            }
            return false;
        }));
    }

    /**
     * The largest open region of the grid with `barredCells` treated as wall.
     *
     * Seeded from the largest component rather than an arbitrary tile: the player
     * arrives by the stairs, which land in open floor, and the biggest component is
     * the best proxy for that available at this stage. Memoized so the three checks
     * for one passage share a single flood fill; the caller drops the cache when it
     * moves to the next passage, since carving one mutates the grid.
     */
    _palladianOpenRegionWithout(dungeonGrid, barredCells) {
        const blocked = new Set(barredCells.map(p => `${p.x},${p.y}`));
        const cacheKey = [...blocked].sort().join('|');
        if (this._palladianRegionCache?.key === cacheKey) return this._palladianRegionCache.region;

        const open = (x, y) => dungeonGrid[y]?.[x] >= 1 && !blocked.has(`${x},${y}`);
        const seenAll = new Set();
        let best = new Set();
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const k = `${x},${y}`;
                if (seenAll.has(k) || !open(x, y)) continue;
                const comp = new Set([k]);
                const stack = [[x, y]];
                while (stack.length) {
                    const [cx, cy] = stack.pop();
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nx = cx + dx, ny = cy + dy, nk = `${nx},${ny}`;
                        if (comp.has(nk) || !open(nx, ny)) continue;
                        comp.add(nk);
                        stack.push([nx, ny]);
                    }
                }
                for (const c of comp) seenAll.add(c);
                if (comp.size > best.size) best = comp;
            }
        }
        this._palladianRegionCache = { key: cacheKey, region: best };
        return best;
    }

    // Can the player stand next to this wall cell with the barred cells shut? A wall
    // is worked from the floor beside it, so that is what has to be reachable.
    _palladianCellReachableWithout(dungeonGrid, cell, barredCells) {
        const region = this._palladianOpenRegionWithout(dungeonGrid, barredCells);
        return [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .some(([dx, dy]) => region.has(`${cell.x + dx},${cell.y + dy}`));
    }

    /**
     * A wall cell inside one of the passage's two rooms, to hide the lever in.
     *
     * The lever must be a wall the villa would have had anyway — it replaces the
     * wall actor on its tile, so it has to sit on a cell that finalize is going to
     * turn into wall (void in the grid, adjacent to that room's floor). Sitting it
     * one room away from the door it opens is deliberate: finding the lever and
     * finding the passage are two separate discoveries.
     */
    _palladianFindHiddenLeverSpot(dungeonGrid, plan, roomsPair, doorPt, taken = null) {
        const spots = [];
        for (const room of roomsPair) {
            for (const b of room.bays) {
                for (let y = b.y1 - 1; y <= b.y2 + 1; y++) {
                    for (let x = b.x1 - 1; x <= b.x2 + 1; x++) {
                        if (x < 1 || y < 1 || x >= this.width - 1 || y >= this.height - 1) continue;
                        if (dungeonGrid[y][x] >= 1) continue;           // must be wall
                        if (x === doorPt.x && y === doorPt.y) continue;
                        if (taken?.has(`${x},${y}`)) continue;         // another lever has it
                        // Needs floor beside it, or it is a wall nobody can reach.
                        const reachable = [[1, 0], [-1, 0], [0, 1], [0, -1]]
                            .some(([dx, dy]) => dungeonGrid[y + dy]?.[x + dx] >= 1);
                        if (!reachable) continue;
                        spots.push({ x, y });
                    }
                }
            }
        }
        if (spots.length === 0) return null;
        return spots[Math.floor(ROT.RNG.getUniform() * spots.length)];
    }

    // Two bays need a door between them when they exist and are different rooms.
    // Same room means the dividing wall was already carved away by a merge.
    _palladianNeedsDoor(roomA, roomB) {
        return !!roomA && !!roomB && roomA !== roomB;
    }

    // Which bay (if any) contains a tile. Used to attribute a door to the rooms on
    // either side of it.
    _palladianBayAt(plan, x, y) {
        for (let r = 0; r < plan.nRows; r++) {
            if (y < plan.rowY[r][0] || y > plan.rowY[r][1]) continue;
            for (let c = 0; c < plan.nCols; c++) {
                if (x >= plan.colX[c][0] && x <= plan.colX[c][1]) return [c, r];
            }
        }
        return null;
    }

    // Carve one opening and attribute it to the rooms on both sides. addDoor is
    // idempotent, and every room needs at least one door to be eligible for
    // treasure rooms and switch puzzles.
    _palladianRegisterDoor(dungeonGrid, plan, rooms, x, y, axial) {
        if (x < 1 || x > this.width - 2 || y < 1 || y > this.height - 2) return;
        if (dungeonGrid[y][x] >= 1) return;
        dungeonGrid[y][x] = axial ? 1 : 2;

        const sides = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        const seen = new Set();
        for (const [sx, sy] of sides) {
            const bay = this._palladianBayAt(plan, sx, sy);
            if (!bay) continue;
            const room = rooms.find(rm => rm.bayKeys.has(`${bay[0]},${bay[1]}`));
            if (!room || seen.has(room.id)) continue;
            seen.add(room.id);
            room.doors.push({ x, y });
        }
    }
    // The door pass covers every adjacency, so the plan should already be
    // connected — but an off-by-one in an overlap, or an in-antis recess eating a
    // bay's only opening, can still orphan a room.
    _palladianEnsureConnected(dungeonGrid, plan, rooms, portico) {
        const mirrorX = (x) => 2 * plan.axisX - x;
        const start = portico
            ? { x: plan.axisX, y: portico.innerY }
            : { x: rooms[0].x1, y: rooms[0].y1 };

        for (let pass = 0; pass <= rooms.length; pass++) {
            const seen = this._floodFillRegion(dungeonGrid, start.x, start.y);
            const reached = (room) => {
                for (const b of room.bays) {
                    for (let y = b.y1; y <= b.y2; y++) {
                        for (let x = b.x1; x <= b.x2; x++) if (seen.has(`${x},${y}`)) return true;
                    }
                }
                return false;
            };
            const orphans = rooms.filter(r => !reached(r));
            if (orphans.length === 0) return;
            if (pass === rooms.length) {
                console.warn(`Palladian: ${orphans.length} room(s) still unreachable after repair`);
                return;
            }

            for (const room of orphans) {
                // Find a wall tile between this room and anything already reached,
                // and punch it. A repair opening is plain floor (1), never a door
                // candidate — it must not be gated on a doorChance roll.
                let done = false;
                for (const b of room.bays) {
                    const probes = [];
                    for (let y = b.y1; y <= b.y2; y++) {
                        probes.push({ wx: b.x1 - 1, wy: y, ox: b.x1 - 2, oy: y });
                        probes.push({ wx: b.x2 + 1, wy: y, ox: b.x2 + 2, oy: y });
                    }
                    for (let x = b.x1; x <= b.x2; x++) {
                        probes.push({ wx: x, wy: b.y1 - 1, ox: x, oy: b.y1 - 2 });
                        probes.push({ wx: x, wy: b.y2 + 1, ox: x, oy: b.y2 + 2 });
                    }
                    for (const p of probes) {
                        if (p.wx < 1 || p.wx > this.width - 2 || p.wy < 1 || p.wy > this.height - 2) continue;
                        if (p.ox < 0 || p.ox >= this.width || p.oy < 0 || p.oy >= this.height) continue;
                        if (dungeonGrid[p.wy][p.wx] >= 1) continue;
                        if (!seen.has(`${p.ox},${p.oy}`)) continue;
                        dungeonGrid[p.wy][p.wx] = 1;
                        room.doors.push({ x: p.wx, y: p.wy });
                        // Mirror every repair. If the twin's room was already
                        // connected the extra opening is harmless.
                        const mx = mirrorX(p.wx);
                        if (mx !== p.wx && mx >= 1 && mx <= this.width - 2 && dungeonGrid[p.wy][mx] < 1) {
                            dungeonGrid[p.wy][mx] = 1;
                        }
                        done = true;
                        break;
                    }
                    if (done) break;
                }
            }
        }
    }

    // Build the ROT.js-Room-duck-typed records that diggerRooms consumers expect.
    // The getLeft/getDoors/addDoor shape from _brogueMakeRoomRecord is consumed by
    // spawnTreasureRoom, _placeSwitchPuzzle_gatedRoom and finalize's torch pass.
    _palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings) {
        // A room that swallowed the whole grid has no interior adjacency, so the
        // door pass never gave it one. Its exterior openings are its entrances —
        // and every room needs at least one door or spawnTreasureRoom and the
        // switch-puzzle placer filter it out entirely.
        if (openings) {
            for (const room of rooms) {
                if (room.doors.length > 0) continue;
                for (const w of openings.windows) {
                    const touches = room.bays.some(b =>
                        w.x >= b.x1 - 1 && w.x <= b.x2 + 1 && w.y >= b.y1 - 1 && w.y <= b.y2 + 1);
                    if (touches) room.doors.push({ x: w.x, y: w.y });
                }
            }
        }

        const records = [];
        for (const room of rooms) {
            const w = room.x2 - room.x1 + 1, h = room.y2 - room.y1 + 1;
            const local = Array.from({ length: h }, () => new Uint8Array(w));
            for (const b of room.bays) {
                for (let y = b.y1; y <= b.y2; y++) {
                    for (let x = b.x1; x <= b.x2; x++) local[y - room.y1][x - room.x1] = 1;
                }
            }
            const rec = this._brogueMakeRoomRecord(local, w, h, room.x1, room.y1, room.doors);
            rec.shape = room.shape;
            rec.isSanctum = !!room.isSanctum;
            records.push(rec);
        }

        if (portico) {
            const y1 = portico.style === 'prostyle' ? plan.bottom : plan.bottom - portico.depth;
            const y2 = portico.style === 'prostyle' ? plan.bottom + portico.depth : plan.bottom;
            const w = portico.spanX2 - portico.spanX1 + 1, h = y2 - y1 + 1;
            const local = Array.from({ length: h }, () => new Uint8Array(w).fill(1));
            const rec = this._brogueMakeRoomRecord(local, w, h, portico.spanX1, y1,
                [{ x: plan.axisX, y: plan.bottom }]);
            rec.shape = 'rect';
            rec.isPortico = true;
            records.push(rec);
        }

        // Protect the sanctum from being claimed by a switch puzzle or converted
        // into a locked treasure room — the boss is authored to live there.
        const sanctumIdx = records.findIndex(r => r.isSanctum);
        if (sanctumIdx >= 0) this.claimedRoomIndices.add(sanctumIdx);

        return records;
    }

    // Exterior window openings get a see-through solid actor. `fortification` is
    // solid with opaque:false — a barred window, keeping the villa's envelope
    // sealed. Pushed after finalize for the same reason as the colonnade.
    _palladianPlaceWindows(openings) {
        for (const w of openings.windows) {
            this.pendingWallSpawns.push({ x: w.x, y: w.y, type: 'fortification' });
        }
    }

    // Publish the sanctum and portico so a random_actors/random_items entry can
    // name one via its `region` key. The dungeonGrid >= 1 test is what correctly
    // handles a cross-shaped sanctum, whose bbox includes non-floor cells.
    _palladianPublishRegions(dungeonGrid, plan, records, portico) {
        const tilesOf = (rec) => {
            const tiles = [];
            for (let y = rec._y1; y <= rec._y2; y++) {
                for (let x = rec._x1; x <= rec._x2; x++) {
                    if (y < 0 || y >= this.height || x < 0 || x >= this.width) continue;
                    if (dungeonGrid[y][x] >= 1) tiles.push({ x, y });
                }
            }
            return tiles;
        };
        const sanctum = records.find(r => r.isSanctum);
        if (sanctum) this.namedRegions.sanctum = tilesOf(sanctum);
        const porticoRec = records.find(r => r.isPortico);
        if (porticoRec) this.namedRegions.portico = tilesOf(porticoRec);
        if (this.namedRegions.portico?.length) {
            this.suggestedStairwayRegions.up = 'portico';
        }
    }

    _brogueFinalizeMap(dungeonGrid, rooms, mapW, mapH, cfg, secretWalls = []) {
        const secretWallSet = new Set(secretWalls.map(p => `${p.x},${p.y}`));
        const floorSet = new Set();

        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (dungeonGrid[y][x] >= 1) {
                    this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
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
                    this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
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
    addBaseAndShadows() {
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
        ]);
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
        this.pendingLavaSpawns = [];
        this.pendingLakeSpawns = [];
        this.pendingSewageSpawns = [];
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
