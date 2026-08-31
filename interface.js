// ============================================================================
// INTERFACE MANAGER
// ============================================================================
// Handles UI elements like boxes, menus, and overlays using the uiContainer

// Bare modifier keydowns, as reported by KeyboardEvent.key. Dialogs that treat an
// unrecognized key as a dismissal must skip these: pressing Shift to type an
// uppercase answer fires its own keydown first.
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Dead']);

// Default aim-target categories, used when an item declares no `target_filter`.
// Throwing includes traps so a thrown object can spring one from a safe distance;
// zapping is enemies-only, since most staffs and wands are offensive.
const THROW_DEFAULT_TARGETS = ['hostile', 'trap'];
const SPELL_DEFAULT_TARGETS = ['hostile'];

class InterfaceManager {
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
        if (this.helpWindowMode) {
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

        // Apply item tint if present
        if (item.tint !== undefined && item.tint !== null) {
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
     * Toggle the player info box (show if hidden, hide if shown)
     * @param {Actor} player - The player actor
     * @returns {boolean} True if box is now visible, false if hidden
     */
    togglePlayerInfo(player) {
        const infoBoxId = 'player_info';

        // If already showing, hide it (resets inventory mode)
        if (this.boxes.has(infoBoxId)) {
            this.hidePlayerInfo();
            return false;
        }

        // Show player info and enable inventory mode
        this.showPlayerInfo(player);
        return true;
    }

    /**
     * Show the player info box
     * @param {Actor} player - The player actor
     */
    showPlayerInfo(player) {
        if (!player) return;

        this.clearTargetingHighlights();

        const infoBoxId = 'player_info';

        // Remove existing if present
        if (this.boxes.has(infoBoxId)) {
            this.removeBox(infoBoxId);
        }

        // Check if HTML actors element exists - if so, skip canvas thermometers
        // since stats are already displayed in the HTML sidebar
        const hasHtmlActorsElement = document.getElementById('actors') !== null;

        // Gather stats, separating thermometer stats from regular stats
        const regularStats = [];
        const thermometerStats = []; // { key, current, max, lineIndex }
        if (player.stats) {
            for (const [key, value] of Object.entries(player.stats)) {
                if (this.isThermometerStat(key) && !hasHtmlActorsElement) {
                    // Get current and max values (handle both object and simple number formats)
                    const max = typeof value === 'object' ? value.max : value;
                    const current = typeof value === 'object' ? value.current : value;
                    // Skip thermometer stats with max <= 1 (1-hit death prototypes)
                    if (max > 1) {
                        thermometerStats.push({ key, current, max });
                    }
                } else if (!this.isThermometerStat(key)) {
                    // Regular stat - display as text
                    const displayValue = typeof value === 'object' ? value.current : value;
                    regularStats.push(`${this.capitalize(key)}: ${this.formatStatValue(displayValue)}`);
                }
                // When hasHtmlActorsElement is true, thermometer stats are skipped entirely
                // (they're shown in the HTML sidebar instead)
            }
        }

        // Gather inventory items with letter prefixes
        const inventoryItems = []; // { text, item, statLine }
        if (player.inventory && player.inventory.length > 0) {
            for (let i = 0; i < player.inventory.length; i++) {
                const item = player.inventory[i];
                const letter = String.fromCharCode(97 + i); // 'a', 'b', 'c', etc.
                // Use getDisplayName() for identification-aware display, truncated for UI
                let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                displayName = this.colorizeItemName(this.truncateText(displayName, 26));
                let itemText = `${letter})   ${displayName}`; // Two spaces: tile (offset 5) + blank gap (offset 6)
                if (item.count > 1) {
                    itemText += ` (×${item.count})`;
                }
                // Mark equipped items
                if (player.isItemEquipped(item)) {
                    itemText += item.hasAttribute('weapon') ? ' (equipped)' : ' (worn)';
                }

                // Check if item has displayable stats
                // Display is opt-in: charge_stat attribute (staffs) OR display_label on a stat (e.g. torches)
                let statLine = null;
                if (item.stats && Object.keys(item.stats).length > 0) {
                    const chargeStat = item.getAttribute('charge_stat');
                    if (chargeStat) {
                        const stat = item.stats[chargeStat];
                        if (stat && typeof stat === 'object' && stat.max !== undefined) {
                            const uses = item.getAttribute('uses') || 1;
                            const readyAt = stat.ready_at || Math.floor(stat.max / uses);
                            const availableCharges = Math.floor(stat.current / readyAt);
                            const isIdentified = item.identified !== false;
                            statLine = {
                                label: `      Charges: `,
                                chargeCount: isIdentified ? `${availableCharges}/${uses}` : `?/?`,
                                noBar: true,
                                current: stat.current,
                                max: stat.max
                            };
                        }
                    } else {
                        // Generic display: first stat with a display_label. Label +
                        // thermometer only, no numeric value (the raw value can be a
                        // float that renders a stray glyph in some decimals).
                        for (const stat of Object.values(item.stats)) {
                            if (stat && typeof stat === 'object' && stat.display_label && stat.max !== undefined) {
                                // A full, idle consumable has nothing to report: three
                                // fresh unlit torches showing three identical 100% bars
                                // is noise, and it's the common case now that they stack.
                                // Show the bar only once the item is being consumed
                                // (per_turn drains it) or has actually been used.
                                const draining = (stat.per_turn ?? 0) < 0;
                                const partial = stat.current < stat.max;
                                if (!draining && !partial) break;
                                statLine = {
                                    label: `      ${stat.display_label}: `,
                                    chargeCount: null,
                                    // Amber while it's actively burning down; gray for a
                                    // part-used item sitting idle, so "lit" reads at a
                                    // glance without checking the item name.
                                    dim: !draining,
                                    current: stat.current,
                                    max: stat.max
                                };
                                break;
                            }
                        }
                    }
                }

                inventoryItems.push({ text: itemText, item, statLine });
            }
        }

        // Build lines for the info box
        const lines = [];
        const thermometerLineIndices = [];
        lines.push(player.name);
        lines.push('');

        const hasStats = thermometerStats.length > 0 || regularStats.length > 0;
        if (hasStats) {
            lines.push('Stats:');
            // Add thermometer stats first
            for (const stat of thermometerStats) {
                const label = `  ${this.capitalize(stat.key)}: `;
                thermometerLineIndices.push({ lineIndex: lines.length, label, stat });
                lines.push(label); // Placeholder - bar will be rendered separately
            }
            // Add regular stats
            for (const stat of regularStats) {
                lines.push('  ' + stat);
            }
        }

        const inventoryLineIndices = [];
        const itemStatLineIndices = [];
        if (inventoryItems.length > 0) {
            if (hasStats) lines.push('');
            lines.push('Inventory:');
            for (const { text, item, statLine } of inventoryItems) {
                inventoryLineIndices.push({ lineIndex: lines.length, item });
                lines.push('  ' + text);

                // Add stat line below item if it has stats
                if (statLine) {
                    // Combine label and charge count for display text
                    const displayLabel = statLine.chargeCount
                        ? `${statLine.label}${statLine.chargeCount} `
                        : statLine.label;
                    itemStatLineIndices.push({
                        lineIndex: lines.length, label: displayLabel,
                        current: statLine.current, max: statLine.max,
                        noBar: !!statLine.noBar, dim: !!statLine.dim
                    });
                    lines.push(displayLabel); // "Charges: 2/3", or "Fuel: " + thermometer
                }
            }
        } else {
            if (hasStats) lines.push('');
            lines.push('Inventory: (empty)');
        }

        // A blank trailing line to pad the '?' button
        lines.push('');

        // Calculate dimensions - account for thermometer bar widths
        const padding = 1;
        let maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 10);
        const thermometerBarWidth = 10;
        for (const { label } of thermometerLineIndices) {
            const totalWidth = label.length + thermometerBarWidth;
            if (totalWidth > maxLineLength) {
                maxLineLength = totalWidth;
            }
        }
        // Also check item stat thermometers
        for (const { label } of itemStatLineIndices) {
            const totalWidth = label.length + thermometerBarWidth;
            if (totalWidth > maxLineLength) {
                maxLineLength = totalWidth;
            }
        }
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Vertically placed in the half the player isn't in
        const { y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);
        const vis = this.getVisibleArea();
        const visMidpoint = vis.originX + vis.width / 2;
        const x = (player.x || 0) >= visMidpoint
            ? vis.originX + 1
            : vis.originX + vis.width - boxWidth - 1;

        // Create the box
        const boxContainer = this.createBox(infoBoxId, x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._inventoryLineIndices = inventoryLineIndices;
        // Absolute tile of the '?' affordance: one tile in from the bottom and right
        // border tiles, which is inside the padding ring rather than the content area —
        // so it's hit-tested directly here instead of through _hitTestBox's content grid.
        boxContainer._helpTileX = x + boxWidth - 2;
        boxContainer._helpTileY = y + boxHeight - 2;

        // Zebra-stripe the inventory rows (an item with a stat sub-line spans 2 rows)
        const stripeRows = inventoryLineIndices.map(({ lineIndex }) => ({
            lineIndex,
            span: itemStatLineIndices.some(s => s.lineIndex === lineIndex + 1) ? 2 : 1,
        }));
        this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);

        // Add text sprites
        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        // Item stat sub-lines (charges, fuel, etc.) render in the amber accent color —
        // except a `dim` line (a part-used but idle consumable), whose label follows its
        // bar to gray so the two don't disagree about whether the item is active.
        const accentLineSet = new Set(itemStatLineIndices.map(s => s.lineIndex));
        const dimLineSet = new Set(itemStatLineIndices.filter(s => s.dim).map(s => s.lineIndex));

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const accent = accentLineSet.has(lineIndex);
            const baseColor = dimLineSet.has(lineIndex) ? this.inactiveTintColor
                : accent ? this.statAccentColor : this.defaultTextTint;
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            // accent lines are wholly amber (baseWhite); markup spans color individual words
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY, baseColor, accent);
        }

        // Render thermometer bars for health/nutrition stats
        for (const { lineIndex, label, stat } of thermometerLineIndices) {
            const barX = textStartX + (label.length * globalVars.TILE_WIDTH);
            const barY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderThermometerBar(boxContainer, stat.current, stat.max, barX, barY);
        }

        // Render item tiles in inventory list
        // Format is "  a)  [tile] _ Item Name" - tile at offset 5, blank gap at offset 6, name at offset 7
        for (const { lineIndex, item } of inventoryLineIndices) {
            const tileX = textStartX + (5 * globalVars.TILE_WIDTH); // Position after "  a)  "
            const tileY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderItemTile(boxContainer, item, tileX, tileY);
        }

        // Render thermometer bars for continuous item stats (torch fuel, condition) in
        // the amber accent color. Charge-based items opt out via noBar 
        for (const { lineIndex, label, current, max, noBar, dim } of itemStatLineIndices) {
            if (noBar) continue;
            const barX = textStartX + (label.length * globalVars.TILE_WIDTH);
            const barY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderThermometerBar(boxContainer, current, max, barX, barY,
                dim ? this.inactiveTintColor : this.statAccentColor);
        }

        // The '?' help affordance, one tile in from the bottom-right border tiles.
        // Positioned box-relative, not text-relative: it sits in the padding ring
        // just outside the content area.
        const helpSprite = this.createCharSprite(
            '?',
            (boxWidth - 2) * globalVars.TILE_WIDTH,
            (boxHeight - 2) * globalVars.TILE_HEIGHT
        );
        if (helpSprite) boxContainer.addChild(helpSprite);

        // Enable inventory selection mode
        this.inventoryMode = true;
        this.currentPlayer = player;
        this.selectedItemIndex = null;

