# Dungeon Mode Kit

A modular web-based roguelike framework built on rot.js and pixi.js

**[Original Design Notes](/DUNGEON_MODE_KIT_DESIGN.md)**

### Core Architecture

#### DungeonEngine

The main orchestrator that coordinates all subsystems:

- **Initialization**: Loads global assets (sprites, audio), sets up PIXI.js renderer with exact pixel dimensions for the current map
- **Prototype Loading**: Loads game configurations from `prototypes/{name}/`, checking for authored Tiled maps or falling back to procedural generation
- **State Management**: Maintains a `prototypeStack` for multi-level navigation (stairs), with save/restore capabilities for transitioning between levels. This is a stub that might not get used, since it's not actually important to me yet to have persistence between levels, rather they just load like totally new games.

Methods:

- `initialize()` - One-time setup of assets and animation ticker
- `loadPrototype(name)` - Loads a complete game definition
- `transitionToPrototype()` / `returnToPreviousPrototype()` - Level transitions

#### Entity System

A hierarchical, attribute-based system:

**Entity (Base)** - Any object with position, optional sprite, and semantic attributes

- Attributes stored in a Map: `solid`, `pushable`, `flammable`, `breakable`, `visible`, etc.
- Methods: `setAttribute()`, `getAttribute()`, `hasAttribute()`
- Sprites are optional (`this.sprite = null` by default) - useful for invisible triggers, shadows, etc.
- Floors are **not** entities - they're tile data in `MapManager.floorMap`

**Item (extends Entity)** - Single-tile pickupable objects (keys, potions, weapons)

- Height: 1 tile
- Default attribute: `pickupable: true`

Item JSON schema:

```json
{
  "item_id": {
    "name": "Display Name",
    "tileIndex": "TILE_NAME",       // or {x, y} coordinates
    "tint": "#RRGGBB",              // optional color tint
    "flipH": false,                 // optional horizontal flip
    "flipV": false,                 // optional vertical flip
    "attributes": {
      "pickupable": true,
      "visible": true,
      "stackable": false,
      "flammable": false,
      "consumable": false,
      "collision_effect": { "stat": value },  // applied when holder collides (supports "-{attr}" refs)
      "collision_sound": "sound_name",
      "use_verb": "Drink",                    // action menu label
      "use_effect": { "health": 20 },         // stat/attribute modification on use
      "use_effect": { "apply_state": "poisoned" }, // or apply a state to the user
      "use_sound": "sound_name",
      "weapon": true,                         // or "knockback", "lifesteal", "critical" for proc effects
      "wearable": "top|middle|lower",         // equipment slot
      "requires_stat": { "strength": 8 },     // stat requirements to equip; strength value = turns to equip
      "wear_effect": {                        // stat bonuses when worn
        "defense": 5,
        "nutrition_per_turn": 0.5             // modifies per-turn rate (reduces hunger drain)
      },
      "passive_effect": {                     // effect while in inventory (no equip needed)
        "type": "stat_bonus",                 // stat_bonus or leave_trail
        "defense": 10                         // stat bonuses applied passively
      }
    }
  }
}
```

**Passive Effect Types:**

- `stat_bonus` - Adds stat bonuses while item is in inventory (e.g., `{"type": "stat_bonus", "defense": 10}`)
- `leave_trail` - Leaves entity trail behind carrier as they move (e.g., thread ball)

```json
  {
    "type": "leave_trail",
    "trail_type": "thread_trail",
    "use_item_tint": true,
    "backtrack_removes": true
  }
```

**[Items](/ITEMS.md)** | **[Combat](/COMBAT.md)**

**Actor (extends Entity)** - Interactive 2-tile entities (player, monsters, doors, walls)

- Height: 2 tiles (base sprite + top sprite)
- Has `stats`, `inventory`, and `personality`
- **Attributes**: Boolean flags and configuration values (e.g., `solid`, `visible`, `hostile`, `open`, `locked`)
- **Stats**: Numeric values with `{ max, current }` structure that change during gameplay (e.g., `health`, `strength`)
- Methods: `die()`, `pickUpItem()`, `flash()`, `applyCollisionEffects()`

