/* =========================================================================
   proto-sections.js — render loop + all section builders
   -------------------------------------------------------------------------
   Extracted from prototype-editor.html. These files are plain <script> src
   includes (no bundler) and share one global scope; load order matters:
   proto-state -> proto-widgets -> proto-sections -> proto-render. The final
   file calls init(). Do not wrap in IIFEs — cross-file references rely on the
   shared top-level scope.
   ========================================================================= */
"use strict";

/* =========================================================================
   Render
   ========================================================================= */
function render() {
    // Preserve which <details> sections the user had open. renderForm() rebuilds
    // every section from scratch, so without this any toggle that calls render()
    // (e.g. the carved-regions checkbox) would collapse the section the user was
    // working in — only sections flagged open:true survived. Key off the section
    // title text (the .sec-title span set in section()).
    const openTitles = new Set(
        Array.from(document.querySelectorAll('#form-sections details.section[open]'))
            .map(d => d.querySelector('.sec-title')?.textContent)
            .filter(Boolean)
    );
    renderFloorTabs();
    renderForm();
    if (openTitles.size) {
        for (const d of document.querySelectorAll('#form-sections details.section')) {
            const title = d.querySelector('.sec-title')?.textContent;
            if (title && openTitles.has(title)) d.setAttribute('open', '');
        }
    }
    updateJSONOutput();
}

function renderFloorTabs() {
    const bar = document.getElementById('floor-tabs');
    bar.innerHTML = '';
    if (!state.proto) return;
    const protoTab = el('button', { class: 'floor-tab proto-tab' + (state.activeFloor === 'proto' ? ' active' : '') }, 'Prototype defaults');
    protoTab.addEventListener('click', () => { state.activeFloor = 'proto'; render(); });
    bar.appendChild(protoTab);

    const levels = state.proto.levels || [];
    levels.forEach((_, i) => {
        const t = el('button', { class: 'floor-tab' + (state.activeFloor === i ? ' active' : '') }, 'Floor ' + (i + 1));
        t.addEventListener('click', () => { state.activeFloor = i; render(); });
        bar.appendChild(t);
    });
    const add = el('button', { class: 'add-btn' }, '+ floor');
    add.addEventListener('click', () => {
        if (!state.proto.levels) state.proto.levels = [];
        state.proto.levels.push({ win_conditions: [] });
        state.activeFloor = state.proto.levels.length - 1;
        commit(); render();
    });
    bar.appendChild(add);

    if (isFloor()) {
        const del = el('button', { class: 'remove-btn' }, 'remove floor ' + (state.activeFloor + 1));
        del.addEventListener('click', () => {
            state.proto.levels.splice(state.activeFloor, 1);
            if (!state.proto.levels.length) delete state.proto.levels;
            state.activeFloor = 'proto';
            commit(); render();
        });
        bar.appendChild(del);
    }
    bar.appendChild(el('span', { class: 'floor-hint' },
        isFloor() ? 'Dimmed sections are inherited from prototype defaults; toggle “override” to localize.'
                  : (levels.length ? levels.length + ' floor(s). Per-floor tabs override these defaults.'
                                   : 'Flat prototype (no per-floor overrides). Add a floor to localize settings.')));
}

function renderForm() {
    const root = document.getElementById('form-sections');
    root.innerHTML = '';
    if (!state.proto) return;
    const onProto = !isFloor();

    if (onProto) {
        // A cutscene toggle sits above everything: making a prototype a cutscene
        // supersedes all level config, so it lives at the top of the form.
        root.appendChild(cutsceneToggle());
        // When this prototype IS a cutscene, everything else is invalid — show
        // only Identity + the cutscene config and stop.
        if (state.proto.cutscene) {
            root.appendChild(sectionIdentity().det);
            root.appendChild(sectionCutscene().det);
            return;
        }
        root.appendChild(sectionIdentity().det);
        root.appendChild(sectionMechanics(state.proto, 'mechanics', { open: true }).det);
        root.appendChild(sectionWinState().det);
        root.appendChild(sectionMapGenerator(state.proto).det);
        root.appendChild(sectionItemCatalog().det);
        root.appendChild(sectionSpawns(state.proto, { open: true }).det);
        root.appendChild(sectionAdvanced().det);
    } else {
        const floor = currentTarget();
        root.appendChild(sectionFloorWinConditions(floor).det);
        root.appendChild(sectionMechanics(floor, 'mechanics', { inheritKey: 'mechanics', open: true }).det);
        root.appendChild(sectionMapGenerator(floor, { inheritKey: 'map_generator' }).det);
        root.appendChild(sectionItemBudget(floor, { inheritKey: 'item_budget' }).det);
        root.appendChild(sectionSpawns(floor, { open: true }).det);
    }
}

/* ---- Sections (prototype-level) ---- */
// Identity is templated (see #tpl-section-identity). Structure lives in markup;
// JS only renders it, binds the inputs to state.proto, and returns the section.
function sectionIdentity() {
    const { det, body } = section('Identity', { open: true });
    body.innerHTML = EditorTemplate.compileById('tpl-section-identity')({
        soundIds: state.soundIds,
    });
    EditorTemplate.bindSection(body, {
        resolveScope: () => state.proto,
        onCommit: commit,
    });
    return { det };
}

