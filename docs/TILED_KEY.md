# Wildcard Tiles

A complete reference for the tiles you paint on the `wildcards` layer in [Tiled](https://www.mapeditor.org/) — which tile spawns which actor, and which tiles trigger procedural generators. For the full map-editing workflow, see [MAP.md](MAP.md).

> **Printable version:** [TILED_KEY.pdf](TILED_KEY.pdf) is a laid-out, single-file visual key of the same content (dark background so white-pixel tiles stay visible). Regenerate it with `/Users/wileywiggins/Development/libuse/tiledKey.py` (see [Regenerating tile images](#regenerating-tile-images)).

---

## How It Works

Paint a tile on the `wildcards` tile layer and the engine resolves it at runtime to one of two things:

- **An actor** — if the tile matches an actor's `paint_tile` attribute in `data/actors.json`, that actor is spawned across the painted region. This is how walls, water, lava, and other terrain are drawn in bulk.
- **A procedural generator** — a handful of tiles are hardcoded generator markers (dungeon, cave, maze, etc.); the engine fills the painted region with generated content.

Tiles are identified by a numeric **tile ID**. For a tile at column `col`, row `row` in the tileset (23 columns wide), the ID is:

```
tileId = row * 23 + col + 1
```

This matches the gid Tiled stores in the `wildcards` layer. Actor matching happens in `architect.js` (`getActorWildcardType` → `getTileIdByName`); builtin generators live in `architect.js` `builtinWildcards`. The name→coordinate table is `data/static-tiles.json`.

---

## Actor Wildcard Tiles

Each actor below defines a `paint_tile` in `data/actors.json`. Paint that tile on the `wildcards` layer to spawn the actor in bulk.

### Walls & Corners

| Actor | Tile | Tile ID | Tile Name | Use For |
|-------|------|---------|-----------|---------|
| `wall` | ![WALL_TOP](../assets/images/WALL_TOP.png) | 132 | `WALL_TOP` | Standard walls |
| `brick_wall` | ![BRICK_WALL](../assets/images/BRICK_WALL.png) | 255 | `BRICK_WALL` | Masonry walls |
| `rock_wall` | ![DARK_SHADE](../assets/images/DARK_SHADE.png) | 178 | `DARK_SHADE` | Natural rock walls (mineable) |
| `fortification` | ![BALLOT_BOX](../assets/images/BALLOT_BOX.png) | 249 | `BALLOT_BOX` | See-through battlements |
| `wall-bottom-left-corner` | ![LIGHT_SHADE_UPPER_RIGHT_TRIANGLE](../assets/images/LIGHT_SHADE_UPPER_RIGHT_TRIANGLE.png) | 156 | `LIGHT_SHADE_UPPER_RIGHT_TRIANGLE` | Wall corners |
| `wall-bottom-right-corner` | ![LIGHT_SHADE_UPPER_LEFT_TRIANGLE](../assets/images/LIGHT_SHADE_UPPER_LEFT_TRIANGLE.png) | 155 | `LIGHT_SHADE_UPPER_LEFT_TRIANGLE` | Wall corners |
| `wall-top-right-corner` | ![LIGHT_SHADE_LOWER_LEFT_TRIANGLE](../assets/images/LIGHT_SHADE_LOWER_LEFT_TRIANGLE.png) | 134 | `LIGHT_SHADE_LOWER_LEFT_TRIANGLE` | Wall corners |
| `wall-top-left-corner` | ![LIGHT_SHADE_LOWER_RIGHT_TRIANGLE](../assets/images/LIGHT_SHADE_LOWER_RIGHT_TRIANGLE.png) | 157 | `LIGHT_SHADE_LOWER_RIGHT_TRIANGLE` | Wall corners |

### Terrain & Liquids

| Actor | Tile | Tile ID | Tile Name | Use For |
|-------|------|---------|-----------|---------|
| `water` | ![WATER](../assets/images/WATER.png) | 389 | `WATER` | Water terrain |
| `sewage` | ![OPAQUE_DOTTED_LIGHT_SHADE](../assets/images/OPAQUE_DOTTED_LIGHT_SHADE.png) | 135 | `OPAQUE_DOTTED_LIGHT_SHADE` | Toxic water |
| `lava` | ![DOUBLE_EXCLAMATION_MARK](../assets/images/DOUBLE_EXCLAMATION_MARK.png) | 20 | `DOUBLE_EXCLAMATION_MARK` | Damaging magma |
| `quicksand` | ![MEDIUM_SHADE_LOWER_ONE_HALF_BLOCK](../assets/images/MEDIUM_SHADE_LOWER_ONE_HALF_BLOCK.png) | 167 | `MEDIUM_SHADE_LOWER_ONE_HALF_BLOCK` | Sinking pits |
| `tree` | ![UPWARD_POINTING_TRIANGLE](../assets/images/UPWARD_POINTING_TRIANGLE.png) | 31 | `UPWARD_POINTING_TRIANGLE` | Trees (flammable) |
| `fungus` | ![BLACK_SPADE_SUITE](../assets/images/BLACK_SPADE_SUITE.png) | 7 | `BLACK_SPADE_SUITE` | Glowing fungus |

Deep water and deep sewage are spawned automatically wherever large contiguous regions of `water` or `sewage` exist — you don't need a separate wildcard for them.

### Hazards

| Actor | Tile | Tile ID | Tile Name | Use For |
|-------|------|---------|-----------|---------|
| `fire` | ![BLACK_DIAMOND_SUITE](../assets/images/BLACK_DIAMOND_SUITE.png) | 5 | `BLACK_DIAMOND_SUITE` | Spreading fire |
| `collapsing_floor` | ![DOWNWARDS_ARROW](../assets/images/DOWNWARDS_ARROW.png) | 47 | `DOWNWARDS_ARROW` | Floor that collapses when stepped on |

---

## Generator Wildcard Tiles

These tiles are hardcoded generator markers. Paint a contiguous region and the engine fills it with procedural content — the painted region defines the boundary, and hand-painted floor tiles outside it are preserved.

| Generator | Tile | Tile ID | Tile Name | What It Creates |
|-----------|------|---------|-----------|-----------------|
| Dungeon | ![PRISON_WINDOW](../assets/images/PRISON_WINDOW.png) | 16 | `PRISON_WINDOW` | Walled rooms + corridors + doors |
| Cave | ![INVERSE_BULLET](../assets/images/INVERSE_BULLET.png) | 10 | `INVERSE_BULLET` | Organic cave shapes |
| Infernal | ![OPAQUE_LIGHT_SHADE_UPPER_RIGHT_TRIANGLE_AND_OPAQUE_DARK_SHADE_BOTTOM_LEFT_TRIANGLE](../assets/images/OPAQUE_LIGHT_SHADE_UPPER_RIGHT_TRIANGLE_AND_OPAQUE_DARK_SHADE_BOTTOM_LEFT_TRIANGLE.png) | 230 | `OPAQUE_LIGHT_SHADE_UPPER_RIGHT_TRIANGLE_AND_OPAQUE_DARK_SHADE_BOTTOM_LEFT_TRIANGLE` | Cave + lava pools |
| Maze | ![DESERET_CAPITAL_LETTER_ES](../assets/images/DESERET_CAPITAL_LETTER_ES.png) | 210 | `DESERET_CAPITAL_LETTER_ES` | Perfect maze corridors |
| Room | ![INVERTED_CHECKER_BOARD](../assets/images/INVERTED_CHECKER_BOARD.png) | 143 | `INVERTED_CHECKER_BOARD` | Single walled room |
| Abyss | ![LOWER_ONE_HALF_BLOCK](../assets/images/LOWER_ONE_HALF_BLOCK.png) | 218 | `LOWER_ONE_HALF_BLOCK` | Bottomless void |
| Item spawn | ![BLACK_KEY](../assets/images/BLACK_KEY.png) | 12 | `BLACK_KEY` | Random items from `random_items` config |
| Actor spawn | ![OPAQUE_WHITE_SMILING_FACE](../assets/images/OPAQUE_WHITE_SMILING_FACE.png) | 3 | `OPAQUE_WHITE_SMILING_FACE` | Random actors from `random_actors` config |

Tile 16 (`PRISON_WINDOW`) is the recommended dungeon wildcard. Tiles 9 (`OPAQUE_INVERSE_DIAMOND_SUITE`) and 152 (`OPAQUE_PRISON_WINDOW`) also generate the same dungeon layout. Tile 144 (`CHECKER_BOARD`) is an alternate room tile.

---

## Regenerating Tile Images

The per-tile images above are generated from the spritesheet, not committed to git. If `assets/images/` is missing or a tile image doesn't render, regenerate them:

```
python3 scripts/slice-tiles.py
```

This slices `assets/sprites/static-tiles.png` into `assets/images/<TILE_NAME>.png` using the coordinates in `data/static-tiles.json` (requires Python + Pillow).

---

## Keeping This Doc Current

The data here is derived from three sources — re-derive if any of them change:

- `data/actors.json` — the `attributes.paint_tile` on each actor
- `data/static-tiles.json` — the tile name → `[col, row]` table
- `architect.js` — the `builtinWildcards` generator map in `getWildcardType`
