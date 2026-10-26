/**
 * InterfaceManager: the in-canvas UI. This file holds the box system (create,
 * borders, overlays, grow animation), character/tile rendering, inline color
 * markup, text wrapping and text boxes. Its other method groups are installed
 * from the sibling modules in ui/.
 */

import { installMethods } from '../core/mixin.js';
import { globalVars } from '../globals.js';
import { UIAiming } from './aiming.js';
import { UIMenus } from './menus.js';
import { UIPanels } from './panels.js';
import { UISpells } from './spells.js';
import { UIThrowing } from './throwing.js';

// ============================================================================
// INTERFACE MANAGER
// ============================================================================
// Handles UI elements like boxes, menus, and overlays using the uiContainer

export const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Dead']);
export const THROW_DEFAULT_TARGETS = ['hostile', 'trap'];
export const SPELL_DEFAULT_TARGETS = ['hostile'];

export class InterfaceManager {
    constructor(engine) {
        this.engine = engine;
        this.boxes = new Map(); // Track active UI boxes by ID
        // Sidebar (actor/item panels) is rebuilt via innerHTML, which forces a DOM
        // reflow. Many callers (every entity add/remove, every move under darkness)
        // used to trigger that synchronously — on a gas-heavy dark level that meant
        // dozens of reflows per turn (~1s stall). Instead we mark the panels dirty
        // and flush at most once per animation frame.
        this._sidebarDirty = false;
        this._sidebarFlushScheduled = false;
        this._flushSidebarBound = () => this._flushSidebar();
        this.textBoxStack = []; // Stack of text box IDs in display order (top to bottom)
        this.maxTextBoxes = 4; // Maximum visible text boxes
        this.dismissOnMoveBoxes = new Set(); // Text boxes to dismiss on player move
        this.autoDisposeTimers = new Map(); // Timers for auto-disposing boxes

        // Default UI colors
        this.defaultFillColor = 0xFFFAFB;
        this.defaultBorderTint = 0x000000;
        this.defaultTextTint = 0x000000;
        this.warningFillColor = 0xEB8A90;
        this.inactiveTintColor = 0x999999;
        this.inactiveTintAlpha = 0.35;
        this.listStripeColor = 0xF0F0F0; // Subtle light gray for zebra-striping list rows
        this.statAccentColor = 0xC77A1F; // Amber accent for item stat sub-lines (charges, fuel, etc.)
        this.cursedColor = 0xA0408C; // Reddish-purple for the word "Cursed" on item names

        // Inventory interaction state
        this.inventoryMode = false; // True when player info is showing and accepting item selection
        this.currentPlayer = null; // Reference to player when inventory is open
        this.selectedItemIndex = null; // Currently selected item index (for action menu)

        // Confirmation dialog state
        this.confirmDialog = null; // { message, onConfirm, onCancel }

        // Throw aiming mode state
        this.throwAimingMode = false;
        this.throwItem = null; // Item being thrown

        // Spell aiming mode state (for targeted spells like fireball)
        this.spellAimingMode = false;
        this.spellItem = null; // Item casting the spell
        this.spellCaster = null; // Actor casting the spell

        // Spike direction picker state
        this.spikeDirectionMode = false;
        this.spikeItem = null;
        this.spikeCaster = null;
        this.spikeAdjacentDoors = null;

        // Dig direction picker state
        this.digDirectionMode = false;
        this.digItem = null;
        this.digCaster = null;
        this.digCandidates = null;

        // Throw menu mode state (T key menu)
        this.throwMenuMode = false;

        // Equipment menu state (E key menu)
        this.equipmentMenuMode = false;
        this.equipmentMenuPlayer = null;
        this.equipmentMenuItems = []; // List of equippable/wearable items with their indices

        // Use item menu state (quaff, read, etc.)
        this.useMenuMode = false;
        this.useMenuPlayer = null;
        this.useMenuItems = [];

        // Help window state
        this.helpWindowMode = false;

        // Info panel: which entity is being looked at, if any. Holds an Actor or an Item
        // — both routes share one box, so only one can be open at a time.
        this.actorInfoMode = false;
        this.actorInfoActor = null;
        // Pending hover-open timer, and the entity it will open for. Held so a pointer
        // that moves on before the delay elapses cancels the open entirely rather than
        // opening a panel for something it has already left.
        this.actorInfoHoverTimer = null;
        this.actorInfoHoverPending = null;

        // In-flight growBoxOpen intros, keyed by box id, so two boxes can animate at
        // once and each can be cancelled on its own.
        this.boxGrowTimers = new Map();
    }

    /**
     * How long the pointer must rest on an actor before its panel opens (ms). Sweeping
     * across a crowded room shouldn't flash a panel per monster.
     */
    static get HOVER_INFO_DELAY() { return 260; }

    /**
     * What the info panel says about anything a hallucinating player looks at. A
     * template, so the vocabulary is data: both word lists live in words.json.
     */
    static get HALLUCINATION_TEMPLATE() {
        return 'You cannot tell what this is. It looks like [a-an] '
            + '[adjectives.hallucinated_states] [hallucinated_name], ';
    }

    /** Default number of intro frames drawn before the box itself appears. */
    static get BOX_GROW_FRAMES() { return 2; }

    /** Default per-frame delay of the box-open intro (ms). */
    static get BOX_GROW_FRAME_DELAY() { return 40; }

    /**
     * The `steps` for an N-frame box-open intro: fractions of the way from the origin
     * tile to the box's final rect, one per frame.
     *
     * Spaced across (0, 1) but stopping short of 1.0, because the real box is
     * effectively the last frame — a step at 1.0 would draw an empty border exactly
     * where the box is about to appear, which reads as a stutter rather than growth.
     * So N frames divide the distance into N+1 parts, then everything is nudged
     * slightly later by BOX_GROW_BIAS: a frame that has already covered most of the
     * distance reads as the box arriving, where evenly-spaced frames read as it
     * dawdling. At the default N=2 this reproduces the hand-tuned [0.35, 0.7] exactly,
     * so changing `frames` is the only thing that changes the feel.
     *
     * @param {number} frames - How many intro frames
     * @returns {number[]}
     */
    static boxGrowSteps(frames) {
        const n = Math.max(0, Math.floor(frames));
        const bias = InterfaceManager.BOX_GROW_BIAS;
        return Array.from({ length: n }, (_, i) => ((i + 1) / (n + 1)) * bias);
    }