// Mechanics: the flag checkboxes + viewport/ai_margin fields are templated
// (#tpl-section-mechanics); the two sliders and the tint color picker keep
// their JS builders and are mounted into the template's data-mount slots.
function sectionMechanics(obj, key, opts = {}) {
    const { det, body } = section('Mechanics', { ...opts, inheritKey: opts.inheritKey, defaultValue: {} });
    if (opts.inheritKey && isFloor() && !Object.prototype.hasOwnProperty.call(obj, key)) return { det };
    if (!obj[key]) obj[key] = {};
    const m = obj[key];

    body.innerHTML = EditorTemplate.compileById('tpl-section-mechanics')({});
    EditorTemplate.bindSection(body, {
        resolveScope: () => m,   // every data-scope="mechanics" input binds to m
        onCommit: commit,
    });

    // JS-only widgets: live value formatting / coupled controls.
    EditorTemplate.mountInto(body, 'treasure_room',
        sliderRow('treasure_room %', m, 'treasure_room', { min: 0, max: 100, suffix: '%', def: 0,
            tip: 'Chance per floor that a special locked treasure room is generated.' }));
    EditorTemplate.mountInto(body, 'ambient_light_group', ambientLightGroup(m));
    return { det };
}

// The two aspects of a level's baseline light: ambient_light (brightness) and
// tint (color overlay) live together under one "ambient level light" toggle so
// it's clear they're facets of the same thing. Toggle off = no ambient config
// (engine defaults: ambient_light 1 / fully lit, no tint), so both keys are
// deleted. Modeled on collapsingEditor's toggle+config pattern.
function ambientLightGroup(m) {
    const tip = 'Baseline light for the level: overall brightness (ambient_light) and an atmospheric color overlay (tint). Off = engine default (fully lit, no tint).';
    const wrap = el('div', { class: 'sub-section' });
    const on = m.ambient_light != null || m.tint != null;
    wrap.appendChild(toggleLine('ambient level light', on, (checked) => {
        if (checked) { if (m.ambient_light == null) m.ambient_light = 1; }
        else { delete m.ambient_light; delete m.tint; }
        commit(); render();
    }, tip));
    if (on) {
        wrap.appendChild(sliderRow('ambient_light', m, 'ambient_light', { min: 0, max: 1, step: 0.05, decimals: 2, def: 1,
            tip: 'Base brightness applied everywhere (0 = pitch black, 1 = fully lit). Used with darkness.' }));
        wrap.appendChild(colorRow('tint', m, 'tint'));
    }
    return wrap;
}

function colorRow(label, obj, key, tip) {
    tip = tip || 'Screen color overlay for this level (atmospheric tint). Clear to use no tint.';
    const color = el('input', { type: 'color' });
    const hex = el('input', { type: 'text', placeholder: '#RRGGBB', style: 'flex:0 0 90px;' });
    const cur = obj[key] || '';
    if (cur) { color.value = cur; hex.value = cur; }
    color.addEventListener('input', () => { obj[key] = color.value; hex.value = color.value; commit(); });
    hex.addEventListener('input', () => {
        if (hex.value === '') { delete obj[key]; }
        else { obj[key] = hex.value; if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) color.value = hex.value; }
        commit();
    });
    const clear = el('button', { class: 'remove-btn' }, 'clear');
    clear.addEventListener('click', () => { delete obj[key]; hex.value = ''; commit(); });
    return el('div', { class: 'field-row' }, labelEl(label, tip), color, hex, clear);
}

function sectionWinState() {
    const p = state.proto;
    const hasWin = Array.isArray(p.win_conditions) || p.win_state != null;
    const { det, body, active } = section('Win state / conditions', {
        optional: {
            isOn: hasWin,
            enable: () => { if (!Array.isArray(p.win_conditions)) p.win_conditions = []; },
            disable: () => { delete p.win_conditions; delete p.win_state; },
        },
    });
    if (!active) return { det };
    // top-level win_conditions (used by flat, non-leveled prototypes)
    body.appendChild(subTitle('win_conditions (prototype-level / flat prototypes)',
        'Conditions that clear a single-level (flat) prototype. For multi-floor prototypes, set these per floor instead.'));
    body.appendChild(el('div', { class: 'hint-inline' }, 'For multi-floor prototypes set win_conditions per floor tab instead.'));
    body.appendChild(winConditionsEditor(p, 'win_conditions'));

    body.appendChild(subTitle('win_state (escape-style victory)', 'Optional overall victory condition for the whole prototype, separate from per-floor win_conditions.'));
    const enable = toggleLine('enable win_state', !!p.win_state, (on) => {
        if (on) p.win_state = { conditions: [], message: '' }; else delete p.win_state;
        commit(); render();
    }, 'When enabled, the run is won once these conditions are met (optionally only at a specific exit floor).');
    body.appendChild(enable);
    if (p.win_state) {
        const ws = p.win_state;
        body.appendChild(fieldGrid(
            selectRow('via', ws, 'via', ['escape'], { blankLabel: '— reach exit (default) —', rerender: true,
                tip: '“escape” = win by reaching a specific exit_floor with the conditions met. Blank = win on reaching any level exit.' }),
            (ws.via === 'escape' ? fieldRow('exit_floor', ws, 'exit_floor', { type: 'number', tip: 'Floor number whose exit triggers the escape victory.' }) : null),
        ));
        body.appendChild(fieldRow('message', ws, 'message', { tip: 'Victory text shown to the player when the win_state is satisfied.' }));
        body.appendChild(subTitle('conditions', 'All of these must be true to win. e.g. holding:amulet, killed:minotaur, or a stat comparison.'));
        body.appendChild(winConditionsEditor(ws, 'conditions'));
    }
    return { det };
}

