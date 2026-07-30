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

    // Only multi-level prototypes have floor tabs. Floors are 1-based; a tab is
    // marked "authored" when a levels override exists for it (biome prototypes
    // otherwise get their content from the biome, so most floors have no override).
    if (!isMultiLevel()) {
        bar.appendChild(el('span', { class: 'floor-hint' }, 'Single-level prototype. Turn on “Multi-level” to add floors.'));
        return;
    }

    const n = totalFloors();

    // Legacy dense-array prototypes (e.g. the hand-authored dungeon) keep a tab
    // per floor. Biome-driven prototypes deliberately DON'T enumerate floors —
    // that's the whole point of biomes — so they show a tab only for floors that
    // actually have a hand-authored override, plus a picker to add one.
    const denseArray = Array.isArray(state.proto.levels);

    if (denseArray) {
        for (let f = 1; f <= n; f++) {
            const authored = hasFloorOverride(f);
            const t = el('button', { class: 'floor-tab' + (state.activeFloor === f ? ' active' : '') + (authored ? ' authored' : '') },
                'Floor ' + f + (authored ? ' ✎' : ''));
            t.addEventListener('click', () => { state.activeFloor = f; render(); });
            bar.appendChild(t);
        }
        const add = el('button', { class: 'add-btn' }, '+ floor');
        add.addEventListener('click', () => {
            state.proto.levels.push({ win_conditions: [] });
            state.activeFloor = state.proto.levels.length;
            commit(); render();
        });
        bar.appendChild(add);
    } else {
        // Biome-driven: only authored floors get a tab.
        const authoredFloors = [];
        for (let f = 1; f <= n; f++) if (hasFloorOverride(f)) authoredFloors.push(f);
        for (const f of authoredFloors) {
            const t = el('button', { class: 'floor-tab authored' + (state.activeFloor === f ? ' active' : '') }, 'Floor ' + f + ' ✎');
            t.addEventListener('click', () => { state.activeFloor = f; render(); });
            bar.appendChild(t);
        }
        // "add floor override" picker: choose an as-yet-unauthored floor to hand-author.
        const addSel = el('select', { class: 'floor-tab' });
        addSel.appendChild(el('option', { value: '' }, '+ override floor…'));
        for (let f = 1; f <= n; f++) if (!hasFloorOverride(f)) addSel.appendChild(el('option', { value: f }, 'Floor ' + f));
        addSel.addEventListener('change', () => {
            if (!addSel.value) return;
            const f = Number(addSel.value);
            floorOverride(f, true);   // creates the sparse entry
            state.activeFloor = f;
            commit(); render();
        });
        bar.appendChild(addSel);
    }

    if (isFloor()) {
        const del = el('button', { class: 'remove-btn' }, 'clear floor ' + state.activeFloor + ' override');
        del.addEventListener('click', () => { clearFloorOverride(state.activeFloor); state.activeFloor = 'proto'; commit(); render(); });
        bar.appendChild(del);
    }
    bar.appendChild(el('span', { class: 'floor-hint' },
        isFloor() ? 'This floor’s content comes from its biome unless you override it here.'
                  : (denseArray
                      ? n + ' floor(s). Click a floor to hand-author it.'
                      : n + ' floor(s), biome-driven. Only hand-authored floors show a tab; use “+ override floor” to add one.')));
}

// Does floor `f` (1-based) have an explicit override entry?
function hasFloorOverride(f) {
    const l = state.proto.levels;
    if (Array.isArray(l)) return l[f - 1] != null && Object.keys(l[f - 1]).length > 0;
    return !!(l && (l[String(f)] || l[f]));
}

