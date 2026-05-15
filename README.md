# Dungeon Mode Kit

A web-based roguelike toolkit. Build levels by editing JSON files and drawing maps in Tiled.

**[Design Notes & Vision](/DUNGEON_MODE_KIT_DESIGN.md)**

---

## Setup

After cloning, install the required libraries:

    ./setup.sh

This downloads JavaScript libraries into `lib/` (gitignored).

---

## Quick Start

1. Serve the project locally (required for file loading — `python3 -m http.server` or any static server like VSCode's "Go Live")
2. Open `index.html` in a browser
3. Add `?prototype=name` to the URL to load a specific level (e.g. `index.html?prototype=labyrinth`)
4. Edit maps in Tiled: open `tiled/dungeonkit.tiled-project`

---

## Project Layout

```
prototypes/           ← one folder per level
  my_level/
    prototype.json    ← level rules (required)
    actors.json       ← actor overrides/additions for this level
    items.json        ← item overrides/additions for this level
    map.tmj           ← authored Tiled map (optional)
data/                 ← global definitions shared across all levels
  actors.json         ← actor templates
  items.json          ← item templates
  personalities.json  ← AI behavior definitions
  static-tiles.json   ← full tile name reference
tiled/
  dungeonkit.tiled-project
  static-tiles.tsj    ← tileset file for Tiled
```

Prototype JSON files are merged with global `data/` files at load — you only need to define what's new or different for a given level.

---

## Creating a Level

Create a folder under `prototypes/your_level_name/`. The only required file is `prototype.json`.

### prototype.json fields

| Field | Description | Example |
|-------|-------------|---------|
| `name` | Display name | `"The Mines"` |
| `description` | Shown on level load | `"Dark tunnels ahead."` |
| `levels` | Array of per-floor config objects (enables multi-floor prototype) | `[{...}, {...}]` |
| `turn_speed` | MS per AI turn (lower = faster) | `50` |
| `loaded_sound` | Sound played on load | `"levelout"` |
| `previous_level` | Level name to return to | `"default"` |
| `next_level` | Level name to advance to | `"catacombs"` |
| `mechanics.fog_of_war` | Remember explored tiles | `true` |
| `mechanics.darkness` | Enable dynamic lighting | `true` |
| `mechanics.ambient_light` | Minimum light level 0–1 | `0.1` |
| `mechanics.player_light_radius` | Radius of player's auto-light (when `player_auto_light` is true) | `6` |
| `mechanics.player_auto_light` | Auto-illuminate the player in darkness (default `true`; set `false` to require a carried light source) | `false` |
| `random_actors` | Randomly spawned actors on load | `{"skeleton": {"chance": 60, "min": 1, "max": 3}}` |
| `random_items` | Randomly spawned items on load | `{"sword": {"chance": 100}}` |
| `win_conditions` | Array of win condition strings | `["killed:minotaur", "wearing:crown"]` |

Win condition formats:

| Format | When met |
|--------|----------|
| `"killed:actor_type"` | All living actors of that type are dead |
| `"wearing:item_id"` | Player has that item equipped |
| `"holding:item_id"` | Player has that item in inventory |
| `{ "actor": "player", "stat": "weight", "op": ">", "value": 10 }` | Actor's stat or attribute meets the comparison |

Object condition fields: `actor` (`"player"` or an actor type), `stat` (stat or attribute name), `op` (`">"`, `">="`, `"<"`, `"<="`, `"=="`, `"!="`), `value` (number).

For procedural map generation (when no `map.tmj` exists), add a `map_generator` block — see [ARCHITECT.md](ARCHITECT.md).

### Example prototype.json

```json
{
  "name": "The Mines",
  "description": "Something moves in the dark.\nFind the exit.",
  "depth": 2,
  "turn_speed": 50,
  "previous_level": "default",
  "next_level": "catacombs",
  "mechanics": {
    "fog_of_war": true,
    "darkness": true,
    "ambient_light": 0.05,
    "player_auto_light": false
  },
  "random_actors": {
    "skeleton": { "chance": 80, "min": 2, "max": 4 }
  },
  "random_items": {
    "torch": { "chance": 100, "min": 1, "max": 2 }
  },
  "win_conditions": ["killed:skeleton"]
}
```

### Multi-level prototype.json

Add a `levels` array to create a prototype with multiple floors. Each floor can override `win_conditions`, `random_actors`, `random_items`, and `map_generator`. Fields not specified on a floor fall back to the prototype-level defaults.

```json
{
  "name": "The Depths",
  "description": "Three floors of danger.",
  "next_level": "caverns",
  "previous_level": "default",
  "mechanics": { "darkness": true, "fog_of_war": true },
  "levels": [
    {
      "win_conditions": ["killed:skeleton"],
      "random_actors": { "skeleton": { "chance": 80, "min": 2, "max": 4 } }
    },
    {
      "win_conditions": ["killed:ghast"],
      "random_actors": { "ghast": { "chance": 100, "min": 1, "max": 2 } },
      "map_generator": { "type": "cellular", "options": {} }
    },
    {
      "win_conditions": [],
      "random_actors": { "basilisk": { "chance": 100, "min": 1, "max": 1 } }
    }
  ]
}
```

Stairways move between floors within the prototype. On the last floor, a hidden **portal** actor appears when win conditions are met and transitions to `next_level`. If `levels` is omitted, the prototype works as a single-level (legacy behavior).

Floor maps: floor 1 uses `map.tmj`, floor N>1 uses `{N}.tmj` (e.g. `2.tmj`). Missing maps are generated procedurally.

---

## Making Maps in Tiled

Open `tiled/dungeonkit.tiled-project` — the tileset loads automatically. Match existing maps: 40×40 tiles at 16×16 px. Save as `map.tmj` inside your prototype folder.

### Layer names (must match exactly)

| Layer | Type | Purpose |
|-------|------|---------|
| `background` | Tile Layer | Walls, shadows, decoration behind floor |
| `floor` | Tile Layer | Walkable tiles — determines where actors can move |
| `wildcards` | Tile Layer | Procedural generation markers |
| `actors` | Object Layer | Actor spawn points — set `type` to actor ID |
| `items` | Object Layer | Item spawn points — set `type` to item ID |
| `landmarks` | Object Layer | Inline decorations with walk-over descriptions |

### Wildcard tiles

Paint these in the `wildcards` layer to generate procedural content in that region. Tile IDs are 1-indexed in Tiled.

| Tile ID | Generates |
|---------|-----------|
| 210 | Perfect maze corridors |
| 9, 16, 152 | Rooms + corridors + doors |
| 10 | Organic cave shapes |
| 11 | Cave with lava pools |
| 143, 144 | Single walled room |

**Custom actor wildcards:** Give an actor a `paint_tile` attribute set to a tile name from `static-tiles.json`, then paint that tile in the wildcards layer — the actor spawns at each matching tile position.

### Landmarks layer

The `landmarks` layer lets you add decorative tiles with walk-over descriptions directly in Tiled, without defining them in any JSON file.

| Tiled Field | Purpose |
|-------------|---------|
| `type` / `class` | Tile name from `static-tiles.json` (e.g. `SKULL`, `IMPERFECT_DOTTED_LIGHT_SHADE`) |
| `name` | Optional display name |
| `walk_description` (custom prop) | Message shown when player steps on the tile |
| `tint` (custom prop) | Hex color string (e.g. `#FF8800`) |

---

## Defining Actors

Global templates live in `data/actors.json`. Level-specific additions or overrides go in `prototypes/your_level/actors.json` (same format — merged at load).

Place actors on the map via the `actors` object layer in Tiled (set object `type` to the actor ID), or use `random_actors` in `prototype.json` to scatter them randomly on walkable tiles.

### Key actor fields

| Field | Purpose |
|-------|---------|
| `name` | Display name |
| `tileIndexBase` | Bottom tile name (from `static-tiles.json`) |
| `tileIndexTop` | Top tile name |
| `tint` | Hex color tint |
| `personality` | AI behavior name from `personalities.json` |
| `collision_effect` | Effect applied when another actor walks into this one — values can be numbers (`-10`) or attribute references (`"-{strength}"`) |
| `collision_sound` | Sound played on collision |
| `death_sound` | Sound played on death |
| `stats` | Numeric values: `health`, `nutrition`, etc. |
| `attributes` | Boolean flags and config values |
| `default_items` | Array of item IDs the actor spawns carrying |

Collision effect values can reference the attacker's stats/attributes: `"-{strength}"` deals damage equal to the attacker's strength, `"{strength}"` heals by it. See [COMBAT.md](COMBAT.md) for full details.

### Existing attributes

| Attribute | Effect |
|-----------|--------|
| `solid: true` | Blocks movement |
| `hostile: true` | AI attacks the player on sight |
| `controlled: true` | Player-controlled |
| `light_source: true` | Emits light (tint = light color) |
| `remains: "actor_id"` | Actor type spawned when this actor dies |
| `inventory: N` | Max items this actor can carry |
| `accuracy` | Hit chance percentage (combat) |
| `defense` | Reduces attacker hit chance (combat) |
| `strength` | Multiplies weapon damage ÷ 10 (combat) |
| `sighted: true` | AI avoids hazards like fire and lava |
| `deep: true` | Submerges any actor that enters this tile (canvas tints, sprite swaps to show submersion); extinguishes carried torches |
| `portal: true` | Hidden inter-prototype transition point; revealed when last floor's win conditions are met |
| `hidden: true` | Actor exists but is not rendered until revealed |

### Stats format

Simple: `"health": 30` expands to `{ max: 30, current: 30 }`.

Extended format for per-turn changes and warnings:

```json
"stats": {
  "health": 30,
  "nutrition": {
    "max": 100,
    "per_turn": -1,
    "fatal": true,
    "death_message": "You starve to death!",
    "warnings": [
      { "threshold": 0.25, "message": "You are very hungry." }
    ]
  }
}
```

See [COMBAT.md](COMBAT.md) for full combat stat documentation.

---

## Defining Items

Global templates live in `data/items.json`. Level overrides go in `prototypes/your_level/items.json`.

Place items via the `items` object layer in Tiled, or use `random_items` in `prototype.json`.

See **[ITEMS.md](ITEMS.md)** for the full attribute reference. Quick summary:

| Attribute | Effect |
|-----------|--------|
| `pickupable: true` | Can be picked up |
| `wearable: "top"\|"middle"\|"lower"` | Equipment slot |
| `wear_effect: { "defense": 5 }` | Stat bonus while equipped |
| `collision_effect: { "health": -10 }` | Damage dealt when holder bumps a target |
| `weapon: true` | Marks as weapon (also `"knockback"`, `"lifesteal"`, `"critical"`) |
| `consumable: true` | Removed from inventory after use |
| `light_source: true` | Emits light when carried; uses item `tint` as light color |
| `lightRadius: N` | Light radius in tiles when carried (default 5) |
| `burns_out_item: "id"` | Item type to replace this item with when its `burns` stat hits 0 |
| `burnout_message: "..."` | Message shown to player when the item burns out |

### Item stats

Items support the same stat format as actors. Additional fields specific to items:

| Stat field | Effect |
| ---------- | ------ |
| `per_turn: -1` | Decrements the stat by 1 each turn (positive values recharge) |
| `display_label: "Fuel"` | Shows this stat in the inventory UI as `"Fuel: current/max"` with a bar |
| `warnings: [{threshold, message}]` | Shows a message when the stat drops below `threshold * max` (e.g. `0.1` = 10%) |
| `ready_at: N` | Used with `charge_stat` for usable items — minimum value needed to fire |
| `ready_message: "..."` | Message shown when a recharging item becomes ready |

A stat with `display_label` shows in inventory automatically. Items without `charge_stat` or any stat with `display_label` show no stat bar.

Example — a torch that burns out into an unlit version:

```json
"torch": {
  "name": "Torch",
  "tileIndex": "BOX_VERTICAL_INVERSE_TOP",
  "tint": "#EC7505",
  "attributes": {
    "pickupable": true,
    "light_source": true,
    "lightRadius": 6,
    "burns_out_item": "torch_unlit",
    "burnout_message": "Your torch burns out."
  },
  "stats": {
    "burns": {
      "max": 500,
      "per_turn": -1,
      "display_label": "Fuel",
      "warnings": [{ "threshold": 0.1, "message": "Your torch is almost out!" }]
    }
  }
}
```

---

## Personalities & Behaviors

All personalities are defined in `data/personalities.json`. Assign one to an actor with `"personality": "name"`.

Built-in behaviors you can reference in custom personalities:

- `patrol`, `random_walk` — basic movement
- `pursue_target`, `attack_adjacent` — combat AI
- `lava_behavior`, `fire_behavior` — environmental hazards (spread, ignition)
- `liquid_pooling`, `deep_water_behavior` — fluid cellular automata
- `cloud_behavior`, `mist_behavior` — gas clouds that spread and apply effects
- `trap_behavior` — hidden Brogue-style traps

---

## Lighting & Darkness

Enable in `prototype.json`:

```json
"mechanics": {
  "darkness": true,
  "fog_of_war": true,
  "ambient_light": 0.1,
  "player_light_radius": 6
}
```

Give any actor `"light_source": true` to make it emit light. The light color comes from the actor's `tint`. See **[LIGHTING.md](LIGHTING.md)** for full configuration details.

---

## Tile Names

All tile names are in `data/static-tiles.json` (and `tiled/static-tiles.tsj` for use inside Tiled). Names are Unicode character names: `SKULL`, `CROWN`, `LATIN_CAPITAL_LETTER_T`, etc.

Use these exact strings in:

- `tileIndexBase` and `tileIndexTop` on actors
- `tileIndex` on items
- `type`/`class` on landmark objects in Tiled

---

## Reference Docs

- [MAP.md](docs/MAP.md) — Designer's guide to making maps in Tiled
- [ITEMS.md](ITEMS.md) — Full item attribute reference, use effects, equipment
- [COMBAT.md](COMBAT.md) — Hit/damage math, weapon types, equipment slots
- [LIGHTING.md](LIGHTING.md) — Darkness, fog of war, light source configuration
- [ARCHITECT.md](ARCHITECT.md) — Procedural generation options, wildcard system
- [CHANGELOG.md](CHANGELOG.md) — Version history

---

See [LICENSE.txt](LICENSE.txt) for license info.