function sectionFloorWinConditions(floor) {
    const { det, body } = section('Win conditions (this floor)', { open: true });
    body.appendChild(el('div', { class: 'hint-inline' }, 'Floor cleared / exit unlocked when all conditions are met.'));
    body.appendChild(winConditionsEditor(floor, 'win_conditions'));
    return { det };
}

function sectionMapGenerator(obj, opts = {}) {
    // At proto level the section is optional (disable → no generator config, e.g.
    // a prototype driven by a hand-authored map.tmj). At floor level the floor
    // "override" toggle already serves that role, so no separate enable toggle.
    const sectionOpts = { ...opts, defaultValue: { type: 'brogue', options: {} } };
    if (!opts.inheritKey) {
        sectionOpts.optional = {
            isOn: obj.map_generator != null,
            enable: () => { obj.map_generator = { type: 'brogue', options: {} }; },
            disable: () => { delete obj.map_generator; },
            hint: 'No procedural generator — the map comes from a hand-authored .tmj. Placed features below still apply.',
        };
    }
    const { det, body, active } = section('Map generator', sectionOpts);
    // Placed features (traps/fungus/switch_puzzles) are independent top-level keys,
    // shown even when the generator config is inherited (floor) or absent (proto,
    // hand-authored map). Only the generator-specific UI is gated.
    // - proto: gated by the optional toggle (`active`)
    // - floor: gated by the override toggle (map_generator present on the floor)
    const showGenBody = opts.inheritKey
        ? (isFloor() && Object.prototype.hasOwnProperty.call(obj, 'map_generator'))
        : active;
    if (showGenBody) {
        mapGeneratorBody(obj, body);
    }
    // Placed features (traps, fungus, switch puzzles): part of what the generator
    // scatters onto the finished map. They read `obj` (top-level keys), not options.
    body.appendChild(el('div', { class: 'sub-section' },
        subTitle('Placed features', 'Hazards and puzzles scattered onto the generated map.')));
    trapsSwitchesBody(obj, body);
    return { det };
}

function mapGeneratorBody(obj, body) {
    if (!obj.map_generator) obj.map_generator = { type: 'brogue', options: {} };
    const mg = obj.map_generator;
    if (!mg.options) mg.options = {};
    body.appendChild(selectRow('type', mg, 'type', GEN_TYPES, { allowBlank: false, rerender: true,
        tip: 'Algorithm used to build the map: brogue (rooms + corridors + loops), digger (ROT.js dungeon), arena (open box), infernal (lava-heavy caverns).' }));
    const o = mg.options;
    body.appendChild(fieldGrid(
        fieldRow('map_width', o, 'map_width', { type: 'number', tip: 'Total map width in tiles (can exceed the viewport — the level then scrolls).' }),
        fieldRow('map_height', o, 'map_height', { type: 'number', tip: 'Total map height in tiles (can exceed the viewport — the level then scrolls).' }),
    ));

    const t = mg.type || 'brogue';
    if (t === 'brogue' || t === 'infernal') {
        if (t === 'brogue') {
            // maxRooms is intentionally not exposed: the engine auto-computes it
            // from the map size (larger maps get more rooms). maxAttempts is also
            // auto-scaled to map size when left blank; expose it as an optional
            // override for fine-tuning density.
            body.appendChild(fieldRow('maxAttempts', o, 'maxAttempts', { type: 'number', tip: 'Optional override: how many room-placement attempts the generator makes (the practical cap on how densely the map fills). Leave blank to auto-scale with map size. Larger = denser.' }));
            body.appendChild(sliderRow('corridorChance %', o, 'corridorChance', { min: 0, max: 100, suffix: '%', def: 0,
                tip: 'Chance to connect a new room with a corridor (vs. an adjacent doorway). Default 30%.' }));
            body.appendChild(dualRangeArrayRow('corridorLength', o, 'corridorLength', { min: 1, max: 12,
                tip: 'Min–max length (tiles) of generated corridors.' }));
            body.appendChild(fieldGrid(
                fieldRow('loopMinDistance', o, 'loopMinDistance', { type: 'number',
                    tip: 'Two points must be at least this far apart (path distance) before a loop-back corridor connects them. Default 20.' }),
                fieldRow('maxLoops', o, 'maxLoops', { type: 'number',
                    tip: 'Maximum extra loop corridors added (creates alternate routes). Default 5.' }),
            ));
            body.appendChild(el('div', { class: 'sub-section' }, subTitle('roomWeights', 'Relative likelihood of each room shape. Bars show each shape’s share of the total.'),
                weightEditor(o, 'roomWeights', { choices: ['rectangle','cross','circular','cavern'] })));
        }
        body.appendChild(carvedRegionsEditor(o));
        if (t === 'brogue') {
            body.appendChild(bridgesEditor(o));
            body.appendChild(collapsingEditor(o));
        }
    } else if (t === 'digger') {
        body.appendChild(fieldGrid(
            dualRangeArrayRow('roomWidth', o, 'roomWidth', { min: 1, max: 20, tip: 'Min–max width of dug rooms (tiles).' }),
            dualRangeArrayRow('roomHeight', o, 'roomHeight', { min: 1, max: 20, tip: 'Min–max height of dug rooms (tiles).' }),
        ));
        body.appendChild(dualRangeArrayRow('corridorLength', o, 'corridorLength', { min: 1, max: 12, tip: 'Min–max corridor length (tiles).' }));
        body.appendChild(sliderRow('dugPercentage', o, 'dugPercentage', { min: 0, max: 1, step: 0.05, decimals: 2, def: 0.2,
            tip: 'Fraction of the map carved out into rooms/corridors before the generator stops. Default 0.2.' }));
    }
    // arena: only map_width/height (already shown)
}