    /**
     * Multiplier on the evenly-spaced grow steps, biasing them later. 1.05 is what
     * turns 2 frames of [0.333, 0.667] into the [0.35, 0.7] that was tuned by eye.
     */
    static get BOX_GROW_BIAS() { return 1.05; }

    get container() {
        return this.engine.renderer?.uiContainer;
    }

    getVisibleArea() {
        const e = this.engine;
        if (e.viewportEnabled) {
            return {
                width: e.viewportWidth,
                height: e.viewportHeight,
                originX: e.sectionOriginX,
                originY: e.sectionOriginY
            };
        }
        return {
            width: e.mapManager?.width || 30,
            height: e.mapManager?.height || 20,
            originX: 0,
            originY: 0
        };
    }

    /**
     * A box position inside the viewport that doesn't sit on top of the player.
     *
     * @param {number} boxWidth
     * @param {number} boxHeight
     * @param {Object} [options]
     * @param {number[]} [options.preferX] - Columns to try before the defaults
     * @param {number[]} [options.preferY] - Rows to try before the defaults
     * @param {{x:number,y:number}} [options.avoid] - A second tile to keep clear, on
     *   equal footing with the player. The hover panel passes the actor it describes:
     *   a box covering the thing you are pointing at is worse than no box.
     */
    placeBoxAwayFromPlayer(boxWidth, boxHeight, options = {}) {
        const vis = this.getVisibleArea();
        const player = this.engine.entityManager?.player;
        const avoid = options?.avoid || null;

        const minX = vis.originX;
        const minY = vis.originY;
        // Inset one tile from the far edge so the frame isn't clipped. Math.max keeps
        // this sane when the box is bigger than the viewport.
        const maxX = Math.max(minX, vis.originX + vis.width - boxWidth - 1);
        const maxY = Math.max(minY, vis.originY + vis.height - boxHeight - 1);

        const centerX = Math.max(minX, vis.originX + Math.floor((vis.width - boxWidth) / 2));
        const centerY = Math.max(minY, vis.originY + Math.floor((vis.height - boxHeight) / 2));

        // With no player, an `avoid` tile still deserves dodging — otherwise centered.
        const anchor = player || avoid;
        if (!anchor) return { x: centerX, y: centerY };

        const inUpperHalf = anchor.y < vis.originY + vis.height / 2;
        const highY = minY + 1;
        const lowY = maxY;

        const ys = [
            ...(options?.preferY || []),
            inUpperHalf ? lowY : highY,   // the half the player isn't in
            inUpperHalf ? highY : lowY,   // the other one, if that failed
            // Flush to the edge, no margin. Last resort for a tall box, where this is
            // sometimes the only row that clears the player.
            minY, maxY,
        ];
        const xs = [
            ...(options?.preferX || []),
            centerX,                      // keep modals centered when we can
            maxX, minX,
            anchor.x + 1,                 // columns that just clear the anchor
            anchor.x - boxWidth,
        ];

        // Drop out-of-range candidates rather than clamping them — clamping folds
        // distinct options onto the same edge, discarding the escapes we built.
        const inY = ys.filter(v => v >= minY && v <= maxY);
        const inX = xs.filter(v => v >= minX && v <= maxX);

        const coversPoint = (bx, by, p) =>
            p.x >= bx && p.x < bx + boxWidth &&
            p.y >= by && p.y < by + boxHeight;
        // A tall actor's head sits a tile above its base, so clear that row too.
        const points = [player, avoid].filter(Boolean).flatMap(p =>
            p.height === 2 ? [p, { x: p.x, y: p.y - 1 }] : [p]);
        const covers = (bx, by) => points.some(p => coversPoint(bx, by, p));

        for (const cy of inY) {
            for (const cx of inX) {
                if (!covers(cx, cy)) return { x: cx, y: cy };
            }
        }

        // Nothing clears the player: the box is too big. Keep the preferred position.
        return {
            x: Math.max(minX, Math.min(inX[0] ?? centerX, maxX)),
            y: Math.max(minY, Math.min(inY[0] ?? centerY, maxY)),
        };
    }

    get spriteLibrary() {
        return this.engine.spriteLibrary;
    }

    get tileset() {
        return PIXI.Loader.shared.resources.tiles;
    }

    /**
     * Create a UI box with border and solid background
     * @param {string} id - Unique identifier for this box
     * @param {number} x - X position in tiles
     * @param {number} y - Y position in tiles
     * @param {number} width - Width in tiles
     * @param {number} height - Height in tiles
     * @param {object} options - Optional settings (fillColor, borderTint)
     * @returns {PIXI.Container} The box container
     */
    createBox(id, x, y, width, height, options = {}) {
        if (!this.container) {
            console.error('UI container not available');
            return null;
        }

        // Remove existing box with same ID
        if (this.boxes.has(id)) {
            this.removeBox(id);
        }

        const fillColor = options.fillColor ?? this.defaultFillColor;
        const borderTint = options.borderTint ?? this.defaultBorderTint;

        // Create container for this box
        const boxContainer = new PIXI.Container();
        boxContainer.x = x * globalVars.TILE_WIDTH;
        boxContainer.y = y * globalVars.TILE_HEIGHT;
        boxContainer.zIndex = 10; // Above thread trails (zIndex 1-2) but below projectiles (100)

        // Create solid fill background
        const fill = new PIXI.Graphics();
        fill.beginFill(fillColor);
        fill.drawRect(0, 0, width * globalVars.TILE_WIDTH, height * globalVars.TILE_HEIGHT);
        fill.endFill();
        boxContainer.addChild(fill);

        // Draw border tiles
        this.drawBoxBorder(boxContainer, width, height, borderTint);

        this.container.addChild(boxContainer);
        this.boxes.set(id, boxContainer);

        // Store box geometry in tile coords for click hit-testing
        boxContainer._boxX = x;
        boxContainer._boxY = y;
        boxContainer._boxWidth = width;
        boxContainer._boxHeight = height;

        return boxContainer;
    }

