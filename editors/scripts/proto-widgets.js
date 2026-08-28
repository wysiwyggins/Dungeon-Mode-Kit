/* =========================================================================
   proto-widgets.js — reusable widget builders, spawn/win-condition editors, section() helper
   -------------------------------------------------------------------------
   Extracted from prototype-editor.html. These files are plain <script> src
   includes (no bundler) and share one global scope; load order matters:
   proto-state -> proto-widgets -> biome-sections -> proto-sections ->
   proto-render. The final file calls init(). Do not wrap in IIFEs — cross-file
   references rely on the shared top-level scope.
   ========================================================================= */
"use strict";

/**
 * The set of names usable as an item_catalog category or a biome item row.
 *
 * These are item types (data/types.json with domain "item") — an item declaring
 * one is a member, so the pools follow the library instead of being restated.
 * A raw items.json entry with random_type still counts: it's the escape hatch
 * for a hand-curated pool that isn't simply "everything of this type".
 *
 * @param {Object} items - data/items.json
 * @param {Object} types - data/types.json
 * @returns {Set<string>} Category names
 */
function collectPoolItemIds(items, types) {
    const ids = new Set();
    for (const [k, v] of Object.entries(types || {})) {
        if (k.startsWith('_')) continue;
        if (v && v.domain === 'item') ids.add(k);
    }
    for (const [k, v] of Object.entries(items || {})) {
        if (v && v.random_type) ids.add(k);
    }
    return ids;
}

/* =========================================================================
   Reusable widget builders
   Each returns a DOM node and wires onChange to mutate the model + re-output.
   ========================================================================= */
function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') n.className = v;
        else if (k === 'style') n.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const c of children) {
        if (c == null) continue;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
}

// Build a <label> that, when `tip` is given, carries a native tooltip on the
// whole row (hover to see it — no marker icon).
function labelEl(text, tip) {
    const lbl = el('label', {}, text);
    if (tip) lbl.setAttribute('title', tip);
    return lbl;
}

// Group compact fields side-by-side. Pass any number of field-row nodes;
// they flow into a responsive grid instead of each taking the full width.
function fieldGrid(...rows) {
    return el('div', { class: 'field-grid' }, ...rows.filter(Boolean));
}

// A labelled text/number field bound to obj[key]. opts.tip adds a tooltip.
function fieldRow(label, obj, key, opts = {}) {
    const type = opts.type || 'text';
    const input = el('input', { type });
    if (type === 'number') {
        input.value = obj[key] != null ? obj[key] : '';
        input.addEventListener('input', () => {
            if (input.value === '') delete obj[key];
            else obj[key] = Number(input.value);
            commit();
        });
    } else {
        input.value = obj[key] != null ? obj[key] : '';
        input.addEventListener('input', () => {
            if (input.value === '') delete obj[key];
            else obj[key] = input.value;
            commit();
        });
    }
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.tip) input.setAttribute('title', opts.tip);
    // Numeric bounds were accepted by callers but never forwarded, so every
    // number field was unbounded — a depth of 0 or -3 saved fine even though
    // floors are 1-based. Only set what the caller asked for: an omitted bound
    // stays unbounded, which is right for signed values like `intercept`.
    if (opts.min != null) input.min = opts.min;
    if (opts.max != null) input.max = opts.max;
    if (opts.step != null) input.step = opts.step;
    return el('div', { class: 'field-row' }, labelEl(label, opts.tip), input);
}

function checkboxRow(label, obj, key, def, tip) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = obj[key] != null ? !!obj[key] : !!def;
    cb.addEventListener('change', () => { obj[key] = cb.checked; commit(); });
    const lbl = el('label', { title: tip || null }, cb, ' ' + label);
    return lbl;
}

// A standalone enable/disable toggle (checkbox + label), not bound to a key.
// `onToggle(checked)` does the model mutation. Optional tooltip.
function toggleLine(label, checked, onToggle, tip) {
    const lbl = el('label', { class: 'toggle-line', title: tip || null });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!checked;
    cb.addEventListener('change', () => onToggle(cb.checked));
    lbl.append(cb, ' ' + label);
    return lbl;
}

