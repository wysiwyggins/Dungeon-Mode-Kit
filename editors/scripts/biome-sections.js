/* =========================================================================
   biome-sections.js — section builders shared by the prototype editor and the
   standalone biome editor
   -------------------------------------------------------------------------
   Extracted from proto-sections.js. These build the parts of the form that
   describe a BIOME-shaped object rather than a prototype: the map generator,
   the mechanics flags, and the depth-ranged actor/item catalogs with their
   budgets and hazard ramps.

   Every builder here takes its target object as a parameter (biomeCard takes
   the container + name), so the same code renders a biome nested inside a
   prototype and a biome standing alone in the library. Nothing in this file
   reads state.proto.

   Like the other editor scripts these are plain <script src> includes sharing
   one global scope — no bundler, no IIFE. Load AFTER proto-widgets.js (for el,
   section, dualRange, ...) and BEFORE the page's own sections/render file.

   Required from the host page (the globals contract):
     commit(), render()        — from the page's own render file
     state.mergedActorIds      — actor ids for the depth catalog dropdown
     state.mergedEntityIds     — entity ids for the decorations dropdown
     isFloor()                 — false in the standalone editor, which short-circuits
                                 section()'s "override on this floor" branch
     totalFloors()             — upper bound for the depth sliders
     CATEGORY_KEYS, GEN_TYPES, DECORATION_PATTERNS
                               — from proto-state.js and biome-state.js. Both must
                                 define all three; this file is loaded by both editors.
     wallActorIds(), blobActorIds()
                               — actor id filters for the generator's wall fill and
                                 lake fill. Also defined in both state files.
     EditorTemplate            — editors/scripts/editor-template.js (+ Handlebars)
   Plus the widgets in proto-widgets.js (el, section, dualRange, weightEditor, ...).

   This file must NOT reference prototype-only code. sectionMapGenerator takes the
   placed-features editor as an `opts.placedFeatures` callback for that reason.
   ========================================================================= */
"use strict";

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

