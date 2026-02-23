// ============================================================================
// ARCHITECT - Dungeon Generation System
// ============================================================================
// Handles map generation, loading, and terrain management

class Architect {
    constructor(options = {}) {
        // Default dimensions (will be updated when map loads)
        this.width = options.width || 30;
        this.height = options.height || 30;

        // Map layers
        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wallMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();

        // Traversal data
        this.walkableTiles = [];

        // Pending spawns (deferred until engine context is available)
        this.pendingWallSpawns = [];
        this.pendingDoorSpawns = [];
        this.pendingTorchSpawns = [];
        this.pendingLavaSpawns = [];

        // Tiled map metadata
        this.tileWidth = 16;
        this.tileHeight = 16;
        this.objectLayers = [];

        // Actor wildcard cache (built lazily)
        this.actorWildcardCache = null;

        // Room type registry (data-driven)
        this.roomTypes = new Map();
        this.registerDefaultRoomTypes();

        // Configuration
        this.config = {
            defaultFloorTileId: 158,
            ...options.config
        };
    }

    // ========================================================================
    // ROOM TYPE REGISTRY
    // ========================================================================

    /**
     * Register default room types including Brogue-inspired variants
     */
    registerDefaultRoomTypes() {
        // Rectangular room (existing default)
        this.registerRoomType('rectangular', {
            generator: (x, y, w, h, opts) => this.generateRectangularRoom(x, y, w, h, opts),
            minDepth: 1,
            maxDepth: Infinity,
            weight: 100,
            minSize: { w: 3, h: 3 },
            wildcardTileId: null  // Uses standard room wildcards (143, 144)
        });

        // Cross room - two overlapping rectangles (Brogue-inspired)
        this.registerRoomType('cross', {
            generator: (x, y, w, h, opts) => this.generateCrossRoom(x, y, w, h, opts),
            minDepth: 2,
            maxDepth: Infinity,
            weight: 30,
            minSize: { w: 7, h: 7 },
            wildcardTileId: null  // TODO: assign tile ID when added to tileset
        });

        // Circular room - ellipse fitted to region (Brogue-inspired)
        this.registerRoomType('circular', {
            generator: (x, y, w, h, opts) => this.generateCircularRoom(x, y, w, h, opts),
            minDepth: 3,
            maxDepth: Infinity,
            weight: 20,
            minSize: { w: 5, h: 5 },
            wildcardTileId: null  // TODO: assign tile ID when added to tileset
        });

        // Chunky room - organic blob using overlapping circles (Brogue-inspired)
        this.registerRoomType('chunky', {
            generator: (x, y, w, h, opts) => this.generateChunkyRoom(x, y, w, h, opts),
            minDepth: 4,
            maxDepth: Infinity,
            weight: 15,
            minSize: { w: 7, h: 7 },
            wildcardTileId: null  // TODO: assign tile ID when added to tileset
        });
    }

    /**
     * Register a new room type
     * @param {string} name - Unique identifier for the room type
     * @param {Object} config - Room type configuration
     */
    registerRoomType(name, config) {
        this.roomTypes.set(name, {
            name,
            generator: config.generator,
            minDepth: config.minDepth || 1,
            maxDepth: config.maxDepth || Infinity,
            weight: config.weight || 50,
            minSize: config.minSize || { w: 3, h: 3 },
            wildcardTileId: config.wildcardTileId || null
        });
    }

    /**
     * Get a room type by name
     * @param {string} name - Room type name
     * @returns {Object|null} Room type config or null
     */
    getRoomType(name) {
        return this.roomTypes.get(name) || null;
    }

    /**
     * Select a room type appropriate for the given depth
     * Uses weighted random selection from available types
     * @param {number} depth - Current dungeon depth (1-indexed)
     * @param {Object} region - Region size { width, height } for filtering
     * @returns {string} Selected room type name
     */
    selectRoomTypeForDepth(depth, region = {}) {
        const available = [];
        let totalWeight = 0;

        for (const [name, config] of this.roomTypes) {
            // Check depth range
            if (depth < config.minDepth || depth > config.maxDepth) continue;

            // Check minimum size requirements
            if (region.width && region.width < config.minSize.w) continue;
            if (region.height && region.height < config.minSize.h) continue;

            available.push({ name, config });
            totalWeight += config.weight;
        }

        if (available.length === 0) {
            return 'rectangular';  // Fallback
        }

        // Weighted random selection
        let roll = ROT.RNG.getUniform() * totalWeight;
        for (const { name, config } of available) {
            roll -= config.weight;
            if (roll <= 0) {
                return name;
            }
        }

        return 'rectangular';  // Fallback
    }

