
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

### Core Philosophy

- **Modular**: Reusable tiles, actors, items, and behaviors that combine in different ways. Visual style (tiles fit together) mirrors code style (data-driven components).
- **Embeddable**: Canvas games integrated into web pages.
- **Rapid Prototyping**: Quick prototypes rather than one large specific game. Prototypes are essentially different games without continuity between them, although they can load one another.

Modular reusable systems live in the scripts. Specific design happens in the data files and maps in `/prototypes/`. Default actors, items, etc. are in `/data/` and prototypes override same-named entries or add new ones. New actors and items can have wholly new attributes on top of established ones.

All prototypes use the same character spritesheet for a unified visual language. Sprites are tiles which can be used for actors (usually two tiles), items (one tile), or map tiles. Prototypes can load one another as exits but are essentially different games. Prototypes can also have multiple floors, and floors can be larger than the viewport (scrolling).

An HTML sidebar displays actor stats and visible items alongside the game canvas, but the engine can run without it.

## Technical Architecture

### Libraries

| Library | Role |
|---------|------|
| ROT.js | Map generation algorithms, FOV shadowcasting, RNG with seed support |
| PIXI.js | 2D rendering (sprites, containers, blend modes) |
| Tween.js | Animation tweening (movement, fades) |
| Howler.js | Audio sprite playback |

### Rendering

- Tiles displayed at half-size for hi-DPI displays
- Actors are two tiles tall (base + top), with an optional side tile
- Maps have floor + 2-tile height walls. Most tiles have transparent backgrounds; occluded tiles behind actors are hidden automatically.
- 8 render layers (bottom to top): background, floor, landmarks, overlay, light color, darkness, UI, splash
- Sprite tinting, animated frames, flicker/ripple effects, facing

### File Structure

```
data/                    ← Global entity definitions
  actors.json            ← All actor types
  items.json             ← All item types  
  personalities.json     ← AI behavior configs
  states.json            ← Temporary condition definitions
  static-tiles.json      ← Tile name → index mapping
  sounds.json            ← Audio sprite map
prototypes/
  my_level/
    prototype.json       ← Level config (required)
    actors.json          ← Override/add actors (optional)
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

Combat occurs when actors collide. Hit probability uses an exponential formula with diminishing returns on defense stacking:

```
hit_chance = accuracy × 0.987^defense    (clamped 5–95%)
```

Weapon damage is scaled by attacker strength (`damage × strength/10`), with optional enchantment bonuses and weapon procs (knockback, lifesteal, critical).

Attack styles modify targeting: **lunge** (gap-closing strike), **sweep** (hit all adjacent), **penetrate** (pierce through to enemy behind).

See [COMBAT.md](COMBAT.md).

## Map System

Maps are authored in [Tiled](https://www.mapeditor.org/) or generated procedurally. Authored maps use 6 layers: background, floor, wildcards, actors, items, landmarks.

**Wildcards** are special tiles painted on a tile layer that the engine replaces with procedural content at runtime — dungeon rooms, caves, mazes, lava pools, or entity spawn points. This allows mixing hand-crafted and generated content on the same map.

Generator types: digger, cellular, uniform, rogue, brogue, arena, infernal, and several maze variants.

See [MAP.md](MAP.md), [PROTOTYPE.md](PROTOTYPE.md), [Tile Index](/docs/tiles.pdf).

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
|--------|-----|---------|
| Lighting | [LIGHTING.md](LIGHTING.md) | Dynamic colored lighting with shadowcasting FOV, fog of war |
| Sound | [SOUNDS.md](SOUNDS.md) | Audio sprite with Howler.js, data-driven sound attributes |
| Descriptions | [DESCRIPTIONS.md](DESCRIPTIONS.md) | Turn-based message history, hover descriptions, template substitution |
| Save/Load | [SAVING.md](SAVING.md) | Seed URLs, floor state serialization, entity serialize/deserialize |
