// ============================================================================
// INTERFACE MANAGER
// ============================================================================
// Handles UI elements like boxes, menus, and overlays using the uiContainer

class InterfaceManager {
    constructor(engine) {
        this.engine = engine;
        this.boxes = new Map(); // Track active UI boxes by ID
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
    }

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
     * @returns {PIXI.Container} The text box container
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

        // Calculate Y position based on existing boxes in stack
        let yPosition = 0;
        for (const stackedId of this.textBoxStack) {
            const stackedBox = this.boxes.get(stackedId);
            if (stackedBox && stackedBox._boxHeight) {
                yPosition += stackedBox._boxHeight;
            }
        }

        // Center horizontally within visible area
        const x = vis.originX + Math.floor((vis.width - boxWidth) / 2);
        const y = vis.originY + yPosition;

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
     * Reposition all text boxes in the stack to fill gaps
     */
    repositionTextBoxStack() {
        let yPosition = 0;
        for (const id of this.textBoxStack) {
            const box = this.boxes.get(id);
            if (box) {
                box.y = yPosition * globalVars.TILE_HEIGHT;
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
                    regularStats.push(`${this.capitalize(key)}: ${displayValue}`);
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
                        // Charge display: "Charges: N/M" for staffs and similar usable items
                        const stat = item.stats[chargeStat];
                        if (stat && typeof stat === 'object' && stat.max !== undefined) {
                            const uses = item.getAttribute('uses') || 1;
                            const readyAt = stat.ready_at || Math.floor(stat.max / uses);
                            const availableCharges = Math.floor(stat.current / readyAt);
                            const isIdentified = item.identified !== false;
                            statLine = {
                                label: `      Charges: `,
                                chargeCount: isIdentified ? `${availableCharges}/${uses}` : `?/?`,
                                current: stat.current,
                                max: stat.max
                            };
                        }
                    } else {
                        // Generic display: find first stat with a display_label.
                        // Show the label + thermometer only — no numeric value (the raw
                        // value can be a float that renders a stray glyph in some decimals).
                        for (const stat of Object.values(item.stats)) {
                            if (stat && typeof stat === 'object' && stat.display_label && stat.max !== undefined) {
                                statLine = {
                                    label: `      ${stat.display_label}: `,
                                    chargeCount: null,
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
        const thermometerLineIndices = []; // Track which lines have thermometer bars
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

        const inventoryLineIndices = []; // Track which lines have item tiles
        const itemStatLineIndices = []; // Track which lines have item stat thermometers
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
                    itemStatLineIndices.push({ lineIndex: lines.length, label: displayLabel, current: statLine.current, max: statLine.max });
                    lines.push(displayLabel); // Shows "      Charges: 2/3 " then thermometer renders after
                }
            }
        } else {
            if (hasStats) lines.push('');
            lines.push('Inventory: (empty)');
        }

        // Calculate dimensions - account for thermometer bar widths
        const padding = 1;
        let maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 10);
        // Check if any thermometer bars would be wider (fixed width of 10 tiles)
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

        // Position box on opposite side from player to avoid covering them
        const vis = this.getVisibleArea();
        const playerX = player.x || 0;
        const visMidpoint = vis.originX + vis.width / 2;

        // If player is on the right side, put box on left; otherwise put on right
        const x = playerX >= visMidpoint ? vis.originX + 1 : vis.originX + vis.width - boxWidth - 1;
        const y = vis.originY + 1;

        // Create the box
        const boxContainer = this.createBox(infoBoxId, x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._inventoryLineIndices = inventoryLineIndices;

        // Zebra-stripe the inventory rows (an item with a stat sub-line spans 2 rows)
        const stripeRows = inventoryLineIndices.map(({ lineIndex }) => ({
            lineIndex,
            span: itemStatLineIndices.some(s => s.lineIndex === lineIndex + 1) ? 2 : 1,
        }));
        this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);

        // Add text sprites
        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        // Item stat sub-lines (charges, fuel, etc.) render in the amber accent color
        const accentLineSet = new Set(itemStatLineIndices.map(s => s.lineIndex));

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const accent = accentLineSet.has(lineIndex);
            const baseColor = accent ? this.statAccentColor : this.defaultTextTint;
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

        // Render thermometer bars for item stats (like staff pow) in the amber accent color
        for (const { lineIndex, label, current, max } of itemStatLineIndices) {
            const barX = textStartX + (label.length * globalVars.TILE_WIDTH);
            const barY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderThermometerBar(boxContainer, current, max, barX, barY, this.statAccentColor);
        }

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

        // Add description — hide specifics for unidentified items
        let description = item.getDescription ? item.getDescription() : item.getAttribute('description');
        if (item.identified === false) {
            description = null;
        }
        if (description) {
            const wrappedDesc = this.wrapText(description, 20);
            for (const line of wrappedDesc) {
                lines.push(line);
            }
            lines.push('');
        }

        // Show charges for staves/wands (only when identified)
        const chargeStat = item.getAttribute('charge_stat');
        if (chargeStat && item.stats?.[chargeStat] && item.identified !== false) {
            const s = item.stats[chargeStat];
            lines.push(`Charges: ${s.current}/${s.max}`);
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

        // Position next to player info box
        const playerInfoBox = this.boxes.get('player_info');
        const vis = this.getVisibleArea();
        let x;

        if (playerInfoBox && playerInfoBox._boxX !== undefined) {
            // Position adjacent to player info box
            const playerInfoRight = playerInfoBox._boxX + playerInfoBox._boxWidth;
            const playerInfoLeft = playerInfoBox._boxX;

            // Try to place on the opposite side from player info
            if (playerInfoLeft - vis.originX > boxWidth) {
                // Place to the left of player info
                x = playerInfoLeft - boxWidth;
            } else if (playerInfoRight + boxWidth < vis.originX + vis.width) {
                // Place to the right of player info
                x = playerInfoRight;
            } else {
                // Fallback: overlap slightly
                x = Math.max(vis.originX, vis.originX + vis.width - boxWidth - 1);
            }
        } else {
            // Fallback positioning
            x = vis.originX + Math.floor((vis.width - boxWidth) / 2);
        }

        const y = vis.originY + 1;

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
        if (this.spellAimingMode || this.identifyMode || this.enchantMode || this.spikeDirectionMode) {
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

        // Center the dialog within visible area
        const vis = this.getVisibleArea();
        const x = vis.originX + Math.floor((vis.width - boxWidth) / 2);
        const y = vis.originY + Math.floor((vis.height - boxHeight) / 2);

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

        if (key === 'n' || key === 'N' || key === 'Escape') {
            const onCancel = this.confirmDialog.onCancel;
            this.closeConfirmDialog();
            if (onCancel) onCancel();
            return true;
        }

        return true; // Consume all keys while dialog is open
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
    // THROW AIMING MODE
    // ========================================================================

    /**
     * Enter throw aiming mode for an item
     * @param {Item} item - The item to throw
     */
    enterThrowAimingMode(item) {
        this.throwAimingMode = true;
        this.throwItem = item;

        // Close the menus but keep player reference
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        // Show instruction message
        this.showTextBox('throw_instructions', 'Aim with mouse, click to throw. Esc to cancel.', {
            dismissOnMove: false
        });

        // Update the throw path based on current mouse position
        this.updateThrowPath();
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
     */
    showWeaponSwing(weapon, targetX, targetY, duration = 100) {
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

        // Apply flip if present
        if (weapon.flipH || weapon.flipV) {
            weaponSprite.anchor.set(0.5, 0.5);
            weaponSprite.scale.x = weapon.flipH ? -1 : 1;
            weaponSprite.scale.y = weapon.flipV ? -1 : 1;
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
                this.engine.playSound('arrow_miss');
                item.x = landingPoint.x;
                item.y = landingPoint.y;
                this.engine.entityManager.addEntity(item);
                const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                this.engine.inputManager?.showMessage(`You throw the ${displayName}.`);
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

        // Check if item landed on a trap and trigger it
        this.checkTrapTrigger(landingPoint.x, landingPoint.y, item);

        // This counts as a player action
        this.engine.inputManager?.onPlayerAction();
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

        // Make the trap visible (stays visible permanently)
        if (!trap.hasAttribute('visible')) {
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

        // Trap remains on tile (Brogue-style) - no die() call
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
    handleThrowKey(key) {
        if (!this.throwAimingMode) return false;

        if (key === 'Escape') {
            this.exitThrowAimingMode();
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

        // Close any open menus
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        // Update the spell path based on current mouse position
        this.updateSpellPath();
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
        const vis = this.getVisibleArea();
        const x = Math.max(vis.originX, vis.originX + Math.floor((vis.width - boxWidth) / 2));
        const y = vis.originY + 1;

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
        const vis = this.getVisibleArea();
        const x = Math.max(vis.originX, vis.originX + Math.floor((vis.width - boxWidth) / 2));
        const y = vis.originY + 1;

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

        // Check spell range (only if defined)
        const range = this.spellItem?.getAttribute('spell_range');
        let pathColor = 0xFF6600; // Default orange for spells

        if (range) {
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

        // Check spell range (only if spell_range is defined)
        const range = this.spellItem.getAttribute('spell_range');
        if (range) {
            const dx = targetX - this.spellCaster.x;
            const dy = targetY - this.spellCaster.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > range) {
                const displayName = this.spellItem.getDisplayName ? this.spellItem.getDisplayName() : this.spellItem.name;
                this.engine.inputManager?.showMessage(`Target is out of range for ${displayName}.`);
                return;
            }
        }

        // Get spell effect to check for bolt type
        const spellEffect = this.spellItem?.getAttribute('spell_effect') || { center: 'fire', radius: 0 };
        const isBolt = spellEffect.type === 'bolt';

        // Get the actual landing position (may be blocked by solid actor for line-of-sight spells)
        const pathResult = this.engine.renderer?.showLinePath(
            this.spellCaster.x,
            this.spellCaster.y,
            targetX,
            targetY,
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
     * @param {string} key - The key pressed
     * @returns {boolean} True if key was handled
     */
    handleSpellAimingKey(key) {
        if (!this.spellAimingMode) return false;
        if (key === 'Escape') {
            this.exitSpellAimingMode();
            return true;
        }
        return false;
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
                if (actor.hasAttribute('openable') &&
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
            'Spike which door? (arrow keys or WASD, Esc to cancel)',
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

        const keyToDir = {
            'ArrowUp': { dx: 0, dy: -1 },
            'ArrowDown': { dx: 0, dy: 1 },
            'ArrowLeft': { dx: -1, dy: 0 },
            'ArrowRight': { dx: 1, dy: 0 },
            'w': { dx: 0, dy: -1 }, 'W': { dx: 0, dy: -1 },
            'a': { dx: -1, dy: 0 }, 'A': { dx: -1, dy: 0 },
            's': { dx: 0, dy: 1 }, 'S': { dx: 0, dy: 1 },
            'd': { dx: 1, dy: 0 }, 'D': { dx: 1, dy: 0 }
        };

        const dir = keyToDir[key];
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

        // Center the dialog within visible area
        const vis = this.getVisibleArea();
        const x = vis.originX + Math.floor((vis.width - boxWidth) / 2);
        const y = vis.originY + Math.floor((vis.height - boxHeight) / 2);

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
        const vis = this.getVisibleArea();
        const x = Math.max(vis.originX, vis.originX + Math.floor((vis.width - boxWidth) / 2));
        const y = vis.originY + 1;

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

        // Center the dialog within visible area
        const vis = this.getVisibleArea();
        const x = vis.originX + Math.floor((vis.width - boxWidth) / 2);
        const y = vis.originY + Math.floor((vis.height - boxHeight) / 2);

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
            (!a.hasStateProperty?.('invisible') || a.hasAttribute('controlled'))
        );

        // Sort: controllable actors first, then by name
        visibleActors.sort((a, b) => {
            const aControlled = a.hasAttribute('controlled') ? 0 : 1;
            const bControlled = b.hasAttribute('controlled') ? 0 : 1;
            if (aControlled !== bControlled) return aControlled - bControlled;
            return a.name.localeCompare(b.name);
        });

        // Build HTML content
        const actorElements = visibleActors.map(actor => {
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
                        html += `<span class="stat-ratio">${current}/${max}</span>`;
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
        });

        actorsDiv.innerHTML = actorElements.join('');
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
     * Update both actors and items divs
     * Call this after turns complete or when visibility changes
     */
    updateSidebar() {
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

        const vis = this.getVisibleArea();
        const x = vis.originX + Math.floor((vis.width - boxWidth) / 2);
        const y = vis.originY + Math.floor((vis.height - boxHeight) / 2);

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

        const formatKey = (key) => {
            if (key === ' ') return 'Space';
            if (key === 'Escape') return 'Esc';
            if (key.startsWith('Arrow')) return key.slice(5);
            if (key.startsWith('Numpad')) return 'Num' + key.slice(6);
            return key;
        };

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

        const lines = [];
        lines.push('Help');
        lines.push('');
        lines.push('Move: Arrows/WASD/hjkl');
        lines.push('Diag: Numpad/yubn');
        lines.push('');

        const actionActions = bindings.actions ? Object.values(bindings.actions) : [];
        const seen = new Set();
        for (const action of actionActions) {
            if (seen.has(action)) continue;
            seen.add(action);
            const desc = actionDescriptions[action] || action;
            lines.push(` ${pad(pickKeys(action), kw)}${desc}`);
        }
        lines.push('');

        const globalActions = bindings.global ? Object.values(bindings.global) : [];
        const globalSeen = new Set();
        for (const action of globalActions) {
            if (globalSeen.has(action)) continue;
            globalSeen.add(action);
            const desc = actionDescriptions[action] || action;
            lines.push(` ${pad(pickKeys(action), kw)}${desc}`);
        }
        lines.push(` ${pad('?', kw)}Help`);
        lines.push('');
        lines.push('?/Esc to close');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length));
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        const vis = this.getVisibleArea();
        const x = vis.originX + Math.floor((vis.width - boxWidth) / 2);
        const y = vis.originY + Math.floor((vis.height - boxHeight) / 2);

        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

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
