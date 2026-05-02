# Actor System

Actors are defined in `data/actors.json` or prototype-specific `actors.json` files. They are the living and environmental objects in the world — enemies, the player, doors, fire, water, walls, and more. All behavior is data-driven through attributes, stats, states, and personalities.

See [ENTITIES.md](ENTITIES.md) for the base fields (`tint`, `zIndex`, `attributes`, naming) that all entities share.

## Basic Actor Structure

```json
"actor_id": {
  "name": "Display Name",
  "tileIndexBase": "TILE_NAME",
  "tileIndexTop": "TILE_NAME",
  "tint": "#RRGGBB",
  "personality": "personality_name",
  "collision_effect": { "health": -5 },
  "collision_sound": "hit",
  "stats": {
    "health": 30
  },
  "attributes": {
    "hostile": true,
    "sentient": true
  }
}
```

> **Defaults:** Actors are `solid`, `visible`, and `flammable` by default. They are **not** `hostile` or `sentient` by default. Only declare attributes that override these defaults.

## Visual Fields

Actors are two tiles tall: `tileIndexTop` renders at head height (y-1), `tileIndexBase` at foot height (y). Actors can optionally have a third **side tile** at an offset from the base (e.g., a tail).

| Field | Type | Description |
|-------|------|-------------|
| `tileIndexBase` | string or `{x, y}` | Tile for the actor's base (lower body) |
| `tileIndexTop` | string or `{x, y}` | Tile for the actor's top (head/upper body) |
| `tileIndexSide` | string or `{x, y}` | Tile for a side-attached body part (e.g., tail) |
| `sideOffset` | `{dx, dy}` | Grid offset from base for the side tile (default: `{dx: 1, dy: 0}`) |
| `tileIndexBase_open` | string or `{x, y}` | Base tile when actor is in open state (doors) |
| `tileIndexTop_open` | string or `{x, y}` | Top tile when actor is in open state (doors) |
| `animationBase` | string | Animation name for base sprite |
| `animationTop` | string | Animation name for top sprite |
| `animationSide` | string | Animation name for side sprite |
| `flipBaseH` / `flipBaseV` | boolean | Flip base sprite horizontally or vertically |
| `flipTopH` / `flipTopV` | boolean | Flip top sprite horizontally or vertically |
| `flipSideH` / `flipSideV` | boolean | Flip side sprite horizontally or vertically |
| `facingEnabled` | boolean | Enable dynamic horizontal flipping based on movement direction |
| `defaultFacing` | string | Canonical orientation of the tile art: `"left"` (default) or `"right"` |
| `flickerTint` | boolean | Sprite color flickers (fire, torches) |
| `rippleTint` | boolean | Sprite color ripples (water, liquids) |
| `vision_range` | number | How far this actor can see (default: `8`) |

### Side Tiles

The side tile renders at the same vertical level as the base but offset horizontally (or in any direction via `sideOffset`). It is purely cosmetic — it does not create a collision footprint. Side tiles have their own lighting query at their actual grid position, so a tail sticking around a corner into darkness will be hidden independently.

### Facing

When `facingEnabled` is `true`, the actor's sprites (base, top, side, and equipment) flip horizontally when the actor moves or attacks left vs. right. The `defaultFacing` field defines which direction the tile art was drawn for — when the actor faces the opposite direction, all sprites mirror and the side tile offset flips. Vertical-only movement preserves the current facing. Actors without `facingEnabled` are completely unaffected.

## Core Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `solid` | boolean | Blocks movement. Default `true`. |
| `visible` | boolean | Rendered on the map. Default `true`. |
| `flammable` | boolean | Can be set on fire. Default `true`. |
| `hostile` | boolean | AI will attack the player. Default `false`. |
| `sentient` | boolean | Can have states (burning, poisoned, etc.) applied. Default `false`. |
| `controlled` | boolean | This is the player character |
| `sighted` | boolean | Uses vision range for AI line-of-sight checks |
| `inventory` | number | Max items this actor can carry |
| `remains` | string | Actor type spawned at this actor's position on death |
| `mass_noun` | boolean | Suppress "the" article — use for clouds, water, etc. |
| `proper_named` | boolean | Suppress "the" article — use for named characters |
| `pack` | boolean | Spawn clustered together (within Manhattan distance 2) instead of scattered |

