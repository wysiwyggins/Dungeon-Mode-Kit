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

1. Serve the project locally (required — the engine is ES modules and loads data with `fetch`, neither works from `file://`. Use `python3 -m http.server` or any static server like VSCode's "Go Live")
2. Open `index.html` in a browser
3. Add `?prototype=name` to the URL to load a specific level (e.g. `index.html?prototype=labyrinth`)
4. Edit maps in Tiled: open `tiled/dungeonkit.tiled-project`
5. Edit data in the browser editors in `editors/` (prototypes, biomes, actors, items, personalities, effects, entities, sounds); they export JSON to paste into `data/` or a prototype folder

---

## Project Layout

```
data/                 <- default data files shared across prototypes

prototypes/
  my_level/           <- your data files add to or override the ones in data/
    prototype.json    <- level rules (required)
    actors.json       <- actor overrides/additions for this level
    items.json        <- item overrides/additions for this level
    map.tmj           <- authored Tiled map for floor 1 (optional)
    2.tmj             <- authored Tiled map for floor 2 (or any numbered floor; optional)

editors/              <- browser editors for the data files
tiled/                <- Tiled project, tileset and sample maps
assets/               <- spritesheet, audio sprite, fonts, styles (scss -> main.css)
docs/                 <- reference docs (below)
tools/, scripts/      <- Node checks for the map generators, sound-sprite builder, tile slicer
lib/                  <- third-party libraries, downloaded by setup.sh (gitignored)
```

Prototype JSON files are merged with global `data/` files at load — you only need to define what's new or different for a given level. Besides actors and items, a prototype can override or add to `personalities.json`, `effects.json`, `biomes.json`, `types.json`, `states.json`, `keybindings.json` and `animations.json`.

### Engine source

The engine is plain ES modules, no bundler: each game page loads the `lib/` scripts (rot, pixi, tween, howler) as globals, then `main.js`, which imports everything else.

```
main.js           <- entry point: initializeGame() and console debug helpers
globals.js        <- shared constants (paths, tile sizes, tile ids)
core/             <- helpers with no engine dependencies (util, pathfinding, mixin)
engine/           <- DungeonEngine, Prototype, Entity, Item, Actor, EntityManager, RenderSystem
architect/        <- map building: Tiled loading and the procedural generators
behaviors/        <- Personality and the BehaviorLibrary of AI/environment behaviors
ui/               <- InterfaceManager: boxes, panels, menus, aiming, throwing, spells
input.js, lighting.js, effects.js, sound.js
```

The big classes are split by topic: `engine/actor/movement.js` exports a plain object of Actor methods, and `actor.js` installs the groups onto the class with `installMethods` (`core/mixin.js`), so calls stay `actor.tryMove()`. Methods that use `super`, getters and statics stay in the class body.

---

## Reference Docs

- [PROTOTYPE.md](docs/PROTOTYPE.md) — Full prototype config reference, map generation, item catalogs
- [MAP.md](docs/MAP.md) — Designer's guide to making maps in Tiled
- [TILES.pdf](docs/TILES.pdf) — Visual index of all tile names
- [TILED_KEY.md](docs/TILED_KEY.md) — Complete reference of wildcard-layer tiles and the actors/generators they spawn
- [ACTORS.md](docs/ACTORS.md) — Actor attributes, stats, personalities, behaviors
- [TYPES.md](docs/TYPES.md) — Reusable actor defaults inherited via `type`
- [ENTITIES.md](docs/ENTITIES.md) — The Entity base class: coordinates, attributes, naming, serialization
- [BIOMES.md](docs/BIOMES.md) — Depth-ranged bundles of monsters, items, hazards and generators
- [BRIDGES.md](docs/BRIDGES.md) — How rope bridges are generated across abysses
- [ITEMS.md](docs/ITEMS.md) — Full item attribute reference, use effects, equipment
- [COMBAT.md](docs/COMBAT.md) — Hit/damage math, weapon types, equipment slots
- [LIGHTING.md](docs/LIGHTING.md) — Darkness, fog of war, light source configuration
- [TILE_PATTERNS.md](docs/TILE_PATTERNS.md) — Rule-driven tile painting, authoring patterns from data
- [SOUNDS.md](docs/SOUNDS.md) — Sound system, audio sprite, adding new sounds
- [MOVEMENT.md](docs/MOVEMENT.md) — Order of operations when an actor moves or bumps into a tile
- [EPISTEMOLOGY.md](docs/EPISTEMOLOGY.md) — What the player character can see and know
- [DESCRIPTIONS.md](docs/DESCRIPTIONS.md) — Hover descriptions, event messages and text templates
- [SAVING.md](docs/SAVING.md) — Seed URLs and save/load
- Roadmaps: [HOSTING](docs/HOSTING_ROADMAP.md), [GENERATOR](docs/GENERATOR_ROADMAP.md), [DIALOGUE](docs/DIALOGUE_ROADMAP.md); loose notes in [IDEAS.md](docs/IDEAS.md)
- [CHANGELOG.md](CHANGELOG.md) — Version history

---

See [LICENSE.txt](LICENSE.txt) for license info.