Actor JSON schema (organized by property type):

```json
{
  "actor_id": {
    // IDENTITY - display/rendering properties
    "name": "Display Name",
    "tileIndexBase": "TILE_NAME",    // or {x, y} coordinates
    "tileIndexTop": "TILE_NAME",
    "tint": "#RRGGBB",
    "animated": true,
    "animation_frames": "fire",
    "flipBaseH": false,
    "flipTopV": false,

    // BEHAVIOR - AI and interaction config
    "personality": "personality_name",
    "vision_range": 8,
    // Collision effects can use attribute references: "{attr}", "-{attr}", "+{attr}"
    // Example: "collision_effect": { "health": "-{strength}" } uses actor's strength as damage
    "collision_effect": { "health": -5 },
    "collision_sound": "hit",
    "death_sound": "ouch",
    "damage_per_turn": 10,                 // for hazards like fire
    "spread_chance": 0.3,
    "lifetime": 5,
    "default_items": ["item_id"],          // items actor spawns with

    // STATS - numeric values with max/current that change during gameplay
    // Simple format: "health": 30 becomes { max: 30, current: 30, per_turn: 0 }
    // Extended format for per-turn changes and warnings:
    "stats": {
      "health": 30,
      "nutrition": {
        "max": 100,
        "per_turn": -1,              // changes by this amount each turn
        "fatal": true,               // reaching 0 kills the actor
        "death_message": "You starve to death!",
        "warnings": [                // threshold messages (player only)
          { "threshold": 0.5, "message": "You are getting hungry." },
          { "threshold": 0.25, "message": "You are very hungry." },
          { "threshold": 0.1, "message": "You are starving!" }
        ]
      }
    },

    // ATTRIBUTES - boolean flags/capabilities
    "attributes": {
      "solid": true,           // blocks movement
      "visible": true,
      "controlled": false,     // player-controlled
      "hostile": false,
      "flammable": true,
      "pushable": false,       // can be pushed by player
      "breakable": false,
      "openable": false,       // doors, chests
      "lockable": false,
      "open": false,           // current open state (doors, chests)
      "locked": false,         // current locked state
      "sighted": false,        // AI avoids hazards
      "light_source": false,
      "proper_named": false,   // true for named characters (no "the" prefix)
      "mass_noun": false,      // true for substances like "water" (no article)
      "inventory": 1,          // max inventory size
      "remains": "skull",      // entity spawned on death
      "accuracy": 70,          // hit chance percentage (combat)
      "defense": 5,            // reduces hit chance exponentially (combat)
      "strength": 10           // multiplies weapon damage (combat)
    }
  }
}
```

#### Prototype Configuration

Each prototype folder contains a `prototype.json` that configures level-specific rules:

```json
{
  "name": "Level Name",
  "description": "Shown on level load",
  "loaded_sound": "sound_name",
  "depth": 1,
  "turn_speed": 50,
  "previous_level": "default",
  "next_level": "next_level_name",
  "mechanics": {
    "fog_of_war": true,
    "darkness": true
  },
  "random_actors": {
    "actor_type": { "chance": 100 },              // 100% = exactly one guaranteed
    "other_actor": { "chance": 50, "min": 1, "max": 3 }  // 50% chance per roll
  },
  "random_items": {
    "item_type": { "chance": 100 },               // 100% = exactly one guaranteed
    "other_item": { "chance": 30, "min": 2, "max": 5 }   // 30% chance per roll
  },
  "win_conditions": ["killed:actor_type"]
}
```

#### Personality System

Data-driven AI behaviors loaded from JSON:

```
Personality → behaviors[] → BehaviorLibrary
```

- Personalities define: `controlled`, `hostile`, `behaviors`, `vision_range`
- BehaviorLibrary contains pluggable routines: `patrol`, `pursue_target`, `random_walk`, `attack_adjacent`
- `execute(actor)` runs behaviors in order until one succeeds

**Environmental Behaviors:**