function selectRow(label, obj, key, options, opts = {}) {
    const sel = el('select', {});
    const blank = opts.allowBlank !== false;
    if (blank) sel.appendChild(el('option', { value: '' }, opts.blankLabel || '— none —'));
    const optVals = new Set();
    for (const o of options) {
        const val = typeof o === 'object' ? o.value : o;
        const txt = typeof o === 'object' ? o.label : o;
        optVals.add(String(val));
        sel.appendChild(el('option', { value: val }, txt));
    }
    // Preserve an existing value that isn't in the option list (e.g. a filtered
    // list that excludes it) so it's shown and not silently dropped on next edit.
    const cur = obj[key];
    if (cur != null && cur !== '' && !optVals.has(String(cur))) {
        sel.appendChild(el('option', { value: cur }, cur + ' (not in list)'));
    }
    sel.value = obj[key] != null ? obj[key] : '';
    sel.addEventListener('change', () => {
        if (sel.value === '') delete obj[key]; else obj[key] = sel.value;
        commit();
        if (opts.rerender) render();
    });
    if (opts.tip) sel.setAttribute('title', opts.tip);
    return el('div', { class: 'field-row' }, labelEl(label, opts.tip), sel);
}

// Percentage / numeric slider bound to obj[key].
// opts: {min,max,step, guaranteedAt (label '100' specially), suffix, onInput}
function sliderRow(label, obj, key, opts = {}) {
    const min = opts.min ?? 0, max = opts.max ?? 100, step = opts.step ?? 1;
    const range = el('input', { type: 'range', min, max, step });
    const val = el('span', { class: 'slider-val' });
    const cur = obj[key] != null ? obj[key] : (opts.def ?? min);
    range.value = cur;
    const fmt = () => {
        const v = Number(range.value);
        if (opts.guaranteedAt != null && v >= opts.guaranteedAt) {
            val.textContent = 'guaranteed';
            val.classList.add('guaranteed');
        } else {
            val.classList.remove('guaranteed');
            val.textContent = (opts.decimals ? v.toFixed(opts.decimals) : v) + (opts.suffix || '');
        }
    };
    fmt();
    range.addEventListener('input', () => {
        obj[key] = opts.decimals ? Number(Number(range.value).toFixed(opts.decimals)) : Number(range.value);
        fmt();
        if (opts.onInput) opts.onInput();
        commit();
    });
    if (opts.tip) range.setAttribute('title', opts.tip);
    return el('div', { class: 'slider-row' }, labelEl(label, opts.tip), range, val);
}

// Dual-handle min/max range. Reads/writes obj[minKey]/obj[maxKey].
// opts: {min,max,step, onInput}
function dualRange(obj, minKey, maxKey, opts = {}) {
    const lo = opts.min ?? 0, hi = opts.max ?? 100, step = opts.step ?? 1;
    const wrap = el('div', { class: 'dualrange' });
    const track = el('div', { class: 'track' });
    const fill = el('div', { class: 'track-fill' });
    const rmin = el('input', { type: 'range', min: lo, max: hi, step });
    const rmax = el('input', { type: 'range', min: lo, max: hi, step });
    const out = el('span', { class: 'range-vals' });
    let vmin = obj[minKey] != null ? obj[minKey] : (opts.defMin ?? lo);
    let vmax = obj[maxKey] != null ? obj[maxKey] : (opts.defMax ?? hi);
    // allow values beyond the visual max (e.g. gol_cell 200-400): widen track
    const trackHi = Math.max(hi, vmax);
    rmin.max = trackHi; rmax.max = trackHi;
    rmin.value = vmin; rmax.value = vmax;
    const paint = () => {
        const span = trackHi - lo || 1;
        const a = ((vmin - lo) / span) * 100, b = ((vmax - lo) / span) * 100;
        fill.style.left = a + '%'; fill.style.width = Math.max(0, b - a) + '%';
        out.textContent = vmin + '–' + vmax;
    };
    const apply = () => {
        obj[minKey] = vmin; obj[maxKey] = vmax;
        paint(); if (opts.onInput) opts.onInput(); commit();
    };
    rmin.addEventListener('input', () => {
        vmin = Number(rmin.value); if (vmin > vmax) { vmax = vmin; rmax.value = vmax; } apply();
    });
    rmax.addEventListener('input', () => {
        vmax = Number(rmax.value); if (vmax < vmin) { vmin = vmax; rmin.value = vmin; } apply();
    });
    paint();
    wrap.append(track, fill, rmin, rmax);
    return el('div', { class: 'slider-row', style: 'gap:10px;' }, wrap, out);
}