    /**
     * Draw box border using box-drawing characters
     */
    drawBoxBorder(container, width, height, tint) {
        const tiles = {
            topLeft: this.spriteLibrary.getTileByName('BOX_TOP_LEFT'),
            topRight: this.spriteLibrary.getTileByName('BOX_TOP_RIGHT'),
            bottomLeft: this.spriteLibrary.getTileByName('BOX_BOTTOM_LEFT'),
            bottomRight: this.spriteLibrary.getTileByName('BOX_BOTTOM_RIGHT'),
            horizontal: this.spriteLibrary.getTileByName('BOX_HORIZONTAL'),
            vertical: this.spriteLibrary.getTileByName('BOX_VERTICAL')
        };

        // Top-left corner
        this.addBorderTile(container, tiles.topLeft, 0, 0, tint);

        // Top-right corner
        this.addBorderTile(container, tiles.topRight, width - 1, 0, tint);

        // Bottom-left corner
        this.addBorderTile(container, tiles.bottomLeft, 0, height - 1, tint);

        // Bottom-right corner
        this.addBorderTile(container, tiles.bottomRight, width - 1, height - 1, tint);

        // Top and bottom edges
        for (let i = 1; i < width - 1; i++) {
            this.addBorderTile(container, tiles.horizontal, i, 0, tint);
            this.addBorderTile(container, tiles.horizontal, i, height - 1, tint);
        }

        // Left and right edges
        for (let i = 1; i < height - 1; i++) {
            this.addBorderTile(container, tiles.vertical, 0, i, tint);
            this.addBorderTile(container, tiles.vertical, width - 1, i, tint);
        }
    }

    /**
     * Add a single border tile sprite
     */
    addBorderTile(container, tileCoords, tileX, tileY, tint) {
        if (!tileCoords || !this.tileset) return;

        const rect = new PIXI.Rectangle(
            tileCoords.x * globalVars.TILE_WIDTH,
            tileCoords.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );

        const texture = new PIXI.Texture(this.tileset.texture.baseTexture, rect);
        const sprite = new PIXI.Sprite(texture);

        sprite.x = tileX * globalVars.TILE_WIDTH;
        sprite.y = tileY * globalVars.TILE_HEIGHT;
        sprite.tint = tint;

        container.addChild(sprite);
    }

    /**
     * Remove a UI box by ID
     * @param {string} id - Box identifier
     */
    removeBox(id) {
        const box = this.boxes.get(id);
        if (box) {
            this.container.removeChild(box);
            box.destroy({ children: true });
            this.boxes.delete(id);
        }
    }

    /**
     * Apply a semi-transparent grey overlay to a box to indicate it is inactive/backgrounded.
     * @param {string} id - Box identifier
     */
    applyInactiveOverlay(id) {
        const box = this.boxes.get(id);
        if (!box || box._inactiveOverlay) return; // Already has overlay or doesn't exist

        const overlay = new PIXI.Graphics();
        overlay.beginFill(this.inactiveTintColor, this.inactiveTintAlpha);
        overlay.drawRect(0, 0, box._boxWidth * globalVars.TILE_WIDTH, box._boxHeight * globalVars.TILE_HEIGHT);
        overlay.endFill();
        box.addChild(overlay);
        box._inactiveOverlay = overlay;
    }

    /**
     * Remove the inactive overlay from a box.
     * @param {string} id - Box identifier
     */
    removeInactiveOverlay(id) {
        const box = this.boxes.get(id);
        if (!box || !box._inactiveOverlay) return;

        box.removeChild(box._inactiveOverlay);
        box._inactiveOverlay.destroy();
        box._inactiveOverlay = null;
    }

    /**
     * Zebra-stripe a list: tint every other item row's background light gray.
     * @param {PIXI.Container} boxContainer - The box to draw stripes into
     * @param {Array<{lineIndex:number, span?:number}>} rows - Ordered item rows. span defaults
     *   to 1; pass 2 to also cover an item's stat sub-line. Stripes the ODD ordinals
     *   (rows[1], rows[3], ...) so the first item keeps the default fill.
     * @param {number} contentWidth - Interior content width in tiles
     * @param {number} padding - Box padding in tiles
     * Must be called AFTER createBox and BEFORE text/item-tile sprites so glyphs render on top.
     */
    drawListStripes(boxContainer, rows, contentWidth, padding) {
        if (!boxContainer || !rows || rows.length === 0) return;
        const TW = globalVars.TILE_WIDTH, TH = globalVars.TILE_HEIGHT;
        const stripeX = (padding + 1) * TW; // align with textStartX (inside border+pad)
        const stripeW = contentWidth * TW;  // span the content columns
        const g = new PIXI.Graphics();
        g.beginFill(this.listStripeColor);
        for (let ord = 1; ord < rows.length; ord += 2) {
            const { lineIndex, span = 1 } = rows[ord];
            const y = (padding + 1) * TH + lineIndex * TH;
            g.drawRect(stripeX, y, stripeW, span * TH);
        }
        g.endFill();
        boxContainer.addChild(g);
    }

    /**
     * Update overlays on all boxes so only the active (topmost interactive) box is clear,
     * and all other visible boxes are dimmed with an inactive overlay.
     */
    updateBoxOverlays() {
        // Determine the active box ID based on the current UI mode priority
        let activeBoxId = null;
        if (this.engine.inputManager?.hasTextInput()) {
            activeBoxId = 'text_input';
        } else if (this.helpWindowMode) {
            activeBoxId = 'help_window';
        } else if (this.actorInfoMode) {
            activeBoxId = 'actor_info';
        } else if (this.confirmDialog) {
            activeBoxId = 'confirm_dialog';
        } else if (this.identifyMode) {
            activeBoxId = 'identify_picker';
        } else if (this.enchantMode) {
            activeBoxId = 'enchant_picker';
        } else if (this.throwMenuMode) {
            activeBoxId = 'throw_item_menu';
        } else if (this.useMenuMode) {
            activeBoxId = 'use_item_menu';
        } else if (this.equipmentMenuMode) {
            activeBoxId = 'equipment_menu';
        } else if (this.selectedItemIndex !== null && this.inventoryMode) {
            activeBoxId = 'item_action_menu';
        } else if (this.inventoryMode) {
            activeBoxId = 'player_info';
        }
        // throwAimingMode and spellAimingMode are map-targeting modes with no dedicated box

        for (const [id, box] of this.boxes) {
            if (!box.visible) continue;
            if (!activeBoxId || id === activeBoxId) {
                // No active interactive box, or this IS the active box — show normally
                this.removeInactiveOverlay(id);
            } else {
                this.applyInactiveOverlay(id);
            }
        }
    }

