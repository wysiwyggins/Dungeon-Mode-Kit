/* =========================================================================
   color-picker.js — the shared named-color picker
   -------------------------------------------------------------------------
   A modal grid of swatches for the named colors in data/colors.json. Fields
   like `lock_color` store a color *name* ("child's sky"), not a hex: the
   engine pairs keys to doors by name and prints it in messages, taking the
   tint from the name's hex. So this picker always hands back a name.

   Filter by name, or give a hex (typed, or from the native color input) to
   sort the swatches nearest-first — choose by eye, still store a valid name.

       ColorPicker.load()                     // once, before opening
       ColorPicker.open({ current, label, onPick })

   `onPick` receives a color name, or null for "None".

   Markup is injected on first open. The overlay reuses the .tile-picker*
   chrome; the swatch grid is styled by .color-picker-* in _editors.scss.

   Like the other editor scripts this is a plain <script src> include sharing
   one global scope — no IIFE, no exports.
   ========================================================================= */
"use strict";

const ColorPicker = {
    colors: [],         // [{ color, hex }] in display order (see _spectrumOrder)
    byName: {},         // name -> hex

    _loaded: null,      // in-flight/finished load promise, so load() is idempotent
    _built: false,
    _onPick: null,
    _current: null,

    /**
     * Fetch the color table. Safe to call repeatedly.
     * @param {string} [base] - Path prefix to the repo root from the calling page
     */
    load(base = '..') {
        if (this._loaded) return this._loaded;
        this._loaded = (async () => {
            let data = {};
            try {
                const res = await fetch(`${base}/data/colors.json`);
                if (res.ok) data = await res.json();
            } catch { /* leave the picker empty rather than breaking the page */ }
            this.colors = this._spectrumOrder(
                (data.colors || []).filter(c => c.color && /^#[0-9a-f]{6}$/i.test(c.hex)));
            this.byName = Object.fromEntries(this.colors.map(c => [c.color, c.hex]));
        })();
        return this._loaded;
    },

    /** The hex for a color name, or null when the name isn't in colors.json. */
    hexOf(name) {
        return (name && this.byName[name]) || null;
    },

    /** The closest named color to a hex, or null for an invalid hex. */
    nearest(hex) {
        const target = this._rgb(hex);
        if (!target || !this.colors.length) return null;
        let best = null, bestD = Infinity;
        for (const c of this.colors) {
            const d = this._distance(target, this._rgb(c.hex));
            if (d < bestD) { bestD = d; best = c; }
        }
        return best;
    },

    /**
     * Open the modal.
     * @param {Object} opts
     * @param {string} [opts.current] - Currently selected color name, for the highlight
     * @param {string} [opts.label] - What is being selected, shown in the header
     * @param {Function} opts.onPick - Called with a color name, or null (none)
     */
    open({ current = null, label = 'color', onPick } = {}) {
        this._build();
        this._onPick = onPick;
        this._current = current;

        document.getElementById('color-picker-overlay').classList.add('active');
        document.getElementById('color-picker-target').textContent = `Selecting: ${label}`;
        const search = document.getElementById('color-picker-search');
        search.value = '';
        const currentHex = this.hexOf(current);
        document.getElementById('color-picker-hex').value = '';
        document.getElementById('color-picker-native').value = currentHex || '#ffffff';
        this._showReadout(current ? { color: current, hex: currentHex } : null);
        this._render();
        document.querySelector('#color-picker-grid .current')?.scrollIntoView({ block: 'center' });
        search.focus();
    },

    close() {
        const overlay = document.getElementById('color-picker-overlay');
        if (overlay) overlay.classList.remove('active');
        this._onPick = null;
    },

    _pick(name) {
        const cb = this._onPick;
        this.close();
        if (cb) cb(name);
    },

    _rgb(hex) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || '').trim());
        return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
    },

    /**
     * Sort for browsing: near-grays first, dark to light, then the rest in hue bands
     * around the wheel, each band dark to light. Banding matters — a straight hue
     * sort zigzags between dark and pale every swatch and reads as noise.
     */
    _spectrumOrder(colors) {
        const BANDS = 24;
        const keyed = colors.map(c => {
            const [r, g, b] = this._rgb(c.hex).map(v => v / 255);
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const l = (max + min) / 2, d = max - min;
            const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
            let h = 0;
            if (d) {
                if (max === r) h = ((g - b) / d + 6) % 6;
                else if (max === g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h /= 6;
            }
            const gray = sat < 0.12 || d < 0.06;
            return { c, band: gray ? -1 : Math.floor(h * BANDS) % BANDS, l };
        });
        keyed.sort((a, b) => a.band - b.band || a.l - b.l);
        return keyed.map(k => k.c);
    },

    /** "Redmean" weighted RGB distance — cheap, and closer to perceived difference than plain RGB. */
    _distance(a, b) {
        const rm = (a[0] + b[0]) / 2;
        const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
        return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    },

    _showReadout(c) {
        const el = document.getElementById('color-picker-readout');
        el.textContent = c ? `${c.color}${c.hex ? '  ' + c.hex : '  (not in colors.json)'}` : '';
    },

    /** Rebuild the grid from the name filter and the hex sort. */
    _render() {
        const grid = document.getElementById('color-picker-grid');
        const q = document.getElementById('color-picker-search').value.trim().toLowerCase();
        const target = this._rgb(document.getElementById('color-picker-hex').value);

        let list = q ? this.colors.filter(c => c.color.toLowerCase().includes(q)) : this.colors.slice();
        if (target) {
            list = list.map(c => ({ c, d: this._distance(target, this._rgb(c.hex)) }))
                .sort((x, y) => x.d - y.d).map(x => x.c);
        }

        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        list.forEach((c, i) => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'color-picker-swatch';
            if (c.color === this._current) sw.classList.add('current');
            if (target && i === 0) sw.classList.add('nearest');
            sw.style.background = c.hex;
            sw.title = `${c.color}  ${c.hex}`;
            sw.dataset.name = c.color;
            frag.appendChild(sw);
        });
        grid.appendChild(frag);
        document.getElementById('color-picker-empty').style.display = list.length ? 'none' : 'block';
    },

    /** Inject the overlay and wire it up. Runs once. */
    _build() {
        if (this._built) return;
        this._built = true;

        const host = document.createElement('div');
        host.innerHTML = `
<div id="color-picker-overlay" class="tile-picker-overlay color-picker-overlay">
    <div class="tile-picker color-picker">
        <div class="tile-picker-header">
            <span id="color-picker-target" class="tile-picker-target">Selecting: —</span>
            <input type="text" id="color-picker-search" placeholder="Search color name...">
            <button id="color-picker-none">None</button>
            <button id="color-picker-close">Close</button>
        </div>
        <div class="tile-picker-header color-picker-hex-row">
            <input type="color" id="color-picker-native" value="#ffffff">
            <input type="text" id="color-picker-hex" placeholder="#rrggbb — sorts nearest names first">
            <span id="color-picker-readout" class="color-picker-readout"></span>
        </div>
        <div id="color-picker-grid" class="color-picker-grid"></div>
        <div id="color-picker-empty" class="empty-hint" style="display:none">No colors match.</div>
    </div>
</div>`;
        while (host.firstChild) document.body.appendChild(host.firstChild);

        const grid = document.getElementById('color-picker-grid');
        const hexInput = document.getElementById('color-picker-hex');
        const native = document.getElementById('color-picker-native');

        grid.addEventListener('click', (e) => {
            const sw = e.target.closest('.color-picker-swatch');
            if (sw) this._pick(sw.dataset.name);
        });
        grid.addEventListener('mouseover', (e) => {
            const sw = e.target.closest('.color-picker-swatch');
            if (sw) this._showReadout({ color: sw.dataset.name, hex: this.byName[sw.dataset.name] });
        });

        document.getElementById('color-picker-search').addEventListener('input', () => this._render());

        hexInput.addEventListener('input', () => {
            const rgb = this._rgb(hexInput.value);
            if (rgb) native.value = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
            // Only re-sort on a complete hex (or a cleared field), not on every keystroke.
            if (rgb || !hexInput.value.trim()) {
                this._render();
                const n = rgb && this.nearest(hexInput.value);
                if (n) this._showReadout({ color: `nearest: ${n.color}`, hex: n.hex });
                grid.scrollTop = 0;
            }
        });
        native.addEventListener('input', () => {
            hexInput.value = native.value;
            hexInput.dispatchEvent(new Event('input'));
        });

        // Enter in either field takes the first swatch: the best name match, or the nearest color.
        for (const id of ['color-picker-search', 'color-picker-hex']) {
            document.getElementById(id).addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                const first = grid.querySelector('.color-picker-swatch');
                if (first) this._pick(first.dataset.name);
            });
        }

        document.getElementById('color-picker-none').addEventListener('click', () => this._pick(null));
        document.getElementById('color-picker-close').addEventListener('click', () => this.close());
        document.getElementById('color-picker-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape'
                && document.getElementById('color-picker-overlay').classList.contains('active')) {
                this.close();
            }
        });
    },
};