// Remove floor `f`'s override entry (array: null the slot; object: delete key).
function clearFloorOverride(f) {
    const l = state.proto.levels;
    if (!l) return;
    if (Array.isArray(l)) {
        l.splice(f - 1, 1);
        if (!l.length) delete state.proto.levels;
    } else {
        delete l[String(f)]; delete l[f];
        if (!Object.keys(l).length) delete state.proto.levels;
    }
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
        root.appendChild(multiLevelToggle());
        root.appendChild(sectionIdentity().det);
        root.appendChild(sectionMechanics(state.proto, 'mechanics', { open: true }).det);
        root.appendChild(sectionWinState().det);
        // Prototype-level map/items/spawns are the defaults every floor inherits —
        // always shown. Biomes are an additional depth-ramping layer, shown when a
        // multi-level prototype opts into them (has biomes/floor_plan, or via the
        // "use biomes" toggle inside sectionBiomes).
        root.appendChild(sectionMapGenerator(state.proto).det);
        root.appendChild(sectionItemCatalog().det);
        root.appendChild(sectionSpawns(state.proto, { open: true }).det);
        if (isMultiLevel()) {
            root.appendChild(sectionBiomes().det);
            root.appendChild(sectionFloorPlan().det);
        }
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

    if (!opts.noPlacedFeatures) {
        body.appendChild(el('div', { class: 'sub-section' },
            subTitle('Placed features', 'Hazards and puzzles scattered onto the generated map.')));
        trapsSwitchesBody(obj, body);
    }
    return { det };
}

function mapGeneratorBody(obj, body) {
    if (!obj.map_generator) obj.map_generator = { type: 'brogue', options: {} };
    const mg = obj.map_generator;
    if (!mg.options) mg.options = {};
    body.appendChild(selectRow('type', mg, 'type', GEN_TYPES, { allowBlank: false, rerender: true,
        tip: 'Algorithm used to build the map: brogue (rooms + corridors + loops), digger (ROT.js dungeon), arena (open box), infernal (lava-heavy caverns), palladian (symmetrical villa — axial sanctum, portico, colonnade; good for a boss floor).' }));
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
            body.appendChild(roomSizeEditor(o));
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
    } else if (t === 'palladian') {
        body.appendChild(fieldGrid(
            dualRangeArrayRow('bayColumns', o, 'bayColumns', { min: 1, max: 9, def: [3, 7],
                tip: 'Min–max number of east–west bays. Always forced ODD: the centre bay is bisected by the symmetry axis. 5 is the canonical villa.' }),
            dualRangeArrayRow('bayRows', o, 'bayRows', { min: 1, max: 6, def: [2, 4],
                tip: 'Min–max number of north–south bay rows. 3 is canonical.' }),
        ));
        body.appendChild(fieldGrid(
            dualRangeArrayRow('bayWidth', o, 'bayWidth', { min: 2, max: 16, def: [4, 11],
                tip: 'Min–max interior width of one bay, in tiles.' }),
            dualRangeArrayRow('bayHeight', o, 'bayHeight', { min: 2, max: 16, def: [4, 9],
                tip: 'Min–max interior height of one bay, in tiles.' }),
        ));
        body.appendChild(sliderRow('centralBias %', o, 'centralBias', { min: 50, max: 300, suffix: '%', def: 150,
            tip: 'How much wider the central axial bay is than a flanking bay. Above 100% gives a grander salone. Default 150%.' }));
        body.appendChild(sliderRow('mergeChance %', o, 'mergeChance', { min: 0, max: 100, suffix: '%', def: 45,
            tip: 'Chance a mirrored pair of adjacent bays merges into one larger room. 0% = a warren of small rooms; 100% = a few vast halls.' }));
        body.appendChild(porticoEditor(o));
        body.appendChild(sliderRow('sanctumChance %', o, 'sanctumChance', { min: 0, max: 100, suffix: '%', def: 70,
            tip: 'Chance the plan has a non-rectangular cross-hall on the axis (the sanctum). The grammar permits at most one such room. Spawns can target it with "region": "sanctum".' }));
        body.appendChild(el('div', { class: 'sub-section' },
            subTitle('sanctumShapes', 'Which cross-hall shapes are eligible. cross (+) keeps the sanctum tightest; eye (I) swallows most of the plan.'),
            weightEditor(o, 'sanctumShapes', { mode: 'pool', choices: ['cross', 'tee', 'eye'] })));
        body.appendChild(carvedRegionsEditor(o));
        body.appendChild(bridgesEditor(o));
        body.appendChild(collapsingEditor(o));
    }
    // arena: only map_width/height (already shown)
}