    /**
     * Hide a box without destroying it
     * @param {string} id - Box identifier
     */
    hideBox(id) {
        const box = this.boxes.get(id);
        if (box) {
            box.visible = false;
        }
    }

    /**
     * Show a hidden box
     * @param {string} id - Box identifier
     */
    showBox(id) {
        const box = this.boxes.get(id);
        if (box) {
            box.visible = true;
        }
    }

    /**
     * Get a box container by ID (for adding content)
     * @param {string} id - Box identifier
     * @returns {PIXI.Container|null}
     */
    getBox(id) {
        return this.boxes.get(id) || null;
    }

    /**
     * Remove all UI boxes
     */
    clear() {
        for (const [, box] of this.boxes) {
            this.container.removeChild(box);
            box.destroy({ children: true });
        }
        this.boxes.clear();
    }

    /**
     * Get the tile name for a character
     * @param {string} char - Single character
     * @returns {string|null} Tile name or null if not found
     */
    getTileNameForChar(char) {
        if (char === ' ') return 'SPACE';
        if (char === '!') return 'EXCLAMATION_MARK';
        if (char === '"') return 'QUOTATION_MARK';
        if (char === '#') return 'NUMBER_SIGN';
        if (char === '$') return 'DOLLAR_SIGN';
        if (char === '%') return 'PERCENT_SIGN';
        if (char === '&') return 'AMPERSAND';
        if (char === "'") return 'APOSTROPHE';
        if (char === '(') return 'LEFT_PARENTHESIS';
        if (char === ')') return 'RIGHT_PARENTHESIS';
        if (char === '*') return 'ASTERISK';
        if (char === '+') return 'PLUS_SIGN';
        if (char === ',') return 'COMMA';
        if (char === '-') return 'HYPHEN_MINUS';
        if (char === '.') return 'FULL_STOP';
        if (char === '/') return 'SOLIDUS';
        if (char === ':') return 'COLON';
        if (char === ';') return 'SEMICOLON';
        if (char === '<') return 'LESS_THAN_SIGN';
        if (char === '=') return 'EQUALS_SIGN';
        if (char === '>') return 'GREATER_THAN_SIGN';
        if (char === '?') return 'QUESTION_MARK';
        if (char === '@') return 'COMMERCIAL_AT';
        if (char === '[') return 'LEFT_SQUARE_BRACKET';
        if (char === '\\') return 'REVERSE_SOLIDUS';
        if (char === ']') return 'RIGHT_SQUARE_BRACKET';
        if (char === '^') return 'CIRCUMFLEX_ACCENT';
        if (char === '_') return 'LOW_LINE';

        // Digits
        if (char >= '0' && char <= '9') {
            return `DIGIT_${char}`;
        }

        // Uppercase letters
        if (char >= 'A' && char <= 'Z') {
            return `LATIN_CAPITAL_LETTER_${char}`;
        }

        // Lowercase letters
        if (char >= 'a' && char <= 'z') {
            return `LATIN_SMALL_LETTER_${char.toUpperCase()}`;
        }

        // Accented Latin characters present in the spritesheet
        const accentedMap = {
            'č': 'LATIN_SMALL_LETTER_C_WITH_CARON',
            'é': 'LATIN_SMALL_LETTER_E_WITH_ACUTE',
            'ó': 'LATIN_SMALL_LETTER_O_WITH_ACUTE',
            'í': 'LATIN_SMALL_LETTER_I_WITH_ACUTE',
            'š': 'LATIN_SMALL_LETTER_S_WITH_CARON',
            'Á': 'LATIN_CAPITAL_LETTER_A_WITH_ACUTE',
            'ř': 'LATIN_SMALL_LETTER_R_WITH_CARON',
            'ů': 'LATIN_SMALL_LETTER_U_WITH_RING_ABOVE',
        };
        if (accentedMap[char]) return accentedMap[char];

        // Deseret characters (supplementary plane — codePointAt decodes surrogate pairs)
        const cp = char.codePointAt(0);
        if (cp === 0x1041D) return 'DESERET_CAPITAL_LETTER_ES';
        if (cp === 0x10444) return 'DESERET_SMALL_LETTER_THEE';
        if (cp === 0x2C00) return 'GLAGOLITIC_CAPITAL_LETTER_AZU';
        if (cp === 0x2C01) return 'GLAGOLITIC_CAPITAL_LETTER_BUKY';
        if (cp === 0x2C02) return 'GLAGOLITIC_CAPITAL_LETTER_VEDE';
        if (cp === 0x10340) return 'GOTHIC_LETTER_PAIRTHRA';
        return null;
    }

    getWhiteTileNameForChar(char) {
        if (char === ' ') return 'SPACE';
        const special = {
            '!': 'WHITE_EXCLAMATION_MARK',
            '"': 'WHITE_QUOTATION_MARK',
            '#': 'WHITE_NUMBER_SIGN',
            '$': 'WHITE_DOLLAR_SIGN',
            '%': 'WHITE_PERCENT_SIGN',
            '&': 'WHITE_AMPERSAND',
            "'": 'WHITE_APOSTROPHE',
            '(': 'WHITE_LEFT_PARENTHESIS',
            ')': 'WHITE_RIGHT_PARENTHESIS',
            '*': 'WHITE_ASTERISK',
            '+': 'WHITE_PLUS_SIGN',
            ',': 'WHITE_COMMA',
            '-': 'WHITE_HYPHEN_MINUS',
            '.': 'WHITE_FULL_STOP',
            '/': 'WHITE_SOLIDUS',
            ':': 'WHITE_COLON',
            ';': 'WHITE_SEMICOLON',
            '<': 'WHITE_LESS_THAN_SIGN',
            '=': 'WHITE_EQUALS_SIGN',
            '>': 'WHITE_GREATER_THAN_SIGN',
            '?': 'WHITE_QUESTION_MARK',
            '@': 'WHITE_COMMERCIAL_AT',
            '[': 'WHITE_LEFT_SQUARE_BRACKET',
            '\\': 'WHITE_REVERSE_SOLIDUS',
            ']': 'WHITE_RIGHT_SQUARE_BRACKET',
            '^': 'WHITE_CIRCUMFLEX_ACCENT',
            '_': 'WHITE_LOW_LINE',
        };
        if (special[char]) return special[char];
        if (char >= '0' && char <= '9') return `WHITE_DIGIT_${char}`;
        if (char >= 'A' && char <= 'Z') return `WHITE_LATIN_CAPITAL_LETTER_${char}`;
        if (char >= 'a' && char <= 'z') return `WHITE_LATIN_SMALL_LETTER_${char.toUpperCase()}`;
        return null;
    }

