
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

**Dungeon Mode Kit** is a modular web-based roguelike framework designed to create multiple small game prototypes with different mechanics, all sharing common assets and core systems. This would allow me to make small embeddable games that correspond to the different topic in *The Dungeon Mode*
Based on previous expiments— [grotto roguelike](https://github.com/wysiwyggins/grotto_roguelike), [didaktik gama](https://github.com/wysiwyggins/Didaktik-Gama)

### Core Philosophy

- **Modular**: Mix authored and procedural content seamlessly
- **Semantic**: Clear, attribute-based entity system inspired by *Baba Is You*
- **Embeddable**: Canvas games integrated into web pages
- **Rapid Prototyping**: Quick iteration on different game mechanics, don't bother with persistence between levels

## Design Questions

- How do we deal with a changing number of arbitrary stats? This means how do we display them and give feedback when they change and describe them in text? We may need to add another html element over description for visible actor stats to avoid taking up canvas space. We want to always avoid hard coding and specificity as much as possible to allow for things to be defined by the data files- prototypes, actors, items, personalities, behaviors, etc. Strive towards readability and flexibility in those files.

## Technical Architecture

### Rendering System

- **Technology**: PIXI.js (or performance-equivalent alternative)
- **Resolution**: Tiles displayed at half-size for hi-DPI displays
- **Height System**: Floor + 2-tile height (floor, base, top, ((ok and also maybe hats))
- **Layers**: Background shadows, floor, entities (1-2 tiles), UI. Most tiles have transparent backgrounds so we need to manually hide occluded tiles on locations behind actors.
- - **Effects**: Sprite tinting, animation frames

## Entity System

The engine uses a simple class hierarchy: **Entity** → **Item** and **Actor**. All behavior is driven by attributes defined in JSON data files.

### Entity (Base Class)

Entities have a position, type identifier, sprite, tint, and a map of attributes. Attributes can be any value type—boolean flags, numbers, strings, or objects. The `hasAttribute(key)` method returns true only if the attribute exists and is truthy, while `getAttribute(key)` returns the raw value.

### Item

Items are single-tile entities defined in `data/items.json` or prototype-specific `items.json` files. They sit on the floor and can be picked up by actors with an `inventory` attribute.

Key item attributes include `pickupable`, `visible`, `stackable`, `consumable`, and `flammable`. Items can have a `wearable` slot (`top`, `middle`, or `lower`) to auto-equip when picked up. Wearable items render above the actor at their slot position.

**Effects:** Items use attribute-based effects rather than hardcoded types:

- `collision_effect` modifies attributes on actors the holder collides with (e.g., `{"health": -10}` for damage, `{"locked": false}` for keys)
- `wear_effect` modifies the wearer's attributes while equipped (e.g., `{"strength": 5}`)
- Effect values can be numbers (add/subtract), booleans (set), or `"toggle"`

Items with `use_verb` can be activated through UI (e.g., "Drink", "Dig"). The `use_effect` attribute specifies the effect type.

### Actor

Actors are two-tile entities (base + top) defined in `data/actors.json`. They include creatures, the player, doors, walls, fire, and other interactive objects. Actors participate in the turn-based scheduler if they have a `personality` attribute.

Actor qualities are organized into two categories:

- **Attributes**: Boolean flags and configuration values stored in a Map. Examples: `solid`, `visible`, `hostile`, `controlled` (player), `sighted`, `flammable`, `openable`, `locked`, `open`, `light_source`, `stairway`, `inventory` (max size).
- **Stats**: Numeric values with `{ max, current }` structure that change during gameplay. Examples: `health`, `strength`. Stats can be referenced in collision effects using `"{stat}"` or `"-{stat}"` syntax.

Actors can have their own `collision_effect` for unarmed attacks or special interactions. The `default_items` array spawns items in the actor's inventory on creation. The `paint_tile` attribute lets you place actors in Tiled using a specific tile on the wildcards layer.

### Personalities and AI

Actor behavior is controlled by the `personality` attribute (e.g., `"aggressive_melee"`, `"random_walk"`). Personalities map to behavior functions that execute each turn. Hostile actors with `sighted` avoid walking into pits; those without may fall.

## Combat System

Combat occurs when actors collide. The system uses exponential hit calculations, strength-based damage scaling, and weapon special effects.

**See [COMBAT.md](/COMBAT.md) for full documentation.**

### Quick Reference

**Hit Calculation:** `hit_chance = accuracy × 0.987^defense` (clamped 5-95%)

- Exponential formula provides diminishing returns on defense stacking
- Actors without `accuracy` always hit (deterministic combat)

**Damage Calculation:**

1. Base damage from weapon or actor `collision_effect`
2. Critical hit check (15% for `"critical"` weapons = 2x damage)
3. Strength multiplier: `damage × (strength / 10)`

**Combat Attributes:**

- `accuracy`: Base hit chance percentage
- `defense`: Reduces hit chance (exponential)
- `strength`: Multiplies weapon damage (default 10 = 1x)

**Weapon Types:**

- `"weapon": true` or `"normal"` - Standard weapon
- `"weapon": "knockback"` - Pushes target back on hit
- `"weapon": "lifesteal"` - Heals 25% of damage dealt
- `"weapon": "critical"` - 15% chance for double damage

**Equipment Slots:** `weapon`, `top`, `middle`, `lower`

### Example Configuration

```json
"player": {
  "collision_effect": { "health": "-{strength}" },
  "attributes": {
    "strength": 10,
    "accuracy": 70,
    "defense": 5
  }
}

"minotaur": {
  "collision_effect": { "health": "-{strength}" },
  "attributes": {
    "strength": 12,
    "accuracy": 80,
    "defense": 15
  }
}

"warhammer": {
  "attributes": {
    "weapon": "knockback",
    "collision_effect": { "health": -8 }
  }
}
```

## Map System

### Tiled Integration

**Layers**:

- **Floor Layer**: Defines playable area (engine auto-generates shadow background)
- **Item Layer**: 1-tile item placement
- **Actor Layer**: 2-tile actor placement

### Wildcard System

**Procedural Zones**: Special tiles painted in Tiled that spawn actors on prototype load

- **Floor Wildcards**: Generate maze hallways, room layouts
- **Item Wildcards**: Randomize item drops (validates walkable floor)
- **Actor Wildcards**: Place procedural enemies, walls

### Processing Pipeline

1. **Load prototype**: Check for `map.tmj` in prototype folder
2. **Map handling**:
   - If `map.tmj` exists → load authored map
   - If no `map.tmj` → generate fully procedural level using ROT.js
3. **Process wildcard tiles** → replace with ROT.js generated content:

   ```javascript
   // Wildcard maze generation
   if (tileType === WILDCARD_MAZE) {
     const maze = new ROT.Map.Uniform(width, height);
     maze.create((x, y, value) => {
       floorMap[x][y] = value === 0 ? FLOOR_TILE : null;
       if (value === 1) spawnWallActor(x, y);
     });
   }
   ```

4. **Auto-generate wall actors** around floor perimeters (procgen areas)
5. **Load entities**:
   - Start with global actors/items
   - Override with prototype-specific variants
6. **Validate item placements** (must be on walkable floor)
7. **Instantiate entities** from tile IDs using lookup tables

## Prototype System

A prototype is a self-contained level or game variant. Each prototype folder contains a `prototype.json` config and optionally a `map.tmj` (Tiled map), plus local `actors.json` and `items.json` overrides.

### Prototype Config

```json
{
  "name": "Cretan Labyrinth",
  "loaded_sound": "levelout",
  "depth": 2,
  "turn_speed": 50,
  "next_level": "deeper_labyrinth",
  "previous_level": "default",
  "mechanics": {
    "fog_of_war": true,
    "darkness": true,
    "ambient_light": 0.1,
    "player_light_radius": 6
  }
}
```

The `next_level` and `previous_level` fields link prototypes via stairway actors. The `mechanics` object controls lighting and visibility systems. The `loaded_sound` plays when the level finishes loading.

### Entity Overrides

Actor and item stats are defined in actor/item JSON files, not the prototype config. Prototypes can override global definitions by including local `actors.json` or `items.json` files. The engine loads global definitions first, then merges prototype-specific overrides.

### Creating a Prototype

Create a folder in `prototypes/` with a `prototype.json`. For authored content, add a `map.tmj` with floor, actors, items, and wildcards layers. Without a map file, the engine generates a procedural level. Add local `actors.json` or `items.json` to customize entities for this prototype.
