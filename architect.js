// ============================================================================
// ARCHITECT - Dungeon Generation System
// ============================================================================
// Handles map generation, loading, and terrain management

const TILED_FLIP_MASK = 0x1FFFFFFF; // Strips top 3 bits (flip/rotation flags)
const TILED_FLIP_H = 0x80000000;    // Bit 31: horizontal flip
const TILED_FLIP_V = 0x40000000;    // Bit 30: vertical flip
const TILED_FLIP_D = 0x20000000;    // Bit 29: diagonal flip

class ShapedRoom {
    constructor(floorTiles, doorPositions = []) {
        this._doors = doorPositions;
        this._left = Infinity;
        this._right = -Infinity;
        this._top = Infinity;
        this._bottom = -Infinity;
        for (const t of floorTiles) {
            if (t.x < this._left) this._left = t.x;
            if (t.x > this._right) this._right = t.x;
            if (t.y < this._top) this._top = t.y;
            if (t.y > this._bottom) this._bottom = t.y;
        }
    }
    getLeft() { return this._left; }
    getRight() { return this._right; }
    getTop() { return this._top; }
    getBottom() { return this._bottom; }
    getDoors(cb) {
        for (const d of this._doors) cb(d.x, d.y);
    }
}

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
        this.overlayMap = this.createEmptyMap();

        // Traversal data
        this.walkableTiles = [];

        // Pending spawns (deferred until engine context is available)
        this.pendingWallSpawns = [];
        this.pendingDoorSpawns = [];
        this.pendingTorchSpawns = [];
        this.pendingLavaSpawns = [];
        this.pendingLakeSpawns = [];
        this.pendingSewageSpawns = [];
        this.pendingPushableWallSpawns = [];
        this.pendingFungusSpawns = [];
        this.pendingBridgeSpawns = [];
        this.diggerRooms = null;

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
        this.registerRoomType('rectangular', {
            generator: (x, y, w, h, opts) => this.generateRectangularRoom(x, y, w, h, opts),
            minDepth: 1,
            maxDepth: Infinity,
            weight: 100,
            minSize: { w: 3, h: 3 },
            depthScale: { start: 1.5, end: 0.5 }
        });

        this.registerRoomType('cross', {
            generator: (x, y, w, h, opts) => this.generateCrossRoom(x, y, w, h, opts),
            minDepth: 2,
            maxDepth: Infinity,
            weight: 30,
            minSize: { w: 7, h: 7 },
            depthScale: { start: 1.3, end: 0.7 }
        });

        this.registerRoomType('circular', {
            generator: (x, y, w, h, opts) => this.generateCircularRoom(x, y, w, h, opts),
            minDepth: 3,
            maxDepth: Infinity,
            weight: 20,
            minSize: { w: 5, h: 5 },
            depthScale: { start: 1.0, end: 1.0 }
        });

        this.registerRoomType('chunky', {
            generator: (x, y, w, h, opts) => this.generateChunkyRoom(x, y, w, h, opts),
            minDepth: 4,
            maxDepth: Infinity,
            weight: 15,
            minSize: { w: 7, h: 7 },
            depthScale: { start: 0.3, end: 2.0 }
        });

        this.registerRoomType('donut', {
            generator: (x, y, w, h, opts) => this.generateDonutRoom(x, y, w, h, opts),
            minDepth: 3,
            maxDepth: Infinity,
            weight: 8,
            minSize: { w: 11, h: 11 },
            depthScale: { start: 0.5, end: 1.5 }
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
            wildcardTileId: config.wildcardTileId || null,
            depthScale: config.depthScale || null
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
        const maxScaleDepth = 25;
        const t = Math.min(1, (depth - 1) / maxScaleDepth);

        for (const [name, config] of this.roomTypes) {
            if (depth < config.minDepth || depth > config.maxDepth) continue;
            if (region.width && region.width < config.minSize.w) continue;
            if (region.height && region.height < config.minSize.h) continue;

            let effectiveWeight = config.weight;
            if (config.depthScale) {
                const scale = config.depthScale.start + (config.depthScale.end - config.depthScale.start) * t;
                effectiveWeight = config.weight * scale;
            }

            available.push({ name, weight: effectiveWeight });
            totalWeight += effectiveWeight;
        }

        if (available.length === 0) {
            return 'rectangular';
        }

        let roll = ROT.RNG.getUniform() * totalWeight;
        for (const { name, weight } of available) {
            roll -= weight;
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

    generateDonutRoom(startX, startY, width, height, options = {}) {
        const floorTiles = [];
        const wallTiles = [];
        const centerX = width / 2;
        const centerY = height / 2;
        const outerRX = (width / 2) - 1;
        const outerRY = (height / 2) - 1;
        const ringWidth = 3;
        const innerRX = Math.max(1, outerRX - ringWidth);
        const innerRY = Math.max(1, outerRY - ringWidth);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const nx = (x - centerX) / outerRX;
                const ny = (y - centerY) / outerRY;
                if (nx * nx + ny * ny > 1) continue;

                const inx = (x - centerX) / innerRX;
                const iny = (y - centerY) / innerRY;
                if (inx * inx + iny * iny <= 1) {
                    wallTiles.push({ x: startX + x, y: startY + y });
                } else {
                    floorTiles.push({ x: startX + x, y: startY + y });
                }
            }
        }

        return { floorTiles, wallTiles };
    }

    // ========================================================================
    // GENERATION UTILITIES
    // ========================================================================

    createBlob(minWidth, maxWidth, minHeight, maxHeight, percentSeeded = 55, iterations = 5) {
        const maxRetries = 20;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const grid = Array.from({ length: maxHeight }, () =>
                Array.from({ length: maxWidth }, () => false)
            );

            for (let y = 0; y < maxHeight; y++) {
                for (let x = 0; x < maxWidth; x++) {
                    grid[y][x] = ROT.RNG.getPercentage() <= percentSeeded;
                }
            }

            // born: [5,6,7,8], survive: [4,5,6,7,8]
            for (let i = 0; i < iterations; i++) {
                const next = Array.from({ length: maxHeight }, () =>
                    Array.from({ length: maxWidth }, () => false)
                );
                for (let y = 0; y < maxHeight; y++) {
                    for (let x = 0; x < maxWidth; x++) {
                        let neighbors = 0;
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                if (dx === 0 && dy === 0) continue;
                                const nx = x + dx, ny = y + dy;
                                if (nx >= 0 && nx < maxWidth && ny >= 0 && ny < maxHeight && grid[ny][nx]) {
                                    neighbors++;
                                }
                            }
                        }
                        if (grid[y][x]) {
                            next[y][x] = neighbors >= 4;
                        } else {
                            next[y][x] = neighbors >= 5;
                        }
                    }
                }
                for (let y = 0; y < maxHeight; y++) {
                    for (let x = 0; x < maxWidth; x++) {
                        grid[y][x] = next[y][x];
                    }
                }
            }

            // Find the largest connected region via flood fill
            const labels = Array.from({ length: maxHeight }, () =>
                Array.from({ length: maxWidth }, () => 0)
            );
            let labelId = 0;
            let bestLabel = 0;
            let bestSize = 0;

            for (let y = 0; y < maxHeight; y++) {
                for (let x = 0; x < maxWidth; x++) {
                    if (grid[y][x] && labels[y][x] === 0) {
                        labelId++;
                        let size = 0;
                        const queue = [{ x, y }];
                        labels[y][x] = labelId;
                        while (queue.length > 0) {
                            const pos = queue.shift();
                            size++;
                            const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
                            for (const [dx, dy] of dirs) {
                                const nx = pos.x + dx, ny = pos.y + dy;
                                if (nx >= 0 && nx < maxWidth && ny >= 0 && ny < maxHeight &&
                                    grid[ny][nx] && labels[ny][nx] === 0) {
                                    labels[ny][nx] = labelId;
                                    queue.push({ x: nx, y: ny });
                                }
                            }
                        }
                        if (size > bestSize) {
                            bestSize = size;
                            bestLabel = labelId;
                        }
                    }
                }
            }

            // Extract largest blob and compute bounding box
            let blobMinX = maxWidth, blobMaxX = 0, blobMinY = maxHeight, blobMaxY = 0;
            const blobGrid = Array.from({ length: maxHeight }, () =>
                Array.from({ length: maxWidth }, () => false)
            );

            for (let y = 0; y < maxHeight; y++) {
                for (let x = 0; x < maxWidth; x++) {
                    if (labels[y][x] === bestLabel) {
                        blobGrid[y][x] = true;
                        if (x < blobMinX) blobMinX = x;
                        if (x > blobMaxX) blobMaxX = x;
                        if (y < blobMinY) blobMinY = y;
                        if (y > blobMaxY) blobMaxY = y;
                    }
                }
            }

            const blobWidth = blobMaxX - blobMinX + 1;
            const blobHeight = blobMaxY - blobMinY + 1;

            if (blobWidth >= minWidth && blobHeight >= minHeight) {
                return {
                    grid: blobGrid,
                    width: blobWidth,
                    height: blobHeight,
                    offsetX: blobMinX,
                    offsetY: blobMinY,
                    size: bestSize
                };
            }
        }

        return null;
    }

    floodFill(startX, startY, isPassable, width, height) {
        const visited = new Set();
        const key = `${startX},${startY}`;
        if (!isPassable(startX, startY)) return visited;

        const queue = [{ x: startX, y: startY }];
        visited.add(key);

        while (queue.length > 0) {
            const pos = queue.shift();
            const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
            for (const [dx, dy] of dirs) {
                const nx = pos.x + dx, ny = pos.y + dy;
                const nk = `${nx},${ny}`;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height &&
                    !visited.has(nk) && isPassable(nx, ny)) {
                    visited.add(nk);
                    queue.push({ x: nx, y: ny });
                }
            }
        }

        return visited;
    }

    checkConnectivity(walkableSet, excludeSet) {
        let startKey = null;
        for (const key of walkableSet) {
            if (!excludeSet.has(key)) {
                startKey = key;
                break;
            }
        }
        if (!startKey) return true;

        const [sx, sy] = startKey.split(',').map(Number);
        const reachable = this.floodFill(
            sx, sy,
            (x, y) => {
                const k = `${x},${y}`;
                return walkableSet.has(k) && !excludeSet.has(k);
            },
            this.width, this.height
        );

        let expectedCount = 0;
        for (const key of walkableSet) {
            if (!excludeSet.has(key)) expectedCount++;
        }

        return reachable.size === expectedCount;
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
            'wildcard': this.wildcardMap,
            'overlay': this.overlayMap
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
            this.overlayMap = this.createEmptyMap();

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
                    } else if (layer.name === 'overlay') {
                        this.processOverlayLayer(layer);
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
                    // Floor layer takes priority - clear background behind it
                    this.floorMap[y][x] = { tileId, layer: 'floor', flipH, flipV, flipD };
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
            230: 'infernal', // OPAQUE_LIGHT_SHADE_UPPER_RIGHT_TRIANGLE_AND_OPAQUE_DARK_SHADE_BOTTOM_LEFT_TRIANGLE [22,9] - Cave with lava pools
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

    generateProceduralMap(generatorConfig = {}, depth = 1) {
        const generatorType = generatorConfig.type || 'digger';
        const options = generatorConfig.options || {};
        options.depth = depth;

        // Allow map dimensions from config
        if (options.map_width) this.width = options.map_width;
        if (options.map_height) this.height = options.map_height;

        // Recreate maps with new dimensions
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

            case 'shaped': {
                this.generateShapedMap(options);
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

                // Convert perimeter walls to indestructible metal_wall
                // and add metal_wall for any perimeter tile adjacent to a floor
                const isPerimeter = (px, py) =>
                    px === 0 || px === this.width - 1 || py === 0 || py === this.height - 1;

                // Retype existing perimeter wall spawns
                for (const wall of this.pendingWallSpawns) {
                    if (isPerimeter(wall.x, wall.y)) {
                        wall.type = 'metal_wall';
                    }
                }

                // Add metal_wall for perimeter tiles adjacent to floors that weren't queued
                // (e.g. y=0 row is skipped by the wall loop above)
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

                // Also spawn doors and torches from rooms
                const rooms = generator.getRooms();
                this.diggerRooms = rooms;  // saved for treasure room feature
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

        // Generate blob-shaped lakes with connectivity validation
        this.generateBlobLakes(options);

        // Generate random sewage patches on walkable floor tiles
        const sewageChance = options.sewage_chance || 0;
        if (sewageChance > 0) {
            const sewageCave = new ROT.Map.Cellular(this.width, this.height, {
                born: [5, 6, 7, 8],
                survive: [4, 5, 6, 7, 8],
                topology: 8
            });

            sewageCave.randomize(sewageChance / 100);
            sewageCave.create();
            sewageCave.create();

            const sewagePositions = [];
            const walkableSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));

            sewageCave.create((x, y, value) => {
                if (value === 0) return;
                if (!walkableSet.has(`${x},${y}`)) return;
                sewagePositions.push({ x, y });
            });

            this.pendingSewageSpawns.push(...sewagePositions);
            console.log(`Sewage generation: ${sewagePositions.length} sewage tiles`);
        }

        // Generate fungus patches on walkable floor tiles
        const fungusChance = options.fungus_chance || 0;
        if (fungusChance > 0) {
            const fungusCave = new ROT.Map.Cellular(this.width, this.height, {
                born: [5, 6, 7, 8],
                survive: [4, 5, 6, 7, 8],
                topology: 8
            });

            fungusCave.randomize(fungusChance / 100);
            fungusCave.create();
            fungusCave.create();

            const fungusPositions = [];
            const walkableSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
            const lakeSet = new Set(this.pendingLakeSpawns.map(p => `${p.x},${p.y}`));
            const lavaSet = new Set(this.pendingLavaSpawns.map(p => `${p.x},${p.y}`));

            fungusCave.create((x, y, value) => {
                if (value === 0) return;
                const key = `${x},${y}`;
                if (!walkableSet.has(key)) return;
                if (lakeSet.has(key) || lavaSet.has(key)) return;
                fungusPositions.push({ x, y });
            });

            this.pendingFungusSpawns.push(...fungusPositions);
            console.log(`Fungus generation: ${fungusPositions.length} fungus tiles`);
        }

        // Add secondary connections (loops) through walls separating distant floor regions
        this.addSecondaryConnections(options);

        // Generate rope bridges across liquid bodies
        this.generateRopeBridges(options);

        // Scatter a few pushable walls among normal walls
        if (this.pendingWallSpawns.length > 0) {
            const converted = [];
            for (let i = this.pendingWallSpawns.length - 1; i >= 0; i--) {
                const wall = this.pendingWallSpawns[i];
                // Only convert normal walls, not metal_wall or special types
                if (wall.type && wall.type !== 'wall') continue;
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

        // Fill background with void tiles where there is no floor,
        // so destroying or pushing walls reveals black instead of blank canvas
        const VOID_TILE = 217;
        const floorSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (!floorSet.has(`${x},${y}`)) {
                    this.backgroundMap[y][x] = { tileId: VOID_TILE, layer: 'background' };
                }
            }
        }

        console.log(`Procedural map generated with ${this.walkableTiles.length} walkable tiles`);
    }

    generateBlobLakes(options) {
        const lakesConfig = options.lakes;
        const legacyChance = options.lake_chance || 0;

        if (!lakesConfig && legacyChance <= 0) return;

        // Normalize config
        let count, types, minSize, maxSize;
        if (lakesConfig) {
            count = lakesConfig.count || [1, 2];
            types = lakesConfig.types || ['water'];
            minSize = lakesConfig.minSize || 15;
            maxSize = lakesConfig.maxSize || 100;
        } else {
            // Legacy: convert lake_chance to blob config
            count = [1, Math.max(1, Math.floor(legacyChance / 5))];
            types = ['water'];
            minSize = 15;
            maxSize = Math.min(150, legacyChance * 3);
        }

        const numLakes = count[0] + Math.floor(ROT.RNG.getUniform() * (count[1] - count[0] + 1));
        const walkableSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));

        // Decreasing blob sizes for each successive lake
        const baseBlobW = Math.min(30, Math.floor(this.width * 0.4));
        const baseBlobH = Math.min(15, Math.floor(this.height * 0.3));
        const allLakeTiles = new Set();

        for (let l = 0; l < numLakes; l++) {
            const scaleFactor = Math.max(0.5, 1 - l * 0.15);
            const blobMaxW = Math.max(8, Math.floor(baseBlobW * scaleFactor));
            const blobMaxH = Math.max(6, Math.floor(baseBlobH * scaleFactor));
            const blobMinW = Math.max(4, Math.floor(blobMaxW * 0.3));
            const blobMinH = Math.max(3, Math.floor(blobMaxH * 0.3));

            const blob = this.createBlob(blobMinW, blobMaxW, blobMinH, blobMaxH);
            if (!blob) continue;

            // Try up to 20 placements
            let placed = false;
            for (let attempt = 0; attempt < 20; attempt++) {
                const placeX = 2 + Math.floor(ROT.RNG.getUniform() * (this.width - blob.width - 4));
                const placeY = 2 + Math.floor(ROT.RNG.getUniform() * (this.height - blob.height - 4));

                // Check all blob tiles overlap walkable and aren't already a lake
                const lakeTiles = new Set();
                let valid = true;
                for (let by = 0; by < blob.height; by++) {
                    for (let bx = 0; bx < blob.width; bx++) {
                        if (blob.grid[blob.offsetY + by][blob.offsetX + bx]) {
                            const wx = placeX + bx;
                            const wy = placeY + by;
                            const key = `${wx},${wy}`;
                            if (!walkableSet.has(key) || allLakeTiles.has(key)) {
                                valid = false;
                                break;
                            }
                            lakeTiles.add(key);
                        }
                    }
                    if (!valid) break;
                }

                if (!valid || lakeTiles.size < minSize || lakeTiles.size > maxSize) continue;

                // Connectivity check
                if (!this.checkConnectivity(walkableSet, new Set([...allLakeTiles, ...lakeTiles]))) continue;

                // Place this lake
                const lakeType = types[Math.floor(ROT.RNG.getUniform() * types.length)];

                if (lakeType === 'water') {
                    // Deep water in center, shallow water wreath
                    for (const key of lakeTiles) {
                        this.pendingLakeSpawns.push({ x: parseInt(key), y: parseInt(key.split(',')[1]), type: 'deep_water' });
                        allLakeTiles.add(key);
                    }

                    // Shallow water wreath (distance ≤ 2 from deep water)
                    const wreathTiles = new Set();
                    for (const key of lakeTiles) {
                        const [lx, ly] = key.split(',').map(Number);
                        for (let dy = -2; dy <= 2; dy++) {
                            for (let dx = -2; dx <= 2; dx++) {
                                if (dx * dx + dy * dy > 4) continue;
                                const wx = lx + dx, wy = ly + dy;
                                const wk = `${wx},${wy}`;
                                if (walkableSet.has(wk) && !lakeTiles.has(wk) && !allLakeTiles.has(wk) && !wreathTiles.has(wk)) {
                                    wreathTiles.add(wk);
                                }
                            }
                        }
                    }
                    for (const key of wreathTiles) {
                        const [wx, wy] = key.split(',').map(Number);
                        this.pendingLakeSpawns.push({ x: wx, y: wy, type: 'water' });
                        allLakeTiles.add(key);
                    }

                    console.log(`Lake ${l + 1}: ${lakeTiles.size} deep_water + ${wreathTiles.size} shallow water wreath`);
                } else if (lakeType === 'lava') {
                    for (const key of lakeTiles) {
                        const [lx, ly] = key.split(',').map(Number);
                        this.pendingLavaSpawns.push({ x: lx, y: ly });
                        allLakeTiles.add(key);
                    }
                    // Remove lava tiles from walkable
                    this.walkableTiles = this.walkableTiles.filter(t => !lakeTiles.has(`${t.x},${t.y}`));
                    console.log(`Lake ${l + 1}: ${lakeTiles.size} lava tiles`);
                }

                placed = true;
                break;
            }

            if (!placed) {
                console.log(`Lake ${l + 1}: failed to place after 20 attempts`);
            }
        }
    }

    addSecondaryConnections(options) {
        const config = options.secondary_connections;
        if (!config) return;

        const maxConnections = config.max || 5;
        const minDistance = config.min_distance || 20;

        const wallSet = new Set();
        const wallIndex = {};
        for (let i = 0; i < this.pendingWallSpawns.length; i++) {
            const w = this.pendingWallSpawns[i];
            if (w.type && w.type !== 'wall') continue;
            const key = `${w.x},${w.y}`;
            wallSet.add(key);
            wallIndex[key] = i;
        }

        const walkableSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));

        // Sample random subset of walls to check
        const wallKeys = Array.from(wallSet);
        for (let i = wallKeys.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [wallKeys[i], wallKeys[j]] = [wallKeys[j], wallKeys[i]];
        }
        const sampled = wallKeys.slice(0, Math.min(200, wallKeys.length));

        const candidates = [];
        for (const key of sampled) {
            const [wx, wy] = key.split(',').map(Number);

            // Check N/S pair
            const north = `${wx},${wy - 1}`, south = `${wx},${wy + 1}`;
            if (walkableSet.has(north) && walkableSet.has(south)) {
                const dist = this.bfsDistance(wx, wy - 1, wx, wy + 1, walkableSet);
                if (dist > minDistance) {
                    candidates.push({ key, x: wx, y: wy, distance: dist });
                    continue;
                }
            }

            // Check E/W pair
            const west = `${wx - 1},${wy}`, east = `${wx + 1},${wy}`;
            if (walkableSet.has(west) && walkableSet.has(east)) {
                const dist = this.bfsDistance(wx - 1, wy, wx + 1, wy, walkableSet);
                if (dist > minDistance) {
                    candidates.push({ key, x: wx, y: wy, distance: dist });
                }
            }
        }

        candidates.sort((a, b) => b.distance - a.distance);

        let added = 0;
        for (const c of candidates) {
            if (added >= maxConnections) break;
            const idx = wallIndex[c.key];
            if (idx === undefined) continue;

            // Remove wall, add door
            this.pendingWallSpawns.splice(idx, 1);
            // Rebuild index for remaining walls
            for (const [k, v] of Object.entries(wallIndex)) {
                if (v > idx) wallIndex[k] = v - 1;
            }
            delete wallIndex[c.key];

            this.pendingDoorSpawns.push({ x: c.x, y: c.y });
            this.walkableTiles.push({ x: c.x, y: c.y });
            walkableSet.add(c.key);
            added++;
            console.log(`Secondary connection: door at (${c.x}, ${c.y}), pathing distance was ${c.distance}`);
        }

        if (added > 0) {
            console.log(`Added ${added} secondary connections`);
        }
    }

    bfsDistance(x1, y1, x2, y2, walkableSet) {
        const targetKey = `${x2},${y2}`;
        const visited = new Set();
        const queue = [{ x: x1, y: y1, dist: 0 }];
        visited.add(`${x1},${y1}`);

        while (queue.length > 0) {
            const pos = queue.shift();
            if (pos.x === x2 && pos.y === y2) return pos.dist;

            const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
            for (const [dx, dy] of dirs) {
                const nx = pos.x + dx, ny = pos.y + dy;
                const nk = `${nx},${ny}`;
                if (!visited.has(nk) && walkableSet.has(nk)) {
                    visited.add(nk);
                    queue.push({ x: nx, y: ny, dist: pos.dist + 1 });
                }
            }
        }

        return Infinity;
    }

    generateRopeBridges(options) {
        const config = options.bridges;
        if (!config) return;

        const maxBridges = config.max || 3;
        const minSpan = config.min_span || 3;
        const maxSpan = config.max_span || 12;

        const walkableSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
        const wallSet = new Set(this.pendingWallSpawns.map(w => `${w.x},${w.y}`));

        const isVoid = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const key = `${x},${y}`;
            return !walkableSet.has(key) && !wallSet.has(key);
        };

        // Find edge tiles (walkable tiles adjacent to void)
        const edgeTiles = [];
        for (const t of this.walkableTiles) {
            const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
            for (const [dx, dy] of dirs) {
                if (isVoid(t.x + dx, t.y + dy)) {
                    edgeTiles.push({ x: t.x, y: t.y });
                    break;
                }
            }
        }

        for (let i = edgeTiles.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [edgeTiles[i], edgeTiles[j]] = [edgeTiles[j], edgeTiles[i]];
        }

        const candidates = [];
        const usedEdges = new Set();

        for (const edge of edgeTiles) {
            if (usedEdges.has(`${edge.x},${edge.y}`)) continue;

            const dirs = [
                { dx: 1, dy: 0, tileName: 'INVERSE_BOX_HORIZONTAL' },
                { dx: -1, dy: 0, tileName: 'INVERSE_BOX_HORIZONTAL' },
                { dx: 0, dy: 1, tileName: 'INVERSE_BOX_VERTICAL' },
                { dx: 0, dy: -1, tileName: 'INVERSE_BOX_VERTICAL' }
            ];

            for (const dir of dirs) {
                const bridgeTiles = [];
                let cx = edge.x + dir.dx;
                let cy = edge.y + dir.dy;

                while (isVoid(cx, cy) && bridgeTiles.length < maxSpan) {
                    bridgeTiles.push({ x: cx, y: cy, tileIndexBase: dir.tileName });
                    cx += dir.dx;
                    cy += dir.dy;
                }

                const farEdgeKey = `${cx},${cy}`;
                if (bridgeTiles.length >= minSpan && walkableSet.has(farEdgeKey)) {
                    const dist = this.bfsDistance(edge.x, edge.y, cx, cy, walkableSet);
                    if (dist > bridgeTiles.length * 3) {
                        candidates.push({
                            tiles: bridgeTiles,
                            from: { x: edge.x, y: edge.y },
                            to: { x: cx, y: cy },
                            distance: dist,
                            span: bridgeTiles.length
                        });
                    }
                }
            }
        }

        candidates.sort((a, b) => b.distance - a.distance);

        let built = 0;
        const bridgedTiles = new Set();
        for (const c of candidates) {
            if (built >= maxBridges) break;

            let overlaps = false;
            for (const t of c.tiles) {
                if (bridgedTiles.has(`${t.x},${t.y}`)) { overlaps = true; break; }
            }
            if (overlaps) continue;

            for (const t of c.tiles) {
                this.pendingBridgeSpawns.push(t);
                bridgedTiles.add(`${t.x},${t.y}`);
            }

            built++;
            usedEdges.add(`${c.from.x},${c.from.y}`);
            usedEdges.add(`${c.to.x},${c.to.y}`);
            console.log(`Rope bridge: ${c.span} tiles from (${c.from.x},${c.from.y}) to (${c.to.x},${c.to.y}), pathing distance was ${c.distance}`);
        }

        if (built > 0) {
            console.log(`Built ${built} rope bridges`);
        }
    }

    generateShapedMap(options) {
        const roomWidthRange = options.roomWidth || [5, 12];
        const roomHeightRange = options.roomHeight || [4, 10];
        const corridorRange = options.corridorLength || [2, 8];
        const targetPercentage = options.dugPercentage || 0.3;
        const maxAttempts = options.maxAttempts || 200;
        const depth = options.depth || 1;
        const roomWeights = options.room_weights;

        // Override weights if specified
        if (roomWeights) {
            for (const [name, weight] of Object.entries(roomWeights)) {
                const type = this.getRoomType(name);
                if (type) type.weight = weight;
            }
        }

        const shapedFloorTiles = new Set();
        const rooms = [];
        const doorSites = [];
        const targetTiles = Math.floor(this.width * this.height * targetPercentage);

        const randRange = (min, max) => min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));

        const carveRoom = (roomFloorTiles) => {
            for (const tile of roomFloorTiles) {
                if (tile.x < 1 || tile.x >= this.width - 1 || tile.y < 1 || tile.y >= this.height - 1) continue;
                const key = `${tile.x},${tile.y}`;
                if (!shapedFloorTiles.has(key)) {
                    shapedFloorTiles.add(key);
                    this.floorMap[tile.y][tile.x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.walkableTiles.push({ x: tile.x, y: tile.y });
                }
            }
        };

        const findDoorSites = (floorTiles, roomIndex) => {
            const floorSet = new Set(floorTiles.map(t => `${t.x},${t.y}`));
            const sites = [];
            const dirs = [
                { dx: 0, dy: -1, name: 'north' },
                { dx: 0, dy: 1, name: 'south' },
                { dx: -1, dy: 0, name: 'west' },
                { dx: 1, dy: 0, name: 'east' }
            ];

            for (const tile of floorTiles) {
                for (const dir of dirs) {
                    const outX = tile.x + dir.dx;
                    const outY = tile.y + dir.dy;
                    const outKey = `${outX},${outY}`;
                    if (!floorSet.has(outKey) && !shapedFloorTiles.has(outKey) &&
                        outX > 1 && outX < this.width - 2 && outY > 1 && outY < this.height - 2) {
                        sites.push({
                            x: tile.x, y: tile.y,
                            dirX: dir.dx, dirY: dir.dy,
                            dirName: dir.name,
                            roomIndex
                        });
                    }
                }
            }
            return sites;
        };

        // First room: place near center
        const firstW = randRange(roomWidthRange[0], roomWidthRange[1]);
        const firstH = randRange(roomHeightRange[0], roomHeightRange[1]);
        const firstX = Math.floor((this.width - firstW) / 2);
        const firstY = Math.floor((this.height - firstH) / 2);

        const firstType = this.selectRoomTypeForDepth(depth, { width: firstW, height: firstH });
        const firstConfig = this.getRoomType(firstType);
        const firstRoom = firstConfig.generator(firstX, firstY, firstW, firstH);

        carveRoom(firstRoom.floorTiles);
        rooms.push(new ShapedRoom(firstRoom.floorTiles, []));
        doorSites.push(...findDoorSites(firstRoom.floorTiles, 0));

        // Carve inner walls for rooms that have them (donut)
        if (firstRoom.wallTiles && firstRoom.wallTiles.length > 0) {
            for (const tile of firstRoom.wallTiles) {
                if (tile.x >= 0 && tile.x < this.width && tile.y >= 0 && tile.y < this.height) {
                    this.floorMap[tile.y][tile.x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.pendingWallSpawns.push({ x: tile.x, y: tile.y, type: 'wall' });
                }
            }
        }

        // Attach rooms iteratively
        let attempts = 0;
        while (shapedFloorTiles.size < targetTiles && attempts < maxAttempts && doorSites.length > 0) {
            attempts++;

            // Pick a random door site
            const siteIdx = Math.floor(ROT.RNG.getUniform() * doorSites.length);
            const site = doorSites[siteIdx];

            // Generate a corridor
            const corridorLen = randRange(corridorRange[0], corridorRange[1]);
            const corridorTiles = [];
            let valid = true;
            let cx = site.x + site.dirX;
            let cy = site.y + site.dirY;

            for (let i = 0; i < corridorLen; i++) {
                if (cx < 2 || cx >= this.width - 2 || cy < 2 || cy >= this.height - 2) {
                    valid = false;
                    break;
                }
                const ck = `${cx},${cy}`;
                if (shapedFloorTiles.has(ck)) {
                    valid = false;
                    break;
                }
                corridorTiles.push({ x: cx, y: cy });
                cx += site.dirX;
                cy += site.dirY;
            }

            if (!valid || corridorTiles.length === 0) {
                doorSites.splice(siteIdx, 1);
                continue;
            }

            // Generate a room at the end of the corridor
            const newW = randRange(roomWidthRange[0], roomWidthRange[1]);
            const newH = randRange(roomHeightRange[0], roomHeightRange[1]);

            // Position room so corridor connects near its center
            let roomX, roomY;
            if (site.dirX !== 0) {
                roomX = site.dirX > 0 ? cx : cx - newW + 1;
                roomY = cy - Math.floor(newH / 2);
            } else {
                roomX = cx - Math.floor(newW / 2);
                roomY = site.dirY > 0 ? cy : cy - newH + 1;
            }

            // Bounds check
            if (roomX < 1 || roomX + newW >= this.width - 1 || roomY < 1 || roomY + newH >= this.height - 1) {
                doorSites.splice(siteIdx, 1);
                continue;
            }

            const newType = this.selectRoomTypeForDepth(depth, { width: newW, height: newH });
            const newConfig = this.getRoomType(newType);
            const newRoom = newConfig.generator(roomX, roomY, newW, newH);

            // Check for overlap with existing floor
            let overlaps = false;
            for (const tile of newRoom.floorTiles) {
                if (shapedFloorTiles.has(`${tile.x},${tile.y}`)) {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) continue;

            // Carve corridor
            carveRoom(corridorTiles);

            // Carve room
            carveRoom(newRoom.floorTiles);

            // Inner walls for donut-type rooms
            if (newRoom.wallTiles && newRoom.wallTiles.length > 0) {
                for (const tile of newRoom.wallTiles) {
                    if (tile.x >= 0 && tile.x < this.width && tile.y >= 0 && tile.y < this.height) {
                        this.floorMap[tile.y][tile.x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                        this.pendingWallSpawns.push({ x: tile.x, y: tile.y, type: 'wall' });
                    }
                }
            }

            // Record door at corridor entrance
            const doorPositions = [{ x: site.x + site.dirX, y: site.y + site.dirY }];

            const roomIdx = rooms.length;
            rooms.push(new ShapedRoom(newRoom.floorTiles, doorPositions));
            doorSites.splice(siteIdx, 1);
            doorSites.push(...findDoorSites(newRoom.floorTiles, roomIdx));

            // 50% chance for door at corridor entrance
            if (ROT.RNG.getPercentage() <= 50 && corridorTiles.length > 0) {
                this.pendingDoorSpawns.push({ x: corridorTiles[0].x, y: corridorTiles[0].y });
            }
        }

        // Queue wall spawns for non-floor tiles adjacent to floors
        const wallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];
        const totalWeight = wallTypes.reduce((sum, wt) => sum + wt.weight, 0);

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (shapedFloorTiles.has(`${x},${y}`)) continue;

                let adjacentToFloor = false;
                const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
                for (const [dx, dy] of dirs) {
                    if (shapedFloorTiles.has(`${x + dx},${y + dy}`)) {
                        adjacentToFloor = true;
                        break;
                    }
                }

                if (adjacentToFloor && y > 0) {
                    let roll = ROT.RNG.getUniform() * totalWeight;
                    let wallType = wallTypes[0].type;
                    for (const wt of wallTypes) {
                        roll -= wt.weight;
                        if (roll <= 0) { wallType = wt.type; break; }
                    }
                    this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.pendingWallSpawns.push({ x, y, type: wallType });
                }
            }
        }

        // Convert perimeter walls to metal_wall
        const isPerimeter = (px, py) =>
            px === 0 || px === this.width - 1 || py === 0 || py === this.height - 1;

        for (const wall of this.pendingWallSpawns) {
            if (isPerimeter(wall.x, wall.y)) wall.type = 'metal_wall';
        }

        const pendingWallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (!isPerimeter(x, y)) continue;
                if (shapedFloorTiles.has(`${x},${y}`)) continue;
                if (pendingWallSet.has(`${x},${y}`)) continue;

                let adj = false;
                const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
                for (const [dx, dy] of dirs) {
                    if (shapedFloorTiles.has(`${x + dx},${y + dy}`)) { adj = true; break; }
                }
                if (adj) {
                    this.floorMap[y][x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.pendingWallSpawns.push({ x, y, type: 'metal_wall' });
                }
            }
        }

        // Torches in 30% of rooms
        for (const room of rooms) {
            if (ROT.RNG.getPercentage() <= 30) {
                const roomWalls = [];
                for (const wallPos of this.pendingWallSpawns) {
                    if (wallPos.x >= room.getLeft() - 1 && wallPos.x <= room.getRight() + 1 &&
                        wallPos.y >= room.getTop() - 1 && wallPos.y <= room.getBottom() + 1) {
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

        this.diggerRooms = rooms;
        console.log(`Shaped map: ${shapedFloorTiles.size} floors, ${rooms.length} rooms, ${this.pendingWallSpawns.length} walls, ${this.pendingDoorSpawns.length} doors`);
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

    generateRoomAt(startX, startY, width, height, context = null, depth = 1) {
        const roomType = this.selectRoomTypeForDepth(depth, { width, height });
        const roomConfig = this.getRoomType(roomType);
        const { floorTiles, wallTiles } = roomConfig.generator(startX, startY, width, height);

        const floorSet = new Set(floorTiles.map(t => `${t.x},${t.y}`));
        const wallSet = new Set(wallTiles.map(t => `${t.x},${t.y}`));
        const wallPositions = [];

        const hasMazeFloor = (wx, wy) => {
            if (wx < 0 || wx >= this.width || wy < 0 || wy >= this.height) return false;
            const floor = this.floorMap[wy][wx];
            return floor && floor.tileId === this.config.defaultFloorTileId;
        };

        // Place floor tiles from the room shape
        for (const tile of floorTiles) {
            if (tile.x < 0 || tile.x >= this.width || tile.y < 0 || tile.y >= this.height) continue;
            this.backgroundMap[tile.y][tile.x] = null;
            this.floorMap[tile.y][tile.x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };

            // Check if this is a perimeter tile (has a neighbor outside the room)
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            let isPerimeter = false;
            let hasAdjacentMazePath = false;
            for (const [dx, dy] of dirs) {
                const nx = tile.x + dx, ny = tile.y + dy;
                const nk = `${nx},${ny}`;
                if (!floorSet.has(nk) && !wallSet.has(nk)) {
                    isPerimeter = true;
                    if (hasMazeFloor(nx, ny)) hasAdjacentMazePath = true;
                }
            }

            if (isPerimeter && !hasAdjacentMazePath) {
                // Will have a wall placed on it by the wall-adjacency system below
            }
            this.walkableTiles.push({ x: tile.x, y: tile.y });
        }

        // Place inner walls (donut rooms, etc.)
        for (const tile of wallTiles) {
            if (tile.x < 0 || tile.x >= this.width || tile.y < 0 || tile.y >= this.height) continue;
            this.backgroundMap[tile.y][tile.x] = null;
            this.floorMap[tile.y][tile.x] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
            if (tile.y > 0) {
                wallPositions.push({ x: tile.x, y: tile.y });
            }
        }

        // Add walls around the room perimeter (non-floor tiles adjacent to floor)
        for (const tile of floorTiles) {
            const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
            for (const [dx, dy] of dirs) {
                const nx = tile.x + dx, ny = tile.y + dy;
                const nk = `${nx},${ny}`;
                if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                if (floorSet.has(nk) || wallSet.has(nk)) continue;
                if (hasMazeFloor(nx, ny)) continue;
                if (ny > 0 && !wallPositions.some(w => w.x === nx && w.y === ny)) {
                    wallPositions.push({ x: nx, y: ny });
                    this.floorMap[ny][nx] = { tileId: this.config.defaultFloorTileId, layer: 'floor' };
                    this.backgroundMap[ny][nx] = null;
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

    spawnPendingLakes(context) {
        if (!this.pendingLakeSpawns || this.pendingLakeSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn lakes without context');
            return;
        }

        const waterData = context.getActorData('water');
        const deepWaterData = context.getActorData('deep_water');

        let waterCount = 0, deepCount = 0;
        for (const pos of this.pendingLakeSpawns) {
            const type = pos.type || 'water';
            if (type === 'deep_water' && deepWaterData) {
                context.createActor(pos.x, pos.y, 'deep_water', deepWaterData);
                deepCount++;
            } else if (waterData) {
                context.createActor(pos.x, pos.y, 'water', waterData);
                waterCount++;
            }
        }

        console.log(`Spawned ${deepCount} deep_water + ${waterCount} water actors`);
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

    spawnPendingFungus(context) {
        if (!this.pendingFungusSpawns || this.pendingFungusSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn fungus without context');
            return;
        }

        const actorData = context.getActorData('fungus');
        if (!actorData) {
            console.warn('No fungus actor data found');
            return;
        }

        for (const pos of this.pendingFungusSpawns) {
            context.createActor(pos.x, pos.y, 'fungus', actorData);
        }

        console.log(`Spawned ${this.pendingFungusSpawns.length} fungus actors`);
        this.pendingFungusSpawns = [];
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

        for (const pos of this.pendingBridgeSpawns) {
            const data = JSON.parse(JSON.stringify(actorData));
            if (pos.tileIndexBase) {
                data.tileIndexBase = pos.tileIndexBase;
            }
            context.createActor(pos.x, pos.y, 'rope_bridge', data);
        }

        console.log(`Spawned ${this.pendingBridgeSpawns.length} rope bridge segments`);
        this.pendingBridgeSpawns = [];
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

    /**
     * Designate one digger-generated room as the treasure room.
     * Removes one of its pending door spawns and returns the room's floor tiles
     * and chosen door position so the engine can place a locked door + loot.
     * Must be called after generateProceduralMap() and before spawnPendingDoors().
     * @returns {{ roomTiles: Array<{x,y}>, doorPos: {x,y} }|null}
     */
    spawnTreasureRoom() {
        if (!this.diggerRooms || this.diggerRooms.length === 0) {
            console.warn('Treasure room: no digger rooms available');
            return null;
        }

        // Find rooms that have at least one corridor entrance (getDoors() returns all connections,
        // regardless of the 50% chance that gave them a pending door spawn)
        const eligibleRooms = this.diggerRooms.filter(room => {
            let count = 0;
            room.getDoors(() => count++);
            return count > 0;
        });

        if (eligibleRooms.length === 0) {
            console.warn('Treasure room: no eligible rooms with entrances');
            return null;
        }

        const treasureRoom = eligibleRooms[Math.floor(ROT.RNG.getUniform() * eligibleRooms.length)];

        // Collect interior floor tiles
        const roomTiles = [];
        for (let y = treasureRoom.getTop(); y <= treasureRoom.getBottom(); y++) {
            for (let x = treasureRoom.getLeft(); x <= treasureRoom.getRight(); x++) {
                if (this.floorMap[y] && this.floorMap[y][x]) {
                    roomTiles.push({ x, y });
                }
            }
        }

        // Collect ALL corridor connection points for this room (not just the 50% that got door spawns)
        const allEntrances = [];
        treasureRoom.getDoors((x, y) => allEntrances.push({ x, y }));

        if (allEntrances.length === 0) return null;

        // Use the first entrance as the locked door; wall off every other corridor connection
        const chosenDoor = allEntrances[0];
        const doorSet = new Set(this.pendingDoorSpawns.map(p => `${p.x},${p.y}`));

        for (const entrance of allEntrances) {
            // Remove any pending plain door at this position
            if (doorSet.has(`${entrance.x},${entrance.y}`)) {
                this.pendingDoorSpawns = this.pendingDoorSpawns.filter(
                    p => !(p.x === entrance.x && p.y === entrance.y)
                );
            }
            // Wall off every entrance that isn't the chosen locked door
            if (entrance !== chosenDoor) {
                this.pendingWallSpawns.push({ x: entrance.x, y: entrance.y, type: 'metal_wall' });
                this.walkableTiles = this.walkableTiles.filter(
                    t => !(t.x === entrance.x && t.y === entrance.y)
                );
            }
        }

        // Retype all existing perimeter wall spawns to metal_wall
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
        this.diggerRooms = null;
        this.actorWildcardCache = null;
    }
}
