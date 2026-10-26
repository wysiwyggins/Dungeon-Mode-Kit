/**
 * Sprite library: tile names to spritesheet frames.
 */

import { randomElement } from '../core/util.js';
import { globalVars } from '../globals.js';

// ============================================================================
// SPRITE LIBRARY
// ============================================================================

export class SpriteLibrary {
    constructor() {
        this.tiles = null;
    }
    
    async load() {
        try {
            const response = await fetch(`${globalVars.BASE_PATH}/data/static-tiles.json`);
            const data = await response.json();
            this.tiles = data.tiles;
            this.tileNames = Object.keys(this.tiles);

            console.log('Sprite library loaded with', Object.keys(this.tiles).length, 'tiles');
        } catch (error) {
            console.error('Failed to load sprite library:', error);
            this.tiles = {};
        }
    }
    
    /**
     * Get tile coordinates by name
     * @param {string} name - Tile name from static-tiles.json (e.g. "WHITE_KEY", "SKULL")
     * @returns {{x: number, y: number}|null} Tile coordinates or null if not found
     */
    getTileByName(name) {
        if (!this.tiles) {
            console.error('Sprite library not loaded');
            return null;
        }

        const coords = this.tiles[name.toUpperCase()];
        if (!coords) {
            console.warn(`Tile '${name}' not found in sprite library`);
            return null;
        }

        return { x: coords[0], y: coords[1] };
    }

    /**
     * Convert a tile name to a Tiled tileId (1-based linear index)
     * @param {string} name - Tile name from static-tiles.json
     * @param {number} cols - Number of columns in spritesheet (default 23)
     * @returns {number|null} Tiled tileId or null if not found
     */
    getTileIdByName(name, cols = 23) {
        const coords = this.getTileByName(name);
        if (!coords) return null;
        return coords.y * cols + coords.x + 1;
    }
    
    
    /**
     * Resolve a tile reference - handles both direct coordinates and named tiles
     * @param {Object|string} tileRef - Either {x, y} coords or a string name
     * @returns {{x: number, y: number}|null} Resolved tile coordinates
     */
    resolveTile(tileRef) {
        if (!tileRef) return null;
        if (tileRef === 'BLANK') return null;

        if (typeof tileRef === 'object' && tileRef.x !== undefined && tileRef.y !== undefined) {
            return tileRef;
        }

        if (typeof tileRef === 'string') {
            return this.getTileByName(tileRef);
        }

        console.warn('Invalid tile reference:', tileRef);
        return null;
    }

    /**
     * Get a random tile index from the tile set
     * @returns {{x: number, y: number}} Random tile coordinates
     */
    getRandomTileIndex() {
        if (!this.tileNames || this.tileNames.length === 0) return { x: 0, y: 0 };
        const name = randomElement(this.tileNames);
        const coords = this.tiles[name];
        return { x: coords[0], y: coords[1] };
    }

    /**
     * Get a random tile with both name and coordinates
     * @returns {{name: string, x: number, y: number}} Random tile name and coordinates
     */
    getRandomTile() {
        if (!this.tileNames || this.tileNames.length === 0) return { name: 'something', x: 0, y: 0 };
        const name = randomElement(this.tileNames);
        const coords = this.tiles[name];
        return { name, x: coords[0], y: coords[1] };
    }

    /**
     * Get a random tile name string (for hover text scrambling)
     * @returns {string} Random tile name
     */
    getRandomTileName() {
        if (!this.tileNames || this.tileNames.length === 0) return 'something';
        return randomElement(this.tileNames);
    }
}