## Combat Attributes

These attributes factor into the combat formula. Hit probability is `accuracy * 0.987^defense`, clamped to 5–95%.

| Attribute | Type | Description |
|-----------|------|-------------|
| `accuracy` | number | Base chance to hit (0–100). |
| `defense` | number | Reduces attacker's effective hit chance. |
| `strength` | number | Damage multiplier. `10` = 1×, `15` = 1.5× (default: `10`) |

## Stats

Stats track numeric values that change over time or from damage. Define them in the `stats` object.

**Simple format** — just a number:
```json
"stats": { "health": 30 }
```

**Full format** — object with configuration:
```json
"stats": {
  "health": {
    "max": 100,
    "current": 100,
    "per_turn": 0,
    "fatal": true,
    "death_message": "You are dead.",
    "warnings": [
      { "threshold": 0.5, "message": "You are getting hurt." }
    ]
  }
}
```

| Sub-field | Type | Description |
|-----------|------|-------------|
| `max` | number | Maximum value |
| `current` | number | Starting value (defaults to `max`) |
| `per_turn` | number | Applied each turn (negative = drain, positive = regen) |
| `fatal` | boolean | Actor dies if stat reaches 0 (`health` is always fatal) |
| `death_message` | string | Message shown to player when this stat kills them |
| `warnings` | array | Threshold messages — `threshold` is a fraction of `max` (0–1) |
| `condition_state` | object | Apply a state when stat crosses below a threshold. `{ "state": "starving", "threshold": 0.1 }` — state is removed when stat recovers above the threshold. |

## States

States are temporary conditions. They are defined in `data/states.json` and can be applied through `collision_effect`, item effects, traps, or condition-driven stat thresholds.

States only apply to actors with `sentient: true`, except states with `player_only: true` or `hallucinating: true`, which apply to `controlled` actors instead.

**Built-in states:**

| State | Effect | Immunity Attribute |
|-------|--------|--------------------|
| `burning` | Damage per turn, attached fire visual | `fireproof` |
| `poisoned` | Damage per turn | `poison_immune` |
| `stunned` | Skips turns | — |
| `sleeping` | Skips turns, removed on damage | — |
| `confused` | Random movement | — |
| `paralyzed` | Skips turns | `gas_immune` |
| `hasted` | Extra turn per round | — |
| `slowed` | Skips every other turn | — |
| `regenerating` | Heals per turn | — |
| `flying` | Immune to voids, lava, deep water submersion | — |
| `hallucinating` | Scrambled visuals and tile names | — |
| `starving` | Randomly causes fainting (sleep 2 turns, 8%) or nausea (12%) each turn. Applied automatically when nutrition drops below 10%, removed when it recovers. | — |

### State Properties

| Property | Type | Description |
|----------|------|-------------|
| `duration` | number | Turns the state lasts. Use `-1` for infinite duration (converted to `Infinity` at runtime). |
| `player_only` | boolean | State only applies to `controlled` actors (like `hallucinating`). |
| `random_apply_states` | array | Each turn, rolls for sub-states in order; first success fires and stops. Each entry: `{ "state", "chance", "duration"?, "message"? }` |
| `on_remove_message` | string | Message shown when the state is removed. |

### Condition-Driven States

Stats can automatically apply and remove states based on thresholds using `condition_state`. The state is applied when the stat drops to or below the threshold and removed when it recovers above it. Duration is infinite — the stat condition controls lifetime.

```json
"nutrition": {
    "max": 1000,
    "per_turn": -1,
    "condition_state": {
        "state": "starving",
        "threshold": 0.1
    }
}
```

### Innate States

Actors can spawn with permanent states using the `innate_states` array. These states are applied silently at creation with infinite duration — they never expire.

```json
"innate_states": ["flying"]
```

This is useful for actors that should always have a particular state (e.g., a bat that is always flying).

## Equipment

Actors can carry and equip items. The four equipment slots are:

| Slot | Renders At | Use Case |
|------|-----------|----------|
| `weapon` | (hand) | Melee weapons — used for collision damage |
| `top` | y-2 (above head) | Crowns, halos, horns |
| `middle` | y-1 (head) | Helmets, masks |
| `lower` | y (body) | Armor, cloaks |

