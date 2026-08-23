/* =========================================================================
   proto-state.js — state, data loading, actor introspection, model helpers
   -------------------------------------------------------------------------
   Extracted from prototype-editor.html. These files are plain <script> src
   includes (no bundler) and share one global scope; load order matters:
   proto-state -> proto-widgets -> biome-sections -> proto-sections ->
   proto-render. The final file calls init(). Do not wrap in IIFEs — cross-file
   references rely on the shared top-level scope.
   ========================================================================= */
"use strict";

/* =========================================================================
   State
   ========================================================================= */
const state = {
    proto: null,          // the live prototype object (source of truth)
    baseActors: {},
    baseItems: {},
    protoActors: {},
    protoItems: {},
    mergedActorIds: [],   // sorted ids for dropdowns
    mergedActors: {},     // id -> actor def (proto override base), for attribute lookups
    mergedItemIds: [],
    baseEntities: {},     // data/entities.json
    mergedEntityIds: [],  // sorted ids for the decorations dropdown
    baseBiomes: {},       // data/biomes.json — the default library
    protoBiomes: {},      // prototypes/<name>/biomes.json — this prototype's own
    protoName: '',        // directory name of the loaded prototype ('' when blank)
    prototypeNames: [],   // from data/prototypes.json (no directory listing over http)
    soundIds: [],
    poolItemIds: new Set(),// item ids that have random_type (category pools)
    activeFloor: 'proto', // 'proto' or a 1-based floor number (see currentTarget)
    prototypeCache: {},
};

const CATEGORY_KEYS = ['potion','scroll','staff','weapon','armor','ring','wand'];
const GEN_TYPES = ['brogue','digger','arena','infernal','palladian'];
// Placement patterns for a biome `decorations` row. Kept identical to
// biome-state.js, which the shared biome-sections.js also reads, and to
// DECORATION_PATTERN_NAMES in engine.js.
const DECORATION_PATTERNS = ['scatter','clusters','wall_hugging','near_liquid','room_floor'];

/* =========================================================================
   Data loading
   ========================================================================= */
async function fetchJSON(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) return {};
        const text = await r.text();
        if (!text.trim()) return {};
        return JSON.parse(text);
    } catch { return {}; }
}

async function loadBaseData() {
    const [actors, items, sounds, biomes, protoIndex, types, entities] = await Promise.all([
        fetchJSON('../data/actors.json'),
        fetchJSON('../data/items.json'),
        fetchJSON('../data/sounds.json'),
        fetchJSON('../data/biomes.json'),
        fetchJSON('../data/prototypes.json'),
        fetchJSON('../data/types.json'),
        fetchJSON('../data/entities.json'),
    ]);
    state.baseActors = actors;
    state.baseItems = items;
    state.baseBiomes = biomes;
    state.baseTypes = types;
    state.baseEntities = entities;
    state.prototypeNames = Array.isArray(protoIndex.prototypes) ? protoIndex.prototypes : [];
    state.soundIds = Object.keys(sounds.sprite || {}).sort();
    state.poolItemIds = collectPoolItemIds(items, types);
}

async function loadPrototype(name) {
    let cfg, protoActors, protoItems, protoBiomes;
    if (name && state.prototypeCache[name]) {
        ({ cfg, protoActors, protoItems, protoBiomes } = state.prototypeCache[name]);
    } else if (name) {
        [cfg, protoActors, protoItems, protoBiomes] = await Promise.all([
            fetchJSON(`../prototypes/${name}/prototype.json`),
            fetchJSON(`../prototypes/${name}/actors.json`),
            fetchJSON(`../prototypes/${name}/items.json`),
            fetchJSON(`../prototypes/${name}/biomes.json`),
        ]);
        state.prototypeCache[name] = { cfg, protoActors, protoItems, protoBiomes };
    } else {
        cfg = blankPrototype();
        protoActors = {}; protoItems = {}; protoBiomes = {};
    }
    // deep-clone cfg so editing never mutates the cache
    state.proto = JSON.parse(JSON.stringify(cfg));
    state.protoActors = protoActors;
    state.protoItems = protoItems;
    state.protoBiomes = protoBiomes || {};
    state.protoName = name || '';
    rebuildMergedIds();
    state.activeFloor = 'proto';
    document.getElementById('empty-hint').classList.add('hidden');
    document.getElementById('form-sections').classList.remove('hidden');
    render();
}

function rebuildMergedIds() {
    // Merge actor defs (proto overrides base) so we can read attributes, not just
    // ids — the switch-puzzle UI filters/introspects by attribute.
    state.mergedActors = { ...state.baseActors, ...state.protoActors };
    state.mergedActorIds = [...new Set([
        ...Object.keys(state.baseActors),
        ...Object.keys(state.protoActors),
    ])].sort();
    // Item types are spawnable names too — "potion" means "roll a potion" — so
    // they belong in the dropdowns alongside concrete ids.
    state.mergedItemIds = [...new Set([
        ...Object.keys(state.baseItems),
        ...Object.keys(state.protoItems),
        ...state.poolItemIds,
    ])].sort();
    // Entities are global: there is no per-prototype entities.json to merge in.
    state.mergedEntityIds = Object.keys(state.baseEntities || {}).sort();
}

