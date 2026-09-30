/* =========================================================================
   editor-constants.js — vocabulary shared by the biome and prototype editors
   -------------------------------------------------------------------------
   These lists name things the ENGINE knows about, so they are not editor
   preferences: each one has a counterpart in data/ or in engine.js, and drift
   between the two is a silent bug — an option missing here is simply
   unreachable from the editors even though the engine would honour it.

   Loaded before the per-editor state file in both editors, so it can't depend
   on anything. Like the other editor scripts these are plain <script src>
   includes sharing one global scope — no IIFE, no exports.
   ========================================================================= */
"use strict";

// Item categories. Mirrors the `domain: "item"` types in data/types.json.
// The engine derives each category's spawn pool from type membership
// (Prototype.getItemsOfType), so adding an item that declares a type is enough
// to put it in the pool — but the category has to be listed here for a designer
// to pick it in the biome catalog or the prototype's item_catalog.
const CATEGORY_KEYS = ['potion','scroll','food','staff','weapon','armor','ring','wand','treasure'];

// An actor's attributes with its actor type's merged underneath, the way
// Prototype.getActorData resolves them. Raw defs are thin once shared attributes
// live on a type (a trap declares `trap` only through the `trap` type), so any
// filter over attributes must read through this. An explicit null unsets.
function resolvedActorAttrs(def, types) {
    if (!def) return {};
    const typeDef = def.type && types?.[def.type];
    const base = (typeDef && typeDef.domain !== 'item' && typeDef.attributes) || {};
    const merged = { ...base, ...(def.attributes || {}) };
    for (const [key, value] of Object.entries(merged)) {
        if (value === null) delete merged[key];
    }
    return merged;
}

// Map generators, matching the `type` cases in Architect.generateProceduralMap.
// Ordered by capability, not alphabetically: the first five build walls (and so
// support wall_types, doors and torches); the rest are thin ROT.js wrappers that
// carve floor only, leaving no walls, rooms or regions for anything downstream to
// decorate. 'brogue' is still accepted by the engine as a legacy alias for
// 'dungeon' but is deliberately not offered here.
const GEN_TYPES = ['dungeon','palladian','infernal','digger','cellular',
                   'uniform','rogue','arena','divided_maze','icey_maze','eller_maze'];

// The leading slice of GEN_TYPES above — the generators that queue wall actors and
// so honour `wall_types`. Named rather than sliced so the dependency is explicit:
// reordering GEN_TYPES shouldn't silently change which generators get the control.
// ('brogue' normalizes to 'dungeon' before this is consulted.)
const WALL_BUILDING_GEN_TYPES = ['dungeon','palladian','infernal','digger','cellular'];

// Placement patterns for a biome `decorations` row.
// Mirrors DECORATION_PATTERN_NAMES in engine.js.
const DECORATION_PATTERNS = ['scatter','clusters','wall_hugging','near_liquid','room_floor'];
