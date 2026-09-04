/* =========================================================================
   tile-picker.js — the shared visual tile picker
   -------------------------------------------------------------------------
   A modal spritesheet grid: search by tile name, hover for the names at a
   cell, click to choose. Extracted from actor-editor.html and item-editor.html,
   which carried two near-identical copies and could not share it with the
   prototype editor.

   The old copies read and wrote the host page's own state directly
   (`state.currentTiles[state.activeTileTarget]`, then called `updateTileSlot`
   and `updatePreview`). That coupling is what kept them un-shareable, so this
   module inverts it: the caller says what is selected now and what to do with
   the choice, and owns its own storage.

       TilePicker.load()                     // once, before opening
       TilePicker.open({ current, label, onPick })

   `onPick` receives a tile-name string when the cell has one, otherwise
   {x, y} coordinates, and null for "None / Blank" — the three forms
   SpriteLibrary.resolveTile accepts, matching what the editors already store.

   Markup is injected on first open, so a host page needs no picker HTML. The
   .tile-picker* styles already live in assets/scss/_editors.scss, which every
   editor links via main.css.

   Like the other editor scripts this is a plain <script src> include sharing
   one global scope — no IIFE, no exports.
   ========================================================================= */
"use strict";

const TilePicker = {
    // Display size of one cell, and the sheet's extent in cells. Both come from
    // static-tiles.json rather than being assumed, so re-cutting the spritesheet
    // doesn't need an edit here.
    tileW: 40,
    tileH: 30,
    cols: 23,
    rows: 17,

    tiles: {},          // name -> [x, y]
    tileNames: [],      // sorted names, for callers that want a list
    byCoord: {},        // "x,y" -> [name, ...]; a cell can have several aliases
    sheet: null,        // HTMLImageElement

    _loaded: null,      // in-flight/finished load promise, so load() is idempotent
    _built: false,      // has the overlay markup been injected
    _onPick: null,
    _current: null,
    _highlight: null,   // Set of "x,y" matching the search, or null for "no search"

    /**
     * Fetch the tile table and spritesheet. Safe to call repeatedly — the work
     * happens once and later callers await the same promise.
     * @param {string} [base] - Path prefix to the repo root from the calling page
     */
    load(base = '..') {
        if (this._loaded) return this._loaded;
        this._loaded = (async () => {
            let data = {};
            try {
                const res = await fetch(`${base}/data/static-tiles.json`);
                if (res.ok) data = await res.json();
            } catch { /* leave the picker empty rather than breaking the page */ }

            // tilePixelWidth/Height is the sheet's real cell size (40x30). The
            // separate tileDisplay* pair is the smaller in-game draw size and would
            // cut the grid at the wrong stride here.
            this.tileW = data.tilePixelWidth || this.tileW;
            this.tileH = data.tilePixelHeight || this.tileH;
            this.tiles = data.tiles || {};
            this.tileNames = Object.keys(this.tiles).sort();

            this.byCoord = {};
            for (const [name, coords] of Object.entries(this.tiles)) {
                const key = `${coords[0]},${coords[1]}`;
                (this.byCoord[key] ||= []).push(name);
            }

            await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.sheet = img;
                    this.cols = Math.ceil(img.width / this.tileW);
                    this.rows = Math.ceil(img.height / this.tileH);
                    resolve();
                };
                img.onerror = () => resolve();   // grid still works, just unpainted
                img.src = `${base}/assets/sprites/static-tiles.png`;
            });
        })();
        return this._loaded;
    },

    /** Coordinates for a stored value, accepting either form. Null when unset/blank. */
    resolve(value) {
        if (!value || value === 'BLANK') return null;
        if (typeof value === 'object' && value.x !== undefined) return value;
        const coords = this.tiles[value];
        return coords ? { x: coords[0], y: coords[1] } : null;
    },

    /** The display name for a stored value, for a caller's preview label. */
    nameOf(value) {
        if (!value || value === 'BLANK') return '—';
        if (typeof value === 'string') return value;
        const names = this.byCoord[`${value.x},${value.y}`];
        return names?.length ? names[0] : `${value.x},${value.y}`;
    },

    /**
     * Open the modal.
     * @param {Object} opts
     * @param {string|Object} [opts.current] - Currently selected tile, for the highlight
     * @param {string} [opts.label] - What is being selected, shown in the header
     * @param {Function} opts.onPick - Called with a name, {x,y}, or null (blank)
     */
    open({ current = null, label = 'tile', onPick } = {}) {
        this._build();
        this._onPick = onPick;
        this._current = current;
        this._highlight = null;

        document.getElementById('tile-picker-overlay').classList.add('active');
        document.getElementById('tile-picker-target').textContent = `Selecting: ${label}`;
        const search = document.getElementById('tile-picker-search');
        search.value = '';
        this._draw();
        search.focus();
    },

    close() {
        const overlay = document.getElementById('tile-picker-overlay');
        if (overlay) overlay.classList.remove('active');
        const tooltip = document.getElementById('tile-picker-tooltip');
        if (tooltip) tooltip.style.display = 'none';
        this._onPick = null;
    },

    _pick(value) {
        const cb = this._onPick;
        this.close();
        if (cb) cb(value);
    },

    _draw() {
        const canvas = document.getElementById('tile-picker-canvas');
        if (!canvas) return;
        const w = this.cols * this.tileW;
        const h = this.rows * this.tileH;
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        if (this.sheet) ctx.drawImage(this.sheet, 0, 0);

        // Dim everything the search didn't match, so hits read as lit cells.
        if (this._highlight) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    if (!this._highlight.has(`${c},${r}`)) {
                        ctx.fillRect(c * this.tileW, r * this.tileH, this.tileW, this.tileH);
                    }
                }
            }
        }

        ctx.strokeStyle = 'rgba(132,220,207,0.2)';
        ctx.lineWidth = 0.5;
        for (let c = 0; c <= this.cols; c++) {
            ctx.beginPath(); ctx.moveTo(c * this.tileW, 0); ctx.lineTo(c * this.tileW, h); ctx.stroke();
        }
        for (let r = 0; r <= this.rows; r++) {
            ctx.beginPath(); ctx.moveTo(0, r * this.tileH); ctx.lineTo(w, r * this.tileH); ctx.stroke();
        }

        const coords = this.resolve(this._current);
        if (coords) {
            ctx.strokeStyle = '#e94560';
            ctx.lineWidth = 2;
            ctx.strokeRect(
                coords.x * this.tileW + 1, coords.y * this.tileH + 1,
                this.tileW - 2, this.tileH - 2
            );
        }
    },

    /** Cell under a pointer event, in tile coordinates. */
    _cellAt(e, canvas) {
        const rect = canvas.getBoundingClientRect();
        return {
            col: Math.floor((e.clientX - rect.left) * (canvas.width / rect.width) / this.tileW),
            row: Math.floor((e.clientY - rect.top) * (canvas.height / rect.height) / this.tileH),
        };
    },

    /** Inject the overlay and wire it up. Runs once. */
    _build() {
        if (this._built) return;
        this._built = true;

        const host = document.createElement('div');
        host.innerHTML = `
<div id="tile-picker-overlay" class="tile-picker-overlay">
    <div id="tile-picker" class="tile-picker">
        <div id="tile-picker-header" class="tile-picker-header">
            <span id="tile-picker-target" class="tile-picker-target">Selecting: —</span>
            <input type="text" id="tile-picker-search" placeholder="Search tile name...">
            <button id="tile-picker-none">None / Blank</button>
            <button id="tile-picker-close">Close</button>
        </div>
        <canvas id="tile-picker-canvas" class="tile-picker-canvas"></canvas>
    </div>
</div>
<div id="tile-picker-tooltip" class="tile-picker-tooltip"></div>`;
        while (host.firstChild) document.body.appendChild(host.firstChild);

        const canvas = document.getElementById('tile-picker-canvas');
        const tooltip = document.getElementById('tile-picker-tooltip');

        canvas.addEventListener('mousemove', (e) => {
            const { col, row } = this._cellAt(e, canvas);
            const names = this.byCoord[`${col},${row}`];
            if (names?.length) {
                tooltip.textContent = names.join(', ');
                tooltip.style.display = 'block';
                tooltip.style.left = `${e.clientX + 12}px`;
                tooltip.style.top = `${e.clientY - 8}px`;
            } else {
                tooltip.style.display = 'none';
            }
        });

        canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

        canvas.addEventListener('click', (e) => {
            const { col, row } = this._cellAt(e, canvas);
            const names = this.byCoord[`${col},${row}`];
            // Prefer the name: it survives a spritesheet re-cut, where raw
            // coordinates would silently point at whatever moved into the cell.
            this._pick(names?.length ? names[0] : { x: col, y: row });
        });

        document.getElementById('tile-picker-search').addEventListener('input', (e) => {
            const q = e.target.value.trim().toUpperCase();
            if (!q) {
                this._highlight = null;
            } else {
                this._highlight = new Set();
                for (const [name, coords] of Object.entries(this.tiles)) {
                    if (name.toUpperCase().includes(q)) {
                        this._highlight.add(`${coords[0]},${coords[1]}`);
                    }
                }
            }
            this._draw();
        });

        document.getElementById('tile-picker-none').addEventListener('click', () => this._pick(null));
        document.getElementById('tile-picker-close').addEventListener('click', () => this.close());
        document.getElementById('tile-picker-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape'
                && document.getElementById('tile-picker-overlay').classList.contains('active')) {
                this.close();
            }
        });
    },
};