/* Weight-bar editor.
   mode 'object': obj[key] is { name: weight } (roomWeights, item_catalog-ish)
   mode 'pool'  : obj[key] is a repeated array ["water","water","lava"] -> edited as {type:count}
   choices: optional fixed list of selectable names (pool types / categories) */
function weightEditor(obj, key, opts = {}) {
    const mode = opts.mode || 'object';
    const wrap = el('div', { class: 'weight-table' });

    function readWeights() {
        if (mode === 'pool') {
            const arr = Array.isArray(obj[key]) ? obj[key] : [];
            const counts = {};
            for (const t of arr) counts[t] = (counts[t] || 0) + 1;
            return counts;
        }
        return { ...(obj[key] || {}) };
    }
    function writeWeights(w) {
        if (mode === 'pool') {
            const arr = [];
            for (const [t, n] of Object.entries(w)) for (let i = 0; i < n; i++) arr.push(t);
            obj[key] = arr;
        } else {
            obj[key] = w;
        }
        commit();
    }

    function redraw() {
        wrap.innerHTML = '';
        const w = readWeights();
        const total = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
        for (const name of Object.keys(w)) {
            const pct = Math.round((w[name] / total) * 100);
            const bar = el('div', { class: 'wbar-fill', style: `width:${pct}%` });
            const barWrap = el('div', { class: 'wbar-wrap' }, bar, el('span', { class: 'wbar-pct' }, pct + '%'));
            const num = el('input', { type: 'number', min: 0, step: opts.step || 1, value: w[name] });
            num.addEventListener('input', () => {
                const nv = Number(num.value);
                const cur = readWeights();
                if (num.value === '' || nv <= 0) delete cur[name]; else cur[name] = nv;
                writeWeights(cur); redraw();
            });
            const rm = el('button', { class: 'remove-btn', title: 'remove' }, '×');
            rm.addEventListener('click', () => { const c = readWeights(); delete c[name]; writeWeights(c); redraw(); });

            let labelNode;
            if (opts.choices) {
                labelNode = el('select', { class: 'wlabel-sel' });
                for (const c of opts.choices) labelNode.appendChild(el('option', { value: c }, c));
                labelNode.value = name;
                labelNode.addEventListener('change', () => {
                    const c = readWeights(); const v = c[name]; delete c[name]; c[labelNode.value] = (c[labelNode.value]||0)+v;
                    writeWeights(c); redraw();
                });
            } else {
                labelNode = el('span', { class: 'wlabel' }, name);
            }
            wrap.appendChild(el('div', { class: 'weight-row' }, labelNode, barWrap, num, rm));
        }
        // add control
        const existing = new Set(Object.keys(w));
        if (!opts.choices) {
            // free-text add for object mode without fixed choices (e.g. roomWeights extra)
            const addInput = el('input', { type: 'text', placeholder: 'new name', style: 'width:90px;' });
            const addBtn = el('button', { class: 'add-btn' }, '+ add');
            addBtn.addEventListener('click', () => {
                const nm = addInput.value.trim(); if (!nm) return;
                const c = readWeights(); if (!c[nm]) c[nm] = 1; writeWeights(c); redraw();
            });
            wrap.appendChild(el('div', { class: 'weight-row' }, addInput, addBtn));
        } else {
            // Fixed-choice add: only offer the dropdown while unused choices remain
            // (once every choice is added there's nothing to pick, so hide it).
            const remaining = opts.choices.filter((c) => !existing.has(c));
            if (remaining.length) {
                const addSel = el('select', { class: 'wlabel-sel' });
                addSel.appendChild(el('option', { value: '' }, '+ add…'));
                for (const c of remaining) addSel.appendChild(el('option', { value: c }, c));
                addSel.addEventListener('change', () => {
                    if (!addSel.value) return;
                    const c = readWeights(); c[addSel.value] = (c[addSel.value] || 0) + 1; writeWeights(c); redraw();
                });
                wrap.appendChild(el('div', { class: 'weight-row' }, addSel));
            }
        }
    }
    redraw();
    return wrap;
}

