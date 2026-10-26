/**
 * Architect methods: loading Tiled maps (layers, flipped GIDs, wildcard tiles)
 * and filling wildcard regions with generated content.
 */

import { globalVars } from '../globals.js';

// Tiled GID flip flags (high bits) and the mask that strips them off.
const TILED_FLIP_MASK = 0x1FFFFFFF;
const TILED_FLIP_H = 0x80000000;
const TILED_FLIP_V = 0x40000000;
const TILED_FLIP_D = 0x20000000;

export const ArchitectTiled = {
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
    },

    parseTileGID(rawId) {
        return {
            tileId: rawId & TILED_FLIP_MASK,
            flipH: (rawId & TILED_FLIP_H) !== 0,
            flipV: (rawId & TILED_FLIP_V) !== 0,
            flipD: (rawId & TILED_FLIP_D) !== 0,
        };
    },

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
    },

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
    },

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
    },

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
    },

    getWildcardType(tileId, context = null) {
        const builtinWildcards = {
            210: 'maze',            // DESERET_CAPITAL_LETTER_ES — Eller's maze
            9: 'digger_region',
            16: 'digger_region',
            152: 'digger_region',
            10: 'cave',             // INVERSE_BULLET — the cellular generator
            230: 'infernal',
            143: 'room',
            144: 'room',
            226: 'palladian',       // CROWN
            12: 'item_spawn',
            3: 'actor_spawn',
            // One marker per map generator that had none. 'cave' and 'maze' above
            // already cover `cellular` and `eller_maze` under older, generic names,
            // so they are not repeated here.
            197: 'dungeon',         // BOX_VERTICAL_HORIZONTAL — the main generator
            142: 'uniform',         // BLACK_SQUARE
            36: 'rogue',            // NUMBER_SIGN
            232: 'divided_maze',    // CROSS
            43: 'icey_maze',        // ASTERISK
            44: 'arena'             // PLUS_SIGN
        };

        if (builtinWildcards[tileId]) {
            return builtinWildcards[tileId];
        }

        if (context) {
            const actorType = this.getActorWildcardType(tileId, context);
            if (actorType) return actorType;
        }

        return 'unknown';
    },

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
    },

    clearWildcardCache() {
        this.actorWildcardCache = null;
    },

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
    },

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
        const others = regions.filter(r => r.type !== 'maze' && r.type !== 'room');

        for (const { region, type } of [...mazes, ...rooms, ...others]) {
            await this.generateWildcardContent(region, type, context);
        }
    },

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
    },

    async generateWildcardContent(region, type, context = null) {
        console.log(`Generating ${type} at (${region.x}, ${region.y}) size ${region.width}x${region.height}`);

        switch (type) {
            case 'maze':
                this.generateMazeAt(region.x, region.y, region.width, region.height);
                break;
            case 'digger_region':
                this.generateDiggerRegionAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'dungeon':
                this.generateDungeonRegionAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'uniform':
                this.generateUniformAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'rogue':
                this.generateRogueAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'divided_maze':
                this.generateDividedMazeAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'icey_maze':
                this.generateIceyMazeAt(region.x, region.y, region.width, region.height, context);
                break;
            case 'arena':
                this.generateArenaAt(region.x, region.y, region.width, region.height, context);
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
    },

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
    },
};
