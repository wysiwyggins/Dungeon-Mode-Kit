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
const CATEGORY_KEYS = ['potion','scroll','food','staff','weapon','armor','ring','wand'];

// Map generators, matching the `type` cases in Architect.generateMap.
const GEN_TYPES = ['brogue','digger','arena','infernal','palladian'];

// Placement patterns for a biome `decorations` row.
// Mirrors DECORATION_PATTERN_NAMES in engine.js.
const DECORATION_PATTERNS = ['scatter','clusters','wall_hugging','near_liquid','room_floor'];