/* =========================================================================
   Spawn distribution editor (random_actors / random_items)
   ========================================================================= */
function spawnEditor(obj, key, kind) {
    // obj[key] = { id: {chance, min?, max?} }
    const container = el('div', {});
    const ids = kind === 'actor' ? state.mergedActorIds : state.mergedItemIds;

    function redraw() {
        container.innerHTML = '';
        const table = obj[key] || {};
        const entries = Object.entries(table);
        if (!entries.length) {
            container.appendChild(el('div', { class: 'empty-hint' }, 'No ' + (kind === 'actor' ? 'actors' : 'items') + ' configured.'));
        }
        // Rows flow into a responsive multi-column grid on wide screens.
        const grid = el('div', { class: 'spawn-grid' });
        for (const [id, spec] of entries) {
            grid.appendChild(spawnRow(obj, key, id, spec, kind, ids, redraw));
        }
        if (entries.length) container.appendChild(grid);
        // add row
        const addSel = el('select', { style: 'min-width:200px;' });
        addSel.appendChild(el('option', { value: '' }, '+ add ' + (kind === 'actor' ? 'actor…' : 'item…')));
        for (const id of ids) if (!table[id]) addSel.appendChild(el('option', { value: id }, id));
        addSel.addEventListener('change', () => {
            if (!addSel.value) return;
            if (!obj[key]) obj[key] = {};
            obj[key][addSel.value] = { chance: 100 };
            commit(); redraw();
        });
        container.appendChild(el('div', { style: 'margin-top:4px;' }, addSel));
    }
    redraw();
    return container;
}

function spawnRow(obj, key, id, spec, kind, ids, redraw) {
    const row = el('div', { class: 'spawn-row' });

    // header: id selector + pool hint + remove
    const idSel = el('select', {});
    for (const x of ids) idSel.appendChild(el('option', { value: x }, x));
    if (!ids.includes(id)) idSel.appendChild(el('option', { value: id }, id + ' (unknown)'));
    idSel.value = id;
    idSel.addEventListener('change', () => {
        const newId = idSel.value;
        if (newId === id) return;
        const tbl = obj[key];
        const v = tbl[id]; delete tbl[id]; tbl[newId] = v;
        commit(); redraw();
    });
    const expected = el('span', { class: 'expected' });
    const head = el('div', { class: 'spawn-head' }, idSel);
    if (kind === 'item' && state.poolItemIds.has(id)) {
        head.appendChild(el('span', { class: 'pool-hint', title: 'This id is a category pool; spawns a random concrete type.' }, 'ⓘ pool'));
    }
    head.appendChild(expected);
    const rm = el('button', { class: 'remove-btn' }, '×');
    rm.addEventListener('click', () => { delete obj[key][id]; commit(); redraw(); });
    head.appendChild(rm);
    row.appendChild(head);

    function recomputeExpected() {
        const c = spec.chance != null ? spec.chance : 100;
        const mn = spec.min != null ? spec.min : 1;
        const mx = spec.max != null ? spec.max : (spec.min != null ? spec.min : 1);
        const exp = (c / 100) * ((mn + mx) / 2);
        expected.textContent = '≈ ' + (Math.round(exp * 100) / 100) + ' / floor';
    }

    // chance slider
    if (spec.chance == null) spec.chance = 100;
    const chanceWrap = sliderRow('chance', spec, 'chance', {
        min: 0, max: 100, guaranteedAt: 100, suffix: '%', onInput: recomputeExpected,
        tip: 'Probability this entry spawns at all. 100% = guaranteed; below that it’s a per-floor roll.',
    });
    row.appendChild(chanceWrap);

    // count dual-range (min/max). Default both to 1 when absent.
    if (spec.min == null && spec.max == null) { /* leave unset, treated as 1/1 */ }
    const countObj = {
        get min() { return spec.min != null ? spec.min : 1; },
        set min(v) { spec.min = v; },
        get max() { return spec.max != null ? spec.max : (spec.min != null ? spec.min : 1); },
        set max(v) { spec.max = v; },
    };
    // Use a generous visual max; widen automatically for big counts.
    const visMax = Math.max(10, spec.max || 0);
    const countRow = el('div', { class: 'sub' },
        labelEl('count', 'How many to place when it spawns — a random value in this min–max range. Both unset = exactly 1.'),
        dualRange(countObj, 'min', 'max', { min: 0, max: visMax, onInput: () => { recomputeExpected(); } })
    );
    row.appendChild(countRow);
    recomputeExpected();
    return row;
}

