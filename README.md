# Dungeon Mode Kit

A web-based roguelike toolkit. Build levels by editing JSON files and drawing maps in Tiled.

**[Design Notes & Vision](docs/DUNGEON_MODE_KIT_DESIGN.md)**

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
data/             <- default data files shared across prototypes   

prototypes/           
  my_level/           <- your data files add to or override the ones in data/
    prototype.json    <- level rules (required)
    actors.json       <- actor overrides/additions for this level
    items.json        <- item overrides/additions for this level
    map.tmj           <- authored Tiled map for level 1 (optional)
    2.tmj             <- an authored Tiled map for level 2 (or whatever numbered level optional) 

```

Prototype JSON files are merged with global `data/` files at load — you only need to define what's new or different for a given level.

---

## Reference Docs

- [PROTOTYPE.md](docs/PROTOTYPE.md) — Full prototype config reference, map generation, item catalogs
- [MAP.md](docs/MAP.md) — Designer's guide to making maps in Tiled
- [TILES.pdf](/docs/TILES.pdf) - visual index of all tile names
- [TILED_KEY.md](docs/TILED_KEY.md) — Complete reference of wildcard-layer tiles and the actors/generators they spawn
- [ACTORS.md](docs/ACTORS.md) — Actor attributes, stats, personalities, behaviors
- [TYPES.md](docs/TYPES.md) — Reusable actor defaults inherited via `type`
- [ITEMS.md](docs/ITEMS.md) — Full item attribute reference, use effects, equipment
- [COMBAT.md](docs/COMBAT.md) — Hit/damage math, weapon types, equipment slots
- [LIGHTING.md](docs/LIGHTING.md) — Darkness, fog of war, light source configuration
- [TILE_PATTERNS.md](docs/TILE_PATTERNS.md) — Rule-driven tile painting, authoring patterns from data
- [SOUNDS.md](docs/SOUNDS.md) — Sound system, audio sprite, adding new sounds
- [CHANGELOG.md](CHANGELOG.md) — Version history

---

See [LICENSE.txt](LICENSE.txt) for license info.
