
# Dungeon Mode Kit - Design Document

```
         ______                                     ___  ___          _        _   ___ _       
         |  _  \                                    |  \/  |         | |      | | / (_) |      
         | | | |_   _ _ __   __ _  ___  ___  _ __   | .  . | ___   __| | ___  | |/ / _| |_     
         | | | | | | | '_ \ / _` |/ _ \/ _ \| '_ \  | |\/| |/ _ \ / _` |/ _ \ |    \| | __|    
         | |/ /| |_| | | | | (_| |  __/ (_) | | | | | |  | | (_) | (_| |  __/ | |\  \ | |_     
         |___/  \__,_|_| |_|\__, |\___|\___/|_| |_| \_|  |_/\___/ \__,_|\___| \_| \_/_|\__|    
                             __/ |                                                             
                            |___/                                                              
```

## Project Overview

**Dungeon Mode Kit** is a modular web-based roguelike framework designed to create multiple small game prototypes with different mechanics, all sharing common assets and core systems. Each prototype is a self-contained game that can be embedded in a web page.

Based on previous experiments — [grotto roguelike](https://github.com/wysiwyggins/grotto_roguelike), [didaktik gama](https://github.com/wysiwyggins/Didaktik-Gama)

Dungeon Mode Kit is a [tileset](https://codeberg.org/wysiwyggins/Dungeon-Mode-Kit/src/branch/main/docs/tiles.pdf), sound fx sprite (of sounds mostly made by recording and manipulating [one real instrument](https://larkinthemorning.com/products/round-sansula-thumb-piano)), and scripts that sit on top of some existing javascript libraries to allow for the quick prototyping of roguelike games using the free tilemap editor [Tiled](https://www.mapeditor.org) and human-readable data files, separate from code. The ultimate goal would be an online suite of tools with their own tilemap editor, similar to [Bitsy](https://www.bitsy.org). Where DMK diverges from Bitsy is that it allows the creation of games with mixed procedurally generated maps and authored maps. [ZZT](https://zzt.org) is also an inspiration.

---

In DMK, reusable methods live in scripts (Engine, Architect, Lighting, Effects ...). Specific design happens in the data files and maps in `/prototypes/`. Default actors, items, etc. are in `/data/` and prototypes override same-named entries or add new ones. New actors and items can have wholly new attributes on top of established ones.

All prototypes use the same character spritesheet for a unified visual language. Sprites are tiles which can be used for actors (usually two tiles), items (one tile), or map tiles. Prototypes can load one another as exits but are essentially different games. Prototypes can also have multiple floors, and floors can be larger than the viewport (scrolling).

An HTML sidebar displays actor stats and visible items alongside the game canvas, but the engine can run without it, and it can be repositioned with css.

## Technical Architecture

### Libraries

| Library | Role |
| --------- | ------ |
| [ROT.js](https://ondras.github.io/rot.js/hp/) | Map generation algorithms, FOV shadowcasting, RNG with seed support |
| [PIXI.js](https://pixijs.com/) | 2D rendering (sprites, containers, blend modes) |
| [Tween.js](http://createjs.com/) | Animation tweening (movement, fades) |
| [Howler.js](https://howlerjs.com) | Audio sprite playback |

### File Structure

```
data/                    ← Global entity definitions
  actors.json            ← All actor types
  types.json             ← Reusable actor defaults (beast, undead, ...)
  items.json             ← All item types  
  personalities.json     ← AI behavior configs
  states.json            ← Temporary condition definitions
  static-tiles.json      ← Tile name → index mapping
  sounds.json            ← Audio sprite map
prototypes/
  my_level/
    prototype.json       ← Level config (required)
    actors.json          ← Override/add actors (optional)
    types.json           ← Override/add actor types (optional)
    items.json           ← Override/add items (optional)
    personalities.json   ← Override/add behaviors (optional)
    map.tmj              ← Tiled map for floor 1 (optional)
    2.tmj, 3.tmj, ...   ← Maps for floors 2+ (optional)
```

## Entity System

Simple class hierarchy: **Entity** → **Item** and **Actor**. All behavior is data-driven through attributes defined in JSON.

**Entity** has a position, type identifier, sprite, tint, and an attributes Map. Attributes can be any value type. `hasAttribute(key)` returns true only if the attribute exists and is truthy.

**Item** — single-tile entities on the floor. Can be picked up, equipped, used. Effects are attribute-based: `collision_effect` (damage on hit), `wear_effect` (stat bonuses when worn), `use_effect` (activated from inventory).

**Actor** — two-tile entities (base + top). Includes creatures, the player, doors, walls, fire, water, and more. Actors with a `personality` participate in the turn-based scheduler.

See [ENTITIES.md](ENTITIES.md), [ACTORS.md](ACTORS.md), [ITEMS.md](ITEMS.md).

## Combat System

Combat can occur when actors collide (see [movement](MOVEMENT.md)) and [COMBAT.md](COMBAT.md).

## Map System

Maps are authored in [Tiled](https://www.mapeditor.org/) or generated procedurally. Authored maps use 6 layers: background, floor, wildcards, actors, items, landmarks.

**Wildcards** are special tiles painted on a tile layer that the engine replaces with procedural content at runtime — dungeon rooms, caves, mazes, lava pools, or Actor spawn points. This allows mixing hand-crafted and generated content on the same map.

**Tile patterns.** `MapManager.applyTilePattern(layer, rules, options)` in `architect.js` paints a tile pattern onto a layer by evaluating an ordered rule list at every cell — a small cellular automaton with caller-supplied rules. Each rule is `{ when, paint }`; the first matching rule wins, so specific rules go first. Rules read the same layer they write within a pass, which is what lets a shape propagate across cells. `addBaseAndShadows` (the diagonal cliff shading on abyss edges) is built from three such rules and is the reference example. The void tile values it paints live in `globalVars` (`VOID_FILL` / `VOID_SHADE` / `VOID_DIAGONAL`), so an abyss can be restyled from one place. See [TILE_PATTERNS.md](TILE_PATTERNS.md) for the rule contract and how to author patterns from data.

See [MAP.md](MAP.md), [PROTOTYPE.md](PROTOTYPE.md), [Tile Index](/docs/tiles.pdf), [Wildcard Tile Key](/docs/TILED_KEY.pdf).

## Prototype System

A prototype is a self-contained level or game variant. The `prototype.json` config controls mechanics (lighting, fog of war, viewport), map generation, entity spawning, win conditions, and progression to other prototypes.

Prototypes can have multiple floors with per-floor overrides. Floors are linked by stairways; prototypes are linked by portals and `next_level`/`previous_level` fields.

See [PROTOTYPE.md](PROTOTYPE.md).

### Creating a Prototype

1. Create a folder in `prototypes/` with a `prototype.json`
2. For authored content, create a map in Tiled and save as `map.tmj` in the folder
3. Without a map file, the engine generates a procedural level
4. Add local `actors.json` or `items.json` to customize entities
5. Serve locally with `python3 -m http.server` and load with `?prototype=your_level`

## Other Systems

| System | Doc | Summary |
| -------- | ----- | --------- |
| Lighting | [LIGHTING.md](LIGHTING.md) | Dynamic colored lighting with shadowcasting FOV, fog of war |
| Sound | [SOUNDS.md](SOUNDS.md) | Audio sprite with Howler.js, data-driven sound attributes |
| Descriptions | [DESCRIPTIONS.md](DESCRIPTIONS.md) | Turn-based message history, hover descriptions, template substitution |
| Save/Load | [SAVING.md](SAVING.md) | Seed URLs, floor state serialization, entity serialize/deserialize |