function sectionMapGenerator(obj, opts = {}) {
    // At proto level the section is optional (disable → no generator config, e.g.
    // a prototype driven by a hand-authored map.tmj). At floor level the floor
    // "override" toggle already serves that role, so no separate enable toggle.
    const sectionOpts = { ...opts, defaultValue: { type: 'dungeon', options: {} } };
    if (!opts.inheritKey) {
        sectionOpts.optional = {
            isOn: obj.map_generator != null,
            enable: () => { obj.map_generator = { type: 'dungeon', options: {} }; },
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

    // Placed features (traps / fungus / switch_puzzles) are PROTOTYPE-and-floor-level
    // keys, not biome keys — a biome authors them as depth ramps instead. So this file
    // must not depend on their editor: the host passes it in as `opts.placedFeatures`.
    // A biome card simply omits it, which is what `noPlacedFeatures` used to mean.
    if (opts.placedFeatures) {
        body.appendChild(el('div', { class: 'sub-section' },
            subTitle('Placed features', 'Hazards and puzzles scattered onto the generated map.')));
        opts.placedFeatures(obj, body);
    }
    return { det };
}

function mapGeneratorBody(obj, body) {
    if (!obj.map_generator) obj.map_generator = { type: 'dungeon', options: {} };
    const mg = obj.map_generator;
    if (!mg.options) mg.options = {};
    body.appendChild(selectRow('type', mg, 'type', GEN_TYPES, { allowBlank: false, rerender: true,
        tip: 'Algorithm used to build the map. Wall-building: dungeon (rooms + corridors + loops + secrets), palladian (symmetrical villa — axial sanctum, portico, colonnade; good for a boss floor), infernal (lava-heavy caverns), digger (ROT.js rooms + corridors), cellular (organic cave). Floor-only — these carve open space but build no walls, doors or torches: uniform, rogue, arena (open box), divided_maze, icey_maze, eller_maze.' }));
    const o = mg.options;
    body.appendChild(fieldGrid(
        fieldRow('map_width', o, 'map_width', { type: 'number', min: 1, tip: 'Total map width in tiles (can exceed the viewport — the level then scrolls).' }),
        fieldRow('map_height', o, 'map_height', { type: 'number', min: 1, tip: 'Total map height in tiles (can exceed the viewport — the level then scrolls).' }),
    ));

    // 'brogue' is the engine's legacy alias for 'dungeon'; treat them as one so a
    // biome still saying 'brogue' renders its full form instead of a bare size panel.
    const t = (mg.type === 'brogue' ? 'dungeon' : mg.type) || 'dungeon';
    if (t === 'dungeon' || t === 'infernal') {
        if (t === 'dungeon') {
            // maxRooms is intentionally not exposed: the engine auto-computes it
            // from the map size (larger maps get more rooms). maxAttempts is also
            // auto-scaled to map size when left blank; expose it as an optional
            // override for fine-tuning density.
            body.appendChild(fieldRow('maxAttempts', o, 'maxAttempts', { type: 'number', min: 1, tip: 'Optional override: how many room-placement attempts the generator makes (the practical cap on how densely the map fills). Leave blank to auto-scale with map size. Larger = denser.' }));
            body.appendChild(sliderRow('corridorChance %', o, 'corridorChance', { min: 0, max: 100, suffix: '%', def: 0,
                tip: 'Chance to connect a new room with a corridor (vs. an adjacent doorway). Default 30%.' }));
            body.appendChild(dualRangeArrayRow('corridorLength', o, 'corridorLength', { min: 1, max: 12, def: [3, 9],
                tip: 'Min–max length (tiles) of generated corridors. Default 3–9.' }));
            body.appendChild(fieldGrid(
                fieldRow('loopMinDistance', o, 'loopMinDistance', { type: 'number', min: 0,
                    tip: 'Two points must be at least this far apart (path distance) before a loop-back corridor connects them. Default 20.' }),
                fieldRow('maxLoops', o, 'maxLoops', { type: 'number', min: 0,
                    tip: 'Maximum extra loop corridors added (creates alternate routes). Default 5.' }),
            ));
            body.appendChild(el('div', { class: 'sub-section' }, subTitle('roomWeights', 'Relative likelihood of each room shape. Bars show each shape’s share of the total.'),
                weightEditor(o, 'roomWeights', { choices: ['rectangle','cross','circular','cavern'] })));
            body.appendChild(roomSizeEditor(o));
        }
        body.appendChild(carvedRegionsEditor(o));
        if (t === 'dungeon') {
            body.appendChild(bridgesEditor(o));
            body.appendChild(collapsingEditor(o));
        }
    } else if (t === 'digger') {
        body.appendChild(fieldGrid(
            dualRangeArrayRow('roomWidth', o, 'roomWidth', { min: 1, max: 20, def: [3, 9],
                tip: 'Min–max width of dug rooms (tiles). Default 3–9.' }),
            dualRangeArrayRow('roomHeight', o, 'roomHeight', { min: 1, max: 20, def: [3, 5],
                tip: 'Min–max height of dug rooms (tiles). Default 3–5.' }),
        ));
        body.appendChild(dualRangeArrayRow('corridorLength', o, 'corridorLength', { min: 1, max: 12, def: [3, 10],
            tip: 'Min–max corridor length (tiles). Default 3–10.' }));
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
    } else if (t === 'cellular') {
        // probability is sharply nonlinear — measured on 40x50, 0.35 leaves ~2%
        // filled, 0.45 ~23%, 0.55 ~55%. The usable "clumps with clearings" band
        // is narrow, hence the fine step.
        body.appendChild(sliderRow('probability', o, 'probability', { min: 0, max: 1, step: 0.05, decimals: 2, def: 0.5,
            tip: 'Fraction of cells seeded as wall before the automaton runs. Low = sparse clumps in open space; high = a closed cave. ~0.45 gives distinct groves with walkable clearings. Default 0.5.' }));
        body.appendChild(fieldRow('iterations', o, 'iterations', { type: 'number', min: 1,
            tip: 'Smoothing passes. More passes round off noise into fewer, larger blobs. Default 4.' }));
        body.appendChild(toggleLine('connected', o.connected !== false, (on) => {
            // Absent means true, so only an explicit false is worth storing.
            if (on) delete o.connected; else o.connected = false;
            commit();
        }, 'Carve links between isolated pockets so every open area is reachable. Turn off for sealed caves the player must dig or burn into.'));
    }
    // arena and the ROT.js wrappers: only map_width/height (already shown)

    // wall_types — the actor the generator fills solid cells with. Only the
    // wall-building generators queue walls at all; the rest carve floor and
    // leave nothing to type (see GEN_TYPES in editor-constants.js).
    if (WALL_BUILDING_GEN_TYPES.includes(t)) {
        body.appendChild(el('div', { class: 'sub-section' },
            subTitle('wall_types', 'Which actor the generator fills solid cells with, weighted. Lists actors of the `terrain` type — walls, columns, trees, hedges.'),
            wallTypesEditor(o, 'wall_types', t === 'palladian' ? 'brick_wall' : 'wall')));
    }
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
            fieldRow('porticoDepth', o, 'porticoDepth', { type: 'number', min: 0,
                tip: 'Tiles the porch projects out (prostyle) or is recessed in (in antis). Default 3.' }),
            fieldRow('columnSpacing', o, 'columnSpacing', { type: 'number', min: 1,
                tip: 'Tiles between colonnade columns; 0 = no colonnade. The column count is forced even so the axis stays an open doorway. Default 2.' }),
        ));
    }
    return wrap;
}