// dual range writing to an array [min,max] at obj[key]
function dualRangeForArray(obj, key, opts) {
    if (!Array.isArray(obj[key])) obj[key] = obj[key] || [opts.min ?? 0, opts.max ?? 0];
    const proxy = {
        get min() { return obj[key][0]; }, set min(v) { obj[key][0] = v; },
        get max() { return obj[key][1]; }, set max(v) { obj[key][1] = v; },
    };
    return dualRange(proxy, 'min', 'max', opts);
}
function dualRangeArrayRow(label, obj, key, opts = {}) {
    return el('div', { class: 'sub' }, labelEl(label, opts.tip), dualRangeForArray(obj, key, opts));
}
// Labelled dual-range over obj[minKey]/obj[maxKey] (a {min,max} object).
function dualRangeRow(label, obj, minKey, maxKey, opts = {}) {
    return el('div', { class: 'sub' }, labelEl(label, opts.tip), dualRange(obj, minKey, maxKey, opts));
}

// Liquid types available to a lakes group (no 'abyss' — void is its own group,
// stored under options.abyss, not mixed into the liquid pool).
const LIQUID_TYPES = ['water', 'sewage', 'lava'];

// Consolidated "carved regions" editor. The engine (architect.js
// generateOverlayBlobs) reads two blob-config keys: options.lakes (liquid pool)
// and options.abyss (void). Previously each got its own near-identical form via
// lakeEditor, and abyss's form showed an irrelevant liquid-types dropdown that
// even listed 'abyss' as a liquid. Here they're presented as one section listing
// the region groups that exist — a liquid group (→ options.lakes) and/or an abyss
// group (→ options.abyss) — each with its own count/size, and the liquid group
// with a real liquid-type pool. The data shape written is unchanged, so no
// engine or prototype.json changes are needed.
function carvedRegionsEditor(o) {
    const tip = 'Regions carved into the map: liquid lakes (water/sewage/lava) and/or bottomless abyss pits. Bridges can span either so the player can cross.';
    const wrap = el('div', { class: 'sub-section' });
    const enable = el('label', { class: 'toggle-line', title: tip });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!(o.lakes || o.abyss);
    cb.addEventListener('change', () => {
        if (cb.checked) o.lakes = { count: [1, 2], types: ['water'], minSize: 15, maxSize: 60 };
        else { delete o.lakes; delete o.abyss; }
        commit(); render();
    });
    enable.append(cb, ' carved regions');
    wrap.appendChild(enable);

    if (o.lakes || o.abyss) {
        // Liquid group (options.lakes)
        if (o.lakes) {
            wrap.appendChild(regionGroup(o, 'lakes', 'Lakes (liquid)', {
                countTip: 'Min–max number of separate liquid regions per floor.',
                sizeTip: 'size (in tiles) of a single liquid region.',
                liquid: true,
            }));
        } else {
            wrap.appendChild(addRegionBtn('+ add liquid lakes', () => {
                o.lakes = { count: [1, 2], types: ['water'], minSize: 15, maxSize: 60 };
                commit(); render();
            }));
        }
        // Abyss group (options.abyss) — void, no liquid-type picker.
        if (o.abyss) {
            wrap.appendChild(regionGroup(o, 'abyss', 'Abyss (bottomless void)', {
                countTip: 'Min–max number of separate abyss regions per floor.',
                sizeTip: 'size (in tiles) of a single abyss region.',
                liquid: false,
            }));
        } else {
            wrap.appendChild(addRegionBtn('+ add abyss pits', () => {
                o.abyss = { count: [1, 2], types: ['abyss'], minSize: 15, maxSize: 50 };
                commit(); render();
            }));
        }
    }
    return wrap;
}

function addRegionBtn(label, onClick) {
    const b = el('button', { class: 'add-btn' }, label);
    b.addEventListener('click', onClick);
    return el('div', { class: 'sub' }, b);
}

// One carved-region group bound to o[key] ({count,types,minSize,maxSize}).
// A liquid group gets a weighted liquid-type pool; the abyss group is always
// type ['abyss'] so it shows no type picker. Each group has a remove (×) button.
function regionGroup(o, key, title, opts) {
    const g = el('div', { class: 'sub-section' });
    const head = el('div', { class: 'sub-section-title' }, title);
    const rm = el('button', { class: 'remove-btn', title: 'remove ' + title }, '×');
    rm.addEventListener('click', () => {
        delete o[key];
        // Removing the last group turns the whole feature off; keep the shape sane.
        commit(); render();
    });
    head.appendChild(rm);
    g.appendChild(head);

    const grp = o[key];
    if (!Array.isArray(grp.count)) grp.count = [1, 2];
    g.appendChild(dualRangeArrayRow('count', grp, 'count', { min: 0, max: 6, tip: opts.countTip }));
    if (opts.liquid) {
        if (!Array.isArray(grp.types) || !grp.types.length) grp.types = ['water'];
        g.appendChild(subTitle('types (weighted pool)', 'Which liquid types these lakes use. Each type’s weight is its share of the random pick.'));
        g.appendChild(weightEditor(grp, 'types', { mode: 'pool', choices: LIQUID_TYPES }));
    } else {
        grp.types = ['abyss'];
    }
    g.appendChild(fieldGrid(
        fieldRow('minSize', grp, 'minSize', { type: 'number', tip: 'Smallest ' + opts.sizeTip }),
        fieldRow('maxSize', grp, 'maxSize', { type: 'number', tip: 'Largest ' + opts.sizeTip }),
    ));
    return g;
}

