# Biomes

A **biome** is a themed bundle of depth-ranged content — monsters, items, hazards, a map
generator, mechanics flags — that a multi-floor prototype assigns to a range of floors.

The point is to **ramp difficulty by depth without authoring every floor**. Rather than
writing `random_actors`, `traps` and the rest onto floor 1, floor 2, floor 3…, you describe
one theme once and give each of its entries a floor window. As the player descends, entries
fade in and out of their windows, so the mix shifts on its own. Modeled on Brogue's
depth-distribution system (`pickHordeType` and the `autoGenerator` table).

## Where biomes live

Biomes are **data files, not prototype content** — the same pattern as `actors.json` and
`items.json`:

```
data/biomes.json                  ← the default library
prototypes/<name>/biomes.json     ← optional; adds to or overrides defaults by name
prototypes/<name>/prototype.json  ← names biomes in floor_plan; never defines them
```

At load, `Prototype.loadAssets()` merges them:

```js
this.biomes = { ...globalBiomes, ...prototypeBiomes };
```

A prototype entry replaces that **whole** biome — there is no per-key merging, so each
definition is self-contained. (Deep-merging would make `actors: []` ambiguous: "no monsters"
or "inherit the default's"?)

Author them with the **Biome Editor** (`editors/biome-editor.html`). The prototype editor
only *assigns* biomes, in its Biome plan section — which is optional: switch it off and every
floor uses the prototype's own defaults instead of ramping by depth.

## Assigning biomes to floors

`prototype.json` needs two keys:

```json
{
  "floors": 26,
  "floor_plan": [
    { "biome": "caves",    "floors": "1-8"   },
    { "biome": "depths",   "floors": "9-19"  },
    { "biome": "infernal", "floors": "20-26" }
  ]
}
```

`floors` is the total floor count. Each `floor_plan` entry claims an inclusive, 1-based
range, written as `"1-8"`, a bare number, or `[1, 8]`. Ranges should tile `1..floors`
without gaps; the prototype editor warns about gaps and overlaps, but the engine does not —
**the first matching entry wins**, so an overlap silently resolves to the earlier one.

A name that neither library defines logs a warning and those floors fall back to the
prototype's own top-level defaults.

## Biome definition

