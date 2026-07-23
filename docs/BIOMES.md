# Biomes & Depth-Ramping — Design Doc

**Status:** Testing (/prototypes/biometest/)
This documents the data model and engine changes; the editor UI is sketched at the end and will be
designed in detail separately.

## Problem

Multi-level prototypes currently make you **hand-author every floor**. The
dungeon's `prototype.json` writes out 26 fully-specified floor objects: each
floor repeats its own `random_actors`, `random_items`, `traps`, and `fungus`
tables, with difficulty ramped by hand (rats on floor 1 → dragons on floor 26,
trap `max` creeping 10→40, etc.). There is no inheritance for spawn tables and
no notion of depth, so the ramp is 26 near-parallel blocks maintained by hand
(see `getFloorConfig`, `engine.js:2052`, and the dungeon's `levels[]`).

Most roguelikes don't work this way. As the IDEAS.md note puts it: a dungeon
usually has at most a couple of hand-made special levels (a `map.tmj` + special
rules) and a long procedural middle whose monsters/items/hazards **ramp with
depth**. Brogue expresses its entire difficulty curve with no per-level
authoring at all.

**Goal:** define a **biome** once (a themed bundle of depth-ranged spawn/item/
hazard catalogs) and say **which floor ranges use which biome**. Difficulty
ramps emergently from depth. Specific floors can still be hand-authored.

## Reference: how Brogue does it

(From `BrogueCode/`, studied for this design.) Brogue has no per-level authoring.
Each content class is one **flat catalog**; every row carries
`(minDepth, maxDepth, frequency)`:

- **Monsters** — `hordeCatalog` (`Globals.c:1984`), struct `hordeType`
  (`Rogue.h:2091`). E.g. `rat d1-5 freq150`, `goblin d3-10 freq100`,
  `ogre d7-13 freq100`, `dragon d24-39 freq70`. `pickHordeType()`
  (`Monsters.c:467`) filters rows to `minLevel ≤ depth ≤ maxLevel` and does a
  frequency-weighted raffle. Depth ranges **overlap** (~6-8 level windows) so any
  depth has ~6-12 eligible hordes. Difficulty ramps by *which rows are eligible*,
  **not** by count — level population stays ~6 hordes (`Monsters.c:1003`).
- **Items** — near-flat budget (~3-5 items/level, `Items.c:510`); category and
  kind frequencies are mostly depth-*invariant*. Only a few "progression" items
  (enchant scrolls, strength/life potions) ramp, via per-level frequency
  accumulators. Difficulty is carried by *which items and what quality*, not raw
  count.
- **Terrain/hazards** — one unified `autoGeneratorCatalog` (`Globals.c:376`),
  struct `autoGenerator` (`Rogue.h:2503`). Count ramps linearly:
  `count = clamp((intercept + depth*slope)/100, 0, maxNumber)` plus a
  `frequency`% geometric tail (`Architect.c:1721`). E.g. luminescent fungus and
  hidden traps have higher `minDepth` and grow with depth; grass has a low
  `maxDepth` and vanishes early. Liquid *type* is depth-gated (no lava before
  d4, no brimstone before d18; `Architect.c:2442`).
- **Out-of-depth** — 10% of spawns roll the table as if `depth + rand(1,
  min(5, depth/2))` (`Monsters.c:753`), injecting occasional harder encounters.

**The pattern to adopt:** one flat catalog per content class, each row
`(minDepth, maxDepth, frequency)`; filter by depth, weighted-raffle by frequency;
count from either a flat budget (monsters/items) or a `clamp(intercept +
depth·slope, 0, max)` ramp (hazards). Optional out-of-depth escalation.

## Design

### 1. What a biome is

A **biome** is a named, reusable bundle of depth-ranged catalogs plus ambient
settings. It lives in a top-level `biomes` map on the prototype (or, later, in a
shared library). It produces — for a given depth — exactly the config shape the
engine already consumes (`random_actors`, `random_items`, `traps`, `fungus`,
`item_budget`, `map_generator`, `mechanics`, `switch_puzzles`). Nothing
downstream of `getFloorConfig` needs to change.

```jsonc
"biomes": {
  "caves": {
    "map_generator": { "type": "brogue", "options": { "map_width": 100, "map_height": 100 } },
    "mechanics": { "ambient_light": 0.7, "tint": "#3355AA" },

    // Depth-ranged monster catalog — one flat list, ramps emergently.
    "actors": [
      { "id": "rat",     "min": 1, "max": 5,  "freq": 150, "count": [1, 3] },
      { "id": "kobold",  "min": 1, "max": 6,  "freq": 150, "count": [1, 2] },
      { "id": "goblin",  "min": 3, "max": 10, "freq": 100, "count": [1, 2] },
      { "id": "ogre",    "min": 7, "max": 13, "freq": 100 }
    ],
    // Per-floor how many actor entries to place (a budget, not a per-id count).
    "actor_budget": { "base": 4, "extra_chance": 60, "max_extra": 3 },

    "items": [
      { "type": "potion", "min": 1, "max": 26, "freq": 52 },
      { "type": "scroll", "min": 1, "max": 26, "freq": 42 },
      { "type": "weapon", "min": 2, "max": 26, "freq": 10 }
    ],
    "item_budget": { "base": 2, "extra_chance": 40, "max_extra": 3 },

    // Hazards ramp by linear count (Brogue's intercept/slope/max), depth-gated.
    "traps":  { "min_depth": 2, "intercept": 0,  "slope": 1.5, "max": 40 },
    "fungus": { "min_depth": 4, "intercept": 1,  "slope": 0.3, "max": 12, "tall_chance": 0.3 }
  },

  "infernal": {
    "map_generator": { "type": "infernal", "options": { "map_width": 100, "map_height": 100 } },
    "actors": [
      { "id": "hell_hound", "min": 18, "max": 26, "freq": 100 },
      { "id": "salamander", "min": 20, "max": 26, "freq": 100, "spawns_in": "lava" }
    ],
    "actor_budget": { "base": 5, "extra_chance": 70, "max_extra": 4 },
    "traps": { "min_depth": 18, "intercept": 20, "slope": 1, "max": 40 }
  }
}
```

Field notes:

- **`actors[]` / `items[]`** — the depth-ranged catalogs. `min`/`max` are the
  depth window; `freq` is the raffle weight; optional `count` (`[lo,hi]`) is how
  many of *this* entry to place when it's picked; `spawns_in` gates to a terrain
  (mirrors Brogue's `spawnsIn`, and the engine's existing `aquatic` filter).
- **`actor_budget` / `item_budget`** — how many *picks* to make per floor
  (Brogue's ~6 hordes / ~3-5 items). Each pick = one weighted-raffle over the
  depth-eligible rows. `item_budget` reuses the existing shape verbatim.
- **`traps` / `fungus`** — hazard count via `clamp(intercept + depth*slope, 0,
  max)` with a `min_depth` gate (Brogue's linear ramp). The engine already reads
  `{min,max}` for these; the biome layer *produces* a concrete `{min,max}` per
  floor from the ramp formula, so `spawnRandomTraps`/`spawnRandomFungus`
  (engine.js:9605/9559) are unchanged.
- **`map_generator` / `mechanics`** — flat per-biome (a biome is one theme). A
  floor can still override.

### 2. Mapping floors to biomes — `floor_plan`

A multi-level prototype declares a **`floor_plan`**: an ordered list assigning
depth ranges to biomes.

```jsonc
{
  "name": "The Dungeon",
  "floors": 26,                 // total depth (replaces the implicit levels.length)
  "biomes": { "caves": { ... }, "crypt": { ... }, "infernal": { ... } },
  "floor_plan": [
    { "biome": "caves",    "floors": "1-8" },
    { "biome": "crypt",    "floors": "9-18" },
    { "biome": "infernal", "floors": "19-26" }
  ],

  // Specific hand-authored floors still override (existing mechanism).
  "levels": {
    "6":  { "win_conditions": ["killed:ghast"] },
    "26": { "map": "throne.tmj", "win_conditions": ["killed:azhdaya_head"] }
  }
}
```

- **`floors`** — total floor count. (Today this is implicit in
  `levels.length`; with biomes, `levels` becomes sparse/optional so we need an
  explicit count.)
- **`floor_plan`** — ranges are inclusive, 1-indexed, and should tile `1..floors`
  without gaps/overlap (validated; a gap falls back to prototype defaults).
- **`levels`** — reframed from a dense array to a **sparse map keyed by floor
  number** for the handful of special floors. (Back-comat: an array `levels[]`
  is still accepted and treated as index+1 → floor number.)

### 3. Depth semantics

**Depth = absolute floor index** (1-based `currentFloor`), matching Brogue and
the existing engine (`this.currentFloor`, engine.js:865). A biome's `min`/`max`
ranges are written in absolute floor terms. So the `infernal` biome above uses
`min:18+` because it's assigned to floors 19-26.

*Rationale for absolute over biome-relative:* it matches Brogue, requires no
translation, and lets ranges overlap biome boundaries naturally (a monster can
span the caves→crypt transition). The cost — biome catalogs aren't
copy-paste-portable to a different depth band — is acceptable and can be eased
later with an optional `depth_offset` per `floor_plan` entry if we want portable
biomes. Not in v1.

### 4. Engine integration — one seam

All resolution happens at **`getFloorConfig(floor)` (engine.js:2052)**, the
existing single merge point. Add one tier between the floor override and the
prototype root:

```
getFloorConfig(floor):
    floorOverride  = levels[floor]           // hand-authored floor — wins
        ↓ else per key
    biomeConfig    = resolveBiome(floor)     // NEW: biome-for-this-depth
        ↓ else per key
    prototype root defaults
```

`resolveBiome(floor)` (new):

1. Find the `floor_plan` entry whose range contains `floor`; look up its biome.
   (No biome → return `{}`, behaves exactly as today.)
2. For that biome at this depth, produce the standard config keys:
   - `random_actors` / `random_items`: run `actor_budget`/`item_budget` picks,
     each a frequency-weighted raffle over the depth-eligible catalog rows
     (`min ≤ floor ≤ max`), accumulating into the `{ id: {chance, min, max} }`
     table shape `spawnRandomActorsFromConfig` already consumes. (Because the
     existing placer re-rolls chance/count, the biome can emit either concrete
     per-id entries or a pre-rolled set — decided at build time.)
   - `traps` / `fungus`: compute `{min, max}` from `clamp(intercept +
     floor*slope, 0, max)` (gated by `min_depth`).
   - `map_generator` / `mechanics`: passed through from the biome.
3. The result is merged under any explicit `levels[floor]` override with the
   **same per-key `??` / deep-merge-mechanics semantics** `getFloorConfig`
   already uses — so a special floor can override just its `win_conditions` and
   still get its biome's spawns.

**Everything downstream is unchanged**: `spawnRandomActorsFromConfig`
(engine.js:9512) and its five placers, floor transitions, item catalog, map gen.
The biome layer is purely a *producer* of the config shape they already read.

**Out-of-depth (optional, phase 2):** when building `random_actors`, a small %
of picks can raffle at `floor + rand(1, min(5, floor/2))` (Brogue's rule),
filtered to non-`no_ood` rows. Adds spice; defer until the base model works.

### 5. Reuse of existing machinery

The design deliberately rides the code that already exists:

- `getFloorConfig` — the one integration seam (engine.js:2052).
- `spawnRandomActorsFromConfig` + placers — consume the biome's output
  unchanged (engine.js:9512, 9559, 9605, 9644, 9765, 9848).
- `{chance, min, max}` spawn-table shape and `item_budget` shape — reused
  verbatim.
- `random_type` category pools + `initItemCatalog`/`getCatalogTypeForCategory`
  (engine.js:3183/3228) — the biome's `items[]` `type` entries feed the same
  category resolution.
- `spawns_in` terrain gating mirrors the existing `aquatic`→liquid-tile filter
  (engine.js:9662).

## What changes vs. stays

| Area | Change |
|------|--------|
| `prototype.json` | New optional `biomes`, `floor_plan`, `floors` keys. `levels` may be a sparse map keyed by floor (array still accepted). |
| `engine.js` | `getFloorConfig` gains a `resolveBiome(floor)` tier + the ramp/raffle helpers. Downstream unchanged. |
| Existing prototypes | Unchanged and fully working — biomes are opt-in. The dungeon's 26 hand-authored floors keep resolving exactly as today. |
| `docs/PROTOTYPE.md` | Document the new keys (also fix the stale `fungus`/`win_state` omissions found during research). |

## Editor (sketch only — detailed design later)

The editor has a two-tier "Prototype defaults + Floor N tabs" model
(`renderFloorTabs`, proto-sections.js:37). We want to add per floor overrides (tabs) one at a time since the common use case is adding a special top or bottom floor, not starting with tabs for every floor.

- **Mode split**: single-level prototypes hide all of this (no `floors`/
  `floor_plan`/`biomes`); multi-level prototypes get the biome tools.
- **Biome library**: a list of biomes, each editable like a mini-prototype
  (map generator + the depth-ranged actor/item catalogs + hazard ramps). The
  depth-ranged catalog is the novel widget — a table of rows with
  min/max/freq(/count) columns and a small "preview at depth N" that shows which
  rows are eligible and their weighted share (reuse the existing weight-bar UI).
- **Floor plan**: assign biomes to floor ranges (a band editor), with validation
  that ranges tile `1..floors`.
- **Special floors**: the existing floor-tab override UI, now sparse — add a tab
  only for floors that deviate from their biome.

## Open questions for the follow-up (not blocking this doc)

1. Should `resolveBiome` emit **concrete pre-rolled** `random_actors` (so a floor
   is deterministic given the RNG seed at gen time) or **per-id chance tables**
   the existing placer re-rolls? (Leaning: pre-roll, so the raffle happens once
   and the placer just places — cleaner and matches Brogue's "pick 6 hordes".)
2. Portable biomes via an optional `depth_offset` on `floor_plan` entries — worth
   it, or is absolute-depth simpler and enough?
3. A shared cross-prototype biome library (biomes defined once, referenced by
   many prototypes) — future, once the per-prototype model proves out.
4. Out-of-depth escalation — include in v1 or defer?

## Verification (when implemented)

- **Behavior-preserving:** the dungeon with its current `levels[]` (no `biomes`)
  produces byte-identical `getFloorConfig` output for every floor.
- **New path:** a small test prototype with one biome over N floors generates
  sensible, ramping floors (early floors: weak monsters/few traps; deep floors:
  strong monsters/many traps) with no per-floor authoring — verified via the
  brogue-gen console report (rooms/fill) plus spawn logging.
- **Coexistence:** a biome prototype with one hand-authored `levels[26]` boss
  floor uses the biome for 1-25 and the override for 26.