### Default Items

```json
"default_items": ["mattock", "torch"]
```

Items listed in `default_items` are added to the actor's inventory on spawn. Weapons auto-equip if the slot is empty. Wearable items auto-equip if stat requirements are met.

## Interaction Attributes

### Doors

| Attribute | Type | Description |
|-----------|------|-------------|
| `openable` | boolean | Actor can be opened (door, chest) |
| `open` | boolean | Current open/closed state |
| `locked` | boolean | Requires a key to open |
| `color_locked` | boolean | Requires a key matching `lock_color` |
| `lock_color` | string | Color name of the lock (`"red"`, `"blue"`, etc.) |
| `random_color` | boolean | Assign a random lock color on spawn |

### Physics

| Attribute | Type | Description |
|-----------|------|-------------|
| `pushable` | boolean | Can be pushed by walking actors |
| `breakable` | boolean | Can be destroyed by mining |
| `break_threshold` | number | Mining damage required to break |
| `lode` | string | Item dropped when mined |
| `lode_chance` | number | Percent chance (0–100) to drop lode item |
| `paint_tile` | string | Tile placed in the world when this actor is destroyed |

### Level Transitions

| Attribute | Type | Description |
|-----------|------|-------------|
| `stairway` | string | `"up"` or `"down"` — triggers level transition |
| `gateway` | boolean | Inter-prototype transition point. Hidden by default; revealed when last floor's win conditions are met. |
| `hidden` | boolean | Actor exists in the world but is not rendered. Used for gateways that appear later. |

## Environmental Actors

| Attribute | Type | Description |
|-----------|------|-------------|
| `liquid` | boolean | Non-solid liquid (player can walk through) |
| `deep` | boolean | Submerges actors that enter (deep water, lava) |
| `light_source` | boolean | Emits light |
| `entry_sound` | string | Sound played when an actor steps onto this tile |

### Lifetime

```json
"lifetime": 5
```

The actor automatically expires after this many turns (no remains spawned). Used for fire, clouds, and temporary effects.

## Collision Effects

The `collision_effect` object defines what happens when an actor is walked into or attacked. Set it as a top-level field (not inside `attributes`).

```json
"collision_effect": { "health": -5 }
```

| Value Type | Effect |
|------------|--------|
| Number | Add to stat (negative = damage). Damage is scaled by attacker's `strength`. |
| Boolean | Set the attribute to that value |
| `"toggle"` | Toggle a boolean attribute |
| String with `{attr}` | Resolve attribute reference (e.g., `"-{strength}"`) |
| `"apply_state": "burning"` | Apply a named state to the target |

Effects only apply if the target has the target attribute. If `health` reaches 0, the actor dies.

### Examples

```json
// Simple melee attack
"collision_effect": { "health": -5 }

// Damage + poison
"collision_effect": { "health": -3, "apply_state": "poisoned" }

// State only (no damage) — e.g., a toad that causes hallucinations
"collision_effect": { "apply_state": "hallucinating" }

// Damage + paralysis
"collision_effect": { "health": "-{strength}", "apply_state": "paralyzed" }

// Key unlocking a door
"collision_effect": { "locked": false }

// Strength-scaled damage (weapon)
"collision_effect": { "health": "-{strength}" }
```

### Collision Sound & Description

```json
"collision_sound": "hit",
"collision_description": "The [actor_name] [attacks.melee_verbs] the [target_name]!"
```

`collision_description` supports `[actor_name]`, `[target_name]`, and table references like `[attacks.melee_verbs]` (draws from a random table).

## Death

```json
"death_sound": "ouch",
"attributes": {
  "remains": "skull"
}
```

| Field | Description |
|-------|-------------|
| `death_sound` | Sound played when actor dies |
| `remains` | Actor type spawned at this position on death |

## Personality (AI)

```json
"personality": "stationed_melee"
```

Personalities are defined in `data/personalities.json`. Each turn, the personality runs through its behavior list until one succeeds.

**Built-in personalities:**

