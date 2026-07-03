# Making Maps

A guide to building levels in [Tiled](https://www.mapeditor.org/) for Dungeon Mode Kit.

---

## Getting Started

1. Download and install [Tiled](https://www.mapeditor.org/)
2. Open the project file: `tiled/dungeonkit.tiled-project` — the tileset loads automatically
3. Floor 1 maps must be saved as `map.tmj` inside `prototypes/{name}/`. For multi-floor prototypes, floor N>1 uses `{N}.tmj` (e.g. `2.tmj`, `3.tmj`). Missing floor maps are generated procedurally.

### Copying an Existing Map

The fastest way to start. Good starter templates:

- `prototypes/arena/` — simplest hand-built map
- `prototypes/catacombs/` — wildcard-based procedural map

Steps:

1. Copy the prototype folder and rename it
2. Open the `map.tmj` in Tiled and edit it
3. Update `prototype.json` with a new name, description, etc.

### Creating a Map from Scratch

1. **File > New Map**: Orthogonal, CSV encoding, tile size 40×30 px, set your desired width/height in tiles
2. **Add the tileset**: Map > Add External Tileset → select `tiled/static-tiles.tsj`
3. **Create the 6 layers** listed below (names must be exact)
4. **Save as** `prototypes/your_level/map.tmj`
5. You also need a `prototype.json` in the same folder — see [PROTOTYPE.md](PROTOTYPE.md) for all fields

---

## The Six Layers

Create these layers in Tiled from bottom to top:

| Layer | Type | Purpose |
|-------|------|---------|
| `background` | Tile | Void/decoration behind everything |
| `floor` | Tile | Walkable terrain — any non-zero tile here is walkable |
| `wildcards` | Tile | Procedural generation markers (see next section) |
| `actors` | Object | Spawn points for actors |
| `items` | Object | Spawn points for items |
| `landmarks` | Object | Walk-over decorations |

Some existing maps include a `ui` tile layer — the engine ignores it completely. You can omit it.

### Layer Details

**background** — Fill entirely with ![FULL_BLOCK](../assets/images/FULL_BLOCK.png) `FULL_BLOCK` (tile 217, solid black). The engine clears background behind floor tiles automatically, so this just fills the void. You can also paint other decorative tiles here for effect.

**floor** — Paint walkable areas. ![FLOOR](../assets/images/FLOOR.png) `FLOOR` (tile 158) is the standard floor tile, but any tiles can be used for decorative effect. Leave cells empty (null or tile 0) for impassable void.

**wildcards** — Paint regions that the engine fills with procedural content at runtime. See [Wildcard Tiles](#wildcard-tiles-generative-fills) below.

**actors** — Place point objects. Set each object's `type` to an actor ID from `data/actors.json` (e.g. `player`, `skeleton`, `down_stairway`). The `player` actor must appear here.

**items** — Place point objects. Set each object's `type` to an item ID from `data/items.json` (e.g. `torch`, `sword`, `crown`).

**landmarks** — Place point objects for walk-over decorations:

| Tiled Field | Purpose |
|-------------|---------|
| `type` / `class` | Tile name from `data/static-tiles.json` (e.g. `SKULL`) |
| `name` | Optional display name |
| `walk_description` (custom property) | Message shown when the player steps on it |
| `tint` (custom property) | Hex color string (e.g. `#FF8800`) |

[What are Tiled Objects?](https://doc.mapeditor.org/en/stable/manual/objects/) — Objects are regions drawn with a shape tool, with attributes like `class`. The `wildcards` tile layer supplements this by letting you paint tiles that spawn common actors and mark off procedurally generated areas.

### Per-Object Property Overrides (actors layer)

By default an actor object inherits everything from its type definition in `data/actors.json` (or a prototype's `actors.json` override). You can also set **custom properties** on an individual actor object to override or augment that one placement, without defining a new actor type. Recognized properties:

| Custom Property | Type | Purpose |
|-----------------|------|---------|
| `machine_id` | string | Link this actor to switches/targets sharing the same id (see [PROTOTYPE.md](PROTOTYPE.md) switches). |
| `switch_effects` | string (JSON) | Override the attributes a switch sets on activation, e.g. `{"locked": false, "open": true}`. |
| `switch_radius` | number | Override the proximity radius a switch activates within (when not using `machine_id`). |
| `one_shot` | bool | Mark a switch/trap as single-use. |
| `default_items` | string | Override the actor type's starting inventory **for this placement only**. |

**`default_items` override.** An actor's `default_items` (the items it spawns holding — see [ACTORS.md](ACTORS.md#default-items)) normally comes from the shared type definition. For example, the global `pedestal` defines `"default_items": ["key"]`, so *every* pedestal holds a key. To make one specific pedestal hold something else, set a `default_items` custom property on that object. Accepted formats:

- JSON array: `["crown"]` or `["crown", "torch"]`
- Comma-separated list: `crown, torch`
- Empty string: holds nothing (clears the type default)

The pedestal's `display_inventory` attribute renders whatever it holds on top of it, so a pedestal with `default_items` = `["crown"]` displays and guards a crown instead of a key. This override applies before the item is created, so key/door color pairing still resolves correctly.

---

## Wildcard Tiles (Generative Fills)

Paint a region on the `wildcards` layer and the engine fills it with procedural content at runtime. The painted region defines the boundary — hand-painted floor tiles outside the region are preserved.

### Generator Reference

| Generator | Tile | Tile ID | What It Creates |
|-----------|------|---------|-----------------|
| Dungeon | ![PRISON_WINDOW](../assets/images/PRISON_WINDOW.png) | 16 | Walled rooms + corridors + doors |
| Cave | ![INVERSE_BULLET](../assets/images/INVERSE_BULLET.png) | 10 | Organic cave shapes |
| Infernal | ![OPAQUE_LIGHT_SHADE_UPPER_RIGHT_TRIANGLE_AND_OPAQUE_DARK_SHADE_BOTTOM_LEFT_TRIANGLE](../assets/images/OPAQUE_LIGHT_SHADE_UPPER_RIGHT_TRIANGLE_AND_OPAQUE_DARK_SHADE_BOTTOM_LEFT_TRIANGLE.png) | 230 | Cave + lava pools |
| Maze | ![DESERET_CAPITAL_LETTER_ES](../assets/images/DESERET_CAPITAL_LETTER_ES.png) | 210 | Perfect maze corridors |
| Room | ![INVERTED_CHECKER_BOARD](../assets/images/INVERTED_CHECKER_BOARD.png) | 143 | Single walled room |
| Item spawn | ![BLACK_KEY](../assets/images/BLACK_KEY.png) | 12 | Random items from `random_items` config |
| Actor spawn | ![OPAQUE_WHITE_SMILING_FACE](../assets/images/OPAQUE_WHITE_SMILING_FACE.png) | 3 | Random actors from `random_actors` config |

Tile 16 (`PRISON_WINDOW`) is the recommended dungeon wildcard. Tiles 9 (`OPAQUE_INVERSE_DIAMOND_SUITE`) and 152 (`OPAQUE_PRISON_WINDOW`) also work — all three generate the same dungeon layout. Tile 144 (`CHECKER_BOARD`) is an alternate room tile. There's also an `abyss` generator (tile 218) — see the full list below.

See **[TILED_KEY.md](TILED_KEY.md)** ([printable PDF](TILED_KEY.pdf)) for the complete, authoritative list of generator and actor wildcard tiles.

### Tips

- Paint a large contiguous region for best results
- You can combine multiple wildcard types on the same map
- Hand-painted floor tiles are preserved — wildcards only fill their own region
- See `prototypes/catacombs/map.tmj` (dungeon) and `prototypes/mine/map.tmj` (cave) for examples

---

## Painting Actors on the Wildcards Layer

Some actors have a `paint_tile` attribute — paint their tile on the `wildcards` layer to spawn them in bulk. This is how you draw walls, water, and lava by hand. The common ones are below; see **[TILED_KEY.md](TILED_KEY.md)** ([printable PDF](TILED_KEY.pdf)) for the complete, authoritative list (trees, fungus, quicksand, and more).

| Actor | Tile | Tile ID | Tile Name | Use For |
|-------|------|---------|-----------|---------|
| `wall` | ![WALL_TOP](../assets/images/WALL_TOP.png) | 132 | `WALL_TOP` | Standard walls |
| `rock_wall` | ![DARK_SHADE](../assets/images/DARK_SHADE.png) | 178 | `DARK_SHADE` | Natural rock walls |
| `wall-bottom-left-corner` | ![LIGHT_SHADE_UPPER_RIGHT_TRIANGLE](../assets/images/LIGHT_SHADE_UPPER_RIGHT_TRIANGLE.png) | 156 | `LIGHT_SHADE_UPPER_RIGHT_TRIANGLE` | Wall corners |
| `wall-bottom-right-corner` | ![LIGHT_SHADE_UPPER_LEFT_TRIANGLE](../assets/images/LIGHT_SHADE_UPPER_LEFT_TRIANGLE.png) | 155 | `LIGHT_SHADE_UPPER_LEFT_TRIANGLE` | Wall corners |
| `wall-top-right-corner` | ![LIGHT_SHADE_LOWER_LEFT_TRIANGLE](../assets/images/LIGHT_SHADE_LOWER_LEFT_TRIANGLE.png) | 134 | `LIGHT_SHADE_LOWER_LEFT_TRIANGLE` | Wall corners |
| `wall-top-left-corner` | ![LIGHT_SHADE_LOWER_RIGHT_TRIANGLE](../assets/images/LIGHT_SHADE_LOWER_RIGHT_TRIANGLE.png) | 157 | `LIGHT_SHADE_LOWER_RIGHT_TRIANGLE` | Wall corners |
| `water` | ![WATER](../assets/images/WATER.png) | 389 | `WATER` | Water terrain |
| `sewage` | ![OPAQUE_DOTTED_LIGHT_SHADE](../assets/images/OPAQUE_DOTTED_LIGHT_SHADE.png) | 135 | `OPAQUE_DOTTED_LIGHT_SHADE` | Toxic water |
| `lava` | ![DOUBLE_EXCLAMATION_MARK](../assets/images/DOUBLE_EXCLAMATION_MARK.png) | 20 | `DOUBLE_EXCLAMATION_MARK` | Damaging magma |
| `fire` | ![BLACK_DIAMOND_SUITE](../assets/images/BLACK_DIAMOND_SUITE.png) | 5 | `BLACK_DIAMOND_SUITE` | Spreading fire |

Deep water and deep sewage are spawned automatically by the engine wherever large contiguous regions of `water` or `sewage` exist — you don't need a separate wildcard for them.

---

## Map Size and Scrolling

- **Map dimensions**: set in Tiled via Map > Map Properties as width/height in tiles
- **Viewport**: set in `prototype.json` under `mechanics.viewport_width` / `mechanics.viewport_height`
- When viewport < map size → the camera scrolls to follow the player
- When viewport >= map size (or unset) → the entire map is visible with no scrolling
- For procedural-only maps (no .tmj), set `map_generator.options.map_width` / `map_height` in prototype.json

Example:

```json
"mechanics": {
  "viewport_width": 30,
  "viewport_height": 30
}
```

---

## Connecting Levels with Stairways

### Transition Actors

| Actor | Purpose |
|-------|---------|
| `down_stairway` | Descent point — goes to next floor or next prototype |
| `up_stairway` | Ascent point — goes to previous floor or previous prototype |
| `locked_down_stairway` | Sealed until `win_conditions` are met |
| `locked_up_stairway` | Sealed until `win_conditions` are met |
| `portal` | Hidden inter-prototype transition — revealed when last floor's win conditions are met |

Place stairway actors on the `actors` object layer. If you don't place one, the engine auto-places it on a random walkable tile.

### Single-level prototypes (legacy)

Link prototypes together using `next_level` and `previous_level` in `prototype.json`:

```json
{
  "next_level": "catacombs",
  "previous_level": "default"
}
```

Stairways transition directly between prototypes. Level A sets `"next_level": "level_b"`, Level B sets `"previous_level": "level_a"`. The player enters at the matching stairway direction.

### Multi-level prototypes

Add a `levels` array to `prototype.json` to create multiple floors within one prototype:

```json
{
  "next_level": "caverns",
  "levels": [
    { "win_conditions": ["killed:skeleton"], "random_actors": { "skeleton": { "chance": 80, "min": 2, "max": 4 } } },
    { "win_conditions": [], "random_actors": { "ghast": { "chance": 100, "min": 1, "max": 1 } } }
  ]
}
```

Behavior:

- **Stairways** move between floors (not prototypes). The engine auto-places `down_stairway` on every floor except the last.
- **Win conditions** are per-floor — each floor's `win_conditions` must be met to unlock that floor's stairway/portal.
- **portal** is auto-placed on the **last floor** when `next_level` is set. It starts hidden and appears when the last floor's win conditions are met. Stepping on the portal transitions to `next_level`.
- **Going up from floor 1** transitions to `previous_level` (if set).
- **Map files**: floor 1 uses `map.tmj`, floor 2 uses `2.tmj`, etc. Missing maps are procedurally generated using the floor's `map_generator` (or the prototype-level default).
- **Floor state** is saved when leaving a floor and restored when returning — entities, map, and RNG state persist.

---

## Tips

- **Layer names must be exact** — the engine matches on strings
- **Floor 1 map must be named `map.tmj`**. Additional floors use `2.tmj`, `3.tmj`, etc.
- If both `map.tmj` and `map_generator` exist in a prototype, the .tmj takes priority
- Serve locally with `python3 -m http.server`, then load with `?prototype=your_level`
- If a stairway appears in an unexpected spot, you probably forgot to place one — the engine auto-places a missing `up_stairway`
- Any actor with a `paint_tile` attribute can be painted on the wildcards layer — check `data/actors.json` for the full list
