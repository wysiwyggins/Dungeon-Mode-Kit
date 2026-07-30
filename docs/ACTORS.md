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
| `tileIndexBase_toggled` | string or `{x, y}` | Base tile when actor is in toggled state (switches, levers) |
| `tileIndexTop_toggled` | string or `{x, y}` | Top tile when actor is in toggled state (switches, levers) |
| `animationBase` | string | Animation name for base sprite |
| `animationTop` | string | Animation name for top sprite |
| `animationSide` | string | Animation name for side sprite |
| `flipBaseH` / `flipBaseV` | boolean | Flip base sprite horizontally or vertically |
| `flipTopH` / `flipTopV` | boolean | Flip top sprite horizontally or vertically |
| `flipSideH` / `flipSideV` | boolean | Flip side sprite horizontally or vertically |
| `flipBaseV_toggled` / `flipTopV_toggled` | boolean | Flip applied only while the actor is in its toggled state (levers) |
| `facingEnabled` | boolean | Enable dynamic horizontal flipping based on movement direction |
| `defaultFacing` | string | Canonical orientation of the tile art: `"left"` (default) or `"right"` |
| `flickerTint` | boolean | Sprite color flickers (fire, torches) |
| `rippleTint` | boolean | Sprite color ripples (water, liquids) |
| `vision_range` | number | How far this actor can see (default: `8`). Valid as a top-level field or inside `attributes`. |

