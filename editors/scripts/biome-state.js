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
    baseLibrary: {},      // data/biomes.json
    protoBiomes: {},      // the prototype's own biomes.json, as last read or saved
    library: {},          // what's being edited: both merged, as the engine merges them
    activeBiome: null,    // name of the biome being edited, or null
    // Biomes edited since the last load or save (commit() adds the active one).
    // Only these count as changed: rendering a form can fill in a missing
    // default, which shouldn't make an untouched library biome look edited.
    touched: new Set(),
    baseActors: {},
    baseItems: {},
    protoActors: {},      // the prototype's actors.json and items.json, so its own
    protoItems: {},       // actors and items are offered in the dropdowns
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
// Never throws; {} on any failure, so a missing data/biomes.json just yields
// an empty library.
const fetchJSON = PrototypeSource.fetchJSON;

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
    state.baseLibrary = library || {};
    state.poolItemIds = collectPoolItemIds(items, types);
}

/* Read the prototype's biomes, actors and items (base only, a server
   prototype or a workspace: scripts/prototype-source.js). keepEdits keeps the
   in-memory edits to any biome that has unsaved changes, for when another
   tab writes one of the files. */
async function loadPrototype({ keepEdits = false } = {}) {
    const changed = keepEdits ? changedBiomeNames() : [];
    const edited = Object.fromEntries(changed.map(n => [n, state.library[n]]));
    state.touched = new Set(changed);
    [state.protoBiomes, state.protoActors, state.protoItems] =
        await Promise.all(['biomes.json', 'actors.json', 'items.json'].map(PrototypeSource.readJSON));
    state.library = { ...structuredClone({ ...state.baseLibrary, ...state.protoBiomes }), ...edited };
    if (state.activeBiome && !state.library[state.activeBiome]) state.activeBiome = null;
    rebuildMergedIds();
}

/* What `name` is in the files: the prototype's biome, else the library's. */
function savedBiome(name) {
    return state.protoBiomes[name] ?? state.baseLibrary[name];
}

/* Biomes with unsaved edits, including new and renamed ones. */
function changedBiomeNames() {
    return Object.keys(state.library).filter(n => {
        const saved = savedBiome(n);
        if (saved === undefined) return true;
        return state.touched.has(n) && JSON.stringify(state.library[n]) !== JSON.stringify(saved);
    });
}

/* The prototype's own biomes that were renamed or removed here. */
function removedBiomeNames() {
    return Object.keys(state.protoBiomes).filter(n => !(n in state.library));
}

function isDirty() {
    return changedBiomeNames().length > 0 || removedBiomeNames().length > 0;
}

// A prototype's own actors and items are offered alongside the library's. A
// library biome naming one of them only works in that prototype, which is fine
// for a biome saved into it and a portability hazard for one copied to data/.
function rebuildMergedIds() {
    state.mergedActors = { ...state.baseActors, ...state.protoActors };
    state.mergedActorIds = Object.keys(state.mergedActors).sort();
    // Item types are spawnable names too — "potion" means "roll a potion".
    state.mergedItemIds = [...new Set([
        ...Object.keys(state.baseItems),
        ...Object.keys(state.protoItems),
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
        map_generator: { type: 'dungeon', options: { map_width: 60, map_height: 50 } },
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

// Actor ids a generator can use as its wall fill (map_generator.options.wall_types).
// Same definition as the prototype editor's (proto-state.js): the `terrain` type,
// not a solidity test — the Actor constructor defaults `solid` true, so `wall`
// itself never declares it. Base actors only, matching rebuildMergedIds above.
function wallActorIds() {
    return state.mergedActorIds.filter(id => state.mergedActors[id]?.type === 'terrain');
}

// Actor ids a decoration row may scatter. The engine skips solid ones, since
// dressing must never wall off a corridor, so only non-solid actors are offered.
function decorActorIds() {
    return state.mergedActorIds.filter(id =>
        resolvedActorAttrs(state.mergedActors[id], state.baseTypes).solid === false);
}

// Actor ids a generator can pour into a blob (map_generator.options.lakes.types).
// There is no blob type in types.json the way `terrain` covers walls, so this is an
// attribute filter: non-solid actors that paint a tile. That admits a few odd but
// legal choices (fire, collapsing_floor) and misses deep_water/deep_sewage, which
// carry no paint_tile — blobTypesEditor keeps any hand-authored id selectable.
function blobActorIds() {
    return state.mergedActorIds.filter(id => {
        const attrs = resolvedActorAttrs(state.mergedActors[id], state.baseTypes);
        return attrs.solid === false && !!attrs.paint_tile;
    });
}
