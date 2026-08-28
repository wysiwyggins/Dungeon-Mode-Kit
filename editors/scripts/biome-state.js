/* =========================================================================
   biome-state.js — state + data loading for the standalone biome editor
   -------------------------------------------------------------------------
   Counterpart to proto-state.js. These files are plain <script> src includes
   (no bundler) and share one global scope; load order matters:
   editor-constants -> biome-state -> proto-widgets -> biome-sections ->
   biome-render. The final file calls init(). Do not wrap in IIFEs — cross-file
   references rely on the shared top-level scope.

   This file's job is to satisfy the globals contract that the SHARED files
   (proto-widgets.js, biome-sections.js) expect, so they can be reused verbatim:

     state.mergedActorIds / mergedItemIds / poolItemIds
     isFloor(), currentTarget(), inheritedValue()
     totalFloors()

   CATEGORY_KEYS, GEN_TYPES and DECORATION_PATTERNS are part of that contract
   too, but they name engine vocabulary rather than editor state, so they live
   in editor-constants.js and are shared by both editors.

   commit() and render() live in biome-render.js.
   ========================================================================= */
"use strict";

/* =========================================================================
   State
   ========================================================================= */
const state = {
    library: {},          // the whole data/biomes.json: { name: biomeDef }
    activeBiome: null,    // name of the biome being edited, or null
    baseActors: {},
    baseItems: {},
    mergedActorIds: [],   // sorted ids for the depth-catalog dropdown
    mergedActors: {},
    mergedItemIds: [],
    baseEntities: {},     // data/entities.json
    mergedEntityIds: [],  // sorted ids for the decorations dropdown
    poolItemIds: new Set(),
    // Editor-only: the floor count the designer is DESIGNING FOR. A biome does
    // not own a floor count (the prototype that uses it does), so this is never
    // serialized — it only bounds the depth sliders and the depth preview.
    designFloors: 26,
};

const BIOME_LIBRARY_PATH = '../data/biomes.json';
const DESIGN_FLOORS_KEY = 'biomeEditorDesignFloors';

/* =========================================================================
   Data loading
   ========================================================================= */
// Same shape as proto-state.js's fetchJSON: never throws, returns {} on any
// failure, so a missing data/biomes.json just yields an empty library.
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
    const [actors, items, library, types, entities] = await Promise.all([
        fetchJSON('../data/actors.json'),
        fetchJSON('../data/items.json'),
        fetchJSON(BIOME_LIBRARY_PATH),
        fetchJSON('../data/types.json'),
        fetchJSON('../data/entities.json'),
    ]);
    state.baseActors = actors;
    state.baseItems = items;
    state.baseTypes = types;
    state.baseEntities = entities;
    state.library = library || {};
    state.poolItemIds = collectPoolItemIds(items, types);
    rebuildMergedIds();
}

// No prototype-level actor overrides here: a library biome is prototype-agnostic,
// so only the base data/actors.json ids are offerable. (A biome naming an actor
// that only exists in one prototype's actors.json is a portability hazard, the
// same class as the item_catalog one.)
function rebuildMergedIds() {
    state.mergedActors = { ...state.baseActors };
    state.mergedActorIds = Object.keys(state.baseActors).sort();
    // Item types are spawnable names too — "potion" means "roll a potion".
    state.mergedItemIds = [...new Set([
        ...Object.keys(state.baseItems),
        ...state.poolItemIds,
    ])].sort();
    // Entities are global: there is no per-prototype entities.json to merge in.
    state.mergedEntityIds = Object.keys(state.baseEntities || {}).sort();
}

/* =========================================================================
   Model helpers
   ========================================================================= */
function currentBiome() {
    return state.activeBiome ? state.library[state.activeBiome] : null;
}

// A brand-new biome. Mirrors the "+ biome" seed in sectionBiomes (proto-sections.js)
// so a biome created here and one created there start identical.
function blankBiome() {
    return {
        map_generator: { type: 'brogue', options: { map_width: 60, map_height: 50 } },
        actors: [],
        actor_budget: { base: 3, extra_chance: 60, max_extra: 3 },
    };
}

function selectBiome(name) {
    state.activeBiome = name && state.library[name] ? name : null;
    document.getElementById('empty-hint').classList.toggle('hidden', !!state.activeBiome);
    document.getElementById('form-sections').classList.toggle('hidden', !state.activeBiome);
    render();
}

function createBiome(name) {
    const nm = (name || '').trim();
    if (!nm || state.library[nm]) return false;
    state.library[nm] = blankBiome();
    state.activeBiome = nm;
    return true;
}

/* =========================================================================
   The globals contract expected by proto-widgets.js / biome-sections.js
   ========================================================================= */

// Always false here. This is the load-bearing simplification: it short-circuits
// section()'s whole "override on this floor" branch (proto-widgets.js), and the
// `opts.inheritKey` paths in sectionMechanics/sectionMapGenerator, so the shared
// builders render a plain form with no floor-inheritance UI.
function isFloor() { return false; }

// Only reachable from the isFloor() branches above, which never run here.
// Defined so a stray call is a clean null rather than a ReferenceError.
function currentTarget() { return currentBiome(); }
function inheritedValue() { return undefined; }

// Upper bound for the depth sliders (depthCatalogRow) — the "design for N floors"
// input, not anything stored on the biome.
function totalFloors() { return state.designFloors; }