    /**
     * Split a string into an array of visual characters, correctly handling
     * Unicode supplementary-plane characters (surrogate pairs).
     * Use this instead of str[i] index access in render loops.
     */
    splitChars(str) { return [...str]; }

    /**
     * Check if a stat should be rendered as a thermometer bar
     * @param {string} key - Stat key name
     * @returns {boolean} True if stat should use thermometer display
     */
    isThermometerStat(key) {
        return key === 'health' || key === 'nutrition';
    }

    /**
     * Render a thermometer bar using FULL_BLOCK for fill and LIGHT_SHADE for background
     * Bar is normalized to a fixed width regardless of max value
     * @param {PIXI.Container} container - Container to add sprites to
     * @param {number} current - Current stat value
     * @param {number} max - Maximum stat value
     * @param {number} x - X position in pixels
     * @param {number} y - Y position in pixels
     * @param {number} [fillColor] - Optional hex tint for filled tiles. When set, filled tiles
     *   use the tintable WHITE_FULL_BLOCK glyph so the fill renders in color instead of black.
     */
    renderThermometerBar(container, current, max, x, y, fillColor = null) {
        // Fixed width for all thermometer bars (normalized)
        const totalTiles = 10;
        const fillPercentage = max > 0 ? current / max : 0;
        const filledTiles = Math.round(fillPercentage * totalTiles);

        // Use the tintable white block for colored fills; the plain black block otherwise.
        const fullBlockName = fillColor !== null ? 'WHITE_FULL_BLOCK' : 'FULL_BLOCK';
        const fullBlockCoords = this.spriteLibrary.getTileByName(fullBlockName);
        const lightShadeCoords = this.spriteLibrary.getTileByName('LIGHT_SHADE');

        if (!fullBlockCoords || !lightShadeCoords || !this.tileset) return;

        for (let i = 0; i < totalTiles; i++) {
            const filled = i < filledTiles;
            const tileCoords = filled ? fullBlockCoords : lightShadeCoords;

            const rect = new PIXI.Rectangle(
                tileCoords.x * globalVars.TILE_WIDTH,
                tileCoords.y * globalVars.TILE_HEIGHT,
                globalVars.TILE_WIDTH,
                globalVars.TILE_HEIGHT
            );

            const texture = new PIXI.Texture(this.tileset.texture.baseTexture, rect);
            const sprite = new PIXI.Sprite(texture);

            sprite.x = x + (i * globalVars.TILE_WIDTH);
            sprite.y = y;

            // Tint colored fills (filled tiles only — background shade stays neutral)
            if (filled && fillColor !== null) {
                sprite.tint = fillColor;
            }

            container.addChild(sprite);
        }
    }

    /**
     * Render an item's tile sprite at a position
     * @param {PIXI.Container} container - Container to add sprite to
     * @param {Item} item - The item to render
     * @param {number} x - X position in pixels
     * @param {number} y - Y position in pixels
     */
    renderItemTile(container, item, x, y) {
        if (!item.tileIndex || !this.tileset) return;

        const rect = new PIXI.Rectangle(
            item.tileIndex.x * globalVars.TILE_WIDTH,
            item.tileIndex.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );

        const texture = new PIXI.Texture(this.tileset.texture.baseTexture, rect);
        const sprite = new PIXI.Sprite(texture);

        sprite.x = x;
        sprite.y = y;

        // Apply item tint if present — unless the viewer is blind, when the tint
        // would give away the color the name now hides
        if (item.tint !== undefined && item.tint !== null && !item.getBlindName?.()) {
            sprite.tint = item.tint;
        }

        // Apply horizontal/vertical flip using anchor at center
        if (item.flipH || item.flipV) {
            sprite.anchor.set(0.5, 0.5);
            sprite.x += globalVars.TILE_WIDTH / 2;
            sprite.y += globalVars.TILE_HEIGHT / 2;
            sprite.scale.x = item.flipH ? -1 : 1;
            sprite.scale.y = item.flipV ? -1 : 1;
        }

        container.addChild(sprite);
    }