/* =========================================================================
   win_conditions editor (array of strings or objects)
   ========================================================================= */
function winConditionsEditor(obj, key) {
    const wrap = el('div', { class: 'dynamic-list' });
    function arr() { if (!Array.isArray(obj[key])) obj[key] = []; return obj[key]; }
    function redraw() {
        wrap.innerHTML = '';
        arr().forEach((cond, i) => wrap.appendChild(condRow(cond, i, redraw, obj, key)));
        const add = el('button', { class: 'add-btn' }, '+ condition');
        add.addEventListener('click', () => { arr().push('killed:'); commit(); redraw(); });
        wrap.appendChild(add);
    }
    redraw();
    return wrap;
}

function condRow(cond, i, redraw, obj, key) {
    const isObj = cond && typeof cond === 'object';
    const row = el('div', { class: 'list-item' });
    const typeSel = el('select', { style: 'flex:0 0 110px;' });
    [['wearing','wearing:'],['holding','holding:'],['killed','killed:'],['stat','stat compare']]
        .forEach(([v, l]) => typeSel.appendChild(el('option', { value: v }, l)));
    let curType = 'killed';
    if (isObj) curType = 'stat';
    else if (typeof cond === 'string') curType = cond.split(':')[0] || 'killed';
    typeSel.value = curType;
    typeSel.addEventListener('change', () => {
        const arr = obj[key];
        if (typeSel.value === 'stat') arr[i] = { actor: 'player', stat: 'health', op: '>=', value: 0 };
        else arr[i] = typeSel.value + ':';
        commit(); redraw();
    });
    row.appendChild(typeSel);

    if (curType === 'stat') {
        const a = el('input', { type: 'text', placeholder: 'actor (player)', style: 'flex:0 0 90px;' });
        a.value = cond.actor || ''; a.addEventListener('input', () => { cond.actor = a.value || undefined; commit(); });
        const s = el('input', { type: 'text', placeholder: 'stat', style: 'flex:0 0 80px;' });
        s.value = cond.stat || ''; s.addEventListener('input', () => { cond.stat = s.value; commit(); });
        const op = el('select', { style: 'flex:0 0 60px;' });
        ['>','>=','<','<=','==','!='].forEach(o => op.appendChild(el('option', { value: o }, o)));
        op.value = cond.op || '>='; op.addEventListener('change', () => { cond.op = op.value; commit(); });
        const v = el('input', { type: 'number', style: 'flex:0 0 70px;' });
        v.value = cond.value != null ? cond.value : 0; v.addEventListener('input', () => { cond.value = Number(v.value); commit(); });
        row.append(a, s, op, v);
    } else {
        // operand: actor id (killed) or item id (wearing/holding)
        const operand = (typeof cond === 'string' ? cond.split(':')[1] : '') || '';
        const ids = curType === 'killed' ? state.mergedActorIds : state.mergedItemIds;
        const sel = el('select', {});
        sel.appendChild(el('option', { value: '' }, '— pick —'));
        for (const x of ids) sel.appendChild(el('option', { value: x }, x));
        if (operand && !ids.includes(operand)) sel.appendChild(el('option', { value: operand }, operand + ' (?)'));
        sel.value = operand;
        sel.addEventListener('change', () => { obj[key][i] = curType + ':' + sel.value; commit(); });
        row.appendChild(sel);
    }
    const rm = el('button', { class: 'remove-btn' }, '×');
    rm.addEventListener('click', () => { obj[key].splice(i, 1); commit(); redraw(); });
    row.appendChild(rm);
    return row;
}

/* =========================================================================
   Section helpers — including the floor inheritance/override toggle
   ========================================================================= */
