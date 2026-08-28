/* =========================================================================
   proto-sections.js — render loop + all section builders
   -------------------------------------------------------------------------
   Extracted from prototype-editor.html. These files are plain <script> src
   includes (no bundler) and share one global scope; load order matters:
   proto-state -> proto-widgets -> biome-sections -> proto-sections ->
   proto-render. The final file calls init(). Do not wrap in IIFEs — cross-file
   references rely on the shared top-level scope.
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
        // always shown. The floor plan is the depth-ramping layer: it assigns library
        // biomes (data/biomes.json + this prototype's biomes.json) to floor ranges, so
        // it only appears for multi-level prototypes. Biomes themselves are authored in
        // the biome editor, not here.
        root.appendChild(sectionMapGenerator(state.proto, { placedFeatures: trapsSwitchesBody }).det);
        root.appendChild(sectionItemCatalog().det);
        root.appendChild(sectionSpawns(state.proto, { open: true }).det);
        if (isMultiLevel()) {
            root.appendChild(sectionFloorPlan().det);
        }
        root.appendChild(sectionAdvanced().det);
    } else {
        const floor = currentTarget();
        root.appendChild(sectionFloorWinConditions(floor).det);
        root.appendChild(sectionMechanics(floor, 'mechanics', { inheritKey: 'mechanics', open: true }).det);
        root.appendChild(sectionMapGenerator(floor, { inheritKey: 'map_generator', placedFeatures: trapsSwitchesBody }).det);
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
            (ws.via === 'escape' ? fieldRow('exit_floor', ws, 'exit_floor', { type: 'number', min: 1, tip: 'Floor number whose exit triggers the escape victory. Floors are 1-based.' }) : null),
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
            fieldRow('base', b, 'base', { type: 'number', min: 0, tip: 'Guaranteed number of budget items spawned each floor.' }),
            fieldRow('max_extra', b, 'max_extra', { type: 'number', min: 0, tip: 'Maximum additional items beyond base.' }),
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
        body.appendChild(fieldRow('tall_chance', obj.fungus, 'tall_chance', { type: 'number', min: 0, max: 1, step: 0.05, tip: 'Probability (0–1) that a given fungus is the tall, solid, sight-blocking variant instead of short walkable fungus. Default 0 (all short).' }));
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
        fieldRow('weight', pat, 'weight', { type: 'number', min: 0, tip: 'Relative likelihood this pattern is chosen vs. the others.' }),
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
// Keys the editor has dedicated UI for. Anything NOT listed here surfaces in the
// Advanced section as "preserved but not editable" — so a key the editor really does
// manage must be listed, or the editor reports its own fields as unrecognized.
const KNOWN_TOP_KEYS = new Set([
    'name','description','loaded_sound','turn_speed','next_level','previous_level','intro_cutscene',
    'mechanics','win_state','win_conditions','map_generator','item_catalog','item_budget',
    'random_actors','random_items','traps','switch_puzzles','levels','cutscene',
    // Multi-level / biome keys, edited by the Floor plan section.
    'floors','floor_plan','biomes',
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
// `p.biomes` is only here for older prototype.json files that still carry an inline
// biomes block; biomes now live in data/biomes.json + prototypes/<n>/biomes.json.
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
        wrap.appendChild(fieldRow('floors', p, 'floors', { type: 'number', min: 1,
            tip: 'Total number of floors. Biomes are assigned to floor ranges in the Floor plan below.' }));
    }
    return wrap;
}

/* =========================================================================
   Floor plan (multi-level prototypes) — see docs/BIOMES.md
   A biome is a reusable bundle of depth-ranged catalogs (actors/items) + hazard
   ramps + map/mechanics, and the engine (resolveBiome) turns it into per-floor
   spawn tables that ramp with depth — so you don't author every floor by hand.

   Biomes are DATA, not prototype content: they come from data/biomes.json plus an
   optional prototypes/<name>/biomes.json override, exactly like actors and items,
   and are authored in the biome editor. All this section does is assign them to
   floor ranges, which is a prototype concern because the prototype owns `floors`.
   ========================================================================= */

/* Assign biomes to inclusive floor ranges. Validates that ranges tile 1..floors
   without gaps/overlap, and that the biomes' item categories exist in the
   prototype's item_catalog. */
function sectionFloorPlan() {
    const p = state.proto;
    if (!Array.isArray(p.floor_plan)) p.floor_plan = [];
    const { det, body } = section('Floor plan', { open: true });
    // Names come from the biome LIBRARY (data/biomes.json + this prototype's
    // biomes.json), not from prototype.json — biomes aren't authored inline.
    const biomeNames = mergedBiomeNames();
    body.appendChild(el('div', { class: 'hint-inline' },
        'Assign a biome to each floor range (e.g. 1-8). Ranges should cover every floor from 1 to ' + (p.floors ?? '?') + ' without gaps.'));
    body.appendChild(el('div', { class: 'hint-inline' },
        biomeNames.length
            ? `${biomeNames.length} biome(s) available from data/biomes.json` +
              (Object.keys(state.protoBiomes || {}).length
                  ? ` and prototypes/${state.protoName}/biomes.json` : '') + '. '
            : 'No biomes found in data/biomes.json — create one first. ',
        el('a', { href: 'biome-editor.html' }, 'Edit biomes →')));

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

    // A biome's `items` rows name item_catalog CATEGORIES, but item_catalog lives
    // only at the prototype root. The engine silently skips a category that isn't
    // there, so those items just never spawn — catch it where the mistake is made.
    const catWarn = validateBiomeCategories(p);
    if (catWarn) body.appendChild(el('div', { class: 'hint-inline', style: 'color:var(--accent2);' }, catWarn));
    return { det };
}

/* Do the biomes this floor plan uses ask for item categories the prototype's
   item_catalog doesn't provide? Returns a message, or null when fine. */
function validateBiomeCategories(p) {
    const catalog = new Set(Object.keys(p.item_catalog || {}));
    const lib = mergedBiomes();
    const problems = [];
    for (const fp of (p.floor_plan || [])) {
        const b = fp && fp.biome && lib[fp.biome];
        if (!b) continue;
        const missing = [...new Set((b.items || [])
            .map(r => r && r.type)
            .filter(t => t && !catalog.has(t)))];
        if (missing.length) problems.push(`${fp.biome} wants ${missing.join(', ')}`);
    }
    if (!problems.length) return null;
    return catalog.size === 0
        ? `This prototype has no item_catalog, so biome items will not spawn (${problems.join('; ')}).`
        : `item_catalog is missing categories these biomes use — those items won't spawn: ${problems.join('; ')}.`;
}

function floorPlanRow(fp, i, biomeNames) {
    const p = state.proto;
    const row = el('div', { class: 'field-row' });
    const bSel = el('select', {});
    bSel.appendChild(el('option', { value: '' }, '— biome —'));
    for (const n of biomeNames) {
        // Mark which library a name resolves from, so an override is visible here.
        const tag = biomeSource(n) === 'prototype' ? ' (this prototype)' : '';
        bSel.appendChild(el('option', { value: n }, n + tag));
    }
    // A name no library defines: the engine silently falls back to prototype
    // defaults for those floors, so flag it rather than dropping the value.
    if (fp.biome && !biomeNames.includes(fp.biome)) bSel.appendChild(el('option', { value: fp.biome }, fp.biome + ' (not found)'));
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

