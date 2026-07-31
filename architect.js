const TILED_FLIP_MASK = 0x1FFFFFFF;
const TILED_FLIP_H = 0x80000000;
const TILED_FLIP_V = 0x40000000;
const TILED_FLIP_D = 0x20000000;

class Architect {
    constructor(options = {}) {
        this.width = options.width || 30;
        this.height = options.height || 30;

        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wallMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.overlayMap = this.createEmptyMap();

        this.walkableTiles = [];

        this.pendingWallSpawns = [];
        this.pendingDoorSpawns = [];
        this.pendingTorchSpawns = [];
        this.pendingLavaSpawns = [];
        this.pendingLakeSpawns = [];
        this.pendingSewageSpawns = [];
        this.pendingPushableWallSpawns = [];
        this.pendingBridgeSpawns = [];
        this.pendingCollapsingFloorSpawns = [];
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
            'wall': this.wallMap,
            'wildcard': this.wildcardMap,
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
            this.wallMap = this.createEmptyMap();
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
        for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
                const index = y * layer.width + x;
                const { tileId, flipH, flipV, flipD } = this.parseTileGID(layer.data[index]);

                if (tileId > 0) {
                    this.backgroundMap[y][x] = { tileId, layer: 'background', flipH, flipV, flipD };
                }
            }
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
    // PROCEDURAL GENERATION (stub)
    // ========================================================================

    generateProceduralMap(generatorConfig = {}) {
        const generatorType = generatorConfig.type || 'digger';
        const options = generatorConfig.options || {};

        if (options.map_width) this.width = options.map_width;
        if (options.map_height) this.height = options.map_height;

        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wallMap = this.createEmptyMap();
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
                const totalWeight = wallTypes.reduce((sum, wt) => sum + wt.weight, 0);

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (!floorTiles.has(`${x},${y}`)) {
                            let roll = ROT.RNG.getUniform() * totalWeight;
                            let wallType = wallTypes[0].type;
                            for (const wt of wallTypes) {
                                roll -= wt.weight;
                                if (roll <= 0) {
                                    wallType = wt.type;
                                    break;
                                }
                            }
                            this.pendingWallSpawns.push({ x, y, type: wallType });
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
                const infernalTotalWeight = infernalWallTypes.reduce((sum, wt) => sum + wt.weight, 0);

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (!infernalFloorTiles.has(`${x},${y}`)) {
                            let roll = ROT.RNG.getUniform() * infernalTotalWeight;
                            let wallType = infernalWallTypes[0].type;
                            for (const wt of infernalWallTypes) {
                                roll -= wt.weight;
                                if (roll <= 0) {
                                    wallType = wt.type;
                                    break;
                                }
                            }
                            this.pendingWallSpawns.push({ x, y, type: wallType });
                        }
                    }
                }

