/**
 * Dungeon Mode Kit - Core Engine, 2025- Wiley Wiggins
 * A modular roguelike engine supporting multiple prototypes with mixed authored/procedural content, built on rot.js and pixi.js
 */

// ============================================================================
// SPRITE LIBRARY
// ============================================================================

class SpriteLibrary {
    constructor() {
        this.tiles = null;
        this.animations = null;
    }
    
    async load() {
        try {
            const response = await fetch(`${globalVars.BASE_PATH}/data/static-tiles.json`);
            const data = await response.json();
            this.tiles = data.tiles;
            this.tileNames = Object.keys(this.tiles);
            this.animations = {
                'fire': 'fire',
                'smoke': 'smoke',
                'mist': 'mist',
                'fluid': 'fluid'
            };
            
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
     * Check if a name refers to an animated sprite
     * @param {string} name - Animation name (e.g. "fire", "smoke")
     * @returns {boolean} True if this is an animated sprite
     */
    isAnimation(name) {
        return this.animations && this.animations.hasOwnProperty(name.toLowerCase());
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse a tint value from various formats
 * @param {number|string|undefined} value - Tint value as number, hex string ("#FF0000"), or undefined
 * @param {number} defaultValue - Default tint if value is undefined (default: 0xFFFFFF white)
 * @returns {number} Parsed tint as integer
 */
function parseTint(value, defaultValue = 0xFFFFFF) {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'string') {
        let hex = value.startsWith('#') ? value.slice(1) : value;
        const parsed = parseInt(hex, 16);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }

    console.warn('Invalid tint value:', value);
    return defaultValue;
}

function generateLightnessVariation(baseColor, delta = 0x10) {
    const r = (baseColor >> 16) & 0xFF;
    const g = (baseColor >> 8) & 0xFF;
    const b = baseColor & 0xFF;
    return {
        lighter: ((Math.min(255, r + delta) << 16) | (Math.min(255, g + delta) << 8) | Math.min(255, b + delta)),
        darker:  ((Math.max(0, r - delta) << 16)   | (Math.max(0, g - delta) << 8)   | Math.max(0, b - delta))
    };
}

function extractRGB(color) {
    return {
        r: (color >> 16) & 0xFF,
        g: (color >> 8) & 0xFF,
        b: color & 0xFF
    };
}

function packRGB(r, g, b) {
    return (r << 16) | (g << 8) | b;
}

function lerpColor(colorA, colorB, t) {
    const a = extractRGB(colorA);
    const b = extractRGB(colorB);
    return packRGB(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t)
    );
}

function rgbToHue(color) {
    const r = ((color >> 16) & 0xFF) / 255;
    const g = ((color >> 8) & 0xFF) / 255;
    const b = (color & 0xFF) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return h * 60;
}

// ── Array / direction helpers ──────────────────────────────────────────

const CARDINAL_DIRS = [
    {dx: 0, dy: -1}, {dx: 0, dy: 1},
    {dx: -1, dy: 0}, {dx: 1, dy: 0}
];

const ALL_DIRS = [
    {dx: -1, dy: -1}, {dx: 0, dy: -1}, {dx: 1, dy: -1},
    {dx: -1, dy: 0},                   {dx: 1, dy: 0},
    {dx: -1, dy: 1},  {dx: 0, dy: 1},  {dx: 1, dy: 1}
];

function isDiagonalBlocked(fromX, fromY, toX, toY, hasFloor) {
    if (fromX === toX || fromY === toY) return false;
    return !hasFloor(toX, fromY) || !hasFloor(fromX, toY);
}

/** Fisher-Yates shuffle in-place using ROT.RNG for deterministic randomness. */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Pick a random element from an array using ROT.RNG. */
function randomElement(arr) {
    return arr[Math.floor(ROT.RNG.getUniform() * arr.length)];
}

/**
 * Get the indefinite article ('a' or 'an') for a word
 * @param {string} word - The word to get the article for
 * @returns {string} 'a' or 'an'
 */
function getIndefiniteArticle(word) {
    if (!word || word.length === 0) return 'a';
    const firstLetter = word.charAt(0).toLowerCase();
    const vowels = ['a', 'e', 'i', 'o', 'u'];
    return vowels.includes(firstLetter) ? 'an' : 'a';
}

/**
 * Process [a-an] template markers in a string
 * Replaces [a-an] with 'a' or 'an' based on the following word
 * @param {string} text - The text containing [a-an] markers
 * @returns {string} The processed text with proper articles
 */
function processArticleTemplates(text) {
    // Match [a-an] followed by optional whitespace and capture the next word
    return text.replace(/\[a-an\]\s*(\w+)/gi, (_match, nextWord) => {
        const article = getIndefiniteArticle(nextWord);
        return `${article} ${nextWord}`;
    });
}

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
function getLinePath(x0, y0, x1, y1) {
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
function hasLineOfSight(x0, y0, x1, y1, isBlocked, includeEndpoints = false) {
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
function findPathAStar(fromX, fromY, toX, toY, isPassable, options = {}) {
    const topology = options.topology ?? 8;
    const hasFloor = options.hasFloor;
    const path = [];

    const astar = new ROT.Path.AStar(toX, toY, isPassable, { topology });

    astar.compute(fromX, fromY, (x, y) => {
        path.push({ x, y });
    });

    if (hasFloor && path.length > 1) {
        for (let i = path.length - 2; i >= 0; i--) {
            if (isDiagonalBlocked(path[i + 1].x, path[i + 1].y, path[i].x, path[i].y, hasFloor)) {
                const mid = { x: path[i].x, y: path[i + 1].y };
                if (hasFloor(mid.x, mid.y)) {
                    path.splice(i + 1, 0, mid);
                } else {
                    const alt = { x: path[i + 1].x, y: path[i].y };
                    if (hasFloor(alt.x, alt.y)) {
                        path.splice(i + 1, 0, alt);
                    }
                }
            }
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
function getNextPathStep(fromX, fromY, toX, toY, isPassable, options = {}) {
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
function getChebyshevDistance(x0, y0, x1, y1) {
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
function getEuclideanDistance(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if an actor is "important" enough that obscuring actors should go transparent.
 */
function isImportantActor(actor) {
    return actor.personality ||
           actor.hasAttribute('openable') ||
           actor.hasAttribute('stairway') ||
           actor.hasAttribute('gateway') ||
           actor.hasAttribute('controlled');
}

/**
 * Find a walkable, unoccupied tile adjacent to the given actor (cardinal only).
 * Directions are shuffled using ROT.RNG for deterministic randomness.
 */
function findAdjacentWalkable(actor, entityManager) {
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
function spawnChainSegments(head, entityManager) {
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

// ============================================================================
// CORE ENGINE CLASS
// ============================================================================

class DungeonEngine {
    constructor(config = {}) {
        this.app = null;
        this.scheduler = null;
        this.turnEngine = null;
        this.renderer = null;
        this.mapManager = null;
        this.entityManager = null;
        this.inputManager = null;
        this.lightingManager = null;
        this.interfaceManager = null;
        this.spriteLibrary = new SpriteLibrary();
        
        // Game state
        this.currentPrototype = null;
        this.prototypeStack = []; // For multi-level navigation
        this.gameOver = false;

        // Multi-floor state
        this.currentFloor = 1;           // 1-indexed
        this.floorStates = new Map();    // floor# → { entities: [...], map: {...} }
        this.pendingFallenActors = new Map(); // floor# → [serialized actor data]
        
        // Configuration
        this.config = {
            containerId: 'game',
            tileWidth: 40,
            tileHeight: 30,
            backgroundColor: 0xf5f5ee,
            ...config
        };
        
        // Canvas dimensions will be set when map loads
        this.canvasWidth = null;
        this.canvasHeight = null;

        // Viewport properties (set in loadPrototype after map loads)
        this.viewportWidth = null;
        this.viewportHeight = null;
        this.viewportEnabled = false;
        this.sectionCol = 0;
        this.sectionRow = 0;
        this.sectionOriginX = 0;
        this.sectionOriginY = 0;
        this.viewportOffsetX = 0;
        this.viewportOffsetY = 0;
        this.aiMargin = 5;
    }
    
    async initialize() {
        await this.spriteLibrary.load();
        await this.loadGlobalAssets();
        await this.loadGlobalData();
        this.setupEventListeners();
        
        console.log('Engine initialized (renderer will be created when map loads)');
    }
    
    async loadGlobalData() {
        try {
            // Load global entity definitions
            const [actorsRes, itemsRes, personalitiesRes, entitiesRes, colorsRes, adjectivesRes, attacksRes, reagentsRes, substancesRes, statesRes, glyphsRes, effectsRes, keybindingsRes] = await Promise.all([
                fetch(`${globalVars.BASE_PATH}/data/actors.json`),
                fetch(`${globalVars.BASE_PATH}/data/items.json`),
                fetch(`${globalVars.BASE_PATH}/data/personalities.json`),
                fetch(`${globalVars.BASE_PATH}/data/entities.json`),
                fetch(`${globalVars.BASE_PATH}/data/colors.json`),
                fetch(`${globalVars.BASE_PATH}/data/adjectives.json`),
                fetch(`${globalVars.BASE_PATH}/data/attacks.json`),
                fetch(`${globalVars.BASE_PATH}/data/reagents.json`),
                fetch(`${globalVars.BASE_PATH}/data/substances.json`),
                fetch(`${globalVars.BASE_PATH}/data/states.json`),
                fetch(`${globalVars.BASE_PATH}/data/glyphs.json`),
                fetch(`${globalVars.BASE_PATH}/data/effects.json`),
                fetch(`${globalVars.BASE_PATH}/data/keybindings.json`)
            ]);

            this.globalActors = await actorsRes.json();
            this.globalItems = await itemsRes.json();
            this.globalPersonalities = await personalitiesRes.json();
            this.globalEntities = await entitiesRes.json();
            const colorsData = await colorsRes.json();
            this.globalColors = colorsData.colors || [];
            this.globalAdjectives = await adjectivesRes.json();
            this.globalAttacks = await attacksRes.json();

            // Load reagents and sample a random subset to keep in memory
            const fullReagents = await reagentsRes.json();
            this.globalReagents = this.sampleReagents(fullReagents, 100);

            // Load substances
            this.globalSubstances = await substancesRes.json();

            // Load actor states (burning, poisoned, stunned, etc.)
            this.globalStates = await statesRes.json();

            // Load glyph words for scroll name generation
            this.globalGlyphs = await glyphsRes.json();

            // Load visual effects definitions
            this.globalEffects = await effectsRes.json();

            // Load keybindings
            this.globalKeybindings = await keybindingsRes.json();

            console.log('Global data loaded:', {
                actors: Object.keys(this.globalActors).length,
                items: Object.keys(this.globalItems).length,
                personalities: Object.keys(this.globalPersonalities).length,
                entities: Object.keys(this.globalEntities).length,
                colors: this.globalColors.length,
                adjectives: Object.keys(this.globalAdjectives).length,
                attacks: Object.keys(this.globalAttacks).length,
                reagents: Object.keys(this.globalReagents).length,
                substances: this.globalSubstances?.substances?.length || 0,
                states: Object.keys(this.globalStates).length,
                effects: Object.keys(this.globalEffects).length
            });
        } catch (error) {
            console.error('Failed to load global data:', error);
            this.globalActors = {};
            this.globalItems = {};
            this.globalPersonalities = {};
            this.globalEntities = {};
            this.globalColors = [];
            this.globalAdjectives = {};
            this.globalAttacks = {};
            this.globalReagents = {};
            this.globalSubstances = { substances: [] };
            this.globalStates = {};
            this.globalEffects = {};
        }
    }

    /**
     * Sample a random subset from a reagents data object
     * @param {Object} fullData - The full reagents data with category arrays
     * @param {number} sampleSize - Number of items to keep per category
     * @returns {Object} Sampled data with same structure but fewer items
     */
    sampleReagents(fullData, sampleSize) {
        const sampled = {};
        for (const [category, items] of Object.entries(fullData)) {
            if (Array.isArray(items)) {
                // Shuffle and take first sampleSize items
                const shuffled = shuffleArray([...items]);
                sampled[category] = shuffled.slice(0, Math.min(sampleSize, shuffled.length));
            } else {
                sampled[category] = items;
            }
        }
        return sampled;
    }
    
    async initializeRenderer() {
        const container = document.getElementById(this.config.containerId);
        if (!container) {
            throw new Error(`Container element #${this.config.containerId} not found`);
        }

        try {
            this.app = new PIXI.Application({
                width: this.canvasWidth,
                height: this.canvasHeight,
                backgroundColor: this.config.backgroundColor,
                autoDensity: false,
                resolution: 1
            });
            
            this.app.stage.sortableChildren = true;
            this.renderer = new RenderSystem(this.app, this.mapManager.width, this.mapManager.height, this);
            this.interfaceManager = new InterfaceManager(this);
            container.appendChild(this.app.view);
            this.app.view.style.width = `${this.canvasWidth / 2}px`;
            this.app.view.style.height = `${this.canvasHeight / 2}px`;
            
            console.log(`Renderer initialized: ${this.canvasWidth}x${this.canvasHeight}px canvas, scaled to ${this.canvasWidth/2}x${this.canvasHeight/2}px display`);
        } catch (error) {
            console.error('Failed to initialize PIXI renderer:', error);
            throw new Error(`Renderer initialization failed: ${error.message}`);
        }
    }
    
    async loadGlobalAssets() {
        try {
            await Promise.race([
                new Promise((resolve, reject) => {
                    PIXI.Loader.shared.onError.add((error) => {
                        console.error('Asset loading error:', error);
                        reject(error);
                    });
                    
                    PIXI.Loader.shared
                        .add('tiles', globalVars.SPRITESHEET_PATH)
                        .add('fire', `${globalVars.BASE_PATH}/assets/sprites/fire-animation.png`)
                        .add('smoke', `${globalVars.BASE_PATH}/assets/sprites/smoke-animation.png`)
                        .add('mist', `${globalVars.BASE_PATH}/assets/sprites/light-smoke-animation.png`)
                        .add('fluid', `${globalVars.BASE_PATH}/assets/sprites/fluid-animation.png`)
                        .load(() => {
                            this.setupAnimationFrames();
                            resolve();
                        });
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Asset loading timeout')), 10000)
                )
            ]);
            
            console.log('Sprites loaded successfully');
        } catch (error) {
            console.error('Failed to load sprite assets:', error);
            throw error;
        }
        

        try {
            const audioData = await fetch(`${globalVars.BASE_PATH}/data/sounds.json`).then(r => r.json());
            this.audioManager = new AudioManager(audioData);
            console.log('Audio loaded successfully');
        } catch (error) {
            console.warn('Failed to load audio effects:', error);
            this.audioManager = null;
        }
        
        console.log('Global assets loaded');
    }
    
    setupAnimationFrames() {
        this.animationFrames = {};
        const animations = ['fire', 'smoke', 'mist', 'fluid'];
        for (const name of animations) {
            this.animationFrames[name] = [];
            const baseTexture = PIXI.Loader.shared.resources[name].texture.baseTexture;
            const frameCount = Math.floor(baseTexture.width / globalVars.TILE_WIDTH);

            for (let i = 0; i < frameCount; i++) {
                let rect = new PIXI.Rectangle(i * globalVars.TILE_WIDTH, 0, globalVars.TILE_WIDTH, globalVars.TILE_HEIGHT);
                this.animationFrames[name].push(new PIXI.Texture(baseTexture, rect));
            }
        }
    }
    
    setupEventListeners() {
        createjs.Ticker.framerate = 60;
        createjs.Ticker.addEventListener("tick", createjs.Tween);
        this.inputManager = new InputManager(this);

        console.log('Event listeners initialized');
    }

    /**
     * Initialize the turn-based engine using ROT.js
     * Uses Simple scheduler - all actors get one turn per round
     */
    initializeTurnEngine() {
        this.scheduler = new ROT.Scheduler.Simple();
        this.turnEngine = new ROT.Engine(this.scheduler);

        this.hasControlledActor = false;

        // Only schedule actors that take turns (have personality or are player-controlled)
        for (const actor of this.entityManager.actors) {
            if (actor.personality || actor.hasAttribute('controlled')) {
                this.scheduler.add(actor, true);
                if (actor.hasAttribute('controlled')) {
                    this.hasControlledActor = true;
                }
            }
        }

        this.turnSpeed = this.currentPrototype?.config.turn_speed ?? 50;
        this.observerPaused = false;
        console.log(`Turn engine initialized with ${this.scheduler._queue._events.length} scheduled actors`);
        console.log(`Observer mode: ${!this.hasControlledActor}, turn speed: ${this.turnSpeed}ms`);
        this.turnEngine.start();
        if (!this.hasControlledActor) {
            this.advanceObserverTurn();
        }
    }

    /**
     * Advance one turn in observer mode (no player-controlled actors)
     */
    advanceObserverTurn() {
        if (this.observerPaused || this.hasControlledActor) return;
        if (this.turnEngine && this.turnEngine._lock) {
            this.turnEngine.unlock();
        }
        setTimeout(() => this.advanceObserverTurn(), this.turnSpeed);
    }

    /**
     * Toggle play/pause in observer mode
     */
    toggleObserverPause() {
        if (this.hasControlledActor) return;

        this.observerPaused = !this.observerPaused;
        console.log(`Observer mode ${this.observerPaused ? 'paused' : 'playing'}`);

        if (!this.observerPaused) {
            this.advanceObserverTurn();
        }
    }

    /**
     * Called when a controlled actor dies - transition to observer mode
     */
    onControlledActorDied() {
        console.log('Controlled actor died - transitioning to observer mode');
        this.hasControlledActor = false;

        if (this.interfaceManager) {
            this.interfaceManager.hidePlayerInfo();
        }

        if (this.turnEngine && this.turnEngine._lock) {
            this.turnEngine.unlock();
        }
        const hasActorsWithBehaviors = this.entityManager.actors.some(
            actor => !actor.isDead && actor.personality
        );

        if (hasActorsWithBehaviors) {
            this.observerPaused = false;
            setTimeout(() => this.advanceObserverTurn(), this.turnSpeed);
        } else {
            console.log('No actors with behaviors remaining - game over');
        }
    }

    /**
     * Reload the current prototype or load a different one
     * @param {string} [newPrototypeName] - Optional name of prototype to load (defaults to current)
     */
    async reloadPrototype(newPrototypeName) {
        const prototypeName = newPrototypeName || this.currentPrototype?.name || 'default';
        console.log(`Reloading prototype: ${prototypeName}`);
        this.cleanup();
        await this.loadPrototype(prototypeName);
    }

    updateLighting() {
        if (!this.lightingManager) {
            this.renderer.updateProximityTransparency();
            return;
        }

        this.lightingManager.computeLighting();
        const fogOfWar = this._floorMechanics?.fog_of_war || this._runtimeDarknessActive || false;
        this.renderer.updateDarkness(this.lightingManager, fogOfWar);

        // Update the sidebar with visible actors and items
        this.interfaceManager?.updateSidebar();
    }

    /**
     * Enable the lighting/darkness system at runtime on a level that doesn't normally have it.
     * Used by the "blinded" state to create visual darkness on bright levels.
     */
    enableRuntimeDarkness() {
        if (this.lightingManager) return; // Already has darkness (dark level or already enabled)

        this._runtimeDarknessActive = true;

        this.lightingManager = new LightingManager(this);
        this.lightingManager.initialize(
            this.mapManager.width,
            this.mapManager.height,
            { player_auto_light: true, ambient_light: 0.0 }
        );
        this.renderer.initializeDarkness(this.mapManager.width, this.mapManager.height);
        this.updateLighting();
    }

    /**
     * Disable runtime darkness, restoring the level to its original bright state.
     */
    disableRuntimeDarkness() {
        if (!this._runtimeDarknessActive) return; // Wasn't enabled by us

        this._runtimeDarknessActive = false;
        this.lightingManager = null;

        // Remove darkness sprites
        this.renderer.darknessContainer.removeChildren();
        this.renderer.lightColorContainer.removeChildren();
        this.renderer.darknessSprites = [];
        this.renderer.lightColorSprites = [];

        // Restore entity visibility/tinting to defaults
        for (const actor of this.entityManager.actors) {
            if (actor.spriteBase) {
                actor.spriteBase.tint = actor.tint ?? 0xFFFFFF;
                actor.spriteBase.visible = true;
            }
            if (actor.spriteTop) {
                actor.spriteTop.tint = actor.tint ?? 0xFFFFFF;
                actor.spriteTop.visible = true;
            }
            if (actor.spriteSide) {
                actor.spriteSide.tint = actor.tint ?? 0xFFFFFF;
                actor.spriteSide.visible = true;
            }
        }
        for (const item of this.entityManager.items) {
            if (item.sprite) {
                item.sprite.tint = item.tint ?? 0xFFFFFF;
                item.sprite.visible = item.hasAttribute('visible');
            }
        }
    }

    snapViewportToTile(tileX, tileY) {
        if (!this.viewportEnabled) return false;

        const newCol = Math.floor(tileX / this.viewportWidth);
        const newRow = Math.floor(tileY / this.viewportHeight);

        const maxCol = Math.ceil(this.mapManager.width / this.viewportWidth) - 1;
        const maxRow = Math.ceil(this.mapManager.height / this.viewportHeight) - 1;
        const col = Math.min(newCol, maxCol);
        const row = Math.min(newRow, maxRow);

        if (col === this.sectionCol && row === this.sectionRow) return false;

        this.sectionCol = col;
        this.sectionRow = row;
        this.sectionOriginX = Math.max(0, Math.min(col * this.viewportWidth,
            this.mapManager.width - this.viewportWidth));
        this.sectionOriginY = Math.max(0, Math.min(row * this.viewportHeight,
            this.mapManager.height - this.viewportHeight));
        this.viewportOffsetX = -(this.sectionOriginX * this.config.tileWidth);
        this.viewportOffsetY = -(this.sectionOriginY * this.config.tileHeight);

        return true;
    }

    applyViewportOffset() {
        if (!this.viewportEnabled || !this.renderer) return;
        for (const c of [
            this.renderer.backgroundContainer, this.renderer.floorContainer,
            this.renderer.entityContainer, this.renderer.overlayContainer,
            this.renderer.lightColorContainer,
            this.renderer.darknessContainer, this.renderer.uiContainer
        ]) {
            c.x = this.viewportOffsetX;
            c.y = this.viewportOffsetY;
        }
    }

    onSectionChange() {
        this.applyViewportOffset();
        this.renderer.updateTileVisibility(
            this.sectionOriginX, this.sectionOriginY,
            this.viewportWidth, this.viewportHeight
        );
        this.renderer.updateEntityVisibility(
            this.sectionOriginX, this.sectionOriginY,
            this.viewportWidth, this.viewportHeight
        );
        if (this.lightingManager) this.updateLighting();
        this.renderer.updateSubmersionOverlay();
    }

    playSound(soundName, options) {
        if (this.audioManager) {
            return this.audioManager.play(soundName, options);
        }
    }
    playSoundVaried(soundName, volumeBase, volumeVariance, rateBase, rateVariance) {
        if (this.audioManager) {
            this.audioManager.playVaried(soundName, volumeBase, volumeVariance, rateBase, rateVariance);
        }
    }
    stopSound(soundId) {
        if (this.audioManager?.sound) {
            this.audioManager.sound.stop(soundId);
        }
    }
    muteAudio() {
        if (this.audioManager) {
            this.audioManager.mute();
        }
    }
    unmuteAudio() {
        if (this.audioManager) {
            this.audioManager.unmute();
        }
    }
    setAudioVolume(volume) {
        if (this.audioManager) {
            this.audioManager.setVolume(volume);
        }
    }
    listAvailableSounds() {
        if (this.audioManager) {
            return this.audioManager.listSounds();
        }
        return [];
    }
    
    async loadPrototype(prototypeName, entryDirection = null) {
        console.log(`Loading prototype: ${prototypeName}, entry: ${entryDirection || 'direct'}`);
        let prototypeConfig = await this.loadPrototypeConfig(prototypeName);
        if (!prototypeConfig) {
            prototypeName = 'default';
            prototypeConfig = await this.loadPrototypeConfig('default');
        }
        this.currentPrototype = new Prototype(prototypeName, prototypeConfig, this);
        await this.currentPrototype.loadAssets();
        this.currentFloor = 1;
        this.floorStates.clear();
        await this.loadFloor(this.currentFloor, entryDirection);
    }

    /**
     * Build the Architect context object used for wildcard processing and entity spawning
     * @returns {Object} Context with engine resource accessors
     */
    buildArchitectContext() {
        return {
            getActorData: (type) => this.currentPrototype?.getActorData(type),
            getTileIdByName: (name) => this.spriteLibrary?.getTileIdByName(name),
            getPrototypeActors: () => this.currentPrototype?.actors,
            getMapGeneratorConfig: () => {
                const floorConfig = this.getFloorConfig(this.currentFloor);
                return floorConfig?.map_generator?.options || this.currentPrototype?.config?.map_generator?.options || {};
            },
            getActorAt: (x, y) => this.entityManager?.getActorAt(x, y),
            createActor: (x, y, type, actorData) => {
                const actor = new Actor(x, y, type, actorData, this);
                this.entityManager.addEntity(actor);
                actor.loadDefaultItems();
                return actor;
            }
        };
    }

    /**
     * Load a fresh floor within the current prototype
     * @param {number} floor - 1-indexed floor number
     * @param {string|null} entryDirection - 'from_above', 'from_below', or null
     * @param {Object|null} playerState - Serialized player state to restore (null on first load)
     */
    async loadFloor(floor, entryDirection, playerState = null) {
        const prototypeConfig = this.currentPrototype.config;
        const floorConfig = this.getFloorConfig(floor);

        // Determine map generator config: floor-specific overrides prototype-level
        const mapGenerator = floorConfig.map_generator ?? prototypeConfig.map_generator;

        this.mapManager = new Architect();
        const hasAuthoredMap = await this.checkForAuthoredMap(this.currentPrototype.name, floor);
        if (hasAuthoredMap) {
            const mapFile = floor === 1 ? 'map.tmj' : `${floor}.tmj`;
            await this.mapManager.loadTiledMap(`${globalVars.BASE_PATH}/prototypes/${this.currentPrototype.name}/${mapFile}`);
        } else {
            this.mapManager.generateProceduralMap(mapGenerator);
        }

        // Viewport: per-prototype viewport_width/height in tile columns/rows
        const mechanics = floorConfig.mechanics || prototypeConfig.mechanics || {};
        const vpW = mechanics.viewport_width || null;
        const vpH = mechanics.viewport_height || null;

        if (vpW && vpH && (vpW < this.mapManager.width || vpH < this.mapManager.height)) {
            this.viewportWidth = vpW;
            this.viewportHeight = vpH;
            this.viewportEnabled = true;
            this.aiMargin = mechanics.ai_margin ?? 5;
        } else {
            this.viewportWidth = this.mapManager.width;
            this.viewportHeight = this.mapManager.height;
            this.viewportEnabled = false;
            this.aiMargin = Infinity;
        }

        this.canvasWidth = this.viewportWidth * this.config.tileWidth;
        this.canvasHeight = this.viewportHeight * this.config.tileHeight;

        await this.initializeRenderer();

        this.entityManager = new EntityManager(this);

        await this.entityManager.spawnEntities(entryDirection);

        const architectContext = this.buildArchitectContext();

        await this.mapManager.processWildcards(architectContext);

        // Check for treasure room before pending doors are promoted to actors
        const treasureRoomChance = prototypeConfig.mechanics?.treasure_room ?? 0;
        let treasureRoomData = null;
        if (treasureRoomChance > 0 && ROT.RNG.getPercentage() <= treasureRoomChance) {
            treasureRoomData = this.mapManager.spawnTreasureRoom();
        }

        // Spawn switch puzzles (levers + gates, pressure plates, etc.)
        if (floorConfig.switch_puzzles) {
            this.mapManager.spawnSwitchPuzzles(floorConfig.switch_puzzles, architectContext);
        }

        this.mapManager.spawnPendingWalls(architectContext);
        this.mapManager.spawnPendingDoors(architectContext);
        this.mapManager.spawnPendingTorches(architectContext);
        this.mapManager.spawnPendingLava(architectContext);
        this.mapManager.spawnPendingLakes(architectContext);
        this.mapManager.spawnPendingSewage(architectContext);
        this.mapManager.spawnPendingPushableWalls(architectContext);
        this.mapManager.spawnPendingBridges(architectContext);
        this.mapManager.spawnPendingCollapsingFloors(architectContext);

        if (treasureRoomData) {
            this.entityManager.spawnTreasureRoomContents(treasureRoomData, architectContext);
        }

        // Stairway/gateway placement — after pending doors so getActorAt sees them
        if (!prototypeConfig.mechanics?.observer_mode) {
            const hasLevels = !!prototypeConfig.levels;
            const totalFloors = hasLevels ? prototypeConfig.levels.length : 1;

            this.ensureUpStairway();

            if (hasLevels && floor < totalFloors) {
                this.ensureDownStairway();
            }

            if (hasLevels && floor === totalFloors && prototypeConfig.next_level) {
                this.ensureGateway();
            }

            // Spawn or restore player
            if (playerState) {
                this.restorePlayerOnFloor(playerState, entryDirection);
            } else {
                this.spawnPlayerAtStairway(entryDirection);
            }
        }

        // Snap viewport to player's spawn position before rendering
        if (this.viewportEnabled && this.entityManager.player) {
            this.snapViewportToTile(this.entityManager.player.x, this.entityManager.player.y);
        }

        // Spawn random actors/items using floor-specific config
        this.entityManager.spawnRandomActorsFromConfig(floorConfig);

        // Spawn body segment chains for any chain_head actors
        this.entityManager.spawnChainCreatures();

        // Run cellular automata behaviors once to pre-calculate initial state
        this.entityManager.runCellularAutomataStep();

        this.mapManager.addBaseAndShadows();

        this.entityManager.initializeSwitchTints();
        this.renderer.renderTestPattern(this.mapManager);
        this.renderer.renderItems(this.entityManager);
        this.renderer.renderActors(this.entityManager);
        this.entityManager.initializeInventoryDisplays();

        // Update sidebar and proximity transparency for non-darkness levels
        // (darkness levels update both via updateLighting)
        if (!mechanics.darkness) {
            this.interfaceManager?.updateSidebar();
            this.renderer.updateProximityTransparency();
        }

        // Check initial submersion state for all actors (after sprites exist)
        for (const actor of this.entityManager.actors) {
            actor.updateSubmersionState();
        }

        // Store resolved floor mechanics for use in updateLighting()
        this._floorMechanics = mechanics;

        if (mechanics.darkness) {
            this.lightingManager = new LightingManager(this);
            this.lightingManager.initialize(
                this.mapManager.width,
                this.mapManager.height,
                mechanics
            );
            this.renderer.initializeDarkness(this.mapManager.width, this.mapManager.height);
            this.updateLighting();
        }

        // Apply viewport offset and visibility after all rendering/darkness is set up
        if (this.viewportEnabled) {
            this.applyViewportOffset();
            this.renderer.updateTileVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
            this.renderer.updateEntityVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
        }

        this.spawnPendingFallenActors();

        const startGameplay = () => {
            this.initializeTurnEngine();

            if (prototypeConfig.loaded_sound) {
                this.playSound(prototypeConfig.loaded_sound);
            }

            if (this.inputManager) {
                this.inputManager.enable();
                if (floor === 1 && prototypeConfig.description) {
                    this.inputManager.clearMessageStack();
                    this.inputManager.showMessage(prototypeConfig.description);
                } else if (floor > 1) {
                    this.inputManager.clearMessageStack();
                    this.inputManager.showMessage(`Floor ${floor}`);
                }
            }

            this.updateInfoDisplay();
        };

        console.log(`Floor ${floor} loaded successfully`);
        console.log(`Map size: ${this.mapManager.width}x${this.mapManager.height} tiles`);
        if (this.viewportEnabled) {
            console.log(`Viewport: ${this.viewportWidth}x${this.viewportHeight} tiles, section (${this.sectionCol},${this.sectionRow}), origin (${this.sectionOriginX},${this.sectionOriginY})`);
        }
        console.log(`Canvas size: ${this.canvasWidth}x${this.canvasHeight}px`);
        console.log(`Walkable tiles: ${this.mapManager.walkableTiles.length}`);
        console.log(`Actors spawned: ${this.entityManager.actors.length}`);
        console.log(`Items spawned: ${this.entityManager.items.length}`);

        const shouldShowSplash = (floor === 1 && !playerState);

        if (shouldShowSplash) {
            if (this.inputManager) this.inputManager.disable();

            const player = this.entityManager.player;
            let originX, originY;
            if (player) {
                originX = this.viewportEnabled ? player.x - this.sectionOriginX : player.x;
                originY = this.viewportEnabled ? player.y - this.sectionOriginY : player.y;
            } else {
                originX = Math.floor(this.viewportWidth / 2);
                originY = Math.floor(this.viewportHeight / 2);
            }

            this.renderer.showSplash(this.viewportWidth, this.viewportHeight, originX, originY);

            const canvas = this.app.view;
            const dismiss = () => {
                canvas.removeEventListener('click', dismiss);
                canvas.removeEventListener('touchend', onTouch);
                document.removeEventListener('keydown', dismiss);
                this.renderer.dismissSplash(startGameplay);
            };
            const onTouch = (e) => {
                e.preventDefault();
                dismiss();
            };
            canvas.addEventListener('click', dismiss);
            canvas.addEventListener('touchend', onTouch);
            document.addEventListener('keydown', dismiss);
        } else {
            startGameplay();
        }
    }

    /**
     * Restore a previously visited floor from saved state
     * @param {number} floor - 1-indexed floor number
     * @param {Object} playerState - Serialized player state
     * @param {string} entryDirection - 'from_above' or 'from_below'
     */
    async restoreFloor(floor, playerState, entryDirection) {
        const prototypeConfig = this.currentPrototype.config;
        const saved = this.floorStates.get(floor);

        // Restore RNG state if available
        if (saved.rngState && typeof ROT !== 'undefined') {
            ROT.RNG.setState(saved.rngState);
        }

        this.mapManager = new Architect();
        this.mapManager.deserializeMap(saved.map);

        // Viewport setup — use floor-specific mechanics (includes ambient_light, etc.)
        const floorConfig = this.getFloorConfig(floor);
        const mechanics = floorConfig.mechanics || prototypeConfig.mechanics || {};
        const vpW = mechanics.viewport_width || null;
        const vpH = mechanics.viewport_height || null;

        if (vpW && vpH && (vpW < this.mapManager.width || vpH < this.mapManager.height)) {
            this.viewportWidth = vpW;
            this.viewportHeight = vpH;
            this.viewportEnabled = true;
            this.aiMargin = mechanics.ai_margin ?? 5;
        } else {
            this.viewportWidth = this.mapManager.width;
            this.viewportHeight = this.mapManager.height;
            this.viewportEnabled = false;
            this.aiMargin = Infinity;
        }

        this.canvasWidth = this.viewportWidth * this.config.tileWidth;
        this.canvasHeight = this.viewportHeight * this.config.tileHeight;

        await this.initializeRenderer();

        this.entityManager = new EntityManager(this);

        // Restore saved entities (non-player)
        this.entityManager.deserializeEntities(saved.entities);

        // Restore player
        this.restorePlayerOnFloor(playerState, entryDirection);

        this.mapManager.addBaseAndShadows();

        this.entityManager.initializeSwitchTints();
        this.renderer.renderTestPattern(this.mapManager);
        this.renderer.renderItems(this.entityManager);
        this.renderer.renderActors(this.entityManager);
        this.entityManager.initializeInventoryDisplays();

        // Snap viewport to player
        if (this.viewportEnabled && this.entityManager.player) {
            this.snapViewportToTile(this.entityManager.player.x, this.entityManager.player.y);
        }

        if (!mechanics.darkness) {
            this.interfaceManager?.updateSidebar();
        }

        for (const actor of this.entityManager.actors) {
            actor.updateSubmersionState();
        }

        if (mechanics.darkness) {
            this.lightingManager = new LightingManager(this);
            this.lightingManager.initialize(
                this.mapManager.width,
                this.mapManager.height,
                mechanics
            );
            this.renderer.initializeDarkness(this.mapManager.width, this.mapManager.height);
            this.updateLighting();
        }

        if (this.viewportEnabled) {
            this.applyViewportOffset();
            this.renderer.updateTileVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
            this.renderer.updateEntityVisibility(
                this.sectionOriginX, this.sectionOriginY,
                this.viewportWidth, this.viewportHeight
            );
        }

        this.spawnPendingFallenActors();

        this.initializeTurnEngine();

        this.inputManager?.clearMessageStack();
        this.inputManager?.showMessage(`Floor ${floor}`);

        this.updateInfoDisplay();
        console.log(`Floor ${floor} restored from saved state`);
    }

    /**
     * Update the info display with the current prototype name and floor
     */
    updateInfoDisplay() {
        const nameEl = document.getElementById('info-name');
        const floorEl = document.getElementById('info-floor');
        if (!nameEl) return;
        nameEl.textContent = this.currentPrototype?.config?.name || '';
        if (floorEl) {
            const hasLevels = !!this.currentPrototype?.config?.levels;
            const totalFloors = hasLevels ? this.currentPrototype.config.levels.length : 1;
            floorEl.textContent = totalFloors > 1 ? `Floor ${this.currentFloor}` : '';
        }
    }

    /**
     * Restore the player on a floor at the appropriate stairway position
     * @param {Object} playerState - Serialized player data
     * @param {string} entryDirection - 'from_above' or 'from_below'
     */
    restorePlayerOnFloor(playerState, entryDirection) {
        const playerData = this.currentPrototype.getActorData('player');
        if (!playerData) {
            console.error('No player actor data found in prototype');
            return;
        }

        // Remove map-spawned player if one exists (we're restoring from saved state)
        if (this.entityManager.player) {
            this.entityManager.removeEntity(this.entityManager.player);
        }

        let spawnX, spawnY;

        if (entryDirection === 'from_fall') {
            const walkableTiles = this.mapManager.walkableTiles;
            const available = walkableTiles.filter(t => !this.entityManager.getActorAt(t.x, t.y));
            const tile = available.length > 0
                ? available[Math.floor(ROT.RNG.getUniform() * available.length)]
                : walkableTiles[0];
            spawnX = tile?.x ?? 1;
            spawnY = tile?.y ?? 1;
        } else {
            let targetStairwayType;
            if (entryDirection === 'from_above') {
                targetStairwayType = 'up';
            } else if (entryDirection === 'from_below') {
                targetStairwayType = 'down';
            } else {
                targetStairwayType = 'up';
            }
            const stairway = this.entityManager.findActorByAttribute('stairway', targetStairwayType);
            spawnX = stairway ? stairway.x : (this.mapManager.walkableTiles[0]?.x ?? 1);
            spawnY = stairway ? stairway.y : (this.mapManager.walkableTiles[0]?.y ?? 1);
        }

        const player = new Actor(spawnX, spawnY, 'player', playerData, this);
        player.deserialize(playerState);
        player.x = spawnX;
        player.y = spawnY;
        this.entityManager.addEntity(player);
    }
    
    async loadPrototypeConfig(prototypeName) {
        try {
            const response = await fetch(`${globalVars.BASE_PATH}/prototypes/${prototypeName}/prototype.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.warn(`Prototype "${prototypeName}" not found, falling back to default`);
            if (prototypeName !== 'default') {
                return null;
            }
            return this.getDefaultPrototypeConfig();
        }
    }

    async checkForAuthoredMap(prototypeName, floor = 1) {
        const mapFile = floor === 1 ? 'map.tmj' : `${floor}.tmj`;
        try {
            const response = await fetch(`${globalVars.BASE_PATH}/prototypes/${prototypeName}/${mapFile}`, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get the config for a specific floor, merging floor overrides with prototype defaults
     * @param {number} floor - 1-indexed floor number
     * @returns {Object} Merged floor configuration
     */
    getFloorConfig(floor) {
        const config = this.currentPrototype.config;
        if (!config.levels) return config; // legacy: prototype-level config IS the floor config
        const floorOverride = config.levels[floor - 1] || {};
        return {
            win_conditions: floorOverride.win_conditions ?? config.win_conditions ?? [],
            random_actors: floorOverride.random_actors ?? config.random_actors ?? {},
            random_items: floorOverride.random_items ?? config.random_items ?? {},
            traps: floorOverride.traps ?? config.traps ?? null,
            map_generator: floorOverride.map_generator ?? config.map_generator,
            mechanics: { ...(config.mechanics || {}), ...(floorOverride.mechanics || {}) },
            switch_puzzles: floorOverride.switch_puzzles ?? config.switch_puzzles ?? null,
            item_budget: floorOverride.item_budget ?? config.item_budget ?? null,
        };
    }

    getDefaultPrototypeConfig() {
        return {
            name: "Default Prototype",
            mechanics: {
                fog_of_war: false,
                darkness: false,
                turn_based: true
            },
            stats: {
                health: { max: 1, current: 1 }
            },
            inventory: { max_items: 10 },
            available_items: ["key", "sword"],
            available_actors: ["player", "skeleton", "wall"],
            win_conditions: ["reach_exit"]
        };
    }
    
    async transitionToPrototype(prototypeName, saveState = true, entryDirection = null) {
        if (saveState) {
            this.prototypeStack.push({
                name: this.currentPrototype.name,
                state: this.saveGameState()
            });
        }

        this.cleanup();
        // Reset floor state when transitioning to a new prototype
        this.currentFloor = 1;
        this.floorStates.clear();
        await this.loadPrototype(prototypeName, entryDirection);
    }

    async returnToPreviousPrototype() {
        if (this.prototypeStack.length === 0) {
            console.warn('No previous prototype to return to');
            return;
        }

        const previous = this.prototypeStack.pop();
        this.cleanup();
        await this.loadPrototype(previous.name);
        this.restoreGameState(previous.state);
    }

    /**
     * Check if all win conditions for the current prototype are met
     * @returns {boolean} True if all win conditions are satisfied
     */
    checkWinConditions() {
        const config = this.currentPrototype?.config;
        // Use floor-specific win conditions if multi-level prototype
        const floorConfig = config?.levels ? this.getFloorConfig(this.currentFloor) : config;
        const winConditions = floorConfig?.win_conditions || [];

        // No conditions = always unlocked
        if (winConditions.length === 0) return true;

        const player = this.entityManager?.player;
        if (!player) return false;

        for (const condition of winConditions) {
            if (!this.checkWinCondition(condition, player)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check a single win condition
     * @param {string|object} condition - The condition to check
     * @param {Actor} player - The player actor
     * @returns {boolean} True if condition is met
     */
    checkWinCondition(condition, player) {
        if (typeof condition === 'string') {
            // Format: "wearing:item_type" - player must have item equipped
            if (condition.startsWith('wearing:')) {
                const itemType = condition.substring(8);
                return player.inventory.some(item =>
                    item.type === itemType && player.isItemEquipped(item)
                );
            }
            // Format: "holding:item_type" - player must have item in inventory
            if (condition.startsWith('holding:')) {
                const itemType = condition.substring(8);
                return player.inventory.some(item => item.type === itemType);
            }
            // Format: "killed:actor_type" - all actors of type must be dead
            if (condition.startsWith('killed:')) {
                const actorType = condition.substring(7);
                return !this.entityManager.actors.some(actor =>
                    actor.type === actorType && !actor.isDead
                );
            }
        }

        if (typeof condition === 'object') {
            const { actor: actorTarget, stat, op, value } = condition;
            if (stat && op !== undefined && value !== undefined) {
                let target = null;
                if (actorTarget === 'player') {
                    target = player;
                } else if (actorTarget) {
                    target = this.entityManager.actors.find(
                        a => a.type === actorTarget && !a.isDead
                    );
                } else {
                    target = player;
                }
                if (!target) return false;
                const current = target.stats?.[stat]?.current ?? target.getAttribute(stat);
                if (current === undefined || current === null) return false;
                switch (op) {
                    case '>':  return current > value;
                    case '>=': return current >= value;
                    case '<':  return current < value;
                    case '<=': return current <= value;
                    case '==': return current == value;
                    case '!=': return current != value;
                }
            }
        }

        console.warn(`Unknown win condition: ${condition}`);
        return false;
    }

    /**
     * Unlock all locked stairways when win conditions are met
     * This is called when a win condition is triggered (e.g., equipping an item)
     */
    unlockWinConditionStairways() {
        const stairways = this.entityManager?.actors.filter(actor =>
            actor.hasAttribute('stairway') && actor.hasAttribute('locked')
        );

        if (stairways && stairways.length > 0) {
            for (const stairway of stairways) {
                stairway.setAttribute('locked', false);
                stairway.setAttribute('collision_description', null);
                stairway.open();
                stairway.name = 'Stairs Down';
            }

            this.playSound?.('lock');
            this.inputManager?.showMessage('The way forward is now open!', { style: 'discovery' });
        }

        // Reveal gateways when win conditions are met
        const gateways = this.entityManager?.actors.filter(a => a.hasAttribute('gateway'));
        if (gateways?.length > 0) {
            for (const gw of gateways) {
                gw.setAttribute('visible', true);
                gw.setAttribute('hidden', false);
                if (gw.spriteBase) gw.spriteBase.visible = true;
                if (gw.spriteTop) gw.spriteTop.visible = true;
            }
            this.playSound?.('magic');
            this.inputManager?.showMessage('A gateway has appeared!', { style: 'discovery' });
            // Apply visual effect
            if (this.renderer?.applyEffect) {
                this.renderer.applyEffect('gateway_reveal');
            }
        }
    }

    /**
     * Lock stairways when win conditions are no longer met
     * This is called when a win condition is broken (e.g., unequipping an item)
     */
    lockWinConditionStairways() {
        // Find stairways that were unlocked (have openable attribute and are open)
        const stairways = this.entityManager?.actors.filter(actor =>
            actor.hasAttribute('stairway') &&
            actor.hasAttribute('openable') &&
            actor.hasAttribute('open')
        );

        if (!stairways || stairways.length === 0) return;

        for (const stairway of stairways) {
            stairway.setAttribute('locked', true);
            stairway.setAttribute('open', false);
            stairway.setAttribute('solid', true);
            stairway.setAttribute('collision_description', 'The stairs are sealed. You must fulfill your quest first.');
            stairway.name = 'Sealed Stairs';

            // Update tiles back to locked appearance
            if (stairway.tileIndexBase && stairway.spriteBase) {
                const tileset = PIXI.Loader.shared.resources.tiles;
                const rect = new PIXI.Rectangle(
                    stairway.tileIndexBase.x * globalVars.TILE_WIDTH,
                    stairway.tileIndexBase.y * globalVars.TILE_HEIGHT,
                    globalVars.TILE_WIDTH,
                    globalVars.TILE_HEIGHT
                );
                stairway.spriteBase.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
            }
        }

        // Re-hide gateways when win conditions break
        const gateways = this.entityManager?.actors.filter(a => a.hasAttribute('gateway'));
        if (gateways?.length > 0) {
            for (const gw of gateways) {
                gw.setAttribute('visible', false);
                gw.setAttribute('hidden', true);
                if (gw.spriteBase) gw.spriteBase.visible = false;
                if (gw.spriteTop) gw.spriteTop.visible = false;
            }
        }

        this.inputManager?.showMessage('The way forward is sealed once more.', { style: 'warning' });
    }

    /**
     * Use a gateway to transition to the next prototype
     * Called when player steps on a visible gateway on the last floor
     */
    async useGateway() {
        const config = this.currentPrototype.config;
        if (config.next_level) {
            console.log(`Using gateway to transition to ${config.next_level}`);
            this.floorStates.clear();
            this.currentFloor = 1;
            await this.transitionToPrototype(config.next_level, true, 'from_above');
        }
    }

    /**
     * Use a stairway to transition to another level
     * @param {string} direction - 'up' or 'down'
     */
    async useStairway(direction) {
        const config = this.currentPrototype.config;

        if (!config.levels) {
            // LEGACY: stairways go between prototypes (unchanged behavior)
            let targetLevel = null;

            if (direction === 'down' && config.next_level) {
                targetLevel = config.next_level;
            } else if (direction === 'up' && config.previous_level) {
                targetLevel = config.previous_level;
            }

            if (targetLevel) {
                console.log(`Using stairway ${direction} to ${targetLevel}`);
                const entryDirection = direction === 'down' ? 'from_above' : 'from_below';
                await this.transitionToPrototype(targetLevel, true, entryDirection);
            } else {
                console.log(`No ${direction === 'down' ? 'next' : 'previous'} level configured`);
            }
            return;
        }

        // NEW: stairways go between floors within the prototype
        const totalFloors = config.levels.length;
        if (direction === 'down' && this.currentFloor < totalFloors) {
            await this.transitionToFloor(this.currentFloor + 1, 'from_above');
        } else if (direction === 'up') {
            if (this.currentFloor > 1) {
                await this.transitionToFloor(this.currentFloor - 1, 'from_below');
            } else if (config.previous_level) {
                await this.transitionToPrototype(config.previous_level, true, 'from_below');
            }
        }
    }

    /**
     * Check if a tile is visible to the player
     * Returns true if darkness is disabled (lit prototype) or if the tile is within view
     * @param {number} x - Tile x coordinate
     * @param {number} y - Tile y coordinate
     * @returns {boolean} True if the tile is visible or darkness is disabled
     */
    isTileVisible(x, y) {
        return this.lightingManager ? this.lightingManager.isVisible(x, y) : true;
    }

    /**
     * Check if a tile has been explored by the player
     * Returns true if darkness is disabled (lit prototype) or if the tile has been seen
     * @param {number} x - Tile x coordinate
     * @param {number} y - Tile y coordinate
     * @returns {boolean} True if the tile is explored or darkness is disabled
     */
    isTileExplored(x, y) {
        return this.lightingManager ? this.lightingManager.isExplored(x, y) : true;
    }

    /**
     * Spawn the player at the appropriate stairway based on entry direction
     * @param {string|null} entryDirection - 'from_above', 'from_below', or null for direct load
     */
    spawnPlayerAtStairway(entryDirection) {

        if (this.entityManager.player) {
            console.log('Player already exists from map, skipping stairway spawn');
            return;
        }

        // Determine which stairway to spawn at
        // from_above (descended) = spawn at up_stairway (the stairs leading back up)
        // from_below (ascended) = spawn at down_stairway (the stairs leading back down)
        // from_fall = random walkable tile (fell through collapsed floor)
        // direct load = spawn at up_stairway if it exists
        const playerData = this.currentPrototype.getActorData('player');
        if (!playerData) {
            console.error('No player actor data found in prototype');
            return;
        }

        if (entryDirection === 'from_fall' || entryDirection === null) {
            const walkableTiles = this.mapManager.walkableTiles;
            const available = walkableTiles.filter(t => !this.entityManager.getActorAt(t.x, t.y));
            if (available.length > 0) {
                const tile = available[Math.floor(ROT.RNG.getUniform() * available.length)];
                console.log(`Spawning player at random tile (${tile.x}, ${tile.y}) — entry: ${entryDirection}`);
                const player = new Actor(tile.x, tile.y, 'player', playerData, this);
                this.entityManager.addEntity(player);
                player.loadDefaultItems();
                return;
            }
        }

        let targetStairwayType;
        if (entryDirection === 'from_above') {
            targetStairwayType = 'up';
        } else if (entryDirection === 'from_below') {
            targetStairwayType = 'down';
        } else {
            targetStairwayType = 'up';
        }

        const stairway = this.entityManager.findActorByAttribute('stairway', targetStairwayType);

        if (stairway) {
            console.log(`Spawning player at ${targetStairwayType} stairway (${stairway.x}, ${stairway.y})`);
            const player = new Actor(stairway.x, stairway.y, 'player', playerData, this);
            this.entityManager.addEntity(player);
            player.loadDefaultItems();
        } else {
            console.warn(`No ${targetStairwayType} stairway found to spawn player at`);
        }
    }

    /**
     * Ensure an up_stairway exists, spawning one randomly if needed
     * This is called after wildcard processing to place stairways in generated areas
     * If the prototype has no previous_level, spawns a locked_up_stairway instead
     */
    ensureUpStairway() {
        // Don't place an up stairway on the top floor of a prototype if there's nowhere to go
        const hasLevels = !!this.currentPrototype.config.levels;
        const isTopFloor = !hasLevels || this.currentFloor === 1;
        if (isTopFloor && !this.currentPrototype.config.previous_level) {
            return;
        }

        // Check if an up_stairway already exists
        const existingStairway = this.entityManager.findActorByAttribute('stairway', 'up');
        if (existingStairway) {
            console.log('Up stairway already exists at', existingStairway.x, existingStairway.y);
            return;
        }

        // No up_stairway found - spawn one on a random walkable tile
        const walkableTiles = this.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) {
            console.warn('No walkable tiles available to place up_stairway');
            return;
        }

        // Filter out tiles that already have actors on them
        const availableTiles = walkableTiles.filter(tile => {
            return !this.entityManager.getActorAt(tile.x, tile.y);
        });

        if (availableTiles.length === 0) {
            console.warn('No available tiles to place up_stairway');
            return;
        }

        // Pick a random tile using ROT.RNG for consistency
        const tile = randomElement(availableTiles);

        // If we got here, there's somewhere to go up to — use a regular up stairway
        const stairwayType = 'up_stairway';

        // Get the stairway actor data
        const stairwayData = this.currentPrototype.getActorData(stairwayType);
        if (!stairwayData) {
            console.warn(`No ${stairwayType} actor data found`);
            return;
        }

        // Spawn the stairway
        const stairway = new Actor(tile.x, tile.y, stairwayType, stairwayData, this);
        this.entityManager.addEntity(stairway);
        console.log(`Spawned ${stairwayType} at (${tile.x}, ${tile.y})`);
    }

    /**
     * Ensure a down_stairway exists on the current floor
     * Used in multi-level prototypes for non-final floors
     */
    ensureDownStairway() {
        const existingStairway = this.entityManager.findActorByAttribute('stairway', 'down');
        if (existingStairway) {
            console.log('Down stairway already exists at', existingStairway.x, existingStairway.y);
            return;
        }

        const walkableTiles = this.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) {
            console.warn('No walkable tiles available to place down_stairway');
            return;
        }

        const availableTiles = walkableTiles.filter(tile => {
            return !this.entityManager.getActorAt(tile.x, tile.y);
        });

        if (availableTiles.length === 0) {
            console.warn('No available tiles to place down_stairway');
            return;
        }

        const tile = randomElement(availableTiles);

        // Check if this floor has win conditions — if so, use locked_down_stairway
        const floorConfig = this.getFloorConfig(this.currentFloor);
        const hasWinConditions = floorConfig.win_conditions && floorConfig.win_conditions.length > 0;
        const stairwayType = hasWinConditions ? 'locked_down_stairway' : 'down_stairway';

        const stairwayData = this.currentPrototype.getActorData(stairwayType);
        if (!stairwayData) {
            console.warn(`No ${stairwayType} actor data found`);
            return;
        }

        const stairway = new Actor(tile.x, tile.y, stairwayType, stairwayData, this);
        this.entityManager.addEntity(stairway);
        console.log(`Spawned ${stairwayType} at (${tile.x}, ${tile.y})`);
    }

    /**
     * Ensure a gateway exists on the current floor (last floor of multi-level prototype)
     * Gateway is hidden by default, revealed when win conditions are met
     */
    ensureGateway() {
        // Check if a gateway already exists
        const existingGateway = this.entityManager.actors.find(a => a.hasAttribute('gateway'));
        if (existingGateway) {
            console.log('Gateway already exists at', existingGateway.x, existingGateway.y);
            return;
        }

        const walkableTiles = this.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) {
            console.warn('No walkable tiles available to place gateway');
            return;
        }

        const availableTiles = walkableTiles.filter(tile => {
            return !this.entityManager.getActorAt(tile.x, tile.y);
        });

        if (availableTiles.length === 0) {
            console.warn('No available tiles to place gateway');
            return;
        }

        const tile = randomElement(availableTiles);

        const gatewayData = this.currentPrototype.getActorData('gateway');
        if (!gatewayData) {
            console.warn('No gateway actor data found');
            return;
        }

        const gateway = new Actor(tile.x, tile.y, 'gateway', gatewayData, this);
        this.entityManager.addEntity(gateway);
        console.log(`Spawned hidden gateway at (${tile.x}, ${tile.y})`);
    }

    saveGameState() {
        return {
            player: this.entityManager.player.serialize(),
            entities: this.entityManager.serializeEntities(),
            map: this.mapManager.serializeMap()
        };
    }

    restoreGameState(state) {
        this.entityManager.player.deserialize(state.player);
        this.entityManager.deserializeEntities(state.entities);
        this.mapManager.deserializeMap(state.map);
    }

    /**
     * Save the current floor state (entities + map) for later restoration
     * Excludes the player entity since player carries across floors
     */
    saveFloorState() {
        const entities = this.entityManager.serializeEntities();
        const map = this.mapManager.serializeMap();
        // Exclude player from saved entities (player carries across floors)
        const nonPlayerEntities = entities.filter(e => e.type !== 'player');
        this.floorStates.set(this.currentFloor, {
            entities: nonPlayerEntities,
            map,
            rngState: typeof ROT !== 'undefined' ? ROT.RNG.getState() : null
        });
    }

    /**
     * Transition to a different floor within the same prototype
     * @param {number} targetFloor - 1-indexed target floor number
     * @param {string} entryDirection - 'from_above' or 'from_below'
     */
    async transitionToFloor(targetFloor, entryDirection) {
        console.log(`Transitioning from floor ${this.currentFloor} to floor ${targetFloor}`);

        // Save current floor state
        this.saveFloorState();

        // Save player state before cleanup
        const playerState = this.entityManager.player?.serialize();

        // Clean up current floor (entities, map, renderer — keep Prototype, assets)
        this.cleanupFloor();

        this.currentFloor = targetFloor;

        if (this.floorStates.has(targetFloor)) {
            // Restore previously visited floor
            await this.restoreFloor(targetFloor, playerState, entryDirection);
        } else {
            // Load fresh floor
            await this.loadFloor(targetFloor, entryDirection, playerState);
        }
    }

    async fallToNextFloor(actor) {
        const targetFloor = this.currentFloor + 1;
        const fallDamage = Math.floor(actor.stats?.health?.max * 0.3) || 10;
        console.log(`${actor.name} falls to floor ${targetFloor}, taking ${fallDamage} damage`);

        this.playSound?.('push1');
        await this.transitionToFloor(targetFloor, 'from_fall');

        const player = this.entityManager?.player;
        if (player) {
            player.modifyStat('health', -fallDamage);
            this.inputManager?.showMessage(`You crash down, injured from the fall! (-${fallDamage} health)`);
            if (player.stats?.health?.current <= 0) {
                player.die();
            }
        }
    }

    spawnPendingFallenActors() {
        const pending = this.pendingFallenActors.get(this.currentFloor);
        if (!pending || pending.length === 0) return;

        const walkableTiles = this.mapManager.walkableTiles;

        for (const data of pending) {
            const fallDamage = data._fallDamage || 0;
            delete data._fallDamage;

            const available = walkableTiles.filter(t =>
                !this.entityManager.getActorAt(t.x, t.y)
            );
            if (available.length === 0) continue;

            const tile = available[Math.floor(ROT.RNG.getUniform() * available.length)];
            const actorData = this.currentPrototype.getActorData(data.type);
            if (!actorData) continue;

            const actor = new Actor(tile.x, tile.y, data.type, actorData, this);
            actor.deserialize(data);
            actor.x = tile.x;
            actor.y = tile.y;
            this.entityManager.addEntity(actor);
            this.renderer?.createActorSprite(actor);

            if (fallDamage > 0 && actor.stats?.health) {
                actor.modifyStat('health', -fallDamage);
                if (actor.stats.health.current <= 0) {
                    actor.die();
                    continue;
                }
            }

            console.log(`${actor.name} landed from above at (${tile.x}, ${tile.y})`);
        }

        this.pendingFallenActors.delete(this.currentFloor);
    }

    /**
     * Clean up the current floor without destroying the app/renderer framework
     * Preserves prototype, assets, and audio — clears entities, map, and rendering
     */
    cleanupFloor() {
        if (this.turnEngine) {
            this.turnEngine.lock();
        }

        if (this.scheduler) {
            this.scheduler.clear();
        }

        if (this.entityManager) {
            this.entityManager.cleanup();
        }

        if (this.mapManager) {
            this.mapManager.cleanup();
        }

        if (this.renderer) {
            this.renderer.clear();
        }

        if (this.interfaceManager) {
            this.interfaceManager.clear();
        }

        if (this.app) {
            this.app.destroy(true, { children: true, texture: false, baseTexture: false });
            this.app = null;
            this.renderer = null;
            this.interfaceManager = null;
        }

        if (this.lightingManager) {
            this.lightingManager = null;
        }

        // Reset viewport state
        this.viewportEnabled = false;
        this.viewportWidth = null;
        this.viewportHeight = null;
        this.sectionCol = 0;
        this.sectionRow = 0;
        this.sectionOriginX = 0;
        this.sectionOriginY = 0;
        this.viewportOffsetX = 0;
        this.viewportOffsetY = 0;
    }
    
    cleanup() {

        if (this.turnEngine) {
            this.turnEngine.lock();
        }

        if (this.scheduler) {
            this.scheduler.clear();
        }

        if (this.entityManager) {
            this.entityManager.cleanup();
        }

        if (this.mapManager) {
            this.mapManager.cleanup();
        }

        if (this.renderer) {
            this.renderer.clear();
        }

        if (this.interfaceManager) {
            this.interfaceManager.clear();
        }

        if (this.app) {
            this.app.destroy(true, { children: true, texture: false, baseTexture: false });
            this.app = null;
            this.renderer = null;
            this.interfaceManager = null;
        }

        if (this.lightingManager) {
            this.lightingManager = null;
        }

        // Reset viewport state
        this.viewportEnabled = false;
        this.viewportWidth = null;
        this.viewportHeight = null;
        this.sectionCol = 0;
        this.sectionRow = 0;
        this.sectionOriginX = 0;
        this.sectionOriginY = 0;
        this.viewportOffsetX = 0;
        this.viewportOffsetY = 0;

        // Reset floor state
        this.currentFloor = 1;
        this.floorStates.clear();
    }
}

// ============================================================================
// PROTOTYPE CLASS  (levels)
// ============================================================================

class Prototype {
    constructor(name, config, engine) {
        this.name = name;
        this.config = config;
        this.engine = engine;
        this.basePath = `${globalVars.BASE_PATH}/prototypes/${name}/`;

        // Identification tracking: maps item type -> true if identified this session
        this.identifiedTypes = new Set();

        // Random color assignments: maps item type -> assigned color object
        // This ensures all instances of the same item type get the same random color
        this.itemColorAssignments = new Map();

        // Glyph name assignments: maps item type -> runic two-word string (e.g. "KZAMRN BIVUHL")
        // Ensures all instances of the same scroll type show the same unidentified name
        this.glyphNameAssignments = new Map();

        // Lock pairing system: tracks color-locked doors and their assigned colors
        // Each locked door gets a unique color, keys are assigned to match
        this.lockColors = [];           // Array of assigned lock colors (color objects)
        this.usedLockColors = new Set(); // Track which colors have been used
        this.unpairedLockColors = [];    // Colors assigned to doors but not yet to keys

        // Item catalog: category -> array of active item types for this run
        this.activeCatalog = new Map();
    }

    async loadAssets() {

        const prototypeActors = await this.loadJSON('actors.json', {});
        const prototypeItems = await this.loadJSON('items.json', {});
        const prototypePersonalities = await this.loadJSON('personalities.json', {});
        const prototypeEffects = await this.loadJSON('effects.json', {});
        const prototypeKeybindings = await this.loadJSON('keybindings.json', {});
        this.actors = { ...this.engine.globalActors, ...prototypeActors };
        this.items = { ...this.engine.globalItems, ...prototypeItems };
        this.personalities = { ...this.engine.globalPersonalities, ...prototypePersonalities };
        this.effects = { ...this.engine.globalEffects, ...prototypeEffects };
        this.keybindings = {
            actions: { ...this.engine.globalKeybindings?.actions, ...prototypeKeybindings.actions },
            global: { ...this.engine.globalKeybindings?.global, ...prototypeKeybindings.global },
            descriptions: { ...this.engine.globalKeybindings?.descriptions, ...prototypeKeybindings.descriptions }
        };
        this.engine.inputManager?.loadKeybindings(this.keybindings);

        // Load effects into the renderer's EffectRunner if available
        if (this.engine.renderer?.effectRunner) {
            this.engine.renderer.effectRunner.loadEffects(this.effects);
        }

        // Store prototype-specific keys for random distribution
        this.prototypeActorTypes = Object.keys(prototypeActors);
        this.prototypeItemTypes = Object.keys(prototypeItems);

        console.log(`Loaded assets for prototype: ${this.name}`);
        console.log(`  Actors: ${Object.keys(this.actors).length} (${this.prototypeActorTypes.length} prototype-specific)`);
        console.log(`  Items: ${Object.keys(this.items).length} (${this.prototypeItemTypes.length} prototype-specific)`);
        console.log(`  Personalities: ${Object.keys(this.personalities).length} (${Object.keys(prototypePersonalities).length} prototype-specific)`);

        this.initItemCatalog();
    }

    /**
     * Check if an item type has been identified in this prototype session
     */
    isTypeIdentified(itemType) {
        return this.identifiedTypes.has(itemType);
    }

    /**
     * Mark an item type as identified, affecting all items of that type
     */
    identifyType(itemType) {
        if (!this.identifiedTypes.has(itemType)) {
            this.identifiedTypes.add(itemType);
            console.log(`Item type '${itemType}' has been identified!`);

            // Update all existing items of this type
            if (this.engine.entityManager) {
                for (const item of this.engine.entityManager.items) {
                    if (item.type === itemType) {
                        item.identified = true;
                    }
                }
            }
        }
    }

    initItemCatalog() {
        const catalogConfig = this.config.item_catalog;
        if (!catalogConfig) return;

        for (const [category, catConfig] of Object.entries(catalogConfig)) {
            let pool = catConfig.pool;

            // If no explicit pool, fall back to the random_type pool from items.json
            if (!pool) {
                const metaItem = this.getItemData(category);
                if (metaItem?.random_type) {
                    pool = [...metaItem.random_type];
                }
            }

            if (!pool || pool.length === 0) {
                console.warn(`item_catalog: No pool found for category "${category}"`);
                continue;
            }

            let activeTypes;
            if (catConfig.count !== undefined && catConfig.count < pool.length) {
                // Shuffle and pick N types for this run
                const shuffled = [...pool];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                activeTypes = shuffled.slice(0, catConfig.count);
            } else {
                activeTypes = [...pool];
            }

            this.activeCatalog.set(category, activeTypes);
            console.log(`item_catalog: ${category} — ${activeTypes.length} types active: ${activeTypes.join(', ')}`);
        }
    }

    getCatalogStats(category) {
        const activeTypes = this.activeCatalog.get(category);
        if (!activeTypes) return null;
        const discovered = activeTypes.filter(t => this.identifiedTypes.has(t)).length;
        return { total: activeTypes.length, discovered };
    }

    getCatalogTypeForCategory(category) {
        const activeTypes = this.activeCatalog.get(category);
        if (!activeTypes || activeTypes.length === 0) return null;
        return activeTypes[Math.floor(ROT.RNG.getUniform() * activeTypes.length)];
    }

    /**
     * Get or assign a random color for an item type
     * Ensures all items of the same type get the same color within this prototype
     */
    getColorForItemType(itemType) {
        if (this.itemColorAssignments.has(itemType)) {
            return this.itemColorAssignments.get(itemType);
        }

        // Assign a random color from the global colors list
        const colors = this.engine.globalColors;
        if (colors && colors.length > 0) {
            const randomColor = randomElement(colors);
            this.itemColorAssignments.set(itemType, randomColor);
            console.log(`Assigned color '${randomColor.color}' (${randomColor.hex}) to item type '${itemType}'`);
            return randomColor;
        }

        return null;
    }

    /**
     * Get or assign a runic two-word name for a scroll item type.
     * All instances of the same scroll type show the same greeked name within this prototype.
     */
    getOrAssignScrollName(itemType) {
        if (this.glyphNameAssignments.has(itemType)) {
            return this.glyphNameAssignments.get(itemType);
        }
        const words = this.engine.globalGlyphs?.words;
        if (words && words.length > 0) {
            const name = `${randomElement(words)} ${randomElement(words)}`;
            this.glyphNameAssignments.set(itemType, name);
            return name;
        }
        return 'ARCANE';
    }

    /**
     * Assign a unique color to a locked door
     * Each door gets its own color that a matching key must have
     * @returns {Object|null} The assigned color object {color, hex}
     */
    assignLockColor() {
        const colors = this.engine.globalColors;
        if (!colors || colors.length === 0) return null;

        // Find an unused color
        const availableColors = colors.filter(c => !this.usedLockColors.has(c.color));

        if (availableColors.length === 0) {
            // All colors used, pick a random one (allows duplicate colors)
            const color = randomElement(colors);
            this.lockColors.push(color);
            this.unpairedLockColors.push(color);
            console.log(`Assigned lock color '${color.color}' (reused, all colors taken)`);
            return color;
        }

        // Pick a random unused color
        const color = randomElement(availableColors);
        this.usedLockColors.add(color.color);
        this.lockColors.push(color);
        this.unpairedLockColors.push(color);
        console.log(`Assigned lock color '${color.color}' to door`);
        return color;
    }

    /**
     * Get a color for a key that matches an unpaired locked door
     * @returns {Object|null} The assigned color object {color, hex}
     */
    getKeyColor() {
        // If there are unpaired doors, assign the key to one of them
        if (this.unpairedLockColors.length > 0) {
            const color = this.unpairedLockColors.shift(); // Take the first unpaired color
            console.log(`Assigned key color '${color.color}' to match a door`);
            return color;
        }

        // No unpaired doors - this key won't match anything yet
        // Assign a random color (the door might be spawned later)
        const colors = this.engine.globalColors;
        if (colors && colors.length > 0) {
            const color = randomElement(colors);
            console.log(`Assigned key color '${color.color}' (no unpaired doors)`);
            return color;
        }

        return null;
    }

    async loadJSON(filename, defaultValue) {
        try {
            const response = await fetch(this.basePath + filename);
            return await response.json();
        } catch (error) {
            console.warn(`No ${filename} found for prototype ${this.name}, using defaults`);
            return defaultValue;
        }
    }
    
    getActorData(actorType) {
        return this.actors[actorType] || null;
    }
    
    getItemData(itemType) {
        return this.items[itemType] || null;
    }
    
    getPersonality(personalityName) {
        return this.personalities[personalityName] || null;
    }
}

// ============================================================================
// ENTITY SYSTEM
// ============================================================================

class Entity {
    constructor(x, y, type, engine) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.engine = engine;
        this.attributes = new Map();
        this.sprite = null;
        this.tint = 0xFFFFFF;
        this.zIndex = 1;
        this.setAttribute('flammable', true);
    }
    
    setAttribute(key, value) {
        this.attributes.set(key, value);
    }
    
    getAttribute(key) {
        if (!this.attributes.has(key)) return undefined;
        return this.attributes.get(key);
    }
    
    hasAttribute(key) {
        return this.attributes.has(key) && this.attributes.get(key);
    }

    die() {
        this.isDead = true;
        this.engine.entityManager?.removeEntity(this);
    }

    /**
     * Get the entity's name with appropriate article ("the", or none for proper nouns/mass nouns)
     * @param {boolean} capitalize - Whether to capitalize "The" (default false)
     * @returns {string} Name with article if appropriate
     */
    getNameWithArticle(capitalize = false) {
        const name = this.name;
        if (this.hasAttribute('proper_named') || this.hasAttribute('mass_noun')) {
            return name;
        }
        const article = capitalize ? 'The' : 'the';
        return `${article} ${name}`;
    }

    /**
     * Check if this entity is player-controlled
     * @returns {boolean}
     */
    isPlayerControlled() {
        return this.hasAttribute('controlled');
    }

    /**
     * Show a message to the player (only if this entity is player-controlled)
     * @param {string} message - The message to display
     */
    showMessage(message) {
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(message);
        }
    }

    /**
     * Play a sound effect
     * @param {string} soundName - The sound to play
     */
    playSound(soundName) {
        if (soundName) {
            this.engine.playSound?.(soundName);
        }
    }

    updatePosition(newX, newY) {
        this.x = newX;
        this.y = newY;
        if (this.sprite) {
            this.updateSpritePosition();
        }
    }
    
    updateSpritePosition() {
        // Override in subclasses
    }
    
    serialize() {
        return {
            x: this.x,
            y: this.y,
            type: this.type,
            name: this.name,
            attributes: Array.from(this.attributes.entries()),
            tint: this.tint
        };
    }

    deserialize(data) {
        this.x = data.x;
        this.y = data.y;
        this.type = data.type;
        if (data.name !== undefined) this.name = data.name;
        this.attributes = new Map(data.attributes);
        this.tint = data.tint;
    }
}

class Item extends Entity {
    constructor(x, y, type, data, engine) {
        super(x, y, type, engine);
        this.name = data.name || type;
        this.tileIndex = engine.spriteLibrary.resolveTile(data.tileIndex) || {x: 0, y: 0};
        this.height = 1;
        this.flipH = data.flipH || false;
        this.flipV = data.flipV || false;
        this.setAttribute('pickupable', true);
        this.setAttribute('visible', true);

        // Identification system
        this.unidentifiedTemplate = data.unidentified_template || null;
        this.identifiedTemplate = data.identified_template || null;
        // Store template variables for substitution (copy so we can modify per-instance)
        this.templateVars = { ...(data.template_vars || {}) };

        // Handle random color assignment for items with random_color flag
        if (data.random_color && engine.currentPrototype) {
            let assignedColor;

            // Keys use the lock pairing system - each key gets a color matching a door
            if (data.attributes?.key) {
                assignedColor = engine.currentPrototype.getKeyColor();
                if (assignedColor) {
                    // Store the lock_color for matching with doors
                    this.setAttribute('lock_color', assignedColor.color);
                }
            } else {
                // Other items (potions, etc.) use type-based color assignment
                assignedColor = engine.currentPrototype.getColorForItemType(type);
            }

            if (assignedColor) {
                // Set the color name for template substitution
                this.templateVars.color = assignedColor.color;
                // Set the tint from the hex value
                this.tint = parseTint(assignedColor.hex);
            } else {
                this.tint = parseTint(data.tint);
            }
        } else {
            this.tint = parseTint(data.tint);
        }

        // Handle glyph name assignment for items with random_glyph_name flag (scrolls)
        if (data.random_glyph_name && engine.currentPrototype) {
            const glyphName = engine.currentPrototype.getOrAssignScrollName(type);
            this.templateVars.glyph_name = glyphName;
        }

        // Identification status - check if this type was already identified
        if (data.identified === false) {
            if (data.attributes?.enchantable) {
                this.identified = false;
            } else {
                this.identified = engine.currentPrototype?.isTypeIdentified(type) ?? false;
            }
        } else {
            this.identified = data.identified ?? true;
        }

        // Use description template (shown when item is used)
        this.useDescription = data.use_description || null;

        if (data.attributes) {
            Object.entries(data.attributes).forEach(([key, value]) => {
                this.setAttribute(key, value);
            });
        }

        // Handle random effect generation for generic potions
        if (data.random_effect && engine.currentPrototype) {
            this.generateRandomEffect(engine);
        }

        // Handle random value (e.g., gold nuggets worth 1-10)
        if (data.random_value && Array.isArray(data.random_value) && data.random_value.length === 2) {
            const [min, max] = data.random_value;
            this.value = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        }

        // Initialize item stats (similar to Actor stats)
        // Supports per_turn modification for recharging items like staffs
        this.stats = {};
        if (data.stats) {
            for (const [stat, value] of Object.entries(data.stats)) {
                if (typeof value === 'object' && value.max !== undefined) {
                    this.stats[stat] = {
                        ...value, // Preserve all config (per_turn, ready_at, etc.)
                        current: value.current !== undefined ? value.current : (value.start !== undefined ? value.start : value.max),
                        per_turn: value.per_turn || 0
                    };
                } else {
                    // Simple numeric value - store as current/max object
                    this.stats[stat] = { current: value, max: value, per_turn: 0 };
                }
            }
        }

        this.count = 1;
        this.enchantment = data.enchantment ?? 0;

        // Roll random enchantment on spawn if enchant_range is defined and no explicit enchantment
        if (data.enchantment === undefined && data.attributes?.enchant_range) {
            const [min, max] = data.attributes.enchant_range;
            this.enchantment = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        }

        if (this.enchantment < 0 && this.hasAttribute('enchantable')) {
            this.setAttribute('cursed', true);
        }

        this.combatUseCount = 0;
    }

    /**
     * Process per-turn stat changes for this item (recharging, decay, etc.)
     * Called by the owner's act() method
     */
    processPerTurnStats() {
        if (!this.stats) return;

        for (const [statName, stat] of Object.entries(this.stats)) {
            if (typeof stat !== 'object' || stat.per_turn === undefined) continue;

            const perTurn = stat.per_turn;
            if (perTurn === 0) continue;

            const oldValue = stat.current;
            stat.current = Math.min(stat.max, Math.max(0, stat.current + perTurn));

            // Check if stat crossed the ready_at threshold (for charged items)
            if (stat.ready_at !== undefined) {
                const wasReady = oldValue >= stat.ready_at;
                const isReady = stat.current >= stat.ready_at;

                // Show message when item becomes ready
                if (!wasReady && isReady && stat.ready_message && this.owner?.isPlayerControlled()) {
                    const message = stat.ready_message.replace('[item_name]', this.getDisplayName ? this.getDisplayName() : this.name);
                    this.owner.engine.inputManager?.showMessage(message);
                }
            }

            // Check warning thresholds (fires when crossing below threshold * max)
            if (stat.warnings && this.owner?.hasAttribute('controlled')) {
                for (const warning of stat.warnings) {
                    const threshold = warning.threshold * stat.max;
                    if (oldValue > threshold && stat.current <= threshold) {
                        this.owner.engine.inputManager?.showMessage(warning.message);
                    }
                }
            }
        }
    }

    /**
     * Get the current value of an item stat
     * @param {string} statName - Name of the stat
     * @returns {number|null} Current value or null if stat doesn't exist
     */
    getStat(statName) {
        const stat = this.stats?.[statName];
        if (!stat) return null;
        return typeof stat === 'object' ? stat.current : stat;
    }

    /**
     * Check if an item stat is at or above its ready threshold
     * @param {string} statName - Name of the stat to check
     * @returns {boolean} True if stat is ready (at or above ready_at threshold)
     */
    isStatReady(statName) {
        const stat = this.stats?.[statName];
        if (!stat || typeof stat !== 'object') return true; // No stat or simple stat = always ready

        // Calculate threshold: ready_at takes priority, otherwise max / uses
        const uses = this.getAttribute('uses') || 1;
        const readyAt = stat.ready_at ?? Math.floor(stat.max / uses);

        return stat.current >= readyAt;
    }

    /**
     * Modify an item stat
     * @param {string} statName - Name of the stat
     * @param {number} amount - Amount to add (negative to subtract)
     * @returns {number|null} New value or null if stat doesn't exist
     */
    modifyStat(statName, amount) {
        const stat = this.stats?.[statName];
        if (!stat) return null;

        if (typeof stat === 'object') {
            stat.current = Math.min(stat.max, Math.max(0, stat.current + amount));
            return stat.current;
        } else {
            this.stats[statName] += amount;
            return this.stats[statName];
        }
    }

    /**
     * Generate a random stat effect for this item based on available player stats
     * Sets use_effect attribute and generates an appropriate description
     * @param {DungeonEngine} engine - The game engine
     */
    generateRandomEffect(engine) {
        const playerData = engine.currentPrototype.getActorData('player');
        const statNames = (playerData?.stats) ? Object.keys(playerData.stats) : [];

        // Build pool of applicable states (exclude those with attached_actor like burning)
        const stateEntries = Object.entries(engine.globalStates || {})
            .filter(([_, data]) => !data.attached_actor);

        if (statNames.length === 0 && stateEntries.length === 0) {
            this.templateVars.effect_description = 'It has no effect';
            return;
        }

        // Decide: state effect vs stat effect
        // If only one pool exists, use that; otherwise 50/50
        const useStateEffect = statNames.length === 0 ? true
            : stateEntries.length === 0 ? false
            : ROT.RNG.getUniform() < 0.5;

        if (useStateEffect) {
            // Pick a random state to apply
            const [stateName, stateData] = randomElement(stateEntries);
            this.setAttribute('use_effect', { apply_state: stateName });
            this.templateVars.effect_description = stateData.effect_description || stateData.name;
        } else {
            // Pick a random stat to modify
            const randomStat = randomElement(statNames);
            // 70% chance positive, 30% chance negative
            const isPositive = ROT.RNG.getUniform() < 0.7;
            const statValue = playerData.stats[randomStat];
            const maxStat = typeof statValue === 'object' ? statValue.max : statValue;
            let magnitude;
            if (maxStat >= 50) {
                magnitude = Math.floor(ROT.RNG.getUniform() * 21) + 5; // 5-25
            } else {
                magnitude = Math.floor(ROT.RNG.getUniform() * 5) + 1; // 1-5
            }
            const effectValue = isPositive ? magnitude : -magnitude;
            this.setAttribute('use_effect', { [randomStat]: effectValue });

            const statCapitalized = randomStat.charAt(0).toUpperCase() + randomStat.slice(1);
            this.templateVars.effect_description = effectValue > 0
                ? `It restores ${statCapitalized}`
                : `It drains ${statCapitalized}`;
        }
    }

    /**
     * Get the display name based on identification status
     * Processes templates like "[color] [name]" or "[name] of [reagents.reagents]"
     * Supports [file.key] syntax for random selection from global data (reagents, adjectives)
     * @returns {string} The name to display
     */
    getDisplayName() {
        const template = this.identified ? this.identifiedTemplate : this.unidentifiedTemplate;

        // If no template, return base name with enchantment suffix
        if (!template) {
            let name = this.name;
            if (this.identified !== false) {
                if (this.enchantment < 0 && this.hasAttribute('cursed')) {
                    name = `Cursed ${name}`;
                }
                if (this.enchantment && this.enchantment !== 0) {
                    const sign = this.enchantment > 0 ? '+' : '';
                    name += ` ${sign}${this.enchantment}`;
                }
            }
            return name;
        }

        // Process template by replacing [key] or [file.key] with values
        return template.replace(/\[([^\]]+)\]/g, (match, key) => {
            // Check templateVars first (includes previously resolved random values)
            if (this.templateVars[key] !== undefined) {
                return this.templateVars[key];
            }

            // Handle file.key syntax (e.g., [reagents.reagents], [adjectives.yucky])
            if (key.includes('.')) {
                const [file, category] = key.split('.');
                let dataSource = null;

                if (file === 'reagents') {
                    dataSource = this.engine.globalReagents;
                } else if (file === 'adjectives') {
                    dataSource = this.engine.globalAdjectives;
                } else if (file === 'substances') {
                    dataSource = this.engine.globalSubstances;
                }

                if (dataSource && dataSource[category] && dataSource[category].length > 0) {
                    // Pick a random value and store it so it's consistent
                    const randomValue = randomElement(dataSource[category]);
                    this.templateVars[key] = randomValue;
                    return randomValue;
                }
                return match;
            }

            // Check item properties
            if (this[key] !== undefined) {
                return this[key];
            }
            // Check attributes
            const attrValue = this.getAttribute(key);
            if (attrValue !== undefined) {
                return attrValue;
            }
            // Return the key itself if no substitution found
            return match;
        });
    }

    /**
     * Identify this item and all items of the same type in this prototype
     */
    identify() {
        this.identified = true;
        if (!this.hasAttribute('enchantable') && this.engine.currentPrototype) {
            this.engine.currentPrototype.identifyType(this.type);
        }
    }

    /**
     * Get the use description with template substitution
     * Supports [item_name], [key], and [adjectives.category] for random adjective selection
     * @returns {string|null} The processed use description or null if none
     */
    getUseDescription() {
        if (!this.useDescription) return null;

        let result = this.useDescription.replace(/\[([^\]]+)\]/g, (match, key) => {
            // Skip [a-an] - will be processed after all other substitutions
            if (key.toLowerCase() === 'a-an') {
                return match;
            }

            // Handle adjectives.category syntax (e.g., [adjectives.yucky])
            if (key.startsWith('adjectives.')) {
                const category = key.substring('adjectives.'.length);
                const adjectives = this.engine.globalAdjectives?.[category];
                if (adjectives && adjectives.length > 0) {
                    return adjectives[Math.floor(Math.random() * adjectives.length)];
                }
                return match;
            }

            // Handle special item_name key
            if (key === 'item_name') {
                return this.getDisplayName();
            }

            // Check templateVars
            if (this.templateVars[key] !== undefined) {
                return this.templateVars[key];
            }

            // Check item properties
            if (this[key] !== undefined) {
                return this[key];
            }

            // Check attributes
            const attrValue = this.getAttribute(key);
            if (attrValue !== undefined) {
                return attrValue;
            }

            // Return the key itself if no substitution found
            return match;
        });

        // Process [a-an] templates after all other substitutions
        return processArticleTemplates(result);
    }

    getDescription() {
        const raw = this.getAttribute('description');
        if (!raw) return null;
        return raw.replace(/\[([^\]]+)\]/g, (match, key) => {
            if (key.includes('.')) {
                const [file, category] = key.split('.');
                let source = null;
                if (file === 'substances') source = this.engine.globalSubstances;
                else if (file === 'adjectives') source = this.engine.globalAdjectives;
                else if (file === 'reagents') source = this.engine.globalReagents;
                if (source?.[category]?.length) {
                    if (this.templateVars[key] !== undefined) return this.templateVars[key];
                    const val = source[category][Math.floor(Math.random() * source[category].length)];
                    this.templateVars[key] = val;
                    return val;
                }
                return match;
            }
            if (key === 'damage') {
                const base = Math.abs(this.getAttribute('collision_effect')?.health || 0);
                return base + (this.enchantment || 0);
            }
            if (key === 'defense') {
                const wearDef = this.getAttribute('wear_effect')?.defense || 0;
                const passiveDef = this.getAttribute('passive_effect')?.defense || 0;
                return (wearDef || passiveDef) + (this.enchantment || 0);
            }
            if (key === 'strength') {
                return this.getAttribute('wear_effect')?.strength
                    || this.getAttribute('passive_effect')?.strength || 0;
            }
            if (key === 'knockback') {
                return this.getAttribute('knockback_distance') || 1;
            }
            if (key === 'critical_chance') {
                return this.getAttribute('critical_chance') || 0;
            }
            if (key === 'lifesteal') {
                return this.getAttribute('lifesteal_percent') || 0;
            }
            if (key === 'mining_power') {
                return this.getAttribute('mining_power') || 0;
            }
            const wearEff = this.getAttribute('wear_effect');
            if (wearEff && wearEff[key] !== undefined) return wearEff[key];
            const passive = this.getAttribute('passive_effect');
            if (passive && passive[key] !== undefined) return passive[key];
            if (this.templateVars[key] !== undefined) return this.templateVars[key];
            if (this[key] !== undefined) return this[key];
            const attr = this.getAttribute(key);
            if (attr !== undefined && typeof attr !== 'object') return attr;
            return match;
        });
    }

    /**
     * Update sprite position accounting for flip anchor offset
     */
    updateSpritePosition() {
        if (!this.sprite) return;

        let x = this.x * globalVars.TILE_WIDTH;
        let y = this.y * globalVars.TILE_HEIGHT;

        // Account for center anchor when item has flip
        if (this.flipH || this.flipV) {
            x += globalVars.TILE_WIDTH / 2;
            y += globalVars.TILE_HEIGHT / 2;
        }

        this.sprite.x = x;
        this.sprite.y = y;
    }

    use(actor) {
        console.log(`${actor.name} used ${this.name}`);
    }

    serialize() {
        return {
            ...super.serialize(),
            identified: this.identified,
            templateVars: { ...this.templateVars },
            stats: this.stats ? JSON.parse(JSON.stringify(this.stats)) : {},
            count: this.count,
            enchantment: this.enchantment,
            combatUseCount: this.combatUseCount || 0,
            isItem: true
        };
    }

    deserialize(data) {
        super.deserialize(data);
        if (data.identified !== undefined) this.identified = data.identified;
        if (data.templateVars) this.templateVars = { ...data.templateVars };
        if (data.stats) this.stats = JSON.parse(JSON.stringify(data.stats));
        if (data.count !== undefined) this.count = data.count;
        if (data.combatUseCount !== undefined) this.combatUseCount = data.combatUseCount;
        if (data.enchantment !== undefined) this.enchantment = data.enchantment;
    }
}

class Actor extends Entity {
    constructor(x, y, type, data, engine) {
        super(x, y, type, engine);
        this.name = data.name || type;
        this.height = 2;
        this.tint = parseTint(data.tint);
        this.originalTint = this.tint;
        this.flickerTint = data.flickerTint || false;
        this.rippleTint = data.rippleTint || false;
        this.visionRange = data.vision_range ?? 8;

        this.tileIndexBase = engine.spriteLibrary.resolveTile(data.tileIndexBase) || null;
        this.animationBase = data.animationBase || null;

        this.tileIndexTop = engine.spriteLibrary.resolveTile(data.tileIndexTop) || null;
        this.animationTop = data.animationTop || null;

        // Legacy support: if 'animated' is true with 'animation_frames', treat as animationBase
        if (data.animated && data.animation_frames) {
            this.animationBase = data.animation_frames;
        }

        this.flipBaseH = data.flipBaseH || false;
        this.flipBaseV = data.flipBaseV || false;
        this.flipTopH = data.flipTopH || false;
        this.flipTopV = data.flipTopV || false;

        this.tileIndexSide = engine.spriteLibrary.resolveTile(data.tileIndexSide) || null;
        this.animationSide = data.animationSide || null;
        this.flipSideH = data.flipSideH || false;
        this.flipSideV = data.flipSideV || false;
        this.sideOffset = data.sideOffset || { dx: 1, dy: 0 };

        this.facing = data.defaultFacing || 'left';
        this.defaultFacing = data.defaultFacing || 'left';
        this.facingEnabled = data.facingEnabled || false;

        this.spriteBase = null;
        this.spriteTop = null;
        this.spriteSide = null;

        this.equipment = {
            weapon: null,
            top: null,
            middle: null,
            lower: null,
            ring1: null,
            ring2: null
        };
        this.spriteEquipment = {
            weapon: null,
            top: null,
            middle: null,
            lower: null
        };
        

        this.stats = {};

        if (data.stats) {
            Object.entries(data.stats).forEach(([stat, value]) => {
                // Normalize to { max, current, per_turn, ... } format
                // Preserves additional config: fatal, death_message, warnings
                if (typeof value === 'object' && value.max !== undefined) {
                    this.stats[stat] = {
                        ...value, // Preserve all config (fatal, death_message, warnings, etc.)
                        current: value.current !== undefined ? value.current : value.max,
                        per_turn: value.per_turn || 0
                    };
                } else {
                    this.stats[stat] = { max: value, current: value, per_turn: 0 };
                }
            });
        }
        
        this.inventory = [];

        // Temporary states with durations (burning, poisoned, stunned, etc.)
        // Format: { stateName: { duration: N, attachedActor: ref, data: {...} } }
        this.states = {};

        this.personality = null;
        if (data.personality) {
            this.loadPersonality(data.personality);
        }
        
        // Default actor attributes
        this.setAttribute('solid', true);
        this.setAttribute('visible', true);
        this.setAttribute('hostile', false);
        this.setAttribute('sentient', false);
        
        // Apply data attributes
        if (data.attributes) {
            Object.entries(data.attributes).forEach(([key, value]) => {
                this.setAttribute(key, value);
            });
        }

        // Load top-level behavior properties as attributes
        if (data.collision_effect) {
            this.setAttribute('collision_effect', data.collision_effect);
        }
        if (data.collision_sound) {
            this.setAttribute('collision_sound', data.collision_sound);
        }
        if (data.collision_description) {
            this.setAttribute('collision_description', data.collision_description);
        }
        if (data.death_sound) {
            this.setAttribute('death_sound', data.death_sound);
        }
        if (data.death_description) {
            this.setAttribute('death_description', data.death_description);
        }

        // Copy lifetime for actors that expire (clouds, fire, etc.)
        this.lifetime = data.lifetime || null;

        // Copy light radius for actors with custom light range
        if (data.lightRadius !== undefined) {
            this.lightRadius = data.lightRadius;
        }

        // Store original data for behaviors that need custom properties (traps, fire, etc.)
        this.data = data;

        // Legacy support: load state properties as attributes (open, locked, etc.)
        // New format: define these directly in attributes instead of state
        if (data.state) {
            Object.entries(data.state).forEach(([key, value]) => {
                this.setAttribute(key, value);
            });
        }

        // Store alternate tile indices for state changes
        this.tileIndexBase_open = engine.spriteLibrary.resolveTile(data.tileIndexBase_open) || null;
        this.tileIndexTop_open = engine.spriteLibrary.resolveTile(data.tileIndexTop_open) || null;

        this.tileIndexBase_toggled = engine.spriteLibrary.resolveTile(data.tileIndexBase_toggled) || null;
        this.tileIndexTop_toggled = engine.spriteLibrary.resolveTile(data.tileIndexTop_toggled) || null;
        this.flipBaseV_toggled = data.flipBaseV_toggled || false;
        this.flipTopV_toggled = data.flipTopV_toggled || false;

        // Handle random color assignment for color-locked doors
        if (data.random_color && this.hasAttribute('color_locked') && engine.currentPrototype) {
            const assignedColor = engine.currentPrototype.assignLockColor();
            if (assignedColor) {
                this.setAttribute('lock_color', assignedColor.color);
                this.tint = parseTint(assignedColor.hex);
            }
        }

        // Apply innate states (permanent states defined in actor data)
        if (data.innate_states && engine.globalStates) {
            for (const stateName of data.innate_states) {
                const stateData = engine.globalStates[stateName];
                if (stateData) {
                    this.applyState(stateName, stateData, { duration: Infinity, silent: true });
                }
            }
        }

        this.isDead = false;

        // Equipping state for multi-turn armor equipping
        this._equippingItem = null;      // Item currently being equipped
        this._equippingTurnsLeft = 0;    // Turns remaining to finish equipping
        this._equippingTurnsTotal = 0;   // Total turns needed (for progress display)

        this._slowedToggle = false;      // Toggle for skip-every-other-turn (slowed state)
        this._extraActions = 0;          // Extra actions granted by haste
        this._knockedBack = false;       // Whether actor is staggered from knockback

        this.defaultItems = data.default_items || [];
    }

    hasAttribute(key) {
        if (super.hasAttribute(key)) return true;
        for (const state of Object.values(this.states)) {
            const immunity = state.data?.grants_immunity;
            if (immunity === key || (Array.isArray(immunity) && immunity.includes(key))) return true;
        }
        return false;
    }

    /**
     * Load default items into actor's inventory
     * Called after actor is spawned and prototype is available
     */
    loadDefaultItems() {
        if (!this.defaultItems.length) return;

        for (const itemType of this.defaultItems) {
            const itemData = this.engine.currentPrototype?.getItemData(itemType);
            if (!itemData) {
                console.warn(`Default item '${itemType}' not found for ${this.name}`);
                continue;
            }


            const item = new Item(-1, -1, itemType, itemData, this.engine);
            item.owner = this; // Track item owner for per-turn stat messages

            this.inventory.push(item);
            console.log(`${this.name} starts with ${item.name}`);

            // Check stat requirements before auto-equipping
            const { canEquip } = this.canEquipItem(item);
            if (!canEquip) continue;

            // Auto-equip weapons
            if (item.hasAttribute('weapon') && !this.equipment.weapon) {
                this.equipToSlot(item, 'weapon');
            }

            // Auto-equip wearable items
            const slot = item.getAttribute('wearable');
            if (slot && ['top', 'middle', 'lower'].includes(slot)) {
                this.equipToSlot(item, slot);
            }
            if (slot === 'ring') {
                const ringSlot = !this.equipment.ring1 ? 'ring1' :
                                 !this.equipment.ring2 ? 'ring2' : null;
                if (ringSlot) this.equipToSlot(item, ringSlot);
            }
        }

        // Merge stackable items (loadDefaultItems pushes directly, skipping pickUpItem merge)
        for (let i = this.inventory.length - 1; i >= 0; i--) {
            const item = this.inventory[i];
            if (!item.getAttribute('stackable') || Object.keys(item.stats).length > 0) continue;
            for (let j = 0; j < i; j++) {
                const existing = this.inventory[j];
                if (existing.type === item.type && existing.getAttribute('stackable') &&
                    Object.keys(existing.stats).length === 0) {
                    existing.count = (existing.count || 1) + (item.count || 1);
                    this.inventory.splice(i, 1);
                    break;
                }
            }
        }
    }

    open() {
        if (!this.hasAttribute('openable')) return;
        if (this.hasAttribute('locked')) {
            console.log(`${this.name} is locked`);
            this.engine.playSound?.('plunk3');
            return;
        }

        this.setAttribute('open', true);
        this.setAttribute('solid', false);

        this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase_open);
        this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop_open);

        this.playSound('plunk3');
        console.log(`${this.name} opened`);
        this.engine.inputManager?.showMessage(`The ${this.name} opens.`, { x: this.x, y: this.y });
    }

    close(silent = false) {
        if (!this.hasAttribute('openable')) return;

        this.setAttribute('open', false);
        this.setAttribute('solid', true);

        this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase);
        this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop);

        console.log(`${this.name} closed`);
        if (!silent) {
            this.engine.inputManager?.showMessage(`The ${this.name} closes.`, { x: this.x, y: this.y });
        }
    }

    toggle() {
        if (!this.hasAttribute('switchable')) return;
        if (this.hasAttribute('one_shot') && this.hasAttribute('toggled')) return;

        const nowToggled = !this.hasAttribute('toggled');
        this.setAttribute('toggled', nowToggled);

        if (nowToggled && this.tileIndexBase_toggled) {
            this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase_toggled);
            this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop_toggled);
            this._applyToggleFlip(this.spriteBase, this.flipBaseV_toggled, this.x, this.y);
            this._applyToggleFlip(this.spriteTop, this.flipTopV_toggled, this.x, this.y - 1);
        } else {
            this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase);
            this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop);
            this._applyToggleFlip(this.spriteBase, this.flipBaseV, this.x, this.y);
            this._applyToggleFlip(this.spriteTop, this.flipTopV, this.x, this.y - 1);
        }

        const sound = this.data?.switch_sound || this.getAttribute('collision_sound') || 'tap2';
        this.engine.playSound?.(sound);
        const message = this.data?.switch_message || `The ${this.name} clicks.`;
        this.engine.inputManager?.showMessage(message, { x: this.x, y: this.y });

        this._propagateSwitchEffects(nowToggled);
    }

    _applyToggleFlip(sprite, flipV, tileX, tileY) {
        if (!sprite) return;
        if (flipV) {
            sprite.anchor.set(0.5, 0.5);
            sprite.x = tileX * globalVars.TILE_WIDTH + globalVars.TILE_WIDTH / 2;
            sprite.y = tileY * globalVars.TILE_HEIGHT + globalVars.TILE_HEIGHT / 2;
            sprite.scale.y = -1;
        } else {
            sprite.anchor.set(0, 0);
            sprite.x = tileX * globalVars.TILE_WIDTH;
            sprite.y = tileY * globalVars.TILE_HEIGHT;
            sprite.scale.y = 1;
        }
    }

    _propagateSwitchEffects(activated) {
        const effects = this.data?.switch_effects;
        if (!effects) return;

        const machineId = this.getAttribute('machine_id');
        let targets;

        if (machineId) {
            targets = this.engine.entityManager.actors.filter(
                a => a !== this && !a.isDead && a.getAttribute('machine_id') === machineId
            );
        } else {
            const radius = this.data?.switch_radius || 10;
            targets = this.engine.entityManager.actors.filter(a => {
                if (a === this || a.isDead) return false;
                if (!a.hasAttribute('gate') && !a.hasAttribute('pedestal') && !a.hasAttribute('switchable')) return false;
                const dist = Math.abs(a.x - this.x) + Math.abs(a.y - this.y);
                return dist <= radius;
            });
        }

        for (const target of targets) {
            for (const [key, value] of Object.entries(effects)) {
                if (key === 'open') continue;
                if (activated) {
                    target.setAttribute(key, value);
                } else {
                    if (typeof value === 'boolean') {
                        target.setAttribute(key, !value);
                    }
                }
            }

            if (effects.visible !== undefined) {
                const nowVisible = activated ? effects.visible : !effects.visible;
                if (nowVisible) {
                    if (!target.spriteBase) {
                        this.engine.renderer.createActorSprites(target);
                    }
                    if (target.spriteBase) target.spriteBase.visible = true;
                    if (target.spriteTop) target.spriteTop.visible = true;
                } else {
                    if (target.spriteBase) target.spriteBase.visible = false;
                    if (target.spriteTop) target.spriteTop.visible = false;
                }
            }

            if (target.hasAttribute('openable') && effects.open !== undefined) {
                const shouldOpen = activated ? effects.open : !effects.open;
                if (shouldOpen) {
                    if (target.hasAttribute('locked')) target.setAttribute('locked', false);
                    target.open();
                } else {
                    target.close(true);
                }
            }

            target.flash?.();
        }

        this.engine.updateLighting();
    }

    updateInventoryDisplay() {
        if (!this.hasAttribute('display_inventory')) return;
        const item = this.inventory[0];
        if (item && item.tileIndex) {
            if (!this.spriteTop) {
                this.spriteTop = this.engine.renderer?.createActorSprite(
                    this, item.tileIndex, null,
                    this.x * globalVars.TILE_WIDTH,
                    (this.y - 1) * globalVars.TILE_HEIGHT,
                    11, {}
                );
            } else {
                this.engine.renderer?.updateSpriteTexture(this.spriteTop, item.tileIndex);
                this.spriteTop.visible = true;
            }
            if (this.spriteTop) this.spriteTop.tint = item.tint ?? 0xFFFFFF;
        } else if (this.spriteTop) {
            if (this.tileIndexTop) {
                this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop);
                this.spriteTop.tint = this.tint ?? 0xFFFFFF;
            } else {
                this.spriteTop.visible = false;
            }
        }
    }

    spike() {
        if (!this.hasAttribute('openable')) return false;
        if (this.hasAttribute('open')) return false;
        if (this.hasAttribute('locked')) return false;
        if (this.hasAttribute('spiked')) return false;

        this.setAttribute('spiked', true);
        if (!this.stats) this.stats = {};
        this.stats.health = { current: 30, max: 30 };

        this.engine.playSound?.('tap2');
        this.engine.inputManager?.showMessage(
            `You jam a spike into the ${this.name}.`, { x: this.x, y: this.y }
        );
        return true;
    }

    /**
     * Update the tile index for base or top sprite
     * @param {string|Object} tileRef - Tile name string or {x, y} coordinates
     * @param {string} layer - 'base' or 'top'
     */
    updateTileIndex(tileRef, layer = 'base') {
        const tileIndex = this.engine.spriteLibrary.resolveTile(tileRef);
        if (!tileIndex) return;

        if (layer === 'base' && this.spriteBase) {
            this.tileIndexBase = tileIndex;
            this.engine.renderer?.updateSpriteTexture(this.spriteBase, tileIndex);
        } else if (layer === 'top' && this.spriteTop) {
            this.tileIndexTop = tileIndex;
            this.engine.renderer?.updateSpriteTexture(this.spriteTop, tileIndex);
        }
    }

    loadPersonality(personalityName) {
        const personalityData = this.engine.currentPrototype.getPersonality(personalityName);
        if (personalityData) {
            this.personality = new Personality(personalityData, this);
        }
    }
    
    /**
     * Execute turn-based action (called by ROT.Engine)
     * @returns {Promise} Resolves when action is complete
     */
    act() {
        this.engine.entityManager.invalidateActorPosCache();

        // Viewport AI margin: skip entire turn for off-screen actors
        if (this.engine.viewportEnabled && !this.isPlayerControlled()) {
            const ox = this.engine.sectionOriginX;
            const oy = this.engine.sectionOriginY;
            const vw = this.engine.viewportWidth;
            const vh = this.engine.viewportHeight;
            const m = this.engine.aiMargin;
            if (this.x < ox - m || this.x >= ox + vw + m ||
                this.y < oy - m || this.y >= oy + vh + m) {
                return Promise.resolve();
            }
        }

        // Process per-turn stat changes (regeneration, hunger, poison, etc.)
        this.processPerTurnStats();
        if (this.isDead) return Promise.resolve(); // Died from stat depletion

        // Process per-turn stats for items in inventory (recharging staffs, etc.)
        this.processInventoryItemStats();

        // Process active states (burning, poisoned, stunned, etc.)
        this.processStates();
        if (this.isDead) return Promise.resolve(); // Died from state effect

        // Check if incapacitated by a state (stunned, sleeping, etc.)
        if (this.isIncapacitated()) {
            if (this.isPlayerControlled()) {
                this.engine.interfaceManager?.updateSidebar();
                return new Promise(resolve => setTimeout(resolve, 200));
            }
            return Promise.resolve();
        }

        // Check if slowed — skip every other turn
        if (this.hasStateProperty('skip_every_other_turn')) {
            this._slowedToggle = !this._slowedToggle;
            if (this._slowedToggle) {
                return Promise.resolve();
            }
        }

        // Check if nauseated — random chance to skip turn
        if (this.hasStateProperty('skip_turn_chance')) {
            const chance = this.getStatePropertyValue('skip_turn_chance');
            if (ROT.RNG.getUniform() < chance) {
                const name = this.isPlayerControlled() ? 'You' : this.name;
                const verb = this.isPlayerControlled() ? 'retch' : 'retches';
                const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };
                this.engine.inputManager?.showMessage(`${name} ${verb}!`, pos);
                this.engine.entityManager.spawnEntity('vomit', this.x, this.y);
                return Promise.resolve();
            }
        }

        // Player-controlled actors lock the engine and wait for input
        if (this.isPlayerControlled()) {
            // Grant extra actions from haste (set once per act() call)
            if (this.hasStateProperty('extra_turn')) {
                this._extraActions = 1;
            } else {
                this._extraActions = 0;
            }

            this.engine.turnEngine.lock();

            // Update player info box if visible (reflects stat changes from previous turn)
            this.engine.interfaceManager?.updatePlayerInfo();

            return Promise.resolve();
        }

        // Skip turn if staggered from knockback
        if (this._knockedBack) {
            this._knockedBack = false;
            return Promise.resolve();
        }

        // AI actors execute their personality behaviors
        if (this.personality) {
            this.personality.execute(this);

            // Hasted actors get a bonus action (no extra state processing)
            if (this.hasStateProperty('extra_turn') && !this.isDead) {
                this.personality.execute(this);
            }
        }

        // In observer mode, lock after each AI turn to allow paced playback
        if (!this.engine.hasControlledActor) {
            this.engine.turnEngine.lock();
        }

        return Promise.resolve();
    }
    
    modify(stat, amount) {
        if (this.stats[stat]) {
            this.stats[stat].current -= amount;
            if (this.stats[stat].current <= 0) {
                this.die();
            }
        }
    }

    /**
     * Centralized stat modification with immediate UI update
     * Use this method for all stat changes to ensure UI stays in sync
     * @param {string} statName - Name of stat to modify (e.g., 'health', 'nutrition')
     * @param {number} amount - Amount to add (negative for damage/reduction)
     * @param {Object} options - { skipUIUpdate: false, source: null }
     * @returns {number|null} New stat value, or null if stat doesn't exist
     */
    modifyStat(statName, amount, options = {}) {
        if (!this.stats || this.stats[statName] === undefined) {
            return null;
        }

        const stat = this.stats[statName];
        let oldValue, newValue;

        if (typeof stat === 'object' && stat.current !== undefined) {
            // Object format: { max, current }
            oldValue = stat.current;
            stat.current = Math.max(0, Math.min(stat.max, stat.current + amount));
            newValue = stat.current;
        } else if (typeof stat === 'number') {
            // Simple number format
            oldValue = stat;
            this.stats[statName] += amount;
            newValue = this.stats[statName];
        } else {
            return null;
        }

        console.log(`${this.name}'s ${statName}: ${oldValue} -> ${newValue} (${amount >= 0 ? '+' : ''}${amount})`);

        // Trigger immediate UI updates
        if (!options.skipUIUpdate) {
            // Update player info box if this is the player
            if (this.isPlayerControlled()) {
                this.engine.interfaceManager?.updatePlayerInfo();
            }
            // Update sidebar actor list (shows all actors' health thermometers)
            this.engine.interfaceManager?.updateActorsDiv();
        }

        // Note: Death is handled by applyCollisionEffects AFTER showing the attack message
        // Don't call die() here to avoid double death and wrong message order

        return newValue;
    }
    
    /**
     * Kill the actor
     * @param {boolean} spawnRemains - Whether to spawn remains entity (default: true)
     */
    die(spawnRemains = true) {
        this.isDead = true;
        this.setAttribute('solid', false);

        // Show death message for visible actors (skip for mass nouns like clouds)
        if (this.hasAttribute('visible') && !this.hasAttribute('mass_noun')) {
            if (this.hasAttribute('spiked') && this.hasAttribute('openable')) {
                this.engine.inputManager?.showMessage(`The ${this.name} splinters open!`, { x: this.x, y: this.y });
            } else if (this.isPlayerControlled()) {
                const restartKey = Object.entries(this.engine.inputManager?.globalKeyMap || {})
                    .find(([, action]) => action === 'reload')?.[0] || 'R';
                this.engine.inputManager?.showMessage(`You die... \n Press ${restartKey} to restart`, { style: 'danger' });
            } else if (this.getAttribute('death_description')) {
                this.engine.inputManager?.showMessage(this.getAttribute('death_description'), { x: this.x, y: this.y });
            } else if (!this.stats || this.stats.health === undefined) {
                // Actors without health (breakable objects like walls)
                this.engine.inputManager?.showMessage(`The ${this.name} crumbles.`, { x: this.x, y: this.y });
            } else {
                this.engine.inputManager?.showMessage(`The ${this.name} dies.`, { x: this.x, y: this.y });
            }
        }

        // Play death sound if specified
        const deathSound = this.getAttribute('death_sound');
        if (deathSound) {
            this.engine.playSound?.(deathSound);
        }

        // Drop items (if not already dropped by fall())
        if (this.inventory.length > 0) {
            this.dropItems(false);
        }

        // Spawn remains entity if specified (not when falling into void)
        if (spawnRemains) {
            const remains = this.getAttribute('remains');
            if (remains) {
                this.engine.entityManager.spawnEntity(remains, this.x, this.y);
            }

            // Check for lode drop (e.g., rock_wall drops gold_nugget)
            const lode = this.getAttribute('lode');
            const lodeChance = this.getAttribute('lode_chance') || 0;
            if (lode && lodeChance > 0) {
                const roll = ROT.RNG.getPercentage();
                if (roll <= lodeChance) {
                    const droppedItem = this.engine.entityManager.spawnItem(lode, this.x, this.y);
                    if (droppedItem) {
                        console.log(`${this.name} dropped ${droppedItem.name}!`);
                        if (this.engine.inputManager) {
                            const displayName = droppedItem.getDisplayName ? droppedItem.getDisplayName() : droppedItem.name;
                            this.engine.inputManager.showMessage(`A ${displayName} falls from the rubble!`, { x: this.x, y: this.y });
                        }
                    }
                }
            }
        }

        if (this.spriteBase) {
            this.spriteBase.visible = false;
        }
        if (this.spriteTop) {
            this.spriteTop.visible = false;
        }
        if (this.spriteSide) {
            this.spriteSide.visible = false;
        }

        // Hide equipment sprites
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.spriteEquipment[slot]) {
                this.spriteEquipment[slot].visible = false;
            }
        }

        if (this.engine.scheduler) {
            this.engine.scheduler.remove(this);
        }

        // If this was the controlled actor, transition to observer mode
        if (this.isPlayerControlled()) {
            this.engine.onControlledActorDied();
        }

        // Check if this death triggers win conditions
        if (!this.isPlayerControlled() && this.engine.checkWinConditions()) {
            this.engine.unlockWinConditionStairways();
        }

        // Update sidebar to reflect death
        this.engine.interfaceManager?.updateSidebar();
    }

    pickUpItem(item) {
        // Check if actor has inventory capacity (inventory attribute)
        const maxInventory = this.getAttribute('inventory');
        if (maxInventory === undefined || maxInventory <= 0) {
            // Actor cannot carry items
            return false;
        }

        // Merge stackable items with no stats into existing stacks
        if (item.getAttribute('stackable') && Object.keys(item.stats).length === 0) {
            const existing = this.inventory.find(inv =>
                inv.type === item.type &&
                inv.getAttribute('stackable') &&
                Object.keys(inv.stats).length === 0
            );
            if (existing) {
                existing.count = (existing.count || 1) + (item.count || 1);
                this.engine.entityManager.removeEntity(item);
                if (this.isPlayerControlled()) {
                    this.engine.playSound(item.getAttribute('pickup_sound') || 'tone3');
                    const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                    const article = this.engine.inputManager?.getIndefiniteArticle(displayName) || 'a';
                    this.engine.inputManager?.showMessage(
                        `You pick up ${article} ${displayName}. (${existing.count} total)`
                    );
                }
                return true;
            }
        }

        if (this.inventory.length >= maxInventory) {
            console.log(`${this.name}'s inventory is full`);
            if (this.isPlayerControlled()) {
                const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                const article = this.engine.inputManager?.getIndefiniteArticle(displayName) || 'a';
                this.engine.inputManager?.showMessage(`Your inventory is full. You can't pick up ${article} ${displayName}.`, { style: 'warning' });
            }
            return false;
        }

        this.inventory.push(item);
        item.owner = this; // Track item owner for per-turn stat messages
        this.engine.entityManager.removeEntity(item);
        console.log(`${this.name} picked up ${item.name}`);

        // Apply pickup_effect (e.g., gold adds to wealth)
        const pickupEffect = item.getAttribute('pickup_effect');
        if (pickupEffect && typeof pickupEffect === 'object') {
            for (const [attr, rawValue] of Object.entries(pickupEffect)) {
                // Resolve {value} references to item's value property
                let value = rawValue;
                if (typeof rawValue === 'string' && rawValue === '{value}') {
                    value = item.value || 0;
                }

                // Add to actor's attribute (create if doesn't exist)
                const currentValue = this.getAttribute(attr) || 0;
                this.setAttribute(attr, currentValue + value);
                console.log(`${this.name}'s ${attr}: ${currentValue} + ${value} = ${currentValue + value}`);
            }

            // Item with pickup_effect is consumed (not kept in inventory)
            this.inventory = this.inventory.filter(i => i !== item);
        }

        // Play pickup sound and show message if this is the player
        if (this.isPlayerControlled()) {
            const pickupSound = item.getAttribute('pickup_sound') || 'tone3';
            this.engine.playSound(pickupSound);

            // Show pickup message in description element
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            const article = this.engine.inputManager?.getIndefiniteArticle(displayName) || 'a';

            // Show value if item had one
            if (pickupEffect && item.value) {
                this.engine.inputManager?.showMessage(`You pick up ${article} ${displayName} worth ${item.value}.`, { style: 'discovery' });
            } else {
                this.engine.inputManager?.showMessage(`You pick up ${article} ${displayName}.`, { style: 'discovery' });
            }
        }

        // Auto-equip wearable items for NPCs only (player must equip manually)
        if (!this.isPlayerControlled()) {
            const slot = item.getAttribute('wearable');
            if (slot && ['top', 'middle', 'lower'].includes(slot)) {
                const { canEquip } = this.canEquipItem(item);
                if (canEquip) {
                    this.equipToSlot(item, slot);
                }
            }
        }

        return true;
    }

    /**
     * Equip a wearable item to its designated slot
     * @param {Item} item - The wearable item to equip
     * @param {string} slot - The equipment slot ('top', 'middle', or 'lower')
     */
    equipToSlot(item, slot) {
        // If slot already has an item, unequip it first
        const currentItem = this.equipment[slot];
        if (currentItem) {
            this.unequipFromSlot(slot);
        }

        // Equip the new item
        this.equipment[slot] = item;

        // Apply wear effects to actor
        this.applyWearEffect(item);

        // Create sprite for the equipped item (skip for weapons/rings - they don't render on actor)
        // Only create sprite if renderer exists and actor sprites have been created
        if (slot !== 'weapon' && slot !== 'ring1' && slot !== 'ring2' && this.engine.renderer && this.spriteBase) {
            this.spriteEquipment[slot] = this.engine.renderer.createEquipmentSprite(
                this,
                item,
                slot
            );
        }

        console.log(`${this.name} equipped ${item.name} (${slot})`);

        if (item.hasAttribute('cursed') && this.isPlayerControlled()) {
            item.identified = true;
            this.engine.inputManager?.showMessage(`You feel a malevolent force bind the ${item.getDisplayName?.()} to you!`, { style: 'danger' });
            this.engine.playSound?.('tone9');
            this.engine.renderer?.effectRunner.apply('curse_reveal');
        }

        if (item.hasAttribute('light_source')) {
            this.engine.updateLighting();
        }

        // Check if this triggers win conditions (for player only)
        if (this.isPlayerControlled() && this.engine.checkWinConditions()) {
            this.engine.unlockWinConditionStairways();
        }
    }

    /**
     * Unequip an item from a slot
     * @param {string} slot - The equipment slot to unequip
     */
    unequipFromSlot(slot) {
        const item = this.equipment[slot];
        if (!item) return;

        // Remove wear effects from actor
        this.removeWearEffect(item);

        // Destroy sprite
        if (this.spriteEquipment[slot]) {
            this.spriteEquipment[slot].destroy();
            this.spriteEquipment[slot] = null;
        }

        // Clear the slot
        this.equipment[slot] = null;

        if (item.hasAttribute('light_source')) {
            this.engine.updateLighting();
        }

        console.log(`${this.name} unequipped ${item.name}`);

        // Check if this breaks win conditions (for player only)
        if (this.isPlayerControlled() && !this.engine.checkWinConditions()) {
            this.engine.lockWinConditionStairways();
        }
    }

    /**
     * Apply wear effects from an item to this actor
     * @param {Item} item - The item being equipped
     */
    applyWearEffect(item) {
        const wearEffect = item.getAttribute('wear_effect');
        if (!wearEffect) return;

        // Store resolved numeric values for proper removal on unequip
        if (!item._resolvedWearValues) item._resolvedWearValues = {};

        for (const [attr, rawValue] of Object.entries(wearEffect)) {
            const currentValue = this.getAttribute(attr);

            // Only apply if actor has this attribute
            if (currentValue === undefined) continue;

            // Handle "toggle" value
            if (rawValue === 'toggle') {
                this.setAttribute(attr, !currentValue);
                console.log(`${item.name}: toggled ${this.name}'s ${attr} to ${!currentValue}`);
            }
            // Handle boolean values (set directly)
            else if (typeof rawValue === 'boolean') {
                // Store original value for restoration on unequip
                if (!item._originalWearValues) item._originalWearValues = {};
                item._originalWearValues[attr] = currentValue;
                this.setAttribute(attr, rawValue);
                console.log(`${item.name}: set ${this.name}'s ${attr} to ${rawValue}`);
            }
            // Handle numeric values or attribute references (add)
            else if (typeof currentValue === 'number') {
                // Resolve attribute references like "{strength}"
                const resolvedValue = this.resolveAttributeValue(rawValue, this);
                if (typeof resolvedValue === 'number' && resolvedValue !== 0) {
                    item._resolvedWearValues[attr] = resolvedValue;
                    this.setAttribute(attr, currentValue + resolvedValue);
                    console.log(`${item.name}: ${this.name}'s ${attr} ${resolvedValue >= 0 ? '+' : ''}${resolvedValue} (now ${currentValue + resolvedValue})`);
                }
            }
        }
    }

    /**
     * Remove wear effects from an item from this actor
     * @param {Item} item - The item being unequipped
     */
    removeWearEffect(item) {
        const wearEffect = item.getAttribute('wear_effect');
        if (!wearEffect) return;

        for (const [attr, rawValue] of Object.entries(wearEffect)) {
            const currentValue = this.getAttribute(attr);

            // Only remove if actor has this attribute
            if (currentValue === undefined) continue;

            // Handle "toggle" value (toggle back)
            if (rawValue === 'toggle') {
                this.setAttribute(attr, !currentValue);
                console.log(`${item.name} removed: toggled ${this.name}'s ${attr} to ${!currentValue}`);
            }
            // Handle boolean values (restore original)
            else if (typeof rawValue === 'boolean') {
                const originalValue = item._originalWearValues?.[attr];
                if (originalValue !== undefined) {
                    this.setAttribute(attr, originalValue);
                    console.log(`${item.name} removed: restored ${this.name}'s ${attr} to ${originalValue}`);
                }
            }
            // Handle numeric values or attribute references (subtract resolved value)
            else if (typeof currentValue === 'number') {
                // Use the resolved value that was stored when equipped
                const resolvedValue = item._resolvedWearValues?.[attr];
                if (typeof resolvedValue === 'number') {
                    this.setAttribute(attr, currentValue - resolvedValue);
                    console.log(`${item.name} removed: ${this.name}'s ${attr} ${resolvedValue >= 0 ? '-' : '+'}${Math.abs(resolvedValue)} (now ${currentValue - resolvedValue})`);
                }
            }
        }

        // Clean up stored values
        delete item._resolvedWearValues;
        delete item._originalWearValues;
    }

    /**
     * Get the item equipped in a specific slot
     * @param {string} slot - The equipment slot ('head', 'body', or 'feet')
     * @returns {Item|null}
     */
    getEquippedItem(slot) {
        return this.equipment[slot] || null;
    }

    /**
     * Check if actor has any equipped items
     * @returns {boolean}
     */
    hasEquippedItems() {
        return this.equipment.top || this.equipment.middle || this.equipment.lower ||
               this.equipment.ring1 || this.equipment.ring2;
    }

    /**
     * Check if actor meets the stat requirements to equip an item
     * @param {Item} item - The item to check
     * @returns {{canEquip: boolean, reason: string|null}} Result with reason if cannot equip
     */
    canEquipItem(item) {
        const requiresStat = item.getAttribute('requires_stat');
        if (!requiresStat || typeof requiresStat !== 'object') {
            return { canEquip: true, reason: null };
        }

        // Check each required stat
        for (const [stat, requiredValue] of Object.entries(requiresStat)) {
            const actorValue = this.getAttribute(stat) || 0;
            if (actorValue < requiredValue) {
                return {
                    canEquip: false,
                    reason: `Requires ${stat} ${requiredValue} (you have ${actorValue})`
                };
            }
        }

        return { canEquip: true, reason: null };
    }

    /**
     * Check if a specific item is currently equipped
     * @param {Item} item - The item to check
     * @returns {boolean} True if the item is equipped in any slot
     */
    isItemEquipped(item) {
        return this.equipment.weapon === item ||
               this.equipment.top === item ||
               this.equipment.middle === item ||
               this.equipment.lower === item ||
               this.equipment.ring1 === item ||
               this.equipment.ring2 === item;
    }

    // ========================================================================
    // STATE MANAGEMENT (burning, poisoned, stunned, etc.)
    // ========================================================================

    /**
     * Apply a temporary state to this actor
     * @param {string} stateName - The state name (e.g., 'burning', 'poisoned')
     * @param {Object} stateData - State configuration from states.json
     * @param {Object} [options] - Additional options
     * @param {number} [options.duration] - Override default duration
     * @param {Actor} [options.source] - The actor that applied this state
     * @returns {boolean} True if state was applied, false if immune or already has state
     */
    applyState(stateName, stateData, options = {}) {
        // Some states only apply to the player-controlled actor
        if (stateData.hallucinating || stateData.player_only) {
            if (!this.hasAttribute('controlled')) return false;
        } else {
            // All other states require the 'sentient' or 'controlled' attribute
            // This excludes walls, traps, fire, clouds, etc.
            if (!this.hasAttribute('sentient') && !this.hasAttribute('controlled')) return false;
        }

        // Check immunity
        if (stateData.immunity && this.hasAttribute(stateData.immunity)) {
            return false;
        }

        // Check if already has this state
        if (this.states[stateName]) {
            // Refresh duration if already present
            let duration = options.duration ?? stateData.duration ?? 5;
            if (duration === -1) duration = Infinity;
            this.states[stateName].duration = Math.max(this.states[stateName].duration, duration);
            return true;
        }

        let duration = options.duration ?? stateData.duration ?? 5;
        if (duration === -1) duration = Infinity;

        // Create state entry
        this.states[stateName] = {
            duration: duration,
            data: stateData,
            source: options.source || null,
            attachedActor: null
        };

        // Spawn attached actor if defined (e.g., fire for burning)
        if (stateData.attached_actor) {
            const attachedActor = this.engine.entityManager.spawnActor(
                stateData.attached_actor,
                this.x,
                this.y
            );
            if (attachedActor) {
                // Mark as attached to this actor so it follows and doesn't apply spawn damage
                attachedActor._attachedTo = this;
                attachedActor._isAttachedFire = true; // Skip normal fire damage, state handles it
                this.states[stateName].attachedActor = attachedActor;
            }
        }

        // Show apply message (skip for silent/innate states)
        if (!options.silent && stateData.on_apply_message && this.engine.inputManager) {
            const message = stateData.on_apply_message.replace('[actor_name]', this.name);
            const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };
            this.engine.inputManager.showMessage(message, { position: pos, style: 'warning' });
        }

        // Play apply sound (skip for silent/innate states)
        if (!options.silent && stateData.on_apply_sound) {
            this.engine.playSound?.(stateData.on_apply_sound);
        }

        // Apply on_apply_effect (modifies actor properties while state is active)
        if (stateData.on_apply_effect) {
            const savedValues = {};
            for (const [key, amount] of Object.entries(stateData.on_apply_effect)) {
                if (this[key] !== undefined && typeof this[key] === 'number') {
                    savedValues[key] = this[key];
                    this[key] = Math.max(1, this[key] + amount);
                }
            }
            this.states[stateName]._savedValues = savedValues;

            // If vision was modified on a player, enable runtime darkness
            if (stateData.on_apply_effect.visionRange && this.isPlayerControlled()) {
                this.engine.enableRuntimeDarkness?.();
                this.engine.updateLighting?.();
            }
        }

        // Flying: emerge from submersion when gaining flight
        if (stateData.flying && this.isSubmerged) {
            this.emerge();
        }

        // Confusion: apply full-canvas visual effect for player
        if (stateData.random_movement && this.isPlayerControlled()) {
            this.engine.renderer?.applyConfusionEffect();
        }

        // Hallucination: apply intense visual scrambling for player
        if (stateData.hallucinating && this.isPlayerControlled()) {
            this.engine.renderer?.applyHallucinationEffect();
        }

        // Invisibility: translucent for player-controlled, fully hidden for others
        if (stateData.invisible) {
            this._updateInvisibilitySprites();
        }

        return true;
    }

    /**
     * Remove a state from this actor
     * @param {string} stateName - The state name to remove
     * @param {boolean} [silent=false] - If true, don't show removal message
     */
    removeState(stateName, silent = false) {
        const state = this.states[stateName];
        if (!state) return;

        // Remove attached actor
        if (state.attachedActor && !state.attachedActor.isDead) {
            state.attachedActor.die();
        }

        // Show removal message
        if (!silent && state.data.on_remove_message && this.engine.inputManager) {
            const message = state.data.on_remove_message.replace('[actor_name]', this.name);
            const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };
            this.engine.inputManager.showMessage(message, { position: pos, style: 'discovery' });
        }

        // Play removal sound
        if (!silent && state.data.on_remove_sound) {
            this.engine.playSound?.(state.data.on_remove_sound);
        }

        // Reverse on_apply_effect (restore original values)
        if (state._savedValues) {
            for (const [key, originalValue] of Object.entries(state._savedValues)) {
                this[key] = originalValue;
            }
        }

        // If vision was modified on a player, check if runtime darkness should be disabled
        if (state.data.on_apply_effect?.visionRange && this.isPlayerControlled()) {
            const hasOtherVisionState = Object.entries(this.states).some(
                ([name, s]) => name !== stateName && s.data.on_apply_effect?.visionRange
            );
            if (!hasOtherVisionState) {
                this.engine.disableRuntimeDarkness?.();
            }
            this.engine.updateLighting?.();
        }

        // Slowed: reset toggle when slow is removed
        if (state.data.skip_every_other_turn) {
            this._slowedToggle = false;
        }

        // Confusion: remove full-canvas visual effect for player
        if (state.data.random_movement && this.isPlayerControlled()) {
            this.engine.renderer?.removeConfusionEffect();
        }

        // Hallucination: remove visual scrambling for player
        if (state.data.hallucinating && this.isPlayerControlled()) {
            this.engine.renderer?.removeHallucinationEffect();
        }

        // Invisibility: restore sprite visibility/alpha
        if (state.data.invisible) {
            this._updateInvisibilitySprites();
        }

        // Flying: handle landing when flight ends
        if (state.data.flying && !this.isDead) {
            // Check if still flying from another source
            const stillFlying = Object.entries(this.states).some(
                ([name, s]) => name !== stateName && s.data.flying
            );
            if (!stillFlying) {
                this.updateSubmersionState();
                if (!this.hasFloorAt(this.x, this.y) && !this.hasPlatformAt(this.x, this.y)) {
                    this.fall();
                }
            }
        }

        delete this.states[stateName];
    }

    _updateInvisibilitySprites() {
        const isInvisible = this.hasStateProperty('invisible');
        if (isInvisible && this.isPlayerControlled()) {
            const alpha = 0.35;
            if (this.spriteBase) this.spriteBase.alpha = alpha;
            if (this.spriteTop) this.spriteTop.alpha = alpha;
            if (this.spriteSide) this.spriteSide.alpha = alpha;
            for (const slot of ['top', 'middle', 'lower']) {
                if (this.spriteEquipment[slot]) this.spriteEquipment[slot].alpha = alpha;
            }
        } else if (isInvisible) {
            if (this.spriteBase) this.spriteBase.visible = false;
            if (this.spriteTop) this.spriteTop.visible = false;
            if (this.spriteSide) this.spriteSide.visible = false;
        } else {
            if (this.spriteBase) this.spriteBase.alpha = 1;
            if (this.spriteTop) this.spriteTop.alpha = 1;
            if (this.spriteSide) this.spriteSide.alpha = 1;
            for (const slot of ['top', 'middle', 'lower']) {
                if (this.spriteEquipment[slot]) this.spriteEquipment[slot].alpha = 1;
            }
            if (this.spriteBase) this.spriteBase.visible = true;
            if (this.spriteTop) this.spriteTop.visible = true;
            if (this.spriteSide) this.spriteSide.visible = true;
        }
    }

    /**
     * Check if actor has a specific state
     * @param {string} stateName - The state name to check
     * @returns {boolean} True if actor has the state
     */
    hasState(stateName) {
        return !!this.states[stateName];
    }

    /**
     * Get remaining duration for a state
     * @param {string} stateName - The state name
     * @returns {number|null} Remaining duration or null if state not present
     */
    getStateDuration(stateName) {
        return this.states[stateName]?.duration ?? null;
    }

    /**
     * Process all active states each turn
     * Decrements durations, applies per-turn effects, removes expired states
     * Called at the start of each turn in act()
     */
    processStates() {
        const statesToRemove = [];

        for (const [stateName, state] of Object.entries(this.states)) {
            const stateData = state.data;

            // Update attached actor position to follow this actor
            if (state.attachedActor && !state.attachedActor.isDead) {
                if (state.attachedActor.x !== this.x || state.attachedActor.y !== this.y) {
                    state.attachedActor.x = this.x;
                    state.attachedActor.y = this.y;
                    // Update sprite position
                    if (state.attachedActor.spriteBase) {
                        state.attachedActor.spriteBase.x = this.x * globalVars.TILE_WIDTH;
                        state.attachedActor.spriteBase.y = this.y * globalVars.TILE_HEIGHT;
                    }
                    if (state.attachedActor.spriteTop) {
                        state.attachedActor.spriteTop.x = this.x * globalVars.TILE_WIDTH;
                        state.attachedActor.spriteTop.y = (this.y - 1) * globalVars.TILE_HEIGHT;
                    }
                }
            }

            // Apply per-turn effect (e.g., poison damage)
            if (stateData.per_turn_effect && this.stats) {
                for (const [statKey, value] of Object.entries(stateData.per_turn_effect)) {
                    if (this.stats[statKey] !== undefined) {
                        const oldValue = this.stats[statKey].current;
                        this.stats[statKey].current = Math.max(0, oldValue + value);

                        // Show damage message for health effects
                        if (statKey === 'health' && value < 0 && this.hasAttribute('visible')) {
                            const stateName_display = stateData.name || stateName;
                            const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };
                            this.engine.inputManager?.showMessage(
                                `${this.name} takes ${Math.abs(value)} damage from ${stateName_display}!`, pos
                            );
                            this.flash?.();
                        }

                        // Check for death
                        if (statKey === 'health' && this.stats[statKey].current <= 0) {
                            this.die();
                            return; // Stop processing states if dead
                        }
                    }
                }
            }

            // Random state application (e.g., starving can cause fainting or nausea)
            if (stateData.random_apply_states) {
                for (const entry of stateData.random_apply_states) {
                    if (ROT.RNG.getUniform() < entry.chance) {
                        const targetStateData = this.engine.globalStates[entry.state];
                        if (targetStateData) {
                            const opts = {};
                            if (entry.duration !== undefined) opts.duration = entry.duration;
                            if (entry.message && this.isPlayerControlled()) {
                                this.engine.inputManager?.showMessage(entry.message);
                            }
                            this.applyState(entry.state, targetStateData, opts);
                        }
                        break; // Only one random state per turn
                    }
                }
            }

            // Hallucination: tick per-turn floor tile changes for player
            if (stateData.hallucinating && this.isPlayerControlled()) {
                this.engine.renderer?.tickHallucination();
            }

            // Decrement duration
            state.duration--;

            // Check if state expired
            if (state.duration <= 0) {
                statesToRemove.push(stateName);
            }
        }

        // Remove expired states
        for (const stateName of statesToRemove) {
            this.removeState(stateName);
        }
    }

    /**
     * Check if actor should skip their turn due to a state
     * @returns {boolean} True if actor should skip turn
     */
    isIncapacitated() {
        for (const state of Object.values(this.states)) {
            if (state.data.skip_turn) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if any active state has a given property set to truthy
     * @param {string} prop - The state data property to check (e.g. 'random_movement')
     * @returns {boolean} True if any active state has that property
     */
    hasStateProperty(prop) {
        return Object.values(this.states).some(s => s.data[prop]);
    }

    /**
     * Get the max value of a numeric state property across all active states
     * @param {string} prop - The state data property to check (e.g. 'skip_turn_chance')
     * @returns {number} The highest value found, or 0 if none
     */
    getStatePropertyValue(prop) {
        let max = 0;
        for (const s of Object.values(this.states)) {
            if (s.data[prop] && s.data[prop] > max) max = s.data[prop];
        }
        return max;
    }

    /**
     * Get the equipped weapon, if any
     * @returns {Item|null} The equipped weapon or null
     */
    getEquippedWeapon() {
        return this.equipment.weapon || null;
    }

    /**
     * Get the actor's effective accuracy (base + equipment bonuses)
     * @returns {number|null} Accuracy value, or null if actor has no accuracy attribute
     */
    getEffectiveAccuracy() {
        let base = this.getAttribute('accuracy');
        if (base === undefined) return null;

        // Add bonuses from equipped items' wear_effects
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.accuracy === 'number') {
                    base += wearEffect.accuracy;
                }
            }
        }
        return base;
    }

    /**
     * Get the actor's effective defense (base + equipment bonuses)
     * @returns {number} Defense value (0 if no defense attribute)
     */
    getEffectiveDefense() {
        let base = this.getAttribute('defense') || 0;

        // Add bonuses from equipped items' wear_effects and enchantments
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.defense === 'number') {
                    base += wearEffect.defense;
                }
                if (item.enchantment && wearEffect?.defense !== undefined) {
                    base += item.enchantment;
                }
            }
        }

        // Add passive bonuses from inventory items
        base += this.getPassiveStatBonus('defense');

        return base;
    }

    /**
     * Calculate hit probability 
     * This provides diminishing returns on defense stacking
     * @param {Actor} defender - The target being attacked
     * @returns {number} Hit probability as percentage (5-95)
     */
    calculateHitProbability(defender) {
        const accuracy = this.getEffectiveAccuracy();
        if (accuracy === null) return 100; // No accuracy = deterministic hit

        const defense = defender.getEffectiveDefense?.() || 0;

        // Brogue formula: accuracy * 0.987^defense
        // Each point of defense reduces hit chance by ~1.3% (multiplicatively)
        const rawProbability = accuracy * Math.pow(0.987, defense);

        // Clamp to 5-95% - always some chance to hit/miss
        return Math.max(5, Math.min(95, Math.round(rawProbability)));
    }

    /**
     * Get the actor's effective strength (base + equipment bonuses)
     * Strength multiplies weapon damage: damage = base * (strength / 10)
     * Default strength of 10 = 1x multiplier (no change)
     * @returns {number} Strength value (10 if no strength attribute - baseline)
     */
    getEffectiveStrength() {
        let base = this.getAttribute('strength');
        if (base === undefined) base = 10; // Default strength is 10 (1x multiplier)

        // Add bonuses from equipped items' wear_effects
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.strength === 'number') {
                    base += wearEffect.strength;
                }
            }
        }

        // Add passive bonuses from inventory items
        base += this.getPassiveStatBonus('strength');

        return base;
    }

    /**
     * Get the effective per-turn change for a stat (base + equipment bonuses)
     * Equipment can modify per_turn values via wear_effect (e.g., ring that slows hunger)
     * @param {string} statName - The stat to get per-turn value for
     * @returns {number} Per-turn change amount (positive = gain, negative = loss)
     */
    getEffectivePerTurn(statName) {
        const stat = this.stats[statName];
        if (!stat) return 0;

        let perTurn = stat.per_turn || 0;

        // Add modifiers from equipped items' wear_effects
        // Format: wear_effect: { "health_per_turn": 2 } or { "nutrition_per_turn": -0.5 }
        const perTurnKey = `${statName}_per_turn`;
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect[perTurnKey] === 'number') {
                    perTurn += wearEffect[perTurnKey];
                }
            }
        }

        // Add passive bonuses from inventory items
        for (const item of this.inventory) {
            const passiveEffect = item.getAttribute('passive_effect');
            if (passiveEffect && passiveEffect.type === 'stat_bonus' && typeof passiveEffect[perTurnKey] === 'number') {
                perTurn += passiveEffect[perTurnKey];
            }
        }

        // Scale rate by an attribute (e.g., nutrition drain scales with strength)
        // Multiplier is attribute / 10, so strength 10 = 1x (baseline), 15 = 1.5x
        if (stat.rate_scaled_by) {
            let attrValue;
            const attrName = stat.rate_scaled_by;
            if (attrName === 'strength') {
                attrValue = this.getEffectiveStrength();
            } else if (attrName === 'accuracy') {
                attrValue = this.getEffectiveAccuracy() ?? 10;
            } else if (attrName === 'defense') {
                attrValue = this.getEffectiveDefense() ?? 10;
            } else {
                attrValue = this.getAttribute(attrName) ?? 10;
            }
            perTurn = perTurn * (attrValue / 10);
        }

        return perTurn;
    }

    /**
     * Process per-turn stat changes for this actor
     * Called at the start of each turn
     *
     * Stat config options (set in actor JSON stats block):
     *   per_turn: number - Amount to change each turn (positive or negative)
     *   fatal: boolean - If true, reaching 0 kills the actor (default: false, except health)
     *   death_message: string - Message shown when stat causes death (player only)
     *   warnings: array - Threshold warnings [{threshold: 0.5, message: "Getting low"}]
     *
     * Example:
     *   "nutrition": {
     *     "max": 100,
     *     "per_turn": -1,
     *     "fatal": true,
     *     "death_message": "You starve to death!",
     *     "warnings": [
     *       {"threshold": 0.5, "message": "You are getting hungry."},
     *       {"threshold": 0.25, "message": "You are very hungry."},
     *       {"threshold": 0.1, "message": "You are starving!"}
     *     ]
     *   }
     */
    processPerTurnStats() {
        if (!this.stats || this.isDead) return;

        for (const [statName, stat] of Object.entries(this.stats)) {
            const perTurn = this.getEffectivePerTurn(statName);
            if (perTurn === 0) continue;

            const oldValue = stat.current;

            // Split into base per-turn (subject to restore_from) and passive bonus (always applies)
            const basePerTurn = stat.per_turn || 0;
            const passivePerTurn = perTurn - basePerTurn;

            // Apply base per-turn with restore_from gate
            let baseGain = 0;
            if (basePerTurn !== 0) {
                const afterBase = Math.max(0, Math.min(stat.max, stat.current + basePerTurn));
                baseGain = afterBase - stat.current;

                if (stat.restore_from && baseGain > 0) {
                    const sourceStat = this.stats[stat.restore_from];
                    if (sourceStat) {
                        if (sourceStat.current <= 0) {
                            baseGain = 0;
                        } else if (sourceStat.current < baseGain) {
                            baseGain = sourceStat.current;
                            sourceStat.current = 0;
                        } else {
                            sourceStat.current -= baseGain;
                        }
                    }
                }
                stat.current += baseGain;
            }

            // Apply passive bonus (bypasses restore_from)
            if (passivePerTurn !== 0) {
                stat.current = Math.max(0, Math.min(stat.max, stat.current + passivePerTurn));
            }

            let newValue = stat.current;

            // Only process if value actually changed
            if (oldValue === newValue) continue;

            //console.log(`${this.name}'s ${statName} per-turn: ${oldValue} -> ${newValue} (${perTurn >= 0 ? '+' : ''}${perTurn})`);

            // Check for death - health is always fatal, other stats need fatal: true
            const isFatal = statName === 'health' || stat.fatal === true;
            if (newValue <= 0 && isFatal) {
                if (this.isPlayerControlled() && stat.death_message) {
                    this.engine.inputManager?.showMessage(stat.death_message, { style: 'danger' });
                }
                this.die();
                return; // Stop processing if dead
            }

            // Show warning messages for player when crossing thresholds
            if (this.isPlayerControlled() && stat.warnings && this.engine.inputManager) {
                const oldPercentage = oldValue / stat.max;
                const newPercentage = newValue / stat.max;

                // Check warnings in order (they should be sorted highest to lowest threshold)
                for (const warning of stat.warnings) {
                    // Trigger when crossing below threshold
                    if (newPercentage <= warning.threshold && oldPercentage > warning.threshold) {
                        this.engine.inputManager.showMessage(warning.message, { style: 'warning' });
                        break; // Only show one warning per turn
                    }
                }
            }

            // Apply or remove condition-driven states (e.g., starving when nutrition is low)
            if (stat.condition_state && this.engine.globalStates) {
                const { state: condStateName, threshold } = stat.condition_state;
                const percentage = newValue / stat.max;

                if (percentage <= threshold && !this.states[condStateName]) {
                    const stateData = this.engine.globalStates[condStateName];
                    if (stateData) {
                        this.applyState(condStateName, stateData, { duration: Infinity });
                    }
                } else if (percentage > threshold && this.states[condStateName]) {
                    this.removeState(condStateName);
                }
            }
        }

        // Update UI after all per-turn changes
        if (this.isPlayerControlled()) {
            this.engine.interfaceManager?.updatePlayerInfo();
        }
        this.engine.interfaceManager?.updateActorsDiv();
    }

    /**
     * Process per-turn stat changes for items in inventory
     * Handles recharging staffs, decaying items, etc.
     */
    processInventoryItemStats() {
        if (!this.inventory || this.inventory.length === 0) return;

        const toRemove = [];

        for (const item of this.inventory) {
            if (item.processPerTurnStats) {
                item.processPerTurnStats();
            }

            // Handle items that burn out (burns stat hits 0)
            const burns = item.stats?.burns;
            if (burns && burns.current <= 0) {
                const isPlayer = this.hasAttribute('controlled');
                const msg = item.getAttribute('burnout_message') || `Your ${item.name} burns out.`;
                if (isPlayer) {
                    this.engine.inputManager?.showMessage(msg, { style: 'warning' });
                    if (this.engine.lightingManager) {
                        const hasOtherLight = this.inventory.some(other =>
                            other !== item &&
                            other.hasAttribute('light_source') &&
                            !(other.stats?.burns && other.stats.burns.current <= 0)
                        );
                        if (!hasOtherLight) {
                            this.engine.inputManager?.showMessage('Darkness closes in around you.', { style: 'danger' });
                        }
                    }
                }

                const burnsOutItem = item.getAttribute('burns_out_item');
                if (burnsOutItem) {
                    const itemData = this.engine.currentPrototype?.getItemData(burnsOutItem);
                    if (itemData) {
                        const newItem = new Item(-1, -1, burnsOutItem, itemData, this.engine);
                        newItem.owner = this;
                        const idx = this.inventory.indexOf(item);
                        if (idx !== -1) this.inventory[idx] = newItem;
                    } else {
                        toRemove.push(item);
                    }
                } else {
                    toRemove.push(item);
                }

                this.engine.updateLighting();
            }
        }

        for (const item of toRemove) {
            this.inventory = this.inventory.filter(i => i !== item);
        }
    }

    /**
     * Get weapon type from weapon attribute
     * Supports boolean (true = 'normal') or string type names
     * @param {Item} weapon - The weapon item
     * @returns {string} Weapon type ('normal', 'knockback', 'lifesteal', 'critical')
     */
    getWeaponType(weapon) {
        if (!weapon) return 'normal';
        // New format: weapon_proc attribute
        const proc = weapon.getAttribute('weapon_proc');
        if (proc) return proc;
        // Backward compat: old weapon: "knockback" string format
        const attr = weapon.getAttribute('weapon');
        if (attr === true) return 'normal';
        if (typeof attr === 'string') return attr;
        return 'normal';
    }

    /**
     * Apply weapon proc effects after a successful hit
     * @param {Actor} target - The target that was hit
     * @param {Item|null} weapon - The weapon used (null for unarmed)
     * @param {number} damageDealt - Actual damage dealt (negative number)
     */
    applyWeaponProc(target, weapon, damageDealt) {
        if (!weapon) return; // No procs for unarmed attacks

        const weaponType = this.getWeaponType(weapon);

        switch (weaponType) {
            case 'knockback':
                this._procKnockback(target, weapon);
                break;
            case 'lifesteal':
                this._procLifesteal(damageDealt, weapon);
                break;
            case 'critical':
                // Critical is handled during damage calculation, not as a post-hit proc
                break;
            case 'normal':
            default:
                // No special proc effect
                break;
        }
    }

    resolveAttackStyle(newX, newY, dx, dy, actorAtTarget) {
        const weapon = this.getEquippedWeapon();
        const style = weapon?.getAttribute('attack_style');
        if (!style) return { handled: false };

        switch (style) {
            case 'lunge':
                if (!actorAtTarget) return this._styleLunge(newX, newY, dx, dy, weapon);
                return { handled: false };
            case 'sweep':
                if (actorAtTarget) return this._styleSweep(newX, newY, weapon);
                return { handled: false };
            case 'penetrate':
                if (actorAtTarget) return this._stylePenetrate(newX, newY, dx, dy, actorAtTarget, weapon);
                return { handled: false };
            default:
                return { handled: false };
        }
    }

    _styleLunge(newX, newY, dx, dy, weapon) {
        const range = weapon.getAttribute('lunge_range') ?? 2;
        const lungeX = this.x + dx * range;
        const lungeY = this.y + dy * range;

        if (!this.hasFloorAt(lungeX, lungeY) && !this.hasPlatformAt(lungeX, lungeY)) return { handled: false };

        const target = this.engine.entityManager.getSolidActorAt(lungeX, lungeY);
        if (!target || target.isDead || target.stats?.health === undefined) return { handled: false };

        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage('You lunge forward!');
        }

        // Attack the distant target before the move happens
        this.applyCollisionEffects(target);

        // Return unhandled so tryMove proceeds with normal movement to the gap tile
        // (which handles viewport, lighting, item pickup, doors, etc.)
        return { handled: false };
    }

    _styleSweep(newX, newY, weapon) {
        const collisionDx = newX - this.x;
        if (collisionDx > 0) this.setFacing('right');
        else if (collisionDx < 0) this.setFacing('left');

        const targets = [];
        for (let ddx = -1; ddx <= 1; ddx++) {
            for (let ddy = -1; ddy <= 1; ddy++) {
                if (ddx === 0 && ddy === 0) continue;
                const tx = this.x + ddx;
                const ty = this.y + ddy;
                const actor = this.engine.entityManager.getSolidActorAt(tx, ty);
                if (actor && actor !== this && !actor.isDead && actor.stats?.health !== undefined) {
                    targets.push(actor);
                }
            }
        }

        if (targets.length === 0) return { handled: false };

        if (this.isPlayerControlled() && targets.length > 1) {
            this.engine.inputManager?.showMessage('You swing in a wide arc!');
        }

        for (const target of targets) {
            this.applyCollisionEffects(target);
        }

        return { handled: true, moved: false, actionTaken: true };
    }

    _stylePenetrate(newX, newY, dx, dy, actorAtTarget, weapon) {
        const collisionDx = newX - this.x;
        if (collisionDx > 0) this.setFacing('right');
        else if (collisionDx < 0) this.setFacing('left');

        const primaryResult = this.applyCollisionEffects(actorAtTarget);

        const depth = weapon.getAttribute('penetrate_depth') ?? 1;
        for (let i = 1; i <= depth; i++) {
            const behindX = newX + dx * i;
            const behindY = newY + dy * i;
            const behindActor = this.engine.entityManager.getSolidActorAt(behindX, behindY);
            if (behindActor && !behindActor.isDead && behindActor.stats?.health !== undefined) {
                this.applyCollisionEffects(behindActor);
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(
                        `Your ${weapon.getDisplayName?.()} pierces through!`
                    );
                }
            } else {
                break;
            }
        }

        return { handled: true, moved: false, actionTaken: primaryResult.attackAttempted };
    }

    /**
     * Knockback proc: Push target away from attacker
     * @param {Actor} target - The target to knock back
     * @param {Item} weapon - The weapon used
     */
    _procKnockback(target, weapon) {
        if (!target || target.isDead) return;

        const distance = weapon?.getAttribute('knockback_distance') ?? 1;

        // Calculate direction from attacker to target
        const dx = Math.sign(target.x - this.x);
        const dy = Math.sign(target.y - this.y);

        // Push target tile by tile up to distance
        let pushed = false;
        for (let i = 0; i < distance; i++) {
            const newX = target.x + dx;
            const newY = target.y + dy;
            if (!target.isPassableAt(newX, newY)) break;
            target.x = newX;
            target.y = newY;
            pushed = true;
        }

        if (pushed) {
            target.updateSpritePosition();
            target._lastAttacker = null; // Prevent immediate pursuit via defend_self
            target._knockedBack = true; // Skip next turn due to knockback stagger
            this.engine.playSound('push1');
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`${target.name} is knocked back!`);
            }
        }
    }

    /**
     * Lifesteal proc: Heal attacker for a percentage of damage dealt
     * @param {number} damageDealt - Damage dealt (negative number)
     * @param {Item} weapon - The weapon used
     */
    _procLifesteal(damageDealt, weapon) {
        const percent = (weapon?.getAttribute('lifesteal_percent') ?? 25) / 100;
        const healAmount = Math.max(1, Math.floor(Math.abs(damageDealt) * percent));
        this.modifyStat('health', healAmount);
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`You drain ${healAmount} health!`);
        }
        console.log(`Lifesteal: ${this.name} healed ${healAmount} HP`);
    }

    /**
     * Check if critical hit should proc (15% chance)
     * @param {Item|null} weapon - The weapon being used
     * @returns {boolean} True if critical hit
     */
    checkCriticalHit(weapon) {
        if (!weapon) return false;
        const weaponType = this.getWeaponType(weapon);
        if (weaponType !== 'critical') return false;

        const critChance = weapon.getAttribute('critical_chance') ?? 15;
        const roll = ROT.RNG.getPercentage();
        return roll <= critChance;
    }

    /**
     * Equip a wearable item or weapon (convenience method)
     * For armor with strength requirements, starts multi-turn equipping process
     * @param {Item} item - The item to equip
     * @returns {boolean} True if successfully equipped or started equipping
     */
    equipItem(item) {
        if (!this.inventory.includes(item)) {
            console.log(`${this.name} doesn't have ${item.name}`);
            return false;
        }

        // Cancel any current equipping if starting a new one
        if (this._equippingItem && this._equippingItem !== item) {
            this._equippingItem = null;
            this._equippingTurnsLeft = 0;
            this._equippingTurnsTotal = 0;
        }

        // Check stat requirements
        const { canEquip, reason } = this.canEquipItem(item);
        if (!canEquip) {
            console.log(`${this.name} cannot equip ${item.name}: ${reason}`);
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You cannot equip the ${item.name}. ${reason}.`);
            }
            return false;
        }

        // Check if it's a weapon (instant equip)
        if (item.hasAttribute('weapon')) {
            this.equipToSlot(item, 'weapon');
            return true;
        }

        // Check if it's wearable
        const slot = item.getAttribute('wearable');
        if (!slot || !['top', 'middle', 'lower', 'ring'].includes(slot)) {
            console.log(`${item.name} is not equippable`);
            return false;
        }

        // Rings use two dedicated slots
        if (slot === 'ring') {
            const ringSlot = !this.equipment.ring1 ? 'ring1' :
                             !this.equipment.ring2 ? 'ring2' : 'ring1';
            this.equipToSlot(item, ringSlot);
            return true;
        }

        // Check for strength requirement - determines equip time
        const requiresStat = item.getAttribute('requires_stat');
        const strengthReq = requiresStat?.strength || 0;

        if (strengthReq > 0) {
            // Start multi-turn equipping process
            this._equippingItem = item;
            this._equippingTurnsLeft = strengthReq;
            this._equippingTurnsTotal = strengthReq;

            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You begin equipping ${item.name}...`);
            }
            return true;
        }

        // No strength requirement - instant equip
        this.equipToSlot(item, slot);
        return true;
    }

    /**
     * Progress the equipping process by one turn
     * Called when player takes an action while equipping
     * @returns {boolean} True if still equipping, false if done or not equipping
     */
    progressEquipping() {
        if (!this._equippingItem || this._equippingTurnsLeft <= 0) {
            return false;
        }

        this._equippingTurnsLeft--;

        if (this._equippingTurnsLeft <= 0) {
            // Finished equipping
            const item = this._equippingItem;
            const slot = item.getAttribute('wearable');

            this._equippingItem = null;
            this._equippingTurnsTotal = 0;

            this.equipToSlot(item, slot);

            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You finish equipping ${item.name}.`);
            }
            return false;
        }

        // Still equipping
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`Equipping ${this._equippingItem.name}... (${this._equippingTurnsLeft} turns left)`);
        }
        return true;
    }

    /**
     * Cancel any in-progress equipping
     */
    cancelEquipping() {
        if (this._equippingItem) {
            const itemName = this._equippingItem.name;
            this._equippingItem = null;
            this._equippingTurnsLeft = 0;
            this._equippingTurnsTotal = 0;

            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You stop equipping ${itemName}.`);
            }
        }
    }

    /**
     * Check if actor is currently equipping something
     * @returns {boolean} True if in the process of equipping
     */
    isEquipping() {
        return this._equippingItem !== null && this._equippingTurnsLeft > 0;
    }

    /**
     * Unequip a worn item or weapon (convenience method)
     * @param {Item} item - The item to unequip
     * @returns {boolean} True if successfully unequipped
     */
    unequipItem(item) {
        if (item.hasAttribute('cursed')) {
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`The ${item.getDisplayName?.()} is cursed! You can't remove it.`, { style: 'danger' });
            }
            return false;
        }

        // Check if it's an equipped weapon
        if (item.hasAttribute('weapon')) {
            if (this.equipment.weapon !== item) {
                console.log(`${item.name} is not equipped`);
                return false;
            }
            this.unequipFromSlot('weapon');
            return true;
        }

        // Handle wearable items
        const slot = item.getAttribute('wearable');
        if (!slot) return false;

        if (slot === 'ring') {
            if (this.equipment.ring1 === item) { this.unequipFromSlot('ring1'); return true; }
            if (this.equipment.ring2 === item) { this.unequipFromSlot('ring2'); return true; }
            return false;
        }

        if (this.equipment[slot] !== item) {
            console.log(`${item.name} is not equipped`);
            return false;
        }

        this.unequipFromSlot(slot);
        return true;
    }

    /**
     * Use an item from inventory
     * @param {Item} item - The item to use
     * @returns {boolean} True if item was used successfully
     */
    useItem(item) {
        // Check if item is in inventory
        if (!this.inventory.includes(item)) {
            console.log(`${this.name} doesn't have ${item.name}`);
            return false;
        }

        // Check if item has a use_verb (is usable)
        const useVerb = item.getAttribute('use_verb');
        if (!useVerb) {
            console.log(`${item.name} cannot be used`);
            return false;
        }

        const useEffect = item.getAttribute('use_effect');

        // Use ceremony — data-driven dramatic effect before item activation
        const ceremonySetting = item.getAttribute('use_ceremony');
        if (this.isPlayerControlled() && ceremonySetting) {
            const ceremony = typeof ceremonySetting === 'object' ? ceremonySetting : {};
            this._scrollCeremonyActive = true;
            this.engine.turnEngine?.lock();

            const buildSound = ceremony.build_sound || 'levelout';
            const buildEffect = ceremony.build_effect || 'scroll_ceremony';
            const releaseSound = ceremony.release_sound || 'magic';
            const releaseEffect = ceremony.release_effect || 'scroll_ceremony_flash';
            const duration = ceremony.duration || 1000;

            const soundId = this.engine.playSound(buildSound);
            const darkenId = this.engine.renderer?.effectRunner.apply(buildEffect, this);

            setTimeout(() => {
                this.engine.stopSound(soundId);
                if (darkenId) this.engine.renderer?.effectRunner.remove(darkenId);

                this.engine.playSound(releaseSound);
                this.engine.renderer?.effectRunner.apply(releaseEffect, this);

                let success = false;
                if (useEffect) {
                    success = this.executeItemEffect(item, useEffect);
                } else {
                    success = true;
                }

                if (!item.hasAttribute('deferred')) {
                    this._completeItemUse(item, success);
                    this.engine.inputManager?.onPlayerAction();
                }

                this._scrollCeremonyActive = false;
            }, duration);

            return true;
        }

        // Play use sound if this is the player
        if (this.isPlayerControlled()) {
            const useSound = item.getAttribute('use_sound') || 'tone1';
            this.engine.playSound(useSound);
        }

        // Get the use effect to determine what happens
        let success = false;

        if (useEffect) {
            success = this.executeItemEffect(item, useEffect);
        } else {
            // Item has a verb but no effect - just mark as used
            console.log(`${this.name} used ${item.name}`);
            success = true;
        }

        // For deferred items, consumption happens in the follow-up UI interaction, not immediately here.
        if (item.hasAttribute('deferred')) {
            return success; // Early return - handling continues in interface
        }

        this._completeItemUse(item, success);
        return success;
    }

    _completeItemUse(item, success) {
        if (success && item.hasAttribute('consumable')) {
            if (item.count > 1) {
                item.count--;
            } else {
                this.inventory = this.inventory.filter(i => i !== item);
            }
            console.log(`${item.name} was consumed`);
        }

        if (success && this.isPlayerControlled() && this.engine.inputManager) {
            const useDescription = item.getUseDescription();
            if (useDescription) {
                this.engine.inputManager.showMessage(useDescription);
            }
        }

        if (success && !item.identified) {
            item.identify();
            const identifiedName = item.getDisplayName();
            console.log(`${this.name} identified the ${identifiedName}!`);

            if (this.isPlayerControlled() && this.engine.inputManager) {
                this.engine.inputManager.showMessage(`You identified the ${identifiedName}!`);
            }
        }
    }


    /**
     * Execute an item's use effect
     * @param {Item} item - The item being used
     * @param {string|object} effect - The effect identifier (string) or stat modifiers (object)
     * @returns {boolean} True if effect executed successfully
     */
    executeItemEffect(item, effect) {
        console.log('executeItemEffect called with effect:', effect, 'typeof:', typeof effect);
        // Handle object format: { "health": 20, "strength": 2, "defense": 5, "apply_state": "poisoned" }
        // Supports stats (health, nutrition), attributes (strength, defense), and state application
        if (typeof effect === 'object') {
            console.log('Effect is an object, processing as stat modifiers');
            let anyModified = false;
            let shouldDie = false;
            for (const [key, amount] of Object.entries(effect)) {
                // Handle state application (to self)
                if (key === 'apply_state') {
                    const stateName = amount;
                    const statesData = this.engine.globalStates;
                    if (statesData && statesData[stateName]) {
                        const applied = this.applyState(stateName, statesData[stateName]);
                        if (applied) {
                            anyModified = true;
                            console.log(`Applied state ${stateName} to ${this.name}`);
                        }
                    } else {
                        console.log(`Unknown state: ${stateName}`);
                    }
                    continue;
                }

                // Apply state to actors in radius: { "apply_state_radius": { "state": "confused", "radius": 5, "filter": "hostile" } }
                if (key === 'apply_state_radius') {
                    const { state: stateName, radius = 5, filter, message, empty_message } = amount;
                    const statesData = this.engine.globalStates;
                    if (!statesData?.[stateName]) continue;
                    let affected = 0;
                    for (const actor of this.engine.entityManager?.actors || []) {
                        if (actor.isDead || actor === this) continue;
                        if (filter === 'hostile' && !actor.hasAttribute('hostile')) continue;
                        if (filter === 'friendly' && actor.hasAttribute('hostile')) continue;
                        const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                        if (dist <= radius) {
                            actor.applyState(stateName, statesData[stateName]);
                            affected++;
                        }
                    }
                    if (this.isPlayerControlled() && this.engine.inputManager) {
                        this.engine.inputManager.showMessage(affected > 0
                            ? (message || `${affected} creatures are affected!`)
                            : (empty_message || 'Nothing happens.'));
                    }
                    anyModified = affected > 0;
                    continue;
                }

                // Remove all states from actors in radius: { "remove_states_radius": { "radius": 5, "filter": "hostile", ... } }
                if (key === 'remove_states_radius') {
                    const { radius = 5, filter, message, empty_message } = amount;
                    let affected = 0;
                    for (const actor of this.engine.entityManager?.actors || []) {
                        if (actor.isDead || actor === this) continue;
                        if (filter === 'hostile' && !actor.hasAttribute('hostile')) continue;
                        if (filter === 'friendly' && actor.hasAttribute('hostile')) continue;
                        const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                        if (dist <= radius) {
                            const stateNames = Object.keys(actor.states);
                            for (const sn of stateNames) {
                                actor.removeState(sn, true);
                                affected++;
                            }
                        }
                    }
                    if (this.isPlayerControlled() && this.engine.inputManager) {
                        this.engine.inputManager.showMessage(affected > 0
                            ? (message || 'Magical effects are stripped away!')
                            : (empty_message || 'Nothing happens.'));
                    }
                    anyModified = affected > 0;
                    continue;
                }

                // Try stat modification first (for health, nutrition, etc.)
                const statResult = this.modifyStat(key, amount, { source: item });
                if (statResult !== null) {
                    anyModified = true;
                    // Check if health dropped to 0 (for poison effects)
                    if (key === 'health' && statResult <= 0) {
                        shouldDie = true;
                    }
                    continue;
                }

                // Fall back to attribute modification (for strength, defense, accuracy, armor)
                const currentAttr = this.getAttribute(key);
                if (currentAttr !== undefined && typeof currentAttr === 'number') {
                    const newValue = currentAttr + amount;
                    this.setAttribute(key, newValue);
                    console.log(`${this.name}'s ${key}: ${currentAttr} -> ${newValue} (${amount >= 0 ? '+' : ''}${amount})`);
                    anyModified = true;

                    // Update UI if player
                    if (this.isPlayerControlled()) {
                        this.engine.interfaceManager?.updatePlayerInfo();
                    }
                } else {
                    console.log(`${this.name} has no ${key} stat or attribute to modify`);
                }
            }
            // Trigger death after all effects are applied
            if (shouldDie) {
                this.die();
            }
            return anyModified;
        }

        // Handle string format: method name for complex effects
        switch (effect) {
            case 'identify_item':
                // Handled by interface — opens item picker
                this.engine.interfaceManager?.enterIdentifyMode(item, this);
                return true;

            case 'enchant_item':
                this.engine.interfaceManager?.enterEnchantMode(item, this);
                return true;

            case 'remove_curse': {
                let uncursed = 0;
                for (const slot of Object.keys(this.equipment)) {
                    const equipped = this.equipment[slot];
                    if (equipped?.hasAttribute('cursed')) {
                        equipped.setAttribute('cursed', false);
                        uncursed++;
                    }
                }
                if (this.isPlayerControlled()) {
                    if (uncursed > 0) {
                        this.engine.inputManager?.showMessage('A cleansing light lifts the curse from your equipment!', { style: 'discovery' });
                    } else {
                        this.engine.inputManager?.showMessage('You feel a momentary warmth, but nothing happens.');
                    }
                }
                return true;
            }

            case 'teleport': {
                const walkable = this.engine.mapManager?.walkableTiles;
                if (!walkable || walkable.length === 0) return false;
                // Pick a random walkable tile that isn't occupied by a solid actor
                const candidates = walkable.filter(t => !this.engine.entityManager?.getSolidActorAt(t.x, t.y));
                if (candidates.length === 0) return false;
                const dest = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
                this.x = dest.x;
                this.y = dest.y;
                this.updateSpritePosition();
                this.engine.updateLighting();
                if (this.isPlayerControlled()) {
                    this.engine.renderer?.centerViewportOnPlayer?.();
                    this.engine.inputManager?.showMessage('You are whisked away in a flash of light.');
                }
                return true;
            }

            case 'reveal_map': {
                const lm = this.engine.lightingManager;
                if (!lm || !lm.exploredMap) {
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('You already know this place well.');
                    }
                    return true;
                }
                for (let y = 0; y < lm.exploredMap.length; y++) {
                    for (let x = 0; x < lm.exploredMap[y].length; x++) {
                        lm.exploredMap[y][x] = true;
                    }
                }
                lm.computeLighting();
                const fogOfWar = this.engine.currentPrototype?.config?.mechanics?.fog_of_war || false;
                this.engine.renderer?.updateDarkness(lm, fogOfWar);
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('The layout of this place becomes clear in your mind.');
                }
                return true;
            }

            case 'aggravate_monsters': {
                const player = this.engine.entityManager?.player;
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead || actor === this) continue;
                    if (actor.hasAttribute('hostile')) {
                        actor._alertTarget = player;
                        actor._alerted = true;
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('Every creature stirs with sudden rage.');
                }
                return true;
            }

            case 'discord': {
                const radius = item?.getAttribute('effect_radius') ?? 5;
                const statesData = this.engine.globalStates;
                let affected = 0;
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead || actor === this) continue;
                    if (!actor.hasAttribute('hostile')) continue;
                    const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                    if (dist <= radius && statesData?.confused) {
                        actor.applyState('confused', statesData.confused);
                        affected++;
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(affected > 0
                        ? 'A wave of discord washes over nearby creatures!'
                        : 'The scroll crumbles, but nothing happens.');
                }
                return true;
            }

            case 'negate_nearby': {
                const radius = item?.getAttribute('effect_radius') ?? 5;
                let affected = 0;
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead || actor === this) continue;
                    const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                    if (dist <= radius) {
                        const stateNames = Object.keys(actor.states);
                        for (const stateName of stateNames) {
                            actor.removeState(stateName, true);
                            affected++;
                        }
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(affected > 0
                        ? 'A nullifying wave strips away all magical effects!'
                        : 'The scroll crumbles, but nothing happens.');
                }
                return true;
            }

            case 'toggle_torch': {
                const isLit = item.hasAttribute('light_source');
                const targetType = item.getAttribute('toggle_to') || (isLit ? 'torch_unlit' : 'torch');
                const itemData = this.engine.currentPrototype?.getItemData(targetType);
                if (!itemData) return false;

                const maxFuel = item.stats?.burns?.max ?? 500;
                const hasBurnsStat = item.stats?.burns !== undefined;
                const remainingFuel = hasBurnsStat ? (item.stats.burns.current ?? 0) : maxFuel;

                if (!isLit && remainingFuel <= 0) {
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('The torch has no fuel left.', { style: 'warning' });
                    }
                    return false;
                }

                // Lighting from a stack requires a free inventory slot
                if (!isLit && item.count > 1) {
                    const maxInventory = this.getAttribute('inventory');
                    if (maxInventory && this.inventory.length >= maxInventory) {
                        if (this.isPlayerControlled()) {
                            this.engine.inputManager?.showMessage('Your inventory is too full to light a torch from the stack.');
                        }
                        return false;
                    }
                }

                const newItem = new Item(-1, -1, targetType, itemData, this.engine);
                newItem.owner = this;
                newItem.stats = newItem.stats || {};
                newItem.stats.burns = {
                    current: remainingFuel,
                    max: maxFuel,
                    per_turn: isLit ? 0 : -1,
                    display_label: 'Fuel',
                    warnings: [{ threshold: 0.1, message: 'Your torch is almost out!' }]
                };

                if (!isLit && item.count > 1) {
                    item.count--;
                    this.inventory.push(newItem);
                } else {
                    const idx = this.inventory.indexOf(item);
                    if (idx !== -1) this.inventory[idx] = newItem;
                }

                this.engine.updateLighting();
                if (this.isPlayerControlled()) {
                    const msg = isLit ? 'You extinguish the torch.' : 'You light the torch.';
                    this.engine.inputManager?.showMessage(msg);
                    this.engine.interfaceManager?.updatePlayerInfo();
                }
                return true;
            }

            case 'summon_monsters': {
                const floorConfig = this.engine.getFloorConfig(this.engine.currentFloor);
                const randomActors = floorConfig?.random_actors || this.engine.currentPrototype?.config?.random_actors;
                if (!randomActors || Object.keys(randomActors).length === 0) {
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('Nothing answers the call.');
                    }
                    return true;
                }
                const actorTypes = Object.keys(randomActors);
                const summonMin = item?.getAttribute('summon_min') ?? 2;
                const summonMax = item?.getAttribute('summon_max') ?? 4;
                const count = summonMin + Math.floor(ROT.RNG.getUniform() * (summonMax - summonMin + 1));
                let spawned = 0;
                for (const dir of shuffleArray([...ALL_DIRS])) {
                    if (spawned >= count) break;
                    const tx = this.x + dir.dx, ty = this.y + dir.dy;
                    if (!this.engine.mapManager?.floorMap[ty]?.[tx]?.tileId) continue;
                    if (this.engine.entityManager?.getSolidActorAt(tx, ty)) continue;
                    const actorType = actorTypes[Math.floor(ROT.RNG.getUniform() * actorTypes.length)];
                    const actor = this.engine.entityManager.spawnActor(actorType, tx, ty);
                    if (!actor) continue;
                    actor.flash();
                    spawned++;
                }
                if (spawned > 0) {
                    this.flash();
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('Something answers the call.');
                    }
                } else if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('Nothing answers the call.');
                }
                return true;
            }

            case 'recharge_items': {
                let recharged = false;
                for (const invItem of this.inventory || []) {
                    const chargeStat = invItem.getAttribute('charge_stat');
                    if (!chargeStat || !invItem.stats?.[chargeStat]) continue;
                    const stat = invItem.stats[chargeStat];
                    if (stat.per_turn === 0) continue;
                    if (stat.current < stat.max) {
                        stat.current = stat.max;
                        recharged = true;
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.interfaceManager?.updatePlayerInfo();
                    this.engine.inputManager?.showMessage(recharged
                        ? 'A surge of energy recharges the items in your pack.'
                        : 'There is a surge of energy but nothing else happens.');
                }
                return true;
            }

            case 'remove_all_states': {
                const stateNames = Object.keys(this.states);
                if (stateNames.length === 0) {
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('You feel a brief surge of warmth but nothing else happens.');
                    }
                    return true;
                }
                for (const name of stateNames) {
                    this.removeState(name);
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('A warm light floods through you, purging all conditions.');
                }
                return true;
            }

            case 'shatter_walls': {
                const radius = item?.getAttribute('effect_radius') ?? 3;
                let shattered = false;
                const toRemove = [];
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead) continue;
                    if (!actor.hasAttribute('solid') || !actor.hasAttribute('breakable')) continue;
                    const dist = Math.abs(actor.x - this.x) + Math.abs(actor.y - this.y);
                    if (dist <= radius) toRemove.push(actor);
                }
                for (const actor of toRemove) {
                    actor.die?.();
                    shattered = true;
                }
                if (shattered) {
                    const clearedPositions = [];
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            if (Math.abs(dx) + Math.abs(dy) <= radius) {
                                clearedPositions.push({ x: this.x + dx, y: this.y + dy });
                            }
                        }
                    }
                    this.engine.entityManager.revealDugArea(clearedPositions);
                    this.engine.renderer?.effectRunner.apply('shatter', this);
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(shattered
                        ? 'The walls crack and crumble.'
                        : 'Nothing breaks.');
                }
                return shattered;
            }

            case 'spike_door': {
                this.engine.interfaceManager?.enterSpikeDirectionMode(item, this);
                return true;
            }

            case 'darkness_field': {
                const radius = item?.getAttribute('effect_radius') ?? 5;
                let extinguished = false;
                // Extinguish light source items carried by actors in radius
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead) continue;
                    const dist = Math.abs(actor.x - this.x) + Math.abs(actor.y - this.y);
                    if (dist > radius) continue;
                    for (const invItem of actor.inventory || []) {
                        if (!invItem.hasAttribute('light_source')) continue;
                        const burns = invItem.stats?.burns;
                        if (burns && burns.current > 0) {
                            burns.current = 0;
                            extinguished = true;
                            if (actor.isPlayerControlled()) {
                                this.engine.inputManager?.showMessage(`Your ${invItem.name} goes dark.`);
                            }
                        }
                    }
                }
                // Extinguish ground light source items in radius
                for (const groundItem of this.engine.entityManager?.items || []) {
                    if (!groundItem.hasAttribute('light_source')) continue;
                    const dist = Math.abs(groundItem.x - this.x) + Math.abs(groundItem.y - this.y);
                    if (dist > radius) continue;
                    const burns = groundItem.stats?.burns;
                    if (burns && burns.current > 0) {
                        burns.current = 0;
                        extinguished = true;
                    }
                }
                if (extinguished) this.engine.updateLighting();
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('All light fades around you.');
                }
                return true;
            }

            case 'targeted_spell':
                // Targeted spell enters aiming mode - handled by interface
                // Check if item stat is ready (for charged items like staffs)
                const chargeStat = item.getAttribute('charge_stat');
                if (chargeStat && !item.isStatReady(chargeStat)) {
                    const stat = item.stats?.[chargeStat];
                    const current = stat?.current ?? 0;
                    const uses = item.getAttribute('uses') || 1;
                    const readyAt = stat?.ready_at ?? Math.floor((stat?.max ?? 100) / uses);
                    if (this.isPlayerControlled()) {
                        const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                        const msg = stat?.per_turn === 0
                            ? `The ${displayName} is empty.`
                            : `The ${displayName} is not charged yet (${Math.floor(current)}/${readyAt}).`;
                        this.engine.inputManager?.showMessage(msg);
                    }
                    return false;
                }
                // Enter spell aiming mode via interface manager
                this.engine.interfaceManager?.enterSpellAimingMode(item, this);
                return true; // Returns true but turn is consumed in executeSpell
            default:
                console.log(`Unknown item effect: ${effect}`);
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage("You don't understand a word of it!");
                }
                return true;
        }
    }

    /**
     * Get all usable items in inventory (items with use_verb attribute)
     * @returns {Array<{item: Item, verb: string}>}
     */
    getUsableItems() {
        return this.inventory
            .filter(item => item.getAttribute('use_verb'))
            .map(item => ({
                item: item,
                verb: item.getAttribute('use_verb')
            }));
    }

    /**
     * Get the collision description with template substitution
     * Checks equipped weapon's collision_description first, then actor's
     * @param {Actor} target - The actor being attacked
     * @returns {string|null} The processed description or null if none
     */
    getCollisionDescription(target) {
        // Check equipped weapon for collision description first
        const weapon = this.getEquippedWeapon?.();
        let template = weapon?.getAttribute('collision_description');

        // Fall back to actor's collision description
        if (!template) {
            template = this.getAttribute('collision_description');
        }

        if (!template) return null;

        let result = template.replace(/\[([^\]]+)\]/g, (match, key) => {
            // Skip [a-an] - will be processed after all other substitutions
            if (key.toLowerCase() === 'a-an') {
                return match;
            }

            // Handle attacks.category for random attack verbs
            if (key.startsWith('attacks.')) {
                const category = key.substring('attacks.'.length);
                const attacks = this.engine.globalAttacks?.[category];
                if (attacks && attacks.length > 0) {
                    return attacks[Math.floor(Math.random() * attacks.length)];
                }
                return match;
            }
            // Handle adjectives.category
            if (key.startsWith('adjectives.')) {
                const category = key.substring('adjectives.'.length);
                const adjectives = this.engine.globalAdjectives?.[category];
                if (adjectives && adjectives.length > 0) {
                    return adjectives[Math.floor(Math.random() * adjectives.length)];
                }
                return match;
            }
            // Handle special keys
            if (key === 'actor_name') {
                return this.name;
            }
            if (key === 'attacked_actor_name') {
                return target.name;
            }
            if (key === 'weapon_name') {
                const weapon = this.getEquippedWeapon();
                return weapon ? weapon.name : match; // Keep placeholder if no weapon
            }
            return match;
        });

        // Process [a-an] templates after all other substitutions
        return processArticleTemplates(result);
    }

    /**
     * Resolve attribute or stat references in a value string or number
     * Supports patterns like "{strength}" or "-{strength}" which get replaced with actor attribute/stat values
     * Checks stats first (including current value for object stats), then attributes
     * @param {any} value - The value to resolve (string like "-{strength}" or a number)
     * @param {Actor} sourceActor - The actor whose attributes/stats to use for resolution
     * @returns {any} - The resolved value (number if pattern matched, original value otherwise)
     */
    resolveAttributeValue(value, sourceActor) {
        if (typeof value === 'string') {
            // Match patterns like "{attr}", "-{attr}", or "+{attr}"
            const match = value.match(/^([+-]?)?\{(\w+)\}$/);
            if (match) {
                const sign = match[1] || '+';
                const name = match[2];

                // Check stats first
                if (sourceActor.stats && sourceActor.stats[name] !== undefined) {
                    const stat = sourceActor.stats[name];
                    let statValue;
                    if (typeof stat === 'object' && stat.current !== undefined) {
                        statValue = stat.current;
                    } else if (typeof stat === 'number') {
                        statValue = stat;
                    }
                    if (typeof statValue === 'number') {
                        return sign === '-' ? -statValue : statValue;
                    }
                }

                // Fall back to attributes
                const attrValue = sourceActor.getAttribute(name);
                if (typeof attrValue === 'number') {
                    return sign === '-' ? -attrValue : attrValue;
                }

                console.warn(`Stat/Attribute '${name}' not found or not a number on ${sourceActor.name}`);
                return 0;
            }
        }
        return value;
    }

    /**
     * Apply collision effects from actor or held items to a target actor
     * Damage comes from equipped weapon OR actor's collision_effect (not both)
     * Utility effects (like keys unlocking doors) always apply
     * @param {Actor} target - The actor being collided with
     * @returns {{effectApplied: boolean, targetPassable: boolean, targetKilled: boolean, attackAttempted: boolean}}
     */
    applyCollisionEffects(target) {
        // Skip if target is already dead
        if (target.isDead) {
            return { effectApplied: false, targetPassable: true, targetKilled: false, attackAttempted: false };
        }

        let effectApplied = false;
        let targetPassable = false;
        let targetShouldDie = false;

        // Determine the damage source: equipped weapon takes priority, then actor's own effect
        const equippedWeapon = this.getEquippedWeapon();

        // Skip combat interaction with breakable objects (walls) unless we have a mining tool
        // These objects have no health stat and can only be damaged by mining
        const targetIsMineable = target.hasAttribute('breakable') &&
            (!target.stats || target.stats.health === undefined);
        const hasMiningTool = equippedWeapon?.hasAttribute('mining');

        if (targetIsMineable && !hasMiningTool) {
            // Just bump sound, no combat
            return { effectApplied: false, targetPassable: false, targetKilled: false, attackAttempted: false };
        }
        let damageSource = null;

        if (equippedWeapon) {
            const weaponEffect = equippedWeapon.getAttribute('collision_effect');
            if (weaponEffect) {
                damageSource = {
                    name: equippedWeapon.name,
                    effect: weaponEffect,
                    sound: equippedWeapon.getAttribute('collision_sound'),
                    item: equippedWeapon,
                    lockColor: equippedWeapon.getAttribute('lock_color'),
                    sourceActor: this
                };
            }
        }

        // Fall back to actor's own collision_effect if no weapon equipped
        if (!damageSource) {
            const actorEffect = this.getAttribute('collision_effect');
            if (actorEffect) {
                damageSource = {
                    name: this.name,
                    effect: actorEffect,
                    sound: this.getAttribute('collision_sound'),
                    item: null,
                    lockColor: null,
                    sourceActor: this
                };
            }
        }

        // Gather utility effect sources (non-weapon items like keys)
        const utilitySources = [];
        for (const item of this.inventory) {
            // Skip the equipped weapon (already handled above)
            if (item === equippedWeapon) continue;

            const itemEffect = item.getAttribute('collision_effect');
            if (itemEffect) {
                // Check if this item has any utility effects (non-stat modifying effects like "locked": false)
                const hasUtilityEffect = Object.values(itemEffect).some(val => {
                    // Utility effects are boolean values or toggle
                    return typeof val === 'boolean' || val === 'toggle';
                });

                if (hasUtilityEffect) {
                    utilitySources.push({
                        name: item.name,
                        effect: itemEffect,
                        sound: item.getAttribute('collision_sound'),
                        item: item,
                        lockColor: item.getAttribute('lock_color'),
                        sourceActor: this
                    });
                }
            }
        }

        // Determine if target is a valid combat target:
        // - Has health stats (enemy/creature), or
        // - Is breakable (mineable wall — non-mining-tool case already returned early above)
        const targetHasHealth = target.stats?.health !== undefined;
        const isCombatTarget = damageSource && (targetHasHealth || target.hasAttribute('breakable'));

        // Show weapon swing visual only when combat is actually attempted
        if (isCombatTarget && equippedWeapon?.tileIndex && this.engine.renderer) {
            this.engine.interfaceManager?.showWeaponSwing(equippedWeapon, target.x, target.y);
        }

        // Play attack/swing sound on every combat attempt (hit or miss)
        if (isCombatTarget && damageSource) {
            const attackSound = damageSource.item?.getAttribute('attack_sound') ||
                                damageSource.sourceActor?.getAttribute('attack_sound');
            if (attackSound) {
                this.engine.playSound(attackSound);
            }
        }

        // Perform hit roll for damage source
        let damageHits = true;
        if (damageSource && isCombatTarget) {
            const attackerAccuracy = this.getEffectiveAccuracy();

            // Only roll if attacker has accuracy attribute AND target is not incapacitated
            // Skip hit roll for stationary objects (breakable actors without health) - always hit
            const targetIncapacitated = target.hasStateProperty?.('skip_turn');
            const targetIsStationary = target.hasAttribute('breakable') && (!target.stats || target.stats.health === undefined);

            if (attackerAccuracy !== null && !targetIncapacitated && !targetIsStationary) {
                const hitChance = this.calculateHitProbability(target);
                // Use ROT.RNG for deterministic/seedable combat
                const roll = ROT.RNG.getPercentage(); // Returns 1-100
                damageHits = roll <= hitChance;

                const targetDefense = target.getEffectiveDefense?.() || 0;
                console.log(`Hit roll: ${roll} vs ${hitChance}% (${attackerAccuracy} * 0.987^${targetDefense}) = ${damageHits ? 'HIT' : 'MISS'}`);
            }
            // If no accuracy attribute or target incapacitated, damageHits remains true (deterministic combat)
        }

        // Apply damage effects if hit succeeded
        if (isCombatTarget && damageHits) {
            const result = this._applyEffectSource(damageSource, target, true);
            if (result.applied) effectApplied = true;
            if (result.targetPassable) targetPassable = true;
            if (result.targetShouldDie) targetShouldDie = true;
        } else if (isCombatTarget && !damageHits) {
            // Miss - show miss feedback
            this._showMissMessage(target);
        }

        // Apply utility effects (always, regardless of hit roll)
        for (const source of utilitySources) {
            const result = this._applyEffectSource(source, target, false);
            if (result.applied) effectApplied = true;
            if (result.targetPassable) targetPassable = true;
            if (result.targetShouldDie) targetShouldDie = true;
        }

        // Flash the target for visual feedback if any effect was applied
        if (effectApplied && target.flash) {
            target.flash();
            if (target.isPlayerControlled?.()) {
                this.engine.renderer?.effectRunner.apply('damage_shake');
            }
        }

        // Show collision description if damage hit
        if (damageHits && damageSource && effectApplied) {
            const description = this.getCollisionDescription(target);
            if (description) {
                const pos = (this.isPlayerControlled() || target.isPlayerControlled?.()) ? null : { x: target.x, y: target.y };
                this.engine.inputManager?.showMessage(description, pos);
            }
        }

        // Now trigger death after collision description is shown
        if (targetShouldDie) {
            const wasBreakableWall = target.hasAttribute('breakable') && target.hasAttribute('solid');
            const targetPos = { x: target.x, y: target.y };
            target.die();
            if (wasBreakableWall) {
                this.engine.entityManager.revealDugArea([targetPos]);
            }
        }

        // attackAttempted is true if we had a damage source (even on miss)
        // This is used to consume the turn regardless of hit/miss
        const attackAttempted = damageSource !== null;
        return { effectApplied, targetPassable, targetKilled: targetShouldDie, attackAttempted };
    }

    /**
     * Apply effects from a single source to a target
     * @param {Object} source - The effect source
     * @param {Actor} target - The target actor
     * @param {boolean} isDamageSource - Whether this is the damage source (applies stat changes)
     * @returns {Object} { applied, targetPassable, targetShouldDie }
     */
    _applyEffectSource(source, target, isDamageSource) {
        let sourceApplied = false;
        let targetPassable = false;
        let targetShouldDie = false;

        for (const [key, rawValue] of Object.entries(source.effect)) {
            const value = this.resolveAttributeValue(rawValue, source.sourceActor);

            // For damage sources, apply stat changes
            // For utility sources, skip stat changes (only apply utility effects)
            if (target.stats && target.stats[key] !== undefined) {
                if (!isDamageSource) continue; // Skip stat effects for utility sources

                // Track attacker for defend_self behavior (when health is reduced)
                if (key === 'health' && value < 0 && source.sourceActor) {
                    target._lastAttacker = source.sourceActor;
                }

                let finalValue = value;

                // For health damage from weapons, apply critical hits and strength multiplier
                if (key === 'health' && value < 0) {
                    const isWeaponDamage = source.item?.hasAttribute('weapon') ||
                                           (source.sourceActor && !source.item); // Unarmed counts as weapon damage

                    if (isWeaponDamage && source.sourceActor) {
                        // Check for critical hit (before strength scaling)
                        if (source.item && source.sourceActor.checkCriticalHit(source.item)) {
                            finalValue = value * 2; // Double damage
                            if (source.sourceActor.isPlayerControlled()) {
                                source.sourceActor.engine.inputManager?.showMessage('Critical hit!');
                            }
                            console.log(`Critical hit! ${value} -> ${finalValue}`);
                        }

                        // Apply strength multiplier: damage = base * (strength / 10)
                        const strength = source.sourceActor.getEffectiveStrength();
                        const multiplier = strength / 10;
                        const strengthScaledDamage = Math.round(finalValue * multiplier);

                        if (multiplier !== 1) {
                            console.log(`Strength scaling: ${finalValue} * ${multiplier.toFixed(2)} (str ${strength}) = ${strengthScaledDamage}`);
                        }
                        finalValue = strengthScaledDamage;
                    }

                    // Apply weapon enchantment bonus
                    if (source.item?.enchantment) {
                        finalValue -= source.item.enchantment;
                    }
                }

                // Use centralized modifyStat for immediate UI updates
                const newValue = target.modifyStat(key, finalValue, { source: source });
                if (newValue !== null) {
                    console.log(`${source.name}: applied ${finalValue >= 0 ? '+' : ''}${finalValue} to ${target.name}'s ${key}`);
                    sourceApplied = true;

                    // Apply weapon proc effects after successful damage
                    if (key === 'health' && finalValue < 0 && source.sourceActor && source.item) {
                        source.sourceActor.applyWeaponProc(target, source.item, finalValue);

                        // Auto-identify weapon after enough combat use
                        if (source.sourceActor.isPlayerControlled() &&
                            source.item.identified === false &&
                            source.item.hasAttribute('enchantable')) {
                            source.item.combatUseCount = (source.item.combatUseCount || 0) + 1;
                            if (source.item.combatUseCount >= 20) {
                                source.item.identify();
                                source.sourceActor.engine.inputManager?.showMessage(
                                    `You are now confident about your ${source.item.getDisplayName()}.`
                                );
                            }
                        }
                    }

                    // Auto-identify armor after enough hits received
                    if (key === 'health' && finalValue < 0 && target.isPlayerControlled?.()) {
                        for (const slot of ['top', 'middle', 'lower', 'ring1', 'ring2']) {
                            const armor = target.equipment?.[slot];
                            if (armor?.identified === false && armor.hasAttribute('enchantable')) {
                                armor.combatUseCount = (armor.combatUseCount || 0) + 1;
                                if (armor.combatUseCount >= 20) {
                                    armor.identify();
                                    target.engine.inputManager?.showMessage(
                                        `You are now confident about your ${armor.getDisplayName()}.`
                                    );
                                }
                            }
                        }
                    }

                    if (key === 'health' && newValue <= 0) {
                        targetShouldDie = true;
                        targetPassable = true;
                    }
                }
                continue;
            }

            // Handle mining: health damage to breakable actors without health stat
            if (key === 'health' && isDamageSource && target.hasAttribute('breakable')) {
                const isMiningWeapon = source.item?.hasAttribute('mining');
                if (isMiningWeapon) {
                    // Use mining_power from the weapon, default to 25
                    const miningPower = source.item.getAttribute('mining_power') || 25;
                    // Initialize mining damage tracker on target
                    if (target._miningDamage === undefined) {
                        target._miningDamage = 0;
                    }
                    target._miningDamage += miningPower;

                    // Threshold to break (default 100)
                    const breakThreshold = target.getAttribute('break_threshold') || 100;

                    console.log(`Mining ${target.name}: ${target._miningDamage}/${breakThreshold}`);
                    sourceApplied = true;

                    // Play mining sound
                    if (source.sound) {
                        this.engine.playSound(source.sound);
                    }

                    // Show mining progress message
                    if (this.isPlayerControlled() && this.engine.inputManager) {
                        const progress = Math.min(100, Math.floor((target._miningDamage / breakThreshold) * 100));
                        if (target._miningDamage >= breakThreshold) {
                            this.engine.inputManager.showMessage(`The ${target.name} crumbles!`);
                        } else if (progress >= 75) {
                            this.engine.inputManager.showMessage(`The ${target.name} is nearly broken.`);
                        } else if (progress >= 50) {
                            this.engine.inputManager.showMessage(`Cracks spread through the ${target.name}.`);
                        } else if (progress >= 25) {
                            this.engine.inputManager.showMessage(`The ${target.name} chips away.`);
                        } else {
                            this.engine.inputManager.showMessage(`You strike the ${target.name}.`);
                        }
                    }

                    if (target._miningDamage >= breakThreshold) {
                        targetShouldDie = true;
                        // Don't set targetPassable - miner shouldn't move into the space on the same turn
                    }
                    continue;
                }
            }

            // Handle apply_state: apply a state to the target
            if (key === 'apply_state' && isDamageSource) {
                const stateName = value;
                const statesData = this.engine.globalStates;
                if (statesData && statesData[stateName]) {
                    const applied = target.applyState(stateName, statesData[stateName]);
                    if (applied) {
                        sourceApplied = true;
                    }
                }
                continue;
            }

            // Fall back to attributes
            const currentValue = target.getAttribute(key);

            if (value === 'toggle') {
                if (currentValue !== undefined) {
                    target.setAttribute(key, !currentValue);
                    console.log(`${source.name}: toggled ${target.name}'s ${key} to ${!currentValue}`);
                    sourceApplied = true;
                }
            }
            else if (typeof value === 'number' && typeof currentValue === 'number') {
                if (!isDamageSource) continue; // Skip numeric attribute changes for utility
                const newValue = currentValue + value;
                target.setAttribute(key, newValue);
                console.log(`${source.name}: ${target.name}'s ${key} ${value >= 0 ? '+' : ''}${value} (now ${newValue})`);
                sourceApplied = true;

                if (key === 'health' && newValue <= 0) {
                    targetShouldDie = true;
                    targetPassable = true;
                }
            }
            else if (typeof value === 'boolean') {
                // Special handling for locked attribute with color-locked doors
                if (key === 'locked' && value === false && target.hasAttribute('color_locked')) {
                    const targetLockColor = target.getAttribute('lock_color');
                    const sourceLockColor = source.lockColor;

                    if (targetLockColor && sourceLockColor && targetLockColor === sourceLockColor) {
                        target.setAttribute(key, value);
                        console.log(`${source.name} (${sourceLockColor}) unlocks ${target.name} (${targetLockColor})!`);
                        sourceApplied = true;
                        this.engine.playSound?.('lock');
                        target.open();
                        this.engine.updateLighting();
                        targetPassable = !target.hasAttribute('solid');

                        if (this.isPlayerControlled()) {
                            this.engine.inputManager?.showMessage(`The ${source.name} unlocks the ${targetLockColor} door!`);
                        }

                        if (source.item && source.item.hasAttribute('consumable')) {
                            this.inventory = this.inventory.filter(i => i !== source.item);
                            console.log(`${source.name} was consumed`);
                        }
                    } else {
                        console.log(`${source.name} (${sourceLockColor || 'no color'}) doesn't match ${target.name} (${targetLockColor})`);
                        if (this.isPlayerControlled() && targetLockColor) {
                            this.engine.inputManager?.showMessage(`The ${targetLockColor} door requires a ${targetLockColor} key.`);
                        }
                    }
                }
                else if (currentValue !== undefined) {
                    target.setAttribute(key, value);
                    console.log(`${source.name}: set ${target.name}'s ${key} to ${value}`);
                    sourceApplied = true;

                    if (key === 'locked' && value === false && target.hasAttribute('openable')) {
                        this.engine.playSound?.('lock');
                        target.open();
                        this.engine.updateLighting();
                        targetPassable = !target.hasAttribute('solid');
                    }
                }
            }
        }

        if (sourceApplied && source.sound) {
            this.engine.playSound(source.sound);
        }

        return { applied: sourceApplied, targetPassable, targetShouldDie };
    }

    /**
     * Show a miss message for failed attacks using template system
     * @param {Actor} target - The target that was missed
     */
    _showMissMessage(target) {
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`You miss ${target.getNameWithArticle()}!`);
        } else {
            // Use template: "The [actor_name] [attacks.miss_verbs] the [attacked_actor_name]!"
            const template = "The [actor_name] [attacks.miss_verbs] the [attacked_actor_name]!";
            const message = this._processMessageTemplate(template, target);
            const pos = target.isPlayerControlled?.() ? null : { x: this.x, y: this.y };
            this.engine.inputManager?.showMessage(message, pos);
        }

        console.log(`Miss: ${this.name} -> ${target.name}`);
    }

    /**
     * Process a message template with substitution (shared by hit/miss messages)
     * @param {string} template - Template string with [key] placeholders
     * @param {Actor} target - The target actor
     * @returns {string} Processed message
     */
    _processMessageTemplate(template, target) {
        let result = template.replace(/\[([^\]]+)\]/g, (match, key) => {
            // Handle attacks.category for random attack verbs
            if (key.startsWith('attacks.')) {
                const category = key.substring('attacks.'.length);
                const attacks = this.engine.globalAttacks?.[category];
                if (attacks && attacks.length > 0) {
                    return attacks[Math.floor(Math.random() * attacks.length)];
                }
                return match;
            }
            // Handle special keys
            if (key === 'actor_name') {
                return this.name;
            }
            if (key === 'attacked_actor_name') {
                return target.name;
            }
            if (key === 'weapon_name') {
                const weapon = this.getEquippedWeapon();
                return weapon ? weapon.name : match;
            }
            return match;
        });

        return result;
    }

    /**
     * Check if a tile has a floor (is not a void/pit)
     */
    hasFloorAt(x, y) {
        if (x < 0 || x >= this.engine.mapManager.width ||
            y < 0 || y >= this.engine.mapManager.height) {
            return false;
        }
        const tile = this.engine.mapManager.floorMap[y][x];
        return tile && tile.tileId;
    }

    hasPlatformAt(x, y) {
        return this.engine.entityManager.getActorsAt(x, y)
            .some(a => !a.isDead && a.hasAttribute('platform') && a.hasAttribute('visible'));
    }

    /**
     * Check if an actor can be pushed to a position
     * @param {number} x - Target X coordinate
     * @param {number} y - Target Y coordinate
     * @returns {boolean} True if position is valid for pushing
     */
    canPushTo(x, y) {
        // Check bounds
        if (x < 0 || x >= this.engine.mapManager.width ||
            y < 0 || y >= this.engine.mapManager.height) {
            return false;
        }

        // Floor check removed - pushing into voids is allowed (actor will fall)

        // Check for walls don't need this since all walls in play are actors
        /* const wallTile = this.engine.mapManager.wallMap[y][x];
        if (wallTile !== null) {
            return false;
        } */

        // Check for blocking actors
        const actorAt = this.engine.entityManager.getSolidActorAt(x, y);
        if (actorAt) {
            return false;
        }

        return true;
    }

    /**
     * Get valid movement directions for sighted actors
     * Filters out directions that would lead to void tiles or blocking actors
     */
    getValidMoveDirections() {
        return CARDINAL_DIRS.filter(dir => {
            const newX = this.x + dir.dx;
            const newY = this.y + dir.dy;

            // Check bounds
            if (newX < 0 || newX >= this.engine.mapManager.width ||
                newY < 0 || newY >= this.engine.mapManager.height) {
                return false;
            }

            // Check for blocking actors
            const actorAtTarget = this.engine.entityManager.getSolidActorAt(newX, newY);
            if (actorAtTarget) {
                return false;
            }

            // Check for floor tile or platform
            if (!this.hasFloorAt(newX, newY) && !this.hasPlatformAt(newX, newY)) {
                return false;
            }

            return true;
        });
    }

    /**
     * Called when actor falls into a void tile
     */
    async fall() {
        console.log(`${this.name} fell into the void!`);

        const config = this.engine.currentPrototype?.config;
        const totalFloors = config?.levels ? config.levels.length : 1;
        const hasFloorBelow = totalFloors > 1 && this.engine.currentFloor < totalFloors;

        if (hasFloorBelow) {
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`The floor gives way beneath you!`);
                await this.engine.fallToNextFloor(this);
                return;
            }

            // Queue non-player actor to appear on the next floor
            const targetFloor = this.engine.currentFloor + 1;
            const serialized = this.serialize();
            const fallDamage = Math.floor((this.stats?.health?.max || 20) * 0.3);
            serialized._fallDamage = fallDamage;

            if (!this.engine.pendingFallenActors.has(targetFloor)) {
                this.engine.pendingFallenActors.set(targetFloor, []);
            }
            this.engine.pendingFallenActors.get(targetFloor).push(serialized);

            if (this.hasAttribute('visible')) {
                this.engine.inputManager?.showMessage(`The ${this.name} falls through!`, { x: this.x, y: this.y });
            }
            this.die(false);
            return;
        }

        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`You plunge into the depths!`);
        } else if (this.hasAttribute('visible')) {
            this.engine.inputManager?.showMessage(`The ${this.name} falls into the void.`, { x: this.x, y: this.y });
        }

        this.dropItems(true);
        this.die(false);
    }

    collapse() {
        if (this.spriteBase) this.spriteBase.visible = false;
        if (this.spriteTop) this.spriteTop.visible = false;
        this.die(false);
        this.engine.entityManager.invalidateActorPosCache();
    }

    /**
     * Drop all inventory items when actor dies or is removed
     * @param {boolean} destroyItems - If true, items are lost (fell into void)
     */
    dropItems(destroyItems = false) {
        if (this.inventory.length === 0) return;

        // Unequip all items first
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.equipment[slot]) {
                this.unequipFromSlot(slot);
            }
        }

        if (destroyItems) {
            console.log(`${this.name}'s items were lost to the void`);
            this.inventory = [];
            return;
        }

        // Find valid floor tiles around the actor (current tile + 8 neighbors)
        const dropPositions = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const tx = this.x + dx;
                const ty = this.y + dy;
                if (this.hasFloorAt(tx, ty) || this.hasPlatformAt(tx, ty)) {
                    dropPositions.push({ x: tx, y: ty });
                }
            }
        }

        if (dropPositions.length === 0) {
            console.log(`${this.name}'s items were lost - no valid drop location`);
            this.inventory = [];
            return;
        }

        // Drop items to available positions (skip items with drop: false)
        let posIndex = 0;
        for (const item of this.inventory) {
            if (item.getAttribute('drop') === false) {
                console.log(`${item.name} was not dropped (drop: false)`);
                continue;
            }
            const pos = dropPositions[posIndex % dropPositions.length];
            item.x = pos.x;
            item.y = pos.y;
            this.engine.entityManager.addEntity(item);
            console.log(`${item.name} dropped at (${pos.x}, ${pos.y})`);
            posIndex++;
        }

        this.inventory = [];
    }

    // Movement methods
    /**
     * Attempt to move to a new position
     * @param {number} newX - Target X coordinate
     * @param {number} newY - Target Y coordinate
     * @returns {{moved: boolean, actionTaken: boolean}} moved=position changed, actionTaken=turn should be consumed
     */
    tryMove(newX, newY) {
        // Hide walk path highlight when player moves
        this.engine.renderer?.hideWalkPath();

        // Check bounds
        if (newX < 0 || newX >= this.engine.mapManager.width ||
            newY < 0 || newY >= this.engine.mapManager.height) {
            return { moved: false, actionTaken: false };
        }

        // Block diagonal movement past wall corners (Brogue-style)
        if (isDiagonalBlocked(this.x, this.y, newX, newY, (x, y) => (this.hasFloorAt(x, y) || this.hasPlatformAt(x, y)) && !this.engine.entityManager.getSolidActorAt(x, y))) {
            return { moved: false, actionTaken: false };
        }

        // Check for blocking actors (use getSolidActorAt so non-solid actors
        // sharing a tile don't shadow the solid one)
        const actorAtTarget = this.engine.entityManager.getSolidActorAt(newX, newY);
        if (actorAtTarget) {
            // Scutigera chain members never collide with each other
            if (this._chainHead && actorAtTarget._chainHead === this._chainHead) {
                return { moved: false, actionTaken: false };
            }
            // Check if actor can be pushed (requires pusher to have strength > 0)
            const pusherStrength = this.getAttribute('strength');
            if (actorAtTarget.hasAttribute('pushable') && pusherStrength && pusherStrength > 0) {
                const dx = newX - this.x;
                const dy = newY - this.y;
                const pushX = newX + dx;
                const pushY = newY + dy;

                // Check if the push destination is valid
                const canPush = this.canPushTo(pushX, pushY);
                if (canPush) {
                    // Push the actor
                    actorAtTarget.x = pushX;
                    actorAtTarget.y = pushY;
                    actorAtTarget.updateSpritePosition();
                    this.engine.playSound('push1');

                    // Check if pushed into void (platforms prevent falling)
                    if (!this.hasFloorAt(pushX, pushY) && !this.hasPlatformAt(pushX, pushY)) {
                        console.log(`${this.name} pushes ${actorAtTarget.name} into the void`);
                        if (this.isPlayerControlled()) {
                            this.engine.inputManager?.showMessage(`You push ${actorAtTarget.getNameWithArticle()} into the void!`);
                        }
                        // Kill the actor (same as fall() but without duplicate message)
                        actorAtTarget.dropItems(true);
                        actorAtTarget.die(false);
                    } else {
                        console.log(`${this.name} pushes ${actorAtTarget.name}`);
                        // Show push message if player is pushing
                        if (this.isPlayerControlled()) {
                            this.engine.inputManager?.showMessage(`You push ${actorAtTarget.getNameWithArticle()}.`);
                        }
                    }

                    // Crush breakable items under the pushed actor
                    const crushedItem = this.engine.entityManager.getItemAt(pushX, pushY);
                    if (crushedItem && crushedItem.hasAttribute('breakable')) {
                        const breakSound = crushedItem.getAttribute('break_sound');
                        if (breakSound) this.engine.playSound(breakSound);
                        if (crushedItem.hasAttribute('explosive')) {
                            this.engine.interfaceManager?.createExplosiveCloud(crushedItem, pushX, pushY);
                            const displayName = crushedItem.getDisplayName ? crushedItem.getDisplayName() : crushedItem.name;
                            this.engine.inputManager?.showMessage(`The ${displayName} shatters!`);
                        } else {
                            const displayName = crushedItem.getDisplayName ? crushedItem.getDisplayName() : crushedItem.name;
                            this.engine.inputManager?.showMessage(`The ${displayName} is crushed!`);
                        }
                        crushedItem.die();
                    }

                    // Now move into the vacated space
                    const pushDx = newX - this.x;
                    if (pushDx > 0) this.setFacing('right');
                    else if (pushDx < 0) this.setFacing('left');
                    this.x = newX;
                    this.y = newY;
                    this.updateSpritePosition();

                    // Viewport snap check after push-move
                    if (this.isPlayerControlled() && this.engine.viewportEnabled) {
                        if (this.engine.snapViewportToTile(this.x, this.y)) {
                            this.engine.onSectionChange();
                        }
                    }

                    // Update lighting if needed
                    if (this.isPlayerControlled() || this.hasAttribute('light_source')) {
                        this.engine.updateLighting();
                    }

                    return { moved: true, actionTaken: true };
                }
                // Can't push - fall through to normal blocking behavior
            }

            // Check for weapon attack style (sweep, penetrate)
            const styleResult = this.resolveAttackStyle(newX, newY, newX - this.x, newY - this.y, actorAtTarget);
            if (styleResult.handled) {
                return { moved: styleResult.moved, actionTaken: styleResult.actionTaken };
            }

            // Face toward the target
            const collisionDx = newX - this.x;
            if (collisionDx > 0) this.setFacing('right');
            else if (collisionDx < 0) this.setFacing('left');

            // Apply collision effects from held items (before door check so keys can unlock doors)
            const collisionResult = this.applyCollisionEffects(actorAtTarget);

            // If collision effects made the actor passable (e.g., key unlocked door), try again
            // But don't move onto a tile where we just killed something - attack is the action
            if (collisionResult.targetPassable && !collisionResult.targetKilled) {
                // Recurse to check if we can now move
                return this.tryMove(newX, newY);
            }

            if (actorAtTarget.hasAttribute('clock')) {
                actorAtTarget._clockPaused = !actorAtTarget._clockPaused;
                const state = actorAtTarget._clockPaused ? 'stops' : 'resumes';
                this.engine.playSound?.('tap2');
                this.engine.inputManager?.showMessage(`The ${actorAtTarget.name} ${state} ticking.`, { x: actorAtTarget.x, y: actorAtTarget.y });
                return { moved: false, actionTaken: true };
            }

            if (actorAtTarget.hasAttribute('switchable')) {
                actorAtTarget.toggle();
                return { moved: false, actionTaken: true };
            }

            // Check if actor can be opened (doors, chests, etc.)
            if (actorAtTarget.hasAttribute('openable') && !actorAtTarget.hasAttribute('open')) {
                // Spiked doors cannot be opened — must be attacked and destroyed
                if (actorAtTarget.hasAttribute('spiked')) {
                    this.engine.playSound?.('tap1');
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage(
                            `The ${actorAtTarget.name} is jammed shut with a spike.`
                        );
                    }
                    return { moved: false, actionTaken: false };
                }
                // Check if locked - play rejection sound and block
                if (actorAtTarget.hasAttribute('locked')) {
                    console.log(`${actorAtTarget.name} is locked`);
                    this.engine.playSound?.('plunk3');
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage(`The ${actorAtTarget.name} is locked.`);
                    }
                    return { moved: false, actionTaken: false };
                }
                actorAtTarget.open();
                this.engine.updateLighting();
                return { moved: false, actionTaken: true };
            }

            // Check for collision_description attribute (for non-combat interactions like locked stairways)
            // Only show if no collision_effect - combat descriptions are handled by applyCollisionEffects
            if (this.isPlayerControlled() &&
                actorAtTarget.hasAttribute('collision_description') &&
                !actorAtTarget.hasAttribute('collision_effect')) {
                this.engine.inputManager?.showMessage(actorAtTarget.getAttribute('collision_description'));
                return { moved: false, actionTaken: true };
            }

            if (!collisionResult.attackAttempted) {
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(`The ${actorAtTarget.name} blocks your way.`);
                }
            }
            // Attack attempted (hit or miss) = action taken, even though we didn't move
            return { moved: false, actionTaken: collisionResult.attackAttempted };
        }

        // Check for floor tile - if no floor, actor falls (flying actors hover above, platforms prevent falling)
        if (!this.hasFloorAt(newX, newY) && !this.hasPlatformAt(newX, newY) && !this.hasStateProperty('flying')) {
            // Move to the void tile first (so we can see them fall)
            this.x = newX;
            this.y = newY;
            this.updateSpritePosition();
            // Viewport snap check before fall
            if (this.isPlayerControlled() && this.engine.viewportEnabled) {
                if (this.engine.snapViewportToTile(this.x, this.y)) {
                    this.engine.onSectionChange();
                }
            }
            this.fall();
            return { moved: true, actionTaken: true }; // Move happened, actor just died
        }

        // Check for lunge attack before normal movement
        const lungeResult = this.resolveAttackStyle(newX, newY, newX - this.x, newY - this.y, null);
        if (lungeResult.handled) {
            return { moved: lungeResult.moved, actionTaken: lungeResult.actionTaken };
        }

        // Move successful - track last position for notable event detection
        this._lastPosition = { x: this.x, y: this.y };

        // Check if leaving a liquid tile — pick up its tint for wet tracks
        const liquidAtOld = this.engine.entityManager._getLiquidActorAt(this.x, this.y);
        if (liquidAtOld && liquidAtOld.tint != null) {
            this._liquidTrackTint = liquidAtOld.tint;
            this._liquidTrackSteps = 3;
            this._liquidTrackLastEntity = null;
        }

        const moveDir = this.getMovementDirection(
            { x: this.x, y: this.y }, { x: newX, y: newY }
        );

        const moveDx = newX - this.x;
        if (moveDx > 0) this.setFacing('right');
        else if (moveDx < 0) this.setFacing('left');
        this.x = newX;
        this.y = newY;
        this.updateSpritePosition();

        // Leave liquid tracks on the new tile
        if (this._liquidTrackSteps > 0) {
            const liquidAtNew = this.engine.entityManager._getLiquidActorAt(newX, newY);
            if (!liquidAtNew) {
                const em = this.engine.entityManager;
                // Update previous track segment to connect toward this tile
                if (this._liquidTrackLastEntity) {
                    em.updateLiquidTrackTile(
                        this._liquidTrackLastEntity,
                        this._liquidTrackLastEntity._trackEntryDir,
                        moveDir
                    );
                }
                const track = em.spawnLiquidTrack(
                    newX, newY, this._liquidTrackTint, moveDir, null
                );
                this._liquidTrackLastEntity = track;
                this._liquidTrackSteps--;
            }
        }

        // Viewport snap check after successful move
        if (this.isPlayerControlled() && this.engine.viewportEnabled) {
            if (this.engine.snapViewportToTile(this.x, this.y)) {
                this.engine.onSectionChange();
            }
        }

        // Process passive effects from inventory items (e.g., thread trail)
        this.processPassiveEffects(this._lastPosition, { x: newX, y: newY });

        // Auto-close doors behind player-controlled actors
        if (this.isPlayerControlled() && this._lastPosition) {
            this.engine.entityManager.invalidateActorPosCache();
            const actorsAtOldPos = this.engine.entityManager.getActorsAt(
                this._lastPosition.x, this._lastPosition.y
            );
            for (const actor of actorsAtOldPos) {
                if (actor.hasAttribute('openable') && actor.getAttribute('open') && !actor.hasAttribute('spiked')) {
                    actor.close(true);
                }
            }
        }

        // Check for items to pick up
        const itemAtTarget = this.engine.entityManager.getItemAt(newX, newY);
        if (itemAtTarget && itemAtTarget.hasAttribute('pickupable')) {
            this.pickUpItem(itemAtTarget);
        }

        // Check for entity walk descriptions (only for player-controlled actors)
        if (this.isPlayerControlled()) {
            const entityAtTarget = this.engine.entityManager.getEntityAt(newX, newY);
            if (entityAtTarget && entityAtTarget.hasAttribute('walk_description')) {
                this.engine.inputManager?.showMessage(entityAtTarget.getAttribute('walk_description'));
            }
        }

        // Check for stairway and gateway actors (only for player-controlled actors)
        if (this.isPlayerControlled()) {
            const actorsAtNewPos = this.engine.entityManager.getActorsAt(newX, newY);
            const stairway = actorsAtNewPos.find(a => a.hasAttribute('stairway'));
            if (stairway) {
                const direction = stairway.getAttribute('stairway');

                // Lock the turn engine to prevent further actions during transition
                if (this.engine.turnEngine) {
                    this.engine.turnEngine.lock();
                }
                this.engine.useStairway(direction);
                return { moved: true, actionTaken: true }; // Exit early, transition handles everything
            }

            // Check for gateway actors (visible gateways trigger prototype transition)
            const gateway = actorsAtNewPos.find(a => a.hasAttribute('gateway') && a.getAttribute('visible'));
            if (gateway) {
                if (this.engine.turnEngine) {
                    this.engine.turnEngine.lock();
                }
                this.engine.useGateway();
                return { moved: true, actionTaken: true };
            }
        }

        // Update lighting if this actor affects it
        if (this.isPlayerControlled() || this.hasAttribute('light_source')) {
            this.engine.updateLighting();
        }

        // Check for submersion in deep liquids (flying actors hover above)
        if (!this.hasStateProperty('flying')) {
            this.updateSubmersionState();
        }

        // Check for clouds/mist at destination and apply their effects immediately
        this.checkCloudEffects(newX, newY);

        // Notify interface of player move (for dismissOnMove text boxes)
        if (this.isPlayerControlled() && this.engine.interfaceManager) {
            this.engine.interfaceManager.onPlayerMove();
        }

        // Trigger non-solid switchable actors at destination (pressure plates, etc.)
        for (const other of this.engine.entityManager.getActorsAt(newX, newY)) {
            if (other === this || other.hasAttribute('solid')) continue;
            if (other.hasAttribute('switchable') && !other.hasAttribute('toggled')) {
                other.toggle();
            }
        }

        // Collapse any collapsible platform actors at destination
        const collapsibles = this.engine.entityManager.getActorsAt(newX, newY)
            .filter(a => a !== this && !a.isDead && a.hasAttribute('collapsible'));
        if (collapsibles.length > 0) {
            const actor = this;
            this.engine.renderer?.effectRunner.apply('collapse_shake');
            this.engine.playSound('push1');
            if (this.engine.turnEngine) this.engine.turnEngine.lock();
            setTimeout(async () => {
                for (const other of collapsibles) {
                    other.collapse();
                }
                if (!actor.hasFloorAt(newX, newY) && !actor.hasPlatformAt(newX, newY) && !actor.hasStateProperty('flying')) {
                    await new Promise(r => setTimeout(r, 400));
                    await actor.fall();
                }
                if (actor.engine.turnEngine) actor.engine.turnEngine.unlock();
            }, 300);
            return { moved: true, actionTaken: true };
        }

        // Check for entry sound from non-solid actors at destination (for controlled actors)
        let entrySound = null;
        if (this.isPlayerControlled()) {
            const actorAtTarget = this.engine.entityManager.getOtherActorAt(newX, newY, this);
            if (actorAtTarget && !actorAtTarget.hasAttribute('solid') && actorAtTarget.hasAttribute('entry_sound')) {
                entrySound = actorAtTarget.getAttribute('entry_sound');
            }
        }

        // Auto-loot inventory from non-solid actors at destination
        const actorsHere = this.engine.entityManager.getActorsAt(newX, newY);
        for (const other of actorsHere) {
            if (other === this || other.hasAttribute('solid')) continue;
            if (other.inventory.length === 0) continue;
            const items = [...other.inventory];
            for (const item of items) {
                if (this.pickUpItem(item)) {
                    other.inventory.splice(other.inventory.indexOf(item), 1);
                }
            }
            other.updateInventoryDisplay();
        }

        return { moved: true, actionTaken: true, entrySound };
    }

    moveBy(dx, dy) {
        return this.tryMove(this.x + dx, this.y + dy);
    }

    /**
     * Check for cloud/mist effects at a position and apply them to this actor
     * Called when actor moves into a tile to apply effects immediately
     * @param {number} x - X coordinate to check
     * @param {number} y - Y coordinate to check
     */
    checkCloudEffects(x, y) {
        const entityManager = this.engine.entityManager;
        for (const other of entityManager.getActorsAt(x, y)) {
            if (other === this) continue;
            if (other.type !== 'cloud' && other.type !== 'mist' && other.type !== 'sewer_gas') continue;

            // Apply collision effect (stat damage)
            const collisionEffect = other.getAttribute('collision_effect');
            if (collisionEffect && Object.keys(collisionEffect).length > 0) {
                for (const [key, value] of Object.entries(collisionEffect)) {
                    if (this.stats && this.stats[key] !== undefined) {
                        const stat = this.stats[key];
                        if (typeof stat === 'object' && stat.current !== undefined) {
                            stat.current = Math.max(0, stat.current + value);
                            if (key === 'health' && stat.current <= 0) {
                                this.die();
                            }
                        }
                    }
                }
            }

            // Apply state if specified (paralysis, confusion, etc.)
            const applyStateName = other.getAttribute('apply_state');
            if (applyStateName && this.applyState) {
                const statesData = this.engine.globalStates;
                if (statesData && statesData[applyStateName]) {
                    this.applyState(applyStateName, statesData[applyStateName]);
                }
            }
        }
    }

    // ========================================================================
    // PASSIVE ITEM EFFECTS
    // ========================================================================

    /**
     * Get the total passive stat bonus for a given stat from inventory items
     * @param {string} stat - The stat to get bonuses for (e.g., 'defense', 'accuracy')
     * @returns {number} Total bonus from all inventory items with stat_bonus passive effects
     */
    getPassiveStatBonus(stat) {
        let total = 0;
        for (const item of this.inventory) {
            const passiveEffect = item.getAttribute('passive_effect');
            if (passiveEffect?.type === 'stat_bonus' && typeof passiveEffect[stat] === 'number') {
                total += passiveEffect[stat];
            }
        }
        return total;
    }

    /**
     * Process passive effects from items in inventory after movement
     * @param {Object} fromPos - Previous position {x, y}
     * @param {Object} toPos - New position {x, y}
     */
    processPassiveEffects(fromPos, toPos) {
        for (const item of this.inventory) {
            const passiveEffect = item.getAttribute('passive_effect');
            if (!passiveEffect) continue;

            switch (passiveEffect.type) {
                case 'leave_trail':
                    this.processTrailEffect(item, passiveEffect, fromPos, toPos);
                    break;
                // Future passive effect types can be added here
            }
        }
    }

    /**
     * Process a trail-leaving passive effect
     * @param {Item} item - The item with the passive effect
     * @param {Object} effect - The passive effect configuration
     * @param {Object} fromPos - Previous position {x, y}
     * @param {Object} toPos - New position {x, y}
     */
    processTrailEffect(item, effect, fromPos, toPos) {
        // Initialize trail tracking on the item
        if (!item._trailData) {
            item._trailData = {
                positions: [],
                ownerId: this.id
            };
        }

        const trailData = item._trailData;

        // Show previously hidden trail segment (was hidden to avoid covering actor's spriteTop)
        if (trailData.hiddenSegment) {
            const hiddenEntity = trailData.hiddenSegment.entity;
            if (hiddenEntity?.sprite) hiddenEntity.sprite.alpha = 1;
            if (hiddenEntity?.tileSprite) hiddenEntity.tileSprite.alpha = 1;
            trailData.hiddenSegment = null;
        }

        // Check for backtracking (only owner can remove trail, only the last tile)
        if (effect.backtrack_removes && trailData.ownerId === this.id && trailData.positions.length > 0) {
            const lastSegment = trailData.positions[trailData.positions.length - 1];

            // Only remove if stepping onto the last tile in the trail (rewinding)
            if (lastSegment.x === toPos.x && lastSegment.y === toPos.y) {
                // Remove the last trail segment
                const removed = trailData.positions.pop();
                if (removed.entity) {
                    this.engine.entityManager.removeEntity(removed.entity);
                }
                // Update the now-endpoint tile
                if (trailData.positions.length > 0) {
                    this.updateTrailTile(trailData, trailData.positions.length - 1);
                }
                this._hideTrailAtSpriteTop(trailData, toPos);
                return;
            }
        }

        // Create new trail segment at previous position
        const direction = this.getMovementDirection(fromPos, toPos);
        const prevSegment = trailData.positions[trailData.positions.length - 1];
        const prevDirection = prevSegment ? prevSegment.exitDirection : null;

        // Create the trail entity
        const entity = this.createTrailEntity(item, effect, fromPos, prevDirection, direction);

        if (entity) {
            const newSegment = {
                x: fromPos.x,
                y: fromPos.y,
                entity: entity,
                entryDirection: prevDirection,
                exitDirection: direction
            };
            trailData.positions.push(newSegment);
        }

        this._hideTrailAtSpriteTop(trailData, toPos);
    }

    /**
     * Hide any trail segment that overlaps the actor's spriteTop position.
     * Thread trails render in uiContainer (above entityContainer), so they
     * cover actor top sprites. This hides the segment at (toPos.x, toPos.y - 1).
     */
    _hideTrailAtSpriteTop(trailData, toPos) {
        const topTileX = toPos.x;
        const topTileY = toPos.y - 1;
        for (const seg of trailData.positions) {
            if (seg.x === topTileX && seg.y === topTileY) {
                if (seg.entity?.sprite) seg.entity.sprite.alpha = 0;
                if (seg.entity?.tileSprite) seg.entity.tileSprite.alpha = 0;
                trailData.hiddenSegment = seg;
                return;
            }
        }
    }

    /**
     * Create a trail entity at the specified position
     * @param {Item} item - The source item
     * @param {Object} effect - The passive effect configuration
     * @param {Object} pos - Position to place the entity
     * @param {string|null} entryDir - Direction we entered from
     * @param {string} exitDir - Direction we're exiting to
     * @returns {Entity|null} The created entity
     */
    createTrailEntity(item, effect, pos, entryDir, exitDir) {
        const tileName = this.getTrailTileName(entryDir, exitDir);
        const tileIndex = this.engine.spriteLibrary.resolveTile(tileName);

        //console.log(`[Thread] Creating trail at (${pos.x}, ${pos.y}) - entry: ${entryDir}, exit: ${exitDir} -> tile: ${tileName}`);

        if (!tileIndex) {
            console.warn(`[Thread] Failed to resolve tile: ${tileName}`);
            return null;
        }

        const entity = new Entity(pos.x, pos.y, effect.trail_type || 'thread_trail', this.engine);
        entity.name = 'Thread';
        entity.tileIndex = tileIndex;
        entity.setAttribute('visible', true);
        entity.setAttribute('ignore_darkness', true);

        // Apply item tint
        if (effect.use_item_tint && item.tint) {
            entity.tint = item.tint;
        }

        // Create sprite and add to entity manager
        this.engine.renderer?.createEntitySprite(entity);
        this.engine.entityManager.entities.push(entity);

        return entity;
    }

    /**
     * Get the direction of movement between two positions
     * @param {Object} from - Start position {x, y}
     * @param {Object} to - End position {x, y}
     * @returns {string|null} Direction: 'up', 'down', 'left', 'right', or null
     */
    getMovementDirection(from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        if (dy < 0) return 'up';
        if (dy > 0) return 'down';
        if (dx < 0) return 'left';
        if (dx > 0) return 'right';
        return null;
    }

    /**
     * Get the appropriate box drawing tile name for a trail segment
     * @param {string|null} entryDir - Direction we came FROM to reach this tile
     * @param {string|null} exitDir - Direction we're going TO from this tile
     * @returns {string} The tile name to use
     */
    getTrailTileName(entryDir, exitDir) {
        // If no entry (first segment) or no exit (endpoint), show based on the available direction
        if (!entryDir && !exitDir) {
            return 'INVERSE_BOX_HORIZONTAL';
        }
        if (!entryDir) {
            return (exitDir === 'up' || exitDir === 'down')
                ? 'INVERSE_BOX_VERTICAL'
                : 'INVERSE_BOX_HORIZONTAL';
        }
        if (!exitDir) {
            return (entryDir === 'up' || entryDir === 'down')
                ? 'INVERSE_BOX_VERTICAL'
                : 'INVERSE_BOX_HORIZONTAL';
        }

        // Convert movement directions to connection directions
        // entryDir is the direction we MOVED to get here, so connection is opposite
        // exitDir is the direction we MOVE to leave, so connection is same
        const reverseDir = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
        const connectFrom = reverseDir[entryDir]; // where we came FROM
        const connectTo = exitDir;                 // where we're going TO

        // Sort for consistent lookup
        const connections = [connectFrom, connectTo].sort().join('-');

        // Tile names indicate where the corner is positioned
        // BOTTOM_RIGHT corner = lines extend UP and LEFT
        // TOP_RIGHT corner = lines extend DOWN and LEFT
        // BOTTOM_LEFT corner = lines extend UP and RIGHT
        // TOP_LEFT corner = lines extend DOWN and RIGHT
        const tileMap = {
            // Straight lines
            'down-up': 'INVERSE_BOX_VERTICAL',
            'left-right': 'INVERSE_BOX_HORIZONTAL',
            // Corners - named by corner position, connects the two OTHER directions
            'left-up': 'INVERSE_BOX_BOTTOM_RIGHT',    // corner at bottom-right, lines go up and left
            'right-up': 'INVERSE_BOX_BOTTOM_LEFT',    // corner at bottom-left, lines go up and right
            'down-left': 'INVERSE_BOX_TOP_RIGHT',     // corner at top-right, lines go down and left
            'down-right': 'INVERSE_BOX_TOP_LEFT'      // corner at top-left, lines go down and right
        };

        return tileMap[connections] || 'INVERSE_BOX_HORIZONTAL';
    }

    /**
     * Update a trail segment's tile when connections change
     * @param {Object} trailData - The trail tracking data
     * @param {number} index - Index of the segment to update
     */
    updateTrailTile(trailData, index) {
        if (index < 0 || index >= trailData.positions.length) return;

        const segment = trailData.positions[index];
        if (!segment.entity) return;

        // Recalculate tile - this segment is now an endpoint (no exit)
        const tileName = this.getTrailTileName(segment.entryDirection, null);
        const tileIndex = this.engine.spriteLibrary.resolveTile(tileName);

        console.log(`[Thread] Updating endpoint at (${segment.x}, ${segment.y}) - entry: ${segment.entryDirection}, exit: null -> tile: ${tileName}`);

        if (tileIndex && segment.entity.sprite) {
            segment.entity.tileIndex = tileIndex;
            // Update sprite texture
            const tileset = PIXI.Loader.shared.resources.tiles;
            const rect = new PIXI.Rectangle(
                tileIndex.x * globalVars.TILE_WIDTH,
                tileIndex.y * globalVars.TILE_HEIGHT,
                globalVars.TILE_WIDTH,
                globalVars.TILE_HEIGHT
            );
            segment.entity.sprite.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        }
    }

    updateSpritePosition() {
        const useCenterAnchor = this.facingEnabled;
        const hw = globalVars.TILE_WIDTH / 2;
        const hh = globalVars.TILE_HEIGHT / 2;

        if (this.spriteBase) {
            let bx = this.x * globalVars.TILE_WIDTH;
            let by = this.y * globalVars.TILE_HEIGHT;
            if (useCenterAnchor || this.flipBaseH || this.flipBaseV) {
                bx += hw;
                by += hh;
            }
            this.spriteBase.x = bx;
            this.spriteBase.y = by;
        }
        if (this.spriteTop) {
            let tx = this.x * globalVars.TILE_WIDTH;
            let ty = (this.y - 1) * globalVars.TILE_HEIGHT;
            if (useCenterAnchor || this.flipTopH || this.flipTopV) {
                tx += hw;
                ty += hh;
            }
            this.spriteTop.x = tx;
            this.spriteTop.y = ty;
        }
        if (this.spriteSide) {
            const sideOffset = this.getEffectiveSideOffset();
            let sx = (this.x + sideOffset.dx) * globalVars.TILE_WIDTH;
            let sy = (this.y + sideOffset.dy) * globalVars.TILE_HEIGHT;
            if (useCenterAnchor || this.flipSideH || this.flipSideV) {
                sx += hw;
                sy += hh;
            }
            this.spriteSide.x = sx;
            this.spriteSide.y = sy;
        }
        // Update equipment sprite positions
        // top: above actor's top tile (y - 2)
        if (this.spriteEquipment.top) {
            let ex = this.x * globalVars.TILE_WIDTH;
            let ey = (this.y - 2) * globalVars.TILE_HEIGHT;
            if (useCenterAnchor) { ex += hw; ey += hh; }
            this.spriteEquipment.top.x = ex;
            this.spriteEquipment.top.y = ey;
        }
        // middle: on actor's top tile (y - 1)
        if (this.spriteEquipment.middle) {
            let ex = this.x * globalVars.TILE_WIDTH;
            let ey = (this.y - 1) * globalVars.TILE_HEIGHT;
            if (useCenterAnchor) { ex += hw; ey += hh; }
            this.spriteEquipment.middle.x = ex;
            this.spriteEquipment.middle.y = ey;
        }
        // lower: on actor's base tile (y)
        if (this.spriteEquipment.lower) {
            let ex = this.x * globalVars.TILE_WIDTH;
            let ey = this.y * globalVars.TILE_HEIGHT;
            if (useCenterAnchor) { ex += hw; ey += hh; }
            this.spriteEquipment.lower.x = ex;
            this.spriteEquipment.lower.y = ey;
        }

        // Update viewport visibility when actors move
        if (this.engine.viewportEnabled) {
            const ox = this.engine.sectionOriginX;
            const oy = this.engine.sectionOriginY;
            const vw = this.engine.viewportWidth;
            const vh = this.engine.viewportHeight;
            const inView = this.x >= ox && this.x < ox + vw &&
                           this.y >= oy && this.y < oy + vh;
            if (this.spriteBase) this.spriteBase.visible = inView;
            if (this.spriteTop) {
                const topInView = (this.y - 1) >= oy && (this.y - 1) < oy + vh &&
                                  this.x >= ox && this.x < ox + vw;
                this.spriteTop.visible = (inView || topInView) && !this.isSubmerged;
            }
            if (this.spriteSide) {
                const sideOffset = this.getEffectiveSideOffset();
                const sideX = this.x + sideOffset.dx;
                const sideY = this.y + sideOffset.dy;
                const sideInView = sideX >= ox && sideX < ox + vw &&
                                   sideY >= oy && sideY < oy + vh;
                this.spriteSide.visible = sideInView && !this.isSubmerged;
            }
            for (const slot of ['top', 'middle', 'lower']) {
                if (this.spriteEquipment[slot]) this.spriteEquipment[slot].visible = inView;
            }
        }
    }

    /**
     * Flash the actor's sprites with color inversion for visual feedback
     * @param {number} duration - Duration of flash in milliseconds (default 100)
     */
    flash(duration = 100) {
        this.engine.renderer?.effectRunner.apply('flash', this, { duration_ms: duration });
    }

    isFacingFlipped() {
        return this.facingEnabled && this.facing !== this.defaultFacing;
    }

    getEffectiveSideOffset() {
        if (!this.sideOffset) return { dx: 1, dy: 0 };
        if (this.isFacingFlipped()) {
            return { dx: -this.sideOffset.dx, dy: this.sideOffset.dy };
        }
        return this.sideOffset;
    }

    setFacing(newFacing) {
        if (!this.facingEnabled) return;
        if (newFacing === this.facing) return;
        this.facing = newFacing;
        this.applyFacing();
    }

    applyFacing() {
        if (!this.facingEnabled) return;
        const flipped = this.isFacingFlipped();

        const applyFlip = (sprite, staticFlipH) => {
            if (!sprite) return;
            const effectiveFlipH = staticFlipH !== flipped;
            sprite.anchor.set(0.5, 0.5);
            sprite.scale.x = effectiveFlipH ? -1 : 1;
        };

        applyFlip(this.spriteBase, this.flipBaseH);
        applyFlip(this.spriteTop, this.flipTopH);
        applyFlip(this.spriteSide, this.flipSideH);

        for (const slot of ['top', 'middle', 'lower']) {
            applyFlip(this.spriteEquipment[slot], false);
        }

        this.updateSpritePosition();
    }

    /**
     * Check if there's a deep actor at the given position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Actor|null} The deep actor at position, or null
     */
    getDeepActorAt(x, y) {
        return this.engine.entityManager.getActorsAt(x, y)
            .find(a => a !== this && !a.hasAttribute('solid') && a.hasAttribute('deep')) || null;
    }

    /**
     * Submerge this actor (when entering a deep tile)
     * Base sprite shows the top tile texture, top sprite becomes invisible
     * @param {Actor} deepActor - The deep actor we're submerging in
     */
    submerge(deepActor) {
        if (this.isSubmerged) return;

        this.isSubmerged = true;
        this.submergedIn = deepActor;

        // Store original textures for restoration
        if (this.spriteBase) {
            this._originalBaseTexture = this.spriteBase.texture;
        }
        if (this.spriteTop) {
            this._originalTopTexture = this.spriteTop.texture;
            this._originalTopVisible = this.spriteTop.visible;
        }

        // Move top texture to base position (head now at floor level)
        if (this.spriteTop && this.spriteBase) {
            this.spriteBase.texture = this.spriteTop.texture;
        }

        // Hide top sprite
        if (this.spriteTop) {
            this.spriteTop.visible = false;
        }

        // Hide side sprite (underwater)
        if (this.spriteSide) {
            this._originalSideVisible = this.spriteSide.visible;
            this.spriteSide.visible = false;
        }

        // Hide equipment sprites (they're underwater)
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.spriteEquipment[slot]) {
                this[`_originalEquipment${slot}Visible`] = this.spriteEquipment[slot].visible;
                this.spriteEquipment[slot].visible = false;
            }
        }

        // Extinguish carried light sources (torches go out in deep liquids)
        if (this.inventory) {
            const toExtinguish = this.inventory.filter(
                item => item.hasAttribute('light_source') && item.stats?.burns?.current > 0
            );
            for (const item of toExtinguish) {
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(`Your ${item.name} is extinguished.`);
                }
                const unlitType = 'torch_unlit';
                const itemData = this.engine.currentPrototype?.getItemData(unlitType);
                if (itemData) {
                    const remainingFuel = item.stats?.burns?.current ?? 0;
                    const maxFuel = item.stats?.burns?.max ?? 500;
                    const newItem = new Item(-1, -1, unlitType, itemData, this.engine);
                    newItem.owner = this;
                    newItem.stats = newItem.stats || {};
                    newItem.stats.burns = {
                        current: remainingFuel,
                        max: maxFuel,
                        per_turn: 0,
                        display_label: 'Fuel',
                        warnings: [{ threshold: 0.1, message: 'Your torch is almost out!' }]
                    };
                    const idx = this.inventory.indexOf(item);
                    if (idx !== -1) this.inventory[idx] = newItem;
                } else {
                    this.inventory = this.inventory.filter(i => i !== item);
                }
            }
            if (toExtinguish.length > 0) {
                this.engine.updateLighting();
            }
        }

        // If this is the player, apply canvas tinting and show message
        if (this.isPlayerControlled() && deepActor) {
            this.engine.renderer?.applySubmersionTint(deepActor.tint);
            this.engine.inputManager?.showMessage(`You are submerged in ${deepActor.getNameWithArticle()}!`);
        }

        console.log(`${this.name} submerges in ${deepActor?.name || 'deep liquid'}`);
    }

    /**
     * Emerge from submersion (when exiting a deep tile)
     */
    emerge() {
        if (!this.isSubmerged) return;

        // Restore original base texture
        if (this.spriteBase && this._originalBaseTexture) {
            this.spriteBase.texture = this._originalBaseTexture;
        }

        // Restore and show top sprite
        if (this.spriteTop) {
            if (this._originalTopTexture) {
                this.spriteTop.texture = this._originalTopTexture;
            }
            this.spriteTop.visible = this._originalTopVisible !== false;
        }

        // Restore side sprite visibility
        if (this.spriteSide && this._originalSideVisible !== undefined) {
            this.spriteSide.visible = this._originalSideVisible;
        }

        // Restore equipment sprite visibility
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.spriteEquipment[slot] && this[`_originalEquipment${slot}Visible`] !== undefined) {
                this.spriteEquipment[slot].visible = this[`_originalEquipment${slot}Visible`];
            }
        }

        // If this is the player, remove canvas tinting
        if (this.isPlayerControlled()) {
            this.engine.renderer?.removeSubmersionTint();
        }

        console.log(`${this.name} emerges from ${this.submergedIn?.name || 'deep liquid'}`);

        this.isSubmerged = false;
        this.submergedIn = null;
        this._originalBaseTexture = null;
        this._originalTopTexture = null;
        this._originalTopVisible = null;
        this._originalSideVisible = null;
    }

    /**
     * Check and update submersion state based on current position
     */
    updateSubmersionState() {
        const deepActor = this.getDeepActorAt(this.x, this.y);

        if (deepActor && !this.isSubmerged) {
            this.submerge(deepActor);
        } else if (!deepActor && this.isSubmerged) {
            this.emerge();
        }
    }

    /**
     * Check if this actor can see the target (distance + line-of-sight check)
     * @param {Entity} target - The target to check visibility for
     * @returns {boolean} True if target is within vision range and has clear line of sight
     */
    getEffectiveVisionRange() {
        let range = this.visionRange + this.getPassiveStatBonus('visionRange');
        for (const slot of ['ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.visionRange === 'number') {
                    range += wearEffect.visionRange;
                }
            }
        }
        return range;
    }

    canSeeTarget(target) {
        if (!target) return false;

        if (target.hasStateProperty?.('invisible')) return false;

        const distance = getEuclideanDistance(this.x, this.y, target.x, target.y);
        let effectiveRange = this.getEffectiveVisionRange();

        const lm = this.engine.lightingManager;
        if (lm && !this.isPlayerControlled() && !this.hasAttribute('dark_vision')) {
            const targetLight = lm.getLightLevel(target.x, target.y)?.intensity ?? 1;
            if (targetLight < 0.1) {
                effectiveRange = Math.min(effectiveRange, 1.5);
            } else if (targetLight < 1.0) {
                effectiveRange = Math.max(1.5, effectiveRange * targetLight);
            }
        }

        if (distance > effectiveRange) return false;

        const isBlocked = (x, y) => {
            if (!this.hasFloorAt(x, y) && !this.hasPlatformAt(x, y)) return true;
            const actorAt = this.engine.entityManager.getSolidActorAt(x, y);
            if (actorAt && actorAt !== this && actorAt !== target) {
                return true;
            }
            return false;
        };

        return hasLineOfSight(this.x, this.y, target.x, target.y, isBlocked);
    }

    /**
     * Check if a tile is passable for pathfinding purposes
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {boolean} True if the tile can be walked through
     */
    isPassableAt(x, y) {
        // Check bounds
        if (x < 0 || x >= this.engine.mapManager.width ||
            y < 0 || y >= this.engine.mapManager.height) {
            return false;
        }

        // Check for floor or platform
        if (!this.hasFloorAt(x, y) && !this.hasPlatformAt(x, y)) return false;

        // Check for solid actors (but allow the actor's own position)
        const actorAt = this.engine.entityManager.getSolidActorAt(x, y);
        if (actorAt && actorAt !== this) {
            return false;
        }

        return true;
    }

    /**
     * Move toward a target position using A* pathfinding
     * Falls back to simple directional movement if no path found
     * @param {number} targetX - Target X coordinate
     * @param {number} targetY - Target Y coordinate
     * @returns {boolean} True if movement was attempted
     */
    moveToward(targetX, targetY) {
        if (this.x === targetX && this.y === targetY) return false;

        const hasFloor = (x, y) => this.hasFloorAt(x, y) || this.hasPlatformAt(x, y);

        const isPassable = (x, y) => {
            if (x === targetX && y === targetY) return true;
            return this.isPassableAt(x, y);
        };

        const nextStep = getNextPathStep(this.x, this.y, targetX, targetY, isPassable, { hasFloor });

        if (nextStep) {
            const result = this.tryMove(nextStep.x, nextStep.y);
            if (result.moved || result.actionTaken) return true;
        }

        // No path or path step failed — fall back to simple directional movement
        const dx = Math.sign(targetX - this.x);
        const dy = Math.sign(targetY - this.y);

        if (Math.abs(targetX - this.x) > Math.abs(targetY - this.y)) {
            if (dx !== 0 && hasFloor(this.x + dx, this.y)) {
                const result = this.tryMove(this.x + dx, this.y);
                if (result.moved || result.actionTaken) return true;
            }
            if (dy !== 0 && hasFloor(this.x, this.y + dy)) {
                const result = this.tryMove(this.x, this.y + dy);
                if (result.moved || result.actionTaken) return true;
            }
        } else {
            if (dy !== 0 && hasFloor(this.x, this.y + dy)) {
                const result = this.tryMove(this.x, this.y + dy);
                if (result.moved || result.actionTaken) return true;
            }
            if (dx !== 0 && hasFloor(this.x + dx, this.y)) {
                const result = this.tryMove(this.x + dx, this.y);
                if (result.moved || result.actionTaken) return true;
            }
        }

        // Diagonal only if corner tiles are clear
        if (dx !== 0 && dy !== 0 && hasFloor(this.x + dx, this.y + dy) &&
            !isDiagonalBlocked(this.x, this.y, this.x + dx, this.y + dy, hasFloor)) {
            const result = this.tryMove(this.x + dx, this.y + dy);
            if (result.moved || result.actionTaken) return true;
        }

        return false;
    }

    serialize() {
        return {
            ...super.serialize(),
            stats: JSON.parse(JSON.stringify(this.stats)),
            inventory: this.inventory.map(item => item.serialize()),
            personality: this.personality?.name,
            isDead: this.isDead,
            facing: this.facing,
            equipment: {
                weapon: this.equipment.weapon?.type || null,
                top: this.equipment.top?.type || null,
                middle: this.equipment.middle?.type || null,
                lower: this.equipment.lower?.type || null,
                ring1: this.equipment.ring1?.type || null,
                ring2: this.equipment.ring2?.type || null
            },
            states: JSON.parse(JSON.stringify(
                Object.fromEntries(
                    Object.entries(this.states || {}).map(([k, v]) => [k, { duration: v.duration, data: v.data }])
                )
            )),
            isActor: true
        };
    }

    deserialize(data) {
        super.deserialize(data);
        if (data.stats) this.stats = JSON.parse(JSON.stringify(data.stats));
        if (data.isDead !== undefined) this.isDead = data.isDead;
        if (data.facing !== undefined) this.facing = data.facing;
        if (data.states) this.states = JSON.parse(JSON.stringify(data.states));
        // Reconstruct inventory items
        if (data.inventory) {
            this.inventory = data.inventory.map(itemData => {
                const itemDef = this.engine.currentPrototype.getItemData(itemData.type);
                if (!itemDef) return null;
                const item = new Item(itemData.x, itemData.y, itemData.type, itemDef, this.engine);
                item.deserialize(itemData);
                item.owner = this;
                return item;
            }).filter(Boolean);
            // Re-link equipment slots
            if (data.equipment) {
                const linked = new Set();
                for (const [slot, itemType] of Object.entries(data.equipment)) {
                    if (itemType) {
                        const item = this.inventory.find(i => i.type === itemType && !linked.has(i));
                        if (item) {
                            this.equipment[slot] = item;
                            linked.add(item);
                        }
                    }
                }
            }
        }
        if (data.personality) {
            this.loadPersonality(data.personality);
        }
    }
}


// ============================================================================
// ENTITY MANAGER
// ============================================================================

class EntityManager {
    constructor(engine) {
        this.engine = engine;
        this.entities = [];
        this.actors = [];
        this.items = [];
        this.player = null;
        this._liquidPosCache = null;
        this._solidPosCache = null;
        this._actorPosCache = null;
    }

    async spawnEntities(entryDirection = null) {
        // Track which actor/item types are placed in the map
        const placedActorTypes = new Set();
        const placedItemTypes = new Set();

        // Process object layers from Tiled map if available
        if (this.engine.mapManager.objectLayers) {
            for (const layer of this.engine.mapManager.objectLayers) {
                if (layer.name === 'actors') {
                    this.spawnActorsFromLayer(layer, entryDirection, placedActorTypes);
                } else if (layer.name === 'items') {
                    this.spawnItemsFromLayer(layer, placedItemTypes);
                } else if (layer.name === 'landmarks') {
                    this.spawnLandmarksFromLayer(layer);
                }
            }
        }

        // Spawn unplaced actors/items from prototype's actors.json and items.json
        this.spawnUnplacedEntities(placedActorTypes, placedItemTypes);

        console.log(`Entities spawned: ${this.actors.length} actors, ${this.items.length} items`);

    }

    initializeSwitchTints() {
        const colors = this.engine.globalColors;
        if (!colors || colors.length === 0) return;

        const tinted = new Set();

        for (const actor of this.actors) {
            if ((!actor.hasAttribute('switchable') && !actor.hasAttribute('clock')) || actor.isDead || tinted.has(actor)) continue;

            const effects = actor.data?.switch_effects;
            if (!effects) continue;

            const machineId = actor.getAttribute('machine_id');
            let targets;

            if (machineId) {
                targets = this.actors.filter(
                    a => a !== actor && !a.isDead && a.getAttribute('machine_id') === machineId
                );
            } else {
                const radius = actor.data?.switch_radius || 10;
                targets = this.actors.filter(a => {
                    if (a === actor || a.isDead) return false;
                    if (!a.hasAttribute('gate') && !a.hasAttribute('pedestal') && !a.hasAttribute('switchable')) return false;
                    const dist = Math.abs(a.x - actor.x) + Math.abs(a.y - actor.y);
                    return dist <= radius;
                });
            }

            if (targets.length === 0) continue;

            const color = randomElement(colors);
            const tint = parseTint(color.hex);

            actor.tint = tint;
            tinted.add(actor);
            for (const target of targets) {
                target.tint = tint;
                tinted.add(target);
            }
        }
    }

    initializeInventoryDisplays() {
        for (const actor of this.actors) {
            if (!actor.hasAttribute('display_inventory') || actor.isDead) continue;
            if (actor.inventory.length === 0) continue;
            actor.updateInventoryDisplay();
        }
    }

    /**
     * Run cellular automata behaviors once to pre-calculate initial state
     * This allows things like sewage pooling to be calculated at load time
     * @param {number} [steps=1] - Number of simulation steps to run
     */
    runCellularAutomataStep(steps = 1) {
        for (let step = 0; step < steps; step++) {
            // Get all actors with cellular_transform behavior
            // We need to collect transformations first, then apply them to avoid order-dependent issues
            const transformations = [];

            for (const actor of this.actors) {
                if (actor.isDead) continue;
                if (!actor.personality) continue;

                // Check if this actor has cellular_transform behavior
                const hasCellularBehavior = actor.personality.behaviors?.includes('cellular_transform');
                if (!hasCellularBehavior) continue;

                const data = actor.personality.data || {};
                const neighborType = data.neighbor_type || actor.type;
                const requiredCount = data.neighbor_count ?? 4;
                const transformTo = data.transform_to || ('deep_' + actor.type);
                const checkCardinal = data.check_cardinal !== false;

                if (actor.type === transformTo) continue;

                const directions = checkCardinal ? CARDINAL_DIRS : ALL_DIRS;

                let matchingNeighbors = 0;

                for (const dir of directions) {
                    const checkX = actor.x + dir.dx;
                    const checkY = actor.y + dir.dy;

                    const neighborsHere = this.getActorsAt(checkX, checkY);
                    for (const a of neighborsHere) {
                        if (a.type === neighborType || a.type === transformTo) {
                            matchingNeighbors++;
                            break;
                        }
                    }
                }

                if (matchingNeighbors >= requiredCount) {
                    transformations.push({
                        actor,
                        x: actor.x,
                        y: actor.y,
                        transformTo
                    });
                }
            }

            // Apply all transformations
            for (const t of transformations) {
                // Remove the old actor (without triggering death effects)
                this.removeEntity(t.actor);

                // Spawn the new actor
                this.spawnActor(t.transformTo, t.x, t.y);
            }

            if (transformations.length > 0) {
                console.log(`Cellular automata step ${step + 1}: ${transformations.length} transformations`);
            }
        }
    }

    /**
     * Spawn actors and items that are defined in the prototype folder but not placed in the map
     * Only considers prototype-specific actors/items, not global defaults from data/
     * @param {Set} placedActorTypes - Actor types already placed from the map
     * @param {Set} placedItemTypes - Item types already placed from the map
     */
    spawnUnplacedEntities(placedActorTypes, _placedItemTypes) {
        const prototype = this.engine.currentPrototype;
        if (!prototype) return;

        const walkableTiles = this.engine.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) {
            console.warn('No walkable tiles available for spawning unplaced entities');
            return;
        }

        // Get list of tiles not occupied by actors
        const getAvailableTiles = () => {
            const occupied = new Set();
            for (const actor of this.actors) {
                occupied.add(`${actor.x},${actor.y}`);
            }
            return walkableTiles.filter(t => !occupied.has(`${t.x},${t.y}`));
        };

        // Types to skip - these are structural or special and shouldn't be randomly spawned
        const skipActorTypes = new Set(['player', 'wall', 'door', 'stairway_up', 'stairway_down']);

        // Also skip actor types that are configured in random_actors (they'll be spawned separately)
        // For multi-level prototypes, check the current floor's random_actors
        const floorConfig = prototype.config?.levels
            ? this.engine.getFloorConfig(this.engine.currentFloor)
            : prototype.config;
        const randomActorTypes = new Set(Object.keys(floorConfig?.random_actors || {}));

        // Skip chain segment types - they're spawned by spawnChainCreatures via their head
        for (const actorType of prototype.prototypeActorTypes || []) {
            const actorData = prototype.getActorData(actorType);
            if (actorData?.attributes?.chain_segment_type) {
                // The head's segment type should be skipped
                skipActorTypes.add(actorData.attributes.chain_segment_type);
            }
        }

        // In multi-level prototypes, per-floor random_actors fully controls spawning —
        // don't auto-spawn unplaced prototype actors on every floor
        if (prototype.config?.levels) return;

        // Spawn unplaced actors (only prototype-specific ones, single-level prototypes only)
        for (const actorType of prototype.prototypeActorTypes || []) {
            if (placedActorTypes.has(actorType)) continue;
            if (skipActorTypes.has(actorType)) continue;
            if (randomActorTypes.has(actorType)) continue;

            const actorData = prototype.getActorData(actorType);
            if (!actorData) continue;

            // Spawn 1-3 of each unplaced actor type
            const count = Math.floor(ROT.RNG.getUniform() * 3) + 1;
            const availableTiles = getAvailableTiles();

            for (let i = 0; i < count && availableTiles.length > 0; i++) {
                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles.splice(tileIndex, 1)[0];

                const actor = new Actor(tile.x, tile.y, actorType, actorData, this.engine);
                this.addEntity(actor);
                actor.loadDefaultItems();

                console.log(`Randomly spawned ${actorType} at (${tile.x}, ${tile.y})`);
            }
        }

    }

    /**
     * Spawn random actors based on prototype's random_actors config
     * Called after wildcard processing so walkable tiles exist
     * Format: { "actor_type": { "chance": 0-100, "min": 1, "max": 3 }, ... }
     * If chance is 100, exactly one instance will spawn (guaranteed)
     */
    spawnRandomActorsFromConfig(floorConfig = null) {
        const walkableTiles = this.engine.mapManager.walkableTiles;
        if (!walkableTiles || walkableTiles.length === 0) {
            console.warn('random_actors/items: No walkable tiles available');
            return;
        }

        // Helper to get tiles not occupied by actors
        const getAvailableTiles = () => {
            const occupied = new Set();
            for (const actor of this.actors) {
                occupied.add(`${actor.x},${actor.y}`);
            }
            return walkableTiles.filter(t => !occupied.has(`${t.x},${t.y}`));
        };

        this.spawnRandomActors(getAvailableTiles, floorConfig);
        this.spawnRandomTraps(getAvailableTiles, floorConfig);
        this.spawnRandomItems(getAvailableTiles, floorConfig);
        this.spawnBudgetItems(getAvailableTiles, floorConfig);
    }

    spawnRandomTraps(getAvailableTiles, floorConfig) {
        const trapsConfig = floorConfig?.traps;
        if (!trapsConfig) return;

        const prototype = this.engine.currentPrototype;
        const trapTypes = Object.entries(prototype.actors)
            .filter(([, data]) => data.attributes?.trap)
            .map(([type]) => type);

        if (trapTypes.length === 0) {
            console.warn('traps: No actor types with trap attribute found');
            return;
        }

        const min = trapsConfig.min ?? 1;
        const max = trapsConfig.max ?? min;
        const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));

        for (let i = 0; i < count; i++) {
            const availableTiles = getAvailableTiles();
            if (availableTiles.length === 0) {
                console.warn('traps: No tiles available');
                break;
            }

            const trapType = trapTypes[Math.floor(ROT.RNG.getUniform() * trapTypes.length)];
            const trapData = prototype.getActorData(trapType);
            const tile = availableTiles[Math.floor(ROT.RNG.getUniform() * availableTiles.length)];

            const actor = new Actor(tile.x, tile.y, trapType, trapData, this.engine);
            this.addEntity(actor);
            console.log(`traps: Spawned "${trapType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
        }
    }

    /**
     * Spawn random actors based on prototype's random_actors config
     * @param {Function} getAvailableTiles - Function that returns available spawn tiles
     */
    spawnRandomActors(getAvailableTiles, floorConfig = null) {
        const prototype = this.engine.currentPrototype;
        const randomActors = floorConfig?.random_actors ?? prototype?.config?.random_actors;
        if (!randomActors) return;

        for (const [actorType, spawnConfig] of Object.entries(randomActors)) {
            const chance = spawnConfig.chance ?? 100;
            const min = spawnConfig.min ?? 1;
            const max = spawnConfig.max ?? 1;

            const actorData = prototype.getActorData(actorType);
            if (!actorData) {
                console.warn(`random_actors: No actor data found for "${actorType}"`);
                continue;
            }

            // If chance is 100%, spawn exactly one (guaranteed spawn)
            if (chance >= 100) {
                const availableTiles = getAvailableTiles();
                if (availableTiles.length === 0) {
                    console.warn(`random_actors: No tiles available for guaranteed spawn of "${actorType}"`);
                    continue;
                }

                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles[tileIndex];

                const actor = new Actor(tile.x, tile.y, actorType, actorData, this.engine);
                this.addEntity(actor);
                actor.loadDefaultItems();
                console.log(`random_actors: Spawned guaranteed "${actorType}" at (${tile.x}, ${tile.y})`);
                continue;
            }

            // For non-guaranteed spawns, roll for count between min and max
            const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));

            // Pack actors spawn clustered together near a single anchor point
            const isPack = actorData.attributes?.pack === true;

            if (isPack) {
                // Roll chance once for the whole pack
                if (ROT.RNG.getPercentage() > chance) {
                    continue;
                }

                const availableTiles = getAvailableTiles();
                if (availableTiles.length === 0) {
                    console.warn(`random_actors: No tiles available for "${actorType}"`);
                    continue;
                }

                // Pick an anchor tile for the pack
                const anchorIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const anchorTile = availableTiles[anchorIndex];

                const anchor = new Actor(anchorTile.x, anchorTile.y, actorType, actorData, this.engine);
                this.addEntity(anchor);
                anchor.loadDefaultItems();
                console.log(`random_actors: Spawned pack anchor "${actorType}" at (${anchorTile.x}, ${anchorTile.y}) (1/${count})`);

                // Spawn remaining pack members nearby (Manhattan distance <= 2)
                for (let i = 1; i < count; i++) {
                    const refreshedTiles = getAvailableTiles();
                    const nearbyTiles = refreshedTiles.filter(t =>
                        Math.abs(t.x - anchorTile.x) + Math.abs(t.y - anchorTile.y) <= 2
                    );

                    let tile;
                    if (nearbyTiles.length > 0) {
                        tile = nearbyTiles[Math.floor(ROT.RNG.getUniform() * nearbyTiles.length)];
                    } else if (refreshedTiles.length > 0) {
                        // Fall back to random map-wide tile
                        tile = refreshedTiles[Math.floor(ROT.RNG.getUniform() * refreshedTiles.length)];
                    } else {
                        console.warn(`random_actors: No tiles available for pack "${actorType}"`);
                        break;
                    }

                    const packMember = new Actor(tile.x, tile.y, actorType, actorData, this.engine);
                    this.addEntity(packMember);
                    packMember.loadDefaultItems();
                    console.log(`random_actors: Spawned pack "${actorType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
                }
                continue;
            }

            for (let i = 0; i < count; i++) {
                // Roll chance for each individual spawn
                if (ROT.RNG.getPercentage() > chance) {
                    continue;
                }

                const availableTiles = getAvailableTiles();
                if (availableTiles.length === 0) {
                    console.warn(`random_actors: No tiles available for "${actorType}"`);
                    break;
                }

                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles[tileIndex];

                const actor = new Actor(tile.x, tile.y, actorType, actorData, this.engine);
                this.addEntity(actor);
                actor.loadDefaultItems();
                //console.log(`random_actors: Spawned "${actorType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
            }
        }
    }

    /**
     * Spawn random items based on prototype's random_items config
     * @param {Function} getAvailableTiles - Function that returns available spawn tiles
     */
    spawnRandomItems(getAvailableTiles, floorConfig = null) {
        const prototype = this.engine.currentPrototype;
        const randomItems = floorConfig?.random_items ?? prototype?.config?.random_items;
        if (!randomItems) return;

        for (const [itemType, spawnConfig] of Object.entries(randomItems)) {
            const chance = spawnConfig.chance ?? 100;
            const min = spawnConfig.min ?? 1;
            const max = spawnConfig.max ?? 1;

            let resolvedType = itemType;
            let itemData = prototype.getItemData(itemType);
            if (!itemData) {
                console.warn(`random_items: No item data found for "${itemType}"`);
                continue;
            }

            // If chance is 100%, spawn exactly one (guaranteed spawn)
            if (chance >= 100) {
                const availableTiles = getAvailableTiles();
                if (availableTiles.length === 0) {
                    console.warn(`random_items: No tiles available for guaranteed spawn of "${resolvedType}"`);
                    continue;
                }

                // Resolve random_type pool: use catalog if available, else full pool
                if (itemData.random_type && Array.isArray(itemData.random_type)) {
                    resolvedType = prototype.getCatalogTypeForCategory(itemType)
                        || randomElement(itemData.random_type);
                    itemData = prototype.getItemData(resolvedType);
                    if (!itemData) {
                        console.warn(`random_items: random_type "${resolvedType}" not found`);
                        continue;
                    }
                }

                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles[tileIndex];

                const item = new Item(tile.x, tile.y, resolvedType, itemData, this.engine);
                this.addEntity(item);
                console.log(`random_items: Spawned guaranteed "${resolvedType}" at (${tile.x}, ${tile.y})`);
                continue;
            }

            // For non-guaranteed spawns, roll for count between min and max
            const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));

            for (let i = 0; i < count; i++) {
                // Roll chance for each individual spawn
                if (ROT.RNG.getPercentage() > chance) {
                    continue;
                }

                const availableTiles = getAvailableTiles();
                if (availableTiles.length === 0) {
                    console.warn(`random_items: No tiles available for "${itemType}"`);
                    break;
                }

                // Resolve random_type pool: use catalog if available, else full pool
                let spawnType = itemType;
                let spawnData = itemData;
                if (itemData.random_type && Array.isArray(itemData.random_type)) {
                    spawnType = prototype.getCatalogTypeForCategory(itemType)
                        || randomElement(itemData.random_type);
                    spawnData = prototype.getItemData(spawnType);
                    if (!spawnData) {
                        console.warn(`random_items: random_type "${spawnType}" not found`);
                        continue;
                    }
                }

                const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
                const tile = availableTiles[tileIndex];

                const item = new Item(tile.x, tile.y, spawnType, spawnData, this.engine);
                this.addEntity(item);
                console.log(`random_items: Spawned "${spawnType}" at (${tile.x}, ${tile.y}) (${i + 1}/${count})`);
            }
        }
    }

    spawnBudgetItems(getAvailableTiles, floorConfig) {
        const prototype = this.engine.currentPrototype;
        const budget = floorConfig?.item_budget ?? prototype?.config?.item_budget;
        if (!budget || prototype.activeCatalog.size === 0) return;

        const base = budget.base ?? 3;
        const extraChance = budget.extra_chance ?? 50;
        const maxExtra = budget.max_extra ?? 3;

        let totalItems = base;
        for (let i = 0; i < maxExtra; i++) {
            if (ROT.RNG.getPercentage() <= extraChance) totalItems++;
        }

        // Build weighted category list from catalog config
        const catalogConfig = prototype.config.item_catalog;
        if (!catalogConfig) return;

        const categories = [];
        let totalWeight = 0;
        for (const [category, catConfig] of Object.entries(catalogConfig)) {
            if (!prototype.activeCatalog.has(category)) continue;
            const weight = catConfig.weight ?? 10;
            categories.push({ category, weight });
            totalWeight += weight;
        }

        if (categories.length === 0 || totalWeight === 0) return;

        for (let i = 0; i < totalItems; i++) {
            const availableTiles = getAvailableTiles();
            if (availableTiles.length === 0) break;

            // Weighted random category selection
            let roll = ROT.RNG.getUniform() * totalWeight;
            let selectedCategory = categories[0].category;
            for (const { category, weight } of categories) {
                roll -= weight;
                if (roll <= 0) {
                    selectedCategory = category;
                    break;
                }
            }

            const itemType = prototype.getCatalogTypeForCategory(selectedCategory);
            if (!itemType) continue;

            const itemData = prototype.getItemData(itemType);
            if (!itemData) continue;

            const tileIndex = Math.floor(ROT.RNG.getUniform() * availableTiles.length);
            const tile = availableTiles[tileIndex];

            const item = new Item(tile.x, tile.y, itemType, itemData, this.engine);
            this.addEntity(item);
            console.log(`item_budget: Spawned "${itemType}" (${selectedCategory}) at (${tile.x}, ${tile.y})`);
        }
    }

    /**
     * Spawn the contents of a designated treasure room:
     *  - A color-locked door at the entrance (must come before the key so color pairing works)
     *  - A matching key placed randomly outside the room
     *  - A random weapon or staff inside the room
     */
    spawnTreasureRoomContents({ roomTiles, doorPos }, architectContext) {
        const prototype = this.engine.currentPrototype;

        // 1. Spawn a locked_door at the entrance — triggers assignLockColor() → color enters unpairedLockColors
        const lockedDoorData = prototype.getActorData('locked_door');
        if (lockedDoorData) {
            architectContext.createActor(doorPos.x, doorPos.y, 'locked_door', lockedDoorData);
            console.log(`Treasure room: locked_door at (${doorPos.x}, ${doorPos.y})`);
        } else {
            console.warn('Treasure room: locked_door actor data not found');
        }

        // 2. Spawn a matching key outside the room — triggers getKeyColor() → pops the matching color
        const roomTileSet = new Set(roomTiles.map(t => `${t.x},${t.y}`));
        const occupied = new Set([...this.actors, ...this.items].map(e => `${e.x},${e.y}`));
        const keyTiles = this.engine.mapManager.walkableTiles.filter(
            t => !roomTileSet.has(`${t.x},${t.y}`) && !occupied.has(`${t.x},${t.y}`)
        );

        const keyData = prototype.getItemData('key');
        if (keyData && keyTiles.length > 0) {
            const keyPos = keyTiles[Math.floor(ROT.RNG.getUniform() * keyTiles.length)];
            const key = new Item(keyPos.x, keyPos.y, 'key', keyData, this.engine);
            this.addEntity(key);
            console.log(`Treasure room: key at (${keyPos.x}, ${keyPos.y})`);
        } else {
            console.warn('Treasure room: could not place key (no key data or no valid tiles)');
        }

        // 3. Spawn a random weapon or staff inside the room
        const lootCandidates = Object.entries(prototype.items).filter(([_type, data]) => {
            const attrs = data.attributes || {};
            return attrs.weapon || attrs.treasure_loot;
        });

        if (lootCandidates.length > 0 && roomTiles.length > 0) {
            const [lootType, lootData] = lootCandidates[Math.floor(ROT.RNG.getUniform() * lootCandidates.length)];
            const lootPos = roomTiles[Math.floor(ROT.RNG.getUniform() * roomTiles.length)];
            const loot = new Item(lootPos.x, lootPos.y, lootType, lootData, this.engine);
            this.addEntity(loot);
            console.log(`Treasure room: ${lootType} at (${lootPos.x}, ${lootPos.y})`);
        } else {
            console.warn('Treasure room: no weapon/staff candidates found for loot');
        }
    }

    /**
     * Find all chain_head actors and spawn their body segment chains.
     * Called once after all actors (Tiled, unplaced, random) have been created.
     */
    spawnChainCreatures() {
        for (const actor of [...this.actors]) {
            if (actor.isDead) continue;
            if (!actor.hasAttribute('chain_head')) continue;
            if (actor._chainHead) continue;
            spawnChainSegments(actor, this);
        }
    }

    spawnActorsFromLayer(layer, entryDirection = null, placedActorTypes = null) {
        console.log(`Processing actors layer with ${layer.objects.length} objects`);

        for (const obj of layer.objects) {
            // Get actor type from Tiled's class property (newer) or type property (older), then name as fallback
            let actorType = obj.class || obj.type || obj.name;

            if (!actorType) {
                console.warn('Object has no class, type, or name, skipping:', obj);
                continue;
            }

            // Track that this actor type was placed in the map
            if (placedActorTypes) {
                placedActorTypes.add(actorType);
            }

            // Skip player actors when entering via stairway (player will be spawned at stairway)
            if (entryDirection && actorType === 'player') {
                console.log('Skipping player spawn from map (will spawn at stairway)');
                continue;
            }

            // Convert pixel position to tile position
            const tileX = Math.floor(obj.x / this.engine.config.tileWidth);
            const tileY = Math.floor(obj.y / this.engine.config.tileHeight);

            // Get actor data from prototype
            const actorData = this.engine.currentPrototype.getActorData(actorType);
            if (!actorData) {
                console.warn(`No actor data found for type '${actorType}'`);
                continue;
            }

            // Create and add actor
            const actor = new Actor(tileX, tileY, actorType, actorData, this.engine);
            this.addEntity(actor);

            // Load any default items for this actor
            actor.loadDefaultItems();

            // Parse custom Tiled properties (machine connections, switch overrides)
            if (obj.properties) {
                for (const prop of obj.properties) {
                    if (prop.name === 'machine_id') {
                        actor.setAttribute('machine_id', prop.value);
                    } else if (prop.name === 'one_shot') {
                        actor.setAttribute('one_shot', prop.value);
                    } else if (prop.name === 'switch_effects') {
                        try {
                            actor.data = { ...actor.data, switch_effects: JSON.parse(prop.value) };
                        } catch (e) {
                            console.warn(`Invalid switch_effects JSON for ${actorType}:`, prop.value);
                        }
                    } else if (prop.name === 'switch_radius') {
                        actor.data = { ...actor.data, switch_radius: Number(prop.value) };
                    }
                }
            }

            console.log(`Spawned ${actorType} at tile (${tileX}, ${tileY}) from pixel (${obj.x}, ${obj.y})`);
        }
    }
    
    spawnItemsFromLayer(layer, placedItemTypes = null) {
        console.log(`Processing items layer with ${layer.objects.length} objects`);

        for (const obj of layer.objects) {
            // Get item type from Tiled's class property (newer) or type property (older), then name as fallback
            const itemType = obj.class || obj.type || obj.name;
            if (!itemType) continue;

            // Track that this item type was placed in the map
            if (placedItemTypes) {
                placedItemTypes.add(itemType);
            }

            const tileX = Math.floor(obj.x / this.engine.config.tileWidth);
            const tileY = Math.floor(obj.y / this.engine.config.tileHeight);

            const itemData = this.engine.currentPrototype.getItemData(itemType);
            if (!itemData) {
                console.warn(`No item data found for type '${itemType}'`);
                continue;
            }

            const item = new Item(tileX, tileY, itemType, itemData, this.engine);
            this.addEntity(item);

            console.log(`Spawned ${itemType} at tile (${tileX}, ${tileY})`);
        }
    }

    /**
     * Spawn landmark entities from a Tiled object layer
     * Landmarks are ad-hoc entities defined entirely in the map file,
     * not requiring pre-defined data in entities.json
     * @param {Object} layer - Tiled object layer
     */
    spawnLandmarksFromLayer(layer) {
        for (const obj of layer.objects) {
            // Get tile name from class/type (e.g., "IMPERFECT_DOTTED_LIGHT_SHADE")
            const tileName = obj.class || obj.type;
            if (!tileName) {
                console.warn('Landmark object has no class/type (tile name), skipping:', obj);
                continue;
            }

            // Convert pixel coordinates to tile coordinates
            const tileX = Math.floor(obj.x / this.engine.config.tileWidth);
            const tileY = Math.floor(obj.y / this.engine.config.tileHeight);

            // Create entity directly without requiring entities.json lookup
            const entity = new Entity(tileX, tileY, 'landmark', this.engine);
            entity.name = obj.name || 'landmark';

            // Resolve tile from the tile name
            entity.tileIndex = this.engine.spriteLibrary.resolveTile(tileName);
            if (!entity.tileIndex) {
                console.warn(`Landmark tile '${tileName}' not found in sprite library`);
                continue;
            }

            // Set visible by default
            entity.setAttribute('visible', true);

            // Extract custom properties from Tiled object
            if (obj.properties) {
                for (const prop of obj.properties) {
                    if (prop.name === 'walk_description') {
                        entity.setAttribute('walk_description', prop.value);
                    } else if (prop.name === 'tint') {
                        entity.tint = parseTint(prop.value);
                    } else if (prop.name === 'fillColor') {
                        entity.fillColor = parseTint(prop.value);
                    }
                }
            }

            // Create sprite and add to entities list
            this.engine.renderer?.createEntitySprite(entity);
            this.entities.push(entity);

            console.log(`Spawned landmark at (${tileX}, ${tileY}) with tile '${tileName}'`);
        }
    }

    addEntity(entity) {
        this._liquidPosCache = null;
        this._solidPosCache = null;
        this._actorPosCache = null;
        this.entities.push(entity);

        if (entity instanceof Actor) {
            this.actors.push(entity);
            // Track player if this actor has the controlled attribute
            if (entity.hasAttribute('controlled')) {
                this.player = entity;
                console.log(`Player set: ${entity.name} at (${entity.x}, ${entity.y})`);
            }
        } else if (entity instanceof Item) {
            this.items.push(entity);
            // Create sprite for dynamically added items
            if (this.engine.renderer) {
                this.engine.renderer.createItemSprite(entity);
            }
        }

        // Update sidebar when entities change
        this.engine.interfaceManager?.updateSidebar();
    }
    
    removeEntity(entity) {
        this._liquidPosCache = null;
        this._solidPosCache = null;
        this._actorPosCache = null;
        // Remove from arrays
        this.entities = this.entities.filter(e => e !== entity);
        this.actors = this.actors.filter(a => a !== entity);
        this.items = this.items.filter(i => i !== entity);

        // Clean up sprites
        if (entity.spriteBase) {
            entity.spriteBase.destroy();
            entity.spriteBase = null;
        }
        if (entity.spriteTop) {
            entity.spriteTop.destroy();
            entity.spriteTop = null;
        }
        if (entity.spriteSide) {
            entity.spriteSide.destroy();
            entity.spriteSide = null;
        }
        // Clean up equipment sprites
        if (entity.spriteEquipment) {
            for (const slot of ['top', 'middle', 'lower']) {
                if (entity.spriteEquipment[slot]) {
                    entity.spriteEquipment[slot].destroy();
                    entity.spriteEquipment[slot] = null;
                }
            }
        }
        if (entity.sprite) {
            entity.sprite.destroy();
            entity.sprite = null;
        }
        // Clean up tileSprite for entities with both fill color and tile
        if (entity.tileSprite) {
            entity.tileSprite.destroy();
            entity.tileSprite = null;
        }

        // Remove from scheduler if it's an actor
        if (this.engine.scheduler && entity.act) {
            this.engine.scheduler.remove(entity);
        }

        // Update sidebar when entities change
        this.engine.interfaceManager?.updateSidebar();
    }

    revealDugArea(clearedPositions) {
        const mapManager = this.engine.mapManager;
        if (!mapManager) return;

        const wallData = this.engine.currentPrototype.getActorData('wall');
        if (!wallData) return;

        const DUG_FLOOR_TILE = 135;
        const clearedSet = new Set(clearedPositions.map(p => `${p.x},${p.y}`));

        for (const { x, y } of clearedPositions) {
            if (x < 0 || x >= mapManager.width || y < 0 || y >= mapManager.height) continue;
            if (!mapManager.floorMap[y][x]) {
                mapManager.floorMap[y][x] = { tileId: DUG_FLOOR_TILE, layer: 'floor' };
                this.engine.renderer?.renderTileAt('floor', x, y, mapManager);
                if (!this.getEntityAt(x, y)) {
                    this.spawnEntity('rubble', x, y);
                }
            }
        }

        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (const { x, y } of clearedPositions) {
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx < 0 || nx >= mapManager.width || ny < 0 || ny >= mapManager.height) continue;
                if (clearedSet.has(`${nx},${ny}`)) continue;
                if (mapManager.floorMap[ny]?.[nx]) continue;
                if (this.getActorAt(nx, ny)) continue;

                mapManager.floorMap[ny][nx] = { tileId: DUG_FLOOR_TILE, layer: 'floor' };
                this.engine.renderer?.renderTileAt('floor', nx, ny, mapManager);

                const actor = new Actor(nx, ny, 'wall', wallData, this.engine);
                this.addEntity(actor);
                this.engine.renderer?.createActorSprites(actor);
            }
        }

        this.engine.updateLighting?.();
    }

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
    }

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
    }

    getEntityAt(x, y) {
        return this.entities.find(e => e.x === x && e.y === y && !(e instanceof Actor) && !(e instanceof Item));
    }

    _ensureActorPosCache() {
        if (!this._actorPosCache) {
            this._actorPosCache = new Map();
            for (const a of this.actors) {
                if (a.isDead) continue;
                const key = a.x * 10000 + a.y;
                const list = this._actorPosCache.get(key);
                if (list) list.push(a);
                else this._actorPosCache.set(key, [a]);
            }
        }
    }

    invalidateActorPosCache() {
        this._actorPosCache = null;
    }

    getActorsAt(x, y) {
        this._ensureActorPosCache();
        return this._actorPosCache.get(x * 10000 + y) || [];
    }

    getActorAt(x, y) {
        this._ensureActorPosCache();
        const list = this._actorPosCache.get(x * 10000 + y);
        return list ? list[0] : undefined;
    }

    getOtherActorAt(x, y, excludeActor) {
        const list = this.getActorsAt(x, y);
        return list.find(a => a !== excludeActor);
    }

    getSolidActorAt(x, y) {
        const list = this.getActorsAt(x, y);
        return list.find(a => a.hasAttribute('solid'));
    }

    getItemAt(x, y) {
        return this.items.find(i => i.x === x && i.y === y);
    }

    findActorByAttribute(attributeName, attributeValue) {
        return this.actors.find(a => a.getAttribute(attributeName) === attributeValue);
    }

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
    }
    
    findAdjacentTarget(actor) {
        const dirs = CARDINAL_DIRS;
        for (const dir of dirs) {
            const target = this.getActorAt(actor.x + dir.dx, actor.y + dir.dy);
            if (target && target !== actor && !target.isDead) {
                return target;
            }
        }
        return null;
    }

    /**
     * Spawn an actor from actors.json at a given position
     * @param {string} actorType - The actor type key from actors.json
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Actor|null} The spawned actor or null if type not found
     */
    spawnActor(actorType, x, y) {
        const actorData = this.engine.currentPrototype?.getActorData(actorType);
        if (!actorData) {
            console.warn(`Actor type '${actorType}' not found in actors.json`);
            return null;
        }

        const actor = new Actor(x, y, actorType, actorData, this.engine);
        this.addEntity(actor);
        actor.loadDefaultItems();

        // Create sprites if renderer exists
        if (this.engine.renderer) {
            this.engine.renderer.createActorSprites(actor);
        }

        // Add to scheduler if actor has a personality (takes turns)
        if (actor.personality && this.engine.scheduler) {
            this.engine.scheduler.add(actor, true);
        }

        // Apply immediate damage to actors at this location
        // This ensures fire/cloud damage hits before victims can flee
        this.applySpawnDamage(actor);

        if (actor.hasAttribute('ignites')) {
            const flammable = this.getActorsAt(x, y)
                .filter(a => a !== actor && a.hasAttribute('flammable') && !a.isDead);
            for (const target of flammable) {
                target.die();
                const newFire = this.spawnActor('fire', x, y);
                if (newFire) newFire.fireLifetime = newFire.lifetime || 5;
            }
        }

        return actor;
    }

    /**
     * Apply immediate damage from a newly spawned actor to any actors at its location
     * This handles fire, cloud, and other hazardous actors that should damage on contact
     * @param {Actor} hazard - The newly spawned hazardous actor
     */
    applySpawnDamage(hazard) {
        // Check if this actor has damage-dealing behaviors
        const personality = hazard.personality;
        if (!personality) return;

        const behaviors = personality.data?.behaviors || [];
        const hasDamageBehavior = behaviors.includes('fire_burn_out') ||
                                   behaviors.includes('cloud_affect_actors') ||
                                   behaviors.includes('incinerate_entities');

        if (!hasDamageBehavior) return;

        for (const other of this.getActorsAt(hazard.x, hazard.y)) {
            if (other === hazard) continue;

            if (other.hasAttribute('fire_immune') ||
                other.hasAttribute('hazard_immune')) continue;

            // Skip flying actors (hovering above ground hazards)
            if (other.hasStateProperty?.('flying')) continue;

            // Apply fire damage
            if (behaviors.includes('fire_burn_out')) {
                const damagePerTurn = hazard.data?.damage_per_turn ?? 10;

                // Skip fireproof actors
                if (other.hasAttribute('fireproof')) continue;

                if (damagePerTurn > 0 && other.stats?.health) {
                    const oldHealth = other.stats.health.current;
                    other.stats.health.current = Math.max(0, oldHealth - damagePerTurn);

                    // Show damage message
                    if (other.hasAttribute('visible')) {
                        this.engine.inputManager?.showMessage(`The fire burns ${other.name} for ${damagePerTurn} damage!`, { x: other.x, y: other.y });
                    }

                    // Flash the victim
                    other.flash?.();

                    // Check for death
                    if (other.stats.health.current <= 0) {
                        other.die();
                    }
                }
            }

            // Apply cloud/mist collision effect
            if (behaviors.includes('cloud_affect_actors')) {
                const collisionEffect = hazard.getAttribute('collision_effect');
                if (collisionEffect && typeof collisionEffect === 'object') {
                    for (const [key, value] of Object.entries(collisionEffect)) {
                        if (other.stats && other.stats[key] !== undefined) {
                            const stat = other.stats[key];
                            if (typeof stat === 'object' && stat.current !== undefined) {
                                stat.current = Math.max(0, stat.current + value);

                                // Show effect message
                                if (other.hasAttribute('visible') && value < 0) {
                                    const statCapitalized = key.charAt(0).toUpperCase() + key.slice(1);
                                    this.engine.inputManager?.showMessage(`${other.name} takes ${Math.abs(value)} ${statCapitalized} damage from the ${hazard.name}!`, { x: other.x, y: other.y });
                                }

                                // Check for death from health damage
                                if (key === 'health' && stat.current <= 0) {
                                    other.die();
                                }
                            }
                        }
                    }

                    // Flash the victim if there was negative health effect
                    if (collisionEffect.health && collisionEffect.health < 0) {
                        other.flash?.();
                    }
                }

                // Apply state if cloud has apply_state (paralysis, confusion, etc.)
                const applyStateName = hazard.getAttribute('apply_state');
                if (applyStateName && other.applyState) {
                    const statesData = this.engine.globalStates;
                    if (statesData && statesData[applyStateName]) {
                        other.applyState(applyStateName, statesData[applyStateName]);
                    }
                }
            }
        }

        // Update sidebar to reflect damage
        this.engine.interfaceManager?.updateSidebar();
    }

    /**
     * Spawn a decorative entity from entities.json
     * @param {string} entityType - The entity type key from entities.json
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Entity|null} The spawned entity or null if type not found
     */
    spawnEntity(entityType, x, y) {
        const entityData = this.engine.globalEntities?.[entityType];
        if (!entityData) {
            console.warn(`Entity type '${entityType}' not found in entities.json`);
            return null;
        }

        const entity = new Entity(x, y, entityType, this.engine);
        entity.name = entityData.name || entityType;

        // Set tint
        entity.tint = parseTint(entityData.tint);

        // Set fill color if specified (for entities like blood that are just colored fills)
        entity.fillColor = entityData.fillColor ? parseTint(entityData.fillColor) : null;

        // Resolve tile index
        entity.tileIndex = this.engine.spriteLibrary.resolveTile(entityData.tileIndex);

        // Apply attributes
        if (entityData.attributes) {
            for (const [key, value] of Object.entries(entityData.attributes)) {
                entity.setAttribute(key, value);
            }
        }

        // Create sprite
        this.engine.renderer?.createEntitySprite(entity);

        // Add to entities list
        this.entities.push(entity);

        return entity;
    }

    spawnLiquidTrack(x, y, tint, entryDir, exitDir) {
        const tileName = this.getLiquidTrackTileName(entryDir, exitDir);
        const tileIndex = this.engine.spriteLibrary.getTileByName(tileName);
        if (!tileIndex) return null;

        const entity = new Entity(x, y, 'liquid_track', this.engine);
        entity.name = 'tracks';
        entity.tint = tint;
        entity.fillColor = null;
        entity.tileIndex = tileIndex;
        entity.setAttribute('visible', true);
        entity._trackEntryDir = entryDir;
        entity._trackExitDir = exitDir;

        this.engine.renderer?.createEntitySprite(entity);
        this.entities.push(entity);
        return entity;
    }

    getLiquidTrackTileName(entryDir, exitDir) {
        if (!entryDir && !exitDir) return 'WHITE_DOTTED_BOX_HORIZONTAL';
        if (!entryDir) {
            return (exitDir === 'up' || exitDir === 'down')
                ? 'WHITE_DOTTED_BOX_VERTICAL' : 'WHITE_DOTTED_BOX_HORIZONTAL';
        }
        if (!exitDir) {
            return (entryDir === 'up' || entryDir === 'down')
                ? 'WHITE_DOTTED_BOX_VERTICAL' : 'WHITE_DOTTED_BOX_HORIZONTAL';
        }
        const reverseDir = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
        const connectFrom = reverseDir[entryDir];
        const connectTo = exitDir;
        const connections = [connectFrom, connectTo].sort().join('-');
        const tileMap = {
            'down-up': 'WHITE_DOTTED_BOX_VERTICAL',
            'left-right': 'WHITE_DOTTED_BOX_HORIZONTAL',
            'left-up': 'WHITE_DOTTED_BOX_BOTTOM_RIGHT',
            'right-up': 'WHITE_DOTTED_BOX_BOTTOM_LEFT',
            'down-left': 'WHITE_DOTTED_BOX_TOP_RIGHT',
            'down-right': 'WHITE_DOTTED_BOX_TOP_LEFT'
        };
        return tileMap[connections] || 'WHITE_DOTTED_BOX_HORIZONTAL';
    }

    updateLiquidTrackTile(entity, entryDir, exitDir) {
        const tileName = this.getLiquidTrackTileName(entryDir, exitDir);
        const tileIndex = this.engine.spriteLibrary.getTileByName(tileName);
        if (!tileIndex || !entity.sprite) return;
        entity.tileIndex = tileIndex;
        entity._trackEntryDir = entryDir;
        entity._trackExitDir = exitDir;
        const tileset = PIXI.Loader.shared.resources.tiles;
        const rect = new PIXI.Rectangle(
            tileIndex.x * globalVars.TILE_WIDTH,
            tileIndex.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        entity.sprite.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
    }

    /**
     * Spawn an item at a specific location
     * @param {string} itemType - The item type key from items.json
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Item|null} The spawned item or null if item type not found
     */
    spawnItem(itemType, x, y) {
        const itemData = this.engine.currentPrototype.getItemData(itemType);
        if (!itemData) {
            console.warn(`Item type '${itemType}' not found`);
            return null;
        }

        const item = new Item(x, y, itemType, itemData, this.engine);
        this.addEntity(item);

        return item;
    }

    serializeEntities() {
        return this.entities.map(e => e.serialize());
    }
    
    deserializeEntities(data) {
        for (const entityData of data) {
            if (entityData.isActor) {
                const actorDef = this.engine.currentPrototype.getActorData(entityData.type);
                if (!actorDef) continue;
                const actor = new Actor(entityData.x, entityData.y, entityData.type, actorDef, this.engine);
                actor.deserialize(entityData);
                this.addEntity(actor);
            } else if (entityData.isItem) {
                const itemDef = this.engine.currentPrototype.getItemData(entityData.type);
                if (!itemDef) continue;
                const item = new Item(entityData.x, entityData.y, entityData.type, itemDef, this.engine);
                item.deserialize(entityData);
                this.addEntity(item);
            }
        }
    }
    
    cleanup() {
        this.entities.forEach(entity => {
            if (entity instanceof Actor) {
                if (entity.spriteBase) entity.spriteBase.destroy();
                if (entity.spriteTop) entity.spriteTop.destroy();
                if (entity.spriteSide) entity.spriteSide.destroy();
                // Clean up equipment sprites
                if (entity.spriteEquipment) {
                    for (const slot of ['top', 'middle', 'lower']) {
                        if (entity.spriteEquipment[slot]) entity.spriteEquipment[slot].destroy();
                    }
                }
            } else if (entity.sprite) {
                entity.sprite.destroy();
            }
        });
        this.entities = [];
        this.actors = [];
        this.items = [];
        this.player = null;
        this._actorPosCache = null;
        this._liquidPosCache = null;
        this._solidPosCache = null;
    }
}

// ============================================================================
// MAP MANAGER (now in architect.js as Architect class)
// ============================================================================

// LightingManager is now in lighting.js

// ============================================================================
// RENDER SYSTEM
// ============================================================================

// Old MapManager code removed - see architect.js

// MapManager class has been moved to architect.js as the Architect class
// See architect.js for the Architect class which handles map generation
// All map generation and wildcard processing is now handled by the Architect class
// The Architect class is loaded from architect.js before engine.js
// END OF MAPMANAGER REMOVAL

// LightingManager is now in lighting.js

// ============================================================================
// RENDER SYSTEM
// ============================================================================

class RenderSystem {
    constructor(app, mapWidth, mapHeight, engine) {
        this.app = app;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.engine = engine;
        
        // Create rendering containers
        this.backgroundContainer = new PIXI.Container();
        this.floorContainer = new PIXI.Container();
        this.entityContainer = new PIXI.Container();
        this.overlayContainer = new PIXI.Container();
        this.lightColorContainer = new PIXI.Container();
        this.darknessContainer = new PIXI.Container();
        this.uiContainer = new PIXI.Container();
        this.splashContainer = new PIXI.Container();

        this.backgroundContainer.sortableChildren = true;
        this.floorContainer.sortableChildren = true;
        this.entityContainer.sortableChildren = true;
        this.overlayContainer.sortableChildren = true;
        this.lightColorContainer.sortableChildren = true;
        this.darknessContainer.sortableChildren = true;
        this.uiContainer.sortableChildren = true;
        this.splashContainer.sortableChildren = true;

        // Set explicit zIndex to ensure correct layer order
        this.backgroundContainer.zIndex = 0;
        this.floorContainer.zIndex = 1;
        this.entityContainer.zIndex = 2;
        this.overlayContainer.zIndex = 3;
        this.lightColorContainer.zIndex = 4;
        this.darknessContainer.zIndex = 5;
        this.uiContainer.zIndex = 6;
        this.splashContainer.zIndex = 7;

        app.stage.addChild(this.backgroundContainer);
        app.stage.addChild(this.floorContainer);
        app.stage.addChild(this.entityContainer);
        app.stage.addChild(this.overlayContainer);
        app.stage.addChild(this.lightColorContainer);
        app.stage.addChild(this.darknessContainer);
        app.stage.addChild(this.uiContainer);
        app.stage.addChild(this.splashContainer);

        this.darknessSprites = [];
        this.lightColorSprites = [];
        this.floorSprites = [];
        this.backgroundSprites = [];
        this.overlaySprites = [];

        // Splash screen state
        this.splashActive = false;
        this.splashSprites = [];
        this.splashTextSprites = [];

        // Tile highlight for hover/aiming
        this.highlightFilter = true;
        this.highlightedSprites = [];
        this.highlightEnabled = true;

        // Line path highlight for throwing/aiming
        this.linePathSprites = [];

        // Walk path highlight for click-to-walk
        this.walkPathSprites = [];

        // Submersion overlay sprite (referenced by color_overlay primitive)
        this.submersionOverlay = null;

        // Ripple tint animation (shared state for tint_ripple primitives)
        this._rippleSprites = [];
        this._rippleTickerFn = null;

        // Effect runner - data-driven visual effects system
        this.effectRunner = new EffectRunner(this);

        // Load global effects if already available
        if (engine.globalEffects) {
            this.effectRunner.loadEffects(engine.globalEffects);
        }
    }

    /**
     * Apply a color overlay to simulate submersion using multiply blend mode
     * @param {number} tint - The tint color (e.g., 0x9BC964 for green)
     */
    applySubmersionTint(tint) {
        if (this.submersionOverlay) return;
        this._submersionTint = tint;
        this._submersionHandle = this.effectRunner.apply('submersion', null, { tint });
    }

    updateSubmersionOverlay() {
        if (!this.submersionOverlay || !this.engine.viewportEnabled) return;
        const tint = this._submersionTint;
        this.effectRunner.remove(this._submersionHandle);
        this._submersionHandle = this.effectRunner.apply('submersion', null, { tint });
    }

    removeSubmersionTint() {
        if (!this.submersionOverlay) return;
        this.effectRunner.remove(this._submersionHandle);
        this._submersionHandle = null;
    }

    applyConfusionEffect() {
        if (this._confusionHandle) return;
        this._confusionHandle = this.effectRunner.apply('confusion');
    }

    removeConfusionEffect() {
        if (!this._confusionHandle) return;
        this.effectRunner.remove(this._confusionHandle);
        this._confusionHandle = null;
    }

    applyHallucinationEffect() {
        if (this._hallucinationHandle) return;
        this._hallucinationHandle = this.effectRunner.apply('hallucination');
    }

    tickHallucination() {
        if (!this._hallucinationHandle) return;
        this.effectRunner.tick(this._hallucinationHandle);
    }

    removeHallucinationEffect() {
        if (!this._hallucinationHandle) return;
        this.effectRunner.remove(this._hallucinationHandle);
        this._hallucinationHandle = null;
    }

    /**
     * Show a highlight effect on a specific tile using color inversion
     * Applies invert filter directly to the sprites at that tile position
     * @param {number} tileX - Tile X coordinate
     * @param {number} tileY - Tile Y coordinate
     */
    showTileHighlight(tileX, tileY) {
        // First, clear any existing highlight
        this.hideTileHighlight();

        // Create invert filter if it doesn't exist
        if (!this.highlightFilter) {
            this.highlightFilter = new PIXI.filters.ColorMatrixFilter();
            this.highlightFilter.negative();
        }

        // Track which sprites we're highlighting
        this.highlightedSprites = [];

        // Apply filter to background sprite at this tile
        const bgSprite = this.backgroundSprites[tileY]?.[tileX];
        if (bgSprite) {
            bgSprite.filters = bgSprite.filters ? [...bgSprite.filters, this.highlightFilter] : [this.highlightFilter];
            this.highlightedSprites.push(bgSprite);
        }

        // Apply filter to floor sprite at this tile
        const floorSprite = this.floorSprites[tileY]?.[tileX];
        if (floorSprite) {
            floorSprite.filters = floorSprite.filters ? [...floorSprite.filters, this.highlightFilter] : [this.highlightFilter];
            this.highlightedSprites.push(floorSprite);
        }

        // Apply filter to any actors at this tile
        const actor = this.engine.entityManager?.getActorAt(tileX, tileY);
        if (actor && !actor.isDead) {
            if (actor.spriteBase) {
                actor.spriteBase.filters = actor.spriteBase.filters ? [...actor.spriteBase.filters, this.highlightFilter] : [this.highlightFilter];
                this.highlightedSprites.push(actor.spriteBase);
            }
            if (actor.spriteTop) {
                actor.spriteTop.filters = actor.spriteTop.filters ? [...actor.spriteTop.filters, this.highlightFilter] : [this.highlightFilter];
                this.highlightedSprites.push(actor.spriteTop);
            }
        }

        // Apply filter to any items at this tile
        const item = this.engine.entityManager?.getItemAt(tileX, tileY);
        if (item && item.sprite) {
            item.sprite.filters = item.sprite.filters ? [...item.sprite.filters, this.highlightFilter] : [this.highlightFilter];
            this.highlightedSprites.push(item.sprite);
        }

        this.highlightEnabled = true;
    }

    /**
     * Hide the tile highlight by removing invert filter from highlighted sprites
     */
    hideTileHighlight() {
        if (this.highlightedSprites && this.highlightFilter) {
            for (const sprite of this.highlightedSprites) {
                if (sprite.filters) {
                    sprite.filters = sprite.filters.filter(f => f !== this.highlightFilter);
                    if (sprite.filters.length === 0) sprite.filters = null;
                }
            }
        }
        this.highlightedSprites = [];
        this.highlightEnabled = false;
    }

    updateTileVisibility(originX, originY, vpW, vpH) {
        const margin = 1;
        const minX = Math.max(0, originX - margin);
        const minY = Math.max(0, originY - margin);
        const maxX = Math.min(this.mapWidth, originX + vpW + margin);
        const maxY = Math.min(this.mapHeight, originY + vpH + margin);

        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                const vis = (x >= minX && x < maxX && y >= minY && y < maxY);
                if (this.backgroundSprites[y]?.[x]) this.backgroundSprites[y][x].visible = vis;
                if (this.floorSprites[y]?.[x]) this.floorSprites[y][x].visible = vis;
                if (this.overlaySprites[y]?.[x]) this.overlaySprites[y][x].visible = vis;
                if (this.darknessSprites[y]?.[x]) this.darknessSprites[y][x].visible = vis;
                if (this.lightColorSprites[y]?.[x]) this.lightColorSprites[y][x].visible = vis;
            }
        }
    }

    updateEntityVisibility(originX, originY, vpW, vpH) {
        if (!this.engine.viewportEnabled) return;
        for (const actor of this.engine.entityManager.actors) {
            if (actor.isDead) continue;
            const inView = actor.x >= originX && actor.x < originX + vpW &&
                           actor.y >= originY && actor.y < originY + vpH;
            if (actor.spriteBase) actor.spriteBase.visible = inView;
            if (actor.spriteTop) {
                const topInView = (actor.y - 1) >= originY && (actor.y - 1) < originY + vpH &&
                                  actor.x >= originX && actor.x < originX + vpW;
                actor.spriteTop.visible = (inView || topInView) && !actor.isSubmerged;
            }
            if (actor.spriteSide) {
                const sideOffset = actor.getEffectiveSideOffset();
                const sideX = actor.x + sideOffset.dx;
                const sideY = actor.y + sideOffset.dy;
                const sideInView = sideX >= originX && sideX < originX + vpW &&
                                   sideY >= originY && sideY < originY + vpH;
                actor.spriteSide.visible = sideInView && !actor.isSubmerged;
            }
            if (actor.spriteEquipment) {
                for (const slot of ['top', 'middle', 'lower']) {
                    if (actor.spriteEquipment[slot]) actor.spriteEquipment[slot].visible = inView && !actor.isSubmerged;
                }
            }
        }
        for (const item of this.engine.entityManager.items) {
            if (item.sprite) {
                item.sprite.visible = item.x >= originX && item.x < originX + vpW &&
                                      item.y >= originY && item.y < originY + vpH;
            }
        }
    }

    /**
     * Show a line path highlight
     * @param {number} startX - Starting tile X
     * @param {number} startY - Starting tile Y
     * @param {number} endX - Target tile X
     * @param {number} endY - Target tile Y
     * @param {number} color - Optional color for the path (default: 0xFF0000 red)
     * @param {number} maxRange - Optional maximum range (path truncated at this distance)
     * @returns {{path: Array, blockedAt: {x,y}|null, outOfRange: boolean}} The path, where blocked, and if target is out of range
     */
    showLinePath(startX, startY, endX, endY, color = 0xFF0000, maxRange = null, options = {}) {
        // Clear any existing path highlight
        this.hideLinePath();

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;

        // Get the line path using Bresenham's algorithm
        const fullPath = getLinePath(startX, startY, endX, endY);

        // Track where path is blocked (skip start position)
        let blockedAt = null;
        let outOfRange = false;
        const displayPath = [];

        for (let i = 1; i < fullPath.length; i++) {
            const point = fullPath[i];

            // Check if we've exceeded max range
            if (maxRange !== null && i > maxRange) {
                outOfRange = true;
                break;
            }

            // Check for solid actors that would block the path
            const actor = this.engine.entityManager?.getSolidActorAt(point.x, point.y);
            if (actor) {
                if (options.passThrough && actor.getAttribute('conductive') !== false) {
                    // Bolt passes through conductive actors
                    displayPath.push(point);
                    continue;
                }
                blockedAt = point;
                displayPath.push(point); // Include the blocked tile
                break;
            }

            displayPath.push(point);
        }

        // Create path overlay sprites
        this.linePathSprites = [];

        // Determine path color - gray if out of range
        const pathColor = outOfRange ? 0x888888 : color;

        for (let i = 0; i < displayPath.length; i++) {
            const point = displayPath[i];
            const isBlocked = blockedAt && point.x === blockedAt.x && point.y === blockedAt.y;
            const isTarget = i === displayPath.length - 1;

            // Create a colored overlay
            const graphics = new PIXI.Graphics();

            if (isTarget || isBlocked) {
                // Target/blocked tile - brighter, inverted
                graphics.beginFill(pathColor, 1);
                graphics.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            } else {
                // Path tile - faint
                graphics.beginFill(pathColor, 0.6);
                graphics.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            }

            graphics.drawRect(0, 0, tileWidth, tileHeight);
            graphics.endFill();

            graphics.x = point.x * tileWidth;
            graphics.y = point.y * tileHeight;
            graphics.zIndex = 8;

            this.uiContainer.addChild(graphics);
            this.linePathSprites.push(graphics);
        }

        return {
            path: displayPath,
            blockedAt: blockedAt,
            outOfRange: outOfRange
        };
    }

    /**
     * Hide the line path highlight
     */
    hideLinePath() {
        if (this.linePathSprites) {
            for (const sprite of this.linePathSprites) {
                this.uiContainer.removeChild(sprite);
                sprite.destroy();
            }
        }
        this.linePathSprites = [];
    }

    /**
     * Show a walk path highlight using A* pathfinding
     * Uses yellow-tinted overlay for path tiles
     * @param {number} startX - Starting tile X
     * @param {number} startY - Starting tile Y
     * @param {number} endX - Target tile X
     * @param {number} endY - Target tile Y
     * @returns {Array|null} The path array or null if no path exists
     */
    showWalkPath(startX, startY, endX, endY) {
        // Clear any existing walk path highlight
        this.hideWalkPath();

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;

        // Create passability callback
        const isPassable = (x, y) => {
            // Check map boundaries
            if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) {
                return false;
            }
            // Allow start and end tiles even if occupied
            if ((x === startX && y === startY) || (x === endX && y === endY)) {
                // Still need to check if there's floor
                const floorTile = this.engine.mapManager?.floorMap[y]?.[x];
                return floorTile && floorTile.tileId > 0;
            }
            // Check for solid actors
            const solidActor = this.engine.entityManager?.getSolidActorAt(x, y);
            if (solidActor) {
                return false;
            }
            // Check for hazardous actors - avoid unless player has matching immunity
            const actor = this.engine.entityManager?.getActorAt(x, y);
            const damageType = actor?.getAttribute('damage_type');
            if (damageType && !actor.isDead) {
                const player = this.engine.entityManager?.player;
                if (!player?.hasAttribute(`${damageType}_immune`)) {
                    return false;
                }
            }
            // Check if tile is walkable (has floor)
            const floorTile = this.engine.mapManager?.floorMap[y]?.[x];
            return floorTile && floorTile.tileId > 0;
        };

        const hasFloor = (x, y) => {
            const tile = this.engine.mapManager?.floorMap[y]?.[x];
            return tile && tile.tileId > 0;
        };

        // Find path using A*
        const path = findPathAStar(startX, startY, endX, endY, isPassable, { topology: 8, hasFloor });

        if (path.length === 0) {
            return null; // No path found
        }

        // Create path overlay sprites (skip first tile - that's the player's position)
        this.walkPathSprites = [];

        for (let i = 1; i < path.length; i++) {
            const point = path[i];
            const isTarget = i === path.length - 1;

            // Create a colored overlay
            const graphics = new PIXI.Graphics();

            if (isTarget) {
                // Target tile - brighter yellow
                graphics.beginFill(0xFADF63, 1);
                graphics.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            } else {
                // Path tile - faint yellow
                graphics.beginFill(0xFADF63, 0.6);
                graphics.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            }

            graphics.drawRect(0, 0, tileWidth, tileHeight);
            graphics.endFill();

            graphics.x = point.x * tileWidth;
            graphics.y = point.y * tileHeight;
            graphics.zIndex = 7; // Below line path (8) but above normal tiles

            this.uiContainer.addChild(graphics);
            this.walkPathSprites.push(graphics);
        }

        return path;
    }

    /**
     * Hide the walk path highlight
     */
    hideWalkPath() {
        if (this.walkPathSprites) {
            for (const sprite of this.walkPathSprites) {
                this.uiContainer.removeChild(sprite);
                sprite.destroy();
            }
        }
        this.walkPathSprites = [];
    }

    render() {
        // Render loop would update sprites based on entity positions
        console.log('Rendering frame');
    }
    
    renderTestPattern(mapManager) {
        console.log('Rendering Tiled map...');

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) {
            console.error('Tileset not loaded');
            return;
        }

        // Clear map layers only (not entityContainer - items/actors may already be there)
        this.clearMapLayers();

        // Initialize sprite tracking arrays
        this.backgroundSprites = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => null)
        );
        this.floorSprites = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => null)
        );

        // Render background layer
        this.renderLayer(mapManager.backgroundMap, this.backgroundContainer, tileset, this.backgroundSprites);

        // Render floor layer
        this.renderLayer(mapManager.floorMap, this.floorContainer, tileset, this.floorSprites);

        // Render overlay layer (decorative tiles above entities)
        this.overlaySprites = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => null)
        );
        this.renderLayer(mapManager.overlayMap, this.overlayContainer, tileset, this.overlaySprites);

        console.log(`Rendered tiles:`);
        console.log(`  Background: ${this.backgroundContainer.children.length} tiles`);
        console.log(`  Floor: ${this.floorContainer.children.length} tiles`);
        console.log(`  Overlay: ${this.overlayContainer.children.length} tiles`);
    }

    /**
     * Render a single map layer to a container
     */
    renderLayer(layerMap, container, tileset, spriteArray = null) {
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                const tile = layerMap[y]?.[x];

                if (tile && tile.tileId > 0) {
                    const sprite = this.createTileSprite(tile, x, y, tileset);
                    container.addChild(sprite);
                    if (spriteArray) {
                        spriteArray[y][x] = sprite;
                    }
                }
            }
        }
    }

    renderTileAt(layerName, x, y, mapManager) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;

        const layers = {
            'background': { map: 'backgroundMap', container: this.backgroundContainer, sprites: this.backgroundSprites },
            'floor': { map: 'floorMap', container: this.floorContainer, sprites: this.floorSprites },
            'overlay': { map: 'overlayMap', container: this.overlayContainer, sprites: this.overlaySprites }
        };

        const layer = layers[layerName];
        if (!layer) return;

        const tile = mapManager[layer.map][y]?.[x];
        if (!tile || tile.tileId <= 0) return;

        if (layer.sprites?.[y]?.[x]) {
            layer.sprites[y][x].destroy();
            layer.sprites[y][x] = null;
        }

        const sprite = this.createTileSprite(tile, x, y, tileset);
        layer.container.addChild(sprite);
        if (layer.sprites?.[y]) {
            layer.sprites[y][x] = sprite;
        }
    }

    /**
     * Create a sprite for a tile ID at a position
     */
    createTileSprite(tile, x, y, tileset) {
        const tileId = typeof tile === 'number' ? tile : tile.tileId;
        // Convert Tiled tile ID (1-indexed) to spritesheet coordinates
        const tileIndex = tileId - 1;
        const tileX = tileIndex % globalVars.SPRITESHEET_COLS;
        const tileY = Math.floor(tileIndex / globalVars.SPRITESHEET_COLS);

        const rect = new PIXI.Rectangle(
            tileX * globalVars.TILE_WIDTH,
            tileY * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );

        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const sprite = new PIXI.Sprite(texture);

        sprite.x = x * globalVars.TILE_WIDTH;
        sprite.y = y * globalVars.TILE_HEIGHT;

        // Apply Tiled flip/rotation flags
        if (typeof tile === 'object') {
            if (tile.flipD) {
                // Diagonal flip = 90° rotation + horizontal flip
                sprite.anchor.set(0.5, 0.5);
                sprite.x += globalVars.TILE_WIDTH / 2;
                sprite.y += globalVars.TILE_HEIGHT / 2;
                sprite.rotation = Math.PI / 2;
                sprite.scale.x = tile.flipH ? 1 : -1;
                sprite.scale.y = tile.flipV ? -1 : 1;
            } else {
                if (tile.flipH || tile.flipV) {
                    sprite.anchor.set(0.5, 0.5);
                    sprite.x += globalVars.TILE_WIDTH / 2;
                    sprite.y += globalVars.TILE_HEIGHT / 2;
                    if (tile.flipH) sprite.scale.x = -1;
                    if (tile.flipV) sprite.scale.y = -1;
                }
            }
        }

        return sprite;
    }
    
    renderActors(entityManager) {
        console.log('Rendering actors...');

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) {
            console.error('Tileset not loaded');
            return;
        }

        let actorsRendered = 0;

        // Render all actors
        for (const actor of entityManager.actors) {
            if (!actor.hasAttribute('visible')) continue;

            // Skip actors that already have sprites (e.g., dynamically spawned
            // by spawnActor before renderActors runs)
            if (actor.spriteBase) {
                actorsRendered++;
                continue;
            }

            // Render base sprite (static or animated)
            actor.spriteBase = this.createActorSprite(
                actor,
                actor.tileIndexBase,
                actor.animationBase,
                actor.x * globalVars.TILE_WIDTH,
                actor.y * globalVars.TILE_HEIGHT,
                10, // zIndex
                { flipH: actor.flipBaseH, flipV: actor.flipBaseV }
            );

            // Render top sprite (static or animated) - one tile above
            actor.spriteTop = this.createActorSprite(
                actor,
                actor.tileIndexTop,
                actor.animationTop,
                actor.x * globalVars.TILE_WIDTH,
                (actor.y - 1) * globalVars.TILE_HEIGHT,
                11, // zIndex
                { flipH: actor.flipTopH, flipV: actor.flipTopV }
            );

            // Render side sprite if defined
            if (actor.tileIndexSide || actor.animationSide) {
                const sideOffset = actor.getEffectiveSideOffset();
                actor.spriteSide = this.createActorSprite(
                    actor,
                    actor.tileIndexSide,
                    actor.animationSide,
                    (actor.x + sideOffset.dx) * globalVars.TILE_WIDTH,
                    (actor.y + sideOffset.dy) * globalVars.TILE_HEIGHT,
                    10,
                    { flipH: actor.flipSideH, flipV: actor.flipSideV }
                );
            }

            // Render equipment sprites for each slot
            for (const slot of ['top', 'middle', 'lower']) {
                const equippedItem = actor.getEquippedItem(slot);
                if (equippedItem) {
                    actor.spriteEquipment[slot] = this.createEquipmentSprite(
                        actor,
                        equippedItem,
                        slot
                    );
                }
            }

            if (actor.facingEnabled) actor.applyFacing();

            actorsRendered++;
        }

        console.log(`Rendered ${actorsRendered} actors`);
    }

    /**
     * Create sprites for a single actor (used when spawning actors dynamically)
     * @param {Actor} actor - The actor to create sprites for
     */
    createActorSprites(actor) {
        if (!actor.hasAttribute('visible')) return;

        const isAttachedFire = actor._isAttachedFire;
        const baseZ = isAttachedFire ? 12 : 10;
        const topZ = isAttachedFire ? 13 : 11;

        // Render base sprite (static or animated)
        actor.spriteBase = this.createActorSprite(
            actor,
            actor.tileIndexBase,
            actor.animationBase,
            actor.x * globalVars.TILE_WIDTH,
            actor.y * globalVars.TILE_HEIGHT,
            baseZ,
            { flipH: actor.flipBaseH, flipV: actor.flipBaseV }
        );

        // Render top sprite (static or animated) - one tile above
        actor.spriteTop = this.createActorSprite(
            actor,
            actor.tileIndexTop,
            actor.animationTop,
            actor.x * globalVars.TILE_WIDTH,
            (actor.y - 1) * globalVars.TILE_HEIGHT,
            topZ,
            { flipH: actor.flipTopH, flipV: actor.flipTopV }
        );

        // Render side sprite if defined
        if (actor.tileIndexSide || actor.animationSide) {
            const sideOffset = actor.getEffectiveSideOffset();
            actor.spriteSide = this.createActorSprite(
                actor,
                actor.tileIndexSide,
                actor.animationSide,
                (actor.x + sideOffset.dx) * globalVars.TILE_WIDTH,
                (actor.y + sideOffset.dy) * globalVars.TILE_HEIGHT,
                10,
                { flipH: actor.flipSideH, flipV: actor.flipSideV }
            );
        }

        // Render equipment sprites for each slot
        for (const slot of ['top', 'middle', 'lower']) {
            const equippedItem = actor.getEquippedItem(slot);
            if (equippedItem) {
                actor.spriteEquipment[slot] = this.createEquipmentSprite(
                    actor,
                    equippedItem,
                    slot
                );
            }
        }

        if (actor.facingEnabled) actor.applyFacing();
    }

    /**
     * Create a sprite for an actor tile (base or top)
     * @param {Actor} actor - The actor this sprite belongs to
     * @param {Object|null} tileIndex - Static tile coordinates {x, y} or null
     * @param {string|null} animationName - Animation name (e.g., 'fire') or null
     * @param {number} x - Pixel x position
     * @param {number} y - Pixel y position
     * @param {number} zIndex - Render layer
     * @param {Object} options - Additional options {flipH: boolean, flipV: boolean}
     * @returns {PIXI.Sprite|PIXI.AnimatedSprite|null} The created sprite or null
     */
    createActorSprite(actor, tileIndex, animationName, x, y, zIndex, options = {}) {
        const tileset = PIXI.Loader.shared.resources.tiles;

        // Check for animated sprite first
        if (animationName && this.engine.animationFrames) {
            const animFrames = this.engine.animationFrames[animationName];
            if (animFrames && animFrames.length > 0) {
                const animSprite = new PIXI.AnimatedSprite(animFrames);
                animSprite.x = x;
                animSprite.y = y;
                animSprite.animationSpeed = 0.1;
                // Start on a random frame so multiple instances aren't in sync
                const startFrame = Math.floor(Math.random() * animFrames.length);
                animSprite.gotoAndPlay(startFrame);
                animSprite.zIndex = zIndex;
                animSprite.tint = actor.tint;

                if (actor.flickerTint) {
                    this.effectRunner.apply('flicker_tint', animSprite, { baseTint: actor.tint });
                }

                if (actor.rippleTint) {
                    this.effectRunner.apply('ripple_tint', animSprite, { baseTint: actor.tint });
                }

                this.entityContainer.addChild(animSprite);
                return animSprite;
            }
        }

        // Fall back to static sprite
        if (tileIndex) {
            const rect = new PIXI.Rectangle(
                tileIndex.x * globalVars.TILE_WIDTH,
                tileIndex.y * globalVars.TILE_HEIGHT,
                globalVars.TILE_WIDTH,
                globalVars.TILE_HEIGHT
            );
            const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
            const sprite = new PIXI.Sprite(texture);

            sprite.zIndex = zIndex;
            sprite.tint = actor.tint;

            // Apply horizontal/vertical flip using anchor and scale
            // Set anchor to center for flipping, then adjust position
            if (options.flipH || options.flipV) {
                sprite.anchor.set(0.5, 0.5);
                sprite.x = x + globalVars.TILE_WIDTH / 2;
                sprite.y = y + globalVars.TILE_HEIGHT / 2;
                if (options.flipH) {
                    sprite.scale.x = -1;
                }
                if (options.flipV) {
                    sprite.scale.y = -1;
                }
            } else {
                sprite.x = x;
                sprite.y = y;
            }

            this.entityContainer.addChild(sprite);
            return sprite;
        }

        // No sprite to render
        return null;
    }

    /**
     * Create a sprite for a decorative entity
     * @param {Entity} entity - The entity to create a sprite for
     */
    createEntitySprite(entity) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        const x = entity.x * globalVars.TILE_WIDTH;
        const y = entity.y * globalVars.TILE_HEIGHT;

        // Entities that ignore darkness go in uiContainer (above darkness layer)
        const ignoreDarkness = entity.hasAttribute('ignore_darkness');
        const container = ignoreDarkness ? this.uiContainer : this.entityContainer;
        // Use low zIndex in uiContainer so thread appears below UI windows
        const zIndex = ignoreDarkness ? 1 : 5;

        // If entity has a fill color, create a colored rectangle
        if (entity.fillColor !== null && entity.fillColor !== undefined) {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(entity.fillColor);
            graphics.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            graphics.drawRect(0, 0, globalVars.TILE_WIDTH, globalVars.TILE_HEIGHT);
            graphics.endFill();
            graphics.x = x;
            graphics.y = y;
            graphics.zIndex = zIndex;

            container.addChild(graphics);
            entity.sprite = graphics;
        }

        // If entity has a tile index, create a sprite on top of any fill
        if (entity.tileIndex) {
            const rect = new PIXI.Rectangle(
                entity.tileIndex.x * globalVars.TILE_WIDTH,
                entity.tileIndex.y * globalVars.TILE_HEIGHT,
                globalVars.TILE_WIDTH,
                globalVars.TILE_HEIGHT
            );
            const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
            const sprite = new PIXI.Sprite(texture);

            sprite.x = x;
            sprite.y = y;
            sprite.zIndex = zIndex + 1; // Slightly above fill
            sprite.tint = entity.tint;

            container.addChild(sprite);

            // If we already have a fill sprite, store tile sprite separately
            if (entity.sprite) {
                entity.tileSprite = sprite;
            } else {
                entity.sprite = sprite;
            }
        }
    }

    /**
     * Create a sprite for an equipped item displayed on an actor
     * @param {Actor} actor - The actor wearing the item
     * @param {Item} item - The equipped item
     * @param {string} slot - The equipment slot ('top', 'middle', or 'lower')
     * @returns {PIXI.Sprite|null} The created sprite or null
     */
    createEquipmentSprite(actor, item, slot) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset || !item.tileIndex) return null;

        const rect = new PIXI.Rectangle(
            item.tileIndex.x * globalVars.TILE_WIDTH,
            item.tileIndex.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const sprite = new PIXI.Sprite(texture);

        const useCenterAnchor = actor.facingEnabled;
        const hw = globalVars.TILE_WIDTH / 2;
        const hh = globalVars.TILE_HEIGHT / 2;

        let x = actor.x * globalVars.TILE_WIDTH;
        let y, zIndex;

        switch (slot) {
            case 'top':
                y = (actor.y - 2) * globalVars.TILE_HEIGHT;
                zIndex = 13;
                break;
            case 'middle':
                y = (actor.y - 1) * globalVars.TILE_HEIGHT;
                zIndex = 12;
                break;
            case 'lower':
                y = actor.y * globalVars.TILE_HEIGHT;
                zIndex = 12;
                break;
            default:
                y = actor.y * globalVars.TILE_HEIGHT;
                zIndex = 12;
        }

        if (useCenterAnchor) {
            sprite.anchor.set(0.5, 0.5);
            x += hw;
            y += hh;
            const flipped = actor.isFacingFlipped();
            sprite.scale.x = flipped ? -1 : 1;
        }

        sprite.x = x;
        sprite.y = y;
        sprite.zIndex = zIndex;
        sprite.tint = item.tint;

        this.entityContainer.addChild(sprite);
        return sprite;
    }

    renderItems(entityManager) {
        console.log('Rendering items...');

        let itemsRendered = 0;

        for (const item of entityManager.items) {
            this.createItemSprite(item);
            if (item.sprite) itemsRendered++;
        }

        console.log(`Rendered ${itemsRendered} items`);
    }

    /**
     * Create a sprite for a single item (used when items are added dynamically)
     * @param {Item} item - The item to create a sprite for
     */
    createItemSprite(item) {
        if (!item.hasAttribute('visible')) return;
        if (item.sprite) return; // Already has a sprite

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset || !item.tileIndex) return;

        const rect = new PIXI.Rectangle(
            item.tileIndex.x * globalVars.TILE_WIDTH,
            item.tileIndex.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const sprite = new PIXI.Sprite(texture);

        sprite.x = item.x * globalVars.TILE_WIDTH;
        sprite.y = item.y * globalVars.TILE_HEIGHT;
        sprite.zIndex = this.getItemZIndex(item);
        sprite.tint = item.tint;

        // Apply horizontal/vertical flip using anchor at center
        if (item.flipH || item.flipV) {
            sprite.anchor.set(0.5, 0.5);
            sprite.x += globalVars.TILE_WIDTH / 2;
            sprite.y += globalVars.TILE_HEIGHT / 2;
            sprite.scale.x = item.flipH ? -1 : 1;
            sprite.scale.y = item.flipV ? -1 : 1;
        }

        this.entityContainer.addChild(sprite);
        item.sprite = sprite;
    }

    /**
     * Get the appropriate z-index for an item based on its position
     * Items in liquid render above actors so they appear to float
     * @param {Item} item - The item to check
     * @returns {number} The z-index for the item sprite
     */
    getItemZIndex(item) {
        const em = this.engine.entityManager;
        if (!em) return 5;

        // Check if there's a liquid actor at this position
        const liquidActor = em.getActorsAt(item.x, item.y)
            .find(a => a.hasAttribute('liquid'));

        // Items in liquid float above actors (zIndex 11), otherwise below (zIndex 5)
        return liquidActor ? 11 : 5;
    }

    /**
     * Update an item's z-index based on its current position
     * Call this when items move (e.g., drift in water, dropped)
     * @param {Item} item - The item to update
     */
    updateItemZIndex(item) {
        if (item.sprite) {
            item.sprite.zIndex = this.getItemZIndex(item);
        }
    }

    showSplash(viewportWidth, viewportHeight, originX, originY) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;

        this.splashActive = true;
        this.splashOriginX = originX;
        this.splashOriginY = originY;

        const blockCoords = this.engine.spriteLibrary.getTileByName('OPAQUE_FULL_BLOCK');
        const rect = new PIXI.Rectangle(
            blockCoords.x * globalVars.TILE_WIDTH,
            blockCoords.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        const blockTexture = new PIXI.Texture(tileset.texture.baseTexture, rect);

        this.splashSprites = Array.from({ length: viewportHeight }, () =>
            Array.from({ length: viewportWidth }, () => null)
        );

        for (let y = 0; y < viewportHeight; y++) {
            for (let x = 0; x < viewportWidth; x++) {
                const sprite = new PIXI.Sprite(blockTexture);
                sprite.anchor.set(0.5);
                sprite.x = x * globalVars.TILE_WIDTH + globalVars.TILE_WIDTH / 2;
                sprite.y = y * globalVars.TILE_HEIGHT + globalVars.TILE_HEIGHT / 2;
                sprite.scale.x = Math.random() < 0.5 ? -1 : 1;
                sprite.scale.y = Math.random() < 0.5 ? -1 : 1;
                this.splashContainer.addChild(sprite);
                this.splashSprites[y][x] = sprite;
            }
        }

        const text = "Click to Play";
        const textX = Math.floor((viewportWidth - text.length) / 2);
        const textY = Math.floor(viewportHeight / 2);
        this.splashTextSprites = [];

        for (let i = 0; i < text.length; i++) {
            const charSprite = this.engine.interfaceManager.createCharSprite(
                text[i],
                (textX + i) * globalVars.TILE_WIDTH,
                textY * globalVars.TILE_HEIGHT,
                0xFFFFFF,
                true
            );
            if (charSprite) {
                charSprite.zIndex = 1;
                this.splashContainer.addChild(charSprite);
                this.splashTextSprites.push(charSprite);
            }
        }
    }

    dismissSplash(onComplete) {
        if (!this.splashActive) { onComplete?.(); return; }

        for (const sprite of this.splashTextSprites) {
            sprite.destroy();
        }
        this.splashTextSprites = [];

        const originX = this.splashOriginX;
        const originY = this.splashOriginY;
        const vpW = this.splashSprites[0]?.length || 0;
        const vpH = this.splashSprites.length;
        const maxRadius = Math.max(vpW, vpH);

        if (this.splashSprites[originY]?.[originX]) {
            this.splashSprites[originY][originX].destroy();
            this.splashSprites[originY][originX] = null;
        }

        let radius = 1;

        const revealCircle = () => {
            let tilesCleared = false;

            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.sqrt(dx * dx + dy * dy) <= radius) {
                        const x = originX + dx;
                        const y = originY + dy;
                        if (x >= 0 && x < vpW && y >= 0 && y < vpH) {
                            if (this.splashSprites[y][x]) {
                                this.splashSprites[y][x].destroy();
                                this.splashSprites[y][x] = null;
                                tilesCleared = true;
                            }
                        }
                    }
                }
            }

            if (radius < maxRadius && tilesCleared) {
                radius = radius * 2;
                setTimeout(revealCircle, 50);
            } else {
                this.splashContainer.removeChildren();
                this.splashSprites = [];
                this.splashActive = false;
                onComplete?.();
            }
        };

        revealCircle();
    }

    clear() {
        this.backgroundContainer.removeChildren();
        this.floorContainer.removeChildren();
        this.entityContainer.removeChildren();
        this.overlayContainer.removeChildren();
        this.lightColorContainer.removeChildren();
        this.darknessContainer.removeChildren();
        this.uiContainer.removeChildren();
        this.splashContainer.removeChildren();
        this.splashActive = false;
        this.splashSprites = [];
        this.splashTextSprites = [];
        this.darknessSprites = [];
        this.lightColorSprites = [];
        this.floorSprites = [];
        this.backgroundSprites = [];
        this.overlaySprites = [];
        this.highlightFilter = null;
        this.highlightedSprites = [];
        this.highlightEnabled = false;
        this.linePathSprites = [];
        this.walkPathSprites = [];
        if (this._rippleTickerFn) {
            this.app.ticker.remove(this._rippleTickerFn);
            this._rippleTickerFn = null;
        }
        this._rippleSprites = [];

        // Clean up all active effects
        this.effectRunner.removeAll();
        this._confusionHandle = null;
        this._hallucinationHandle = null;
        this._submersionHandle = null;
    }

    /**
     * Clear only map layers (background, floor) without touching entities
     * Use this when re-rendering the map but keeping existing entity sprites
     */
    clearMapLayers() {
        this.backgroundContainer.removeChildren();
        this.floorContainer.removeChildren();
        this.overlayContainer.removeChildren();
        this.floorSprites = [];
        this.backgroundSprites = [];
        this.overlaySprites = [];
    }

    initializeDarkness(width, height) {
        this.darknessContainer.removeChildren();
        this.lightColorContainer.removeChildren();
        this.darknessSprites = [];
        this.lightColorSprites = [];

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;

        const rect = new PIXI.Rectangle(
            0 * globalVars.TILE_WIDTH,
            10 * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        this.darkTexture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        this.solidDarkTexture = this.darkTexture;

        const whiteGraphics = new PIXI.Graphics();
        whiteGraphics.beginFill(0xFFFFFF);
        whiteGraphics.drawRect(0, 0, globalVars.TILE_WIDTH, globalVars.TILE_HEIGHT);
        whiteGraphics.endFill();
        this.lightColorTexture = this.app.renderer.generateTexture(whiteGraphics);
        whiteGraphics.destroy();

        for (let y = 0; y < height; y++) {
            this.darknessSprites[y] = [];
            this.lightColorSprites[y] = [];
            for (let x = 0; x < width; x++) {
                // Light color overlay (multiply blend)
                const lightSprite = new PIXI.Sprite(this.lightColorTexture);
                lightSprite.x = x * globalVars.TILE_WIDTH;
                lightSprite.y = y * globalVars.TILE_HEIGHT;
                lightSprite.alpha = 0;
                lightSprite.tint = 0xFFFFFF;
                lightSprite.blendMode = PIXI.BLEND_MODES.MULTIPLY;
                this.lightColorContainer.addChild(lightSprite);
                this.lightColorSprites[y][x] = lightSprite;

                // Darkness overlay
                const sprite = new PIXI.Sprite(this.solidDarkTexture);
                sprite.x = x * globalVars.TILE_WIDTH;
                sprite.y = y * globalVars.TILE_HEIGHT;
                sprite.alpha = 1.0;

                sprite.anchor.set(0.5, 0.5);
                sprite.x += globalVars.TILE_WIDTH / 2;
                sprite.y += globalVars.TILE_HEIGHT / 2;
                if (Math.random() < 0.5) sprite.scale.x = -1;
                if (Math.random() < 0.5) sprite.scale.y = -1;

                this.darknessContainer.addChild(sprite);
                this.darknessSprites[y][x] = sprite;
            }
        }
    }

    updateDarkness(lightingManager, fogOfWar = false) {
        if (!this.darknessSprites.length) return;

        const engine = this.engine;
        const margin = 2;
        const startX = engine.viewportEnabled ? Math.max(0, engine.sectionOriginX - margin) : 0;
        const startY = engine.viewportEnabled ? Math.max(0, engine.sectionOriginY - margin) : 0;
        const endX = engine.viewportEnabled
            ? Math.min(lightingManager.width, engine.sectionOriginX + engine.viewportWidth + margin)
            : lightingManager.width;
        const endY = engine.viewportEnabled
            ? Math.min(lightingManager.height, engine.sectionOriginY + engine.viewportHeight + margin)
            : lightingManager.height;

        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const darkSprite = this.darknessSprites[y]?.[x];
                const lightColorSprite = this.lightColorSprites[y]?.[x];

                // Apply colored light overlay
                if (lightColorSprite) {
                    const colorOverlay = lightingManager.getLightColorOverlay(x, y);
                    lightColorSprite.tint = colorOverlay.tint;
                    lightColorSprite.alpha = colorOverlay.alpha;
                }

                // Update darkness overlay
                if (darkSprite) {
                    const darkness = lightingManager.getDarknessAlpha(x, y, fogOfWar);
                    darkSprite.texture = darkness.useSolidTexture ? this.solidDarkTexture : this.darkTexture;
                    darkSprite.alpha = darkness.alpha;
                }
            }
        }

        // Update actor and item tints based on lighting
        this.updateEntityLighting(lightingManager);
    }

    updateEntityLighting(lightingManager) {
        const fogOfWar = this.engine.currentPrototype?.config?.mechanics?.fog_of_war;

        for (const actor of this.engine.entityManager.actors) {
            // Skip dead actors - their sprites should stay hidden
            if (actor.isDead) continue;

            // Static actors (walls, doors, terrain) stay visible in remembered areas
            // Mobile actors (with personality or controlled) only visible in line of sight
            const isStatic = !actor.personality && !actor.hasAttribute('controlled');
            const vis = lightingManager.getEntityVisibility(actor.x, actor.y, fogOfWar, isStatic);

            const playerTelepathic = this.engine.entityManager?.player?.hasStateProperty?.('telepathic');
            const revealedByTelepathy = playerTelepathic && actor.personality && !actor.hasAttribute('controlled');

            // Invisible actors: translucent for player, hidden for others
            if (actor.hasStateProperty?.('invisible')) {
                if (actor.hasAttribute('controlled')) {
                    const alpha = 0.35;
                    if (actor.spriteBase) { actor.spriteBase.visible = vis.showBase; actor.spriteBase.alpha = alpha; }
                    if (actor.spriteTop) { actor.spriteTop.visible = vis.showTop && !actor.isSubmerged; actor.spriteTop.alpha = alpha; }
                    if (actor.spriteSide) actor.spriteSide.alpha = alpha;
                    for (const slot of ['top', 'middle', 'lower']) {
                        if (actor.spriteEquipment[slot]) actor.spriteEquipment[slot].alpha = alpha;
                    }
                } else {
                    if (actor.spriteBase) actor.spriteBase.visible = false;
                    if (actor.spriteTop) actor.spriteTop.visible = false;
                    if (actor.spriteSide) actor.spriteSide.visible = false;
                    for (const slot of ['top', 'middle', 'lower']) {
                        if (actor.spriteEquipment[slot]) actor.spriteEquipment[slot].visible = false;
                    }
                }
                continue;
            }

            if (actor.spriteBase) actor.spriteBase.visible = vis.showBase || revealedByTelepathy;
            if (actor.spriteTop) actor.spriteTop.visible = (vis.showTop || revealedByTelepathy) && !actor.isSubmerged;

            // Update equipment sprite visibility
            // top: uses showEquipmentTop (at y-2, above actor's head) - lit same as actor
            // middle: uses showTop (on actor's top tile)
            // lower: uses showBase (on actor's base tile)
            if (actor.spriteEquipment.top) actor.spriteEquipment.top.visible = vis.showEquipmentTop && !actor.isSubmerged;
            if (actor.spriteEquipment.middle) actor.spriteEquipment.middle.visible = vis.showTop && !actor.isSubmerged;
            if (actor.spriteEquipment.lower) actor.spriteEquipment.lower.visible = vis.showBase;

            // Side sprite uses its own position for lighting (may be in a different tile)
            if (actor.spriteSide) {
                const sideOffset = actor.getEffectiveSideOffset();
                const sideVis = lightingManager.getEntityVisibility(
                    actor.x + sideOffset.dx, actor.y + sideOffset.dy, fogOfWar, isStatic
                );
                actor.spriteSide.visible = sideVis.showBase && !actor.isSubmerged;
            }

            this.setAnimationPlaying(actor.spriteBase, vis.animateBase);
            this.setAnimationPlaying(actor.spriteTop, vis.animateTop);
            this.setAnimationPlaying(actor.spriteSide, vis.animateBase);

            if (!vis.showBase && !vis.showTop) continue;

            // Light sources keep their own tint
            if (actor.hasAttribute('light_source')) continue;

            if (actor.spriteBase) {
                actor.spriteBase.tint = this.blendTints(actor.tint, vis.baseTint);
            }
            if (actor.spriteTop) {
                actor.spriteTop.tint = this.blendTints(actor.tint, vis.topTint);
            }
            if (actor.spriteSide) {
                const sideOffset = actor.getEffectiveSideOffset();
                const sideVis = lightingManager.getEntityVisibility(
                    actor.x + sideOffset.dx, actor.y + sideOffset.dy, fogOfWar, isStatic
                );
                if (sideVis.showBase) {
                    actor.spriteSide.tint = this.blendTints(actor.tint, sideVis.baseTint);
                }
            }

            // Update equipment sprite tints
            for (const slot of ['top', 'middle', 'lower']) {
                if (actor.spriteEquipment[slot]) {
                    const equippedItem = actor.getEquippedItem(slot);
                    if (equippedItem) {
                        // top uses equipmentTopTint (same as actor), middle uses topTint, lower uses baseTint
                        let tintToUse;
                        if (slot === 'top') {
                            tintToUse = vis.equipmentTopTint;
                        } else if (slot === 'lower') {
                            tintToUse = vis.baseTint;
                        } else {
                            tintToUse = vis.topTint;
                        }
                        actor.spriteEquipment[slot].tint = this.blendTints(equippedItem.tint, tintToUse);
                    }
                }
            }
        }

        this.updateProximityTransparency();

        for (const item of this.engine.entityManager.items) {
            const vis = lightingManager.getEntityVisibility(item.x, item.y, fogOfWar);

            if (item.sprite) item.sprite.visible = vis.showBase;
            this.setAnimationPlaying(item.sprite, vis.animateBase);

            if (!vis.showBase) continue;

            if (item.sprite) {
                item.sprite.tint = this.blendTints(item.tint, vis.baseTint);
            }
        }

        // Update decorative entities (thread trails, etc.)
        for (const entity of this.engine.entityManager.entities) {
            if (!entity.sprite) continue;

            if (entity.hasAttribute('ignore_darkness')) {
                // Always visible with original tint
                entity.sprite.visible = true;
                entity.sprite.tint = entity.tint;
            } else {
                // Normal visibility based on lighting
                const vis = lightingManager.getEntityVisibility(entity.x, entity.y, fogOfWar);
                entity.sprite.visible = vis.showBase;
                if (vis.showBase) {
                    entity.sprite.tint = this.blendTints(entity.tint, vis.baseTint);
                }
            }
        }
    }

    updateProximityTransparency() {
        const player = this.engine.entityManager.player;
        if (!player || player.isDead) return;

        for (const actor of this.engine.entityManager.actors) {
            if (actor.hasStateProperty?.('invisible')) continue;
            if (actor.spriteTop) actor.spriteTop.alpha = 1.0;
            if (actor.spriteEquipment.middle) actor.spriteEquipment.middle.alpha = 1.0;
        }

        for (const actor of this.engine.entityManager.actors) {
            if (actor.isDead) continue;
            if (!isImportantActor(actor)) continue;
            if (getChebyshevDistance(player.x, player.y, actor.x, actor.y) > 4) continue;

            const southernActor = this.engine.entityManager.getActorAt(actor.x, actor.y + 1);
            if (!southernActor || southernActor.isDead || southernActor === actor) continue;
            if (southernActor.hasAttribute('controlled')) continue;

            if (southernActor.spriteTop?.visible) {
                southernActor.spriteTop.alpha = 0.35;
            }
            if (southernActor.spriteEquipment.middle?.visible) {
                southernActor.spriteEquipment.middle.alpha = 0.35;
            }
        }
    }

    /**
     * Update a sprite's texture to a new tile index
     * @param {PIXI.Sprite} sprite - The sprite to update
     * @param {Object} tileIndex - The tile index {x, y}
     */
    updateSpriteTexture(sprite, tileIndex) {
        if (!sprite || !tileIndex) return;
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;
        const rect = new PIXI.Rectangle(
            tileIndex.x * globalVars.TILE_WIDTH,
            tileIndex.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        sprite.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
    }

    blendTints(baseTint, lightTint) {
        const br = (baseTint >> 16) & 0xFF;
        const bg = (baseTint >> 8) & 0xFF;
        const bb = baseTint & 0xFF;

        const lr = (lightTint >> 16) & 0xFF;
        const lg = (lightTint >> 8) & 0xFF;
        const lb = lightTint & 0xFF;

        const r = Math.floor((br * lr) / 255);
        const g = Math.floor((bg * lg) / 255);
        const b = Math.floor((bb * lb) / 255);

        return (r << 16) | (g << 8) | b;
    }

    setAnimationPlaying(sprite, shouldPlay) {
        if (!sprite) return;
        if (!(sprite instanceof PIXI.AnimatedSprite)) return;

        if (shouldPlay && !sprite.playing) {
            sprite.play();
        } else if (!shouldPlay && sprite.playing) {
            sprite.stop();
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let engine = null;

async function initializeGame() {
    const gameContainer = document.getElementById('game');
    
    try {
        console.log('Starting game initialization...');
        
        // Clear any existing content
        gameContainer.innerHTML = '';
        
        // Parse URL parameters early — needed for seed before any RNG consumption
        const urlParams = new URLSearchParams(window.location.search);

        // Seed the RNG before anything else (loadGlobalData, map generation, etc.)
        const urlSeed = urlParams.get('seed');
        const seed = urlSeed ? Number(urlSeed) : Date.now();
        ROT.RNG.setSeed(seed);
        console.log(`RNG seeded: ${seed}${urlSeed ? ' (from URL)' : ' (generated)'}`);

        engine = new DungeonEngine();
        engine.currentSeed = seed;
        await engine.initialize();

        // Determine which prototype to load (priority order):
        // 1. URL parameter: ?prototype=labyrinth
        // 2. Data attribute on game container: <div id="game" data-prototype="labyrinth">
        // 3. Global config object: window.DUNGEON_CONFIG = { prototype: 'labyrinth' }
        // 4. Default: 'default'
        const urlPrototype = urlParams.get('prototype');
        const dataPrototype = gameContainer.dataset.prototype;
        const configPrototype = window.DUNGEON_CONFIG?.prototype;

        // Normalize prototype name - extract just the name if a full path was provided
        const normalizePrototypeName = (name) => {
            if (!name) return null;
            // Remove leading slashes and any path prefix, keep only the last segment
            return name.replace(/^\/+/, '').split('/').pop();
        };

        const rawPrototype = urlPrototype || dataPrototype || configPrototype || 'default';
        const firstPrototype = normalizePrototypeName(rawPrototype);
        console.log(`Loading prototype: ${firstPrototype} (source: ${urlPrototype ? 'URL' : dataPrototype ? 'data-attribute' : configPrototype ? 'config' : 'default'})`);

        await engine.loadPrototype(firstPrototype);
        
        console.log('Game initialized successfully');
    } catch (error) {
        console.error('Failed to initialize game:', error);
        gameContainer.innerHTML = `
            <div style="color: red; padding: 20px; font-family: monospace;">
                <h2>Failed to Initialize Game</h2>
                <p><strong>Error:</strong> ${error.message}</p>
                <pre style="background: #f5f5f5; padding: 10px; overflow: auto;">${error.stack}</pre>
                <button onclick="initializeGame()" style="margin-top: 10px; padding: 10px 20px; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
    }
}

// Manual initialization - uncomment to enable auto-start
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', initializeGame);
// } else {
//     initializeGame();
// }

// For debugging: expose initialization function to console
window.initializeGame = initializeGame;

// Level loading utilities for developer console
// Levels ordered by depth (index = depth number)
const levelsByDepth = [
    { name: 'test', description: 'Test Prototype' },
    { name: 'labyrinth', description: 'Cretan Labyrinth' }
];

window.loadLevel = async (levelIdentifier) => {
    if (!engine) {
        console.error('Engine not initialized. Run initializeGame() first.');
        return;
    }

    let prototypeName;

    // Check if it's a number (depth) or string (name)
    if (typeof levelIdentifier === 'number') {
        const depth = levelIdentifier;
        if (depth < 0 || depth >= levelsByDepth.length) {
            console.error(`Invalid depth: ${depth}. Valid range: 0-${levelsByDepth.length - 1}`);
            listLevels();
            return;
        }
        prototypeName = levelsByDepth[depth].name;
        console.log(`Loading depth ${depth}: ${prototypeName}`);
    } else {
        prototypeName = levelIdentifier;
        console.log(`Loading level: ${prototypeName}`);
    }

    await engine.reloadPrototype(prototypeName);
};

window.listLevels = () => {
    const levels = levelsByDepth.map((level, depth) => ({
        depth,
        name: level.name,
        description: level.description
    }));
    console.table(levels);
    console.log('Use loadLevel(depth) or loadLevel("name") to load a level');
    return levels;
};

window.giveItem = (itemType, count = 1) => {
    if (!engine) {
        console.error('Engine not initialized.');
        return;
    }
    const player = engine.entityManager.player;
    if (!player) {
        console.error('No player found.');
        return;
    }
    const itemData = engine.currentPrototype.getItemData(itemType);
    if (!itemData) {
        console.error(`Item type '${itemType}' not found.`);
        return;
    }
    for (let i = 0; i < count; i++) {
        const item = new Item(-1, -1, itemType, itemData, engine);
        item.owner = player;
        player.inventory.push(item);
    }
    console.log(`Gave ${count}x ${itemData.name || itemType} to ${player.name}`);
};

window.goToFloor = async (floorNumber) => {
    if (!engine) {
        console.error('Engine not initialized.');
        return;
    }
    const config = engine.currentPrototype?.config;
    const totalFloors = config?.levels?.length || 1;
    if (floorNumber < 1 || floorNumber > totalFloors) {
        console.error(`Invalid floor: ${floorNumber}. Valid range: 1-${totalFloors}`);
        return;
    }
    const prototypeName = engine.currentPrototype.name;
    engine.cleanup();
    const prototypeConfig = await engine.loadPrototypeConfig(prototypeName);
    engine.currentPrototype = new Prototype(prototypeName, prototypeConfig, engine);
    await engine.currentPrototype.loadAssets();
    engine.currentFloor = floorNumber;
    engine.floorStates.clear();
    await engine.loadFloor(floorNumber, 'from_above');
    console.log(`Jumped to floor ${floorNumber}/${totalFloors}`);
};

console.log('Dungeon Mode Kit loaded. Call initializeGame() to start.');
console.log('Level utilities: listLevels(), loadLevel("prototypeName"), giveItem("itemType", count), goToFloor(n)');