function collapsingEditor(o) {
    const tip = 'Patches of floor that crumble away when stepped on, dropping into the abyss below.';
    const wrap = el('div', { class: 'sub-section' });
    const enable = el('label', { class: 'toggle-line', title: tip });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!o.collapsing_floors;
    cb.addEventListener('change', () => {
        if (cb.checked) o.collapsing_floors = { max: 2, minSize: 2, maxSize: 4 };
        else delete o.collapsing_floors;
        commit(); render();
    });
    enable.append(cb, ' collapsing_floors');
    wrap.appendChild(enable);
    if (o.collapsing_floors) {
        const c = o.collapsing_floors;
        body_appendNum(wrap, c);
    }
    return wrap;
}
function body_appendNum(wrap, c) {
    wrap.appendChild(fieldRow('max', c, 'max', { type: 'number', tip: 'Maximum number of collapsing-floor patches per floor.' }));
    wrap.appendChild(fieldGrid(
        fieldRow('minSize', c, 'minSize', { type: 'number', tip: 'Smallest patch size (tiles).' }),
        fieldRow('maxSize', c, 'maxSize', { type: 'number', tip: 'Largest patch size (tiles).' }),
    ));
}

// Bridges toggle+config (same shape as collapsingEditor). Off = no `bridges` key
// (the generator places none); on = { max } bridges spanning lakes/abyss.
function bridgesEditor(o) {
    const tip = 'Bridges placed across lakes/abyss so the player can cross. Off = none placed.';
    const wrap = el('div', { class: 'sub-section' });
    wrap.appendChild(toggleLine('bridges', !!o.bridges, (on) => {
        if (on) o.bridges = { max: 2 }; else delete o.bridges;
        commit(); render();
    }, tip));
    if (o.bridges) {
        wrap.appendChild(fieldRow('max', o.bridges, 'max', { type: 'number', tip: 'Maximum bridges placed across lakes/abyss.' }));
    }
    return wrap;
}

// Merged Item catalog + budget (proto level). item_budget draws from
// item_catalog, so they belong together: the catalog defines the category mix,
// the budget controls how many items are spawned from it. Budget config is only
// shown once the catalog is enabled — a budget with no catalog has nothing to
// draw from.
function sectionItemCatalog() {
    const p = state.proto;
    const hasCatalog = !!p.item_catalog;
    // The section toggle is the enable for the catalog; disabling drops the
    // catalog and its budget (a budget with no catalog has nothing to draw from).
    const { det, body, active } = section('Item catalog & budget', {
        optional: {
            isOn: hasCatalog,
            enable: () => { p.item_catalog = { potion: { weight: 50 } }; },
            disable: () => { delete p.item_catalog; delete p.item_budget; },
        },
    });
    if (!active) return { det };
    body.appendChild(el('div', { class: 'hint-inline' }, 'Weights bias treasure spawning across categories; optional count limits how many distinct types appear this run. The budget below controls how many items are drawn from this catalog each floor.'));
    body.appendChild(catalogEditor(p.item_catalog));
    body.appendChild(subTitle('item_budget', 'How many catalog items spawn each floor.'));
    itemBudgetBody(p, body);
    return { det };
}

function catalogEditor(cat) {
    const wrap = el('div', {});
    function redraw() {
        wrap.innerHTML = '';
        const total = Object.values(cat).reduce((a, c) => a + (Number(c.weight) || 0), 0) || 1;
        for (const name of Object.keys(cat)) {
            const c = cat[name];
            const pct = Math.round(((c.weight || 0) / total) * 100);
            const bar = el('div', { class: 'wbar-fill', style: `width:${pct}%` });
            const barWrap = el('div', { class: 'wbar-wrap' }, bar, el('span', { class: 'wbar-pct' }, pct + '%'));
            const wInput = el('input', { type: 'number', min: 0, value: c.weight ?? 0, style: 'width:56px;',
                title: 'Relative spawn weight for this category (share of the budget bar shown).' });
            wInput.addEventListener('input', () => { c.weight = Number(wInput.value); commit(); redraw(); });
            const cntInput = el('input', { type: 'number', min: 0, placeholder: 'count', value: c.count ?? '', style: 'width:56px;',
                title: 'Optional: how many distinct item types from this category appear this run. Blank = use all.' });
            cntInput.addEventListener('input', () => { if (cntInput.value === '') delete c.count; else c.count = Number(cntInput.value); commit(); });
            const rm = el('button', { class: 'remove-btn' }, '×');
            rm.addEventListener('click', () => { delete cat[name]; commit(); redraw(); });
            wrap.appendChild(el('div', { class: 'weight-row' },
                el('span', { class: 'wlabel' }, name), barWrap,
                el('span', { class: 'mini-label', title: 'weight' }, 'w'), wInput,
                el('span', { class: 'mini-label', title: 'count' }, 'cnt'), cntInput, rm));
        }
        const addSel = el('select', { class: 'wlabel-sel' });
        addSel.appendChild(el('option', { value: '' }, '+ category…'));
        for (const k of CATEGORY_KEYS) if (!cat[k]) addSel.appendChild(el('option', { value: k }, k));
        addSel.addEventListener('change', () => { if (!addSel.value) return; cat[addSel.value] = { weight: 10 }; commit(); redraw(); });
        wrap.appendChild(el('div', { class: 'weight-row' }, addSel));
    }
    redraw();
    return wrap;
}