    /**
     * Draw the detect-magic eye for an item — blue for good magic, red for bad —
     * if magic has been detected on it (Item.getDetectedMagicPolarity). Inventory
     * lists draw it in the blank column just left of the item's tile.
     * @param {PIXI.Container} container - Container to add sprite to
     * @param {Item} item - The item whose polarity to show
     * @param {number} x - X position in pixels
     * @param {number} y - Y position in pixels
     */
    renderMagicPolarityIcon(container, item, x, y) {
        const polarity = item.getDetectedMagicPolarity?.();
        if (!polarity || !this.tileset) return;
        const tileCoords = this.spriteLibrary.getTileByName(globalVars.MAGIC_POLARITY_TILE);
        if (!tileCoords) return;

        const rect = new PIXI.Rectangle(
            tileCoords.x * globalVars.TILE_WIDTH,
            tileCoords.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        const sprite = new PIXI.Sprite(new PIXI.Texture(this.tileset.texture.baseTexture, rect));
        sprite.x = x;
        sprite.y = y;
        sprite.tint = globalVars.MAGIC_POLARITY_TINTS[polarity];
        container.addChild(sprite);
    }

    /**
     * Create a text sprite for a single character
     * @param {string} char - Single character
     * @param {number} x - X position in pixels
     * @param {number} y - Y position in pixels
     * @param {number} tint - Color tint
     * @returns {PIXI.Sprite|null}
     */
    createCharSprite(char, x, y, tint = 0x000000, white = false) {
        const tileName = white ? this.getWhiteTileNameForChar(char) : this.getTileNameForChar(char);
        if (!tileName) return null;

        const tileCoords = this.spriteLibrary.getTileByName(tileName);
        if (!tileCoords || !this.tileset) return null;

        const rect = new PIXI.Rectangle(
            tileCoords.x * globalVars.TILE_WIDTH,
            tileCoords.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );

        const texture = new PIXI.Texture(this.tileset.texture.baseTexture, rect);
        const sprite = new PIXI.Sprite(texture);

        sprite.x = x;
        sprite.y = y;
        sprite.tint = tint;

        return sprite;
    }

    // ------------------------------------------------------------------
    // Inline color markup
    //
    // Interface text may carry simple inline color spans of the form
    //   [c=#RRGGBB]colored text[/c]
    // so a single rendered line can mix colors (e.g. a reddish-purple
    // "Cursed" inside an otherwise black item name). Spans do not nest.
    //
    // Use markup() to wrap a substring, stripMarkup() wherever a VISIBLE
    // length is needed (box-width math, wrapText, truncateText), and
    // renderTextLine() to draw a (possibly marked-up) line — it parses
    // the markup and colors each character accordingly.
    // ------------------------------------------------------------------

    /** Wrap `text` in a color span. color is a hex int (e.g. 0xA0408C). */
    markup(text, color) {
        const hex = color.toString(16).padStart(6, '0');
        return `[c=#${hex}]${text}[/c]`;
    }

    /**
     * Add color markup to an item display name for list rendering. Currently colors a
     * leading "Cursed" reddish-purple. Apply AFTER truncation so the markup tokens are
     * never split. getDisplayName() stays plain text (it's also used in message-log text
     * that doesn't parse markup); coloring lives here in the interface layer.
     * @param {string} name - A (possibly truncated) plain item display name
     * @returns {string} The name with any leading "Cursed" wrapped in color markup
     */
    colorizeItemName(name) {
        if (typeof name === 'string' && name.startsWith('Cursed')) {
            return this.markup('Cursed', this.cursedColor) + name.slice('Cursed'.length);
        }
        return name;
    }

    /** Remove color markup tokens, returning only the visible text. */
    stripMarkup(str) {
        if (typeof str !== 'string' || str.indexOf('[c=') === -1) return str;
        return str.replace(/\[c=#[0-9a-fA-F]{6}\]/g, '').replace(/\[\/c\]/g, '');
    }

    /**
     * Parse a line into visible characters plus a per-character color array.
     * @param {string} line - Text, optionally containing [c=#RRGGBB]...[/c] spans
     * @param {number} baseColor - Color for text outside any span
     * @returns {{chars: string[], colors: number[]}} parallel arrays of visible chars/colors
     */
    parseMarkup(line, baseColor) {
        if (typeof line !== 'string' || line.indexOf('[c=') === -1) {
            const chars = this.splitChars(line);
            return { chars, colors: chars.map(() => baseColor) };
        }
        const chars = [];
        const colors = [];
        const tokenRe = /\[c=#([0-9a-fA-F]{6})\]|\[\/c\]/g;
        let cursor = 0, current = baseColor, m;
        const pushRange = (from, to, color) => {
            for (const ch of this.splitChars(line.slice(from, to))) {
                chars.push(ch);
                colors.push(color);
            }
        };
        while ((m = tokenRe.exec(line)) !== null) {
            pushRange(cursor, m.index, current);
            current = m[1] !== undefined ? parseInt(m[1], 16) : baseColor;
            cursor = tokenRe.lastIndex;
        }
        pushRange(cursor, line.length, current);
        return { chars, colors };
    }

    /**
     * Render one line of text at (x, y), honoring inline color markup.
     * Characters in a non-default color use the tintable WHITE_* glyph variant.
     * @param {PIXI.Container} container - Container to add char sprites to
     * @param {string} line - The (possibly marked-up) line
     * @param {number} startX - Pixel x of the first character
     * @param {number} y - Pixel y of the line
     * @param {number} [baseColor] - Color for unmarked text (defaults to black)
     * @param {boolean} [baseWhite] - Render unmarked text via the white glyph variant
     *   (used when the whole line is already an accent color, e.g. amber stat lines)
     */
    renderTextLine(container, line, startX, y, baseColor = this.defaultTextTint, baseWhite = false) {
        const { chars, colors } = this.parseMarkup(line, baseColor);
        for (let i = 0; i < chars.length; i++) {
            const color = colors[i];
            // A colored glyph (anything not the plain black default) must use the
            // tintable white variant so the tint shows; honor baseWhite otherwise.
            const white = baseWhite || color !== this.defaultTextTint;
            const sprite = this.createCharSprite(chars[i], startX + i * globalVars.TILE_WIDTH, y, color, white);
            if (sprite) container.addChild(sprite);
        }
    }

    /**
     * Join phrases as English prose: "a", "a and b", "a, b and c". Used wherever the
     * panels turn a computed list into a sentence.
     * @param {string[]} parts
     * @returns {string}
     */
    joinProse(parts) {
        if (parts.length <= 1) return parts[0] || '';
        return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    }

    /**
     * Word-wrap text to fit within a maximum width
     * @param {string} text - Text to wrap
     * @param {number} maxWidth - Maximum width in characters
     * @returns {string[]} Array of lines
     */
    wrapText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        // Track visible length separately so inline color markup doesn't skew wrapping.
        let currentLen = 0;

        for (const word of words) {
            const wordLen = this.stripMarkup(word).length;
            if (currentLine.length === 0) {
                currentLine = word;
                currentLen = wordLen;
            } else if (currentLen + 1 + wordLen <= maxWidth) {
                currentLine += ' ' + word;
                currentLen += 1 + wordLen;
            } else {
                lines.push(currentLine);
                currentLine = word;
                currentLen = wordLen;
            }
        }

        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        return lines;
    }

    /**
     * Display a text box with auto-sizing and word wrap, stacked from top
     * @param {string} id - Unique identifier for this text box
     * @param {string} text - Text message to display
     * @param {object} options - Optional settings
     * @param {number} options.maxWidth - Max width in tiles (default: map width - 4)
     * @param {number} options.padding - Padding inside box in tiles (default: 1)
     * @param {number} options.textTint - Text color (default: black)
     * @param {number} options.fillColor - Background color (default: white)
     * @param {number} options.borderTint - Border color (default: black)
     * @param {boolean} options.dismissOnMove - Remove box when player moves (default: false)
     * @param {{x:number,y:number}} [options.growFrom] - Tile to play the box-grow intro
     *   from, so a spoken line reads as coming out of the speaker. The box is created
     *   after the intro, so this returns null — callers needing the container must not
     *   pass it.
     * @returns {PIXI.Container|null} The text box container, or null when growFrom defers
     *   creation past the return
     */
    showTextBox(id, text, options = {}) {
        const vis = this.getVisibleArea();

        const padding = options.padding ?? 1;
        const maxContentWidth = (options.maxWidth ?? (vis.width - 4)) - (padding * 2) - 2; // -2 for borders
        const textTint = options.textTint ?? this.defaultTextTint;
        const fillColor = options.fillColor ?? this.defaultFillColor;
        const borderTint = options.borderTint ?? this.defaultBorderTint;
        const dismissOnMove = options.dismissOnMove ?? false;

        // If this box already exists, remove it from stack first
        const existingIndex = this.textBoxStack.indexOf(id);
        if (existingIndex !== -1) {
            this.textBoxStack.splice(existingIndex, 1);
            this.removeBox(id);
        }

        // Clear any existing timer for this id
        this.clearAutoDisposeTimer(id);

        // If at max capacity, remove the oldest box
        if (this.textBoxStack.length >= this.maxTextBoxes) {
            const oldestId = this.textBoxStack.shift();
            this.removeBox(oldestId);
        }

        // Wrap text and calculate dimensions
        const lines = this.wrapText(text, maxContentWidth);
        const contentWidth = Math.max(...lines.map(line => this.stripMarkup(line).length), 1);
        const contentHeight = lines.length;

        // Box dimensions (content + padding + borders)
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Offset of this box within the stack, and the stack's full height once it's
        // added. Text boxes stack downward and have to move as a group, so the dodge is
        // computed for the whole column — placing each box independently would scatter
        // them. Width is this box's own, since they're centered individually.
        const stackOffset = this.textBoxStackHeight();
        const { x, y: stackTop } = this.placeBoxAwayFromPlayer(
            boxWidth, stackOffset + boxHeight
        );
        const y = stackTop + stackOffset;

        const drawBox = () => {
            // Create the box
            const boxContainer = this.createBox(id, x, y, boxWidth, boxHeight, {
                fillColor,
                borderTint
            });

            if (!boxContainer) return null;

            // Store box height for stacking calculations
            boxContainer._boxHeight = boxHeight;

            // Add to stack
            this.textBoxStack.push(id);

            // Handle dismissOnMove option
            if (dismissOnMove) {
                // Check if there's a player-controlled actor
                const hasPlayer = this.engine.entityManager?.actors.some(
                    a => a.hasAttribute('controlled') && !a.isDead
                );

                if (hasPlayer) {
                    // Dismiss on next player move
                    this.dismissOnMoveBoxes.add(id);
                } else {
                    // No player - auto dispose after timer (3 seconds + 1 second per line)
                    const delay = 3000 + (lines.length * 1000);
                    const timer = setTimeout(() => {
                        this.removeTextBox(id);
                    }, delay);
                    this.autoDisposeTimers.set(id, timer);
                }
            }

            // Add text sprites
            const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
            const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
                this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY, textTint);
            }

            this.updateBoxOverlays();
            return boxContainer;
        };

        // A spoken line grows out of the speaker. The intro is drawn with this box's own
        // fill and border, so the frames read as this bubble opening rather than a
        // separate white flash.
        if (options.growFrom) {
            this.growBoxOpen({
                id, x, y, width: boxWidth, height: boxHeight,
                from: options.growFrom,
                // A growing box isn't in the stack yet, so its slot was computed without
                // it — a second line arriving mid-intro would land on the same row.
                // Restacking on arrival re-derives every position from the real stack.
                draw: () => { drawBox(); this.repositionTextBoxStack(); },
                boxOptions: { fillColor, borderTint },
            });
            return null;
        }

        return drawBox();
    }

    /**
     * Called when the player makes a move - dismisses relevant text boxes
     */
    onPlayerMove() {
        for (const id of [...this.dismissOnMoveBoxes]) {
            this.dismissOnMoveBoxes.delete(id);
            this.removeTextBox(id);
        }
    }

    /**
     * Clear an auto-dispose timer for a box
     */
    clearAutoDisposeTimer(id) {
        const timer = this.autoDisposeTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.autoDisposeTimers.delete(id);
        }
    }