/* Fill a <select> with the prototype names from data/prototypes.json, preserving
   whatever placeholder option the markup already has. Static HTTP can't list a
   directory, so that file is the index — the alternative was a hardcoded <option>
   list per editor, which had already drifted out of sync in all four of them. */
function populatePrototypeSelect(selectId = 'prototype-select') {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const keep = sel.value;
    // Drop everything but the placeholder (value="").
    for (const opt of [...sel.options]) if (opt.value !== '') opt.remove();
    for (const name of state.prototypeNames) {
        sel.appendChild(el('option', { value: name }, name));
    }
    if (keep) sel.value = keep;
}

/* ---- Biome library ----
   Biomes are not authored in prototype.json. They come from data/biomes.json,
   optionally overridden/extended per prototype by prototypes/<name>/biomes.json —
   the same global-then-prototype merge the engine does in Prototype.loadAssets().
   The prototype editor only SELECTS names from this merged set in its floor plan;
   authoring happens in the biome editor. */
function mergedBiomes() {
    return { ...state.baseBiomes, ...state.protoBiomes };
}
function mergedBiomeNames() {
    return Object.keys(mergedBiomes()).sort();
}
// Where a biome name came from, for labelling the floor-plan dropdown.
function biomeSource(name) {
    if (state.protoBiomes && state.protoBiomes[name]) return 'prototype';
    if (state.baseBiomes && state.baseBiomes[name]) return 'default';
    return null;
}

/* ---- Actor attribute introspection (for the switch-puzzle UI) ---- */
// Attributes live nested under def.attributes in actors.json.
function actorAttrs(id) {
    return (state.mergedActors[id] && state.mergedActors[id].attributes) || {};
}
function actorHasAttr(id, attr) {
    return !!actorAttrs(id)[attr];
}
// Actor ids that can act as a switch (the thing the player interacts with).
function switchActorIds() {
    return state.mergedActorIds.filter(id => actorHasAttr(id, 'switchable'));
}
// Actor ids that can be a switch target (respond to the switch).
function targetActorIds() {
    return state.mergedActorIds.filter(id => actorHasAttr(id, 'openable') || actorHasAttr(id, 'switchable'));
}
// How a switch actor behaves, derived from its own attributes (one_shot vs
// repeatable). This is defined on the actor, not the puzzle pattern.
function switchModeLabel(id) {
    if (!id || !actorHasAttr(id, 'switchable')) return '';
    return actorHasAttr(id, 'one_shot') ? 'activates once' : 'toggleable';
}
// Boolean-ish attributes of a target actor that a switch could flip.
function targetToggleableAttrs(id) {
    const attrs = actorAttrs(id);
    const candidates = ['open', 'locked', 'solid', 'opaque', 'toggled', 'visible', 'switchable'];
    const present = candidates.filter(k => k in attrs);
    // Always offer the common ones even if the actor doesn't declare them yet.
    for (const k of ['open', 'locked', 'solid']) if (!present.includes(k)) present.push(k);
    return present;
}

function blankPrototype() {
    return {
        name: 'New Prototype',
        description: '',
        turn_speed: 50,
        mechanics: { fog_of_war: true, darkness: true },
    };
}

/* =========================================================================
   Model helpers — current editing target (proto-level or a floor)
   ========================================================================= */
// Returns the object currently being edited (the prototype root or a floor).
// state.activeFloor is 'proto' or a 1-based floor NUMBER. Floor overrides live
// in `levels`, which may be a dense array (legacy) or a sparse object keyed by
// floor number (biome prototypes). The entry is created lazily on first edit.
function currentTarget() {
    if (state.activeFloor === 'proto') return state.proto;
    return floorOverride(state.activeFloor, true);
}
function isFloor() { return state.activeFloor !== 'proto'; }

// Get (or optionally create) the override object for a 1-based floor number,
// supporting both the array and sparse-object forms of `levels`.
function floorOverride(floorNum, create = false) {
    const p = state.proto;
    if (Array.isArray(p.levels)) {
        if (create && !p.levels[floorNum - 1]) p.levels[floorNum - 1] = { win_conditions: [] };
        return p.levels[floorNum - 1] || {};
    }
    // sparse object form (or none yet)
    const key = String(floorNum);
    if (!p.levels) { if (!create) return {}; p.levels = {}; }
    if (create && !p.levels[key]) p.levels[key] = { win_conditions: [] };
    return p.levels[key] || {};
}

// Total floors for the editor — mirrors the engine's getTotalFloors().
function totalFloors() {
    const p = state.proto;
    if (!p) return 1;
    if (p.floors != null) return p.floors;
    if (Array.isArray(p.levels)) return p.levels.length;
    return 1;
}

// Inherited value for a floor field = the prototype-level value (or undefined).
function inheritedValue(key) {
    return state.proto ? state.proto[key] : undefined;
}