> **Tint effects:** `flickerTint: true` and `rippleTint: true` are convenience flags that the engine canonicalizes to its internal `effect` field (`"flicker_tint"` / `"ripple_tint"`). You can also set `"effect"` directly to one of those strings; the boolean forms above are the usual way.

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
| `pov` | boolean | Point-of-view actor: acts as the field-of-view and camera-follow origin even though it is **not** player-controlled. Use for an AI "hero" in a zero-player observer prototype so a dark/fog level renders around it (it carries the auto-light and the camera follows it). Turn/input logic still keys on `controlled`, not `pov`. |
| `hunts` | string | Names a quarry the `hunt` behavior pursues: an actor **type** to kill (e.g. `"rat"`) or an item **type** to collect (e.g. `"meat"`). Independent of faction/hostility, so a hunter can chase quarry it isn't otherwise hostile to while still attacking its normal enemies. Requires the `hunt` behavior in the actor's personality. |
| `sighted` | boolean | Uses vision range for AI line-of-sight checks |
| `dark_vision` | boolean | Actor can see and act normally without light (bypasses darkness AI penalties) |
| `opaque` | boolean | Actor blocks line of sight for vision checks. Default `false` for most actors. |
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
| `restore_from` | string | Name of another stat to debit when this stat gains per-turn. Only applies to gains, not drains. See [Stat Dependencies](#stat-dependencies). |
| `rate_scaled_by` | string | Name of an attribute that scales `per_turn`. Rate is multiplied by `attribute / 10`. See [Stat Dependencies](#stat-dependencies). |

### Stat Dependencies

Stats can depend on other stats or on attributes. These two sub-fields let you create relationships between stats without writing code.

#### `restore_from` — Stat Transfer

Makes a stat's per-turn regeneration cost another stat. Each point gained is subtracted from the source stat.

```json
"health": {
    "max": 50,
    "per_turn": 1,
    "restore_from": "nutrition"
}
```

Every turn that health regenerates, the same amount is deducted from nutrition. If nutrition is empty, health does not regenerate. If nutrition has less than the full amount, health only gains what nutrition can afford — in whole points, so a partial point left in the source is not transferable.

Only per-turn **gains** trigger the transfer. If health is already full or the effective per-turn is negative (e.g., from a cursed item), no nutrition is spent.

#### `rate_scaled_by` — Attribute-Scaled Rate

Scales a stat's `per_turn` rate by an attribute value. The multiplier is `attribute / 10`, so an attribute of 10 means 1x (no change), 15 means 1.5x, and 5 means 0.5x.

```json
"nutrition": {
    "max": 1000,
    "per_turn": -1,
    "rate_scaled_by": "strength"
}
```

With strength 8, the effective drain is `-1 * (8 / 10) = -0.8` per turn. With strength 15, it becomes `-1.5` per turn. Equipment bonuses to the attribute (from `wear_effect`) are included in the calculation.

Works with any attribute — not just the three combat attributes. For custom attributes, the same `value / 10` formula applies.

**Stat values stay whole numbers.** Scaling produces a fractional *rate*, but a fraction is never written into the stat itself — the UI shows stats as integers, and fractions leak into dependent stats through `restore_from`. Instead the leftover fraction is banked per stat and spent once it accumulates to a whole point: a `-0.8`/turn drain spends `-1` on four of every five turns and `0` on the fifth. The long-run average matches the rate exactly (a `-0.8` drain removes exactly 800 over 1000 turns), so scaled rates behave as designed while every displayed value remains an integer.

#### Combining Both

The two fields compose naturally. Rodney's stat block in the dungeon prototype uses both:

```json
"stats": {
    "health": {
        "max": 50,
        "per_turn": 1,
        "restore_from": "nutrition"
    },
    "nutrition": {
        "max": 1000,
        "per_turn": -1,
        "rate_scaled_by": "strength",
        "fatal": true,
        "death_message": "You starve to death!",
        "warnings": [
            { "threshold": 0.5, "message": "You are getting hungry." },
            { "threshold": 0.25, "message": "You are very hungry." },
            { "threshold": 0.1, "message": "You are starving!" }
        ],
        "condition_state": { "state": "starving", "threshold": 0.1 }
    }
}
```

Each turn with strength 8:

1. Health gains 1 (if not full), debiting 1 from nutrition
2. Nutrition drains at `1 * (8 / 10) = 0.8` from its own `per_turn` — applied as a whole point on 4 of every 5 turns (see above), averaging 0.8
3. Total nutrition cost: ~1.8 per turn (healing + hunger)

Equipping a Ring of Strength (+2, total 10) increases the drain to `1 * (10 / 10) = 1.0`, making total cost ~2.0 per turn. A stronger character heals at the same rate but gets hungrier faster.

#### Processing Order

Stats are processed in the order they appear in the JSON definition. When using `restore_from`, the source stat's own per-turn change is applied when it is reached in that order. Both orderings produce correct results — the source stat is debited immediately when the dependent stat gains, regardless of whether the source has been processed yet.

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
| `push_sound` | string | Sound played when this actor is pushed. Overrides the default `push1`. |
| `conductive` | boolean | Bolt attacks pass through this actor to hit targets behind. Default `true` for most actors; set `false` on walls/pillars to block bolts. |
| `breakable` | boolean | Can be destroyed by mining |
| `break_threshold` | number | Mining damage required to break |
| `lode` | string | Item dropped when mined |
| `lode_chance` | number | Percent chance (0–100) to drop lode item |
| `paint_tile` | string | Named tile that stands for this actor when painting a Tiled map — drawing that tile spawns this actor. Values must be unique across actors, or they collide. Also marks an actor as a "wall the engine may swap", e.g. for a stairway's flanking braziers. |
| `ornament` | boolean | Marks a solid as deliberately-placed architecture (a colonnade column, a window grille) rather than part of a wall run. The engine won't repurpose these — a stairway's braziers skip them instead of eating the structure a generator just built. Default `false`. |

### Level Transitions

| Attribute | Type | Description |
|-----------|------|-------------|
| `stairway` | string | `"up"` or `"down"` — triggers level transition |
| `portal` | boolean | Inter-prototype transition point. Hidden by default; revealed when last floor's win conditions are met. |
| `hidden` | boolean | Actor exists in the world but is not rendered. Used for portals that appear later. |

### Switches & Machines

Switches (levers, pressure plates), gates, pedestals, and clocks form a small machine system.
A `switchable` actor, when toggled, propagates its `switch_effects` to every actor that shares
its `machine_id` — so a lever can open a distant gate, or a pressure plate can drop a barrier.

| Attribute | Type | Description |
|-----------|------|-------------|
| `switchable` | boolean | Actor can be toggled (by bumping it or by another machine). |
| `toggled` | boolean | Current toggle state. Drives the `*_toggled` tile/flip variants. |
| `one_shot` | boolean | Toggles once and then stays put (pressure plate). |
| `pausable` | boolean | Can be paused/resumed by bumping (e.g. a clock countdown). |
| `gate` | boolean | A barrier that receives propagated switch effects. |
| `pedestal` | boolean | Holds an item on display; can also receive switch effects. |
| `lockable` | boolean | Can be locked/unlocked (doors, gates). |
| `display_inventory` | boolean | Renders the actor's first held item as a sprite on top (pedestals, jellies that swallowed loot). |

| Field | Type | Description |
|-------|------|-------------|
| `machine_id` | string | Links a switch to its targets. All actors with the same `machine_id` react together. |
| `switch_effects` | object | Attribute → value map applied to linked actors on toggle (e.g. `{ "solid": false, "open": true }`). |
| `switch_message` | string | Message shown when the switch is toggled. `[name]` interpolates the actor's color-aware name (see below). |
| `switch_sound` | string | Sound played when the switch is toggled. |

```json
"lever": {
  "name": "lever",
  "tileIndexBase": "LEVER_BASE",
  "tileIndexTop": "LEVER_HANDLE",
  "tileIndexBase_toggled": "LEVER_HANDLE",
  "tileIndexTop_toggled": "LEVER_BASE",
  "flipBaseV_toggled": true,
  "flipTopV_toggled": true,
  "collision_sound": "push1",
  "attributes": { "solid": true, "switchable": true, "toggled": false },
  "switch_message": "You pull [name].",
  "switch_effects": { "solid": false, "open": true }
}
```

#### Paired Colors

Actors linked by `machine_id` are tinted a shared random color from `colors.json`, and
that color's **name** is stored on each of them as `lock_color`. The color is how a
player tells one lever/gate pair from another, so it appears in descriptive text:

- `switch_message: "You pull [name]."` → *"You pull the fire brick lever."*
- Bumping the linked gate → *"The fire brick gate is locked."*

Color-locked doors and their keys use the same `lock_color` attribute, assigned by a
separate pairing pass. Any message built with `getNameWithArticle()` picks the color up
automatically; uncolored actors read exactly as before (*"You pull the lever."*).

Because generic names are lowercase in the data files, they read as prose mid-sentence.
Reserve capitalized names for proper nouns, and mark those `proper_named` so no article
is prepended.

### Splitting & Grabbing

Jelly-type actors split when wounded.

Jelly-type actors split when wounded. To *hold* an actor that stands on a tile (the "engulf"
hook — e.g. quicksand applying `stuck`), use the `apply_state` attribute together with the
`apply_state_on_tile` behavior (see Environmental behaviors), not the legacy `grab_state` /
`grab_sound` fields below, which have **no readers** and are retained only for reference.

| Attribute / Field | Type | Description |
|-------------------|------|-------------|
| `splits` | boolean | Actor splits into copies when damaged. |
| `split_min_health` | number | Health floor below which the actor stops splitting (default `2`). |
| `split_into` | string | Actor type spawned for each split-off piece. |
| `split_sound` | string | Sound played on split. |
| `grab_state` | string | *(Legacy, unused — use `apply_state` + `apply_state_on_tile` instead.)* |
| `grab_sound` | string | *(Legacy, unused.)* |

### Traps

Trap actors are invisible (`visible: false`) until triggered, then fire an effect and reveal
themselves. They use the `trap` personality. A trap either **spawns a cloud** or **applies an
area effect** — set one style or the other.

| Field | Type | Description |
|-------|------|-------------|
| `trap` | boolean | Marks this actor as a trap. |
| `trap_type` | string | Trap identifier (`"fire"`, `"poison_gas"`, `"paralysis_gas"`, `"confusion_gas"`). |
| `trap_spawn` | string | Actor type to spawn when triggered (cloud style). |
| `trap_spawn_tint` | string | Tint applied to the spawned actor. |
| `trap_collision_effect` | object | Stat effect carried by the spawned cloud (e.g. `{ "health": -3 }`). |
| `trap_apply_state` | string | State applied to the spawned cloud / triggering actor. |
| `trap_effect` | object | Area style — `{ "center": <type>, "radius": <n>, "outer": <type> }`. |
| `trap_message` | string | Message shown when the trap fires. |

## Environmental Actors

| Attribute | Type | Description |
|-----------|------|-------------|
| `liquid` | boolean | Non-solid liquid (player can walk through) |
| `deep` | boolean | Submerges actors that enter (deep water, lava) |
| `light_source` | boolean | Emits light |
| `lightRadius` | number | Light range for a `light_source` actor (overrides the default radius) |
| `entry_sound` | string | Sound played when an actor steps onto this tile |
| `platform` | boolean | Non-solid but stood on like floor — spans voids/liquids (rope bridge, collapsing floor) |
| `collapsible` | boolean | A `platform` that collapses after being stepped on |
| `ignites` | boolean | Sets adjacent flammable actors/items alight (fire, lava) |
| `damage_type` | string | Tags hazard/bolt damage: `"fire"`, `"poison"`, or `"electric"` |

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
"collision_description": "The [actor_name] [attacks.melee_verbs] the [attacked_actor_name]!"
```

`collision_description` supports `[actor_name]` (the attacker), `[attacked_actor_name]` (the target), `[weapon_name]`, and table references like `[attacks.melee_verbs]` (draws from a random table). The `[a-an]` token resolves the correct indefinite article.

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

Personalities are defined in `data/personalities.json`. Each turn, the personality runs through its behavior list in order until one returns `true` (succeeds), then stops. Behaviors that return `false` are skipped and the next is tried. This priority ordering is the core of actor AI design — put the most important action first.

Personality data fields (besides `name`, `hostile`, `behaviors`) are passed to every behavior as the `data` parameter, so any behavior-specific configuration lives directly in the personality object.

**Passive/Utility:**

| Personality | Behavior |
|-------------|----------|
| `passive_wanderer` | Random walk, flee danger |
| `kobold_miner` | Flee danger, defend self, mine nearby wall, wander to wall, random walk |
| `scavenger` | Seek and grab nearby ground items, flee danger, wander (crow) |

**Environmental:**

| Personality | Behavior |
|-------------|----------|
| `fire` | Spread to adjacent flammable tiles, burn out over time |
| `cloud` | Spread, disperse to mist, affect actors, countdown lifetime |
| `mist` | Fade when isolated, affect actors, countdown lifetime |
| `lava` | Incinerate entities, generate steam on adjacent water |
| `liquid_pooling` | Emit clouds (sewage gas), cellular transform (shallow→deep), color mixing |
| `deep_water` | Strip inventory from wading actors, drift ground items, color mixing |
| `quicksand` | Deep liquid that holds standing actors fast (`stuck`), strips inventory, drifts items, color mixing |
| `drain` | Pull items on liquid toward drain |
| `trap` | Check trigger conditions (Brogue-style hidden traps) |
| `timed_switch` | Countdown timer that toggles switch effects at zero (configurable interval and event) |
| `cellular_automaton` | Cellular automaton step (Game of Life rules, configurable) |

### Available Behaviors

Behaviors are the atomic building blocks defined in `behaviors.js`. Each is a function `(actor, data) => boolean`.

**Movement:**

| Behavior | Description | Parameters |
|----------|-------------|------------|
| `random_walk` | Move in a random cardinal direction. Sighted actors avoid pits. | — |
| `pursue_target` | Pathfind toward nearest visible controlled actor. | — |
| `explore` | Auto-explore toward the nearest unvisited area (or nearby item), like a player pressing (x)plore. Keeps its own visited-tile memory (`actor._exploreVisited`), so it works with no player/fog-of-war. Returns false when nothing is left, falling through to `random_walk`. Used by the `hero` personality; shares the engine `computeExploreTarget` core with the player action. | `explore_mark_radius` (default: 1) |
| `hunt` | Pursue the quarry named by the actor's `hunts` attribute — an actor type to kill (moves onto it, biting via attack-on-bump) or an item type to collect. Nearest visible match wins. Independent of faction, so pair it with `attack_adjacent` (kept before it) to also fight normal enemies like the player. Returns false when no quarry is in sight, falling through to `pursue_target`/`random_walk`. | reads `hunts`; item-hunt respects `inventory` capacity |
| `avoid_crowding` | When another same-type actor shares this tile, step to the least-crowded adjacent tile. | — |
| `maintain_distance` | Keep `preferred_distance` tiles from target. Move away if too close, toward if too far. | `preferred_distance` (default: 3) |
| `patrol` | Wander within `patrol_range` of home position. | `patrol_range` |
| `horizontal_bounce` | Walk left/right, reversing on walls. | — |
| `vertical_bounce` | Walk up/down, reversing on walls. | — |
| `flee_from_danger` | Flee harmful tiles, thrown-item hits, or low health. | `health_threshold` (default: 0.25) |

**Combat:**

| Behavior | Description | Parameters |
|----------|-------------|------------|
| `attack_adjacent` | Melee attack any adjacent controlled actor. | — |
| `defend_self` | Retaliate against last attacker. | — |
| `ranged_attack` | Fire projectile at visible target using actor's `collision_effect`. | `attack_range` (default: 5), `ranged_cooldown` (default: 2) |
| `shoot_at_target` | Stationary turret — shoots inventory ammo at target. | `attack_range` (default: 8) |
| `bolt_attack` | Lightning bolt along line to target on cooldown. | `attack_range`, `bolt_cooldown`, `bolt_damage` |
| `apply_aura` | Chance to apply a status effect to adjacent actors each turn. | `aura_state`, `aura_chance` (default: 25), `aura_duration`, `aura_hostile_only` (default: true) |
| `heal_ally` | Heal the most wounded adjacent non-controlled actor. | `heal_amount` (default: 5), `heal_sound` (default: `'tone5'`) |

**Detection/Pursuit:**

| Behavior | Description | Parameters |
|----------|-------------|------------|
| `guard_area` | Guard home position, alert allies on spotting threat. | `vision_range`, `memory_duration`, `alert_allies` |
| `pursue_intruders` | Chase alerted target, remember last known position. | `memory_duration` |
| `follow_thread` | Follow thread trail entities toward the trail owner. | — |

**Utility:**

| Behavior | Description | Parameters |
|----------|-------------|------------|
| `seek_item` | Pathfind toward nearest ground item, pick up when adjacent. | `search_radius` (default: 10), `item_type` (optional filter) |
| `mine_nearby_wall` | Mine adjacent breakable walls with equipped mining tool. | — |
| `wander_to_wall` | Walk toward nearest visible wall (for miners). | — |
| `pickpocket_adjacent` | Steal unequipped item from adjacent player. | — |
| `flee_with_loot` | Flee toward deep liquid and drop stolen items in. | `loot_search_radius` |
| `summon_actor` | Spawn an actor on adjacent floor tile on cooldown with a cap. | `summon_type`, `summon_cooldown` (default: 5), `summon_cap` (default: 3), `summon_sound` |
| `emit_cloud` | Spawn cloud actor at position with global cap. | `emit_from_type`, `emit_type`, `emit_chance` (default: 3), `emit_cap` (default: 12) |
| `blink_away` | Teleport away from an adjacent target (or toward a distant one) on cooldown. Leaves `blink_spawn` actor at origin if set. | `blink_range` (default: 8), `blink_cooldown` (default: 5), `preferred_distance` (default: 4), `blink_spawn` (optional actor type) |
| `countdown` | Decrement counter each turn; at zero, reset and call the behavior named in `countdown_event`. | `interval` (default: 5), `countdown_event` (default: `toggle_and_propagate`), `countdown_sound` |
| `countdown_display` | Update base tile to show remaining countdown as a digit. | `countdown_display` (set to `"digit"`) |
| `toggle_and_propagate` | Flip `toggled` attribute and propagate switch effects to linked actors. | — |

**Environmental:**

| Behavior | Description | Parameters |
|----------|-------------|------------|
| `fire_spread` | Spread fire to adjacent flammable actors/items. | `spread_chance` |
| `fire_burn_out` | Countdown fire lifetime, damage actors standing in fire. | `damage_per_turn` |
| `cloud_spread` | Expand cloud to adjacent tiles. | `spread_radius`, `spread_turns` |
| `cloud_disperse` | Edge clouds disperse into mist. | `disperse_to`, `disperse_threshold`, `disperse_chance` |
| `cloud_affect_actors` | Apply cloud's collision_effect/apply_state to actors in tile. | — |
| `cloud_lifetime` | Countdown and remove cloud. | — |
| `mist_fade` | Isolated mist fades away. | `fade_threshold`, `fade_chance` |
| `incinerate_entities` | Destroy items/actors on lava. | `spawn_on_incinerate` |
| `steam_generation` | Generate steam when adjacent to water. | `steam_type`, `steam_chance` |
| `strip_inventory` | Chance to strip an item from an actor's inventory. | `item_drop_chance` (default: 0.1) |
| `drift_ground_items` | Chance to move ground items to adjacent tiles. | `item_drift_chance` (default: 0.3) |
| `drain_suction` | Pull items on liquid toward drain, delete when adjacent. | `suction_range` (default: 2) |
| `cellular_transform` | Transform actor when surrounded by enough neighbors of a type. | `neighbor_type`, `neighbor_count`, `transform_to`, `check_cardinal` |
| `liquid_color_mix` | Gradually blend tint toward neighboring liquids. | `mix_chance`, `mix_step` |
| `apply_state_on_tile` | Apply a named state (`apply_state`) to actors sharing this tile each turn (e.g. quicksand → `stuck`). | reads `apply_state` |
| `cellular_automaton_step` | Totalistic cellular automaton (configurable survival/birth rules). | `cell_type`, `survive_min`, `survive_max`, `birth_count` |
| `trap_check_trigger` | Check if actor/item triggers hidden trap. | — |

**Chain Creature:**

| Behavior | Description | Parameters |
|----------|-------------|------------|
| `chain_head_ai` | Head segment pursues player, records path for body. | — |
| `chain_body_follow` | Body segment follows previous segment's path. | — |
| `chain_scatter` | Severed body segment wanders randomly. | — |

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

// portal — overrides all three boolean defaults
"portal": {
  "name": "portal",
  "tileIndexBase": "FLOATING_LEGS_ON_WHITE_UPPER_GRADIENT",
  "tileIndexTop": "OPAQUE_DOOR_TOP",
  "attributes": {
    "solid": false,
    "visible": false,
    "flammable": false,
    "portal": true,
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
  "tint": "#a85b27",
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
// Health regeneration costs nutrition; hunger scales with strength
"player": {
  "name": "Player",
  "tileIndexBase": "LEGS",
  "tileIndexTop": "SMILING_FACE",
  "default_items": ["torch"],
  "stats": {
    "health": { "max": 100, "per_turn": 1, "restore_from": "nutrition" },
    "nutrition": {
      "max": 1000,
      "per_turn": -1,
      "rate_scaled_by": "strength",
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