    /**
     * Remove a text box and reposition remaining stacked boxes
     * @param {string} id - Text box identifier
     */
    removeTextBox(id) {
        const index = this.textBoxStack.indexOf(id);
        if (index !== -1) {
            this.textBoxStack.splice(index, 1);
            this.removeBox(id);
            this.repositionTextBoxStack();
        } else {
            // Not a stacked text box, just remove normally
            this.removeBox(id);
        }
        this.updateBoxOverlays();
    }

    /**
     * Combined height in tiles of the text boxes currently stacked.
     * @returns {number}
     */
    textBoxStackHeight() {
        let total = 0;
        for (const id of this.textBoxStack) {
            const box = this.boxes.get(id);
            if (box?._boxHeight) total += box._boxHeight;
        }
        return total;
    }

    /**
     * Reposition all text boxes in the stack to fill gaps
     */
    repositionTextBoxStack() {
        // Re-dodge the player for the shrunken stack: removing a box frees up room, and
        // the remaining ones may now fit somewhere that was too tight before. Widest box
        // wins, since they share a column.
        let widest = 1;
        for (const id of this.textBoxStack) {
            const box = this.boxes.get(id);
            if (box?._boxWidth > widest) widest = box._boxWidth;
        }
        const { y: stackTop } = this.placeBoxAwayFromPlayer(widest, this.textBoxStackHeight());

        let yPosition = stackTop;
        for (const id of this.textBoxStack) {
            const box = this.boxes.get(id);
            if (box) {
                box.y = yPosition * globalVars.TILE_HEIGHT;
                // Keep _boxY in step — click hit-testing reads it, so leaving it at the
                // old row makes the box unclickable where it now appears.
                box._boxY = yPosition;
                if (box._boxHeight) {
                    yPosition += box._boxHeight;
                }
            }
        }
    }