// The item_budget controls: a mode select (unset / enabled-object / disabled-
// false) plus base/max_extra/extra_chance fields when enabled. Appended into an
// existing `body` so it can live inside the merged catalog section (proto) or a
// standalone floor-override section. `item_budget` can be `false` to disable on
// a specific floor even if the prototype enables it.
function itemBudgetBody(obj, body) {
    const enableWrap = el('div', { class: 'field-row' });
    const sel = el('select', {});
    [['unset','— not set —'],['object','enabled (configure)'],['false','disabled (false)']].forEach(([v,l]) => sel.appendChild(el('option', { value: v }, l)));
    let mode = 'unset';
    if (obj.item_budget === false) mode = 'false';
    else if (obj.item_budget && typeof obj.item_budget === 'object') mode = 'object';
    sel.value = mode;
    const budgetTip = 'Procedural treasure spawning that draws from item_catalog. Each floor spawns `base` items, then up to `max_extra` more, each at `extra_chance`. Set to false to disable on a floor.';
    sel.setAttribute('title', budgetTip);
    sel.addEventListener('change', () => {
        if (sel.value === 'false') obj.item_budget = false;
        else if (sel.value === 'object') obj.item_budget = { base: 2, extra_chance: 40, max_extra: 3 };
        else delete obj.item_budget;
        commit(); render();
    });
    enableWrap.append(labelEl('mode', budgetTip), sel);
    body.appendChild(enableWrap);
    if (obj.item_budget && typeof obj.item_budget === 'object') {
        const b = obj.item_budget;
        body.appendChild(fieldGrid(
            fieldRow('base', b, 'base', { type: 'number', tip: 'Guaranteed number of budget items spawned each floor.' }),
            fieldRow('max_extra', b, 'max_extra', { type: 'number', tip: 'Maximum additional items beyond base.' }),
        ));
        body.appendChild(sliderRow('extra_chance %', b, 'extra_chance', { min: 0, max: 100, suffix: '%', def: 0,
            tip: 'Chance to roll each additional item (up to max_extra). Higher = more loot.' }));
    }
}

// Floor-level item_budget override. item_catalog is proto-level only, so a floor
// only tweaks how many items it draws (or disables budget with `false`).
function sectionItemBudget(obj, opts = {}) {
    const { det, body } = section('Item budget', { ...opts, defaultValue: { base: 2, extra_chance: 40, max_extra: 3 } });
    if (opts.inheritKey && isFloor() && !Object.prototype.hasOwnProperty.call(obj, 'item_budget')) return { det };
    itemBudgetBody(obj, body);
    return { det };
}

function sectionSpawns(obj, opts = {}) {
    const hasSpawns = obj.random_actors != null || obj.random_items != null;
    // Section toggle governs both spawn tables; disabling drops both. The inner
    // per-table toggles remain as finer controls once the section is on.
    const { det, body, active } = section('Spawns (random_actors / random_items)', {
        ...opts,
        optional: {
            isOn: hasSpawns,
            enable: () => { if (!obj.random_actors) obj.random_actors = {}; },
            disable: () => { delete obj.random_actors; delete obj.random_items; },
        },
    });
    if (!active) return { det };
    // Enable via a toggle (same pattern as traps/switch_puzzles), not a "+ enable" button.
    body.appendChild(toggleLine('random_actors', !!obj.random_actors, (on) => {
        if (on) obj.random_actors = {}; else delete obj.random_actors;
        commit(); render();
    }, 'Creatures placed on this floor. Each entry has a spawn chance and a count range; “≈ N / floor” shows the expected number placed.'));
    if (obj.random_actors) body.appendChild(spawnEditor(obj, 'random_actors', 'actor'));

    body.appendChild(el('div', { style: 'height:8px;' }));
    body.appendChild(toggleLine('random_items', !!obj.random_items, (on) => {
        if (on) obj.random_items = {}; else delete obj.random_items;
        commit(); render();
    }, 'Items dropped on this floor. Category ids (potion, scroll, …) marked “ⓘ pool” resolve to a random concrete type at spawn time.'));
    if (obj.random_items) body.appendChild(spawnEditor(obj, 'random_items', 'item'));
    return { det };
}