// The portico is the villa's principal entrance, on the symmetry axis. Absent
// porticoStyle means ON: 'prostyle' is the engine default, so the toggle has to
// treat "unset" and "'none'" differently.
function porticoEditor(o) {
    const tip = 'The principal entrance on the symmetry axis: a columned porch projecting out (prostyle) or recessed into the facade (in antis).';
    const wrap = el('div', { class: 'sub-section' });
    const enable = el('label', { class: 'toggle-line', title: tip });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = o.porticoStyle !== 'none';
    cb.addEventListener('change', () => {
        if (cb.checked) delete o.porticoStyle;   // back to the engine default
        else o.porticoStyle = 'none';
        commit(); render();
    });
    enable.append(cb, ' portico');
    wrap.appendChild(enable);
    if (o.porticoStyle !== 'none') {
        wrap.appendChild(selectRow('porticoStyle', o, 'porticoStyle', ['prostyle', 'in_antis', 'random'], {
            allowBlank: true,
            tip: 'prostyle: the porch projects out from the facade. in_antis: it is recessed into it. random: picked per floor. Blank = prostyle.' }));
        wrap.appendChild(fieldGrid(
            fieldRow('porticoDepth', o, 'porticoDepth', { type: 'number',
                tip: 'Tiles the porch projects out (prostyle) or is recessed in (in antis). Default 3.' }),
            fieldRow('columnSpacing', o, 'columnSpacing', { type: 'number',
                tip: 'Tiles between colonnade columns; 0 = no colonnade. The column count is forced even so the axis stays an open doorway. Default 2.' }),
        ));
    }
    return wrap;
}