        this.updateBoxOverlays();
    }

    /**
     * Hide the player info box if it's showing
     */
    hidePlayerInfo() {
        this.removeBox('player_info');
        this.removeBox('item_action_menu');
        this.inventoryMode = false;
        this.currentPlayer = null;
        this.selectedItemIndex = null;
        this.updateBoxOverlays();
    }

    /**
     * Update the player info box if it's currently visible
     * Call this after stat changes to reflect updates immediately
     */
    updatePlayerInfo() {
        // Update regardless of inventoryMode - stat changes should always reflect
        if (this.currentPlayer && this.boxes.has('player_info')) {
            // Re-render the player info box with updated stats
            this.showPlayerInfo(this.currentPlayer);
        }
    }

    /**
     * Check if the player info box is currently visible
     * @returns {boolean}
     */
    isPlayerInfoVisible() {
        return this.boxes.has('player_info');
    }

    /**
     * Show the item action menu for a selected inventory item
     * @param {number} itemIndex - Index of the item in player's inventory
     */
    showItemActionMenu(itemIndex) {
        if (!this.currentPlayer || !this.inventoryMode) return;
        if (itemIndex < 0 || itemIndex >= this.currentPlayer.inventory.length) return;

        this.clearTargetingHighlights();

        const item = this.currentPlayer.inventory[itemIndex];
        this.selectedItemIndex = itemIndex;

        // Remove existing action menu if present
        this.removeBox('item_action_menu');

        // Build menu lines
        const lines = [];
        const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
        lines.push(displayName);
        lines.push(''); // blank line

        // Description, effect, equip forecast and charges — the same text the standalone
        // info panel shows, so the two can't disagree. Brogue's carried-item panel is
        // itemDetails plus buttons for exactly this reason (IO.c:4734).
        const info = this.buildItemInfoLines(item, this.currentPlayer, 26);
        if (info.length) {
            for (const line of info) lines.push(line);
            lines.push('');
        }

        // Add action options with number keys
        lines.push('Actions:');
        const actionStartLine = lines.length; // Line index of first action option
        let actionNum = 1;

        // Check if item is currently equipped
        const isEquipped = this.currentPlayer.isItemEquipped(item);

        // Drop is always available
        lines.push(`  ${actionNum}) Drop`);
        actionNum++;

        // Wear option if item is wearable armor and not currently worn
        if (item.hasAttribute('wearable') && !isEquipped) {
            lines.push(`  ${actionNum}) Wear`);
            actionNum++;
        }

        // Equip option if item is a weapon and not currently equipped
        if (item.hasAttribute('weapon') && !isEquipped) {
            lines.push(`  ${actionNum}) Equip`);
            actionNum++;
        }

        // Remove option if item is currently worn/equipped
        if (isEquipped) {
            lines.push(`  ${actionNum}) Remove`);
            actionNum++;
        }

        // Use verb if available
        const useVerb = item.getAttribute('use_verb');
        if (useVerb) {
            lines.push(`  ${actionNum}) ${this.capitalize(useVerb)}`);
            actionNum++;
        }

        // Throw is always available
        lines.push(`  ${actionNum}) Throw`);
        actionNum++;

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 12);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // This menu belongs to the player_info box, so it prefers sitting flush against
        // it and sharing its top — the pair then reads as one panel. Those are only
        // preferences: the shared placement rule drops them if they'd put the box on the
        // player. (Y here used to be a flat vis.originY + 1, the top of the viewport,
        // which is exactly where the player stands when they're in the upper half.)
        const playerInfoBox = this.boxes.get('player_info');
        const vis = this.getVisibleArea();

        const preferX = [];
        const preferY = [];
        if (playerInfoBox && playerInfoBox._boxX !== undefined) {
            const infoLeft = playerInfoBox._boxX;
            const infoRight = infoLeft + playerInfoBox._boxWidth;
            if (infoLeft - vis.originX > boxWidth) preferX.push(infoLeft - boxWidth);
            if (infoRight + boxWidth < vis.originX + vis.width) preferX.push(infoRight);
            if (playerInfoBox._boxY !== undefined) preferY.push(playerInfoBox._boxY);
        }

        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight, { preferX, preferY });

        // Create the box
        const boxContainer = this.createBox('item_action_menu', x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._actionStartLine = actionStartLine;
        boxContainer._actionCount = actionNum - 1;

        // Add text sprites
        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    }

    /**
     * Close the item action menu
     */
    closeItemActionMenu() {
        this.removeBox('item_action_menu');
        this.selectedItemIndex = null;
        this.updateBoxOverlays();
    }

    /**
     * Handle keyboard input for inventory interaction
     * @param {string} key - The key that was pressed
     * @returns {boolean} True if the key was handled
     */
    handleInventoryKey(key) {
        // Identify mode intercepts key input before the normal inventory flow
        if (this.identifyMode) {
            if (key === 'Escape') {
                this.exitIdentifyMode();
                return true;
            }
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            const idx = letters.indexOf(key);
            if (idx >= 0) {
                const caster = this.identifyCaster;
                const scroll = this.identifyScrollItem;
                const unidentified = (caster?.inventory || []).filter(i => i !== scroll && i.identified === false);
                const target = unidentified[idx];
                if (target) {
                    target.identify();
                    const revealed = target.getDisplayName ? target.getDisplayName() : target.name;
                    this.engine.inputManager?.showMessage(`It's a ${revealed}!`);
                    this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
                    this.engine.playSound?.('tap1');
                    // Remove scroll from inventory (consumable)
                    if (caster && scroll) {
                        caster.inventory = caster.inventory.filter(i => i !== scroll);
                    }
                    this.exitIdentifyMode();
                    this.hidePlayerInfo();
                    this.engine.inputManager?.onPlayerAction?.();
                }
            }
            return true;
        }

        if (this.enchantMode) {
            if (key === 'Escape') {
                this.exitEnchantMode();
                return true;
            }
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            const idx = letters.indexOf(key);
            if (idx >= 0) {
                const caster = this.enchantCaster;
                const scroll = this.enchantScrollItem;
                const enchantable = (caster?.inventory || []).filter(i =>
                    i !== scroll && i.getAttribute('enchantable')
                );
                const target = enchantable[idx];
                if (target) {
                    const chargeStat = target.getAttribute('charge_stat');
                    const cStat = chargeStat ? target.stats?.[chargeStat] : null;
                    const revealed = target.getDisplayName ? target.getDisplayName() : target.name;

                    if (cStat && cStat.per_turn === 0) {
                        const uses = target.getAttribute('uses') || 1;
                        const useCost = cStat.ready_at || Math.floor(cStat.max / uses);
                        cStat.max += useCost;
                        cStat.current += useCost;
                        target.setAttribute('uses', uses + 1);
                        this.engine.inputManager?.showMessage(`Your ${revealed} surges with new energy!`);
                    } else {
                        target.enchantment = (target.enchantment || 0) + 1;
                        this.engine.inputManager?.showMessage(`Your ${revealed} glows brightly!`);
                    }
                    this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
                    this.engine.playSound?.('tap1');
                    if (caster && scroll) {
                        caster.inventory = caster.inventory.filter(i => i !== scroll);
                    }
                    this.exitEnchantMode();
                    this.hidePlayerInfo();
                    this.engine.inputManager?.onPlayerAction?.();
                }
            }
            return true;
        }

        if (!this.inventoryMode || !this.currentPlayer) return false;

        // If action menu is open, handle number keys for actions
        if (this.selectedItemIndex !== null) {
            if (key === 'Escape') {
                this.closeItemActionMenu();
                return true;
            }

            // Handle action selection (1, 2, 3, etc.)
            const actionNum = parseInt(key, 10);
            if (!isNaN(actionNum) && actionNum >= 1) {
                return this.executeItemAction(actionNum);
            }

            return false;
        }

        // Handle letter keys for item selection (a-z)
        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const itemIndex = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
            if (itemIndex < this.currentPlayer.inventory.length) {
                this.showItemActionMenu(itemIndex);
                return true;
            }
        }

        // Escape closes the player info entirely
        if (key === 'Escape') {
            this.hidePlayerInfo();
            return true;
        }

        return false;
    }

    /**
     * Execute an item action based on the numbered option
     * @param {number} actionNum - The action number (1-based)
     * @returns {boolean} True if action was executed
     */
    executeItemAction(actionNum) {
        if (this.selectedItemIndex === null || !this.currentPlayer) return false;

        const item = this.currentPlayer.inventory[this.selectedItemIndex];
        if (!item) return false;

        // Build the action list to determine which action corresponds to which number
        let currentAction = 1;

        // Check if item is currently equipped
        const isEquipped = this.currentPlayer.isItemEquipped(item);

        // Action 1 is always Drop
        if (actionNum === currentAction) {
            this.executeDropItem(item);
            return true;
        }
        currentAction++;

        // Wear (if wearable armor and not worn)
        if (item.hasAttribute('wearable') && !isEquipped) {
            if (actionNum === currentAction) {
                this.executeWearItem(item);
                return true;
            }
        }
        if (item.hasAttribute('wearable') && !isEquipped) currentAction++;

        // Equip (if weapon and not equipped)
        if (item.hasAttribute('weapon') && !isEquipped) {
            if (actionNum === currentAction) {
                this.executeWearItem(item); // equipItem handles both weapons and armor
                return true;
            }
        }
        if (item.hasAttribute('weapon') && !isEquipped) currentAction++;

        // Remove (if worn/equipped)
        if (isEquipped) {
            if (actionNum === currentAction) {
                this.executeRemoveItem(item);
                return true;
            }
        }
        if (isEquipped) currentAction++;

        // Use verb action
        const useVerb = item.getAttribute('use_verb');
        if (useVerb) {
            if (actionNum === currentAction) {
                this.executeUseItem(item);
                return true;
            }
        }
        if (useVerb) currentAction++;

        // Throw action (always available)
        if (actionNum === currentAction) {
            this.enterThrowAimingMode(item);
            return true;
        }
        currentAction++;

        return false;
    }

    /**
     * Drop an item from inventory
     */
    executeDropItem(item) {
        if (!this.currentPlayer) return;

        // Unequip if this item is currently equipped
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.currentPlayer.equipment[slot] === item) {
                this.currentPlayer.unequipFromSlot(slot);
                break;
            }
        }

        if (item.count > 1) {
            // Drop one from the stack
            item.count--;
            const itemData = this.engine.currentPrototype?.getItemData(item.type);
            if (itemData) {
                const dropped = new Item(
                    this.currentPlayer.x, this.currentPlayer.y,
                    item.type, itemData, this.engine
                );
                dropped.owner = null;
                this.engine.entityManager.addEntity(dropped);
            }
            console.log(`${this.currentPlayer.name} dropped 1 ${item.name} (${item.count} remaining)`);
        } else {
            // Remove from inventory
            const index = this.currentPlayer.inventory.indexOf(item);
            if (index > -1) {
                this.currentPlayer.inventory.splice(index, 1);

                // Place item at player's position
                item.x = this.currentPlayer.x;
                item.y = this.currentPlayer.y;
                item.owner = null;
                this.engine.entityManager.addEntity(item);

                console.log(`${this.currentPlayer.name} dropped ${item.name}`);
            }
        }

        // Close menus and reset inventory mode
        this.hidePlayerInfo();
    }

    /**
     * Wear/equip an item
     */
    executeWearItem(item) {
        if (!this.currentPlayer) return;

        this.currentPlayer.equipItem(item);

        // Close all UI and consume turn
        this.hidePlayerInfo();
        this.engine.inputManager?.onPlayerAction();
    }

    /**
     * Remove/unequip a worn item
     */
    executeRemoveItem(item) {
        if (!this.currentPlayer) return;

        this.currentPlayer.unequipItem(item);

        // Close all UI and consume turn
        this.hidePlayerInfo();
        this.engine.inputManager?.onPlayerAction();
    }

    /**
     * Use an item (execute its use_verb action)
     */
    executeUseItem(item) {
        if (!this.currentPlayer) return;

        // Close menus and reset inventory mode before executing the effect
        const player = this.currentPlayer;
        this.hidePlayerInfo();

        if (player.useItem) {
            player.useItem(item);
        }

        // Don't consume turn if we entered spell aiming or identify mode (handled by follow-up interaction)
        if (this.spellAimingMode || this.identifyMode || this.enchantMode || this.spikeDirectionMode || this.digDirectionMode) {
            return;
        }

        // Scroll ceremony handles its own turn unlock after the delay
        if (player._scrollCeremonyActive) return;

        // If the item was consumed, keep the info box closed; otherwise refresh it
        if (player.inventory.includes(item)) {
            this.showPlayerInfo(player);
        }
        this.engine.inputManager?.onPlayerAction();
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

    /**
     * Clear targeting highlights (walk path, line path, tile highlight)
     * Called when opening UI boxes to avoid visual clutter
     */
    clearTargetingHighlights() {
        this.engine.renderer?.hideWalkPath();
        this.engine.renderer?.hideLinePath();
        this.engine.renderer?.hideTileHighlight();
    }

    /**
     * Show a confirmation dialog with Yes/No options
     * @param {string} message - The question to display
     * @param {function} onConfirm - Callback when user confirms (Y)
     * @param {function} onCancel - Callback when user cancels (N/Escape)
     */
    showConfirmDialog(message, onConfirm, onCancel, options = {}) {
        // Remove any existing confirm dialog
        this.closeConfirmDialog();

        this.clearTargetingHighlights();

        // Store callbacks
        this.confirmDialog = { message, onConfirm, onCancel };

        // Build dialog lines
        const lines = [];

        // Word wrap the message
        const wrappedMessage = this.wrapText(message, 24);
        for (const line of wrappedMessage) {
            lines.push(line);
        }
        lines.push('');
        lines.push('  (Y)es  /  (N)o');

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed so the dialog never hides the player
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        // Create the box
        const fillColor = options.fillColor ?? this.defaultFillColor;
        const borderTint = options.borderTint ?? this.defaultBorderTint;
        const textTint = options.textTint ?? this.defaultTextTint;
        const boxContainer = this.createBox('confirm_dialog', x, y, boxWidth, boxHeight, {
            fillColor,
            borderTint
        });

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._confirmYNLine = lines.length - 1;

        // Add text sprites
        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY, textTint);
        }

        this.updateBoxOverlays();
    }

    /**
     * Close the confirmation dialog
     */
    closeConfirmDialog() {
        this.removeBox('confirm_dialog');
        this.confirmDialog = null;
        this.updateBoxOverlays();
    }

    /**
     * Handle keyboard input for confirmation dialog
     * @param {string} key - The key that was pressed
     * @returns {boolean} True if the key was handled
     */
    handleConfirmKey(key) {
        if (!this.confirmDialog) return false;

        if (key === 'y' || key === 'Y') {
            const onConfirm = this.confirmDialog.onConfirm;
            this.closeConfirmDialog();
            if (onConfirm) onConfirm();
            return true;
        }

        // Any other key is a "no": only Y confirms, so an accidental or exploratory
        // keypress dismisses rather than leaving the dialog stuck open. Bare modifier
        // presses are ignored — they arrive as their own keydown, so treating them as
        // "no" would cancel the dialog while the user was still reaching for Shift+Y.
        if (MODIFIER_KEYS.has(key)) return true;

        const onCancel = this.confirmDialog.onCancel;
        this.closeConfirmDialog();
        if (onCancel) onCancel();
        return true;
    }

    /**
     * Check if a confirmation dialog is currently showing
     * @returns {boolean}
     */
    hasConfirmDialog() {
        return this.confirmDialog !== null;
    }

    // ========================================================================
    // DIALOG CLICK HANDLING
    // ========================================================================

    /**
     * Handle a mouse click that may target a dialog box.
     * Converts the global tile coordinate to a content line within the
     * topmost active dialog and dispatches the appropriate action.
     * @param {number} tileX - Clicked tile X in global map coordinates
     * @param {number} tileY - Clicked tile Y in global map coordinates
     * @returns {boolean} True if a dialog consumed the click
     */
    handleDialogClick(tileX, tileY) {
        // Priority order matches keyboard handler:

        // 0. Help window — matches updateBoxOverlays' priority. Any click dismisses
        //    (it's a reference panel with nothing to select), and consuming the click
        //    keeps a click behind the panel from starting an auto-walk.
        if (this.helpWindowMode) {
            this.closeHelpWindow();
            return true;
        }

        // 1. Confirm dialog (highest priority)
        if (this.confirmDialog) {
            const box = this.boxes.get('confirm_dialog');
            if (box) {
                const hit = this._hitTestBox(box, tileX, tileY);
                if (hit) {
                    this._handleConfirmClick(box, hit.contentLine, hit.contentCol);
                } else {
                    // Outside click dismisses (triggers cancel)
                    const onCancel = this.confirmDialog.onCancel;
                    this.closeConfirmDialog();
                    if (onCancel) onCancel();
                }
            }
            return true;
        }

        // 2. Identify picker (modal — highest priority after confirm)
        if (this.identifyMode) {
            const identBox = this.boxes.get('identify_picker');
            if (identBox) {
                const hit = this._hitTestBox(identBox, tileX, tileY);
                if (hit) {
                    this._handleIdentifyClick(hit.contentLine);
                } else {
                    this.exitIdentifyMode();
                }
            }
            return true;
        }

        // 2b. Enchant picker
        if (this.enchantMode) {
            const enchantBox = this.boxes.get('enchant_picker');
            if (enchantBox) {
                const hit = this._hitTestBox(enchantBox, tileX, tileY);
                if (hit) {
                    const itemLine = hit.contentLine - 2;
                    if (itemLine >= 0) {
                        const letters = 'abcdefghijklmnopqrstuvwxyz';
                        this.handleInventoryKey(letters[itemLine]);
                    }
                } else {
                    this.exitEnchantMode();
                }
            }
            return true;
        }

        // 3. Item action menu (sub-menu of inventory)
        if (this.inventoryMode && this.selectedItemIndex !== null) {
            const actionBox = this.boxes.get('item_action_menu');
            if (actionBox) {
                const hit = this._hitTestBox(actionBox, tileX, tileY);
                if (hit) {
                    this._handleItemActionClick(actionBox, hit.contentLine);
                } else {
                    // Outside click closes action menu, stays in inventory
                    this.closeItemActionMenu();
                }
            }
            return true;
        }

        // 3. Inventory / Player info
        if (this.inventoryMode && this.currentPlayer) {
            const invBox = this.boxes.get('player_info');
            if (invBox) {
                // The '?' affordance sits in the padding ring, outside the content
                // grid _hitTestBox covers, so check it against its own tile first.
                if (tileX === invBox._helpTileX && tileY === invBox._helpTileY) {
                    this.showHelpWindow();
                    return true;
                }
                const hit = this._hitTestBox(invBox, tileX, tileY);
                if (hit) {
                    this._handleInventoryClick(invBox, hit.contentLine);
                } else {
                    // Outside click closes inventory
                    this.hidePlayerInfo();
                }
            }
            return true;
        }

        // 4. Throw item menu
        if (this.throwMenuMode) {
            const throwBox = this.boxes.get('throw_item_menu');
            if (throwBox) {
                const hit = this._hitTestBox(throwBox, tileX, tileY);
                if (hit) {
                    this._handleThrowMenuClick(throwBox, hit.contentLine);
                } else {
                    this.closeThrowItemMenu();
                }
            }
            return true;
        }

        // 5. Equipment menu
        if (this.equipmentMenuMode) {
            const equipBox = this.boxes.get('equipment_menu');
            if (equipBox) {
                const hit = this._hitTestBox(equipBox, tileX, tileY);
                if (hit) {
                    this._handleEquipmentClick(equipBox, hit.contentLine);
                } else {
                    this.closeEquipmentMenu();
                }
            }
            return true;
        }

        return false;
    }

    /**
     * Test whether a global tile coordinate falls within a box's content area.
     * @param {PIXI.Container} box - Box container with _boxX, _boxY, _boxWidth, _boxHeight, _padding
     * @param {number} tileX - Global tile X
     * @param {number} tileY - Global tile Y
     * @returns {{ contentLine: number, contentCol: number } | null}
     */
    _hitTestBox(box, tileX, tileY) {
        const bx = box._boxX;
        const by = box._boxY;
        const bw = box._boxWidth;
        const bh = box._boxHeight;
        const pad = box._padding ?? 1;

        // Check if click is within the box bounds
        if (tileX < bx || tileX >= bx + bw || tileY < by || tileY >= by + bh) {
            return null;
        }

        // Content area starts at (bx + pad + 1, by + pad + 1), +1 for border
        const contentCol = tileX - (bx + pad + 1);
        const contentLine = tileY - (by + pad + 1);
        const contentWidth = bw - (pad * 2) - 2;
        const contentHeight = bh - (pad * 2) - 2;

        if (contentCol < 0 || contentCol >= contentWidth ||
            contentLine < 0 || contentLine >= contentHeight) {
            return null;
        }

        return { contentLine, contentCol };
    }

    /**
     * Handle click on confirm dialog content
     */
    _handleConfirmClick(box, contentLine, contentCol) {
        if (!this.confirmDialog) return;

        // The Y/N line: "  (Y)es  /  (N)o"
        // "/" separator is at column 9; left = Yes, right = No
        if (contentLine === box._confirmYNLine) {
            if (contentCol <= 8) {
                const onConfirm = this.confirmDialog.onConfirm;
                this.closeConfirmDialog();
                if (onConfirm) onConfirm();
            } else {
                const onCancel = this.confirmDialog.onCancel;
                this.closeConfirmDialog();
                if (onCancel) onCancel();
            }
        }
    }

    /**
     * Handle click on inventory item line
     */
    _handleInventoryClick(invBox, contentLine) {
        if (!invBox._inventoryLineIndices) return;

        for (let i = 0; i < invBox._inventoryLineIndices.length; i++) {
            if (contentLine === invBox._inventoryLineIndices[i].lineIndex) {
                this.showItemActionMenu(i);
                return;
            }
        }
    }

    /**
     * Handle click on item action menu line
     */
    _handleItemActionClick(actionBox, contentLine) {
        const startLine = actionBox._actionStartLine;
        const count = actionBox._actionCount;
        if (startLine === undefined || count === undefined) return;

        if (contentLine >= startLine && contentLine < startLine + count) {
            const actionNum = contentLine - startLine + 1;
            this.executeItemAction(actionNum);
        }
    }

    /**
     * Handle click on throw item menu line
     */
    _handleThrowMenuClick(throwBox, contentLine) {
        const startLine = throwBox._itemStartLine;
        const count = throwBox._itemCount;
        if (startLine === undefined || count === undefined) return;

        if (contentLine >= startLine && contentLine < startLine + count) {
            const itemIndex = contentLine - startLine;
            if (this.currentPlayer && itemIndex < this.currentPlayer.inventory.length) {
                const item = this.currentPlayer.inventory[itemIndex];
                this.closeThrowItemMenu();
                this.enterThrowAimingMode(item);
            }
        }
    }

    /**
     * Handle click on equipment menu line
     */
    _handleEquipmentClick(equipBox, contentLine) {
        const startLine = equipBox._itemStartLine;
        const count = equipBox._itemCount;
        if (startLine === undefined || count === undefined) return;

        if (contentLine >= startLine && contentLine < startLine + count) {
            const itemIndex = contentLine - startLine;
            if (itemIndex < this.equipmentMenuItems.length) {
                const entry = this.equipmentMenuItems[itemIndex];
                const item = entry.item;
                const player = this.equipmentMenuPlayer;

                if (player.isItemEquipped(item)) {
                    player.unequipItem(item);
                    this.engine.playSound?.('tap2');
                } else {
                    player.equipItem(item);
                    this.engine.playSound?.('tap2');
                }

                // Refresh menu to show updated state
                this.showEquipmentMenu(player);
            }
        }
    }

    // ========================================================================
    // AIM TARGETING (shared by throw and spell aiming)
    // ========================================================================

    /**
     * Which item is currently being aimed, and what it targets by default.
     * Throwing offers traps as well as enemies so a thrown object can spring one
     * from a safe distance; a zap is enemies-only unless the item says otherwise.
     * @returns {{item: Object, defaults: string[], origin: Object}|null}
     */
    getAimContext() {
        if (this.throwAimingMode) {
            return {
                item: this.throwItem,
                defaults: THROW_DEFAULT_TARGETS,
                origin: this.engine.entityManager?.player
            };
        }
        if (this.spellAimingMode) {
            return {
                item: this.spellItem,
                defaults: SPELL_DEFAULT_TARGETS,
                origin: this.spellCaster
            };
        }
        return null;
    }

    /**
     * Aim at a target by writing its position into hoveredTile.
     *
     * Both aiming modes read their target solely from inputManager.hoveredTile, so
     * pointing them somewhere is just a matter of setting it. A later mouse move
     * overwrites this, which is intended — the mouse always wins.
     *
     * @param {{x: number, y: number}} target - The chosen target
     */
    applyAimTarget(target) {
        const inputManager = this.engine.inputManager;
        if (!inputManager || !target) return;
        inputManager.hoveredTile.x = target.x;
        inputManager.hoveredTile.y = target.y;
    }

    /**
     * Point at the nearest valid target when an aiming mode opens.
     * @param {string[]} defaults - Fallback tokens when the item declares no target_filter
     * @returns {Object|null} The seeded target, or null if there was nothing to aim at
     */
    seedAimTarget(defaults) {
        const ctx = this.getAimContext();
        if (!ctx) return null;

        const tokens = getAimTargetTokens(ctx.item, defaults);
        const targets = collectAimTargets(this.engine, tokens, ctx.origin);
        if (targets.length === 0) return null;

        this.aimTargets = targets;
        this.aimTargetIndex = 0;
        this.applyAimTarget(targets[0]);
        return targets[0];
    }

    /**
     * Advance to the next target, wrapping around. Rebuilds the candidate list each
     * press so a target that died or walked out of sight since the last press drops
     * out, matching how cycleTarget handles travel targets.
     *
     * @returns {boolean} True if a target was selected
     */
    cycleAimTarget() {
        const ctx = this.getAimContext();
        if (!ctx) return false;

        const tokens = getAimTargetTokens(ctx.item, ctx.defaults);
        const targets = collectAimTargets(this.engine, tokens, ctx.origin);
        if (targets.length === 0) {
            this.engine.inputManager?.showMessage('No targets in view.');
            return false;
        }

        // Keep the cycle anchored to the actor we were last pointing at, so a list
        // that reordered (something moved closer) doesn't jump us back to the start.
        const current = this.aimTargets?.[this.aimTargetIndex]?.entity;
        const resumeAt = current ? targets.findIndex(t => t.entity === current) : -1;
        const index = (resumeAt >= 0 ? resumeAt + 1 : 0) % targets.length;

        this.aimTargets = targets;
        this.aimTargetIndex = index;
        this.applyAimTarget(targets[index]);

        // Redraw through the mode's own path renderer.
        if (this.throwAimingMode) this.updateThrowPath();
        else if (this.spellAimingMode) this.updateSpellPath();

        this.announceAimTarget(targets[index]);
        return true;
    }

    /**
     * Report the current aim target and its position in the cycle.
     * @param {Object} target - The selected target
     */
    announceAimTarget(target) {
        const total = this.aimTargets?.length || 1;
        // Tile targets carry no entity — name the spot instead of saying "target".
        const label = target.entity?.name || `spot (${target.x}, ${target.y})`;
        this.engine.inputManager?.showMessage(`Target: ${label} (${this.aimTargetIndex + 1}/${total})`);
    }

    /**
     * Was this key press the "cycle target" action?
     *
     * Resolved through the keymap rather than compared to a literal, so a player who
     * rebinds target cycling off Tab still gets it inside the aiming modes.
     *
     * @param {KeyboardEvent} [event] - The raw keydown event
     * @returns {boolean}
     */
    isCycleTargetKey(event) {
        if (!event) return false;
        return this.engine.inputManager?.getActionForKey(event) === 'cycle_target';
    }

    /**
     * Was this key press the "confirm target" action? (Enter by default.)
     *
     * The keyboard equivalent of clicking the aimed tile, so a throw or a zap can be
     * completed without reaching for the mouse. Resolved through the keymap for the
     * same reason as isCycleTargetKey — the binding is the player's to change.
     *
     * @param {KeyboardEvent} [event] - The raw keydown event
     * @returns {boolean}
     */
    isConfirmTargetKey(event) {
        if (!event) return false;
        return this.engine.inputManager?.getActionForKey(event) === 'confirm_target';
    }

    // ========================================================================
    // THROW AIMING MODE
    // ========================================================================

    /**
     * Enter throw aiming mode for an item
     * @param {Item} item - The item to throw
     */
    enterThrowAimingMode(item) {
        this.throwAimingMode = true;
        this.throwItem = item;
        this.aimTargets = null;
        this.aimTargetIndex = -1;

        // Close the menus but keep player reference
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        // Start aimed at the nearest valid target so the mode is usable without a
        // mouse — hoveredTile sits at -1,-1 until the pointer moves over the canvas,
        // which would otherwise leave a keyboard player with nothing aimed at.
        const seeded = this.seedAimTarget(THROW_DEFAULT_TARGETS);

        const im = this.engine.inputManager;
        const cycleKey = im?.getKeyForAction('cycle_target', 'Tab') || 'Tab';
        const confirmKey = im?.getKeyForAction('confirm_target', 'Enter') || 'Enter';
        this.showTextBox('throw_instructions',
            `[${cycleKey}] to target, [${confirmKey}] or click to throw. Esc to cancel.`, {
            dismissOnMove: false
        });

        // Update the throw path based on current mouse position
        this.updateThrowPath();
        if (seeded) this.announceAimTarget(seeded);
    }

    /**
     * Exit throw aiming mode without throwing
     */
    exitThrowAimingMode() {
        this.throwAimingMode = false;
        this.throwItem = null;

        // Hide the line path
        this.engine.renderer?.hideLinePath();

        // Remove instruction message
        this.removeTextBox('throw_instructions');

        // Re-enable normal tile highlight
        this.engine.renderer?.hideTileHighlight();

        // Restore walk path display for current hovered tile
        const inputManager = this.engine.inputManager;
        if (inputManager && inputManager.hoveredTile.x >= 0) {
            inputManager.updateWalkPath(inputManager.hoveredTile.x, inputManager.hoveredTile.y);
        }
    }

    /**
     * Calculate the maximum throw range for an actor
     * Base range is 10 tiles + actor's strength attribute
     * @param {Actor} actor - The actor throwing
     * @returns {number} Maximum throw range in tiles
     */
    getThrowRange(actor) {
        const baseRange = 10;
        const strength = actor.getAttribute('strength') || 0;
        return baseRange + strength;
    }

    /**
     * Roll to determine if a thrown item misses its target
     * Uses the thrower's accuracy vs target's defense (same formula as melee)
     * @param {Actor} thrower - The actor throwing the item
     * @param {Actor} target - The target being thrown at
     * @returns {boolean} True if the throw MISSED, false if it hit
     */
    rollThrowAccuracy(thrower, target) {
        // Get thrower's accuracy (default 50 if not set - throwing is harder than melee)
        const accuracy = thrower.getEffectiveAccuracy?.() ?? thrower.getAttribute('accuracy') ?? 50;

        // If thrower has no accuracy concept, always hit
        if (accuracy === null) return false;

        // Get target's defense
        const defense = target.getEffectiveDefense?.() ?? target.getAttribute('defense') ?? 0;

        // Use same formula as melee: accuracy * 0.987^defense
        const rawProbability = accuracy * Math.pow(0.987, defense);

        // Clamp to 5-95%
        const hitChance = Math.max(5, Math.min(95, Math.round(rawProbability)));

        // Roll for hit
        const roll = ROT.RNG.getPercentage(); // Returns 1-100
        const missed = roll > hitChance;

        console.log(`Throw accuracy: ${accuracy} vs defense ${defense} = ${hitChance}% hit chance, rolled ${roll}, ${missed ? 'MISS' : 'HIT'}`);

        return missed;
    }

    /**
     * Find an adjacent floor tile to a given position
     * Used for placing missed thrown items
     * @param {number} x - Center X position
     * @param {number} y - Center Y position
     * @returns {{x: number, y: number}|null} Adjacent floor position or null if none found
     */
    findAdjacentFloorTile(x, y) {
        const directions = [
            { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
            { dx: -1, dy: 0 },                     { dx: 1, dy: 0 },
            { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 }
        ];

        // Shuffle directions for random placement
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        const mapManager = this.engine.mapManager;
        const entityManager = this.engine.entityManager;

        for (const dir of directions) {
            const tx = x + dir.dx;
            const ty = y + dir.dy;

            // Check if this is a valid floor tile
            const floorTile = mapManager?.floorMap?.[ty]?.[tx];
            if (!floorTile || floorTile.tileId <= 0) continue;

            // Check if there's a solid actor blocking
            const actor = entityManager?.getActorAt(tx, ty);
            if (actor && !actor.isDead && actor.hasAttribute('solid')) continue;

            return { x: tx, y: ty };
        }

        return null;
    }

    /**
     * Update the throw path line based on current mouse position
     */
    updateThrowPath() {
        if (!this.throwAimingMode || !this.currentPlayer) return;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return;

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't draw path if mouse is off-screen or on player
        if (targetX < 0 || targetY < 0) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        if (targetX === this.currentPlayer.x && targetY === this.currentPlayer.y) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        // Calculate throw range (10 + strength)
        const maxRange = this.getThrowRange(this.currentPlayer);

        // Show the line path from player to target with range limit
        this.engine.renderer?.showLinePath(
            this.currentPlayer.x,
            this.currentPlayer.y,
            targetX,
            targetY,
            0xFF0000, // Red color for throw path
            maxRange
        );
    }

    /**
     * Execute the throw at the current target position
     */
    executeThrow() {
        if (!this.throwAimingMode || !this.currentPlayer || !this.throwItem) return;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return;

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't throw if mouse is off-screen or on player
        if (targetX < 0 || targetY < 0) return;
        if (targetX === this.currentPlayer.x && targetY === this.currentPlayer.y) return;

        // Calculate throw range (10 + strength)
        const maxRange = this.getThrowRange(this.currentPlayer);

        // Get the actual landing position (may be blocked by solid actor or range limit)
        const pathResult = this.engine.renderer?.showLinePath(
            this.currentPlayer.x,
            this.currentPlayer.y,
            targetX,
            targetY,
            0xFF0000,
            maxRange
        );

        if (!pathResult || pathResult.path.length === 0) return;

        // Don't allow throwing if target is out of range
        if (pathResult.outOfRange) {
            this.engine.inputManager?.showMessage("That's too far to throw!");
            return;
        }

        // Store references before exiting aiming mode
        let item = this.throwItem;
        const player = this.currentPlayer;
        const path = pathResult.path;

        // Unequip item if it's being worn
        if (player.isItemEquipped(item)) {
            player.unequipItem(item);
        }

        // Remove item from inventory (stack-aware)
        if (item.count > 1) {
            item.count--;
            const itemData = this.engine.currentPrototype?.getItemData(item.type);
            if (itemData) {
                item = new Item(-1, -1, item.type, itemData, this.engine);
            }
        } else {
            const index = player.inventory.indexOf(item);
            if (index > -1) {
                player.inventory.splice(index, 1);
            }
        }

        // Exit aiming mode (hides line path)
        this.exitThrowAimingMode();

        // Determine if we'll potentially hit something
        const landingPoint = path[path.length - 1];
        const hitActor = this.engine.entityManager?.getActorAt(landingPoint.x, landingPoint.y);
        const willHit = hitActor && !hitActor.isDead && hitActor.hasAttribute('solid');

        // Animate the projectile, then apply effects (sound plays in completeThrow after accuracy roll)
        this.animateProjectile(item, path, () => {
            this.completeThrow(item, player, path, willHit);
        });
    }

    /**
     * Animate a projectile moving along a path
     * @param {Item} item - The item being thrown
     * @param {Array} path - Array of {x, y} points
     * @param {Function} onComplete - Callback when animation finishes
     */
    animateProjectile(item, path, onComplete) {
        const renderer = this.engine.renderer;
        if (!renderer || path.length === 0) {
            onComplete();
            return;
        }

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;
        const tileset = PIXI.Loader.shared.resources.tiles;

        if (!tileset || !item.tileIndex) {
            onComplete();
            return;
        }

        // Create projectile sprite
        const rect = new PIXI.Rectangle(
            item.tileIndex.x * tileWidth,
            item.tileIndex.y * tileHeight,
            tileWidth,
            tileHeight
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const projectileSprite = new PIXI.Sprite(texture);

        // Apply item tint if present
        if (item.tint !== undefined && item.tint !== null) {
            projectileSprite.tint = item.tint;
        }

        // Apply flip if present
        if (item.flipH || item.flipV) {
            projectileSprite.anchor.set(0.5, 0.5);
            projectileSprite.scale.x = item.flipH ? -1 : 1;
            projectileSprite.scale.y = item.flipV ? -1 : 1;
        }

        projectileSprite.zIndex = 100; // Above everything
        renderer.uiContainer.addChild(projectileSprite);

        // Animate through path
        let currentIndex = 0;
        const frameDelay = 25; // milliseconds per tile

        const animateFrame = () => {
            if (currentIndex >= path.length) {
                // Animation complete - remove sprite and call callback
                renderer.uiContainer.removeChild(projectileSprite);
                projectileSprite.destroy();
                onComplete();
                return;
            }

            const point = path[currentIndex];

            // Position sprite (account for anchor if flipped)
            if (item.flipH || item.flipV) {
                projectileSprite.x = point.x * tileWidth + tileWidth / 2;
                projectileSprite.y = point.y * tileHeight + tileHeight / 2;
            } else {
                projectileSprite.x = point.x * tileWidth;
                projectileSprite.y = point.y * tileHeight;
            }

            currentIndex++;
            setTimeout(animateFrame, frameDelay);
        };

        // Start animation
        animateFrame();
    }

    /**
     * Show a brief weapon swing visual at the target position
     * @param {Item} weapon - The weapon being swung
     * @param {number} targetX - Target tile X coordinate
     * @param {number} targetY - Target tile Y coordinate
     * @param {number} duration - How long to display (ms), default 100
     * @param {number|null} fromX - Attacker tile X, used to point the swing at the
     *   target. Omit for an unaimed swing (the weapon's authored flip is used as-is).
     * @param {number|null} fromY - Attacker tile Y, the vertical half of the same aim.
     */
    showWeaponSwing(weapon, targetX, targetY, duration = 100, fromX = null, fromY = null) {
        const renderer = this.engine.renderer;
        if (!renderer || !weapon?.tileIndex) return;

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;
        const tileset = PIXI.Loader.shared.resources.tiles;

        if (!tileset) return;

        // Create weapon sprite from tile
        const rect = new PIXI.Rectangle(
            weapon.tileIndex.x * tileWidth,
            weapon.tileIndex.y * tileHeight,
            tileWidth,
            tileHeight
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const weaponSprite = new PIXI.Sprite(texture);

        // Apply weapon tint if present
        if (weapon.tint !== undefined && weapon.tint !== null) {
            weaponSprite.tint = weapon.tint;
        }

        // Point the swing at whoever is being hit. Weapon art is drawn pointing up and
        // to the left, so a blow struck rightward or downward needs the tile mirrored on
        // that axis — otherwise every swing reads up-left no matter which neighbour took
        // it. Each axis is toggled independently, so a diagonal attack flips both.
        //
        // The aimed flip is XORed against the weapon's authored flip rather than
        // replacing it: most weapons ship `flipV: true`, and that orientation is the
        // baseline the mirroring is relative to. A caller that passes no origin (or an
        // attack with no displacement on an axis) keeps the authored value for it.
        let flipH = !!weapon.flipH;
        let flipV = !!weapon.flipV;
        if (fromX !== null && targetX !== fromX) {
            flipH = flipH !== (targetX > fromX);
        }
        if (fromY !== null && targetY !== fromY) {
            flipV = flipV !== (targetY > fromY);
        }

        // Apply flip if present
        if (flipH || flipV) {
            weaponSprite.anchor.set(0.5, 0.5);
            weaponSprite.scale.x = flipH ? -1 : 1;
            weaponSprite.scale.y = flipV ? -1 : 1;
            // Position at center of tile when using anchor
            weaponSprite.x = targetX * tileWidth + tileWidth / 2;
            weaponSprite.y = targetY * tileHeight + tileHeight / 2;
        } else {
            weaponSprite.x = targetX * tileWidth;
            weaponSprite.y = targetY * tileHeight;
        }

        weaponSprite.zIndex = 100; // Above everything
        renderer.uiContainer.addChild(weaponSprite);

        // Remove after duration
        setTimeout(() => {
            renderer.uiContainer.removeChild(weaponSprite);
            weaponSprite.destroy();
        }, duration);
    }

    /**
     * Complete the throw after animation - apply effects and place item
     * @param {Item} item - The thrown item
     * @param {Actor} player - The player who threw it
     * @param {Array} path - The path the item traveled
     * @param {boolean} willHit - Whether the throw hits a solid actor
     */
    completeThrow(item, player, path, willHit) {
        const landingPoint = path[path.length - 1];
        const isExplosive = item.hasAttribute('explosive');

        // Handle explosive items - they create a cloud and are always destroyed
        // Explosive items always hit (they explode on the tile regardless of accuracy)
        // Only breakable explosives (e.g. potions) detonate on throw; non-breakable ones (e.g. powder kegs) require fire
        if (isExplosive && item.hasAttribute('breakable')) {
            // Play break sound (e.g. glass shattering)
            const breakSound = item.getAttribute('break_sound');
            if (breakSound) this.engine.playSound(breakSound);
            // Play explode sound (e.g. gas cloud puff) — fire explosions play their own sound in createFireExplosion
            const explodeSound = item.getAttribute('explode_sound');
            if (explodeSound) this.engine.playSound(explodeSound);

            this.createExplosiveCloud(item, landingPoint.x, landingPoint.y);
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            this.engine.inputManager?.showMessage(`The ${displayName} explodes!`);

            // This counts as a player action
            this.engine.inputManager?.onPlayerAction();
            return;
        }

        if (willHit) {
            // Get the actor we're hitting
            const hitActor = this.engine.entityManager?.getActorAt(landingPoint.x, landingPoint.y);

            if (hitActor) {
                // Perform accuracy roll for thrown items
                const throwMissed = this.rollThrowAccuracy(player, hitActor);

                if (throwMissed) {
                    // Play miss sound
                    this.engine.playSound('arrow_miss');

                    // Throw missed
                    const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                    const targetName = hitActor.getNameWithArticle ? hitActor.getNameWithArticle() : `the ${hitActor.name}`;
                    this.engine.inputManager?.showMessage(`The ${displayName} misses ${targetName}!`);

                    if (item.hasAttribute('breakable')) {
                        // Breakable item shatters on miss
                        const breakSound = item.getAttribute('break_sound');
                        if (breakSound) this.engine.playSound(breakSound);
                        this.engine.inputManager?.showMessage(`The ${displayName} shatters! Its contents leak out harmlessly on the ground.`);
                    } else {
                        // Non-breakable item lands on adjacent floor tile
                        const missLandingPoint = this.findAdjacentFloorTile(landingPoint.x, landingPoint.y);
                        if (missLandingPoint) {
                            item.x = missLandingPoint.x;
                            item.y = missLandingPoint.y;
                        } else if (path.length > 1) {
                            // Fallback: land on tile before target
                            const landBeforeHit = path[path.length - 2];
                            item.x = landBeforeHit.x;
                            item.y = landBeforeHit.y;
                        } else {
                            // Last resort: land at player's feet
                            item.x = player.x;
                            item.y = player.y;
                        }
                        this.engine.entityManager.addEntity(item);
                    }
                } else {
                    // Play hit sound
                    const collisionSound = item.getAttribute('collision_sound') || 'arrow_hit';
                    this.engine.playSound(collisionSound);

                    // Throw hit - apply damage and effects
                    // Mark actor as hit this turn for flee_from_danger behavior
                    hitActor.wasHitThisTurn = true;

                    // Apply collision effect if the item has one
                    const collisionEffect = item.getAttribute('collision_effect');
                    if (collisionEffect) {
                        for (const [key, rawValue] of Object.entries(collisionEffect)) {
                            const value = player.resolveAttributeValue(rawValue, player);

                            if (hitActor.stats && hitActor.stats[key] !== undefined) {
                                const stat = hitActor.stats[key];
                                if (typeof stat === 'object' && stat.current !== undefined) {
                                    stat.current = Math.min(stat.max, Math.max(0, stat.current + value));
                                    if (key === 'health' && stat.current <= 0) {
                                        hitActor.die();
                                    }
                                }
                            }
                        }
                        hitActor.flash?.();
                        this.updateSidebar();
                    }

                    // Show hit message
                    const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                    const targetName = hitActor.getNameWithArticle ? hitActor.getNameWithArticle() : `the ${hitActor.name}`;
                    this.engine.inputManager?.showMessage(`The ${displayName} hits ${targetName}!`);

                    // Item lands at the tile before the hit (or destroyed if breakable)
                    // Items are breakable_on_throw by default (like Brogue) unless explicitly set to false
                    const breakable = item.getAttribute('breakable_on_throw') !== false;
                    if (breakable) {
                        // Play break sound (e.g. glass shattering)
                        const breakSound = item.getAttribute('break_sound');
                        if (breakSound) this.engine.playSound(breakSound);

                        // Item is destroyed on impact
                        const displayName2 = item.getDisplayName ? item.getDisplayName() : item.name;
                        this.engine.inputManager?.showMessage(`The ${displayName2} shatters!`);
                    } else if (path.length > 1) {
                        // Land one tile before the blocked tile
                        const landBeforeHit = path[path.length - 2];
                        item.x = landBeforeHit.x;
                        item.y = landBeforeHit.y;
                        this.engine.entityManager.addEntity(item);
                    } else {
                        // Path was only 1 tile, land at player's feet
                        item.x = player.x;
                        item.y = player.y;
                        this.engine.entityManager.addEntity(item);
                    }
                }
            }
        } else {
            // No hit - item lands at target
            if (item.hasAttribute('breakable')) {
                // Breakable item shatters on landing
                const breakSound = item.getAttribute('break_sound');
                if (breakSound) this.engine.playSound(breakSound);
                const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                this.engine.inputManager?.showMessage(`You throw the ${displayName}. It shatters! Its contents leak out harmlessly on the ground.`);
            } else {
                const fell = this.placeThrownItem(item, landingPoint.x, landingPoint.y);
                if (!fell) {
                    this.engine.playSound('arrow_miss');
                    const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                    this.engine.inputManager?.showMessage(`You throw the ${displayName}.`);
                }
            }
        }

        // If thrown item has 'ignites' (e.g. lit torch), start fire at landing position
        if (item.hasAttribute('ignites')) {
            const entityManager = this.engine.entityManager;
            // Use item.x/y if it landed on ground; fall back to landingPoint if it shattered
            const wasAdded = entityManager?.items?.includes(item);
            const fx = wasAdded ? item.x : landingPoint.x;
            const fy = wasAdded ? item.y : landingPoint.y;
            const newFire = entityManager?.spawnActor('fire', fx, fy);
            if (newFire) newFire.fireLifetime = newFire.lifetime || 5;
            // Directly ignite flammable items at the same tile (fire_spread only checks adjacent)
            const itemsHere = entityManager?.items?.filter(
                i => i.x === fx && i.y === fy && i !== item && i.hasAttribute('flammable') && !i.isDead
            ) ?? [];
            for (const flammableItem of itemsHere) {
                if (flammableItem.hasAttribute('explosive')) {
                    const name = flammableItem.getDisplayName?.() ?? flammableItem.name;
                    this.engine.inputManager?.showMessage(`The ${name} explodes!`);
                    this.createExplosiveCloud(flammableItem, fx, fy);
                }
                flammableItem.die();
            }
        }

        // If the item landed on a collapsible floor, collapse it first and let the
        // item fall through (may remove the item, so run before the trap check).
        this.checkCollapseTrigger(landingPoint.x, landingPoint.y, item);

        // Check if item landed on a trap and trigger it
        this.checkTrapTrigger(landingPoint.x, landingPoint.y, item);

        // This counts as a player action
        this.engine.inputManager?.onPlayerAction();
    }

    /**
     * True if (x,y) is a void tile: no floor tile and no platform actor there.
     * A thrown/dropped item on such a tile should fall to the floor below.
     * @param {number} x - Tile X
     * @param {number} y - Tile Y
     * @returns {boolean}
     */
    isVoidLanding(x, y) {
        const mapManager = this.engine.mapManager;
        if (!mapManager) return false;
        const hasFloor = !!mapManager.floorMap?.[y]?.[x]?.tileId;
        if (hasFloor) return false;
        const hasPlatform = this.engine.entityManager?.getActorsAt(x, y)
            .some(a => !a.isDead && a.hasAttribute('platform') && a.hasAttribute('visible'));
        return !hasPlatform;
    }

    /**
     * Place a thrown/landed item at (x,y). If that tile is void, the item falls to
     * the next floor instead of resting mid-air; otherwise it is added normally.
     * Returns true if the item fell through (so the caller can adjust messaging).
     * @param {Item} item - The item to place
     * @param {number} x - Landing tile X
     * @param {number} y - Landing tile Y
     * @returns {boolean} True if the item fell to a lower floor / was lost to the void
     */
    placeThrownItem(item, x, y) {
        if (this.isVoidLanding(x, y)) {
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            const fell = this.engine.itemFallsToNextFloor(item);
            this.engine.playSound('arrow_miss');
            this.engine.inputManager?.showMessage(
                fell
                    ? `The ${displayName} plunges into the depths!`
                    : `The ${displayName} vanishes into the void.`
            );
            return true;
        }
        item.x = x;
        item.y = y;
        this.engine.entityManager.addEntity(item);
        return false;
    }

    /**
     * Check if there's a trap at the given position and trigger it
     * Used when items land on traps from throwing
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {Item} item - The item that landed (to track for re-trigger prevention)
     */
    checkTrapTrigger(x, y, item) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        // Find any trap at this position
        const trap = entityManager.actors.find(
            a => a.x === x && a.y === y && !a.isDead && a.hasAttribute('trap')
        );

        if (!trap) return;

        // Initialize tracking set if needed
        if (!trap._triggeredBy) trap._triggeredBy = new Set();

        // Check if this item has already triggered this trap
        if (item && trap._triggeredBy.has(item)) return;

        // Mark this item as having triggered and flag trap as needing reset
        // Trap won't trigger again until the tile is completely empty, then something new steps on it
        if (item) {
            trap._triggeredBy.add(item);
            trap._needsReset = true;
        }

        // Springing a trap discovers it, permanently. reveal() handles the hidden
        // case (a concealed trap has no sprites yet); the fallback covers a trap
        // authored as plain `visible: false`. Silent — trap_message follows.
        if (trap.hasAttribute('hidden')) {
            trap.reveal({ silent: true });
        } else if (!trap.hasAttribute('visible')) {
            trap.setAttribute('visible', true);
            this.engine.renderer?.createActorSprites(trap);
        }

        // Show trap message
        const trapMessage = trap.data?.trap_message || `A trap is sprung!`;
        this.engine.inputManager?.showMessage(trapMessage);

        // Play trap sound
        this.engine.playSound?.('trap1');

        // Spawn the trap effect - supports two formats:
        // 1. trap_effect: { center, radius, outer } - spell-like area effect (like fireball)
        // 2. trap_spawn: "actor_type" - simple single actor spawn
        const trapEffect = trap.data?.trap_effect;
        if (trapEffect) {
            // Spell-like area effect
            const { center, radius = 0, outer } = trapEffect;
            const tx = trap.x;
            const ty = trap.y;

            // Spawn center actor
            if (center) {
                entityManager.spawnActor(center, tx, ty);
            }

            // Spawn actors in radius
            if (radius > 0) {
                const outerType = outer || center;
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        if (dx === 0 && dy === 0) continue; // Skip center
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= radius) {
                            entityManager.spawnActor(outerType, tx + dx, ty + dy);
                        }
                    }
                }
            }
        } else {
            // Simple single actor spawn
            const spawnType = trap.data?.trap_spawn;
            if (spawnType) {
                const spawnedActor = entityManager.spawnActor(spawnType, trap.x, trap.y);
                if (spawnedActor) {
                    // Apply custom tint if specified
                    const trapTint = trap.data?.trap_spawn_tint;
                    if (trapTint) {
                        spawnedActor.tint = trapTint;
                        if (spawnedActor.spriteBase) spawnedActor.spriteBase.tint = PIXI.utils.string2hex(trapTint);
                        if (spawnedActor.spriteTop) spawnedActor.spriteTop.tint = PIXI.utils.string2hex(trapTint);
                    }

                    // Apply custom collision effect if specified (for clouds)
                    const trapCollisionEffect = trap.data?.trap_collision_effect;
                    if (trapCollisionEffect) {
                        spawnedActor.setAttribute('collision_effect', trapCollisionEffect);
                    }

                    // Apply state to apply if specified (for paralysis/confusion gas)
                    const trapApplyState = trap.data?.trap_apply_state;
                    if (trapApplyState) {
                        spawnedActor.setAttribute('apply_state', trapApplyState);
                    }

                    // Mark as origin cloud so it spreads
                    spawnedActor.isCloudOrigin = true;
                    spawnedActor.cloudOriginX = trap.x;
                    spawnedActor.cloudOriginY = trap.y;
                    spawnedActor.cloudLifetime = 8;
                }
            }
        }
    }

    /**
     * If a thrown item landed on a collapsible floor actor, activate the collapse
     * first (matching what happens when an actor steps onto it), then let the item
     * fall through the resulting void to the floor below.
     *
     * @param {number} x - Landing tile X
     * @param {number} y - Landing tile Y
     * @param {Item} item
     */
    checkCollapseTrigger(x, y, item) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        const collapsibles = entityManager.getActorsAt(x, y)
            .filter(a => !a.isDead && a.hasAttribute('collapsible'));
        if (collapsibles.length === 0) return;

        // Activate the collapse first (same feedback as an actor stepping on it).
        this.engine.renderer?.effectRunner?.apply('collapse_shake');
        this.engine.playSound('push1');
        for (const floor of collapsibles) {
            floor.collapse();
        }

        // If the item is still on this floor (not shattered/burned up), it now has
        // no floor beneath it — send it down through the fresh void.
        const stillPlaced = entityManager.items.includes(item) && !item.isDead;
        if (stillPlaced) {
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            const fell = this.engine.itemFallsToNextFloor(item);
            entityManager.removeEntity(item);
            this.engine.inputManager?.showMessage(
                fell
                    ? `The floor gives way and the ${displayName} plunges into the depths!`
                    : `The floor gives way and the ${displayName} vanishes into the void.`
            );
        }
    }

    /**
     * Create an explosive cloud from a thrown item
     * Spawns a cloud actor with the item's tint and use_effect as collision_effect
     * @param {Item} item - The explosive item
     * @param {number} x - Landing X coordinate
     * @param {number} y - Landing Y coordinate
     */
    createExplosiveCloud(item, x, y) {
        if (item.getAttribute('fire_explosion')) {
            this.createFireExplosion(item, x, y);
            return;
        }

        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        // Spawn the origin cloud
        const cloud = entityManager.spawnActor('cloud', x, y);
        if (!cloud) return;

        // Set cloud properties from the item
        cloud.tint = item.tint;

        // Use the item's use_effect as the cloud's collision_effect
        const useEffect = item.getAttribute('use_effect');
        if (useEffect && typeof useEffect === 'object') {
            // Extract apply_state separately from stat effects
            if (useEffect.apply_state) {
                cloud.setAttribute('apply_state', useEffect.apply_state);
            }

            // Set remaining properties as collision_effect (for stat damage)
            const collisionEffect = { ...useEffect };
            delete collisionEffect.apply_state;
            if (Object.keys(collisionEffect).length > 0) {
                cloud.setAttribute('collision_effect', collisionEffect);
            }
        }

        // Mark as origin cloud so it spreads
        cloud.isCloudOrigin = true;
        cloud.cloudOriginX = x;
        cloud.cloudOriginY = y;

        // Get lifetime from item, or fall back to cloud actor's default lifetime
        cloud.cloudLifetime = item.getAttribute('cloud_lifetime') || cloud.lifetime || 10;

        // Update sprite tints
        if (cloud.spriteBase) cloud.spriteBase.tint = item.tint;
        if (cloud.spriteTop) cloud.spriteTop.tint = item.tint;
    }

    /**
     * Create a fire explosion from an item with fire_explosion attribute.
     * Spawns intense_fire at the center and nearby tiles, regular fire at the outer
     * radius, and gives breakable solid actors a chance to be destroyed.
     * @param {Item} item - The explosive item
     * @param {number} x - Center X coordinate
     * @param {number} y - Center Y coordinate
     */
    createFireExplosion(item, x, y) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        this.engine.playSound?.('fireball');

        const radius = item.getAttribute('explosion_radius') || 2;
        const mapManager = this.engine.mapManager;

        // Spawn fire at all tiles within radius
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const tx = x + dx;
                const ty = y + dy;

                // Check floor exists
                const floorTile = mapManager?.floorMap[ty]?.[tx];
                if (!floorTile || floorTile.tileId <= 0) continue;

                // Skip if fire already present
                const existingFire = entityManager.actors.find(
                    a => a.x === tx && a.y === ty && (a.type === 'fire' || a.type === 'intense_fire') && !a.isDead
                );
                if (existingFire) continue;

                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const fireType = dist <= 1 ? 'intense_fire' : 'fire';
                entityManager.spawnActor(fireType, tx, ty);
            }
        }

        // Destroy nearby breakable solid actors
        for (const other of entityManager.actors) {
            if (other.isDead) continue;
            if (!other.hasAttribute('breakable') || !other.hasAttribute('solid')) continue;
            if (other.hasAttribute('fireproof')) continue;

            const dist = Math.max(Math.abs(other.x - x), Math.abs(other.y - y));
            if (dist > radius) continue;

            if (Math.random() < 0.6) {
                if (other.hasAttribute('visible')) {
                    const otherName = other.getNameWithArticle ? other.getNameWithArticle() : `the ${other.name}`;
                    this.engine.inputManager?.showMessage(`The explosion destroys ${otherName}!`);
                }
                other.die();
            }
        }
    }

    /**
     * Handle keyboard input during throw aiming mode
     * @param {string} key - The key pressed
     * @returns {boolean} True if key was handled
     */
    handleThrowKey(key, event) {
        if (!this.throwAimingMode) return false;

        if (key === 'Escape') {
            this.exitThrowAimingMode();
            return true;
        }

        if (this.isCycleTargetKey(event)) {
            this.cycleAimTarget();
            return true;
        }

        if (this.isConfirmTargetKey(event)) {
            this.executeThrow();
            return true;
        }

        return true; // Consume all keys while in throw mode
    }

    /**
     * Handle mouse click during throw aiming mode
     * @returns {boolean} True if click was handled
     */
    handleThrowClick() {
        if (!this.throwAimingMode) return false;

        this.executeThrow();
        return true;
    }

    /**
     * Check if in throw aiming mode
     * @returns {boolean}
     */
    isThrowAiming() {
        return this.throwAimingMode;
    }

    // ========================================================================
    // SPELL AIMING MODE (for targeted spells like fireball)
    // ========================================================================

    /**
     * Enter spell aiming mode for a targeted spell item
     * @param {Item} item - The item casting the spell
     * @param {Actor} caster - The actor using the item
     */
    enterSpellAimingMode(item, caster) {
        this.spellAimingMode = true;
        this.spellItem = item;
        this.spellCaster = caster;
        this.currentPlayer = caster;

        this.aimTargets = null;
        this.aimTargetIndex = -1;

        // Close any open menus
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        // Start aimed at the nearest valid target, so zapping works without a mouse.
        const seeded = this.seedAimTarget(SPELL_DEFAULT_TARGETS);

        const im = this.engine.inputManager;
        const cycleKey = im?.getKeyForAction('cycle_target', 'Tab') || 'Tab';
        const confirmKey = im?.getKeyForAction('confirm_target', 'Enter') || 'Enter';
        this.showTextBox('spell_instructions',
            `[${cycleKey}] to target, [${confirmKey}] or click to cast. Esc to cancel.`, {
            dismissOnMove: false
        });

        // Update the spell path based on current mouse position
        this.updateSpellPath();
        if (seeded) this.announceAimTarget(seeded);
    }

    /**
     * Open the identify item picker — player selects one unidentified item to identify.
     * The scroll item and caster are stored; actual identification happens on item selection.
     */
    enterIdentifyMode(scrollItem, caster) {
        const unidentified = (caster.inventory || []).filter(i => i !== scrollItem && i.identified === false);
        if (unidentified.length === 0) {
            if (scrollItem && !scrollItem.identified) {
                scrollItem.identify();
                const identifiedName = scrollItem.getDisplayName ? scrollItem.getDisplayName() : scrollItem.name;
                this.engine.inputManager?.showMessage(`It's a ${identifiedName}!`);
            }
            this.engine.inputManager?.showMessage('You have nothing to identify.');
            this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
            this.engine.playSound?.('tone1');
            if (caster && scrollItem) {
                caster.inventory = caster.inventory.filter(i => i !== scrollItem);
            }
            return;
        }

        this.identifyMode = true;
        this.identifyScrollItem = scrollItem;
        this.identifyCaster = caster;
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this._showIdentifyPicker(unidentified);
    }

    /**
     * Render the identify item picker box.
     */
    _showIdentifyPicker(unidentified) {
        this.removeBox('identify_picker');

        const lines = ['Identify which item?', ''];
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        for (let i = 0; i < unidentified.length && i < letters.length; i++) {
            const displayName = unidentified[i].getDisplayName ? unidentified[i].getDisplayName() : unidentified[i].name;
            lines.push(`  ${letters[i]}) ${displayName}`);
        }
        lines.push('');
        lines.push('  Esc) Cancel');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 14);
        const boxWidth = maxLineLength + padding * 2 + 2;
        const boxHeight = lines.length + padding * 2 + 2;
        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox('identify_picker', x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: Math.min(unidentified.length, letters.length) },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, maxLineLength, padding);

        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + lineIndex * globalVars.TILE_HEIGHT;
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    }

    /**
     * Handle a click inside the identify picker box.
     * contentLine 0 = title, 1 = blank, 2+ = item entries (a, b, c…).
     */
    _handleIdentifyClick(contentLine) {
        const itemLine = contentLine - 2; // first two lines are header + blank
        if (itemLine < 0) return;
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        this.handleInventoryKey(letters[itemLine]);
    }

    /**
     * Exit identify mode without identifying anything.
     */
    exitIdentifyMode() {
        this.identifyMode = false;
        this.identifyScrollItem = null;
        this.identifyCaster = null;
        this.removeBox('identify_picker');
        this.updateBoxOverlays();
    }

    enterEnchantMode(scrollItem, caster) {
        const enchantable = (caster.inventory || []).filter(i =>
            i !== scrollItem && i.getAttribute('enchantable')
        );
        if (enchantable.length === 0) {
            this.engine.inputManager?.showMessage('You have nothing to enchant.');
            this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
            this.engine.playSound?.('tone1');
            if (caster && scrollItem) {
                caster.inventory = caster.inventory.filter(i => i !== scrollItem);
            }
            return;
        }

        this.enchantMode = true;
        this.enchantScrollItem = scrollItem;
        this.enchantCaster = caster;
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this._showEnchantPicker(enchantable);
    }

    _showEnchantPicker(enchantable) {
        this.removeBox('enchant_picker');

        const lines = ['Enchant which item?', ''];
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        for (let i = 0; i < enchantable.length && i < letters.length; i++) {
            const item = enchantable[i];
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            lines.push(`  ${letters[i]}) ${displayName}`);
        }
        lines.push('');
        lines.push('  Esc) Cancel');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 14);
        const boxWidth = maxLineLength + padding * 2 + 2;
        const boxHeight = lines.length + padding * 2 + 2;
        // Centered horizontally; vertically placed away from the player.
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox('enchant_picker', x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: Math.min(enchantable.length, letters.length) },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, maxLineLength, padding);

        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + lineIndex * globalVars.TILE_HEIGHT;
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    }

    exitEnchantMode() {
        this.enchantMode = false;
        this.enchantScrollItem = null;
        this.enchantCaster = null;
        this.removeBox('enchant_picker');
        this.updateBoxOverlays();
    }

    /**
     * Exit spell aiming mode without casting
     */
    exitSpellAimingMode() {
        this.spellAimingMode = false;
        this.spellItem = null;
        this.spellCaster = null;

        // Hide the line path
        this.engine.renderer?.hideLinePath();

        // Remove instruction message
        this.removeTextBox('spell_instructions');

        // Re-enable normal tile highlight
        this.engine.renderer?.hideTileHighlight();

        // Restore walk path display for current hovered tile
        const inputManager = this.engine.inputManager;
        if (inputManager && inputManager.hoveredTile.x >= 0) {
            inputManager.updateWalkPath(inputManager.hoveredTile.x, inputManager.hoveredTile.y);
        }
    }

    /**
     * Update the spell path line based on current mouse position
     */
    updateSpellPath() {
        if (!this.spellAimingMode || !this.spellCaster) return;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return;

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't draw path if mouse is off-screen or on caster
        if (targetX < 0 || targetY < 0) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        if (targetX === this.spellCaster.x && targetY === this.spellCaster.y) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        // Check spell range (only if defined). Don't reveal the range boundary for an
        // unidentified item — the gray out-of-range flip would let the player read off
        // the exact range (and thus narrow down the item) before identifying it.
        const range = this.spellItem?.getAttribute('spell_range');
        let pathColor = 0xFF6600; // Default orange for spells

        if (range && this.spellItem?.identified) {
            const dx = targetX - this.spellCaster.x;
            const dy = targetY - this.spellCaster.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            pathColor = distance <= range ? 0xFF6600 : 0x666666; // Orange if in range, gray if out
        }

        // Detect bolt spells for pass-through targeting
        const spellEffect = this.spellItem?.getAttribute('spell_effect');
        const isBolt = spellEffect?.type === 'bolt';

        // Show the line path from caster to target
        this.engine.renderer?.showLinePath(
            this.spellCaster.x,
            this.spellCaster.y,
            targetX,
            targetY,
            isBolt ? 0xFFFF44 : pathColor,
            null,
            isBolt ? { passThrough: true } : {}
        );
    }

    /**
     * Execute the spell at the current target position
     */
    executeSpell() {
        if (!this.spellAimingMode || !this.spellCaster || !this.spellItem) {
            return;
        }

        const inputManager = this.engine.inputManager;
        if (!inputManager) {
            return;
        }

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't cast if mouse is off-screen or on caster
        if (targetX < 0 || targetY < 0) {
            return;
        }
        if (targetX === this.spellCaster.x && targetY === this.spellCaster.y) {
            return;
        }

        // Check spell range (only if spell_range is defined). Tiles actually cast to.
        let castX = targetX;
        let castY = targetY;
        const range = this.spellItem.getAttribute('spell_range');
        if (range) {
            const dx = targetX - this.spellCaster.x;
            const dy = targetY - this.spellCaster.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > range) {
                if (this.spellItem.identified) {
                    // Identified item: enforce the known range with a clear message.
                    const displayName = this.spellItem.getDisplayName ? this.spellItem.getDisplayName() : this.spellItem.name;
                    this.engine.inputManager?.showMessage(`Target is out of range for ${displayName}.`);
                    return;
                }
                // Unidentified item: don't reveal the range by rejecting the cast (that
                // would let the player fish for the exact range). Silently clamp the
                // target to the last in-range tile along the aim line so the effect can't
                // reach farther than the true range either.
                const clamped = getLinePath(this.spellCaster.x, this.spellCaster.y, targetX, targetY)
                    .filter(p => {
                        const pdx = p.x - this.spellCaster.x;
                        const pdy = p.y - this.spellCaster.y;
                        return Math.sqrt(pdx * pdx + pdy * pdy) <= range;
                    });
                const endpoint = clamped[clamped.length - 1];
                if (endpoint) {
                    castX = endpoint.x;
                    castY = endpoint.y;
                }
            }
        }

        // Get spell effect to check for bolt type
        const spellEffect = this.spellItem?.getAttribute('spell_effect') || { center: 'fire', radius: 0 };
        const isBolt = spellEffect.type === 'bolt';

        // Get the actual landing position (may be blocked by solid actor for line-of-sight spells)
        const pathResult = this.engine.renderer?.showLinePath(
            this.spellCaster.x,
            this.spellCaster.y,
            castX,
            castY,
            undefined,
            null,
            isBolt ? { passThrough: true } : {}
        );

        if (!pathResult || pathResult.path.length === 0) return;

        // Store references before exiting aiming mode
        const item = this.spellItem;
        const caster = this.spellCaster;
        const path = pathResult.path;
        const landingPoint = path[path.length - 1];

        // Exit aiming mode
        this.exitSpellAimingMode();

        // Consume charge from item stat if applicable
        // Cost per use is max / uses (or ready_at if specified)
        const chargeStat = item.getAttribute('charge_stat');
        if (chargeStat && item.stats?.[chargeStat]) {
            const stat = item.stats[chargeStat];
            const uses = item.getAttribute('uses') || 1;
            const useCost = stat.ready_at || Math.floor(stat.max / uses);
            item.modifyStat(chargeStat, -useCost);
        }

        // Play spell cast sound
        const castSound = item.getAttribute('cast_sound') || 'fire';
        this.engine.playSound(castSound);

        if (isBolt) {
            // Bolt spells use tile fill effect instead of projectile animation
            this.engine.renderer?.effectRunner.apply('lightning_bolt', caster, { path });
            // Delay completion slightly so the visual leads the damage
            const fillDuration = path.length * 25 + 100;
            setTimeout(() => {
                this.completeBoltSpell(item, caster, path, spellEffect);
            }, fillDuration);
        } else {
            // Animate projectile to target, then spawn effects
            this.animateSpellProjectile(item, path, () => {
                this.completeSpell(item, caster, landingPoint, spellEffect);
            });
        }
    }

    /**
     * Animate a spell projectile along a path
     * @param {Item} item - The item casting the spell
     * @param {Array} path - Array of {x, y} points
     * @param {Function} onComplete - Callback when animation finishes
     */
    animateSpellProjectile(item, path, onComplete) {
        const renderer = this.engine.renderer;
        if (!renderer || path.length === 0) {
            onComplete();
            return;
        }

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;
        const tileset = PIXI.Loader.shared.resources.tiles;

        // Get projectile tile from item, or use a default fireball tile
        let projectileTile = item.getAttribute('projectile_tile') || item.tileIndex;
        // Resolve tile name to coordinates if it's a string
        if (typeof projectileTile === 'string') {
            projectileTile = this.engine.spriteLibrary?.resolveTile(projectileTile);
        }
        const projectileTint = item.getAttribute('projectile_tint') || item.tint || 0xFF6600;

        if (!tileset || !projectileTile) {
            onComplete();
            return;
        }

        // Create projectile sprite
        const rect = new PIXI.Rectangle(
            projectileTile.x * tileWidth,
            projectileTile.y * tileHeight,
            tileWidth,
            tileHeight
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const projectileSprite = new PIXI.Sprite(texture);

        // Apply tint
        if (projectileTint !== undefined && projectileTint !== null) {
            projectileSprite.tint = typeof projectileTint === 'string' ?
                parseInt(projectileTint.replace('#', ''), 16) : projectileTint;
        }

        projectileSprite.zIndex = 100; // Above everything
        renderer.uiContainer.addChild(projectileSprite);

        // Animate through path
        let currentIndex = 0;
        const frameDelay = 20; // milliseconds per tile (faster than thrown items)

        const animateFrame = () => {
            if (currentIndex >= path.length) {
                // Animation complete - remove sprite and call callback
                renderer.uiContainer.removeChild(projectileSprite);
                projectileSprite.destroy();
                onComplete();
                return;
            }

            const point = path[currentIndex];
            projectileSprite.x = point.x * tileWidth;
            projectileSprite.y = point.y * tileHeight;

            currentIndex++;
            setTimeout(animateFrame, frameDelay);
        };

        // Start animation
        animateFrame();
    }

    /**
     * Complete the spell - spawn effect actors at target
     * @param {Item} item - The spell item
     * @param {Actor} caster - The actor who cast it
     * @param {Object} landingPoint - {x, y} where spell lands
     * @param {Object} spellEffect - Effect configuration {center, radius, outer}
     */
    completeSpell(item, caster, landingPoint, spellEffect) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        const { center, radius = 0, outer } = spellEffect;
        const x = landingPoint.x;
        const y = landingPoint.y;

        // Spawn center actor
        if (center) {
            entityManager.spawnActor(center, x, y);
        }

        // Spawn actors in radius
        if (radius > 0) {
            const outerType = outer || center;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (dx === 0 && dy === 0) continue; // Skip center
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= radius) {
                        entityManager.spawnActor(outerType, x + dx, y + dy);
                    }
                }
            }
        }

        // Apply state to target actor if spell has apply_state
        if (spellEffect.apply_state) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const statesData = this.engine.globalStates;
                if (statesData?.[spellEffect.apply_state]) {
                    target.applyState(spellEffect.apply_state, statesData[spellEffect.apply_state]);
                    this.engine.inputManager?.showMessage(`${target.name} is affected!`);
                }
            }
        }

        // Remove all states from target
        if (spellEffect.remove_states) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const stateNames = Object.keys(target.states || {});
                for (const sn of stateNames) {
                    target.removeState(sn, true);
                }
                if (stateNames.length > 0) {
                    this.engine.inputManager?.showMessage(`${target.name}'s enchantments are stripped away!`);
                }
            }
        }

        // Teleport target to random walkable tile
        if (spellEffect.teleport_target) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const walkable = this.engine.mapManager?.walkableTiles;
                if (walkable?.length) {
                    const candidates = walkable.filter(t => !entityManager.getSolidActorAt(t.x, t.y));
                    if (candidates.length > 0) {
                        const dest = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
                        target.x = dest.x;
                        target.y = dest.y;
                        target.updateSpritePosition();
                        this.engine.lightingManager?.computeLighting();
                        this.engine.inputManager?.showMessage(`${target.name} vanishes!`);
                    }
                }
            }
        }

        // Pull target toward caster
        if (spellEffect.beckon_target) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const dx = Math.sign(caster.x - target.x);
                const dy = Math.sign(caster.y - target.y);
                let moved = false;
                // Pull target tile by tile toward caster
                for (let i = 0; i < 20; i++) {
                    const nx = target.x + dx;
                    const ny = target.y + dy;
                    if (nx === caster.x && ny === caster.y) break;
                    if (!target.isPassableAt(nx, ny)) break;
                    target.x = nx;
                    target.y = ny;
                    moved = true;
                }
                if (moved) {
                    target.updateSpritePosition();
                    this.engine.playSound?.('push1');
                    this.engine.inputManager?.showMessage(`${target.name} is pulled toward you!`);
                }
            }
        }

        // Blink caster to target tile (fall back to last walkable tile along the path)
        if (spellEffect.blink_self) {
            const blinkPath = getLinePath(caster.x, caster.y, landingPoint.x, landingPoint.y);
            let blinkDest = null;
            for (let i = blinkPath.length - 1; i >= 1; i--) {
                const p = blinkPath[i];
                if (caster.hasFloorAt(p.x, p.y) && !entityManager.getSolidActorAt(p.x, p.y)) {
                    blinkDest = p;
                    break;
                }
            }
            if (blinkDest) {
                caster.x = blinkDest.x;
                caster.y = blinkDest.y;
                caster.updateSpritePosition();
                this.engine.lightingManager?.computeLighting();
                if (caster.isPlayerControlled()) {
                    this.engine.renderer?.centerViewportOnPlayer?.();
                }
                this.engine.renderer?.effectRunner?.apply('blink');
            } else {
                this.engine.inputManager?.showMessage('You cannot blink there.');
            }
        }

        // Identify the item after successful cast
        if (!item.identified) {
            item.identify();
            const identifiedName = item.getDisplayName ? item.getDisplayName() : item.name;
            this.engine.inputManager?.showMessage(`You identified the ${identifiedName}!`);
        }

        // Show cast message
        const spellName = item.getAttribute('spell_name') || (item.getDisplayName ? item.getDisplayName() : item.name);
        this.engine.inputManager?.showMessage(`You cast ${spellName}!`);

        // Update sidebar
        this.updateSidebar();

        // This counts as a player action
        this.engine.inputManager?.onPlayerAction();
    }

    /**
     * Complete a bolt spell - damage every creature along the path
     * @param {Item} item - The spell item
     * @param {Actor} caster - The actor who cast it
     * @param {Array} path - Array of {x, y} points the bolt travels through
     * @param {Object} spellEffect - Effect configuration {type, bolt_damage}
     */
    completeBoltSpell(item, caster, path, spellEffect) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        const damage = spellEffect.bolt_damage || -10;

        for (const point of path) {
            const actor = entityManager.getSolidActorAt(point.x, point.y);
            if (actor && actor !== caster && !actor.isDead && actor.stats?.health) {
                actor.modifyStat('health', damage, { source: item });
                this.engine.inputManager?.showMessage(
                    `The lightning bolt strikes ${actor.getNameWithArticle()}!`
                );
                if (actor.getStat?.('health') <= 0) actor.die();
            }
        }

        // Identify the item after successful cast
        if (!item.identified) {
            item.identify();
            const identifiedName = item.getDisplayName ? item.getDisplayName() : item.name;
            this.engine.inputManager?.showMessage(`You identified the ${identifiedName}!`);
        }

        // Show cast message
        const spellName = item.getAttribute('spell_name') || (item.getDisplayName ? item.getDisplayName() : item.name);
        this.engine.inputManager?.showMessage(`You cast ${spellName}!`);

        // Update sidebar
        this.updateSidebar();

        // This counts as a player action
        this.engine.inputManager?.onPlayerAction();
    }

    /**
     * Handle keyboard input during spell aiming mode
     *
     * Consumes every key while aiming, matching handleThrowKey. It used to fall
     * through on unrecognized keys, which let target-cycling reach the global
     * handler and start an explore preview in the middle of a cast.
     *
     * @param {string} key - The key pressed
     * @param {KeyboardEvent} [event] - The raw event, for resolving keybindings
     * @returns {boolean} True if key was handled
     */
    handleSpellAimingKey(key, event) {
        if (!this.spellAimingMode) return false;
        if (key === 'Escape') {
            this.exitSpellAimingMode();
            return true;
        }
        if (this.isCycleTargetKey(event)) {
            this.cycleAimTarget();
            return true;
        }
        if (this.isConfirmTargetKey(event)) {
            this.executeSpell();
            return true;
        }
        if (MODIFIER_KEYS.has(key)) return false;
        return true;
    }

    /**
     * Handle mouse click during spell aiming mode
     * @returns {boolean} True if click was handled
     */
    handleSpellAimingClick() {
        if (!this.spellAimingMode) return false;
        this.executeSpell();
        return true;
    }

    /**
     * Check if in spell aiming mode
     * @returns {boolean}
     */
    isSpellAiming() {
        return this.spellAimingMode;
    }

    // ========================================================================
    // SPIKE DIRECTION PICKER (J key / Jam use_verb)
    // ========================================================================

    enterSpikeDirectionMode(item, caster) {
        const dirs = [
            { dx: 0, dy: -1, name: 'north' },
            { dx: 0, dy: 1, name: 'south' },
            { dx: -1, dy: 0, name: 'west' },
            { dx: 1, dy: 0, name: 'east' }
        ];

        const adjacentDoors = [];
        for (const dir of dirs) {
            const tx = caster.x + dir.dx;
            const ty = caster.y + dir.dy;
            const actors = this.engine.entityManager.getActorsAt(tx, ty);
            for (const actor of actors) {
                // `hidden` first: an undiscovered secret door satisfies every other
                // condition here, so without it the picker offers a door the player
                // has no reason to know exists — and with only one neighbour it
                // silently auto-spikes it, spending a spike on an invisible door.
                if (actor.hasAttribute('openable') &&
                    !actor.hasAttribute('hidden') &&
                    !actor.hasAttribute('open') &&
                    !actor.hasAttribute('locked') &&
                    !actor.hasAttribute('spiked')) {
                    adjacentDoors.push({ actor, dir });
                }
            }
        }

        if (adjacentDoors.length === 0) {
            this.engine.inputManager?.showMessage('There are no doors here to spike.');
            return;
        }

        if (adjacentDoors.length === 1) {
            this.applySpikeToDirection(item, caster, adjacentDoors[0]);
            return;
        }

        this.spikeDirectionMode = true;
        this.spikeItem = item;
        this.spikeCaster = caster;
        this.spikeAdjacentDoors = adjacentDoors;

        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        this.showTextBox('spike_instructions',
            'Spike which door? (movement keys, Esc to cancel)',
            { dismissOnMove: false }
        );
    }

    applySpikeToDirection(item, caster, doorInfo) {
        this.exitSpikeDirectionMode();

        const success = doorInfo.actor.spike();
        if (success) {
            if (item.count > 1) {
                item.count--;
            } else {
                caster.inventory = caster.inventory.filter(i => i !== item);
            }
            this.engine.inputManager?.onPlayerAction();
        }
    }

    exitSpikeDirectionMode() {
        this.spikeDirectionMode = false;
        this.spikeItem = null;
        this.spikeCaster = null;
        this.spikeAdjacentDoors = null;
        this.removeTextBox('spike_instructions');
    }

    handleSpikeDirectionKey(key) {
        if (!this.spikeDirectionMode) return false;

        if (key === 'Escape') {
            this.exitSpikeDirectionMode();
            return true;
        }

        // Resolve through the player's actual movement bindings rather than a private
        // copy, so rebinding movement in keybindings.json steers this prompt too.
        const inputMgr = this.engine.inputManager;
        const action = inputMgr?.keyMap?.[key];
        const dir = action ? inputMgr.directions?.[action] : null;
        if (!dir) return true;

        const match = this.spikeAdjacentDoors?.find(
            d => d.dir.dx === dir.dx && d.dir.dy === dir.dy
        );

        if (match) {
            this.applySpikeToDirection(this.spikeItem, this.spikeCaster, match);
        } else {
            this.engine.inputManager?.showMessage("There's no door in that direction.");
        }

        return true;
    }

    handleSpikeDirectionClick() {
        if (!this.spikeDirectionMode || !this.spikeCaster) return false;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return false;

        const tx = inputManager.hoveredTile.x;
        const ty = inputManager.hoveredTile.y;

        const match = this.spikeAdjacentDoors?.find(
            d => d.actor.x === tx && d.actor.y === ty
        );

        if (match) {
            this.applySpikeToDirection(this.spikeItem, this.spikeCaster, match);
        }

        return true;
    }

    // ========================================================================
    // DIG DIRECTION PICKER (Dig use_verb)
    // ========================================================================

    /**
     * Pick a target for the Dig verb: any `breakable` within one tile, including the
     * tile the digger is standing on (a grave is walkable, so standing on it is the
     * common case) and including solid walls, which the verb digs exactly as bumping
     * them while equipped would.
     *
     * The tool comes from the inventory, not the equipment slot — you can dig with a
     * mattock you're only carrying. Equipping it is still what lets you bump walls and
     * swing it at enemies; this is the deliberate, one-target use.
     *
     * The dig itself is just applyCollisionEffects, the same call behaviors.js
     * `mine_nearby_wall` uses, so the whole mining pipeline (glance roll, progress,
     * tool wear, loot on break) comes along unchanged.
     */
    enterDigDirectionMode(item, caster) {
        if (!caster) return;

        const candidates = [];
        // The digger's own tile first, so a lone diggable underfoot needs no prompt.
        const cells = [{ dx: 0, dy: 0 }, ...ALL_DIRS];
        for (const dir of cells) {
            const tx = caster.x + dir.dx;
            const ty = caster.y + dir.dy;
            const actors = this.engine.entityManager.getActorsAt(tx, ty);
            for (const actor of actors) {
                if (actor === caster || actor.isDead) continue;
                if (!actor.hasAttribute('breakable')) continue;
                candidates.push({ actor, dir });
            }
        }

        if (candidates.length === 0) {
            this.engine.inputManager?.showMessage('There is nothing here to dig.');
            return;
        }

        if (candidates.length === 1) {
            this.applyDigToDirection(item, caster, candidates[0]);
            return;
        }

        this.digDirectionMode = true;
        this.digItem = item;
        this.digCaster = caster;
        this.digCandidates = candidates;

        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        const here = candidates.some(c => c.dir.dx === 0 && c.dir.dy === 0);
        this.showTextBox('dig_instructions',
            here
                ? 'Dig where? (movement keys, wait key for here, Esc to cancel)'
                : 'Dig where? (movement keys, Esc to cancel)',
            { dismissOnMove: false }
        );
    }

    applyDigToDirection(item, caster, target) {
        this.exitDigDirectionMode();

        // Pass the tool explicitly: it may be sitting in the pack rather than the
        // equipment slot, and its own mining_power/dig_chance/condition are the ones
        // that should count. The tool isn't consumed — digging wears `condition` via
        // degradeItem inside the mining path, so there's nothing to decrement here.
        const result = caster.applyCollisionEffects(target.actor, item);
        if (result?.attackAttempted) {
            this.engine.inputManager?.onPlayerAction();
        }
    }

    exitDigDirectionMode() {
        this.digDirectionMode = false;
        this.digItem = null;
        this.digCaster = null;
        this.digCandidates = null;
        this.removeTextBox('dig_instructions');
    }

    handleDigDirectionKey(key) {
        if (!this.digDirectionMode) return false;

        if (key === 'Escape') {
            this.exitDigDirectionMode();
            return true;
        }

        // Resolve through the player's actual bindings so rebinding movement (or wait)
        // in keybindings.json steers this prompt too.
        const inputMgr = this.engine.inputManager;
        const action = inputMgr?.keyMap?.[key];
        if (!action) return true;

        // The digger's own tile has no direction key, so the wait binding selects it.
        const dir = action === 'wait'
            ? { dx: 0, dy: 0 }
            : inputMgr.directions?.[action];
        if (!dir) return true;

        const match = this.digCandidates?.find(
            c => c.dir.dx === dir.dx && c.dir.dy === dir.dy
        );

        if (match) {
            this.applyDigToDirection(this.digItem, this.digCaster, match);
        } else {
            this.engine.inputManager?.showMessage("There's nothing to dig that way.");
        }

        return true;
    }

    handleDigDirectionClick() {
        if (!this.digDirectionMode || !this.digCaster) return false;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return false;

        const tx = inputManager.hoveredTile.x;
        const ty = inputManager.hoveredTile.y;

        const match = this.digCandidates?.find(
            c => c.actor.x === tx && c.actor.y === ty
        );

        if (match) {
            this.applyDigToDirection(this.digItem, this.digCaster, match);
        }

        return true;
    }

    // ========================================================================
    // THROW ITEM MENU (T key)
    // ========================================================================

    /**
     * Show a menu to select an item to throw
     * @param {Actor} player - The player actor
     */
    showThrowItemMenu(player) {
        if (!player || !player.inventory || player.inventory.length === 0) {
            // No items to throw
            this.showTextBox('throw_menu_empty', 'You have nothing to throw.', {
                dismissOnMove: true
            });
            return;
        }

        this.clearTargetingHighlights();

        this.currentPlayer = player;
        this.throwMenuMode = true;

        const menuId = 'throw_item_menu';

        // Remove existing if present
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        // Build menu lines
        const lines = [];
        lines.push('Throw which item?');
        lines.push('');

        // List all inventory items with letter keys
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            const letter = String.fromCharCode(97 + i); // 'a', 'b', 'c', etc.
            let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            displayName = this.colorizeItemName(this.truncateText(displayName, 26));
            let itemText = `${letter})  ${displayName}`;
            // Mark equipped items
            if (player.isItemEquipped(item)) {
                itemText += item.hasAttribute('weapon') ? ' (equipped)' : ' (worn)';
            }
            lines.push('  ' + itemText);
        }

        lines.push('');
        lines.push('Esc to cancel');

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        // Create the box
        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._itemStartLine = 2; // Items start after "Throw which item?" and blank line
        boxContainer._itemCount = player.inventory.length;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: player.inventory.length },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);

        // Add text sprites
        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        // Render item tiles (offset for "  a) " = 5 chars)
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            const lineIndex = i + 2; // Account for header and blank line
            const tileX = textStartX + (5 * globalVars.TILE_WIDTH);
            const tileY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderItemTile(boxContainer, item, tileX, tileY);
        }

        this.updateBoxOverlays();
    }

    /**
     * Close the throw item menu
     */
    closeThrowItemMenu() {
        this.removeBox('throw_item_menu');
        this.throwMenuMode = false;
        this.updateBoxOverlays();
    }

    /**
     * Handle keyboard input for throw item menu
     * @param {string} key - The key pressed
     * @returns {boolean} True if key was handled
     */
    handleThrowMenuKey(key) {
        if (!this.throwMenuMode || !this.currentPlayer) return false;

        if (key === 'Escape') {
            this.closeThrowItemMenu();
            return true;
        }

        // Handle letter keys for item selection (a-z)
        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const itemIndex = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
            if (itemIndex < this.currentPlayer.inventory.length) {
                const item = this.currentPlayer.inventory[itemIndex];
                this.closeThrowItemMenu();
                this.enterThrowAimingMode(item);
                return true;
            }
        }

        return true; // Consume all keys while menu is open
    }

    // ========================================================================
    // EQUIPMENT MENU (E key)
    // ========================================================================

    /**
     * Toggle the equipment menu
     * @param {Actor} player - The player actor
     */
    toggleEquipmentMenu(player) {
        if (this.equipmentMenuMode) {
            this.closeEquipmentMenu();
        } else {
            this.showEquipmentMenu(player);
        }
    }

    handleDiscoveryKey(key) {
        if (!this.boxes.has('discovery_panel')) return false;
        if (key === 'Escape' || key === 'd' || key === 'D') {
            this.removeBox('discovery_panel');
            return true;
        }
        return true;
    }

    toggleDiscoveryPanel() {
        const boxId = 'discovery_panel';
        if (this.boxes.has(boxId)) {
            this.removeBox(boxId);
            return;
        }

        const prototype = this.engine.currentPrototype;
        if (!prototype || prototype.activeCatalog.size === 0) {
            this.engine.inputManager?.showMessage('No item catalog active.');
            return;
        }

        const lines = ['Item Discovery', ''];
        const barWidth = 16;

        for (const [category, types] of prototype.activeCatalog) {
            const stats = prototype.getCatalogStats(category);
            if (!stats) continue;
            const label = category.charAt(0).toUpperCase() + category.slice(1);
            const filled = Math.round((stats.discovered / stats.total) * barWidth);
            const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
            lines.push(`  ${label.padEnd(10)} ${bar} ${stats.discovered}/${stats.total}`);
        }

        lines.push('');
        lines.push('  Esc/d) Close');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 14);
        const boxWidth = maxLineLength + padding * 2 + 2;
        const boxHeight = lines.length + padding * 2 + 2;
        // Centered horizontally; vertically placed away from the player.
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox(boxId, x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            // The title line (0) renders white; the rest use the default black.
            const baseColor = lineIndex === 0 ? 0xFFFFFF : this.defaultTextTint;
            const charY = textStartY + lineIndex * globalVars.TILE_HEIGHT;
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY, baseColor);
        }

        this.updateBoxOverlays();
    }

    /**
     * Show the equipment menu listing all wearable and equippable items
     * @param {Actor} player - The player actor
     */
    showEquipmentMenu(player) {
        if (!player || !player.inventory) return;

        // Close other menus
        this.hidePlayerInfo();
        this.closeThrowItemMenu();

        this.equipmentMenuPlayer = player;
        this.equipmentMenuMode = true;

        const menuId = 'equipment_menu';

        // Remove existing if present
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        // Build list of equippable/wearable items
        this.equipmentMenuItems = [];
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            if (item.hasAttribute('wearable') || item.hasAttribute('weapon')) {
                this.equipmentMenuItems.push({
                    item: item,
                    inventoryIndex: i
                });
            }
        }

        // Build menu lines
        const lines = [];
        lines.push('Equipment');
        lines.push('');

        // Show current equipment slots
        lines.push('Equipped:');
        const weapon = player.getEquippedWeapon?.();
        const topItem = player.equipment?.top;
        const middleItem = player.equipment?.middle;
        const lowerItem = player.equipment?.lower;

        lines.push(`  Weapon: ${weapon ? weapon.name : '(none)'}`);
        lines.push(`  Head:   ${topItem ? topItem.name : '(none)'}`);
        lines.push(`  Body:   ${middleItem ? middleItem.name : '(none)'}`);
        lines.push(`  Legs:   ${lowerItem ? lowerItem.name : '(none)'}`);
        lines.push('');

        let itemsStartLine = -1;
        if (this.equipmentMenuItems.length === 0) {
            lines.push('No equippable items');
        } else {
            lines.push('Items:');
            itemsStartLine = lines.length; // Line index of first item option
            for (let i = 0; i < this.equipmentMenuItems.length; i++) {
                const entry = this.equipmentMenuItems[i];
                const item = entry.item;
                const letter = String.fromCharCode(97 + i); // 'a', 'b', 'c', etc.
                let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                displayName = this.colorizeItemName(this.truncateText(displayName, 24));

                const isEquipped = player.isItemEquipped(item);
                let status = '';
                if (isEquipped) {
                    status = item.hasAttribute('weapon') ? ' [E]' : ' [W]';
                }

                lines.push(`  ${letter})  ${displayName}${status}`);
            }
        }

        lines.push('');
        lines.push('Esc to close');

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 20);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        // Create the box
        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._itemStartLine = itemsStartLine;
        boxContainer._itemCount = this.equipmentMenuItems.length;

        // Zebra-stripe the item rows
        if (itemsStartLine !== -1) {
            const stripeRows = Array.from({ length: this.equipmentMenuItems.length },
                (_, i) => ({ lineIndex: itemsStartLine + i }));
            this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);
        }

        // Add text sprites
        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        // Render item tiles next to item names (offset for "  a) " = 5 chars)
        for (let i = 0; i < this.equipmentMenuItems.length; i++) {
            const entry = this.equipmentMenuItems[i];
            const lineIndex = itemsStartLine + i;
            const tileX = textStartX + (5 * globalVars.TILE_WIDTH);
            const tileY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderItemTile(boxContainer, entry.item, tileX, tileY);
        }

        this.updateBoxOverlays();
    }

    /**
     * Close the equipment menu
     */
    closeEquipmentMenu() {
        this.removeBox('equipment_menu');
        this.equipmentMenuMode = false;
        this.equipmentMenuPlayer = null;
        this.equipmentMenuItems = [];
        this.updateBoxOverlays();
    }

    /**
     * Handle keyboard input for equipment menu
     * @param {string} key - The key pressed
     * @returns {boolean} True if key was handled
     */
    handleEquipmentKey(key) {
        if (!this.equipmentMenuMode || !this.equipmentMenuPlayer) return false;

        if (key === 'Escape' || key === 'e' || key === 'E') {
            this.closeEquipmentMenu();
            return true;
        }

        // Handle letter keys for item selection (a-z)
        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const itemIndex = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
            if (itemIndex < this.equipmentMenuItems.length) {
                const entry = this.equipmentMenuItems[itemIndex];
                const item = entry.item;
                const player = this.equipmentMenuPlayer;

                // Toggle equip/unequip
                if (player.isItemEquipped(item)) {
                    player.unequipItem(item);
                    this.engine.playSound?.('tap2');
                } else {
                    player.equipItem(item);
                    this.engine.playSound?.('tap2');
                }

                // Refresh the menu to show updated state
                this.showEquipmentMenu(player);
                return true;
            }
        }

        return true; // Consume all keys while menu is open
    }

    // ========================================================================
    // ACTORS AND ITEMS DIVS
    // ========================================================================

    /**
     * Update the actors div with visible actors and their stats
     * Controllable actors (like Player) are listed first
     */
    updateActorsDiv() {
        const actorsDiv = document.getElementById('actors');
        if (!actorsDiv) return;

        const entityManager = this.engine.entityManager;
        if (!entityManager) {
            actorsDiv.innerHTML = '';
            return;
        }

        // Get all living actors
        const actors = entityManager.actors.filter(a => !a.isDead);
        if (actors.length === 0) {
            actorsDiv.innerHTML = '';
            return;
        }

        // Filter to visible actors with stats (or all if darkness is off)
        const visibleActors = actors.filter(a =>
            this.engine.isTileVisible(a.x, a.y) &&
            a.stats && Object.keys(a.stats).length > 0 &&
            (!a.isUnseen?.() || a.hasAttribute('controlled'))
        );

        // Sort: controlled actors first, then non-controlled by distance to the
        // player (nearest first) so a crowded level surfaces the closest threats;
        // fall back to name for ties / when there's no player to measure from.
        const player = entityManager.player;
        const distTo = (a) => player
            ? Math.max(Math.abs(a.x - player.x), Math.abs(a.y - player.y))
            : 0;
        visibleActors.sort((a, b) => {
            const aControlled = a.hasAttribute('controlled') ? 0 : 1;
            const bControlled = b.hasAttribute('controlled') ? 0 : 1;
            if (aControlled !== bControlled) return aControlled - bControlled;
            const da = distTo(a), db = distTo(b);
            if (da !== db) return da - db;
            return a.name.localeCompare(b.name);
        });

        // Render one actor's entry block.
        const renderActor = (actor) => {
            let html = `<div class="actor-entry">`;
            html += `<strong class="actor-name">${actor.name}`;

            // Show equipping status with dots for progress
            if (actor.isEquipping && actor.isEquipping()) {
                const turnsCompleted = actor._equippingTurnsTotal - actor._equippingTurnsLeft;
                const dots = '.'.repeat(turnsCompleted);
                html += ` <span class="equipping-status">(equipping${dots})</span>`;
            }

            html += `</strong>`;

            // Show active conditions (confused, blinded, burning, etc.)
            if (actor.states && Object.keys(actor.states).length > 0) {
                html += '<div class="actor-conditions">';
                for (const [key, state] of Object.entries(actor.states)) {
                    const displayName = state.data && state.data.name ? state.data.name : key;
                    const durationText = state.duration === Infinity ? 'always' : state.duration;
                    const colorStyle = state.data?.tint ? ` style="color: ${state.data.tint}"` : '';
                    html += `<span class="actor-condition"${colorStyle}>${displayName} (${durationText})</span>`;
                }
                html += '</div>';
            }

            // Add stats as thermometer fills with ratio in an unordered list
            if (actor.stats && Object.keys(actor.stats).length > 0) {
                html += '<ul class="actor-stats">';
                for (const [key, value] of Object.entries(actor.stats)) {
                    const current = value.current;
                    const max = value.max;

                    // Skip 1/1 stats (one-hit death games)
                    if (max === 1 && current === 1) continue;

                    const percentage = max > 0 ? Math.round((current / max) * 100) : 0;

                    html += `<li>`;
                    html += `<span class="stat-label">${this.capitalize(key)}</span>`;
                    html += `<figure class="stat-thermometer">`;
                    html += `<div class="stat-fill" style="width: ${percentage}%"></div>`;
                    html += `</figure>`;
                    // Only show ratio numbers for stats with max <= 100
                    if (max <= 100) {
                        html += `<span class="stat-ratio">${this.formatStatValue(current)}/${this.formatStatValue(max)}</span>`;
                    }
                    html += `</li>`;
                }
                html += '</ul>';
            }

            // For controlled actors, show integer attributes as plain numbers
            if (actor.hasAttribute('controlled') && actor.attributes instanceof Map) {
                let attributesHtml = '';
                for (const [key, value] of actor.attributes) {
                    if (typeof value === 'number' && Number.isInteger(value)) {
                        attributesHtml += `<li>`;
                        attributesHtml += `<span class="stat-label">${this.capitalize(key)}</span>`;

                        // Inventory is special - show as current/max ratio
                        if (key === 'inventory') {
                            const currentItems = actor.inventory ? actor.inventory.length : 0;
                            attributesHtml += `<span class="stat-value">${currentItems}/${value}</span>`;
                        } else {
                            // Use effective values for stats with equipment/passive bonuses
                            let displayValue = value;
                            if (key === 'defense' && actor.getEffectiveDefense) {
                                displayValue = actor.getEffectiveDefense();
                            } else if (key === 'strength' && actor.getEffectiveStrength) {
                                displayValue = actor.getEffectiveStrength();
                            } else if (key === 'accuracy' && actor.getEffectiveAccuracy) {
                                displayValue = actor.getEffectiveAccuracy();
                            }
                            attributesHtml += `<span class="stat-value">${displayValue}</span>`;
                        }

                        attributesHtml += `</li>`;
                    }
                }
                if (attributesHtml) {
                    html += `<ul class="actor-attributes">${attributesHtml}</ul>`;
                }
            }

            html += '</div>';
            return html;
        };

        // Cap the list: show the first N (controlled + nearest), and tuck any
        // overflow into a collapsible <details> so a crowded level doesn't flood
        // the sidebar. Short lists render exactly as before (no disclosure).
        const MAX_SHOWN = 5;
        if (visibleActors.length <= MAX_SHOWN) {
            actorsDiv.innerHTML = visibleActors.map(renderActor).join('');
        } else {
            const shown = visibleActors.slice(0, MAX_SHOWN);
            const rest = visibleActors.slice(MAX_SHOWN);
            const shownHtml = shown.map(renderActor).join('');
            const restHtml = rest.map(renderActor).join('');
            actorsDiv.innerHTML =
                shownHtml +
                `<details class="actor-overflow"><summary>${rest.length} more…</summary>${restHtml}</details>`;
        }
    }

    /**
     * Update the items div with visible items
     */
    updateItemsDiv() {
        const itemsDiv = document.getElementById('items');
        if (!itemsDiv) return;

        const entityManager = this.engine.entityManager;
        if (!entityManager) {
            itemsDiv.innerHTML = '';
            return;
        }

        // Get all items on the map (not in inventory)
        const items = entityManager.items;
        if (items.length === 0) {
            itemsDiv.innerHTML = '';
            return;
        }

        // Filter to visible items (or all if darkness is off)
        const visibleItems = items.filter(item => this.engine.isTileVisible(item.x, item.y));

        if (visibleItems.length === 0) {
            itemsDiv.innerHTML = '';
            return;
        }

        // Group items by display name and count duplicates
        const itemCounts = new Map();
        for (const item of visibleItems) {
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            itemCounts.set(displayName, (itemCounts.get(displayName) || 0) + 1);
        }

        const listItems = [];
        for (const [name, count] of itemCounts) {
            listItems.push(count > 1 ? `<li>${name} x${count}</li>` : `<li>${name}</li>`);
        }

        itemsDiv.innerHTML = `<details><summary><strong>Visible Items</strong></summary><ul>${listItems.join('')}</ul></details>`;
    }

    /**
     * Mark the actor/item sidebar dirty and ensure a flush is scheduled.
     * Cheap to call many times per turn (every entity add/remove, every move under
     * darkness) — the actual innerHTML rebuild happens once on the next animation
     * frame instead of once per call, avoiding a per-event DOM-reflow storm.
     */
    updateSidebar() {
        this._sidebarDirty = true;
        if (!this._sidebarFlushScheduled) {
            this._sidebarFlushScheduled = true;
            requestAnimationFrame(this._flushSidebarBound);
        }
    }

    // Rebuild the actor/item panels now if anything marked them dirty. Called from
    // the scheduled animation frame; safe to call directly when an immediate,
    // synchronous refresh is required (e.g. just before reading layout).
    _flushSidebar() {
        this._sidebarFlushScheduled = false;
        if (!this._sidebarDirty) return;
        this._sidebarDirty = false;
        this.updateActorsDiv();
        this.updateItemsDiv();
    }

    // ========================================================================
    // USE ITEM MENU (quaff, read, etc.)
    // ========================================================================

    showUseMenu(player, verb, prompt) {
        if (!player || !player.inventory) return;

        this.hidePlayerInfo();
        this.closeThrowItemMenu();
        this.closeEquipmentMenu();

        this.useMenuPlayer = player;

        this.useMenuItems = [];
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            if (item.getAttribute('use_verb') === verb) {
                this.useMenuItems.push(item);
            }
        }

        if (this.useMenuItems.length === 0) {
            this.engine.inputManager?.showMessage(`You have nothing to ${verb.toLowerCase()}.`);
            return;
        }

        this.useMenuMode = true;

        const menuId = 'use_item_menu';
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        const lines = [];
        lines.push(prompt);
        lines.push('');

        for (let i = 0; i < this.useMenuItems.length; i++) {
            const item = this.useMenuItems[i];
            const letter = String.fromCharCode(97 + i);
            let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            displayName = this.colorizeItemName(this.truncateText(displayName, 22));
            lines.push(` ${letter}) ${displayName}`);
        }

        lines.push('');
        lines.push('Esc to cancel');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: this.useMenuItems.length },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);

        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        for (let i = 0; i < this.useMenuItems.length; i++) {
            const item = this.useMenuItems[i];
            const lineIndex = i + 2;
            const tileX = textStartX + (4 * globalVars.TILE_WIDTH);
            const tileY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderItemTile(boxContainer, item, tileX, tileY);
        }

        this.updateBoxOverlays();
    }

    closeUseMenu() {
        this.removeBox('use_item_menu');
        this.useMenuMode = false;
        this.useMenuPlayer = null;
        this.useMenuItems = [];
        this.updateBoxOverlays();
    }

    handleUseMenuKey(key) {
        if (!this.useMenuMode || !this.useMenuPlayer) return false;

        if (key === 'Escape') {
            this.closeUseMenu();
            return true;
        }

        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const idx = key.charCodeAt(0) - 97;
            if (idx < this.useMenuItems.length) {
                const item = this.useMenuItems[idx];
                const player = this.useMenuPlayer;
                this.closeUseMenu();
                this.currentPlayer = player;
                this.executeUseItem(item);
                return true;
            }
        }

        return true;
    }

    // ========================================================================
    // ACTOR INFO
    // ========================================================================

    /**
     * Any key dismisses the actor info panel.
     *
     * Unlike the other handle*Key methods this is NOT modal: the panel is a read, not
     * a prompt, and it is big enough to cover much of the map — so leaving it up while
     * play continues is never what the player wants. Esc is consumed (its whole job
     * was to close), but every other key closes the panel and then falls through to
     * do its normal work, so reading a monster never costs an extra keystroke.
     *
     * Turn-taking actions arriving by other routes (mouse travel, menus) are covered
     * by InputManager.onPlayerAction, which closes the panel too.
     *
     * @returns {boolean} True only if the key was consumed and should not dispatch
     */
    handleActorInfoKey(key) {
        if (!this.actorInfoMode) return false;
        // Modifier presses on their own aren't actions; closing on them would make the
        // panel vanish as the player reaches for a shifted key.
        if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return false;
        this.closeActorInfo();
        return key === 'Escape';
    }

    /**
     * Describe an actor: what it is, what it can do, and — for a tactician — how a
     * fight with it would go.
     *
     * Modelled on Brogue's monsterDetails (Monsters.c), which assembles flavour text,
     * threat math, your-side math and a trait list into one panel. The combat lines
     * are gated on the viewer's `tactician` attribute so a prototype decides whether
     * its player reads fights numerically or has to judge them by eye.
     *
     * @param {Actor} actor - The actor to describe
     * @param {Actor} [viewer] - Whose perspective the combat math is from
     * @param {Object} [options] - See openInfoPanel
     */
    showActorInfo(actor, viewer = null, options = {}) {
        this.openInfoPanel(actor, viewer, options, (target, v, wrap) => {
            const lines = [];

            const description = target.getDescription?.();
            if (description) {
                for (const line of this.wrapText(description, wrap)) lines.push(line);
                lines.push('');
            }

            // Traits, joined as prose: "It flies, sees in the dark and burns easily."
            const traits = target.getTraitPhrases?.() || [];
            if (traits.length) {
                for (const line of this.wrapText(`It ${this.joinProse(traits)}.`, wrap)) {
                    lines.push(line);
                }
                lines.push('');
            }

            // Combat math — opt-in per prototype via `tactician` on the viewing actor.
            // Skipped when looking at yourself: the panel would be comparing you to you.
            if (v && v !== target && v.hasAttribute?.('tactician')) {
                for (const line of this.buildCombatLines(target, v, wrap)) lines.push(line);
            }

            return lines;
        });
    }

    /**
     * The item counterpart of showActorInfo — same box, same modes, same intro, so a
     * hover that crosses from a monster to a dropped sword behaves identically.
     *
     * @param {Item} item - The item to describe
     * @param {Actor} [viewer] - Whose stats the equip forecast compares against
     * @param {Object} [options] - As showActorInfo
     */
    showItemInfo(item, viewer = null, options = {}) {
        this.openInfoPanel(item, viewer, options,
            (target, v, wrap) => this.buildItemInfoLines(target, v, wrap));
    }

    /**
     * What a hallucinating viewer sees instead of the truth, or null when they see
     * straight. The name is the SAME scrambled tile the sidebar hover line uses
     * (`_hallucinatedTileNameBase`, set per tick by the texture_scramble effect), so the
     * panel and the line above it always name the same thing.
     *
     * Inventory items are exempt: you know what you're carrying. Only what's out in the
     * world is in doubt, which is the split docs/IDEAS.md asks for.
     *
     * The prose is a template, so the vocabulary lives in words.json —
     * `hallucinated_states` was authored for exactly this and had no reader until now.
     * Re-rolled per call rather than memoized: the name has to hold still so the panel
     * and the sidebar agree, but the thing it's *doing* churning each time is the point.
     *
     * @returns {{name: string, lines: string[]}|null}
     */
    hallucinatedIdentity(target, viewer) {
        if (!viewer?.hasStateProperty?.('hallucinating')) return null;
        if (target === viewer) return null;
        // Carried items are known. Tested by inventory membership rather than
        // `item.owner`, which survives a drop and would exempt the item forever.
        if (viewer.inventory?.includes(target)) return null;

        const im = this.engine.inputManager;
        const name = im?.hallucinatedNameFor
            ? im.hallucinatedNameFor(target)
            : (target._hallucinatedTileNameBase || 'something').toLowerCase().replace(/_/g, ' ');

        const text = resolveTemplate(
            InterfaceManager.HALLUCINATION_TEMPLATE,
            target,
            { providers: { hallucinated_name: () => name } }
        );

        return { name, lines: this.wrapText(text, 30) };
    }

    /**
     * The shell both info panels share: name heading, mode handling, sizing, placement
     * and the optional grow intro. `buildBody` supplies everything between the heading
     * and the footer, so an actor and an item differ only in their text.
     *
     * Two modes. The keyboard route (Tab + Enter) is `sticky`: it takes over as the
     * active box and holds until Esc, because the player asked a deliberate question.
     * Hover is not — a passive read that must not steal the active box or swallow Esc,
     * and closes itself when the pointer leaves.
     *
     * @param {Actor|Item} target - What the panel is about
     * @param {Actor|null} viewer - Whose perspective the body is written from
     * @param {Object} options
     * @param {boolean} [options.sticky=true] - Hold until dismissed (keyboard route)
     * @param {boolean} [options.grow=false] - Play the box-grow intro from the target.
     *   Hover uses it; the keyboard route opens flat, since Tab already moved the
     *   player's attention there and a second flourish would only delay it.
     * @param {function(target, viewer, wrap): string[]} buildBody - Body lines
     */
    openInfoPanel(target, viewer, options, buildBody) {
        if (!target) return;
        const sticky = options.sticky ?? true;
        if (!target.hasInfoPanel?.()) return;
        viewer = viewer || this.engine.entityManager?.player || null;

        if (sticky) this.hidePlayerInfo();
        this.closeActorInfo();
        if (sticky) this.clearTargetingHighlights();

        this.actorInfoMode = sticky;
        this.actorInfoActor = target;

        const boxId = 'actor_info';
        const WRAP = 30;

        // Hallucinating, the player can't identify what they're looking at — the sidebar
        // hover line already scrambles the name, so a panel naming it outright would
        // contradict the line directly above it.
        const deceived = this.hallucinatedIdentity(target, viewer);

        const name = deceived ? deceived.name
            : (target.getDisplayName ? target.getDisplayName() : target.name);
        const lines = [this.capitalize(name), ''];
        const body = deceived ? deceived.lines : buildBody(target, viewer, WRAP);
        for (const line of body) lines.push(line);

        // Sections close with a blank spacer, which the footer sits on. Without a footer
        // that spacer would be a ragged empty row at the bottom of the box.
        while (lines.length && lines[lines.length - 1] === '') lines.pop();

        // Only the sticky panel needs dismissing; a hover panel goes away by itself, so
        // telling the player to press Esc would be a lie.
        if (sticky) {
            lines.push('');
            lines.push('Esc to close');
        }

        const padding = 1;
        const contentWidth = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = lines.length + (padding * 2) + 2;

        // Keep the box off the target as well as the player — you are pointing at it.
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight, { avoid: target });

        const drawPanel = () => {
            const boxContainer = this.createBox(boxId, x, y, boxWidth, boxHeight);
            if (!boxContainer) { this.actorInfoMode = false; this.actorInfoActor = null; return; }

            const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
            const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;
            for (let i = 0; i < lines.length; i++) {
                this.renderTextLine(boxContainer, lines[i],
                    textStartX, textStartY + (i * globalVars.TILE_HEIGHT));
            }

            this.updateBoxOverlays();
        };

        if (options.grow) {
            this.growBoxOpen({
                id: boxId, x, y, width: boxWidth, height: boxHeight,
                from: target,
                draw: drawPanel,
                // Anything that closed the panel mid-intro (a keypress, the pointer
                // moving on) abandons it rather than letting it finish into a panel.
                abort: () => this.actorInfoActor !== target,
            });
        } else {
            drawPanel();
        }
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

    /**
     * The two-sided combat forecast, as wrapped lines. Both directions come from
     * Actor.predictCombat, which shares its arithmetic with the live damage path, so
     * these numbers are a promise the engine actually keeps.
     * @returns {string[]}
     */
    buildCombatLines(actor, viewer, wrap) {
        const out = [];
        const push = (text) => {
            for (const line of this.wrapText(text, wrap)) out.push(line);
        };

        const yours = viewer.predictCombat?.(actor);
        const theirs = actor.predictCombat?.(viewer);

        if (yours) {
            if (yours.immune) {
                push(`You cannot harm it.`);
            } else if (yours.noDamage) {
                push(`You deal it no direct damage.`);
            } else {
                let s = `You have a ${yours.hitChance}% chance to hit it`;
                s += `, and could defeat it in ${yours.hitsToKill} hit${yours.hitsToKill === 1 ? '' : 's'}`;
                // Only worth stating when a crit would actually save a swing.
                if (yours.bestHitsToKill && yours.bestHitsToKill < yours.hitsToKill) {
                    s += ` — ${yours.bestHitsToKill} with a lucky strike`;
                }
                push(s + '.');
                if (yours.backstab) push('It has not noticed you.');
            }
            out.push('');
        }

        if (theirs) {
            if (theirs.immune || theirs.noDamage) {
                push(`It deals no direct damage.`);
            } else {
                const n = theirs.hitsToKill;
                push(`It has a ${theirs.hitChance}% chance to hit you, and could defeat you in ${n} hit${n === 1 ? '' : 's'}.`);
            }
            out.push('');
        }

        return out;
    }

    /**
     * The full text of an item info panel, as wrapped lines — in Brogue's order
     * (Items.c:1750): what it is, what it does, then the numbers. The heading is the
     * caller's, since the inventory menu already draws one.
     *
     * Identification gating lives in Item.getPanelDescription, not here.
     *
     * @param {Item} item - The item to describe
     * @param {Actor|null} viewer - Whose stats the equip forecast compares against
     * @param {number} wrap - Wrap width in characters
     * @returns {string[]}
     */
    buildItemInfoLines(item, viewer = null, wrap = 30) {
        const out = [];
        const push = (text) => {
            for (const line of this.wrapText(text, wrap)) out.push(line);
        };
        const gap = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };

        const identified = item.identified !== false;

        const description = item.getPanelDescription?.();
        if (description) push(description);

        // Identified only: on a potion the effect IS the secret.
        if (identified) {
            const effect = item.getEffectDescription?.();
            if (effect) {
                gap();
                // Authored as a fragment ("It restores Health"), so may lack a full stop.
                push(/[.!?]$/.test(effect) ? effect : `${effect}.`);
            }
        }

        if (viewer) {
            const preview = item.previewEquipDelta?.(viewer);
            if (preview) {
                gap();
                for (const line of this.buildEquipForecastLines(item, preview, identified, wrap)) {
                    out.push(line);
                }
            }
        }

        // Fuel and condition are visible on the item itself, so they don't wait on
        // identification — a staff's charge count does, being part of what ID tells you.
        const chargeStat = item.getAttribute('charge_stat');
        const statLines = [];
        for (const [key, stat] of Object.entries(item.stats || {})) {
            if (!stat || typeof stat !== 'object' || stat.max === undefined) continue;
            if (key === chargeStat && !identified) continue;
            const label = stat.display_label || this.capitalize(key);
            statLines.push(`${label}: ${Math.round(stat.current ?? stat.max)}/${stat.max}`);
        }
        if (statLines.length) {
            gap();
            for (const line of statLines) out.push(line);
        }

        // Only when the category had no stand-in text of its own — those already end on
        // the mystery ("no telling what it does until it is drunk"), so this would repeat.
        if (!identified && !this.categoryBlurbFor(item)) {
            gap();
            push('Its properties are unknown.');
        }

        while (out.length && out[out.length - 1] === '') out.pop();
        return out;
    }

    /** The unidentified stand-in text for an item's category, if types.json defines one. */
    categoryBlurbFor(item) {
        const types = this.engine.currentPrototype?.types;
        return types?.[item.getCategory?.()]?.unidentified_description || null;
    }

    /**
     * The equip forecast: what wearing or wielding this would do, and what comes off.
     * Brogue reports percentage deltas (Items.c:1981); absolute before/after reads better
     * on small integer stats, and can't divide by zero against an unarmed player.
     *
     * @returns {string[]}
     */
    buildEquipForecastLines(item, preview, identified, wrap) {
        const out = [];
        const push = (text) => {
            for (const line of this.wrapText(text, wrap)) out.push(line);
        };

        const verb = preview.slot === 'weapon' ? 'Wielding' : 'Wearing';

        // Leads, being the most important thing on the panel. canEquipItem reads the base
        // stat, so a strength ring won't get you into heavy armour — the rule as enforced.
        if (!preview.canEquip) {
            push(`You cannot equip this. ${preview.reason}.`);
            return out;
        }

        if (preview.changes.length) {
            const deltas = preview.changes.map(c => `${c.stat} from ${c.from} to ${c.to}`);
            push(`${verb} this would change your ${this.joinProse(deltas)}.`);
        } else if (identified) {
            push(`${verb} this would change none of your stats.`);
        }

        // Named, not implied: with both ring slots full the equip path takes ring1
        // specifically, so the player needs to know which ring actually goes.
        if (preview.displaced) {
            const name = preview.displaced.getDisplayName?.() || preview.displaced.name;
            push(`It would replace your ${name}.`);
        }

        // Shown for anything enchantABLE, not only what is enchanted — otherwise the
        // caveat's presence would itself reveal which items carry one.
        if (!identified && preview.changes.length && item.hasAttribute('enchantable')) {
            push('This assumes it bears no enchantment.');
        }

        return out;
    }

    closeActorInfo() {
        // A pending open is as much "the panel" as a drawn one: closing has to cancel
        // both the hover delay and any running open intro, or a panel would pop up
        // after the thing that closed it.
        this.cancelPendingHoverInfo();
        this.cancelBoxGrow('actor_info');

        // actorInfoActor is part of the test: a hover panel leaves actorInfoMode false,
        // so checking only the box and the mode could strand that reference — and
        // updateHoverInfo compares against it to decide whether to re-open.
        if (!this.boxes.has('actor_info') && !this.actorInfoMode && !this.actorInfoActor) return;
        this.removeBox('actor_info');
        this.actorInfoMode = false;
        this.actorInfoActor = null;
        this.updateBoxOverlays();
    }

    /**
     * Schedule a hover panel for `target`, replacing any pending one.
     *
     * The delay is the point: the pointer must rest on the target, so sweeping across a
     * room of monsters opens nothing. Re-requesting the SAME target keeps the existing
     * timer rather than restarting it, so a pointer drifting within one large actor
     * still opens on schedule instead of never.
     */
    scheduleHoverInfo(target, viewer) {
        if (this.actorInfoHoverPending === target) return;
        this.cancelPendingHoverInfo();
        this.actorInfoHoverPending = target;
        this.actorInfoHoverTimer = setTimeout(() => {
            this.actorInfoHoverTimer = null;
            this.actorInfoHoverPending = null;
            if (target.isDead) return;
            this.showEntityInfo(target, viewer, { sticky: false, grow: true });
        }, InterfaceManager.HOVER_INFO_DELAY);
    }

    /**
     * Open the info panel for an Actor or an Item, whichever this is. Both share one box
     * and one hover timer, so the two routes cannot open competing panels.
     */
    showEntityInfo(target, viewer = null, options = {}) {
        // Duck-typed rather than instanceof: getPanelDescription is the item-only method
        // the panel is actually built on.
        if (target?.getPanelDescription) return this.showItemInfo(target, viewer, options);
        return this.showActorInfo(target, viewer, options);
    }

    /** Drop a scheduled-but-unopened hover panel. */
    cancelPendingHoverInfo() {
        if (this.actorInfoHoverTimer) {
            clearTimeout(this.actorInfoHoverTimer);
            this.actorInfoHoverTimer = null;
        }
        this.actorInfoHoverPending = null;
    }

    // ========================================================================
    // HELP WINDOW
    // ========================================================================

    handleHelpKey(key) {
        if (this.helpWindowMode) {
            if (key === '?' || key === 'Escape') {
                this.closeHelpWindow();
                return true;
            }
            return false;
        }
        if (key === '?') {
            this.showHelpWindow();
            return true;
        }
        return false;
    }

    showHelpWindow() {
        this.hidePlayerInfo();
        this.closeThrowItemMenu();
        this.closeEquipmentMenu();

        this.helpWindowMode = true;

        const menuId = 'help_window';
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        const bindings = this.engine.currentPrototype?.keybindings || this.engine.globalKeybindings || {};
        const actionDescriptions = bindings.descriptions || {};

        // Shared with InputManager.getKeyForAction, so the keybindings screen and
        // in-game prompts shorten key names the same way.
        const formatKey = (key) => InputManager.formatKeyName(key);

        const inputMgr = this.engine.inputManager;
        const actionKeys = {};

        for (const [key, action] of Object.entries(inputMgr.keyMap)) {
            if (action.startsWith('move_')) continue;
            if (!actionKeys[action]) actionKeys[action] = [];
            const formatted = formatKey(key);
            if (!actionKeys[action].includes(formatted) &&
                !actionKeys[action].includes(formatted.toLowerCase())) {
                actionKeys[action].push(formatted);
            }
        }

        for (const [key, action] of Object.entries(inputMgr.globalKeyMap)) {
            if (!actionKeys[action]) actionKeys[action] = [];
            const formatted = formatKey(key);
            if (!actionKeys[action].includes(formatted)) {
                actionKeys[action].push(formatted);
            }
        }

        const pickKeys = (action) => {
            const keys = actionKeys[action];
            if (!keys || keys.length === 0) return '';
            const lower = keys.filter(k => k.length === 1 && k >= 'a' && k <= 'z');
            const upper = keys.filter(k => k.length === 1 && k >= 'A' && k <= 'Z');
            const symbols = keys.filter(k => k.length === 1 && !(k >= 'a' && k <= 'z') && !(k >= 'A' && k <= 'Z'));
            const special = keys.filter(k => k.length > 1);
            const best = [...lower, ...upper, ...symbols, ...special];
            return best.slice(0, 2).join('/');
        };

        const pad = (str, len) => str + ' '.repeat(Math.max(0, len - str.length));
        const kw = 6;

        // Summarize movement from the actual bindings rather than a fixed string, so
        // rebinding or removing movement keys is reflected here.
        const ORTHOGONAL = ['move_up', 'move_down', 'move_left', 'move_right'];
        const DIAGONAL = ['move_up_left', 'move_up_right', 'move_down_left', 'move_down_right'];

        // Group the bound keys for a set of move actions into readable families, so eight
        // separate bindings read as "Arrows/Numpad/hjkl" instead of a wall of keys.
        const describeMovement = (actions) => {
            const families = new Map(); // label -> insertion order preserved
            for (const [key, action] of Object.entries(inputMgr.keyMap)) {
                if (!actions.includes(action)) continue;
                const bare = key.slice(key.lastIndexOf('+') + 1);
                const mod = key.slice(0, key.lastIndexOf('+') + 1);
                // Skip single letters entirely — lowercase ones are collected below, and
                // uppercase ones are just the shift-tolerance aliases bindKey adds, which
                // would otherwise show up as a duplicate "K/J/H/L" family.
                if (bare.length === 1 && bare.toLowerCase() >= 'a' && bare.toLowerCase() <= 'z') continue;
                let label;
                if (bare.startsWith('Arrow')) label = mod + 'Arrows';
                else if (bare.startsWith('Numpad')) label = 'Numpad';
                else label = formatKey(key);
                families.set(label, true);
            }
            // Letter keys are listed literally, in the order the bindings declare them
            // (hjkl / yubn), since that sequence is itself the mnemonic.
            const letters = Object.entries(inputMgr.keyMap)
                .filter(([k, a]) => actions.includes(a) && k.length === 1 && k >= 'a' && k <= 'z')
                .map(([k]) => k);
            const parts = [...families.keys()];
            if (letters.length) parts.push(letters.join(''));
            return parts.join('/');
        };

        const moveSummary = describeMovement(ORTHOGONAL);
        const diagSummary = describeMovement(DIAGONAL);

        const lines = [];
        lines.push('Help');
        lines.push('');
        if (moveSummary) lines.push(`Move: ${moveSummary}`);
        if (diagSummary) lines.push(`Diag: ${diagSummary}`);
        if (moveSummary || diagSummary) lines.push('');

        // Track which lines are keybinding rows so they can be zebra-striped. Headers,
        // the movement summary and blank separators are skipped, and the two groups
        // (actions, globals) stripe as one continuous run so the alternation doesn't
        // restart across the blank line between them.
        const bindingLines = [];
        const pushBinding = (keys, desc) => {
            bindingLines.push({ lineIndex: lines.length });
            lines.push(` ${pad(keys, kw)}${desc}`);
        };

        // In an observer prototype the `wait` key pauses instead (InputManager.handleKeyDown),
        // so it has to be described as what it actually does here, not as what it is bound to.
        const observing = !this.engine.hasControlledActor;

        const actionActions = bindings.actions ? Object.values(bindings.actions) : [];
        const seen = new Set();
        for (const action of actionActions) {
            if (seen.has(action)) continue;
            seen.add(action);
            const effective = (observing && action === 'wait') ? 'toggle_pause' : action;
            const desc = actionDescriptions[effective] || effective;
            pushBinding(pickKeys(action), desc);
        }
        lines.push('');

        const globalActions = bindings.global ? Object.values(bindings.global) : [];
        const globalSeen = new Set();
        for (const action of globalActions) {
            if (globalSeen.has(action)) continue;
            globalSeen.add(action);
            const desc = actionDescriptions[action] || action;
            pushBinding(pickKeys(action), desc);
        }
        pushBinding('?', 'Help');
        lines.push('');
        lines.push('?/Esc to close');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length));
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the keybinding rows
        this.drawListStripes(boxContainer, bindingLines, contentWidth, padding);

        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    }

    closeHelpWindow() {
        this.removeBox('help_window');
        this.helpWindowMode = false;
        this.updateBoxOverlays();
    }
}