// Traps / fungus / switch-puzzle controls, appended into a given `body`. These
// are placed-on-the-floor generation features, so they live inside the Map
// generator section. IMPORTANT: traps/fungus/switch_puzzles are TOP-LEVEL keys
// on the prototype/floor object (`obj`), NOT under map_generator.options — pass
// the level object here, not mg.options.
function trapsSwitchesBody(obj, body) {
    // traps
    body.appendChild(toggleLine('traps', !!obj.traps, (on) => {
        if (on) obj.traps = { min: 0, max: 5 }; else delete obj.traps; commit(); render();
    }, 'Hidden hazard tiles placed on the floor. Count is a random value in the min–max range.'));
    if (obj.traps) {
        body.appendChild(dualRangeRow('count', obj.traps, 'min', 'max', { min: 0, max: 20, tip: 'Min–max number of traps placed on this floor.' }));
    }
    // fungus
    body.appendChild(toggleLine('fungus', !!obj.fungus, (on) => {
        if (on) obj.fungus = { min: 3, max: 8, tall_chance: 0.25 }; else delete obj.fungus; commit(); render();
    }, 'Scatter randomly-named/colored fungus patches. Short fungus is walkable and pops into a small spore cloud (random, usually-beneficial effect) when stepped on; tall fungus is a solid, sight-blocking, flammable cluster.'));
    if (obj.fungus) {
        body.appendChild(dualRangeRow('patches', obj.fungus, 'min', 'max', { min: 0, max: 20, tip: 'Min–max number of fungus patches placed on this floor. Each patch is an anchor plus a few clustered neighbors.' }));
        body.appendChild(fieldRow('tall_chance', obj.fungus, 'tall_chance', { type: 'number', tip: 'Probability (0–1) that a given fungus is the tall, solid, sight-blocking variant instead of short walkable fungus. Default 0 (all short).' }));
    }
    // switch_puzzles
    body.appendChild(toggleLine('switch_puzzles', !!obj.switch_puzzles, (on) => {
        if (on) obj.switch_puzzles = { min: 0, max: 1, patterns: [] }; else delete obj.switch_puzzles;
        commit(); render();
    }, 'Lever/gate puzzles. A random number (min–max) of patterns below are placed, chosen by weight.'));
    if (obj.switch_puzzles) {
        const sp = obj.switch_puzzles;
        body.appendChild(dualRangeRow('count', sp, 'min', 'max', { min: 0, max: 5, tip: 'Min–max number of switch puzzles placed on this floor.' }));
        body.appendChild(subTitle('patterns', 'Puzzle templates to choose from (one is picked per placed puzzle, weighted). Each pattern: a layout to block off, a switch actor the player triggers, a target actor it blocks, and the effect(s) the switch applies to that target.'));
        body.appendChild(patternsEditor(sp));
    }
}

function patternsEditor(sp) {
    const wrap = el('div', {});
    if (!Array.isArray(sp.patterns)) sp.patterns = [];
    function redraw() {
        wrap.innerHTML = '';
        const grid = el('div', { class: 'pattern-grid' });
        sp.patterns.forEach((pat, i) => grid.appendChild(patternBox(pat, i, sp, redraw)));
        if (sp.patterns.length) wrap.appendChild(grid);
        const add = el('button', { class: 'add-btn' }, '+ pattern');
        add.addEventListener('click', () => {
            sp.patterns.push({ type: 'gated_room', weight: 1, switch_actor: '', target_actor: '', switch_effects: {}, switch_message: '' });
            commit(); redraw();
        });
        wrap.appendChild(add);
    }
    redraw();
    return wrap;
}

function patternBox(pat, i, sp, redraw) {
    const box = el('div', { class: 'pattern-box' });
    const head = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;' },
        el('strong', { style: 'font-size:11px;color:var(--accent);' }, 'Pattern ' + (i + 1)));
    const rm = el('button', { class: 'remove-btn' }, 'remove');
    rm.addEventListener('click', () => { sp.patterns.splice(i, 1); commit(); redraw(); });
    head.appendChild(rm);
    box.appendChild(head);
    box.appendChild(fieldGrid(
        // `type` is only the LAYOUT the puzzle blocks off — a room or a corridor
        // segment. The target actor and its effect are chosen below; they aren't
        // implied by the type (a gate that opens is just the common default).
        selectRow('layout', pat, 'type', [
            { value: 'gated_room', label: 'gate a room' },
            { value: 'gated_corridor', label: 'gate a corridor' },
        ], { allowBlank: false,
            tip: 'Which part of the map the target actor blocks off: a whole room, or a corridor segment. The target actor and what the switch does to it are set below.' }),
        fieldRow('weight', pat, 'weight', { type: 'number', tip: 'Relative likelihood this pattern is chosen vs. the others.' }),
    ));
    box.appendChild(fieldGrid(
        // Only actors that can actually be a switch / a target are offered.
        selectRow('switch_actor', pat, 'switch_actor', switchActorIds(), { blankLabel: '— pick switch —', rerender: true,
            tip: 'Actor the player interacts with to trigger the puzzle. Only actors with the `switchable` attribute (levers, pressure plates) are listed.' }),
        selectRow('target_actor', pat, 'target_actor', targetActorIds(), { blankLabel: '— pick target —', rerender: true,
            tip: 'Actor that responds when the switch fires. Only `openable`/`switchable` actors (gates, doors) are listed.' }),
    ));
    // Toggle-vs-once behavior is a property of the chosen switch actor
    // (its `one_shot` attribute), not the puzzle — surface it read-only so the
    // designer knows what they're picking. Change it by editing the actor.
    const mode = switchModeLabel(pat.switch_actor);
    if (mode) {
        box.appendChild(el('div', { class: 'hint-inline' },
            'This switch ' + (mode === 'toggleable'
                ? 'is toggleable (can flip on and off).'
                : 'activates once (one_shot — can’t be reset).')));
    }
    box.appendChild(fieldRow('switch_message', pat, 'switch_message', { tip: 'Message shown to the player when the switch is activated.' }));
    box.appendChild(subTitle('switch_effects (state changes applied to target)',
        'Attribute changes applied to the target actor when triggered, e.g. open:true, locked:false.'));
    box.appendChild(effectsEditor(pat));
    return box;
}