// dual range writing to an array [min,max] at obj[key]
// `opts.def` seeds an unset key with the ENGINE's default rather than the slider
// bounds, so a field that's merely rendered doesn't silently write a bogus override
// (e.g. rectWidth: [1,24]) into the prototype JSON.
function dualRangeForArray(obj, key, opts) {
    if (!Array.isArray(obj[key])) obj[key] = obj[key] || opts.def || [opts.min ?? 0, opts.max ?? 0];
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

// Per-shape size ranges for the brogue generator. Defaults mirror architect.js's
// `case 'brogue'` block — keep them in sync, since they're what the engine falls back
// to when a key is absent and what the sliders seed an unset field with.
//
// Exposing these is what makes room-size variation tunable per biome: roomWeights
// alone only shifts WHICH shapes appear, and the most common shape (rectangle) has
// the smallest default range — so a map can read as uniformly cramped even though
// cross/cavern rooms are capable of being large.
const ROOM_SIZE_FIELDS = [
    { shape: 'rectangle', rows: [
        { label: 'width',  key: 'rectWidth',  def: [3, 12], max: 30 },
        { label: 'height', key: 'rectHeight', def: [3, 8],  max: 30 },
    ] },
    { shape: 'cross', rows: [
        { label: 'width',  key: 'crossWidth',  def: [7, 16], max: 30 },
        { label: 'height', key: 'crossHeight', def: [7, 14], max: 30 },
    ] },
    { shape: 'circular', rows: [
        { label: 'radius', key: 'circularRadius', def: [2, 5], max: 12 },
    ] },
    { shape: 'cavern', rows: [
        { label: 'width',  key: 'cavernWidth',  def: [8, 20], max: 40 },
        { label: 'height', key: 'cavernHeight', def: [8, 15], max: 40 },
    ] },
];

// Room size ranges, grouped by shape so the numbers sit next to the roomWeights that
// decide how often each shape is used. Off by default: the engine's own defaults apply
// until a designer opts in, so we don't write seven redundant overrides into every
// prototype just for rendering the form.
function roomSizeEditor(o) {
    const tip = 'Min–max dimensions for each room shape, in tiles. Widen a range (or raise its minimum) for bigger, more varied rooms; the shape’s roomWeight decides how often it appears.';
    const keys = ROOM_SIZE_FIELDS.flatMap(g => g.rows.map(r => r.key));
    const wrap = el('div', { class: 'sub-section' });

    const enable = el('label', { class: 'toggle-line', title: tip });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = keys.some(k => Array.isArray(o[k]));
    cb.addEventListener('change', () => {
        if (cb.checked) {
            // Seed every field from the engine defaults, so the form opens showing what
            // the generator is actually doing rather than arbitrary slider bounds.
            for (const g of ROOM_SIZE_FIELDS) {
                for (const r of g.rows) if (!Array.isArray(o[r.key])) o[r.key] = [...r.def];
            }
        } else {
            for (const k of keys) delete o[k];
        }
        commit(); render();
    });
    enable.append(cb, ' room sizes');
    wrap.appendChild(enable);

    if (!cb.checked) return wrap;

    for (const g of ROOM_SIZE_FIELDS) {
        const grp = el('div', { class: 'sub-section' }, subTitle(g.shape));
        grp.appendChild(fieldGrid(...g.rows.map(r =>
            dualRangeArrayRow(r.label, o, r.key, { min: 1, max: r.max, def: r.def, tip })
        )));
        wrap.appendChild(grp);
    }
    return wrap;
}

const LIQUID_TYPES = ['water', 'sewage', 'lava'];

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

// Is this prototype multi-level? True when it declares an explicit floor count
// (biome-driven) or a legacy levels[] array. Mirrors the engine's getTotalFloors.
function isMultiLevel() {
    const p = state.proto;
    return p.floors != null || !!p.biomes || !!p.floor_plan || Array.isArray(p.levels);
}

// Top-of-form switch between single-level and multi-level prototypes. Multi-level
// reveals the floor count + Biomes + Floor plan tools; single-level hides all of
// that complexity. Turning it on seeds a small default (3 floors); turning it off
// clears the biome/floor keys (and any levels[]).
function multiLevelToggle() {
    const p = state.proto;
    const wrap = el('div', { class: 'cutscene-toggle' });
    wrap.appendChild(toggleLine('Multi-level prototype', isMultiLevel(), (on) => {
        if (on) {
            if (p.floors == null) p.floors = 3;
        } else {
            delete p.floors; delete p.biomes; delete p.floor_plan; delete p.levels;
            if (state.activeFloor !== 'proto') state.activeFloor = 'proto';
        }
        commit(); render();
    }, 'A dungeon of several floors. Multi-level prototypes ramp difficulty by depth using biomes (see Biomes below) and can hand-author individual floors. Off = a single self-contained level.'));
    if (isMultiLevel()) {
        wrap.appendChild(fieldRow('floors', p, 'floors', { type: 'number',
            tip: 'Total number of floors. Biomes are assigned to floor ranges in the Floor plan below.' }));
    }
    return wrap;
}

/* =========================================================================
   Biomes (multi-level prototypes) — see docs/BIOMES.md
   A biome is a reusable bundle of depth-ranged catalogs (actors/items) + hazard
   ramps + map/mechanics. The floor plan assigns biomes to floor ranges. The
   engine (resolveBiome) turns these into per-floor spawn tables that ramp with
   depth, so you don't author every floor by hand.
   ========================================================================= */

// The biome library: a collapsible per biome, plus add-biome. Each biome edits
// like a mini-prototype (map generator, mechanics, and the depth-ranged catalogs).
function sectionBiomes() {
    const p = state.proto;
    if (!p.biomes) p.biomes = {};
    const { det, body } = section('Biomes', { open: true });
    body.appendChild(el('div', { class: 'hint-inline' },
        'A biome is a themed set of monsters/items/hazards with depth ranges. Assign biomes to floors in the Floor plan below; difficulty ramps automatically with depth.'));

    for (const name of Object.keys(p.biomes)) {
        body.appendChild(biomeCard(name));
    }

    // add biome
    const addWrap = el('div', { class: 'weight-row', style: 'margin-top:8px;' });
    const addInput = el('input', { type: 'text', placeholder: 'new biome name', style: 'width:130px;' });
    const addBtn = el('button', { class: 'add-btn' }, '+ biome');
    addBtn.addEventListener('click', () => {
        const nm = addInput.value.trim();
        if (!nm || p.biomes[nm]) return;
        p.biomes[nm] = { map_generator: { type: 'brogue', options: { map_width: 60, map_height: 50 } },
            actors: [], actor_budget: { base: 3, extra_chance: 60, max_extra: 3 } };
        commit(); render();
    });
    addWrap.append(addInput, addBtn);
    body.appendChild(addWrap);
    return { det };
}

// One biome, as a nested collapsible: rename/remove + its config body.
function biomeCard(name) {
    const p = state.proto;
    const biome = p.biomes[name];
    const card = el('details', { class: 'section biome-card', open: '' });
    const summary = el('summary', {},
        el('div', { class: 'section-summary-row' }, el('span', { class: 'sec-title' }, 'biome: ' + name)));
    card.appendChild(summary);
    const body = el('div', { class: 'section-body' });
    card.appendChild(body);

    // rename + remove
    const nameRow = el('div', { class: 'field-row' });
    const nameInput = el('input', { type: 'text', value: name, title: 'Biome name — referenced by the floor plan.' });
    nameInput.addEventListener('change', () => {
        const nn = nameInput.value.trim();
        if (!nn || nn === name || p.biomes[nn]) { nameInput.value = name; return; }
        p.biomes[nn] = biome; delete p.biomes[name];
        // repoint any floor_plan entries that used the old name
        (p.floor_plan || []).forEach(fp => { if (fp.biome === name) fp.biome = nn; });
        commit(); render();
    });
    const rm = el('button', { class: 'remove-btn' }, 'remove biome');
    rm.addEventListener('click', () => { delete p.biomes[name]; commit(); render(); });
    nameRow.append(labelEl('name'), nameInput, rm);
    body.appendChild(nameRow);

    // map generator + mechanics (reuse the existing section builders against the
    // biome obj). Suppress the map generator's Placed-features block — the biome
    // authors traps/fungus as depth ramps below, writing the same keys.
    body.appendChild(sectionMapGenerator(biome, { noPlacedFeatures: true }).det);
    body.appendChild(sectionMechanics(biome, 'mechanics', {}).det);

    // depth-ranged actor catalog
    body.appendChild(subTitle('actors (depth-ranged)', 'Monsters eligible per floor. Each row spawns within its min–max depth window, chosen by weight. actor_budget sets how many are placed per floor.'));
    if (!Array.isArray(biome.actors)) biome.actors = [];
    body.appendChild(depthCatalogEditor(biome.actors, 'id', state.mergedActorIds));
    body.appendChild(budgetRow(biome, 'actor_budget', 'actor_budget'));

    // depth-ranged item catalog
    body.appendChild(subTitle('items (depth-ranged)', 'Item categories eligible per floor (drawn via item_catalog). item_budget sets how many per floor.'));
    if (!Array.isArray(biome.items)) biome.items = [];
    body.appendChild(depthCatalogEditor(biome.items, 'type', CATEGORY_KEYS));
    body.appendChild(budgetRow(biome, 'item_budget', 'item_budget'));

    // hazard ramps
    body.appendChild(subTitle('hazards (ramp with depth)', 'Count grows with depth: clamp(intercept + depth·slope, 0, max), active from min_depth.'));
    body.appendChild(hazardRampEditor(biome, 'traps', 'traps'));
    body.appendChild(hazardRampEditor(biome, 'fungus', 'fungus'));
    return card;
}

// A small { base, extra_chance, max_extra } budget editor shared by actor/item.
function budgetRow(obj, key, label) {
    if (!obj[key]) obj[key] = { base: 3, extra_chance: 50, max_extra: 2 };
    const b = obj[key];
    return el('div', { class: 'sub-section' },
        subTitle(label, 'How many picks to place per floor: base guaranteed, then up to max_extra more at extra_chance% each.'),
        fieldGrid(
            fieldRow('base', b, 'base', { type: 'number', tip: 'Guaranteed picks per floor.' }),
            fieldRow('max_extra', b, 'max_extra', { type: 'number', tip: 'Maximum extra picks.' }),
        ),
        sliderRow('extra_chance %', b, 'extra_chance', { min: 0, max: 100, suffix: '%', def: 0,
            tip: 'Chance to roll each extra pick.' }));
}

/* Depth-ranged catalog editor: an array of rows { [keyField], min, max, freq }.
   keyField is 'id' (actors) or 'type' (item categories). `choices` seeds the
   add-dropdown. Includes a "preview at depth N" that shows which rows are
   eligible and their weighted share — mirrors the engine's resolveBiome pick. */
function depthCatalogEditor(rows, keyField, choices) {
    const wrap = el('div', { class: 'depth-catalog' });
    // preview depth persists on the array object so re-renders keep it.
    if (rows._previewDepth == null) Object.defineProperty(rows, '_previewDepth', { value: 1, writable: true, enumerable: false });

    function redraw() {
        wrap.innerHTML = '';
        rows.forEach((row, i) => wrap.appendChild(depthCatalogRow(rows, i, keyField, choices, redraw)));

        // add row
        const used = new Set(rows.map(r => r[keyField]));
        const addSel = el('select', { class: 'wlabel-sel' });
        addSel.appendChild(el('option', { value: '' }, '+ add ' + (keyField === 'id' ? 'actor…' : 'category…')));
        for (const c of choices) if (!used.has(c)) addSel.appendChild(el('option', { value: c }, c));
        addSel.addEventListener('change', () => {
            if (!addSel.value) return;
            rows.push({ [keyField]: addSel.value, min: 1, max: 1, freq: 100 });
            commit(); redraw();
        });
        wrap.appendChild(el('div', { class: 'weight-row' }, addSel));

        // preview at depth N
        wrap.appendChild(depthPreview(rows, keyField, redraw));
    }
    redraw();
    return wrap;
}

function depthCatalogRow(rows, i, keyField, choices, redraw) {
    const row = rows[i];
    const line = el('div', { class: 'depth-row' });

    // id/type selector (preserve an out-of-list value)
    const sel = el('select', { class: 'wlabel-sel' });
    for (const c of choices) sel.appendChild(el('option', { value: c }, c));
    if (!choices.includes(row[keyField])) sel.appendChild(el('option', { value: row[keyField] }, row[keyField] + ' (?)'));
    sel.value = row[keyField];
    sel.addEventListener('change', () => { row[keyField] = sel.value; commit(); redraw(); });

    // depth window (min–max) via dualRange over the row itself
    const depthWrap = el('div', { class: 'sub' }, labelEl('depth', 'Floor range this entry can appear on.'),
        dualRange(row, 'min', 'max', { min: 1, max: 30, defMin: 1, defMax: 6 }));

    // freq
    const freqInput = el('input', { type: 'number', min: 0, value: row.freq ?? 100, style: 'width:64px;',
        title: 'Weight in the per-floor raffle (higher = more common).' });
    freqInput.addEventListener('input', () => { row.freq = Number(freqInput.value); commit(); });

    // optional count [lo,hi]
    if (!Array.isArray(row.count)) row.count = row.count || undefined;
    const countProxy = {
        get min() { return Array.isArray(row.count) ? row.count[0] : 1; },
        set min(v) { row.count = [v, Array.isArray(row.count) ? row.count[1] : v]; },
        get max() { return Array.isArray(row.count) ? row.count[1] : 1; },
        set max(v) { row.count = [Array.isArray(row.count) ? row.count[0] : v, v]; },
    };
    const countWrap = el('div', { class: 'sub' }, labelEl('count', 'How many to place per pick (min–max). Default 1.'),
        dualRange(countProxy, 'min', 'max', { min: 1, max: 10 }));

    const rm = el('button', { class: 'remove-btn' }, '×');
    rm.addEventListener('click', () => { rows.splice(i, 1); commit(); redraw(); });

    line.append(el('div', { class: 'depth-row-head' }, sel,
        el('span', { class: 'mini-label', title: 'freq' }, 'freq'), freqInput, rm),
        depthWrap, countWrap);
    return el('div', { class: 'pattern-box' }, line);
}

// "Preview at depth N": shows which rows are eligible at a chosen depth and
// their weighted share, so the author can see the ramp without running the game.
function depthPreview(rows, keyField, redraw) {
    const wrap = el('div', { class: 'sub-section depth-preview' });
    const depth = rows._previewDepth || 1;
    const head = el('div', { class: 'field-row' }, labelEl('preview at depth'));
    const depthInput = el('input', { type: 'number', min: 1, value: depth, style: 'width:64px;' });
    depthInput.addEventListener('input', () => { rows._previewDepth = Math.max(1, Number(depthInput.value) || 1); redraw(); });
    head.appendChild(depthInput);
    wrap.appendChild(head);

    const eligible = rows.filter(r => depth >= (r.min ?? 1) && depth <= (r.max ?? Infinity));
    if (!eligible.length) {
        wrap.appendChild(el('div', { class: 'hint-inline' }, 'Nothing eligible at depth ' + depth + '.'));
        return wrap;
    }
    const total = eligible.reduce((a, r) => a + (r.freq ?? 1), 0) || 1;
    for (const r of eligible) {
        const pct = Math.round(((r.freq ?? 1) / total) * 100);
        const bar = el('div', { class: 'wbar-fill', style: `width:${pct}%` });
        const barWrap = el('div', { class: 'wbar-wrap' }, bar, el('span', { class: 'wbar-pct' }, pct + '%'));
        wrap.appendChild(el('div', { class: 'weight-row' }, el('span', { class: 'wlabel' }, r[keyField]), barWrap));
    }
    return wrap;
}

/* Hazard ramp editor: { min_depth, intercept, slope, max } with a live "count at
   depth N" readout so the linear ramp is legible. Toggle to enable/disable. */
function hazardRampEditor(biome, key, label) {
    const wrap = el('div', { class: 'sub-section' });
    wrap.appendChild(toggleLine(label, !!biome[key], (on) => {
        if (on) biome[key] = { min_depth: 1, intercept: 0, slope: 1, max: 10, ...(key === 'fungus' ? { tall_chance: 0.3 } : {}) };
        else delete biome[key];
        commit(); render();
    }, key === 'fungus'
        ? 'Fungus patches, count ramping with depth.'
        : 'Hidden traps, count ramping with depth.'));
    const h = biome[key];
    if (!h) return wrap;
    wrap.appendChild(fieldGrid(
        fieldRow('min_depth', h, 'min_depth', { type: 'number', tip: 'Floor this hazard first appears on.' }),
        fieldRow('max', h, 'max', { type: 'number', tip: 'Hard cap on count.' }),
    ));
    wrap.appendChild(fieldGrid(
        fieldRow('intercept', h, 'intercept', { type: 'number', tip: 'Base count at depth 0 (usually 0).' }),
        fieldRow('slope', h, 'slope', { type: 'number', tip: 'Extra count per floor of depth.' }),
    ));
    if (key === 'fungus') {
        wrap.appendChild(sliderRow('tall_chance', h, 'tall_chance', { min: 0, max: 1, step: 0.05, decimals: 2, def: 0,
            tip: 'Chance each fungus is the tall, solid, sight-blocking variant.' }));
    }
    // count-at-depth preview (depth kept in a closure var, not on the model, so
    // it never leaks into exported JSON).
    const prev = el('div', { class: 'hint-inline' });
    const dInput = el('input', { type: 'number', min: 1, value: (h.min_depth || 1), style: 'width:56px;' });
    const upd = () => {
        const d = Math.max(1, Number(dInput.value) || 1);
        const raw = (h.intercept ?? 0) + d * (h.slope ?? 0);
        const n = d < (h.min_depth ?? 1) ? 0 : Math.max(0, Math.min(h.max ?? raw, Math.round(raw)));
        prev.textContent = `≈ ${n} at depth ${d}`;
    };
    dInput.addEventListener('input', upd); upd();
    wrap.appendChild(el('div', { class: 'field-row' }, labelEl('count at depth'), dInput, prev));
    return wrap;
}

/* Floor plan: assign biomes to inclusive floor ranges. Validates that ranges
   tile 1..floors without gaps/overlap and warns otherwise. */
function sectionFloorPlan() {
    const p = state.proto;
    if (!Array.isArray(p.floor_plan)) p.floor_plan = [];
    const { det, body } = section('Floor plan', { open: true });
    const biomeNames = Object.keys(p.biomes || {});
    body.appendChild(el('div', { class: 'hint-inline' },
        'Assign each biome to a floor range (e.g. 1-8). Ranges should cover every floor from 1 to ' + (p.floors ?? '?') + ' without gaps.'));

    p.floor_plan.forEach((fp, i) => body.appendChild(floorPlanRow(fp, i, biomeNames)));

    const add = el('button', { class: 'add-btn' }, '+ range');
    add.addEventListener('click', () => {
        p.floor_plan.push({ biome: biomeNames[0] || '', floors: '' });
        commit(); render();
    });
    body.appendChild(add);

    // validation
    const warn = validateFloorPlan(p.floor_plan, p.floors);
    if (warn) body.appendChild(el('div', { class: 'hint-inline', style: 'color:var(--accent2);' }, warn));
    return { det };
}

function floorPlanRow(fp, i, biomeNames) {
    const p = state.proto;
    const row = el('div', { class: 'field-row' });
    const bSel = el('select', {});
    bSel.appendChild(el('option', { value: '' }, '— biome —'));
    for (const n of biomeNames) bSel.appendChild(el('option', { value: n }, n));
    if (fp.biome && !biomeNames.includes(fp.biome)) bSel.appendChild(el('option', { value: fp.biome }, fp.biome + ' (?)'));
    bSel.value = fp.biome || '';
    bSel.addEventListener('change', () => { fp.biome = bSel.value; commit(); render(); });

    const rangeInput = el('input', { type: 'text', value: typeof fp.floors === 'string' ? fp.floors : (Array.isArray(fp.floors) ? fp.floors.join('-') : fp.floors ?? ''),
        placeholder: '1-8', style: 'width:80px;', title: 'Floor range, e.g. 1-8 or a single floor number.' });
    rangeInput.addEventListener('change', () => { fp.floors = rangeInput.value.trim(); commit(); render(); });

    const rm = el('button', { class: 'remove-btn' }, '×');
    rm.addEventListener('click', () => { p.floor_plan.splice(i, 1); commit(); render(); });

    row.append(bSel, el('span', { class: 'mini-label' }, 'floors'), rangeInput, rm);
    return row;
}

// Returns a warning string if the floor_plan doesn't cleanly tile 1..floors.
function validateFloorPlan(plan, floors) {
    if (!floors || !plan.length) return '';
    const covered = {};
    for (const fp of plan) {
        let lo, hi;
        if (typeof fp.floors === 'string') { const parts = fp.floors.split('-').map(s => parseInt(s.trim(), 10)); lo = parts[0]; hi = parts[1] ?? parts[0]; }
        else if (Array.isArray(fp.floors)) { lo = fp.floors[0]; hi = fp.floors[1]; }
        else if (typeof fp.floors === 'number') { lo = hi = fp.floors; }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
        for (let f = lo; f <= hi; f++) covered[f] = (covered[f] || 0) + 1;
    }
    const gaps = [], overlaps = [];
    for (let f = 1; f <= floors; f++) {
        if (!covered[f]) gaps.push(f);
        else if (covered[f] > 1) overlaps.push(f);
    }
    const msgs = [];
    if (gaps.length) msgs.push('Uncovered floors (fall back to prototype defaults): ' + gaps.join(', '));
    if (overlaps.length) msgs.push('Floors covered by more than one biome (first wins): ' + overlaps.join(', '));
    return msgs.join('  •  ');
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