- `lava_behavior` - Incinerates non-fireproof actors/items, spawns fire
- `fire_behavior` - Spreads to adjacent flammable entities, burns out after lifetime, damages entities standing in it
- `cloud_behavior` / `mist_behavior` - Gas clouds that spread, disperse and apply effects
- `liquid_pooling` - Cellular automata transformation (e.g., sewage → deep_sewage when surrounded)
- `deep_water_behavior` - Currents that can sweep items from inventory and cause drift
- `trap_behavior` - Hidden traps that trigger when stepped on or hit by thrown items (Brogue-style)

**Fire System:** Lava incinerates any entity without `fireproof` attribute. Fire spreads to adjacent tiles with `flammable` entities. Use `fireproof: true` to make items/actors immune to incineration.

**Trap System:** Traps start invisible (`visible: false`) and become visible when triggered. They remain on the tile and can be re-triggered. Items on traps "hold down" the trigger, preventing re-triggering until removed. Players are warned before stepping on visible traps (unless an item holds the trigger). Traps support:

- `trap_spawn`: single actor (e.g., `"trap_spawn": "cloud"` with `trap_collision_effect` and `trap_spawn_tint`)
- `trap_effect`: spell-like area effect (e.g., `"trap_effect": { "center": "intense_fire", "radius": 1, "outer": "fire" }`)
- `trap_apply_state`: applies a state to actors caught in the effect (e.g., `"trap_apply_state": "paralyzed"`)

#### Architect

Handles map loading and procedural generation (see **[ARCHITECT.md](/ARCHITECT.md)** for full documentation):

- **Tiled Integration**: Loads `.tmj` files with floor, background, and object layers for actors and items.
- **Wildcard System**: Special tiles in the `wildcards` layer trigger procedural content generation. Wildcards detect contiguous regions and generate content sized to fit, preserving any authored content within gaps.
  - `maze` (tile 210) - Generates ROT.js EllerMaze, only filling wildcard tiles
  - `dungeon` (tiles 9, 16, 152) - ROT.js Digger with rooms, corridors, doors, and torches
  - `cave` (tile 10) - Cellular automata organic cave shapes
  - `infernal` (tile 11) - Cave with lava pools
  - `room` (tiles 143, 144) - Room type system with Brogue-inspired variants
  - Actor wildcards - Actors with `paint_tile` attribute spawn at matching tiles
- **Room Type Registry**: Data-driven room shapes (rectangular, cross, circular, chunky) selected by depth
- **Procedural Fallback**: Uses ROT.js generators if no `map.tmj` exists

Note: Tiled tile IDs are 1-indexed, so tile 210 in Tiled maps to ID 210 in `getWildcardType()`.

#### RenderSystem

PIXI.js rendering with layered containers:

1. `backgroundContainer` - Background tiles from Tiled `background` layer
2. `floorContainer` - Floor tiles from Tiled `floor` layer
3. `entityContainer` - Actors (2-tile) and items
4. `uiContainer` - UI elements

Actors render as two sprites stacked vertically (base at position, top one tile above).

**Tiled Layer Names:**

- `background` (tilelayer) - Walls, shadows, decoration behind floor
- `floor` (tilelayer) - Walkable floor tiles (tracked in `walkableTiles`)
- `wildcards` (tilelayer) - Special tiles that trigger procedural generation
- `actors` (objectgroup) - Objects with `type` or `class` matching actor definitions
- `items` (objectgroup) - Objects with `type` matching item definitions
- `landmarks` (objectgroup) - Ad-hoc decorative entities with walk-over descriptions (see below)

**Landmarks Layer:**

The `landmarks` layer allows creating Bitsy-style descriptive decorations directly in Tiled without pre-defining them in entities.json. Useful for adding flavor text to specific map locations.

| Tiled Field | Purpose |
|-------------|---------|
| `class`/`type` | Tile name from static-tiles.json (e.g., `SKULL`, `IMPERFECT_DOTTED_LIGHT_SHADE`) |
| `name` | Optional display name for the landmark |
| `walk_description` (custom property) | Message shown when player walks over the tile |
| `tint` (custom property) | Color tint as hex string (e.g., `#FF0000`) |
| `fillColor` (custom property) | Fill color for colored rectangle overlay |

Example: Add an object to the `landmarks` layer with `type` set to `IMPERFECT_DOTTED_LIGHT_SHADE` and a custom property `walk_description` = `"Dried lichen crunches under your feet."` to create a decorative floor detail with a walk-over message.