    // ========================================================================
    // BROGUE-INSPIRED ROOM GENERATORS
    // ========================================================================

    /**
     * Generate a rectangular room (default)
     * Returns floor positions; wall detection happens in generateRoomAt
     */
    generateRectangularRoom(startX, startY, width, height, options = {}) {
        const floorTiles = [];
        const wallTiles = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const worldX = startX + x;
                const worldY = startY + y;
                const isPerimeter = (x === 0 || x === width - 1 || y === 0 || y === height - 1);

                if (isPerimeter) {
                    wallTiles.push({ x: worldX, y: worldY });
                } else {
                    floorTiles.push({ x: worldX, y: worldY });
                }
            }
        }

        return { floorTiles, wallTiles };
    }

    /**
     * Generate a cross-shaped room (two overlapping rectangles)
     *
     */
    generateCrossRoom(startX, startY, width, height, options = {}) {
        const floorTiles = [];
        const floorSet = new Set();

        // Horizontal bar: full width, ~40% of height, centered
        const hBarHeight = Math.max(3, Math.floor(height * 0.4));
        const hBarY = Math.floor((height - hBarHeight) / 2);

        // Vertical bar: ~40% of width, full height, centered
        const vBarWidth = Math.max(3, Math.floor(width * 0.4));
        const vBarX = Math.floor((width - vBarWidth) / 2);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const inHBar = y >= hBarY && y < hBarY + hBarHeight;
                const inVBar = x >= vBarX && x < vBarX + vBarWidth;

                if (inHBar || inVBar) {
                    const worldX = startX + x;
                    const worldY = startY + y;
                    const key = `${worldX},${worldY}`;
                    if (!floorSet.has(key)) {
                        floorSet.add(key);
                        floorTiles.push({ x: worldX, y: worldY });
                    }
                }
            }
        }

        return { floorTiles, wallTiles: [] };
    }

    /**
     * Generate a circular/elliptical room
     */
    generateCircularRoom(startX, startY, width, height, options = {}) {
        const floorTiles = [];
        const centerX = width / 2;
        const centerY = height / 2;
        const radiusX = (width / 2) - 1;
        const radiusY = (height / 2) - 1;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Ellipse equation: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
                const nx = (x - centerX) / radiusX;
                const ny = (y - centerY) / radiusY;

                if (nx * nx + ny * ny <= 1) {
                    floorTiles.push({ x: startX + x, y: startY + y });
                }
            }
        }

        return { floorTiles, wallTiles: [] };
    }

    /**
     * Generate a chunky/organic room using overlapping circles
     */
    generateChunkyRoom(startX, startY, width, height, options = {}) {
        const floorTiles = [];
        const floorSet = new Set();

        // Generate 3-5 overlapping circles
        const numBlobs = 3 + Math.floor(ROT.RNG.getUniform() * 3);
        const centerX = width / 2;
        const centerY = height / 2;

        for (let i = 0; i < numBlobs; i++) {
            // Random center within region, biased toward center
            const blobX = centerX + (ROT.RNG.getUniform() - 0.5) * width * 0.6;
            const blobY = centerY + (ROT.RNG.getUniform() - 0.5) * height * 0.6;
            const radius = 2 + Math.floor(ROT.RNG.getUniform() * Math.min(width, height) * 0.25);

            // Fill circle
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (dx * dx + dy * dy <= radius * radius) {
                        const tx = Math.floor(blobX + dx);
                        const ty = Math.floor(blobY + dy);

                        // Check bounds
                        if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
                            const worldX = startX + tx;
                            const worldY = startY + ty;
                            const key = `${worldX},${worldY}`;

                            if (!floorSet.has(key)) {
                                floorSet.add(key);
                                floorTiles.push({ x: worldX, y: worldY });
                            }
                        }
                    }
                }
            }
        }

        return { floorTiles, wallTiles: [] };
    }

    // ========================================================================
    // MAP LAYER MANAGEMENT
    // ========================================================================

    createEmptyMap() {
        return Array.from({ length: this.height }, () =>
            Array.from({ length: this.width }, () => null)
        );
    }

    /**
     * Get a map layer by name
     * @param {string} layerName - 'background', 'floor', 'wall', or 'wildcard'
     * @returns {Array|null} The 2D map array or null if invalid
     */
    getLayer(layerName) {
        const layers = {
            'background': this.backgroundMap,
            'floor': this.floorMap,
            'wall': this.wallMap,
            'wildcard': this.wildcardMap
        };
        return layers[layerName] || null;
    }

    /**
     * Get tile ID at position on a layer
     * @param {string} layerName - Layer to query
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {number|null} Tile ID or null if empty/out of bounds
     */
    getTile(layerName, x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return null;
        }
        const layer = this.getLayer(layerName);
        if (!layer) return null;

        const tile = layer[y][x];
        return tile ? tile.tileId : null;
    }

    /**
     * Set tile ID at position on a layer
     * @param {string} layerName - Layer to modify
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number|null} tileId - Tile ID to set, or null to clear
     */
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
     * Get neighboring tile IDs (8-directional)
     * @param {string} layerName - Layer to query
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object} Object with n, s, e, w, ne, nw, se, sw tile IDs (null if empty/OOB)
     */
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

    /**
     * Iterate over all tiles in a layer
     * @param {string} layerName - Layer to iterate
     * @param {Function} callback - Called with (x, y, tileId) for each tile
     * @param {boolean} includeEmpty - If true, calls callback for empty tiles too (default false)
     */
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

            // Store map dimensions
            this.width = tiledData.width;
            this.height = tiledData.height;

            // Store tileset info for converting IDs
            this.tileWidth = tiledData.tilewidth;
            this.tileHeight = tiledData.tileheight;

            // Recreate maps with correct dimensions
            this.backgroundMap = this.createEmptyMap();
            this.floorMap = this.createEmptyMap();
            this.wallMap = this.createEmptyMap();
            this.wildcardMap = this.createEmptyMap();

            // Store object layers for entity spawning
            this.objectLayers = [];

            console.log(`Map dimensions: ${this.width}x${this.height}`);

            // Process layers
            for (const layer of tiledData.layers) {
                if (layer.type === 'tilelayer') {
                    if (layer.name === 'floor' && !options.skipFloorLayer) {
                        this.processFloorLayer(layer);
                    } else if (layer.name === 'background') {
                        this.processBackgroundLayer(layer);
                    } else if (layer.name === 'wildcards' && !options.skipFloorLayer) {
                        // Skip wildcards too when skipping floor (labyrinth mode)
                        console.log('Found wildcards layer, processing...');
                        this.processWildcardLayer(layer);
                    }
                } else if (layer.type === 'objectgroup') {
                    // Store object layers for later processing
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

    processBackgroundLayer(layer) {
        console.log('Processing background layer...');
        for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
                const index = y * layer.width + x;
                const tileId = layer.data[index];

                if (tileId > 0) {
                    this.backgroundMap[y][x] = { tileId, layer: 'background' };
                }
            }
        }
    }

    processFloorLayer(layer) {
        console.log('Processing floor layer...');
        for (let y = 0; y < layer.height; y++) {
            for (let x = 0; x < layer.width; x++) {
                const index = y * layer.width + x;
                const tileId = layer.data[index];

                if (tileId > 0) {
                    // Floor layer takes priority - clear background behind it
                    this.floorMap[y][x] = { tileId, layer: 'floor' };
                    this.backgroundMap[y][x] = null;
                    // Track as walkable
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
                const tileId = layer.data[index];

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

    /**
     * Map tile IDs to wildcard types
     * @param {number} tileId - Tile ID from Tiled
     * @param {Object} context - Optional context for actor wildcard lookup
     * @returns {string} Wildcard type
     */
    getWildcardType(tileId, context = null) {
        // Map tile IDs to wildcard types (built-in procedural types)
        // Tile IDs are 1-indexed (Tiled format): y * 23 + x + 1
        const builtinWildcards = {
            210: 'maze',
            9: 'dungeon',    // OPAQUE_INVERSE_DIAMOND_SUITE [8,0] - ROT.js Digger dungeon with walls and doors
            16: 'dungeon',   // PRISON_WINDOW [15,0] - ROT.js Digger rooms + corridors
            152: 'dungeon',  // OPAQUE_PRISON_WINDOW - ROT.js Digger rooms + corridors
            10: 'cave',      // INVERSE_BULLET [9,0] - Cellular automata cave generation
            11: 'infernal',  // INVERSE_WHITE_CIRCLE [10,0] - Cave with lava pools
            143: 'room',
            144: 'room',
            12: 'item_spawn',
            3: 'actor_spawn'
        };

        if (builtinWildcards[tileId]) {
            return builtinWildcards[tileId];
        }

        // Check actor wildcard_tile attributes (requires context)
        if (context) {
            const actorType = this.getActorWildcardType(tileId, context);
            if (actorType) {
                return actorType;
            }
        }

        return 'unknown';
    }

    /**
     * Build lookup of tileId -> actorType from wildcard_tile attributes
     * Cached for performance
     * @param {number} tileId - Tile ID to look up
     * @param {Object} context - Context with getActorData and getTileIdByName
     * @returns {string|null} Actor type or null
     */
    getActorWildcardType(tileId, context) {
        if (!context || !context.getPrototypeActors || !context.getTileIdByName) {
            return null;
        }

        // Build cache if not exists
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

    /**
     * Clear the actor wildcard cache (call when prototype changes)
     */
    clearWildcardCache() {
        this.actorWildcardCache = null;
    }

    /**
     * Re-resolve wildcards that were marked 'unknown' during loadTiledMap
     * Called when context becomes available during processWildcards
     * @param {Object} context - Context with actor data access
     */
    resolveUnknownWildcards(context) {
        let resolvedCount = 0;
        const typeCounts = {};

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const wildcard = this.wildcardMap[y][x];
                if (wildcard && wildcard.type === 'unknown') {
                    // Try to resolve with context
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
    // PROCEDURAL MAP GENERATION
    // ========================================================================

    generateProceduralMap(generatorConfig = {}) {
        const generatorType = generatorConfig.type || 'digger';
        const options = generatorConfig.options || {};

        // Allow map dimensions from config
        if (options.map_width) this.width = options.map_width;
        if (options.map_height) this.height = options.map_height;

        // Recreate maps with new dimensions
        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wallMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.walkableTiles = [];

        console.log(`Generating procedural map with ${generatorType} generator (${this.width}x${this.height})`);

        let generator;

        switch (generatorType) {
            case 'cellular': {
                // Cave-like maps using cellular automata
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
                // Queue wall spawns
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
                // Infernal caves: cellular automata with lava pools
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

                // Generate lava pools
                const lavaChance = options.lava_chance || 15;
                const lavaCave = new ROT.Map.Cellular(this.width, this.height, {
                    born: [4, 5, 6, 7, 8],
                    survive: [3, 4, 5, 6, 7, 8],
                    topology: 8
                });

                lavaCave.randomize(lavaChance / 100);
                lavaCave.create();

                const lavaPositions = [];

                lavaCave.create((x, y, value) => {
                    if (value === 0) return;
                    if (!infernalFloorTiles.has(`${x},${y}`)) return;
                    lavaPositions.push({ x, y });
                });

                const lavaSet = new Set(lavaPositions.map(p => `${p.x},${p.y}`));
                this.walkableTiles = this.walkableTiles.filter(t => !lavaSet.has(`${t.x},${t.y}`));

                // Queue wall spawns
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

                this.pendingLavaSpawns.push(...lavaPositions);

                console.log(`Infernal map generated: ${infernalFloorTiles.size} floor tiles, ${lavaPositions.length} lava tiles`);
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

                // Queue wall spawns for non-floor tiles adjacent to floors
                const diggerWallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];
                const diggerTotalWeight = diggerWallTypes.reduce((sum, wt) => sum + wt.weight, 0);

                const hasDiggerFloor = (fx, fy) => diggerFloorTiles.has(`${fx},${fy}`);

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (diggerFloorTiles.has(`${x},${y}`)) continue;

                        // Check if adjacent to any floor (8-directional)
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
                            // Place floor under wall
                            this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                            this.pendingWallSpawns.push({ x, y, type: wallType });
                        }
                    }
                }

                // Also spawn doors and torches from rooms
                const rooms = generator.getRooms();
                const wallPositions = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));

                for (const room of rooms) {
                    // Doors at room connections
                    room.getDoors((x, y) => {
                        if (y > 0 && ROT.RNG.getPercentage() <= 50) {
                            this.pendingDoorSpawns.push({ x, y });
                        }
                    });

                    // 30% chance for brazier in room
                    if (ROT.RNG.getPercentage() <= 30) {
                        const roomWalls = [];
                        const left = room.getLeft();
                        const right = room.getRight();
                        const top = room.getTop();
                        const bottom = room.getBottom();

                        // Find walls on room perimeter
                        for (const wallPos of this.pendingWallSpawns) {
                            if (wallPos.x >= left - 1 && wallPos.x <= right + 1 &&
                                wallPos.y >= top - 1 && wallPos.y <= bottom + 1) {
                                roomWalls.push(wallPos);
                            }
                        }

                        if (roomWalls.length > 0) {
                            const torchPos = roomWalls[Math.floor(ROT.RNG.getUniform() * roomWalls.length)];
                            this.pendingTorchSpawns.push({ x: torchPos.x, y: torchPos.y });
                            // Remove from wall spawns
                            const idx = this.pendingWallSpawns.findIndex(p => p.x === torchPos.x && p.y === torchPos.y);
                            if (idx !== -1) this.pendingWallSpawns.splice(idx, 1);
                        }
                    }
                }

                console.log(`Digger map: ${diggerFloorTiles.size} floors, ${this.pendingWallSpawns.length} walls, ${this.pendingDoorSpawns.length} doors, ${this.pendingTorchSpawns.length} torches`);
                break;
            }
        }

        console.log(`Procedural map generated with ${this.walkableTiles.length} walkable tiles`);
    }

    // ========================================================================
    // WILDCARD PROCESSING
    // ========================================================================

    async processWildcards(context = null) {
        // Re-resolve 'unknown' wildcards now that we have context
        // This handles actor wildcards that couldn't be resolved during loadTiledMap
        if (context) {
            this.resolveUnknownWildcards(context);
        }

        // Find all wildcard regions first
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

        // Process mazes first, then rooms (so rooms can detect maze intersections)
        const mazes = regions.filter(r => r.type === 'maze');
        const rooms = regions.filter(r => r.type === 'room');
        const others = regions.filter(r => r.type !== 'maze' && r.type !== 'room');

        for (const { region, type } of [...mazes, ...rooms, ...others]) {
            await this.generateWildcardContent(region, type, context);
        }
    }

    findWildcardRegion(startX, startY, type, processed) {
        // Find bounding box of contiguous wildcard tiles of the same type
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

            // Check 4-connected neighbors
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
            case 'item_spawn':
                // Spawn random item - handled by engine
                break;
            case 'actor_spawn':
                // Spawn random actor - handled by engine
                break;
            default:
                // Check if this is an actor type from wildcard_tile attribute
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

        // Find wall positions
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

        // Get doors and torches from rooms
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

        // Generate lava pools
        const lavaChance = mapGenConfig.lava_chance || 15;
        const lavaCave = new ROT.Map.Cellular(width, height, {
            born: [4, 5, 6, 7, 8],
            survive: [3, 4, 5, 6, 7, 8],
            topology: 8
        });

        lavaCave.randomize(lavaChance / 100);
        lavaCave.create();

        const lavaPositions = [];

        lavaCave.create((x, y, value) => {
            if (value === 0) return;

            const worldX = startX + x;
            const worldY = startY + y;

            if (worldX >= this.width || worldY >= this.height) return;

            const wildcard = this.wildcardMap[worldY][worldX];
            if (!wildcard || wildcard.type !== 'infernal') return;

            if (!floorCells.has(`${x},${y}`)) return;

            lavaPositions.push({ x: worldX, y: worldY });
        });

        const lavaSet = new Set(lavaPositions.map(p => `${p.x},${p.y}`));

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

        this.walkableTiles = this.walkableTiles.filter(t => !lavaSet.has(`${t.x},${t.y}`));

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

        this.pendingLavaSpawns.push(...lavaPositions);

        console.log(`Infernal cave generated: ${floorCells.size} floor tiles, ${wallPositions.length} walls, ${lavaPositions.length} lava`);
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
                    } else if (isPerimeter && hasAdjacentMazePath) {
                        this.floorMap[worldY][worldX] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.walkableTiles.push({ x: worldX, y: worldY });
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
    // ENTITY SPAWNING (Context-Dependent)
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
            // Skip if there's a stairway at this position (keep stairways visible)
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
     * Add diagonal shadow beneath floor tiles
     * Creates the appearance of a base with hard diagonal shadow
     */
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

    serializeMap() {
        return {
            floorMap: this.floorMap,
            walkableTiles: this.walkableTiles
        };
    }

    deserializeMap(data) {
        this.floorMap = data.floorMap;
        this.walkableTiles = data.walkableTiles;
    }

    cleanup() {
        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wallMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.walkableTiles = [];
        this.pendingWallSpawns = [];
        this.pendingDoorSpawns = [];
        this.pendingTorchSpawns = [];
        this.pendingLavaSpawns = [];
        this.actorWildcardCache = null;
    }
}
