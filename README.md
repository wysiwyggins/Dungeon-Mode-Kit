# Dungeon Mode Kit

## About DMK

DMK is a toolkit for making roguelike games using a javascript library called [ROT.js](https://ondras.github.io/rot.js/hp/) and the free/donation tilemap editor, [Tiled](https://www.mapeditor.org). It grew out of a series of art projects that used a spritesheet of specific tiles and a collection of sounds made by manipulating recordings of a small musical instrument called a sansula. Over time the spritesheet has grown large and more sounds have been added.

The goal is to separate the nuts and bolts javascript needed to make a game with ROT.js from human-readable data that can be tweaked and experimented with. I enjoy designing as a sort of recombinatory play, and I hope to develop a suite of editors that allows for that. Something like [Bitsy](https://www.bitsy.org) or [ZZT](https://zzt.org) for turn-based dungeon games.

--

## Setup

Since DMK isn't hosted yet, the only way to develop a game with it (called a prototype) is to clone it from github and install the associated vendor libraries. Open a terminal in the Dungeon Mode Kit directory and type

```bash
./setup.sh
```

This downloads JavaScript libraries into `lib/` directory. You can load up some sample prototypes in a web browser by creating a localhost (VSCode's Go Live feature works.)

## Making Your Own Prototype

One way to quickly experiment with your own protype is to duplicate one of the existing prototype folders, rename it and open it in some of the web editors linked at the bottom of the locally served index page. Currently you can't save directly in the editors though, you'll need to copy data to the clipboard and then paste it into the appropriate json files in your prototype folder. I hope to have this smoothed out very soon.

Dungeon Mode Kit has a default /data/ folder that contains actors, items, and resources shared by the whole kit. It's prototype folders can contain their own versions of the same data, which either overrides or suppliments the default data.

## Reference Docs

- [PROTOTYPE.md](docs/PROTOTYPE.md) — Full prototype config reference, map generation, item catalogs
- [MAP.md](docs/MAP.md) — Designer's guide to making maps in Tiled
- [TILES.pdf](docs/TILES.pdf) — Visual index of all tile names
- [TILED_KEY.md](docs/TILED_KEY.md) — Complete reference special tiles that spawn actors when used in a map layer called "wildcards"
- [ACTORS.md](docs/ACTORS.md) — Actor attributes, stats, personalities, behaviors
- [ITEMS.md](docs/ITEMS.md) — Full item attribute reference, use effects, equipment
- [TYPES.md](docs/TYPES.md) — Reusable actor and item defaults inherited via the `type` attribute
- [ENTITIES.md](docs/ENTITIES.md) — Entities are a base class that other entities inherit from, they can be used on their own for simple decorations
- [BIOMES.md](docs/BIOMES.md) — Depth-ranged bundles of monsters, items, hazards and generators
- [TILE_PATTERNS.md](docs/TILE_PATTERNS.md) — Rule-driven tile painting, authoring patterns from data
- [MOVEMENT.md](docs/MOVEMENT.md) — Order of operations when an actor moves or bumps into a tile
- [EPISTEMOLOGY.md](docs/EPISTEMOLOGY.md) — What the player character can see and know
- [SAVING.md](docs/SAVING.md) — Seed URLs and save/load
- [IDEAS.md](docs/IDEAS.md) - loose feature and bug notes, will be replaced by a kanban board soon
- [CHANGELOG.md](CHANGELOG.md) — Recent Version history