// dual range writing to an array [min,max] at obj[key]
//
// Rendering this row must NOT create obj[key]. Merely expanding a section used to
// seed every field it contains, so viewing the palladian or dungeon room-size form
// wrote a full set of redundant overrides into the prototype JSON — indistinguishable
// from values a designer had actually chosen, and impossible to get rid of.
//
// So the proxy reads through to `opts.def` (the ENGINE's default, not the slider
// bounds — those would give a bogus override like rectWidth: [1,24]) while the key is
// absent, and materializes the array only on the first real edit. The slider shows
// what the generator is actually doing either way; the difference is only whether the
// JSON records an override.
function dualRangeForArray(obj, key, opts) {
    const def = opts.def || [opts.min ?? 0, opts.max ?? 0];
    const cur = () => (Array.isArray(obj[key]) ? obj[key] : def);
    // Writes come from dualRange's apply(), which sets both min and max every time,
    // so materializing from `cur()` here cannot leave a half-written pair.
    const write = (i, v) => {
        if (!Array.isArray(obj[key])) obj[key] = [...cur()];
        obj[key][i] = v;
    };
    const proxy = {
        get min() { return cur()[0]; }, set min(v) { write(0, v); },
        get max() { return cur()[1]; }, set max(v) { write(1, v); },
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

// Per-shape size ranges for the dungeon generator. Defaults mirror architect.js's
// `case 'dungeon'` block — keep them in sync, since they're what the engine falls back
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

    // Unlike the generator-tuning rows, seeding here is legitimate: this group only
    // exists because the user explicitly enabled the feature, and a lake/abyss entry
    // without a count is not a valid shape for the engine to read.
    const grp = o[key];
    if (!Array.isArray(grp.count)) grp.count = [1, 2];
    g.appendChild(dualRangeArrayRow('count', grp, 'count', { min: 0, max: 6, def: [1, 2], tip: opts.countTip }));
    if (opts.liquid) {
        if (!Array.isArray(grp.types) || !grp.types.length) grp.types = ['water'];
        g.appendChild(subTitle('types (weighted)', 'Which actors these lakes are filled with. Each weight is that actor’s share of the random pick. Any non-solid actor that paints a tile can be a lake — quicksand as readily as water.'));
        g.appendChild(blobTypesEditor(grp, 'types'));
    } else {
        grp.types = ['abyss'];
    }
    g.appendChild(fieldGrid(
        fieldRow('minSize', grp, 'minSize', { type: 'number', min: 1, tip: 'Smallest ' + opts.sizeTip }),
        fieldRow('maxSize', grp, 'maxSize', { type: 'number', min: 1, tip: 'Largest ' + opts.sizeTip }),
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
    wrap.appendChild(fieldRow('max', c, 'max', { type: 'number', min: 0, tip: 'Maximum number of collapsing-floor patches per floor.' }));
    wrap.appendChild(fieldGrid(
        fieldRow('minSize', c, 'minSize', { type: 'number', min: 1, tip: 'Smallest patch size (tiles).' }),
        fieldRow('maxSize', c, 'maxSize', { type: 'number', min: 1, tip: 'Largest patch size (tiles).' }),
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
        wrap.appendChild(fieldRow('max', o.bridges, 'max', { type: 'number', min: 0, tip: 'Maximum bridges placed across lakes/abyss.' }));
    }
    return wrap;
}

/* default_floor on a BIOME — the floor tile every generator paints for the floors
   this biome covers. Sits between a floor override and the prototype-level value
   (Engine.resolveBiome / getFloorConfig).

   A sub-section, not a section(): render() preserves open <details> by matching
   .sec-title text across ALL details.section nodes, so a second "Default floor"
   section() nested in a biome card would open in lockstep with the prototype-level
   one. collapsibleSubSection keys its open state per biome instead.

   Also deliberately not the prototype editor's sectionDefaultFloor: that one carries
   proto-vs-floor inheritance toggles a biome has no notion of. Same widgets. */
function biomeDefaultFloorEditor(biome, name) {
    const sub = collapsibleSubSection('default floor',
        `biome:${name}:default_floor`, biome.default_floor != null ? 'set' : 'inherited',
        'Floor tile painted on this biome’s floors. Overrides the prototype default; a floor override still wins over it.');

    // Redraws only this block rather than calling render(): a full rebuild would
    // yank focus out of the section the user is working in.
    const fields = el('div', {});
    function redraw() {
        fields.innerHTML = '';
        if (biome.default_floor == null) return;
        const df = biome.default_floor;
        fields.appendChild(el('div', { class: 'hint-inline' },
            'Generated maps only — a hand-authored .tmj supplies its own floor tiles.'));
        fields.appendChild(tileRow('tile', df, 'tile',
            'Tile painted as open floor. Leave unset to inherit the prototype’s.',
            'biome floor tile'));
        fields.appendChild(colorRow('tint', df, 'tint',
            'Color multiplied over floor tiles. Leave clear for untinted.'));
    }

    sub.body.appendChild(toggleLine('override the prototype floor tile', biome.default_floor != null, (checked) => {
        if (checked) biome.default_floor = {}; else delete biome.default_floor;
        commit(); redraw();
    }, 'Off = inherit the prototype’s default_floor.'));
    sub.body.appendChild(fields);
    redraw();
    return sub.det;
}

/* One biome, as a nested collapsible: rename/remove + its config body.
   `biomes` is the map that owns this entry — a prototype's `p.biomes` in the
   prototype editor, or the library object in the standalone biome editor — so the
   same card renders in both. `opts.floorPlan`, when given, is repointed on rename
   (only the prototype editor has one). */
function biomeCard(biomes, name, opts = {}) {
    const biome = biomes[name];
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
        if (!nn || nn === name || biomes[nn]) { nameInput.value = name; return; }
        biomes[nn] = biome; delete biomes[name];
        // repoint any floor_plan entries that used the old name
        (opts.floorPlan || []).forEach(fp => { if (fp.biome === name) fp.biome = nn; });
        commit(); render();
    });
    const rm = el('button', { class: 'remove-btn' }, 'remove biome');
    rm.addEventListener('click', () => { delete biomes[name]; commit(); render(); });
    nameRow.append(labelEl('name'), nameInput, rm);
    body.appendChild(nameRow);

    // map generator + mechanics (reuse the existing section builders against the
    // biome obj). Suppress the map generator's Placed-features block — the biome
    // authors traps/fungus as depth ramps below, writing the same keys.
    // No placedFeatures callback: a biome ramps traps/fungus with depth (below)
    // rather than declaring fixed per-floor counts.
    body.appendChild(sectionMapGenerator(biome).det);
    body.appendChild(biomeDefaultFloorEditor(biome, name));
    body.appendChild(sectionMechanics(biome, 'mechanics', {}).det);

    // depth-ranged actor catalog. Collapsible: one row per monster, each with two
    // dual-range sliders, so a full catalog buries the item/hazard blocks below it.
    if (!Array.isArray(biome.actors)) biome.actors = [];
    const actorCat = collapsibleSubSection('actors (depth-ranged)',
        `biome:${name}:actors`, `${biome.actors.length} row(s)`,
        'Monsters eligible per floor. Each row spawns within its min–max depth window, chosen by weight. actor_budget sets how many are placed per floor.');
    actorCat.body.appendChild(depthCatalogEditor(biome.actors, 'id', state.mergedActorIds));
    actorCat.body.appendChild(budgetRow(biome, 'actor_budget', 'actor_budget'));
    body.appendChild(actorCat.det);

    // depth-ranged item catalog
    if (!Array.isArray(biome.items)) biome.items = [];
    const itemCat = collapsibleSubSection('items (depth-ranged)',
        `biome:${name}:items`, `${biome.items.length} row(s)`,
        'Item categories eligible per floor (drawn via item_catalog). item_budget sets how many per floor.');
    itemCat.body.appendChild(depthCatalogEditor(biome.items, 'type', CATEGORY_KEYS));
    itemCat.body.appendChild(budgetRow(biome, 'item_budget', 'item_budget'));
    body.appendChild(itemCat.det);

    // hazard ramps
    body.appendChild(subTitle('hazards (ramp with depth)', 'Count grows with depth: clamp(intercept + depth·slope, 0, max), active from min_depth.'));
    body.appendChild(hazardRampEditor(biome, 'traps', 'traps'));
    body.appendChild(hazardRampEditor(biome, 'fungus', 'fungus'));

    // floor decorations
    if (!Array.isArray(biome.decorations)) biome.decorations = [];
    const decoCat = collapsibleSubSection('decorations (floor scatter)',
        `biome:${name}:decorations`, `${biome.decorations.length} row(s)`,
        'Decorative entities scattered on the floor at generation. Each row picks an entity from entities.json and a placement pattern. Purely cosmetic — they never block movement.');
    decoCat.body.appendChild(decorationsEditor(biome.decorations));
    body.appendChild(decoCat.det);

    return card;
}

// A small { base, extra_chance, max_extra } budget editor shared by actor/item.
function budgetRow(obj, key, label) {
    if (!obj[key]) obj[key] = { base: 3, extra_chance: 50, max_extra: 2 };
    const b = obj[key];
    return el('div', { class: 'sub-section' },
        subTitle(label, 'How many picks to place per floor: base guaranteed, then up to max_extra more at extra_chance% each.'),
        fieldGrid(
            fieldRow('base', b, 'base', { type: 'number', min: 0, tip: 'Guaranteed picks per floor.' }),
            fieldRow('max_extra', b, 'max_extra', { type: 'number', min: 0, tip: 'Maximum extra picks.' }),
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

    // Depth window (min–max) via dualRange over the row itself. The slider's top is
    // the prototype's own floor count, not a fixed number: a depth beyond the last
    // floor is unreachable, so an arbitrary cap (this used to be a hardcoded 30) both
    // invited meaningless values and cramped a deeper dungeon. dualRange widens its
    // own track when an existing value exceeds the max, so lowering `floors` never
    // clamps data that's already there.
    const depthMax = Math.max(2, totalFloors());
    const depthWrap = el('div', { class: 'sub' },
        labelEl('depth', `Floor range this entry can appear on (1–${depthMax}, this prototype's floor count).`),
        dualRange(row, 'min', 'max', { min: 1, max: depthMax, defMin: 1, defMax: Math.min(6, depthMax) }));

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
    // The engine imposes no ceiling on count — repeat raffle picks of the same row
    // accumulate (_rollBiomeSpawns sums lo/hi), so 10 is only a comfortable slider
    // range, not a limit. dualRange widens the track for a larger existing value.
    const countWrap = el('div', { class: 'sub' },
        labelEl('count', 'How many to place per pick (min–max). Default 1. Repeat picks of the same entry stack, so the per-floor total can exceed this.'),
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
        fieldRow('min_depth', h, 'min_depth', { type: 'number', min: 1, tip: 'Floor this hazard first appears on. Floors are 1-based.' }),
        fieldRow('max', h, 'max', { type: 'number', min: 0, tip: 'Hard cap on count.' }),
    ));
    wrap.appendChild(fieldGrid(
        fieldRow('intercept', h, 'intercept', { type: 'number', tip: 'Where the count line is anchored before depth is added (usually 0). Not a floor number — floors start at 1. Unbounded: negative delays the ramp.' }),
        fieldRow('slope', h, 'slope', { type: 'number', tip: 'Extra count per floor of depth. Unbounded: negative thins the hazard out as you descend.' }),
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

/* Floor-decoration editor: rows of { entity, pattern, density, min, max, freq,
   region? }. Looks like depthCatalogEditor but is separate, because a decoration
   row's min/max is a COUNT where a catalog row's is a depth window. */
function decorationsEditor(rows) {
    const wrap = el('div', { class: 'depth-catalog' });

    function redraw() {
        wrap.innerHTML = '';
        rows.forEach((row, i) => wrap.appendChild(decorationRow(rows, i, redraw)));

        // add row. Entities may repeat — two rows of rubble with different patterns
        // is valid — so nothing is filtered out of the dropdown.
        const addSel = el('select', { class: 'wlabel-sel' });
        addSel.appendChild(el('option', { value: '' }, '+ add decoration…'));
        for (const c of (state.mergedEntityIds || [])) {
            addSel.appendChild(el('option', { value: c }, c));
        }
        addSel.addEventListener('change', () => {
            if (!addSel.value) return;
            rows.push({ entity: addSel.value, pattern: 'scatter', density: 0.1, min: 0, max: 10, freq: 100 });
            commit(); redraw();
        });
        wrap.appendChild(el('div', { class: 'weight-row' }, addSel));
    }
    redraw();
    return wrap;
}

function decorationRow(rows, i, redraw) {
    const row = rows[i];
    const line = el('div', { class: 'depth-row' });

    // entity selector, keeping a value that isn't in the list
    const sel = el('select', { class: 'wlabel-sel' });
    for (const c of (state.mergedEntityIds || [])) sel.appendChild(el('option', { value: c }, c));
    if (!(state.mergedEntityIds || []).includes(row.entity)) {
        sel.appendChild(el('option', { value: row.entity }, row.entity + ' (?)'));
    }
    sel.value = row.entity;
    sel.addEventListener('change', () => { row.entity = sel.value; commit(); redraw(); });

    // placement pattern
    const patSel = el('select', { class: 'wlabel-sel',
        title: 'Where this decoration may land. scatter = anywhere walkable; clusters = the same but in patches; wall_hugging = touching a wall; near_liquid = beside water, sewage or lava; room_floor = open room interiors only, never corridors.' });
    for (const p of DECORATION_PATTERNS) patSel.appendChild(el('option', { value: p }, p));
    if (!DECORATION_PATTERNS.includes(row.pattern)) {
        patSel.appendChild(el('option', { value: row.pattern }, row.pattern + ' (?)'));
    }
    patSel.value = row.pattern || 'scatter';
    patSel.addEventListener('change', () => { row.pattern = patSel.value; commit(); });

    const rm = el('button', { class: 'remove-btn' }, '×');
    rm.addEventListener('click', () => { rows.splice(i, 1); commit(); redraw(); });

    // how much of the matching area to fill, before the count clamp
    const densityWrap = sliderRow('density', row, 'density', { min: 0, max: 1, step: 0.05, decimals: 2, def: 0.1,
        tip: 'Fraction of the tiles matching this pattern to fill, before the count clamp. Scales with how much of the floor qualifies.' });

    // a count, not a depth window
    const countWrap = el('div', { class: 'sub' },
        labelEl('count', 'Hard floor and ceiling on how many are placed, after density is applied.'),
        dualRange(row, 'min', 'max', { min: 0, max: 30 }));

    const freqWrap = sliderRow('freq %', row, 'freq', { min: 0, max: 100, suffix: '%', def: 100,
        tip: 'Chance this row runs at all on a given floor. 100 = always.' });

    const regionWrap = fieldRow('region', row, 'region', {
        tip: 'Optional: confine to a named region the generator published (e.g. largest_room, sanctum, portico). Leave blank for the whole map.' });

    line.append(el('div', { class: 'depth-row-head' }, sel, patSel, rm),
        densityWrap, countWrap, freqWrap, regionWrap);
    return el('div', { class: 'pattern-box' }, line);
}
