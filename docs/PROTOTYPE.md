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
| `depth` | number | Numeric identifier for the prototype's position in progression |
| `turn_speed` | number | Milliseconds per AI turn (lower = faster). Default `50`. |
| `loaded_sound` | string | Sound played when the prototype loads |
| `next_level` | string | Prototype folder name to advance to (via down stairway or gateway) |
| `previous_level` | string | Prototype folder name to return to (via up stairway from floor 1) |

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

See [LIGHTING.md](../LIGHTING.md) for the full lighting system reference.

### Viewport & Scrolling

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `viewport_width` | number | map width | Visible width in tiles. When smaller than the map, the camera scrolls to follow the player. |
| `viewport_height` | number | map height | Visible height in tiles. When smaller than the map, the camera scrolls to follow the player. |
| `ai_margin` | number | `5` | How many tiles beyond the viewport edge AI actors continue to take turns. Actors outside this margin skip their turn. Only applies when viewport scrolling is active; ignored (treated as infinite) when the full map is visible. |

### Special Modes

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `observer_mode` | boolean | `false` | Disable stairway and gateway placement. Use for spectator-only prototypes (e.g. cellular automata demos). |
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
| `rogue` | Classic roguelike grid rooms (no walls)|
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

See [ARCHITECT.md](ARCHITECT.md) for the full generator reference including cellular automata rules, room types, and wildcard processing.

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

---

## Win Conditions

`win_conditions` is an array of conditions that must all be met to unlock the floor's stairway or gateway.

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

Fields not specified in a floor object fall back to the prototype-level defaults.

### Floor Behavior

- **Stairways** move between floors (not prototypes). The engine auto-places `down_stairway` on every floor except the last.
- **Win conditions** are per-floor. Each floor's stairway is locked until its conditions are met.
- **Gateway** is auto-placed on the last floor when `next_level` is set. It starts hidden and appears when the last floor's win conditions are met.
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
- **Gateway** on the last floor of a multi-floor prototype transitions to `next_level` when win conditions are met

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
