/**
 * InterfaceManager methods: keyboard and mouse highlighting for boxes that
 * list choices (dialogue, confirm dialog, inventory, item menus, pickers).
 *
 * A menu registers its choices with setBoxOptions() while it draws its box.
 * The arrow keys then move a highlight through them and Enter picks the
 * highlighted one, and the pointer highlights whichever choice it's over.
 * Letter keys and clicks still go to each menu's own handlers; this sits
 * alongside them.
 *
 * Nothing is highlighted when a box opens, so a menu looks the same until you
 * press an arrow key. After that the highlight follows you: if Enter opens
 * another menu (inventory -> item actions) or the next dialogue step, its first
 * choice starts highlighted. A box that's rebuilt in place (the equipment menu
 * after a toggle, the inventory after an action) keeps its highlight.
 *
 * Only the active box (getActiveBoxId) responds, so a dimmed box behind a
 * dialog ignores both keys and pointer.
 */

import { TILE_HEIGHT, TILE_WIDTH } from '../core/util.js';

const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft']);
const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);

export const UIOptions = {
    /**
     * Register a box's choices. Call after createBox and any stripes or
     * backgrounds, before the text, so the highlight draws under the letters.
     * @param {PIXI.Container} box
     * @param {Array<{line: number, span?: number, col?: number, width?: number, activate: Function}>} options
     *   In display order. `line` is the content line (0 = first line inside
     *   the padding); `span` covers extra lines (an item's stat sub-line).
     *   `col`/`width` limit the choice to part of the line (in tiles), for
     *   choices that share one; without them it spans the content width.
     * @param {object} [settings]
     * @param {boolean} [settings.newList] - The choices are different from the
     *   box's last ones (the next dialogue step), so a kept highlight goes back
     *   to the first choice instead of staying at its index.
     */
    setBoxOptions(box, options, { newList = false } = {}) {
        if (!box) return;
        box._options = options || [];
        box._optionHighlight = new PIXI.Graphics();
        box.addChild(box._optionHighlight);

        const id = box._id;
        const previous = this.optionHighlight;
        // The same box id with its old box gone: it was rebuilt in this same
        // task (removeBox clears the highlight on the next microtask otherwise).
        const rebuilt = previous?.boxId === id && previous.box !== box;
        const count = box._options.length;

        let next = null;
        if (count && rebuilt && !newList) {
            next = { ...previous, index: Math.min(previous.index, count - 1) };
        } else if (count && (this._optionKeyboardChain || (rebuilt && previous.source === 'keyboard'))) {
            next = { boxId: id, index: 0, source: 'keyboard' };
        }
        if (next) {
            this._setOptionHighlight({ ...next, box });
        } else if (rebuilt) {
            this.optionHighlight = null;
        }

        // Where the pointer is matters more than a remembered mouse highlight,
        // and a box that opens under the pointer highlights what's beneath it.
        if (!this.optionHighlight || this.optionHighlight.source === 'mouse') {
            const tile = this.engine.inputManager?.hoveredTile;
            if (tile && tile.x >= 0) this.updateOptionHover(tile.x, tile.y, box);
        }
    },

    /** The active box, if it has choices registered. */
    _activeOptionBox() {
        const box = this.boxes.get(this.getActiveBoxId());
        return box?._options?.length ? box : null;
    },

    /**
     * Move the highlight. Clears the old box's highlight if it was on another
     * box, then draws the new one.
     * @param {{box: PIXI.Container, boxId: string, index: number, source: 'keyboard'|'mouse'}|null} state
     */
    _setOptionHighlight(state) {
        const old = this.optionHighlight;
        if (old?.box && old.box !== state?.box) this._drawOptionHighlight(old.box, -1);
        this.optionHighlight = state;
        if (state) this._drawOptionHighlight(state.box, state.index);
    },

    /** Draw the highlight behind choice `index` of `box` (-1 = none). */
    _drawOptionHighlight(box, index) {
        const g = box?._optionHighlight;
        if (!g || g.destroyed) return;
        g.clear();
        const option = box._options?.[index];
        if (!option) return;
        const pad = box._padding ?? 1;
        const contentWidth = box._boxWidth - pad * 2 - 2;
        const col = option.col ?? 0;
        const width = option.width ?? contentWidth - col;
        g.beginFill(this.optionHighlightColor);
        g.drawRect(
            (pad + 1 + col) * TILE_WIDTH,
            (pad + 1 + option.line) * TILE_HEIGHT,
            width * TILE_WIDTH,
            (option.span || 1) * TILE_HEIGHT
        );
        g.endFill();
    },

    /** Index of the choice under a content position, or -1. */
    _optionAt(box, contentLine, contentCol) {
        return box._options.findIndex(o =>
            contentLine >= o.line && contentLine < o.line + (o.span || 1)
            && (o.col === undefined || (contentCol >= o.col && contentCol < o.col + o.width)));
    },

    /**
     * Pointer moved to a map tile: highlight the active box's choice under it.
     * Leaving the choices clears a pointer highlight but not a keyboard one.
     * @param {number} tileX
     * @param {number} tileY
     * @param {PIXI.Container} [box] - Defaults to the active box
     */
    updateOptionHover(tileX, tileY, box = this._activeOptionBox()) {
        if (!box?._options?.length || box !== this.boxes.get(this.getActiveBoxId())) return;
        const hit = this._hitTestBox(box, tileX, tileY);
        const index = hit ? this._optionAt(box, hit.contentLine, hit.contentCol) : -1;
        const current = this.optionHighlight;
        if (index >= 0) {
            if (current?.box === box && current.index === index) return;
            this._setOptionHighlight({ box, boxId: box._id, index, source: 'mouse' });
        } else if (current?.source === 'mouse') {
            this._setOptionHighlight(null);
        }
    },

    /** The pointer left the canvas: drop a pointer highlight. */
    clearOptionHover() {
        if (this.optionHighlight?.source === 'mouse') this._setOptionHighlight(null);
    },

    /**
     * Arrow keys move the highlight (wrapping); Enter picks a highlight the
     * keyboard put there. Anything else is left to the menu's own handler, and
     * so is Enter when nothing is highlighted (a dialog's default choice).
     * @param {string} key
     * @returns {boolean} True if the key was handled
     */
    handleOptionNavKey(key) {
        const box = this._activeOptionBox();
        if (!box) return false;
        const count = box._options.length;
        const current = this.optionHighlight?.box === box ? this.optionHighlight : null;

        const step = PREVIOUS_KEYS.has(key) ? -1 : NEXT_KEYS.has(key) ? 1 : 0;
        if (step) {
            // The first press lands on the first (or last) choice; after that it moves.
            const index = current ? (current.index + step + count) % count : (step > 0 ? 0 : count - 1);
            this._setOptionHighlight({ box, boxId: box._id, index, source: 'keyboard' });
            return true;
        }

        if (key === 'Enter' && current?.source === 'keyboard') {
            const option = box._options[current.index];
            // Menus this opens start with their first choice highlighted.
            this._optionKeyboardChain = true;
            try {
                option?.activate();
            } finally {
                this._optionKeyboardChain = false;
            }
            return true;
        }
        return false;
    },

    /**
     * removeBox calls this. A box rebuilt in the same task (removed and created
     * again under its id) keeps its highlight; one that stays closed loses it.
     */
    _forgetOptionHighlight(id) {
        const state = this.optionHighlight;
        if (state?.boxId !== id) return;
        state.box = null;
        queueMicrotask(() => {
            if (this.optionHighlight === state && !state.box) this.optionHighlight = null;
        });
    },
};