function effectsEditor(pat) {
    const wrap = el('div', { class: 'dynamic-list' });
    if (!pat.switch_effects) pat.switch_effects = {};
    function redraw() {
        wrap.innerHTML = '';
        // Attributes the chosen target actor exposes — offered as key choices so
        // the designer isn't guessing attribute names. Free-text stays available
        // for anything not listed (arbitrary attributes still work: the engine
        // applies switch_effects as generic setAttribute calls).
        const targetAttrs = pat.target_actor ? targetToggleableAttrs(pat.target_actor) : [];
        for (const k of Object.keys(pat.switch_effects)) {
            const v = pat.switch_effects[k];
            const rename = (nv) => {
                nv = (nv || '').trim(); if (!nv || nv === k) return;
                pat.switch_effects[nv] = pat.switch_effects[k]; delete pat.switch_effects[k]; commit(); redraw();
            };
            // Key editor: a dropdown of the target's attributes when we know them
            // and the current key fits, otherwise a free-text input.
            let keyNode;
            if (targetAttrs.length && (targetAttrs.includes(k) || k === '')) {
                keyNode = el('select', { style: 'flex:0 0 120px;', title: 'Attribute on the target actor to change.' });
                for (const a of targetAttrs) keyNode.appendChild(el('option', { value: a }, a));
                keyNode.appendChild(el('option', { value: '__other__' }, 'other…'));
                keyNode.value = k;
                keyNode.addEventListener('change', () => {
                    if (keyNode.value === '__other__') {
                        // switch this row to a custom free-text key
                        const nv = prompt('Attribute name:', k || '');
                        if (nv) rename(nv); else redraw();
                    } else rename(keyNode.value);
                });
            } else {
                keyNode = el('input', { type: 'text', value: k, style: 'flex:0 0 120px;',
                    title: 'Attribute name on the target actor (e.g. open, locked, solid).' });
                keyNode.addEventListener('change', () => rename(keyNode.value));
            }
            const valSel = el('select', { style: 'flex:0 0 80px;' });
            [['true','true'],['false','false']].forEach(([vv, l]) => valSel.appendChild(el('option', { value: vv }, l)));
            valSel.value = String(!!v);
            valSel.addEventListener('change', () => { pat.switch_effects[k] = valSel.value === 'true'; commit(); });
            const rm = el('button', { class: 'remove-btn' }, '×');
            rm.addEventListener('click', () => { delete pat.switch_effects[k]; commit(); redraw(); });
            wrap.appendChild(el('div', { class: 'list-item' }, keyNode, valSel, rm));
        }
        const add = el('button', { class: 'add-btn' }, '+ effect');
        add.addEventListener('click', () => {
            // Prefer an unused target attribute; fall back to the old open/locked default.
            const prefer = targetAttrs.filter(a => pat.switch_effects[a] === undefined);
            let n = prefer[0] || 'open';
            if (pat.switch_effects[n] !== undefined) n = 'locked';
            if (pat.switch_effects[n] !== undefined) n = 'effect' + Object.keys(pat.switch_effects).length;
            pat.switch_effects[n] = true; commit(); redraw();
        });
        wrap.appendChild(add);
    }
    redraw();
    return wrap;
}

// Advanced / passthrough: cutscene + any unknown top-level keys (preserved verbatim).
const KNOWN_TOP_KEYS = new Set([
    'name','description','loaded_sound','turn_speed','next_level','previous_level','intro_cutscene',
    'mechanics','win_state','win_conditions','map_generator','item_catalog','item_budget',
    'random_actors','random_items','traps','switch_puzzles','levels','cutscene',
]);
// Top-of-form control: whether this prototype is a cutscene. A cutscene has no
// playable level, so turning this on supersedes and hides all other sections
// (renderForm branches on state.proto.cutscene). Returned as a bare toggle line,
// not a <details> section, so it sits above the section list.
function cutsceneToggle() {
    const p = state.proto;
    const wrap = el('div', { class: 'cutscene-toggle' });
    wrap.appendChild(toggleLine('This prototype is a cutscene', !!p.cutscene, (on) => {
        if (on) p.cutscene = { flipbook: '', skippable: true }; else delete p.cutscene;
        commit(); render();
    }, 'A flipbook cutscene (a Tiled .tmj played as animated frames) instead of a playable level. When on, all level settings below are hidden — a cutscene has none.'));
    return wrap;
}

// Cutscene configuration — only shown (via renderForm) when the prototype is a
// cutscene. The enable/disable itself lives in cutsceneToggle() at the top.
function sectionCutscene() {
    const { det, body } = section('Cutscene', { open: true });
    const cs = state.proto.cutscene;
    body.appendChild(fieldGrid(
        fieldRow('flipbook', cs, 'flipbook', { placeholder: 'cutscene.tmj', tip: 'Tiled map file (.tmj) whose tile layers are the cutscene frames.' }),
        el('div', { class: 'field-row' }, checkboxRow('skippable', cs, 'skippable', true, 'Allow the player to skip this cutscene.')),
    ));
    body.appendChild(el('div', { class: 'hint-inline' },
        'Frame timing uses the Identity “Turn speed (ms)” value (ms per frame).'));
    return { det };
}

// Advanced: shows top-level keys the editor has no dedicated UI for, so nothing
// authored by hand is silently lost on export.
function sectionAdvanced() {
    const { det, body } = section('Advanced');
    const p = state.proto;
    const unknown = Object.keys(p).filter(k => !KNOWN_TOP_KEYS.has(k));
    if (unknown.length) {
        body.appendChild(subTitle('Preserved (not editable here)', 'Top-level keys this editor doesn’t have a UI for. They’re kept verbatim on export so nothing is lost.'));
        body.appendChild(el('div', { class: 'unknown-keys' }, unknown.map(k => k + ': ' + JSON.stringify(p[k])).join('\n')));
    } else {
        body.appendChild(el('div', { class: 'hint-inline' }, 'No unrecognized top-level keys.'));
    }
    return { det };
}