    /**
     * Clear all text boxes from the stack
     */
    clearTextBoxes() {
        for (const id of [...this.textBoxStack]) {
            this.removeBox(id);
        }
        this.textBoxStack = [];
    }

    /**
     * Capitalize first letter of a string
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Format a stat value for display. Stats are conceptually whole numbers, so this
     * is a last-resort guard: even if some effect leaves a fraction behind, the UI
     * shows a clean integer rather than "21.6" or "0.30000000000000004".
     * @param {number} value
     * @returns {string|number}
     */
    formatStatValue(value) {
        return typeof value === 'number' ? Math.round(value) : value;
    }

    /**
     * Truncate text to a maximum length, adding ellipsis if needed
     * @param {string} text - The text to truncate
     * @param {number} maxLength - Maximum length before truncation
     * @returns {string} Truncated text with ellipsis if needed
     */
    truncateText(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 1) + '~';
    }

    // ========================================================================
    // BOX OPEN ANIMATION
    // ========================================================================

    /**
     * Open a box with a brief "grows from a point" intro, then draw its contents.
     *
     * A few quick frames of an empty box border expanding from `from` to the box's
     * final rect, so a window reads as coming FROM the thing that caused it rather
     * than appearing from nowhere. The frames are drawn with the same `drawBoxBorder`
     * tiles as the real box, so it looks like the box drawing itself rather than a
     * separate effect.
     *
     * Generic on purpose — the actor info panel is the first caller, but a dialog
     * window growing from the speaker, or an item panel growing from its tile, is the
     * same animation with a different origin. Callers supply only the geometry, an
     * origin, and a `draw` callback; nothing here knows what the box contains.
     *
     * Keyed by `id`, so two boxes can animate at once without fighting, and re-opening
     * the same id cancels its own in-flight intro rather than interleaving frames.
     *
     * Deliberately short. At the default 2 frames × 40ms the whole intro is under a
     * tenth of a second, so it reads as responsiveness rather than lag; anything
     * slower makes the UI feel like it's negotiating. `frames` and `frameDelay` are
     * the knobs for trying other speeds — total intro time is about their product.
     *
     * @param {Object} spec
     * @param {string} spec.id - Box id, as passed to createBox. The intro's temporary
     *   frames use a derived id, so they can never collide with the real box.
     * @param {number} spec.x - Final box left, in tiles
     * @param {number} spec.y - Final box top, in tiles
     * @param {number} spec.width - Final box width, in tiles
     * @param {number} spec.height - Final box height, in tiles
     * @param {{x:number,y:number}} spec.from - Tile the box grows out of
     * @param {Function} spec.draw - Draws the finished box. Called exactly once, after
     *   the last frame — or immediately if the intro is skipped or cannot run.
     * @param {Function} [spec.abort] - Polled before each frame; returning true
     *   abandons the intro WITHOUT drawing. Lets a caller cancel on state that changed
     *   since the intro began (the actor panel passes "am I still the hovered actor?").
     * @param {number} [spec.frames] - How many intro frames to draw. More frames is a
     *   longer, smoother grow; `frames: 0` skips the intro and draws immediately. The
     *   two knobs to turn when tuning feel are this and `frameDelay` — total intro
     *   time is roughly `frames * frameDelay`.
     * @param {number} [spec.frameDelay] - ms per frame
     * @param {number[]} [spec.steps] - Explicit fractions of the way from `from` to the
     *   final rect, one per frame, overriding `frames`. For an intro that doesn't
     *   advance evenly — e.g. `[0.2, 0.4, 0.85]` to lunge at the end.
     * @param {Object} [spec.boxOptions] - Passed through to createBox, so the intro
     *   frames match a box with a non-default fill or border tint.
     */
    growBoxOpen(spec) {
        const {
            id, x, y, width, height, from, draw, abort = null,
            frames = InterfaceManager.BOX_GROW_FRAMES,
            frameDelay = InterfaceManager.BOX_GROW_FRAME_DELAY,
            // An explicit `steps` wins; otherwise the frame count generates them.
            steps = InterfaceManager.boxGrowSteps(frames),
            boxOptions = {},
        } = spec;

        const growId = `${id}__grow`;
        this.cancelBoxGrow(id);

        // No origin to grow from, or a caller that opted out — just draw.
        if (!from || !steps?.length) { draw(); return; }

        let step = 0;

        const finish = (drawIt) => {
            this.removeBox(growId);
            this.boxGrowTimers.delete(id);
            if (drawIt) draw();
        };

        const frame = () => {
            if (abort && abort()) { finish(false); return; }
            if (step >= steps.length) { finish(true); return; }

            const t = steps[step++];
            const lerp = (a, b) => Math.round(a + (b - a) * t);

            // A 1-tile box is degenerate for drawBoxBorder (its corners would overlap),
            // so never go below 2x2.
            const fw = Math.max(2, lerp(1, width));
            const fh = Math.max(2, lerp(1, height));
            // Keep every frame on screen — one placed off-viewport would just flicker
            // at the edge instead of reading as growth.
            const vis = this.getVisibleArea();
            const fx = Math.max(vis.originX,
                Math.min(lerp(from.x, x), vis.originX + vis.width - fw));
            const fy = Math.max(vis.originY,
                Math.min(lerp(from.y, y), vis.originY + vis.height - fh));

            // createBox replaces a box of the same id, so the previous frame goes away
            // on its own.
            const container = this.createBox(growId, fx, fy, fw, fh, boxOptions);
            // Can't draw frames (no container yet) — skip straight to the real box
            // rather than dropping the open entirely.
            if (!container) { finish(true); return; }

            this.boxGrowTimers.set(id, setTimeout(frame, frameDelay));
        };

        frame();
    }

    /**
     * Abandon an in-flight grow intro and clear its frame, without drawing the box.
     * @param {string} id - The box id passed to growBoxOpen
     */
    cancelBoxGrow(id) {
        const timer = this.boxGrowTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.boxGrowTimers.delete(id);
        }
        this.removeBox(`${id}__grow`);
    }
}

installMethods(InterfaceManager, UIPanels, UIMenus, UIAiming, UIThrowing, UISpells);