| Personality | Behavior |
|-------------|----------|
| `aggressive_melee` | Attack adjacent, pursue, follow thread, wander |
| `stationed_melee` | Attack adjacent, follow thread, pursue, flee danger |
| `passive_wanderer` | Random walk, flee danger |
| `kobold_miner` | Mine walls, wander |
| `fire_behavior` | Spread to adjacent flammable tiles, burn out |
| `cloud_behavior` | Spread, disperse, affect actors in tile |
| `lava_behavior` | Incinerate targets, generate steam on water |
| `pickpocket` | Steal item from adjacent player, flee toward deep liquid, drop item in |
| `liquid_pooling` | Cellular spread, color mixing |
| `deep_water_behavior` | Water currents, drift items |

## Sound Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `collision_sound` | string | Played on collision/attack |
| `death_sound` | string | Played on death |
| `entry_sound` | string | Played when another actor steps on this tile |

## Actor Examples

```json
// Basic enemy — hostile and sentient override defaults; solid/visible/flammable are inherited
"skeleton": {
  "name": "Skeleton",
  "tileIndexBase": "SKELETON_LEGS",
  "tileIndexTop": "SKULL",
  "tint": "#fffece",
  "personality": "stationed_melee",
  "collision_effect": { "health": -5 },
  "collision_sound": "hit",
  "death_sound": "ouch",
  "stats": { "health": 30 },
  "attributes": {
    "hostile": true,
    "sentient": true,
    "inventory": 1,
    "remains": "skull",
    "accuracy": 60,
    "defense": 5
  }
}

// Color-locked door — flammable: false overrides the default
"locked_door": {
  "name": "Door",
  "tileIndexBase": "OPAQUE_DOOR_BOTTOM",
  "tileIndexTop": "OPAQUE_DOOR_TOP",
  "tileIndexBase_open": "DOOR_OPEN_BOTTOM",
  "tileIndexTop_open": "DOOR_OPEN_TOP",
  "random_color": true,
  "attributes": {
    "flammable": false,
    "openable": true,
    "color_locked": true,
    "open": false,
    "locked": true
  }
}

// Fire — solid: false and flammable: false override defaults
"fire": {
  "name": "Fire",
  "tileIndexBase": "BLANK",
  "tileIndexTop": "BLANK",
  "animationBase": "fire",
  "tint": "#EC7505",
  "flickerTint": true,
  "personality": "fire_behavior",
  "lifetime": 5,
  "damage_per_turn": 10,
  "spread_chance": 0.3,
  "attributes": {
    "solid": false,
    "flammable": false,
    "light_source": true,
    "mass_noun": true
  }
}

// Gateway — overrides all three boolean defaults
"gateway": {
  "name": "Gateway",
  "tileIndexBase": "FLOATING_LEGS_ON_WHITE_UPPER_GRADIENT",
  "tileIndexTop": "OPAQUE_DOOR_TOP",
  "attributes": {
    "solid": false,
    "visible": false,
    "flammable": false,
    "gateway": true,
    "hidden": true
  }
}

// Three-tile actor with facing (side tile mirrors on direction change)
"monkey": {
  "name": "Monkey",
  "tileIndexBase": "LEG",
  "tileIndexTop": "ANIMAL_HEAD",
  "tileIndexSide": "BOX_BOTTOM_RIGHT",
  "sideOffset": { "dx": 1, "dy": 0 },
  "defaultFacing": "left",
  "facingEnabled": true,
  "tint": "#C89664",
  "personality": "pickpocket",
  "collision_effect": { "health": -3 },
  "stats": { "health": 12 },
  "attributes": {
    "hostile": true,
    "sighted": true,
    "sentient": true,
    "inventory": 1,
    "accuracy": 70,
    "defense": 5
  }
}

// Player character — controlled, not hostile (default)
"player": {
  "name": "Player",
  "tileIndexBase": "LEGS",
  "tileIndexTop": "SMILING_FACE",
  "default_items": ["torch"],
  "stats": {
    "health": { "max": 100, "fatal": true },
    "nutrition": {
      "max": 100,
      "per_turn": -1,
      "fatal": true,
      "death_message": "You starve to death!",
      "warnings": [
        { "threshold": 0.5, "message": "You are getting hungry." },
        { "threshold": 0.25, "message": "You are very hungry." },
        { "threshold": 0.1, "message": "You are starving!" }
      ]
    }
  },
  "attributes": {
    "controlled": true,
    "sentient": true,
    "inventory": 5,
    "accuracy": 40,
    "strength": 10
  }
}
```
