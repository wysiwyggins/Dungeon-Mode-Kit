# Prototype System

A **prototype** is a defines a dungeon mode prototype. Each prototype lives in its own folder under `prototypes/` and is configured primarily through `prototype.json`.

```
prototypes/
  my_level/
    prototype.json          ← prototype rules (required)
    actors.json             ← actor overrides/additions (optional)
    items.json              ← item overrides/additions (optional)
    personalities.json      ← AI behavior overrides (optional)
    map.tmj                 ← authored Tiled map, floor 1 (optional)
    2.tmj, 3.tmj, ...      ← authored maps for floors 2+ (optional)
```

Prototype-specific data files are merged with the global `data/` files at load. You only need to define what's new or different for a given level.

Load a prototype by adding `?prototype=my_level` to the URL.

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

### Special Modes

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `observer_mode` | boolean | `false` | Disable stairway and portal placement. Use for spectator-only prototypes (e.g. cellular automata demos). |
| `treasure_room` | number | `0` | Percent chance (0-100) to spawn a treasure room on the level |

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

| Type | Description |
|------|-------------|
| `digger` | Rooms connected by corridors (default) |
| `cellular` | Cave-like organic shapes |
| `uniform` | Evenly distributed rooms |
| `rogue` | Classic roguelike grid rooms (no walls) |
| `brogue` | Brogue-style rooms (rectangle, cross, circular, cavern) attached via corridors and loops |
| `divided_maze` | Recursive division maze |
| `icey_maze` | Maze with regularity control |
| `eller_maze` | Perfect maze (Eller's algorithm) |
| `arena` | Simple empty rectangle |
| `infernal` | Cave with lava pools |

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

#### Brogue-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRooms` | number | auto | Maximum rooms to generate. Optional — when omitted, auto-computed from map size (`≈ map_width × map_height / 120`, clamped 8–120) so larger maps fill out. An explicit value overrides the auto default. Not exposed in the prototype editor. |
| `maxAttempts` | number | auto | Room-placement attempts (the practical cap on density, since many attempts fail to place). Optional — when omitted, auto-scaled to `≈ maxRooms × 4` (clamped 50–600) so it can reach the size-scaled room target. An explicit value overrides. Larger = denser. |
| `corridorChance` | number | `30` | Percent chance to add a corridor between rooms |
| `corridorLength` | `[min, max]` | `[2, 6]` | Corridor length range |
| `doorChance` | number | `50` | Percent chance to place a door at room connections |
| `torchChance` | number | `30` | Percent chance to place a torch in a room |
| `roomWeights` | object | `{ rectangle: 30, cross: 25, circular: 20, cavern: 25 }` | Relative weights for room types |
| `loopMinDistance` | number | `20` | Minimum path distance between rooms before a loop shortcut is added |
| `maxLoops` | number | `5` | Maximum loop connections to add |

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
      "switch_message": "You pull the lever. A gate grinds open."
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
| `switch_message` | string | Message shown when the switch is activated |

Can be set at the prototype level or per-floor.

### Item Pools (random_type)

Some item IDs in `items.json` are **pool entries** rather than real items. They contain a `random_type` array — when spawned, the engine picks a random member from the pool.

```json
"potion": {
  "random_type": ["health_potion", "poison_potion", "strength_potion", ...]
},
"weapon": {
  "random_type": ["sword", "dagger", "club", "warhammer", "axe", "rapier", "spear", "mace"]
},
"armor": {
  "random_type": ["leather_armor", "chainmail", "scale_mail", "plate", "helmet"]
}
```

Use pool IDs in `random_items` to spawn a random item from a category:

```json
"random_items": {
  "potion": { "chance": 60 },
  "weapon": { "chance": 30 },
  "armor": { "chance": 20 }
}
```

Built-in pools: `potion`, `scroll`, `staff`, `weapon`, `armor`. Prototypes can define their own pools in their `items.json`.

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
| `pool` | array | (Optional) Explicit list of item type IDs. If omitted, uses the `random_type` pool from items.json. |

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

Biomes are **opt-in and additive** — a prototype with no `biomes` behaves exactly as before.

### Top-level keys

| Key | Type | Description |
|-----|------|-------------|
| `floors` | number | Total floor count (use instead of a dense `levels` array when floors are biome-driven). |
| `biomes` | object | Map of biome name → biome definition (below). |
| `floor_plan` | array | Ordered `{ biome, floors }` assignments. `floors` is an inclusive range (`"1-8"`), a single number, or `[lo, hi]`. Ranges should tile `1..floors` without gaps. |

```json
{
  "floors": 26,
  "biomes": { "caves": { ... }, "crypt": { ... } },
  "floor_plan": [
    { "biome": "caves", "floors": "1-8" },
    { "biome": "crypt", "floors": "9-26" }
  ]
}
```

### Biome definition

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
  "next_level": "catacombs"
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

Prototype-specific entries with the same key as a global entry replace the global version for that level. See [ACTORS.md](ACTORS.md) and [ITEMS.md](ITEMS.md) for the data formats.

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
