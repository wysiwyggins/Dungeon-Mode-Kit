# Prototype System

A **prototype** is a defines a dungeon mode prototype. Each prototype lives in its own folder under `prototypes/` and is configured primarily through `prototype.json`.

```
prototypes/
  my_level/
    prototype.json          ← prototype rules (required)
    actors.json             ← actor overrides/additions (optional)
    items.json              ← item overrides/additions (optional)
    personalities.json      ← AI behavior overrides (optional)
    biomes.json             ← biome library for this prototype (optional)
    map.tmj                 ← authored Tiled map, floor 1 (optional)
    2.tmj, 3.tmj, ...      ← authored maps for floors 2+ (optional)
```

Prototype-specific data files are merged with the global `data/` files at load. You only need to define what's new or different for a given level.

Load a prototype by adding `?prototype=my_level` to the URL.

**When you add a prototype folder, add its name to `data/prototypes.json`.** Static HTTP
can't list a directory, so that file is the index the editors read to populate their
prototype dropdowns. The game itself doesn't need it — it loads by name — but a prototype
missing from the index is invisible in the editors.

---

## Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name shown in the UI |
| `description` | string | Text shown on level load. Supports `\n` for line breaks. |
| `turn_speed` | number | Milliseconds per AI turn (lower = faster). Default `50`. |
| `loaded_sound` | string | Sound played when the prototype loads |
| `next_level` | string | Prototype folder name to advance to (via down stairway or portal) |
| `previous_level` | string | Prototype folder name to return to (via up stairway from floor 1) |
| `win_state` | object | Escape-style overall victory for the whole prototype: `{ via: "escape", exit_floor, conditions, message }`. Reaching `exit_floor`'s exit with `conditions` met wins the run (distinct from per-floor `win_conditions`, which just unlock a floor's stairway). |
| `floors`, `biomes`, `floor_plan` | — | Multi-floor / biome configuration — see [Multi-Floor Prototypes](#multi-floor-prototypes) and [Biomes](#biomes). |

---

## Mechanics

The `mechanics` object controls core gameplay systems for the level. All fields are optional.

```json
"mechanics": {
  "fog_of_war": true,
  "darkness": true,
  "ambient_light": 0.1,
  "tint": "#3355AA",
  "player_auto_light": false,
  "viewport_width": 40,
  "viewport_height": 40
}
```

### Visibility & Lighting

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fog_of_war` | boolean | `false` | Remember explored tiles; unexplored areas are hidden |
| `darkness` | boolean | `false` | Enable dynamic lighting. Without this, the entire map is fully lit. |
| `ambient_light` | number | `0.0` | Minimum light level (0-1) when `darkness` is enabled. `0` = pitch black outside light sources, `1` = fully lit everywhere. |
| `player_light_radius` | number | `6` | Radius of the player's auto-light in tiles (only applies when `player_auto_light` is true) |
| `player_auto_light` | boolean | `true` | Player emits light automatically. Set `false` to require a carried light source (torch, lantern). |
| `tint` | string | none | Hex color overlay applied to the entire level (e.g. `"#3355AA"` for a blue tint) |

See [LIGHTING.md](LIGHTING.md) for the full lighting system reference.

### Viewport & Scrolling

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `viewport_width` | number | map width | Visible width in tiles. When smaller than the map, the camera scrolls to follow the player. |
| `viewport_height` | number | map height | Visible height in tiles. When smaller than the map, the camera scrolls to follow the player. |
| `ai_margin` | number | `5` | How many tiles beyond the viewport edge AI actors continue to take turns. Actors outside this margin skip their turn. Only applies when viewport scrolling is active; ignored (treated as infinite) when the full map is visible. |

### Searching

Tunables for the `(s)earch` action and hidden actors (any actor with `hidden: true` —
secret doors, concealed levers, undiscovered traps). See `docs/ACTORS.md`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `search_radius` | number | `5` | How far a completed five-turn search reaches, in tiles. Everything hidden within this radius and in line of sight is found; nothing outside it is. Capped independently of strength so a finished search reliably means "this area is clear" — raise it for sprawling maps, lower it to make searching a room a multi-position job. |
| `thorough_search_strength` | number | `200` | Odds of the five-turn search. Chance at a tile is `strength - 10 × distance`, two-thirds that for solid things like a door set in a wall. At the default it is certain everywhere inside `search_radius`; drop it below ~`10 × search_radius × 1.5` and finds start becoming a dice roll the player may want to repeat. |
| `passive_search_strength` | number | `30` | The glance you get for free the first time you stand on a tile. Uses a strength-derived radius rather than `search_radius`, so it naturally reaches ~2 tiles and the Ring of Awareness (`awareness`) widens it. Set to `0` to disable passive searching and make the search action the only way to find secrets. |

### Special Modes

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `observer_mode` | boolean | `false` | Disable stairway and portal placement. Use for spectator-only prototypes (e.g. cellular automata demos). |
| `treasure_room` | number | `0` | Percent chance (0-100) to spawn a treasure room on the level |
| `up_stairway_region` | string | generator's choice | Place the up (entry) stairway inside a named region the generator published. Some generators suggest one — `palladian` puts the entry stair in its `portico` courtyard, since arriving in the middle of an interior room reads as a mistake. Set explicitly to override, or to `null` for random placement. |
| `down_stairway_region` | string | generator's choice | Same for the down stairway. No generator currently suggests one; set it to e.g. `"sanctum"` on a palladian floor to put the descent behind the boss. |

---

## Map Generation

When no Tiled map file exists for a floor, the engine generates a procedural map using the `map_generator` block.

```json
"map_generator": {
  "type": "digger",
  "options": {
    "map_width": 80,
    "map_height": 80,
    "roomWidth": [5, 12],
    "roomHeight": [4, 10],
    "corridorLength": [3, 8],
    "dugPercentage": 0.35
  }
}
```

### Generator Types

**Walls?** matters more than it looks. A generator that builds walls also queues doors,
torches and `wall_types`, and publishes rooms as named regions — so region-targeted
stairways, treasure rooms and switch puzzles have something to attach to. The floor-only
generators carve open space and nothing else; a biome using one gets no walls, doors,
torches or room regions no matter what else it configures.

| Type | Walls? | Rooms? | Description |
|------|:------:|:------:|-------------|
| `dungeon` | yes | yes | Rooms (rectangle, cross, circular, cavern) attached via corridors, plus loops, dead-end secret doors and lakes. The main generator |
| `palladian` | yes | yes | Symmetrical villa: a mirrored grid of rooms around a central axial sanctum, with a columned portico. Built for boss floors and vaults |
| `infernal` | yes | — | Cave with lava pools |
| `digger` | yes | yes | Rooms connected by corridors (the fallback when a type is unknown) |
| `cellular` | yes | — | Cave-like organic shapes |
| `uniform` | — | — | Evenly distributed rooms, floor only |
| `rogue` | — | — | Classic roguelike grid rooms, floor only |
| `arena` | — | — | Simple empty rectangle |
| `divided_maze` | — | — | Recursive division maze |
| `icey_maze` | — | — | Maze with regularity control |
| `eller_maze` | — | — | Perfect maze (Eller's algorithm) |

`brogue` is the former name of `dungeon`, from when it was written while studying Brogue's
architect. The engine still accepts it as a silent alias, so old prototypes keep loading,
but new work should say `dungeon`.

### Common Options

| Option | Type | Description |
|--------|------|-------------|
| `map_width` | number | Map width in tiles |
| `map_height` | number | Map height in tiles |
| `roomWidth` | `[min, max]` | Room width range (digger, uniform, rogue) |
| `roomHeight` | `[min, max]` | Room height range (digger, uniform, rogue) |
| `corridorLength` | `[min, max]` | Corridor length range (digger) |
| `dugPercentage` | number | Target percentage of map to carve (digger) |
| `lake_chance` | number | Percent chance to spawn water (cellular) |
| `sewage_chance` | number | Percent chance to spawn sewage (cellular, digger) |
| `lava_chance` | number | Percent chance for lava pools (infernal) |
| `wall_types` | array | Weighted wall types: `[{ "type": "rock_wall", "weight": 95 }]` |
| `pushableWallChance` | number | Percent chance an interior wall with floor on both sides becomes a pushable wall (default `2`). Only applies to walls of type `wall`. |
| `secretWallChance` | number | Percent chance the same wall becomes a **hidden door** instead — found by searching, not shoving (default `0`, off). Rolled independently of `pushableWallChance`, so it is not competing for a share of that 2%. |

Both of the last two convert walls the generator was going to place anyway, so they
scale with map area: the same percentage yields ~5× as many secrets on a 100×100 map
as on a 50×50 one. Tune per prototype rather than reusing one number. See
[EPISTEMOLOGY.md](EPISTEMOLOGY.md) for how hidden things are found.

#### Brogue-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRooms` | number | auto | Maximum rooms to generate. Optional — when omitted, auto-computed from map size (`≈ map_width × map_height / 200`, clamped 8–120) so larger maps fill out. An explicit value overrides the auto default. Not exposed in the prototype editor. |
| `maxAttempts` | number | auto | Room-placement attempts (the practical cap on density, since many attempts fail to place). Optional — when omitted, auto-scaled to `≈ maxRooms × 4` (clamped 50–600) so it can reach the size-scaled room target. An explicit value overrides. Larger = denser. |
| `corridorChance` | number | `55` | Percent chance to add a corridor between rooms |
| `corridorLength` | `[min, max]` | `[3, 9]` | Corridor length range |
| `doorChance` | number | `50` | Percent chance to place a door at room connections |
| `torchChance` | number | `30` | Percent chance to place a torch in a room |
| `roomWeights` | object | `{ rectangle: 30, cross: 25, circular: 20, cavern: 25 }` | Relative weights for room types |
| `loopMinDistance` | number | `20` | Minimum path distance between rooms before a loop shortcut is added |
| `maxLoops` | number | `5` | Maximum loop connections to add |
| `secretDoorChance` | number | `35` | Percent of **dead-end shortcuts** that become hidden doors rather than pushable walls. These are the cells Brogue's own dead-end fixer identifies — a blind corridor with a room one or two tiles beyond the wall — so they are the most rewarding thing a search can turn up. `0` restores the all-pushable behaviour. Distinct from the shared `secretWallChance` above, which converts ordinary interior walls. |

#### Palladian-Specific Options

The `palladian` generator implements the parametric shape grammar from Stiny & Mitchell, *"The Palladian grammar"* (1978) — the formal grammar behind Palladio's villa plans. Unlike the other generators it produces a space that reads as deliberately *built*: a "tartan" grid of an **odd** number of east–west bays by any number of north–south rows, mirrored about a central axis, with adjacent bays separated by exactly one wall. Bays are then merged into larger rooms, and one room may be a non-rectangular cross-hall straddling the axis — the **sanctum**, meant to hold a boss or a reward.

Interior doors are aligned with each other and with the exterior windows, producing the *enfilade* Palladio is known for: an unbroken sight-line through the whole villa, including one straight down the axis from the rear door, through the sanctum, and out through the portico.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bayColumns` | `[min, max]` | `[3, 7]` | Number of east–west bays. **Always forced odd** — the centre bay is bisected by the symmetry axis. `5` is the canonical villa. |
| `bayRows` | `[min, max]` | `[2, 4]` | Number of north–south bay rows. `3` is canonical. |
| `bayWidth` | `[min, max]` | `[4, 11]` | Interior width of one bay, in tiles. |
| `bayHeight` | `[min, max]` | `[4, 9]` | Interior height of one bay, in tiles. |
| `centralBias` | number | `150` | Percent width of the central axial bay relative to a flanking bay. Above 100 gives a grander salone. |
| `mergeChance` | number | `45` | Percent chance a mirrored pair of adjacent bays merges into one room. `0` = a warren of small rooms; `100` = a few vast halls. |
| `sanctumChance` | number | `70` | Percent chance the plan has a non-rectangular cross-hall on the axis. The grammar permits **at most one**. |
| `sanctumShapes` | array | `["cross","tee","eye"]` | Eligible cross-hall shapes, as a weighted pool (repeat an entry to weight it). `cross` (+) keeps the sanctum tightest; `eye` (I) swallows most of the plan. Falls back `cross → tee → eye → rect` when the grid is too small for the pick. |
| `porticoStyle` | string | `"prostyle"` | `prostyle` (porch projects out), `in_antis` (recessed into the facade), `random`, or `none`. |
| `porticoDepth` | number | `3` | Tiles the porch projects out or is recessed in. Clamped to fit the map. |
| `columnSpacing` | number | `2` | Tiles between colonnade columns; `0` = no colonnade. The column count is forced **even** so the axis stays an open doorway — Palladio never blocks the axis with a column. |
| `doorChance` | number | `55` | Percent chance a non-axial interior opening gets a door actor. Axial openings are always open, so the axial sight-line can't be closed off. |
| `torchChance` | number | `40` | Percent chance to place a brazier in a room (higher than the dungeon generator's 30 — temples are lit). |
| `wall_types` | array | `[{ "type": "brick_wall", "weight": 100 }]` | Weighted wall types. **Note:** the shared `pushableWallChance` / `secretWallChance` pass only converts walls of type `wall`, so the `brick_wall` default disables both. The villa gets its concealed routes from `secretPassageChance` below instead, which does not care about wall type. |
| `secretPassageChance` | number | `40` | Percent chance a non-axial interior door is concealed — a doorway that reads as blank wall until searched out. The axial door is never eligible: it carries the enfilade, and hiding it would break the one sight-line the generator exists to produce. A room always keeps at least one door you can simply walk through, so a secret is a shortcut, never the only way in. Mirrored twins are concealed as a pair, so the villa never gives itself away by being asymmetric. |
| `secretPassageLeverChance` | number | `35` | Percent of those concealed doorways that spawn as `barred_hidden_door` (locked) instead of `hidden_door`, paired by `machine_id` to a **hidden lever**. Finding the door is not enough — it stays shut until the lever is found and pulled. The lever is itself disguised as wall, sited in one of the two rooms the passage joins, and mirrored with its twin. |

The generator reuses existing actors — `column` for the colonnade, `fortification` for windows (solid but see-through, so it reads as a barred opening), `brick_wall`, `wall_torch` for wall sconces, and `brazier` for freestanding centrepieces. No new art is required.

**Region-targeted spawning.** The generator publishes two named regions, `sanctum` and `portico`. A `random_actors` or `random_items` entry can name one to confine its spawns, which is how a boss is placed in the room built for it:

```json
"levels": {
  "18": {
    "map_generator": {
      "type": "palladian",
      "options": { "bayColumns": [5, 5], "bayRows": [3, 3], "sanctumShapes": ["cross"] }
    },
    "win_conditions": ["killed:minotaur"],
    "random_actors": { "minotaur": { "chance": 100, "region": "sanctum" } },
    "random_items": { "amulet": { "chance": 100, "region": "sanctum" } }
  }
}
```

`region` is optional and generator-agnostic: an unknown name warns and falls back to the whole map rather than failing. Prefer `sanctumShapes: ["cross"]` when you want a *tight* boss chamber — an `eye` sanctum can span most of the plan, which makes the region barely a constraint.

#### Named Regions

A generator can publish named areas that spawn entries target with `"region"`. Available regions by generator:

| Region | Published by | Description |
|--------|--------------|-------------|
| `largest_room` | `dungeon`, `digger`, `palladian` | The biggest single room by floor area — a natural arena for a guaranteed boss or a hoard. |
| `treasure_room` | any generator, when the `treasure_room` mechanic fires | The locked vault's interior. Target it to put a guardian inside with the loot. |
| `sanctum` | `palladian` | The axial cross-hall, when the plan has one. |
| `portico` | `palladian` | The entrance courtyard. Also where the entry stairway lands by default. |

`region` is honoured by `random_actors`, `random_items`, `traps`, `fungus`, and `item_budget`. On the per-entry configs (`random_actors`, `random_items`) it goes on the individual entry; on the single-block configs (`traps`, `fungus`, `item_budget`) it goes on the block:

```json
"traps":  { "min": 4, "max": 8, "region": "sanctum" },
"fungus": { "min": 2, "max": 5, "region": "largest_room" }
```

If both a `map.tmj` and `map_generator` exist for a floor, the `.tmj` takes priority.

---

## Random Spawning

`random_actors` and `random_items` control what entities are scattered on the map at load time.

```json
"random_actors": {
  "skeleton": { "chance": 80, "min": 2, "max": 4 },
  "bat": { "chance": 50, "min": 1, "max": 2 }
},
"random_items": {
  "torch": { "chance": 60, "min": 1, "max": 2 },
  "potion": { "chance": 100 }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `chance` | number | Percent probability (0-100) that this entity type spawns at all |
| `min` | number | Minimum count if spawned (default `1`) |
| `max` | number | Maximum count if spawned (default `1`) |

Each entity type rolls independently. If the roll succeeds, a random count between `min` and `max` is placed on walkable tiles.

Actor and item IDs reference definitions in `data/actors.json`, `data/items.json`, or the prototype's own `actors.json` / `items.json`.

### Traps

`traps` spawns hidden trap actors on random walkable tiles. The engine picks from all actors with the `trap` attribute defined in actors.json.

```json
"traps": { "min": 1, "max": 10 }
```

| Field | Type | Description |
|-------|------|-------------|
| `min` | number | Minimum traps to spawn |
| `max` | number | Maximum traps to spawn |

Can be set at the prototype level or per-floor (overrides prototype default).

### Switch Puzzles

`switch_puzzles` spawns switch-and-target pairs on the map (e.g., a lever that opens a gate).

```json
"switch_puzzles": {
  "min": 0, "max": 2,
  "patterns": [
    {
      "type": "gated_room",
      "weight": 1,
      "switch_actor": "gate_lever",
      "target_actor": "gate",
      "switch_effects": { "locked": false, "open": true },
      "switch_message": "You pull [name]. A gate grinds open."
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `min` | number | Minimum puzzles to spawn |
| `max` | number | Maximum puzzles to spawn |
| `patterns` | array | Available puzzle patterns to choose from |

Each pattern defines:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Pattern type (e.g. `"gated_room"`) |
| `weight` | number | Relative spawn probability when multiple patterns exist |
| `switch_actor` | string | Actor type ID for the switch |
| `target_actor` | string | Actor type ID for the target |
| `switch_effects` | object | Attributes to set on the target when the switch is activated |
| `switch_message` | string | Message shown when the switch is activated. `[name]` interpolates the switch's color-aware name (see [ACTORS.md](ACTORS.md#paired-colors)) |

Can be set at the prototype level or per-floor.

### Item Pools (item types)

Naming an **item type** instead of an item ID spawns a random member of that type. The pool is
derived from membership: every item declaring `"type": "potion"` is a potion, so adding one is
enough to put it in the pool — there is no list to keep in sync. See [TYPES.md](TYPES.md).

The built-in item types are `potion`, `food`, `weapon`, `armor`, `staff`, `scroll`, `ring` and
`wand`.

```json
// data/items.json — declaring the type is the whole membership step
"health_potion": {
  "type": "potion",
  "identified_template": "Aqua Vita",
  "attributes": { "use_effect": { "health": 20 } }
}
```

For a hand-curated pool that isn't simply "everything of this type", an item entry may still carry
an explicit `random_type` array, which wins over derived membership.

Use type names in `random_items` to spawn a random item from a category:

```json
"random_items": {
  "potion": { "chance": 60 },
  "weapon": { "chance": 30 },
  "armor": { "chance": 20 }
}
```

A prototype can add its own item types in `prototypes/<name>/types.json`, or add members to a
built-in type just by declaring it on an item in its `items.json`.

---

## Item Catalog

The `item_catalog` defines which item categories are active for the prototype, how many types per category are available per run, and how frequently each category appears when using the budget system.

```json
"item_catalog": {
  "potion":  { "count": 10, "weight": 50 },
  "scroll":  { "count": 7,  "weight": 40 },
  "staff":   { "weight": 15 },
  "weapon":  { "weight": 10 },
  "armor":   { "weight": 8 }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | (Optional) Randomly select this many types from the pool at the start of a run. Omit to use all types. |
| `weight` | number | Relative probability when drawing from the budget system. Higher = more common. |
| `pool` | array | (Optional) Explicit list of item IDs. If omitted, the pool is every item declaring this type (or the category's `random_type` array, if it has one). |

**How `count` works:** If the potion pool has 16 types and `count` is 10, the engine shuffles the pool and picks 10 at random when the prototype loads. Only those 10 potion types will appear for the entire run.

When an item catalog is active, `random_items` pool references (like `"potion"`) draw from the catalog's subset instead of the full pool. Specific item IDs (like `"health_potion"`) bypass the catalog and always spawn.

**Discovery UI**: Press `d` to show discovery progress for each catalog category. Identifying an item marks its type as discovered. The panel shows a progress bar per category (e.g., `Potions ████░░░░ 4/10`).

---

## Item Budget

The `item_budget` supplements `random_items` by spawning additional items drawn from catalog categories using weighted random selection.

```json
"item_budget": {
  "base": 2,
  "extra_chance": 40,
  "max_extra": 3
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `base` | number | `3` | Guaranteed number of items spawned per floor |
| `extra_chance` | number | `50` | Percent chance for each bonus item |
| `max_extra` | number | `3` | Maximum bonus items to roll for |

Each floor spawns `base` items guaranteed, then rolls up to `max_extra` additional items at `extra_chance`% each. Items are drawn from categories using `weight` from `item_catalog`.

`item_budget` can be set at the prototype level (applies to all floors) or per-floor (overrides the prototype default). It runs after `random_items`, so both systems stack.

**Requires `item_catalog`** — the budget system does nothing without a catalog definition.

---

## Win Conditions

`win_conditions` is an array of conditions that must all be met to unlock the floor's stairway or portal.

```json
"win_conditions": ["killed:ghast", "wearing:crown"]
```

### String Formats

| Format | When met |
|--------|----------|
| `"killed:actor_type"` | All living actors of that type are dead |
| `"wearing:item_id"` | Player has that item equipped |
| `"holding:item_id"` | Player has that item in inventory |

### Object Format

For stat or attribute comparisons:

```json
{
  "actor": "player",
  "stat": "health",
  "op": ">",
  "value": 50
}
```

| Field | Description |
|-------|-------------|
| `actor` | `"player"` or an actor type string |
| `stat` | Stat or attribute name to check |
| `op` | Comparison: `">"`, `">="`, `"<"`, `"<="`, `"=="`, `"!="` |
| `value` | Number to compare against |

---

## Multi-Floor Prototypes

Add a `levels` array to create multiple floors within one prototype. Each entry is a floor configuration object.

```json
{
  "name": "A Dungeon",
  "mechanics": { "fog_of_war": true, "darkness": true },
  "next_level": "caverns",
  "levels": [
    {
      "win_conditions": [],
      "mechanics": { "ambient_light": 0.7, "tint": "#3355AA" },
      "map_generator": { "type": "digger", "options": { "map_width": 40, "map_height": 40 } },
      "random_actors": { "rat": { "chance": 100, "min": 2, "max": 3 } },
      "random_items": { "torch": { "chance": 60 } }
    },
    {
      "win_conditions": ["killed:ghast"],
      "random_actors": { "ghast": { "chance": 100, "min": 1, "max": 1 } }
    }
  ]
}
```

### Per-Floor Overrides

Each floor object can override these fields from the prototype root:

| Field | Description |
|-------|-------------|
| `win_conditions` | Win conditions for this floor |
| `mechanics` | Mechanics overrides (merged with prototype-level mechanics) |
| `map_generator` | Map generator config for this floor |
| `random_actors` | Actor spawns for this floor |
| `random_items` | Item spawns for this floor |
| `item_budget` | Override the prototype-level item budget for this floor |
| `traps` | Trap spawn config for this floor |
| `fungus` | Fungus scatter config for this floor (`{ min, max, tall_chance? }`) |
| `switch_puzzles` | Switch puzzle config for this floor |

Resolution order per key: a floor override wins, else the biome for that floor (see [Biomes](#biomes)), else the prototype-root default. `mechanics` is deep-merged (root ← biome ← floor); all other keys replace wholesale.

`levels` may also be written as a **sparse object keyed by floor number** — useful with biomes, where only a few floors are hand-authored:

```json
"floors": 26,
"levels": { "6": { "win_conditions": ["killed:ghast"] }, "26": { "map": "throne.tmj" } }
```

Fields not specified in a floor object fall back to the prototype-level defaults.

### Floor Behavior

- **Stairways** move between floors (not prototypes). The engine auto-places `down_stairway` on every floor except the last.
- **Win conditions** are per-floor. Each floor's stairway is locked until its conditions are met.
- **portal** is auto-placed on the last floor when `next_level` is set. It starts hidden and appears when the last floor's win conditions are met.
- **Going up from floor 1** transitions to `previous_level` (if set).
- **Floor state** is saved when leaving and restored when returning. Entities, map, and RNG state persist.

### Floor Map Files

| Floor | File |
|-------|------|
| 1 | `map.tmj` |
| 2 | `2.tmj` |
| 3 | `3.tmj` |
| N | `{N}.tmj` |

Missing floor maps are generated procedurally using the floor's `map_generator` (or the prototype-level default).

---

## Biomes

Biomes let a multi-floor prototype **ramp difficulty by depth without authoring every floor**. Instead of writing out `random_actors`/`traps`/etc. on each floor, you define a **biome** — a themed bundle of depth-ranged catalogs — and assign it to a range of floors. As depth increases, catalog entries fade in and out of their `[min, max]` windows, so the monster/item/hazard mix ramps automatically. (Modeled on Brogue's depth-distribution system; see `docs/BIOMES.md` for the design rationale.)

Biomes are **opt-in and additive** — a prototype with no `floor_plan` behaves exactly as before.

### Top-level keys

| Key | Type | Description |
|-----|------|-------------|
| `floors` | number | Total floor count (use instead of a dense `levels` array when floors are biome-driven). |
| `floor_plan` | array | Ordered `{ biome, floors }` assignments. `floors` is an inclusive range (`"1-8"`), a single number, or `[lo, hi]`. Ranges should tile `1..floors` without gaps. |

`prototype.json` names biomes but does not define them:

```json
{
  "floors": 26,
  "floor_plan": [
    { "biome": "caves", "floors": "1-8" },
    { "biome": "crypt", "floors": "9-26" }
  ]
}
```

Each name is looked up in `data/biomes.json`, or in this prototype's own `biomes.json`
if it defines one (see [Prototype-Specific Data Files](#prototype-specific-data-files)).
A name neither library defines logs a warning, and those floors fall back to the
prototype's own defaults.

### Biome definition

A biome is one entry in `data/biomes.json` (or a prototype's `biomes.json`), keyed by name:

| Field | Type | Description |
|-------|------|-------------|
| `actors` | array | Depth-ranged monster catalog. Each row: `{ id, min, max, freq, count? }` — `min`/`max` are the floor window, `freq` the raffle weight, `count` an optional `[lo, hi]` per-pick spawn count. |
| `actor_budget` | object | `{ base, extra_chance, max_extra }` — how many weighted picks to make per floor from the eligible `actors`. |
| `items` | array | Depth-ranged item catalog. Rows use `type` (a category from `item_catalog`) plus `min`/`max`/`freq`. |
| `item_budget` | object | Standard `{ base, extra_chance, max_extra }` budget (see [Item Budget](#item-budget)). |
| `traps`, `fungus` | object | Hazard **count ramp**: `{ min_depth, intercept, slope, max }`. Count at floor `d` = `clamp(intercept + d*slope, 0, max)`, active only at `d ≥ min_depth`. `fungus` also takes `tall_chance`. |
| `map_generator`, `mechanics` | object | Applied to every floor in the biome (a biome is one theme). A floor can still override. |

Depth = the absolute 1-based floor index. `actors`/`items` rows are picked by filtering to `min ≤ floor ≤ max` and doing a frequency-weighted raffle, `budget` times per floor. Hand-authored `levels` entries still override the biome per key.

---

## Level Linking

Prototypes are linked together using `next_level` and `previous_level`.

```json
{
  "name": "The Mines",
  "previous_level": "default",
  "next_level": "sewer"
}
```

- **Down stairway** on the last floor (or single-floor prototype) transitions to `next_level`
- **Up stairway** on floor 1 transitions to `previous_level`
- **portal** on the last floor of a multi-floor prototype transitions to `next_level` when win conditions are met

See [MAP.md](MAP.md) for stairway placement and transition details.

---

## Prototype-Specific Data Files

Place these files alongside `prototype.json` to add or override entity definitions for a specific level:

| File | Merges with | Purpose |
|------|-------------|---------|
| `actors.json` | `data/actors.json` | Add level-specific actors or override global ones |
| `items.json` | `data/items.json` | Add level-specific items or override global ones |
| `personalities.json` | `data/personalities.json` | Add level-specific AI behaviors |
| `biomes.json` | `data/biomes.json` | Biomes this prototype's `floor_plan` can name |

Prototype-specific entries with the same key as a global entry replace the global version for that level. See [ACTORS.md](ACTORS.md) and [ITEMS.md](ITEMS.md) for the data formats.

Biomes are **not** authored inside `prototype.json`. The defaults live in `data/biomes.json`,
a prototype's own `biomes.json` adds to or overrides them by name, and `prototype.json` just
names the result in its `floor_plan` — the same pattern as `actors.json`. A prototype entry
replaces that whole biome (no per-key merging), so each definition is self-contained.
Author biomes with the Biome Editor (`editors/biome-editor.html`).

---

## Examples

### Minimal Single-Floor Prototype

```json
{
  "name": "The Arena",
  "description": "A simple test arena.",
  "turn_speed": 50,
  "mechanics": {
    "fog_of_war": false,
    "darkness": false
  },
  "random_actors": {
    "skeleton": { "chance": 100, "min": 2, "max": 4 }
  },
  "win_conditions": ["killed:skeleton"]
}
```

### Multi-Floor Dungeon with Progression

```json
{
  "name": "The Depths",
  "description": "Darkness awaits below.",
  "turn_speed": 50,
  "next_level": "caverns",
  "previous_level": "default",
  "mechanics": {
    "fog_of_war": true,
    "darkness": true,
    "player_auto_light": false,
    "viewport_width": 40,
    "viewport_height": 40
  },
  "map_generator": {
    "type": "digger",
    "options": { "map_width": 80, "map_height": 80 }
  },
  "levels": [
    {
      "win_conditions": [],
      "mechanics": { "ambient_light": 0.7, "tint": "#3355AA" },
      "map_generator": {
        "type": "digger",
        "options": { "map_width": 40, "map_height": 40 }
      },
      "random_actors": {
        "rat": { "chance": 100, "min": 2, "max": 3 }
      },
      "random_items": {
        "torch": { "chance": 60, "min": 1, "max": 2 }
      }
    },
    {
      "win_conditions": [],
      "random_actors": {
        "skeleton": { "chance": 100, "min": 2, "max": 4 },
        "bat": { "chance": 80, "min": 1, "max": 2 }
      },
      "random_items": {
        "potion": { "chance": 60, "min": 1, "max": 2 }
      }
    },
    {
      "win_conditions": ["killed:ghast"],
      "random_actors": {
        "ghast": { "chance": 100, "min": 1, "max": 1 },
        "skeleton": { "chance": 100, "min": 3, "max": 5 }
      }
    }
  ]
}
```

### Observer Mode (No Player)

```json
{
  "name": "Cellular Automata",
  "description": "Watch life emerge.",
  "turn_speed": 50,
  "mechanics": {
    "fog_of_war": false,
    "darkness": false,
    "observer_mode": true
  },
  "random_actors": {
    "gol_cell": { "chance": 100, "min": 50, "max": 100 }
  }
}
```
