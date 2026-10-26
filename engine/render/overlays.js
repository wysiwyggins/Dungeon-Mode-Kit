/**
 * RenderSystem methods: line paths, the infrastructure (machine links) layer,
 * magic-detection markers and the walk path.
 */

import {
    findPathAStar,
    getLinePath,
    isOpenableDoorTile,
    traceBoltPath
} from '../../core/pathfinding.js';
import { globalVars } from '../../globals.js';

export const RenderOverlays = {
    /**
     * Show a line path highlight
     * @param {number} startX - Starting tile X
     * @param {number} startY - Starting tile Y
     * @param {number} endX - Target tile X
     * @param {number} endY - Target tile Y
     * @param {number} color - Optional color for the path (default: 0xFF0000 red)
     * @param {number} maxRange - Optional maximum range (path truncated at this distance)
     * @returns {{path: Array, blockedAt: {x,y}|null, outOfRange: boolean, bounces: Array}} The path, where blocked, if target is out of range, and where a bolt bounced (passThrough only)
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
        let bounces = [];
        let displayPath = [];

        if (options.passThrough) {
            // Bolts pass through conductive actors and bounce off reflective ones
            const trace = traceBoltPath(
                startX, startY, endX, endY,
                (x, y) => this.engine.entityManager?.getSolidActorAt(x, y),
                { maxRange }
            );
            ({ blockedAt, outOfRange, bounces } = trace);
            displayPath = trace.path;
        }

        for (let i = 1; i < fullPath.length && !options.passThrough; i++) {
            const point = fullPath[i];

            // Check if we've exceeded max range
            if (maxRange !== null && i > maxRange) {
                outOfRange = true;
                break;
            }

            // Check for solid actors that would block the path
            const actor = this.engine.entityManager?.getSolidActorAt(point.x, point.y);
            if (actor) {
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
            outOfRange: outOfRange,
            bounces: bounces
        };
    },

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
    },

    /**
     * Infrastructure overlay: tinted box-drawing lines connecting each machine's
     * hub (a switch/lever) to the targets (gates/doors/pedestals) it controls,
     * grouped by shared machine_id. Normally hidden; revealed by magic mapping
     * (Scroll of Magic Mapping) on this floor, or by the debug toggle.
     * Modeled on the hideLinePath()/linePathSprites overlay lifecycle above.
     *
     * Routing is L-shaped (horizontal then vertical) and ignores walls by design —
     * the lines are diagrammatic, not physical conduit. Proximity-linked machines
     * (no shared machine_id) are intentionally not drawn; the feature is scoped to
     * "same machine id" per docs/IDEAS.md.
     */
    /**
     * Whether this floor has any machine links the overlay could draw — a switch with a
     * machine_id that at least one other actor shares. Lets the magic-mapping message
     * avoid promising "hidden connections" on a floor that has none.
     * @returns {boolean}
     */
    hasInfrastructureLinks() {
        const em = this.engine.entityManager;
        if (!em) return false;

        for (const hub of em.actors) {
            if (hub.isDead || !this._isInfrastructureHub(hub)) continue;
            const machineId = hub.getAttribute('machine_id');
            if (!machineId) continue;
            if (em.actors.some(a => a !== hub && !a.isDead &&
                a.getAttribute('machine_id') === machineId)) {
                return true;
            }
        }
        return false;
    },

    /**
     * A hub is a switch/lever/plate: it drives switch_effects (or is switchable).
     * Shared by the overlay renderer and hasInfrastructureLinks so they can't drift.
     */
    _isInfrastructureHub(actor) {
        return actor.hasAttribute('switchable') || !!actor.data?.switch_effects;
    },

    renderInfrastructureLayer() {
        this.hideInfrastructureLayer();

        const em = this.engine.entityManager;
        if (!em) return;

        const tileWidth = globalVars.TILE_WIDTH;
        const tileHeight = globalVars.TILE_HEIGHT;

        // Group members already visited as a hub or target, so each machine draws once.
        const seen = new Set();

        for (const hub of em.actors) {
            if (hub.isDead || seen.has(hub)) continue;
            if (!this._isInfrastructureHub(hub)) continue;

            const machineId = hub.getAttribute('machine_id');
            if (!machineId) continue; // proximity-only groups are out of scope

            const targets = em.actors.filter(
                a => a !== hub && !a.isDead && a.getAttribute('machine_id') === machineId
            );
            if (targets.length === 0) continue;

            seen.add(hub);
            for (const t of targets) seen.add(t);

            const tint = (hub.tint !== undefined && hub.tint !== null) ? hub.tint : 0xFFFFFF;

            // Collect every cell each L-bend passes through, recording which of
            // up/down/left/right that cell connects to, so overlapping lines form
            // proper T/cross junctions rather than broken straights.
            const cells = new Map(); // "x,y" -> Set of 'up'|'down'|'left'|'right'
            for (const target of targets) {
                this._addInfrastructureLBend(cells, hub.x, hub.y, target.x, target.y);
            }

            // Node cells: the hub and each target sit on their actor's tile. Mark
            // them with a white bullet instead of a line glyph so the connection
            // endpoints read as nodes.
            const nodes = new Set([`${hub.x},${hub.y}`]);
            for (const target of targets) nodes.add(`${target.x},${target.y}`);

            for (const [key, dirs] of cells) {
                const [cx, cy] = key.split(',').map(Number);
                const tileName = nodes.has(key)
                    ? 'WHITE_BULLET'
                    : this._infrastructureGlyph(dirs);
                const tileIndex = this.engine.spriteLibrary.resolveTile(tileName);
                if (!tileIndex) continue;

                const texture = this.getTileTexture(
                    tileIndex.x * tileWidth,
                    tileIndex.y * tileHeight
                );
                const sprite = new PIXI.Sprite(texture);
                sprite.x = cx * tileWidth;
                sprite.y = cy * tileHeight;
                sprite.tint = tint;
                // Low zIndex in uiContainer so the wiring sits below UI windows
                // (matches the thread trail's placement in this container).
                sprite.zIndex = 2;

                this.uiContainer.addChild(sprite);
                this.infrastructureSprites.push(sprite);
            }
        }
    },

    /**
     * Walk an L-shaped path (horizontal leg first, then vertical) from (x0,y0) to
     * (x1,y1), recording per-cell connection directions into `cells`. Each step
     * marks both the current cell (toward the next) and the next cell (back toward
     * the current) so adjacent cells agree on their shared edge.
     */
    _addInfrastructureLBend(cells, x0, y0, x1, y1) {
        const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
        const mark = (x, y, dir) => {
            const key = `${x},${y}`;
            let set = cells.get(key);
            if (!set) { set = new Set(); cells.set(key, set); }
            if (dir) set.add(dir);
        };
        // Ensure endpoints exist even for a zero-length path (hub === target tile).
        mark(x0, y0, null);
        mark(x1, y1, null);

        let cx = x0, cy = y0;
        const stepTo = (nx, ny, dir) => {
            mark(cx, cy, dir);
            mark(nx, ny, opp[dir]);
            cx = nx; cy = ny;
        };

        // Horizontal leg
        while (cx !== x1) {
            const dir = cx < x1 ? 'right' : 'left';
            stepTo(cx + (cx < x1 ? 1 : -1), cy, dir);
        }
        // Vertical leg
        while (cy !== y1) {
            const dir = cy < y1 ? 'down' : 'up';
            stepTo(cx, cy + (cy < y1 ? 1 : -1), dir);
        }
    },

    /**
     * Pick the WHITE_BOX_* glyph for a cell given its set of connection directions.
     * Handles endpoints (1 dir), straights + corners (2), T-junctions (3), cross (4).
     * Corner names describe where the corner sits (BOTTOM_RIGHT = lines go up+left).
     * T names: <stub>_<bar> (UP_HORIZONTAL = horizontal bar with an upward stub).
     */
    _infrastructureGlyph(dirs) {
        const u = dirs.has('up'), d = dirs.has('down'), l = dirs.has('left'), r = dirs.has('right');
        const key = [u ? 'up' : '', d ? 'down' : '', l ? 'left' : '', r ? 'right' : '']
            .filter(Boolean).sort().join('-');

        const map = {
            // Cross
            'down-left-right-up': 'WHITE_BOX_VERTICAL_HORIZONTAL',
            // T-junctions (missing one side)
            'left-right-up':   'WHITE_BOX_UP_HORIZONTAL',    // horizontal bar + up stub (no down)
            'down-left-right': 'WHITE_BOX_DOWN_HORIZONTAL',  // horizontal bar + down stub (no up)
            'down-right-up':   'WHITE_BOX_RIGHT_VERTICAL',   // vertical bar + right stub (no left)
            'down-left-up':    'WHITE_BOX_LEFT_VERTICAL',    // vertical bar + left stub (no right)
            // Straights
            'down-up':    'WHITE_BOX_VERTICAL',
            'left-right': 'WHITE_BOX_HORIZONTAL',
            // Corners (named by corner position, connecting the two listed sides)
            'left-up':    'WHITE_BOX_BOTTOM_RIGHT',
            'right-up':   'WHITE_BOX_BOTTOM_LEFT',
            'down-left':  'WHITE_BOX_TOP_RIGHT',
            'down-right': 'WHITE_BOX_TOP_LEFT',
            // Endpoint stubs (single direction) — draw the straight along that axis
            'up':    'WHITE_BOX_VERTICAL',
            'down':  'WHITE_BOX_VERTICAL',
            'left':  'WHITE_BOX_HORIZONTAL',
            'right': 'WHITE_BOX_HORIZONTAL'
        };
        return map[key] || 'WHITE_BOX_HORIZONTAL';
    },

    /**
     * Remove the infrastructure overlay sprites (mirrors hideLinePath).
     */
    hideInfrastructureLayer() {
        if (this.infrastructureSprites) {
            for (const sprite of this.infrastructureSprites) {
                this.uiContainer.removeChild(sprite);
                sprite.destroy();
            }
        }
        this.infrastructureSprites = [];
    },

    /**
     * Drive the infrastructure layer's visibility each render refresh. Shown when this
     * floor has been magic-mapped (a lasting per-level reveal, so it comes back on
     * revisit) or the author debug toggle is on; hidden otherwise. Rebuilt every
     * refresh while visible so it self-heals if a gate opens/moves/dies mid-reveal.
     * Called from updateProximityTransparency (the single funnel both the dark and
     * bright render paths pass through).
     */
    updateInfrastructureVisibility() {
        const revealed = this.engine.mappedFloors?.has(this.engine.currentFloor) ?? false;
        const shouldShow = revealed || this.infrastructureDebugForced;

        if (shouldShow) {
            this.renderInfrastructureLayer();
        } else if (this.infrastructureSprites && this.infrastructureSprites.length) {
            this.hideInfrastructureLayer();
        }
    },

    /**
     * Rebuild the detect-magic markers: a red or blue eye over each detected item the
     * player can't currently see — lying on the floor, or carried by a creature that
     * is out of sight (Brogue's ITEM_DETECTED cells). A visible item draws itself, so
     * it gets no marker. Reads sprite visibility rather than lighting, so it runs
     * after the entity-lighting pass and works the same on dark and bright levels.
     * Called from updateProximityTransparency, the funnel both render paths share.
     */
    updateMagicDetectionMarkers() {
        if (this.magicDetectionSprites) {
            for (const sprite of this.magicDetectionSprites) {
                this.uiContainer.removeChild(sprite);
                sprite.destroy();
            }
        }
        this.magicDetectionSprites = [];

        const em = this.engine.entityManager;
        if (!em) return;

        // One marker per tile; a bad item outranks a good one beneath it.
        const markers = new Map();
        const mark = (x, y, polarity) => {
            if (this._spriteOffscreen(x, y)) return;
            const key = `${x},${y}`;
            if (markers.get(key)?.polarity !== 'bad') markers.set(key, { x, y, polarity });
        };

        for (const item of em.items) {
            if (item.sprite?.visible) continue;
            const polarity = item.getDetectedMagicPolarity?.();
            if (polarity) mark(item.x, item.y, polarity);
        }
        for (const actor of em.actors) {
            if (actor.isDead || actor.hasAttribute('controlled') || !actor.inventory?.length) continue;
            if (actor.spriteBase?.visible) continue;
            for (const carried of actor.inventory) {
                const polarity = carried.getDetectedMagicPolarity?.();
                if (polarity) mark(actor.x, actor.y, polarity);
            }
        }
        if (markers.size === 0) return;

        const tileIndex = this.engine.spriteLibrary.resolveTile(globalVars.MAGIC_POLARITY_TILE);
        if (!tileIndex) return;
        const tileWidth = globalVars.TILE_WIDTH;
        const tileHeight = globalVars.TILE_HEIGHT;
        const texture = this.getTileTexture(tileIndex.x * tileWidth, tileIndex.y * tileHeight);

        for (const { x, y, polarity } of markers.values()) {
            const sprite = new PIXI.Sprite(texture);
            sprite.x = x * tileWidth;
            sprite.y = y * tileHeight;
            sprite.tint = globalVars.MAGIC_POLARITY_TINTS[polarity];
            // Low zIndex in uiContainer, beside the infrastructure overlay, so UI
            // windows still draw over it.
            sprite.zIndex = 2;
            this.uiContainer.addChild(sprite);
            this.magicDetectionSprites.push(sprite);
        }
    },

    /**
     * Show a walk path highlight using A* pathfinding
     * Uses yellow-tinted overlay for path tiles
     * @param {number} startX - Starting tile X
     * @param {number} startY - Starting tile Y
     * @param {number} endX - Target tile X
     * @param {number} endY - Target tile Y
     * @returns {Array|null} The path array or null if no path exists
     */
    /**
     * Compute the walk path from (startX,startY) to (endX,endY) WITHOUT drawing
     * anything. Shares the exact passability rules the drawn preview uses (start &
     * end tiles exempt from solid-actor blocking, hazards avoided unless immune,
     * corner-cut rules), so callers that only need to test reachability or read a
     * path (e.g. Tab target-cycling) stay in sync with showWalkPath.
     * @returns {Array<{x:number,y:number}>|null} the path (incl. endpoints), or null if unreachable
     */
    computeWalkPath(startX, startY, endX, endY) {
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
            // Check for solid actors. A closed, unlocked door is routable — the
            // walker bumps it open and steps through — so it doesn't block a path.
            const solidActor = this.engine.entityManager?.getSolidActorAt(x, y);
            if (solidActor && !isOpenableDoorTile(solidActor)) {
                return false;
            }
            // Don't route through a teleporter (as an endpoint it's exempt above)
            if (this.engine.entityManager?.getActorsAt(x, y).some(a => !a.isDead && a.hasAttribute('teleporter'))) {
                return false;
            }
            // Check for hazardous actors - avoid unless the player is immune
            if (this.engine.entityManager?.player?.isHazardAt(x, y)) return false;
            // Check if tile is walkable (has floor)
            const floorTile = this.engine.mapManager?.floorMap[y]?.[x];
            return floorTile && floorTile.tileId > 0;
        };

        const hasFloor = (x, y) => {
            const tile = this.engine.mapManager?.floorMap[y]?.[x];
            return tile && tile.tileId > 0;
        };
        // Only solid walls block diagonal corner moves; voids don't (matches
        // Actor.tryMove so the drawn path lines up with where actors can walk).
        const isCornerWall = (x, y) => !!this.engine.entityManager?.blocksDiagonalAt(x, y);

        // Find path using A*
        const path = findPathAStar(startX, startY, endX, endY, isPassable, { topology: 8, hasFloor, isCornerBlocker: isCornerWall });

        return path.length === 0 ? null : path;
    },

    showWalkPath(startX, startY, endX, endY) {
        // Clear any existing walk path highlight
        this.hideWalkPath();

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;

        const path = this.computeWalkPath(startX, startY, endX, endY);
        if (!path) {
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
    },

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
    },
};