**[Lighting](/LIGHTING.md)**

#### EntityManager

Tracks and queries all game entities:

- Spawns entities from Tiled object layers
- Provides lookup methods: `getEntityAt()`, `getActorAt()`, `findNearestPlayer()`
- Handles serialization for state saves

#### AudioManager

Howler.js wrapper for audio sprite playback with multi-format support.

### Data Flow

```
1. initializeGame()
   └─> engine.initialize()
       ├─> loadGlobalAssets() [sprites, audio]
       └─> loadPrototype('default')
           ├─> loadPrototypeConfig()
           ├─> checkForAuthoredMap()
           ├─> Architect.loadTiledMap() or generateProceduralMap()
           ├─> initializeRenderer()
           ├─> EntityManager.spawnEntities()
           ├─> Architect.processWildcards(context)
           ├─> Architect.spawnPending*() [walls, doors, torches, lava]
           └─> RenderSystem.renderTestPattern() + renderActors()
```

---

See [CHANGELOG.md](CHANGELOG.md) for version history and implementation status.

### File Structure

```
.
├── assets
│   ├── audio
│   │   ├── sounds.ac3
│   │   ├── sounds.m4a
│   │   ├── sounds.mp3
│   │   └── sounds.ogg
│   ├── favicon.ico
│   ├── fonts
│   │   ├── cmunrm-webfont.woff
│   │   ├── cmunrm-webfont.woff2
│   │   ├── courier_prime_code-webfont.woff
│   │   └── courier_prime_code-webfont.woff2
│   ├── main.css
│   ├── main.css.map
│   ├── main.scss
│   ├── scss
│   │   ├── _base.scss
│   │   ├── _details.css
│   │   ├── _game.scss
│   │   └── _typography.scss
│   └── sprites
│       ├── fire-animation.png
│       ├── fluid-animation.png
│       ├── light-smoke-animation.png
│       ├── smoke-animation.png
│       └── static-tiles.png
├── CHANGELOG.md
├── COMBAT.md
├── data # Global entity definitions
│   ├── actors.json  # Actor templates (player, skeleton, wall, fire, etc.)
│   ├── adjectives.json #wordstuff
│   ├── attacks.json #wordstuff
│   ├── colors.json  #color names and hex values
│   ├── entities.json # decoration and description tiles
│   ├── items.json  # Item templates (key, bow, potions, etc.)
│   ├── personalities.json # AI behavior definitions
│   ├── reagents.json #unused magic potion ingredients
│   ├── sounds.json #named sounds in soundsprite
│   ├── static-tiles.json #main tileset
│   └── substances.json #wordstuff
├── deploy.sh
├── DESCRIPTIONS.md
├── DUNGEON_MODE_KIT_DESIGN.md
├── embed-example.html
├── architect.js # Map generation and terrain management
├── arena.html # Combat balance testing page
├── engine.js # Core engine
├── globals.js # Global variables and constants
├── index.html
├── input.js
├── interface.js
├── ITEMS.md
├── lib
│   ├── howler.js
│   ├── pixi.min.js
│   ├── pixi.min.js.map
│   ├── rot.js
│   ├── rot.min.js
│   ├── tweenjs.js
│   └── tweenjs.min.js
├── LICENSE.txt
├── lighting.js
├── LIGHTING.md
├── ARCHITECT.md
├── prototypes # individual level definitions and overrides
│   ├── default # each level gets a folder with map and json files to override/supplement data
│   │   ├── actors.json
│   │   ├── items.json
│   │   ├── map.tmj
│   │   └── prototype.json # Level rules and mechanics
│   ├── labyrinth
│   │   ├── actors.json
│   │   ├── items.json
│   │   ├── map.tmj
│   │   └── prototype.json
│   └── catacombs
│       ├── actors.json
│       └── prototype.json
├── README.md
├── sound.js
└── tiled
    ├── dungeonkit.tiled-project
    ├── dungeonkit.tiled-session
    └── static-tiles.tsj

See [LICENSE.txt](LICENSE.txt) for license info