| Field | Type | Description |
|-------|------|-------------|
| `actors` | array | Depth-ranged monster catalog. Rows: `{ id, min, max, freq, count? }`. |
| `actor_budget` | object | `{ base, extra_chance, max_extra }` — how many picks per floor. |
| `items` | array | Depth-ranged item catalog. Rows use `type` (an **`item_catalog` category**, not an item id) plus `min`/`max`/`freq`. |
| `item_budget` | object | Same budget shape as `actor_budget`. |
| `traps`, `fungus` | object | Hazard count ramp: `{ min_depth, intercept, slope, max }`. `fungus` also takes `tall_chance` (0–1). |
| `decorations` | array | Floor dressing scatter. Rows: `{ entity \| actor, pattern, density, min, max, freq, region? }`. See [Decorations](#decorations). |
| `map_generator` | object | `{ type, options }`, applied to every floor in the biome. |
| `mechanics` | object | Flags merged over the prototype's (see Precedence). |

`win_conditions` and `switch_puzzles` are **not** biome keys. A biome spans many floors while
those are per-floor concerns; set them on a floor override instead.

### Catalog rows

```json
{ "id": "goblin", "min": 3, "max": 10, "freq": 100 }
{ "id": "oculus", "min": 2, "max": 2, "freq": 100, "count": [1, 4] }
```

- `min`/`max` — the inclusive floor window. Defaults: `min` 1, `max` unbounded. Equal values
  pin an entry to a single floor, which is how a set-piece is expressed.
- `freq` — raffle weight among *eligible* rows. Relative, not a percentage.
- `count` — optional `[lo, hi]` spawned per pick (default `[1, 1]`).

Each floor, the engine filters rows to `min ≤ floor ≤ max`, then makes `budget` weighted
picks. **Repeat picks of the same entry accumulate** (`min`/`max` sum), so one row can exceed
its own `count`.

### Budgets

`base` guaranteed picks, then `max_extra` independent rolls at `extra_chance` percent:

```json
"actor_budget": { "base": 3, "extra_chance": 60, "max_extra": 3 }
```

All three default to `0` — an omitted or empty budget yields **no spawns at all**, not a
default handful.

### Hazard ramps

Count at floor `d` is `clamp(intercept + d × slope, 0, max)`, inactive below `min_depth`:

```json
"traps": { "min_depth": 2, "intercept": 0, "slope": 2.5, "max": 30 }
```

Which gives, for that spec: floor 1 → none (below `min_depth`), floor 2 → 4–5,
floor 5 → 12–13, floor 8 → 19–20, floor 12 → 29–30 (clamped at `max` from here down). The
result is a small band around the computed count so consecutive floors aren't identical.

### Decorations

Floor dressing scattered at generation — moss beside water, rubble against the walls,
a skull in an empty hall. It never blocks movement, and prints its `walk_description`
when you step on it.

A row names either an `entity` (inert, from [`data/entities.json`](../data/entities.json))
or an `actor` (from [`data/actors.json`](../data/actors.json)) when the dressing needs to
*do* something — a grave you can dig up. Actor rows must be `solid: false`, since
scattered dressing may never wall off a corridor; a solid one is skipped with a warning.

```json
"decorations": [
  { "entity": "moss",     "pattern": "near_liquid",  "density": 0.25, "min": 1, "max": 8,  "freq": 60 },
  { "entity": "rubble",   "pattern": "wall_hugging", "density": 0.08, "min": 0, "max": 20 },
  { "entity": "sediment", "pattern": "clusters",     "density": 0.05, "min": 0, "max": 12, "freq": 40 },
  { "entity": "skull",    "pattern": "room_floor",   "density": 0.01, "min": 0, "max": 3,  "freq": 25 },
  { "actor":  "grave",    "pattern": "room_floor",   "density": 0.004, "min": 0, "max": 2, "freq": 35 }
]
```

| Field | Default | Meaning |
|-------|---------|---------|
| `entity` | one of these | A key in `data/entities.json`. Unknown → warning, row skipped. |
| `actor` | one of these | A key in `data/actors.json`, and must be `solid: false`. Unknown or solid → warning, row skipped. |
| `pattern` | `"scatter"` | Where it may land — see the table below. |
| `density` | `0.1` | Fraction of the tiles *matching the pattern* to fill, before clamping. |
| `min` | `0` | Hard floor on the **count**. |
| `max` | `min` | Hard ceiling on the **count**. |
| `freq` | `100` | Percent chance the row runs at all on a given floor. |
| `region` | — | Optional `namedRegions` key (`largest_room`, `sanctum`, `portico`, `treasure_room`). Unknown → warning, whole map. |

> **`min`/`max` mean COUNT here, not depth.** In an `actors` or `items` catalog row the
> same two names are a *depth window*. A decoration row has no depth window — use `freq`,
> or put the biome on a narrower `floor_plan` range. This is the easiest thing in the file
> to misread; the biome editor labels the control "count" for that reason.

**Density proposes, min/max dispose.** The count scales with how much of *this* floor
matches the pattern, then clamps. With `density: 0.25, min: 1, max: 8`: a floor with 12
water-adjacent tiles gets `round(12 × 0.25) = 3`; one with 200 gets 50, clamped to 8.

| Pattern | Lands on |
|---------|----------|
| `scatter` | Any walkable tile. `density` does all the work. |
| `clusters` | Same tiles, but grown in patches around a few seeds rather than spread evenly. |
| `wall_hugging` | Tiles with a wall (any solid actor) among their 8 neighbours. |
| `near_liquid` | Tiles beside water, sewage **or lava**. |
| `room_floor` | Open room interiors only — tiles with ≥3 walkable cardinal neighbours. Never corridors. |

An unrecognised pattern warns and falls back to `scatter`; a typo never blanks a floor.

Decorations are placed **after every actor, item, stairway and the player**, so one never
sits under a monster or blocks a door, and two rows never stack on the same tile. They are
saved with the floor, so revisiting a level shows the same arrangement rather than a
reshuffle.

Unlike the catalogs, decoration rows are **not** run through the budget raffle — an
authored "1–8 moss" means what it says.

## Precedence

Every floor's config resolves in three tiers — **floor override > biome > prototype root**:

```
prototype.json root  →  biome  →  levels[<floor>]
```

Two rules to keep straight:

- **`mechanics` is deep-merged** (one level): root, then biome, then floor. So a biome can
  set `treasure_room` while inheriting the root's `darkness`.
- **Everything else replaces wholesale.** A biome's `map_generator` fully replaces the root's,
  *including its `options`* — biome map generators must be self-contained. Same for
  `decorations`: a floor override that wants the biome's list plus one more must restate
  the whole list.

## The `item_catalog` contract

A biome's `items` rows name **categories**, and `item_catalog` lives only at the prototype
root. If a category isn't in the host prototype's `item_catalog`, item placement silently
skips it and **those items never spawn**.

So a reusable biome is a contract against its host. Only `dungeon` and `sewer` currently
define an `item_catalog` at all. The engine warns at load when a biome asks for a category
the prototype doesn't provide, and the prototype editor flags it in the Biome plan section —
but prefer widely-available categories (`potion`, `scroll`, `weapon`, `armor`) for biomes
meant to travel.

The same caution applies to `actors` rows: an `id` that only exists in one prototype's
`actors.json` won't resolve elsewhere. The biome editor only offers ids from
`data/actors.json` for this reason.

## Notes for implementers

- `config.biomes` has exactly **one reader**, `resolveBiome` (`engine/dungeon-engine/floors.js`). `loadAssets()`
  publishes the merged library there before the first `loadFloor`, which is why nothing
  downstream needs to know libraries exist.
- **`resolveBiome` is not pure.** `_budgetCount` and `_weightedPick` both draw from
  `ROT.RNG`, and `getFloorConfig` is called several times per floor load — each call rolls a
  different spawn table. Don't memoize a "resolved biome" preview and expect stability.
- Nothing validates `prototype.json`. A typo'd key is silently ignored; a malformed range
  means "no biome for this floor" and a quiet fallback. The editors carry the validation.

## See also

- [PROTOTYPE.md](PROTOTYPE.md) — prototype keys, floor overrides, `item_catalog`
- [MAP.md](MAP.md) — map generators and their options
- `editors/biome-editor.html` — authoring UI