// Build a <details> section. If we're on a floor and `inheritKey` is given,
// show an "override on this floor" toggle that adds/removes target[inheritKey].
//
// `opts.optional` makes the whole section switchable via a header toggle:
//   { isOn: bool, enable: fn, disable: fn }
// When off, the body is left empty (with a hint) and `active` is returned false
// so the caller skips populating it. enable/disable mutate the model + render.
// This coexists with the floor override-toggle (both can appear in the header).
function section(title, opts = {}) {
    const det = el('details', { class: 'section' });
    if (opts.open) det.setAttribute('open', '');
    const summary = el('summary', {});
    const summaryRow = el('div', { class: 'section-summary-row' }, el('span', { class: 'sec-title' }, title));
    summary.appendChild(summaryRow);
    det.appendChild(summary);
    const body = el('div', { class: 'section-body' });
    det.appendChild(body);
    let active = true;

    if (opts.optional) {
        const on = !!opts.optional.isOn;
        active = on;
        const toggle = el('label', { class: 'section-enable-toggle', title: 'Enable or disable this section. Disabling removes its settings.' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = on;
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            if (cb.checked) opts.optional.enable(); else opts.optional.disable();
            commit(); render();
        });
        toggle.append(cb, ' enabled');
        toggle.addEventListener('click', (e) => e.stopPropagation());
        summaryRow.appendChild(toggle);
        if (!on) {
            det.classList.add('section-disabled');
            if (opts.optional.hint !== false) {
                body.appendChild(el('div', { class: 'hint-inline' },
                    opts.optional.hint || 'Disabled — enable this section to configure it.'));
            }
        }
    }

    if (opts.inheritKey && isFloor()) {
        const target = currentTarget();
        const overridden = Object.prototype.hasOwnProperty.call(target, opts.inheritKey);
        const toggle = el('label', { class: 'override-toggle' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = overridden;
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            if (cb.checked) {
                // copy inherited value as the starting point for the override
                const inh = inheritedValue(opts.inheritKey);
                target[opts.inheritKey] = inh !== undefined
                    ? JSON.parse(JSON.stringify(inh))
                    : (opts.defaultValue !== undefined ? opts.defaultValue : {});
            } else {
                delete target[opts.inheritKey];
            }
            commit(); render();
        });
        toggle.append(cb, ' override on this floor');
        toggle.addEventListener('click', (e) => e.stopPropagation());
        summaryRow.appendChild(toggle);
        if (!overridden) {
            det.classList.add('inherited');
            const inh = inheritedValue(opts.inheritKey);
            summaryRow.appendChild(el('span', { class: 'inherit-badge' },
                inh !== undefined ? '(inherited from prototype)' : '(not set at prototype level)'));
        }
    }
    return { det, body, active };
}

function subTitle(t, tip) {
    const n = el('div', { class: 'sub-section-title' }, t);
    if (tip) n.setAttribute('title', tip);
    return n;
}

/* A collapsible sub-section: same look as subTitle(), but the body folds away.
   For blocks that are legitimately long — a biome's depth-ranged actor catalog can
   run to a dozen rows of two sliders each, which buries the sections under it.

   `countLabel` is shown in the summary so the block still reports its size while
   collapsed (an empty catalog shouldn't look identical to a full one).

   Open state is keyed by `stateKey` on a module-level map rather than on the model,
   so it survives render()'s full rebuild without leaking into the exported JSON. */
const _subSectionOpen = Object.create(null);

function collapsibleSubSection(title, stateKey, countLabel, tip, opts = {}) {
    const det = el('details', { class: 'sub-section sub-collapsible' });
    // Default closed for long blocks; the caller decides via opts.defaultOpen.
    const remembered = _subSectionOpen[stateKey];
    if (remembered !== undefined ? remembered : !!opts.defaultOpen) det.setAttribute('open', '');
    const summary = el('summary', { class: 'sub-section-title' }, title);
    if (countLabel) summary.appendChild(el('span', { class: 'sub-count' }, countLabel));
    if (tip) summary.setAttribute('title', tip);
    det.appendChild(summary);
    det.addEventListener('toggle', () => { _subSectionOpen[stateKey] = det.open; });
    const body = el('div', {});
    det.appendChild(body);
    return { det, body };
}