                console.log(`Infernal map generated: ${infernalFloorTiles.size} floor tiles`);
                break;
            }

            case 'brogue': {
                // maxRooms is optional in prototype data: when omitted, scale it to
                // the map area (~200 tiles per room+corridor footprint) so larger
                // maps fill out instead of staying sparse at the old flat 35.
                // The divisor leaves gaps between rooms for corridors to snake
                // through — packing too tightly (a smaller divisor) starves the
                // generator of the space corridors need. Clamped so tiny/huge maps
                // stay sane. An explicit maxRooms wins.
                const autoMaxRooms = Math.min(120, Math.max(8,
                    Math.round((this.width * this.height) / 200)));
                // maxAttempts is the practical limiter (many attempts fail to place),
                // so it must scale with the room target or large maps stall well
                // short of maxRooms. ~4x the target gives enough headroom to reach it
                // despite fails; clamped. An explicit maxAttempts wins.
                const autoMaxAttempts = Math.min(600, Math.max(50, autoMaxRooms * 4));
                const brogueCfg = {
                    maxRooms: options.maxRooms || autoMaxRooms,
                    maxAttempts: options.maxAttempts || autoMaxAttempts,
                    corridorChance: options.corridorChance ?? 55,
                    corridorLength: options.corridorLength || [3, 9],
                    loopMinDistance: options.loopMinDistance || 20,
                    maxLoops: options.maxLoops || 5,
                    doorChance: options.doorChance ?? 50,
                    torchChance: options.torchChance ?? 30,
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

                // Seed the first room in a randomly-chosen corner rather than the
                // map center. Rooms attach outward from the seed, so a center seed
                // makes play radiate from the middle — on large scrolling maps that
                // clusters everything on the viewport seams. Seeding from a random
                // corner spreads rooms across the whole map, and randomizing which
                // corner keeps maps from feeling same-y. (margin keeps the room's
                // 1-tile wall border off the map edge.)
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
                let corridorAttempts = 0;      // rooms that grew a corridor stub
                let corridorsPlaced = 0;       // corridor-rooms that placed successfully
                let corridorFails = 0;         // corridor-rooms that failed to place
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

                // Fix dead-end corridors with pushable walls
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
                    `${this.pendingDoorSpawns.length} doors.`
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
                    // consumed by _brogueFinalizeMap. torchChance is higher than
                    // brogue's 30 because temples are lit. brick_wall as the
                    // default also disables the shared pushable-wall conversion
                    // pass below (it skips any type !== 'wall'); switch to 'wall'
                    // to get secret passages in the villa walls.
                    doorChance: options.doorChance ?? 55,
                    torchChance: options.torchChance ?? 40,
                    wall_types: options.wall_types || [{ type: 'brick_wall', weight: 100 }],
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

                const records = this._palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings);
                this._brogueFinalizeMap(dungeonGrid, records, this.width, this.height, palCfg);

                // Decoration runs AFTER finalize on purpose: finalize's torch pass
                // would otherwise convert a column into a brazier, and its
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
                const diggerTotalWeight = diggerWallTypes.reduce((sum, wt) => sum + wt.weight, 0);

                const hasDiggerFloor = (fx, fy) => diggerFloorTiles.has(`${fx},${fy}`);

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (diggerFloorTiles.has(`${x},${y}`)) continue;

                        const adjacentToFloor =
                            hasDiggerFloor(x - 1, y) || hasDiggerFloor(x + 1, y) ||
                            hasDiggerFloor(x, y - 1) || hasDiggerFloor(x, y + 1) ||
                            hasDiggerFloor(x - 1, y - 1) || hasDiggerFloor(x + 1, y - 1) ||
                            hasDiggerFloor(x - 1, y + 1) || hasDiggerFloor(x + 1, y + 1);

                        if (adjacentToFloor && y > 0) {
                            let roll = ROT.RNG.getUniform() * diggerTotalWeight;
                            let wallType = diggerWallTypes[0].type;
                            for (const wt of diggerWallTypes) {
                                roll -= wt.weight;
                                if (roll <= 0) {
                                    wallType = wt.type;
                                    break;
                                }
                            }
                            this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                            this.pendingWallSpawns.push({ x, y, type: wallType });
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

                const pendingWallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (!isPerimeter(x, y)) continue;
                        if (diggerFloorTiles.has(`${x},${y}`)) continue;
                        if (pendingWallSet.has(`${x},${y}`)) continue;

                        const adj =
                            hasDiggerFloor(x - 1, y) || hasDiggerFloor(x + 1, y) ||
                            hasDiggerFloor(x, y - 1) || hasDiggerFloor(x, y + 1) ||
                            hasDiggerFloor(x - 1, y - 1) || hasDiggerFloor(x + 1, y - 1) ||
                            hasDiggerFloor(x - 1, y + 1) || hasDiggerFloor(x + 1, y + 1);

                        if (adj) {
                            this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                            this.pendingWallSpawns.push({ x, y, type: 'metal_wall' });
                        }
                    }
                }

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
                            const torchPos = roomWalls[Math.floor(ROT.RNG.getUniform() * roomWalls.length)];
                            this.pendingTorchSpawns.push({ x: torchPos.x, y: torchPos.y });
                            const idx = this.pendingWallSpawns.findIndex(p => p.x === torchPos.x && p.y === torchPos.y);
                            if (idx !== -1) this.pendingWallSpawns.splice(idx, 1);
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

        if (options.bridges) {
            this.generateBridges(options.bridges);
        }

        if (options.collapsing_floors) {
            this.generateCollapsingFloors(options.collapsing_floors);
        }

        if (this.pendingWallSpawns.length > 0) {
            const hasFloor = (x, y) => {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
                return this.floorMap[y][x] !== null;
            };
            const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
            const converted = [];
            for (let i = this.pendingWallSpawns.length - 1; i >= 0; i--) {
                const wall = this.pendingWallSpawns[i];
                if (wall.type && wall.type !== 'wall') continue;
                const betweenFloors =
                    (hasFloor(wall.x - 1, wall.y) && hasFloor(wall.x + 1, wall.y) &&
                     !wallSet.has(`${wall.x - 1},${wall.y}`) && !wallSet.has(`${wall.x + 1},${wall.y}`)) ||
                    (hasFloor(wall.x, wall.y - 1) && hasFloor(wall.x, wall.y + 1) &&
                     !wallSet.has(`${wall.x},${wall.y - 1}`) && !wallSet.has(`${wall.x},${wall.y + 1}`));
                if (!betweenFloors) continue;
                if (ROT.RNG.getPercentage() <= 2) {
                    this.pendingPushableWallSpawns.push({ x: wall.x, y: wall.y });
                    this.pendingWallSpawns.splice(i, 1);
                    converted.push(wall);
                }
            }
            if (converted.length > 0) {
                console.log(`Pushable wall generation: ${converted.length} pushable walls`);
            }
        }

        console.log(`Procedural map generated with ${this.walkableTiles.length} walkable tiles`);
    }

    generateOverlayBlobs(config) {
        if (!config || !config.count) return;

        const count = Array.isArray(config.count)
            ? ROT.RNG.getUniformInt(config.count[0], config.count[1])
            : config.count;
        if (count <= 0) return;

        const types = config.types || ['water'];
        const minSize = config.minSize || 10;
        const maxSize = config.maxSize || 60;

        const walkableSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
        const wallPosSet = new Set(this.pendingWallSpawns
            .filter(p => p.type !== 'metal_wall')
            .map(p => `${p.x},${p.y}`));
        const expandableSet = new Set([...walkableSet, ...wallPosSet]);

        const allVoidCells = new Set();
        const allLiquidCells = new Set();
        let totalPlaced = 0;

        for (let i = 0; i < count; i++) {
            const type = types[Math.floor(ROT.RNG.getUniform() * types.length)];
            const targetSize = ROT.RNG.getUniformInt(minSize, maxSize);

            const walkableArray = [...walkableSet];
            if (walkableArray.length === 0) break;
            const seed = walkableArray[Math.floor(ROT.RNG.getUniform() * walkableArray.length)];

            const blob = [];
            const blobSet = new Set();
            const frontier = [seed];
            const visited = new Set([seed]);
            const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

            while (blob.length < targetSize && frontier.length > 0) {
                // Weight frontier cells by how many blob neighbors they have
                // This produces compact, dense shapes instead of tendrils
                let bestIdx = 0;
                let bestScore = -1;
                for (let fi = 0; fi < frontier.length; fi++) {
                    const [fx, fy] = frontier[fi].split(',').map(Number);
                    let neighbors = 0;
                    for (const [dx, dy] of dirs) {
                        if (blobSet.has(`${fx + dx},${fy + dy}`)) neighbors++;
                    }
                    const score = neighbors + ROT.RNG.getUniform() * 0.5;
                    if (score > bestScore) {
                        bestScore = score;
                        bestIdx = fi;
                    }
                }

                const cell = frontier.splice(bestIdx, 1)[0];

                if (!expandableSet.has(cell)) continue;

                blob.push(cell);
                blobSet.add(cell);
                expandableSet.delete(cell);
                walkableSet.delete(cell);

                const [cx, cy] = cell.split(',').map(Number);
                for (const [dx, dy] of dirs) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                    const nk = `${nx},${ny}`;
                    if (!visited.has(nk) && expandableSet.has(nk)) {
                        visited.add(nk);
                        frontier.push(nk);
                    }
                }
            }

            if (blob.length === 0) continue;
            totalPlaced += blob.length;

            if (type === 'abyss') {
                for (const key of blob) {
                    allVoidCells.add(key);
                    const [vx, vy] = key.split(',').map(Number);
                    this.floorMap[vy][vx] = null;
                    this.backgroundMap[vy][vx] = { tileId: 217, layer: 'background' };
                    this.wallMap[vy][vx] = null;
                    this.overlayMap[vy][vx] = null;
                }
            } else {
                for (const key of blob) {
                    allLiquidCells.add(key);
                    if (wallPosSet.has(key)) {
                        const [cx, cy] = key.split(',').map(Number);
                        if (!this.floorMap[cy][cx]) {
                            this.floorMap[cy][cx] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        }
                    }
                }

                if (type === 'lava') {
                    for (const key of blob) {
                        const [px, py] = key.split(',').map(Number);
                        this.pendingLavaSpawns.push({ x: px, y: py });
                    }
                } else if (type === 'sewage') {
                    for (const key of blob) {
                        const [px, py] = key.split(',').map(Number);
                        this.pendingSewageSpawns.push({ x: px, y: py });
                    }
                } else {
                    for (const key of blob) {
                        const [px, py] = key.split(',').map(Number);
                        this.pendingLakeSpawns.push({ x: px, y: py });
                    }
                }
            }

            console.log(`  ${type} blob: ${blob.length} tiles`);
        }

        if (allVoidCells.size > 0) {
            this.pendingWallSpawns = this.pendingWallSpawns.filter(p => !allVoidCells.has(`${p.x},${p.y}`));
            this.pendingDoorSpawns = this.pendingDoorSpawns.filter(p => !allVoidCells.has(`${p.x},${p.y}`));
            this.pendingTorchSpawns = this.pendingTorchSpawns.filter(p => !allVoidCells.has(`${p.x},${p.y}`));
            this.pendingLavaSpawns = this.pendingLavaSpawns.filter(p => !allVoidCells.has(`${p.x},${p.y}`));
            this.pendingLakeSpawns = this.pendingLakeSpawns.filter(p => !allVoidCells.has(`${p.x},${p.y}`));
            this.pendingSewageSpawns = this.pendingSewageSpawns.filter(p => !allVoidCells.has(`${p.x},${p.y}`));
        }

        if (allLiquidCells.size > 0) {
            this.pendingWallSpawns = this.pendingWallSpawns.filter(p => !allLiquidCells.has(`${p.x},${p.y}`));
            this.pendingDoorSpawns = this.pendingDoorSpawns.filter(p => !allLiquidCells.has(`${p.x},${p.y}`));
            this.pendingTorchSpawns = this.pendingTorchSpawns.filter(p => !allLiquidCells.has(`${p.x},${p.y}`));
        }

        const allBlobCells = new Set([...allLiquidCells, ...allVoidCells]);
        if (allBlobCells.size > 0) {
            const existingWallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
            const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
            let boundaryWalls = 0;

            for (const key of allBlobCells) {
                const [bx, by] = key.split(',').map(Number);
                if (!wallPosSet.has(key)) continue;
                for (const [dx, dy] of dirs) {
                    const nx = bx + dx;
                    const ny = by + dy;
                    if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                    const nk = `${nx},${ny}`;
                    if (allBlobCells.has(nk)) continue;
                    if (existingWallSet.has(nk)) continue;
                    if (this.floorMap[ny]?.[nx]) continue;

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

        this.walkableTiles = this.walkableTiles.filter(t => walkableSet.has(`${t.x},${t.y}`));

        console.log(`Overlay generation: ${totalPlaced} total tiles in ${count} blobs`);
    }

    generateBridges(config) {
        const maxBridges = config.max || 1;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && bg.tileId === 217 && this.floorMap[y][x] === null;
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
                    // rope_bridge platform actor provide footing — exactly like a
                    // collapsing_floor. Do NOT lay real floor here: that would (a) make
                    // addBaseAndShadows treat the cell as floor and skip the cliffside
                    // shadow it gives the rest of the abyss, and (b) leave a floor tile
                    // behind when the bridge burns instead of revealing the void below.
                    // Orientation (dir) is recorded per cell, but the final box-drawing
                    // tile is chosen from bridge-cell adjacency in spawnPendingBridges so
                    // the intersection cell becomes a proper "+" junction.
                    this.pendingBridgeSpawns.push({ x: c.x, y: c.y, dir: crossing.dir });
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
        const BLACK_TILE = 217;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && bg.tileId === BLACK_TILE && this.floorMap[y][x] === null;
        };

        const hasFloor = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            return this.floorMap[y][x] !== null;
        };

        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const bridgeSet = new Set(this.pendingBridgeSpawns.map(p => `${p.x},${p.y}`));

        const cardinalDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const edgeTiles = [];

        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (!hasFloor(x, y)) continue;
                if (wallSet.has(`${x},${y}`)) continue;
                if (bridgeSet.has(`${x},${y}`)) continue;
                const adjacentToAbyss = cardinalDirs.some(([dx, dy]) => isAbyss(x + dx, y + dy));
                if (adjacentToAbyss) {
                    edgeTiles.push({ x, y });
                }
            }
        }

        if (edgeTiles.length === 0) return;

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

            for (const [dx, dy] of cardinalDirs) {
                const nx = seed.x + dx, ny = seed.y + dy;
                if (hasFloor(nx, ny) && !wallSet.has(`${nx},${ny}`) && !bridgeSet.has(`${nx},${ny}`)) {
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
                    const nk = `${nx},${ny}`;
                    if (hasFloor(nx, ny) && !patchSet.has(nk) && !wallSet.has(nk) && !bridgeSet.has(nk)) {
                        frontier.push({ x: nx, y: ny });
                    }
                }
            }

            if (patch.length < minPatchSize) continue;

            for (const c of patch) {
                this.floorMap[c.y][c.x] = null;
                this.backgroundMap[c.y][c.x] = { tileId: BLACK_TILE, layer: 'background' };
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

    generateCaveAt(startX, startY, width, height, context = null) {
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

        cave.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'cave') {
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

        cave.connect((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (value === 0 && worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (wildcard && wildcard.type === 'cave' && !this.floorMap[worldY][worldX]) {
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.walkableTiles.push({ x: worldX, y: worldY });
                    floorCells.add(`${x},${y}`);
                }
            }
        }, 1);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (floorCells.has(`${x},${y}`)) continue;

                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX >= this.width || worldY >= this.height) continue;

                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'cave') continue;

                this.backgroundMap[worldY][worldX] = null;
                this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                wallPositions.push({ x: worldX, y: worldY });
            }
        }

        const wallTypes = mapGenConfig.wall_types || [{ type: 'wall', weight: 100 }];
        const totalWeight = wallTypes.reduce((sum, wt) => sum + wt.weight, 0);

        for (const pos of wallPositions) {
            let roll = ROT.RNG.getUniform() * totalWeight;
            let wallType = wallTypes[0].type;
            for (const wt of wallTypes) {
                roll -= wt.weight;
                if (roll <= 0) {
                    wallType = wt.type;
                    break;
                }
            }
            this.pendingWallSpawns.push({ x: pos.x, y: pos.y, type: wallType });
        }

        console.log(`Cave generated: ${floorCells.size} floor tiles, ${wallPositions.length} walls`);
    }

    generateInfernalAt(startX, startY, width, height, context = null) {
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

        cave.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'infernal') {
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

        cave.connect((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (value === 0 && worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (wildcard && wildcard.type === 'infernal' && !this.floorMap[worldY][worldX]) {
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.walkableTiles.push({ x: worldX, y: worldY });
                    floorCells.add(`${x},${y}`);
                }
            }
        }, 1);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (floorCells.has(`${x},${y}`)) continue;

                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX >= this.width || worldY >= this.height) continue;

                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'infernal') continue;

                this.backgroundMap[worldY][worldX] = null;
                this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                wallPositions.push({ x: worldX, y: worldY });
            }
        }

        const wallTypes = mapGenConfig.wall_types || [{ type: 'wall', weight: 100 }];
        const totalWeight = wallTypes.reduce((sum, wt) => sum + wt.weight, 0);

        for (const pos of wallPositions) {
            let roll = ROT.RNG.getUniform() * totalWeight;
            let wallType = wallTypes[0].type;
            for (const wt of wallTypes) {
                roll -= wt.weight;
                if (roll <= 0) {
                    wallType = wt.type;
                    break;
                }
            }
            this.pendingWallSpawns.push({ x: pos.x, y: pos.y, type: wallType });
        }

        console.log(`Infernal cave generated: ${floorCells.size} floor tiles, ${wallPositions.length} walls`);
    }

    generateAbyssAt(startX, startY, width, height, context = null) {
        const regionSet = new Set();
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const wx = startX + x;
                const wy = startY + y;
                if (wx < this.width && wy < this.height) {
                    const wildcard = this.wildcardMap[wy][wx];
                    if (wildcard && wildcard.type === 'abyss' && this.floorMap[wy][wx]) {
                        regionSet.add(`${wx},${wy}`);
                    }
                }
            }
        }

        if (regionSet.size === 0) return;

        const config = {
            count: [1, Math.max(1, Math.floor(regionSet.size / 40))],
            types: ['abyss'],
            minSize: Math.min(10, Math.floor(regionSet.size / 4)),
            maxSize: Math.floor(regionSet.size / 2)
        };

        const walkableBackup = this.walkableTiles;
        this.walkableTiles = this.walkableTiles.filter(t => regionSet.has(`${t.x},${t.y}`));

        this.generateOverlayBlobs(config);

        const remainingSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
        this.walkableTiles = walkableBackup.filter(t =>
            !regionSet.has(`${t.x},${t.y}`) || remainingSet.has(`${t.x},${t.y}`)
        );
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
     * single wildcard region so a temple can be one feature of a larger floor rather
     * than the whole floor.
     *
     * Reuses every stage helper unchanged by having _palladianBuildGrid center the plan
     * inside the region's bounding box — the plan it returns is in world coordinates, so
     * carving, openings, columns and windows all work as they do on a full floor. Only
     * the finalize step differs (see _palladianFinalizeRegion): it must not iterate or
     * repaint the rest of the map.
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
        };

        // The mask is the region as authored, which may be an irregular blob. The plan
        // is fitted to the bounding box, so a non-rectangular region can clip it; that
        // is the map author's choice and the mask keeps the clip from corrupting
        // neighbouring geometry.
        const mask = new Set();
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const wx = startX + x;
                const wy = startY + y;
                if (wx < 0 || wx >= this.width || wy < 0 || wy >= this.height) continue;
                const wildcard = this.wildcardMap[wy][wx];
                if (wildcard && wildcard.type === 'palladian') mask.add(`${wx},${wy}`);
            }
        }
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

        const records = this._palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings);
        this._palladianFinalizeRegion(dungeonGrid, records, mask, cfg);

        // Same ordering rule as the full-floor path: decoration must run after
        // finalize, or the torch pass converts a column into a brazier.
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
        const totalWeight = wallTypes.reduce((sum, wt) => sum + wt.weight, 0);
        const pickWallType = () => {
            let roll = ROT.RNG.getUniform() * totalWeight;
            for (const wt of wallTypes) {
                roll -= wt.weight;
                if (roll <= 0) return wt.type;
            }
            return wallTypes[0].type;
        };

        for (const key of mask) {
            const [x, y] = key.split(',').map(Number);
            if (floorSet.has(key)) continue;
            const adj =
                hasFloor(x - 1, y) || hasFloor(x + 1, y) ||
                hasFloor(x, y - 1) || hasFloor(x, y + 1) ||
                hasFloor(x - 1, y - 1) || hasFloor(x + 1, y - 1) ||
                hasFloor(x - 1, y + 1) || hasFloor(x + 1, y + 1);
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

        // Torches, one per room, drawn from that room's own walls.
        for (const room of rooms) {
            if (ROT.RNG.getPercentage() > cfg.torchChance) continue;
            const roomWalls = this.pendingWallSpawns.filter(p =>
                p.type !== 'metal_wall' && inMask(p.x, p.y) &&
                p.x >= room._x1 - 1 && p.x <= room._x2 + 1 &&
                p.y >= room._y1 - 1 && p.y <= room._y2 + 1
            );
            if (roomWalls.length === 0) continue;
            const torchPos = roomWalls[Math.floor(ROT.RNG.getUniform() * roomWalls.length)];
            this.pendingTorchSpawns.push({ x: torchPos.x, y: torchPos.y });
            const idx = this.pendingWallSpawns.findIndex(p => p.x === torchPos.x && p.y === torchPos.y);
            if (idx !== -1) this.pendingWallSpawns.splice(idx, 1);
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

        const actorData = context.getActorData('brazier');
        if (!actorData) {
            console.warn('No brazier actor data found');
            return;
        }

        for (const pos of this.pendingTorchSpawns) {
            context.createActor(pos.x, pos.y, 'brazier', actorData);
        }

        console.log(`Spawned ${this.pendingTorchSpawns.length} brazier actors`);
        this.pendingTorchSpawns = [];
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
        const cellSet = new Set(this.pendingBridgeSpawns.map(p => `${p.x},${p.y}`));
        const has = (x, y) => cellSet.has(`${x},${y}`);
        const tileNameFor = (pos) => {
            const n = has(pos.x, pos.y - 1);
            const s = has(pos.x, pos.y + 1);
            const e = has(pos.x + 1, pos.y);
            const w = has(pos.x - 1, pos.y);
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
        // room, or a generator-reserved room like a palladian sanctum. Without this
        // the treasure room can land on top of one, walling off its extra entrances
        // and locking the door, which reads as a generator bug rather than a
        // mechanic. (_placeSwitchPuzzle_gatedRoom already honours this set.)
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
        for (const wall of this.pendingWallSpawns) {
            if (wall.x >= left && wall.x <= right && wall.y >= top && wall.y <= bottom) {
                wall.type = 'metal_wall';
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

        console.log(`Treasure room: ${roomTiles.length} floor tiles, locked door at (${chosenDoor.x}, ${chosenDoor.y}), ${allEntrances.length - 1} extra entrance(s) walled off`);
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
        // lands INSIDE the padded grid. Without this the padding stopped exactly at
        // the tip, so the forward door fell out of bounds and was dropped, leaving
        // most corridor-rooms with zero door sites and thus unplaceable (the real
        // reason long corridors almost never appeared).
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
        // *meant* to run alongside walls and thread past room corners. Requiring a
        // clear 3x3 around every corridor cell rejects almost all corridors in a
        // populated map (only a fully-clear channel fits), which is why long/
        // winding hallways never appeared. For corridor cells we only forbid
        // ORTHOGONAL adjacency to foreign floor (prevents fusing two passages
        // side-by-side); diagonal proximity is allowed so corridors can hug walls.
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

        if (secretWalls.length > 0) console.log(`Brogue dead ends: ${secretWalls.length} pushable walls placed`);
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
    // thickness. The odd count must be on the columns, since the axis is N-S.
    //
    // Two invariants everything downstream leans on:
    //
    //  - The central column's interior width is ODD. You cannot bisect an
    //    even-width column on a tile grid, so forcing it odd makes axisX an exact
    //    tile column and mirror(x) = 2*axisX - x exact.
    //
    //  - Symmetry is MIRROR-BY-CONSTRUCTION. We roll the west half and assign the
    //    east half from it. There is deliberately no "mirror afterwards" pass to
    //    get wrong, and no rounding that could differ between the two sides.
    //    Every later stage follows the same discipline.

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
        // x=0/y=0 — outside the reserve, and on row 0 where its own `y > 0` guards
        // then drop things inconsistently.
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
                        // axis, so it shrinks by 2. Rounding it back UP to odd here
                        // instead would hand it a tile back every pass, and on a
                        // heavily-degraded plan it would end up grotesquely wider
                        // than its neighbours.
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
                // afterwards: the new centre must be odd (to be bisected by the
                // axis) and the surviving east half must be re-mirrored from the
                // west. Skipping the re-mirror silently yields an asymmetric plan.
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

        // The plan's whole reason for existing is bilateral symmetry, and every
        // downstream stage assumes it. Assert it here, where a violation is one
        // array to inspect, rather than discovering it later as an unexplained
        // tile mismatch halfway across the map.
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

        // Center the FOOTPRINT and derive the axis from it. Do not try to center
        // axisX on this.width/2 — that reintroduces off-by-one asymmetry when the
        // map width and the footprint width differ in parity.
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

        // This single assertion pins the whole one-wall-thickness scheme, and
        // catches the off-by-one class of bug at its source rather than as a
        // mysterious 2-tile-thick wall much later.
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
                this._palladianCarveRect(dungeonGrid, b.x1, b.y1, b.x2, b.y2);
            }
        }
    }

    // Every carve goes through here. A Uint8Array row write past its length is
    // SILENTLY DROPPED, so an out-of-bounds carve would otherwise fail invisibly.
    _palladianCarveRect(dungeonGrid, x1, y1, x2, y2, value = 1) {
        for (let y = Math.max(0, y1); y <= Math.min(this.height - 1, y2); y++) {
            for (let x = Math.max(0, x1); x <= Math.min(this.width - 1, x2); x++) {
                if (dungeonGrid[y][x] < value) dungeonGrid[y][x] = value;
            }
        }
    }

    // Stage 3: room layout by concatenation.
    //
    // Start with one room per bay, then merge adjacent bays. The paper permits AT
    // MOST ONE non-rectangular room, and it must be bisected by the axis — that
    // room is the sanctum, and the constraint is enforced structurally: phase A
    // builds the one non-rectangular room, and phase B rejects any merge that
    // would create a second.
    //
    // Bays in a column share an x-span and bays in a row share a y-span, so a
    // bay-set that is a rectangle in GRID space is always a rectangle in TILE
    // space too. That equivalence is what makes the tartan grid pleasant to work
    // with: the rectangularity test is pure integer bookkeeping.
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
        // than the log of attempted merges. Union-find can make two bays
        // same-room transitively — merge A-B and B-C and A is now C's roommate
        // without A|C ever being an entry in the log — and a wall left standing
        // inside a room would read as a floating stub.
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const here = find(key(c, r));
                // East-west divider.
                if (c + 1 < nCols && find(key(c + 1, r)) === here) {
                    const wallX = plan.colX[c][1] + 1;
                    this._palladianCarveRect(dungeonGrid, wallX, plan.rowY[r][0], wallX, plan.rowY[r][1]);
                }
                // North-south divider.
                if (r + 1 < nRows && find(key(c, r + 1)) === here) {
                    const wallY = plan.rowY[r][1] + 1;
                    this._palladianCarveRect(dungeonGrid, plan.colX[c][0], wallY, plan.colX[c][1], wallY);
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
                this._palladianCarveRect(
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
            this._palladianCarveRect(dungeonGrid, spanX1, plan.bottom, spanX2, plan.bottom + depth);
            colonnadeY = plan.bottom + depth;
        } else {
            // In antis: the recess eats the southern part of the south-row axial
            // bay, which is exactly what the term means. Enclosing walls come free.
            this._palladianCarveRect(dungeonGrid, spanX1, plan.bottom - depth, spanX2, plan.bottom);
            colonnadeY = plan.bottom;
        }

        return { style, depth, spanX1, spanX2, colonnadeY, innerY: Math.min(this.height - 2, plan.bottom - 1) };
    }

    // Stage 6: the colonnade.
    //
    // Pushed to pendingWallSpawns AFTER _brogueFinalizeMap, so finalize's torch
    // pass can't convert a column into a brazier and its perimeter rule can't
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
        // Palladio never does this: the axis is always an intercolumniation. This
        // one rule is what makes the colonnade read as architecture, not a fence.
        if (n % 2 === 1) n--;
        if (n < 2) return;

        for (let i = 0; i < n; i++) {
            const x = spanX1 + Math.round((i * (span - 1)) / (n - 1));
            if (x === plan.axisX) continue;      // belt and braces
            this.pendingWallSpawns.push({ x, y: colonnadeY, type: 'column' });
        }
    }

    // Stage 7: windows, doors, and enfilade.
    //
    // This stage also delivers connectivity, so it is the one to be careful in.
    //
    // Doors are positioned BY ALIGNMENT, not randomly. Two registries hold the
    // sight-lines established so far, seeded from the exterior window centres;
    // each interior door prefers to reuse an existing line and only establishes a
    // new one when it must. That greedy rule is the whole enfilade mechanism: the
    // doors chain onto the window centres and you get a straight sight-line from
    // a window on one flank, through every intervening room, out the other side.
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
        // each side independently is how symmetry breaks: merges are mirrored, so
        // the two sides almost always agree, but "almost" leaves a lone door with
        // no counterpart on the far side of the villa.
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

    // Carve one opening and attribute it to the rooms on both sides. Doors are
    // recorded on BOTH adjoining rooms: addDoor is idempotent, every room needs at
    // least one door to be eligible for treasure rooms and switch puzzles, and
    // two-sided doors let gated-room puzzles pick a sensible gate tile.
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

    // 4-way flood fill over walkable cells. _brogueBFS is deliberately not reused:
    // it is a capped-distance point-to-point search that returns -1 for both
    // "unreachable" and "over budget", which is right for its loop heuristics and
    // useless for a connectivity check.
    _palladianFloodFill(dungeonGrid, sx, sy) {
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

    // The door pass covers every adjacency rather than a sample, so the plan should
    // already be connected — but verify rather than assume. An off-by-one in an
    // overlap, or an in-antis recess eating a bay's only opening, can still orphan
    // a room.
    _palladianEnsureConnected(dungeonGrid, plan, rooms, portico) {
        const mirrorX = (x) => 2 * plan.axisX - x;
        const start = portico
            ? { x: plan.axisX, y: portico.innerY }
            : { x: rooms[0].x1, y: rooms[0].y1 };

        for (let pass = 0; pass <= rooms.length; pass++) {
            const seen = this._palladianFloodFill(dungeonGrid, start.x, start.y);
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
                        // Mirror every repair. Skipping this would silently break the
                        // one invariant the generator exists to maintain; if the twin's
                        // room was already connected the extra opening is harmless.
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
    // _brogueMakeRoomRecord is reused rather than hand-rolled: its getLeft/getDoors/
    // addDoor shape is consumed by spawnTreasureRoom, _placeSwitchPuzzle_gatedRoom
    // and finalize's torch pass, and a second implementation would invite drift.
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
    // solid with opaque:false, so you can see through it but not walk through it —
    // exactly a barred window, and it keeps the villa's envelope sealed. Pushed
    // after finalize for the same reason as the colonnade.
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

        // The portico IS the villa's entrance, so that's where the stairs up belong —
        // arriving in the middle of an interior room reads as a mistake. Only a hint:
        // mechanics.up_stairway_region overrides it, and if the portico has no free
        // tile the engine falls back to the whole map.
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
        const totalWeight = wallTypes.reduce((sum, wt) => sum + wt.weight, 0);
        const isPerimeter = (px, py) => px === 0 || px === mapW - 1 || py === 0 || py === mapH - 1;

        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (floorSet.has(`${x},${y}`)) continue;
                const adj =
                    hasFloor(x - 1, y) || hasFloor(x + 1, y) ||
                    hasFloor(x, y - 1) || hasFloor(x, y + 1) ||
                    hasFloor(x - 1, y - 1) || hasFloor(x + 1, y - 1) ||
                    hasFloor(x - 1, y + 1) || hasFloor(x + 1, y + 1);

                if (adj && y > 0) {
                    this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    if (secretWallSet.has(`${x},${y}`)) {
                        this.pendingPushableWallSpawns.push({ x, y });
                    } else {
                        let roll = ROT.RNG.getUniform() * totalWeight;
                        let wallType = wallTypes[0].type;
                        for (const wt of wallTypes) {
                            roll -= wt.weight;
                            if (roll <= 0) { wallType = wt.type; break; }
                        }
                        this.pendingWallSpawns.push({ x, y, type: isPerimeter(x, y) ? 'metal_wall' : wallType });
                    }
                }
            }
        }

        // Fill perimeter gaps (same as digger)
        const pendingWallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (!isPerimeter(x, y)) continue;
                if (floorSet.has(`${x},${y}`)) continue;
                if (pendingWallSet.has(`${x},${y}`)) continue;
                const adj =
                    hasFloor(x - 1, y) || hasFloor(x + 1, y) ||
                    hasFloor(x, y - 1) || hasFloor(x, y + 1) ||
                    hasFloor(x - 1, y - 1) || hasFloor(x + 1, y - 1) ||
                    hasFloor(x - 1, y + 1) || hasFloor(x + 1, y + 1);
                if (adj) {
                    this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.pendingWallSpawns.push({ x, y, type: 'metal_wall' });
                }
            }
        }

        // Door spawns
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (dungeonGrid[y][x] === 2 && y > 0 && ROT.RNG.getPercentage() <= cfg.doorChance) {
                    this.pendingDoorSpawns.push({ x, y });
                }
            }
        }

        // Torch spawns per room
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
                const torchPos = roomWalls[Math.floor(ROT.RNG.getUniform() * roomWalls.length)];
                this.pendingTorchSpawns.push({ x: torchPos.x, y: torchPos.y });
                const idx = this.pendingWallSpawns.findIndex(p => p.x === torchPos.x && p.y === torchPos.y);
                if (idx !== -1) this.pendingWallSpawns.splice(idx, 1);
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

    addBaseAndShadows() {
        const BLACK_TILE = 217;
        const DARK_SHADE = 178;
        const SHADOW_DIAGONAL = 128;

        const hasFloor = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const floorTile = this.getTile('floor', x, y);
            return floorTile !== null && floorTile !== BLACK_TILE;
        };

        const bgEquals = (x, y, value) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            return this.getTile('background', x, y) === value;
        };

        const isFloorAbove = (x, y) => hasFloor(x, y - 1);
        const isFloorLeft = (x, y) => hasFloor(x - 1, y);
        const isFloorUpperLeft = (x, y) => hasFloor(x - 1, y - 1);
        const isDiagonalLeft = (x, y) => bgEquals(x - 1, y, SHADOW_DIAGONAL);
        const isDiagonalUpperLeft = (x, y) => bgEquals(x - 1, y - 1, SHADOW_DIAGONAL);
        const isDarkShadeAbove = (x, y) => bgEquals(x, y - 1, DARK_SHADE);

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (!bgEquals(x, y, BLACK_TILE)) continue;
                if (hasFloor(x, y)) continue;

                if (isFloorAbove(x, y) && (isFloorLeft(x, y) || !isFloorUpperLeft(x, y))) {
                    this.setTile('background', x, y, SHADOW_DIAGONAL);
                    continue;
                }

                if (isDiagonalUpperLeft(x, y) && isDarkShadeAbove(x, y)) {
                    this.setTile('background', x, y, SHADOW_DIAGONAL);
                    continue;
                }

                if (isDiagonalLeft(x, y) && (isFloorAbove(x, y) || isDarkShadeAbove(x, y))) {
                    let xPos = x;
                    while (xPos < this.width &&
                           bgEquals(xPos, y, BLACK_TILE) &&
                           !hasFloor(xPos, y) &&
                           (hasFloor(xPos, y - 1) || bgEquals(xPos, y - 1, DARK_SHADE))) {
                        this.setTile('background', xPos, y, DARK_SHADE);
                        xPos++;
                    }
                    continue;
                }
            }
        }
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    serializeMap() {
        return {
            width: this.width,
            height: this.height,
            floorMap: this.floorMap,
            wallMap: this.wallMap,
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
        this.wallMap = data.wallMap;
        this.backgroundMap = data.backgroundMap;
        this.wildcardMap = data.wildcardMap;
        this.overlayMap = data.overlayMap || this.createEmptyMap();
        this.walkableTiles = data.walkableTiles;
    }

    cleanup() {
        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wallMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.overlayMap = this.createEmptyMap();
        this.walkableTiles = [];
        this.pendingWallSpawns = [];
        this.pendingDoorSpawns = [];
        this.pendingTorchSpawns = [];
        this.pendingLavaSpawns = [];
        this.pendingLakeSpawns = [];
        this.pendingSewageSpawns = [];
        this.pendingPushableWallSpawns = [];
        this.pendingBridgeSpawns = [];
        this.pendingCollapsingFloorSpawns = [];
        this.diggerRooms = null;
        this.claimedRoomIndices = new Set();
        this.namedRegions = {};
        this.suggestedStairwayRegions = {};
        this.actorWildcardCache = null;
    }
}
