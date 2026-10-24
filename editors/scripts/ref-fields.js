/* =========================================================================
   Reference fields — shared by the editor pages

   A text input whose value names something defined elsewhere (an actor, a
   state, a sound...) gets a <datalist> of the known names: focusing the field
   drops down what exists, and new text is still accepted. Two kinds of source:

   - 'ref'   the engine looks the name up, so a value it can't find is flagged
             with a "not in <file>" warning beside the input.
   - 'label' free text; the suggestions only keep spellings consistent, so a
             new value is never flagged.

   A page defines its sources once (names() reads that page's own state, so a
   prototype switch is just a refresh()), then attaches inputs either directly
   or by marking them data-ref="<source>" and calling attachAll(root).

       RefFields.define('sound', { file: 'sounds.json', names: () => state.soundIds });
       RefFields.attach(input, 'sound');
       RefFields.refresh();   // after the data behind names() changes
       RefFields.update();    // after code sets input values (no input event fires)
   ========================================================================= */
const RefFields = (() => {
    const sources = {};
    const attached = new Set();
    const warnings = new WeakMap();

    /** Library keys minus '_comment'-style documentation entries. */
    const keysOf = (lib) => Object.keys(lib || {}).filter(k => !k.startsWith('_'));

    /** Distinct string values a set of actor/item defs give one attribute. */
    function valuesInUse(defs, key) {
        const vals = new Set();
        for (const def of Object.values(defs || {})) {
            const v = def?.attributes?.[key] ?? def?.[key];
            if (typeof v === 'string' && v) vals.add(v);
        }
        return [...vals];
    }

    /**
     * Register a source.
     * @param {string} name - Source id, also the datalist id suffix
     * @param {Object} def
     * @param {Function} def.names - () => string[] of known values
     * @param {string} [def.kind='ref'] - 'ref' (must resolve) or 'label' (free text)
     * @param {string} [def.file] - Where the names live, for the warning text
     * @param {string} [def.noun] - Shown in the placeholder ("choose a sound…"); defaults to name
     * @param {Function} [def.label] - (key) => display name shown beside the key in the popup
     */
    function define(name, def) {
        sources[name] = { kind: 'ref', noun: name, ...def };
        if (!document.getElementById('dl-' + name)) {
            const dl = document.createElement('datalist');
            dl.id = 'dl-' + name;
            document.body.appendChild(dl);
        }
        fill(name);
    }

    function fill(name) {
        const src = sources[name];
        const dl = document.getElementById('dl-' + name);
        if (!src || !dl) return;
        dl.innerHTML = '';
        for (const k of [...new Set(src.names() || [])].sort()) {
            const opt = document.createElement('option');
            opt.value = k;
            const label = src.label?.(k);
            if (label && label !== k) opt.label = label;
            dl.appendChild(opt);
        }
    }

    function placeholderFor(src) {
        if (src.kind !== 'ref') return 'choose or type a new label…';
        return `choose ${/^[aeiou]/i.test(src.noun) ? 'an' : 'a'} ${src.noun}…`;
    }

    /** Wire one input to a source. Safe to call before the input is in the DOM. */
    function attach(inp, name) {
        const src = sources[name];
        if (!inp || !src) return;
        inp.dataset.ref = name;
        inp.setAttribute('list', 'dl-' + name);
        inp.autocomplete = 'off';   // browser history would crowd out the real names
        // Replaces any example placeholder: a sample value reads as "type this".
        inp.placeholder = placeholderFor(src);
        if (!attached.has(inp)) {
            inp.addEventListener('input', () => check(inp));
            inp.addEventListener('change', () => check(inp));
        }
        attached.add(inp);
        check(inp);
    }

    /** Attach every not-yet-wired input[data-ref] under root (templated or rebuilt forms). */
    function attachAll(root = document) {
        for (const inp of root.querySelectorAll('input[data-ref]:not([list])')) attach(inp, inp.dataset.ref);
    }

    function check(inp) {
        const src = sources[inp.dataset.ref];
        if (!src) return;
        if (!inp.parentNode) {
            // Built before being inserted; look again once the caller has placed it.
            queueMicrotask(() => { if (inp.parentNode) check(inp); });
            return;
        }
        // A typed-attribute cell is too narrow for the names (and the popup, which
        // takes the input's width), so these rows span the whole grid.
        if (inp.closest('.typed-attrs')) inp.closest('.field-row')?.classList.add('ref-row');
        if (src.kind !== 'ref') return;
        let warn = warnings.get(inp);
        if (!warn) {
            warn = document.createElement('span');
            warn.className = 'color-name-warning';
            warn.textContent = `not in ${src.file || 'the known ' + src.noun + 's'}`;
            inp.insertAdjacentElement('afterend', warn);
            warnings.set(inp, warn);
        }
        const val = inp.value.trim();
        warn.classList.toggle('visible', !!val && !src.names().includes(val));
    }

    /** Re-check every attached input still on the page. */
    function update() {
        for (const inp of attached) {
            if (!inp.isConnected) attached.delete(inp);
            else check(inp);
        }
    }

    /** Refill every datalist from its source, then re-check the inputs. */
    function refresh() {
        for (const name of Object.keys(sources)) fill(name);
        update();
    }

    return { define, attach, attachAll, refresh, update, keysOf, valuesInUse };
})();
