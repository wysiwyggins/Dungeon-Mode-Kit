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
        this.diggerRooms = null;

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
            const frontier = [seed];
            const visited = new Set([seed]);

            while (blob.length < targetSize && frontier.length > 0) {
                const idx = Math.floor(ROT.RNG.getUniform() * frontier.length);
                const cell = frontier.splice(idx, 1)[0];

                if (!expandableSet.has(cell)) continue;

                blob.push(cell);
                expandableSet.delete(cell);
                walkableSet.delete(cell);

                const [cx, cy] = cell.split(',').map(Number);
                const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
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

    // ========================================================================
    // TREASURE ROOM
    // ========================================================================

    spawnTreasureRoom() {
        if (!this.diggerRooms || this.diggerRooms.length === 0) {
            return null;
        }

        const eligibleRooms = this.diggerRooms.filter(room => {
            let count = 0;
            room.getDoors(() => count++);
            return count > 0;
        });

        if (eligibleRooms.length === 0) {
            return null;
        }

        const treasureRoom = eligibleRooms[Math.floor(ROT.RNG.getUniform() * eligibleRooms.length)];

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

        console.log(`Treasure room: ${roomTiles.length} floor tiles, locked door at (${chosenDoor.x}, ${chosenDoor.y}), ${allEntrances.length - 1} extra entrance(s) walled off`);
        return { roomTiles, doorPos: chosenDoor };
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
        this.diggerRooms = null;
        this.actorWildcardCache = null;
    }
}
