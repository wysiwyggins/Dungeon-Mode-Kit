# Actor System

Actors are defined in `data/actors.json` or prototype-specific `actors.json` files. They are the living and environmental objects in the world — enemies, the player, doors, fire, water, walls, and more. All behavior is data-driven through attributes, stats, states, and personalities.

See [ENTITIES.md](ENTITIES.md) for the base fields (`tint`, `zIndex`, `attributes`, naming) that all entities share.

## Basic Actor Structure

```json
"actor_id": {
  "type": "beast",
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

> **Defaults:** Actors are `solid` and `visible` by default. They are **not** `hostile`, `sentient` or `flammable` by default. Only declare attributes that override these defaults.

## Types

The optional `type` key names an entry in `data/types.json` whose defaults this actor
inherits — a bundle of the attributes, stats and personality shared by a whole family, so
each member only declares what makes it distinct. The actor's own keys always win.

```json
"rat": {
  "type": "beast",
  "name": "rat",
  "attributes": { "hostile": true, "accuracy": 40 }
}
```

`beast`, `undead`, `humanoid` and `terrain` ship by default. See [TYPES.md](TYPES.md) for the
merge rules, how to remove an inherited value, and how to add your own.

## Visual Fields

Actors are two tiles tall: `tileIndexTop` renders at head height (y-1), `tileIndexBase` at foot height (y). Actors can optionally have a third **side tile** at an offset from the base (e.g., a tail).

| Field | Type | Description |
| ------- | ------ | ------------- |
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

The side tile sits at the base's vertical level, offset by `sideOffset`. It is purely
cosmetic — no collision footprint — and is lit at its own grid position, so a tail
reaching around a corner into darkness is hidden on its own.

### Facing

With `facingEnabled`, all of an actor's sprites (base, top, side, equipment) mirror when it
moves or attacks left vs. right, and the side offset flips with them. `defaultFacing`
declares which way the art was drawn. Vertical-only movement preserves current facing.

## Core Attributes

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `solid` | boolean | Blocks movement. Default `true`. |
| `visible` | boolean | Rendered on the map. Default `true`. |
| `flammable` | boolean | Can be set on fire. Default `false`. |
| `hostile` | boolean | AI will attack the player. Default `false`. |
| `sentient` | boolean | This actor has a mind: mind-states (sleep, confusion, stun) can be applied to it, telepathy reveals it, and it watches its footing while wandering (won't walk off a cliff unless confused). Usually supplied by a [type](TYPES.md). Default `false`. |
| `controlled` | boolean | This is the player character |
| `pov` | boolean | Point-of-view actor: acts as the field-of-view and camera-follow origin even though it is **not** player-controlled. Use for an AI "hero" in a zero-player observer prototype so a dark/fog level renders around it (it carries the auto-light and the camera follows it). Turn/input logic still keys on `controlled`, not `pov`. |
| `hunts` | string | Names a quarry the `hunt` behavior pursues: an actor **type** to kill (e.g. `"rat"`) or an item **type** to collect (e.g. `"meat"`). Independent of faction/hostility, so a hunter can chase quarry it isn't otherwise hostile to while still attacking its normal enemies. Requires the `hunt` behavior in the actor's personality. |
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
| ----------- | ------ | ------------- |
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
| ----------- | ------ | ------------- |
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

Two sub-fields relate stats to each other and to attributes without writing code. They
compose — the player uses both, so health regeneration costs food and hunger scales with
strength (see the player example at the end of this doc).

**`restore_from`** — a stat's per-turn *gain* is debited from another stat. Health that
regenerates from `nutrition` stops regenerating when nutrition is empty, and gains only
what nutrition can afford, in whole points. Drains never trigger a transfer, so a stat
already full or pushed negative by a cursed item costs nothing.

**`rate_scaled_by`** — multiplies `per_turn` by `attribute / 10`, so 10 is 1×, 15 is 1.5×,
5 is 0.5×. Works with any attribute, and includes equipment bonuses from `wear_effect`.
Higher strength means the same healing rate but faster hunger.

Stat values stay whole numbers. A fractional rate is banked and spent once it reaches a
whole point — a `-0.8`/turn drain spends `-1` on four turns of every five — so the long-run
average is exact while every displayed value is an integer.

Stats process in JSON order, but `restore_from` debits the source the moment the dependent
stat gains, so either order gives the same result.

## States

States are temporary conditions. They are defined in `data/states.json` and can be applied through `collision_effect`, item effects, traps, or condition-driven stat thresholds.

**Most states apply to any actor** — walls, trees, doors and fire included. A tree can burn, a
pushed boulder can be `stuck` in quicksand.

Two kinds of state are gated, and the gate is **derived from the properties the state
declares** — there is no separate field to set. A wall has no turn to skip and no view to
scramble, so those states have nothing to act on.

| Kind | Requires | Identified by |
| ---- | -------- | ------------- |
| **Mind-states** — change how the holder takes turns | `sentient` or `controlled` | `skip_turn`, `skip_turn_chance`, `skip_every_other_turn`, `extra_turn`, `random_movement`, `hallucinating`, `player_only` |
| **Player-perception states** | `controlled` | `player_only` or `hallucinating` |

Call `applyState()` to affect whatever is there, or `applyCreatureState()` where the caller
specifically means "affect a creature" (a sleep-gas cloud shouldn't put a wall to sleep).

### State Properties

Every property is optional. A state is just a bag of these, so new conditions are authored
in `states.json` without engine changes — see that file for the states that ship.

#### Duration and removal

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `duration` | number | Turns the state lasts. `-1` is infinite (`Infinity` at runtime). Re-applying an active state extends it to the longer of the two rather than stacking. |
| `immunity` | string | Actors with this attribute can't get the state at all. |
| `remove_on_damage` | boolean | Ends when the holder takes damage (sleep). |
| `player_only` | boolean | Only applies to `controlled` actors. |

#### Each turn

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `per_turn_effect` | object | Stat change every turn — `{ "health": -2 }` for poison. Kills the holder if a fatal stat hits 0. |
| `random_apply_states` | array | Rolls for sub-states in order; first success fires and stops. Entries: `{ "state", "chance", "duration"?, "message"? }` |
| `escape_chance` | number | With `stuck`: 0–1 chance per move attempt to break free (default `0.33`). `0` is inescapable. Held by two things at once, the *lowest* chance governs. |

#### How turns are taken

Any of these makes it a mind-state.

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `skip_turn` | boolean | Loses every turn, and is helpless — easier to hit, open to backstab. |
| `skip_every_other_turn` | boolean | Loses alternate turns. |
| `extra_turn` | boolean | Acts twice per round. |
| `random_movement` | boolean | Movement direction is randomized. |
| `skip_turn_chance` | number | 0–1 chance per turn of losing the turn. See below. |

#### Granted traits

While active, the holder behaves as if it had the attribute.

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `grants_immunity` | string | Grants an immunity attribute (`"fireproof"`). |
| `grants_attribute` | string or array | Grants any attribute — `"ignites"` makes the holder set fire to its neighbors. |
| `on_apply_effect` | object | One-off stat/property change applied on start and reversed on removal (`{ "visionRange": -3 }`). |
| `flying` | boolean | Hovers above the ground: no falling into voids, no submersion, immune to ground hazards (lava, fire), doesn't trigger traps or collapse platforms, and liquids don't douse it. |
| `invisible`, `telepathic`, `stuck`, `hallucinating` | boolean | Flags the engine reads directly for that behavior. |

#### Presentation

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `name` | string | Display name, used in the sidebar and damage messages. |
| `tint` | string | Hex color washed over the holder's sprite while active. |
| `effect_description` | string | Second-person flavor line ("Your stomach churns"). |
| `attached_actor` | string | Actor spawned and kept on the holder's tile for the duration (`burning` → `fire`). Follows the holder and is removed with the state. |
| `on_apply_message` / `on_remove_message` | string | Shown on start/end. `[actor_name]` resolves to the holder. |
| `on_apply_sound` / `on_remove_sound` | string | Played on start/end. |

#### Losing a turn at random

`skip_turn_chance` rolls each turn; on a hit the actor loses the turn and the other
`skip_turn_*` keys say what that looked like. If several states roll, the highest chance
wins and supplies the message and spawn.

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `skip_turn_message` | string | Resolves `[token]`s plus `[second person\|third person]` alternatives. |
| `skip_turn_sound` | string | Sound played when the turn is lost. |
| `skip_turn_spawn` | string | Entity from `entities.json` dropped on the tile. |
| `skip_turn_effect` | object | Stat change, same shape as `per_turn_effect`. |

Composing those, a bleeding state is entirely data:

```json
"bleeding": {
    "skip_turn_chance": 0.2,
    "skip_turn_message": "[You stagger as your wound reopens|The [actor_name] staggers, bleeding]!",
    "skip_turn_spawn": "blood",
    "skip_turn_effect": { "health": -3 }
}
```

`skip_turn_message` reads as "You stagger as your wound reopens!" for the player, "The eel
staggers, bleeding!" for anyone else, and "Something staggers…" if the actor is unseen.

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

`innate_states` applies states silently at creation with infinite duration — for actors
that should always have one, like a bat that is always flying.

```json
"innate_states": ["flying"]
```

## Equipment

Actors can carry and equip items. The four equipment slots are:

| Slot | Renders At | Use Case |
| ------ | ----------- | ---------- |
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
| ----------- | ------ | ------------- |
| `openable` | boolean | Actor can be opened (door, chest) |
| `open` | boolean | Current open/closed state |
| `locked` | boolean | Requires a key to open |
| `color_locked` | boolean | Requires a key matching `lock_color` |
| `lock_color` | string | Color name of the lock (`"red"`, `"blue"`, etc.) |
| `random_color` | boolean | Assign a random lock color on spawn |

### Physics

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `pushable` | boolean | Can be pushed by walking actors |
| `push_sound` | string | Sound played when this actor is pushed. Overrides the default `push1`. |
| `conductive` | boolean | Bolt attacks pass through this actor to hit targets behind. Default `true` for most actors; set `false` on walls/pillars to block bolts. |
| `breakable` | boolean | Can be destroyed by mining |
| `break_threshold` | number | Mining damage required to break |
| `lode` | string | Item dropped when mined |
| `lode_chance` | number | Percent chance (0–100) to drop lode item |
| `paint_tile` | string | Named tile that stands for this actor when painting a Tiled map — drawing that tile spawns this actor. Values must be unique across actors, or they collide. Also marks an actor as a "wall the engine may swap", e.g. for a stairway's flanking mounted torches. |
| `ornament` | boolean | Marks a solid as deliberately-placed architecture (a colonnade column, a window grille) rather than part of a wall run. The engine won't repurpose these — a stairway's flanking torches skip them instead of eating the structure a generator just built. Default `false`. |

### Level Transitions

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `stairway` | string | `"up"` or `"down"` — triggers level transition |
| `portal` | boolean | Inter-prototype transition point. Hidden by default; revealed when last floor's win conditions are met. |
| `hidden` | boolean | Actor exists in the world but is not rendered. Used for portals that appear later. |

### Switches & Machines

Switches (levers, pressure plates), gates, pedestals, and clocks form a small machine system.
A `switchable` actor, when toggled, propagates its `switch_effects` to every actor that shares
its `machine_id` — so a lever can open a distant gate, or a pressure plate can drop a barrier.

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `switchable` | boolean | Actor can be toggled (by bumping it or by another machine). |
| `toggled` | boolean | Current toggle state. Drives the `*_toggled` tile/flip variants. |
| `one_shot` | boolean | Toggles once and then stays put (pressure plate). |
| `pausable` | boolean | Can be paused/resumed by bumping (e.g. a clock countdown). |
| `gate` | boolean | A barrier that receives propagated switch effects. |
| `pedestal` | boolean | Holds an item on display; can also receive switch effects. |
| `lockable` | boolean | Can be locked/unlocked (doors, gates). |
| `display_inventory` | boolean | Renders the actor's first held item as a sprite on top (pedestals, jellies that swallowed loot). |

| Field | Type | Description |
| ------- | ------ | ------------- |
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

Actors sharing a `machine_id` are tinted a shared random color from `colors.json` and
store its name as `lock_color` — that color is how a player tells one lever/gate pair from
another, so `switch_message: "You pull [name]."` reads *"You pull the fire brick lever."*
Color-locked doors and keys use the same attribute via a separate pairing pass. Any message
built with `getNameWithArticle()` picks the color up; uncolored actors read as before.

Keep generic names lowercase so they read as prose mid-sentence; reserve capitals for
proper nouns and mark those `proper_named` to suppress the article.

### Splitting & Grabbing

Jelly-type actors split when wounded. To *hold* an actor standing on a tile (quicksand
applying `stuck`), use `apply_state` with the `apply_state_on_tile` behavior.

| Attribute / Field | Type | Description |
| ------------------- | ------ | ------------- |
| `splits` | boolean | Actor splits into copies when damaged. |
| `split_min_health` | number | Health floor below which the actor stops splitting (default `2`). |
| `split_into` | string | Actor type spawned for each split-off piece. |
| `split_sound` | string | Sound played on split. |

### Traps

Trap actors are invisible (`visible: false`) until triggered, then fire an effect and reveal
themselves. They use the `trap` personality. A trap either **spawns a cloud** or **applies an
area effect** — set one style or the other.

| Field | Type | Description |
| ------- | ------ | ------------- |
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
| ----------- | ------ | ------------- |
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
| ------------ | -------- |
| Number | Add to stat (negative = damage). Damage is scaled by attacker's `strength`. |
| Boolean | Set the attribute to that value |
| `"toggle"` | Toggle a boolean attribute |
| String with `{attr}` | Resolve attribute reference (e.g., `"-{strength}"`) |
| `"apply_state": "burning"` | Apply a named state to the target |

Effects only apply if the target has the target attribute. If `health` reaches 0, the actor dies.

### Examples

```json
"collision_effect": { "health": -3, "apply_state": "poisoned" }   // damage + state
"collision_effect": { "apply_state": "hallucinating" }            // state only
"collision_effect": { "health": "-{strength}" }                   // strength-scaled
"collision_effect": { "locked": false }                           // key unlocking a door
```

### Collision Sound & Description

```json
"collision_sound": "hit",
"collision_description": "The [actor_name] [attacks.melee_verbs] the [attacked_actor_name]!"
```

`collision_description` supports `[actor_name]` (the attacker), `[attacked_actor_name]` (the target), `[weapon_name]`, and table references like `[attacks.melee_verbs]` (draws from a random table). The `[a-an]` token resolves the correct indefinite article.

## Death

`death_sound` plays on death; the `remains` attribute names an actor spawned in place
(a skull, a corpse). Actors with a `lifetime` expire instead, leaving nothing.

## Personality (AI)

```json
"personality": "stationed_melee"
```

Personalities are defined in `data/personalities.json`. Each turn, the personality runs through its behavior list in order until one returns `true` (succeeds), then stops. Behaviors that return `false` are skipped and the next is tried. This priority ordering is the core of actor AI design — put the most important action first.

Personality data fields (besides `name`, `hostile`, `behaviors`) are passed to every behavior as the `data` parameter, so any behavior-specific configuration lives directly in the personality object.

**Passive/Utility:**

| Personality | Behavior |
| ------------- | ---------- |
| `passive_wanderer` | Random walk, flee danger |
| `kobold_miner` | Flee danger, defend self, mine nearby wall, wander to wall, random walk |
| `scavenger` | Seek and grab nearby ground items, flee danger, wander (crow) |

**Environmental:**

| Personality | Behavior |
| ------------- | ---------- |
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
| ---------- | ------------- | ------------ |
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
| `requires_liquid` | Aquatic gate — halts the behavior chain (helpless, skips the turn) whenever the actor is stranded out of liquid, and falls through normally while submerged. Place it first in the list (e.g. eel). Pairs with the movement guards that stop the actor beaching itself and the `getEffectiveDefense` penalty that leaves it defenseless on dry land. | — |

**Combat:**

| Behavior | Description | Parameters |
| ---------- | ------------- | ------------ |
| `attack_adjacent` | Melee attack any adjacent controlled actor. | — |
| `defend_self` | Retaliate against last attacker. | — |
| `ranged_attack` | Fire projectile at visible target using actor's `collision_effect`. | `attack_range` (default: 5), `ranged_cooldown` (default: 2) |
| `shoot_at_target` | Stationary turret — shoots inventory ammo at target. | `attack_range` (default: 8) |
| `bolt_attack` | Lightning bolt along line to target on cooldown. | `attack_range`, `bolt_cooldown`, `bolt_damage` |
| `spray_web` | Spray a cone of web actors toward the nearest visible controlled target. Webs are non-solid and apply `stuck` on contact, so the target must struggle free. Cooldown- and line-of-sight-gated, modeled on `bolt_attack`. | `spray_range` (default: 6), `spray_cooldown` (default: 4), `spray_arc` (default: 2, half-width in tiles at max range), `spray_min_distance` (default: 0), `web_type` (default: `'web'`), `spray_sound` |
| `apply_aura` | Chance to apply a status effect to adjacent actors each turn. | `aura_state`, `aura_chance` (default: 25), `aura_duration`, `aura_hostile_only` (default: true) |
| `heal_ally` | Heal the most wounded adjacent non-controlled actor. | `heal_amount` (default: 5), `heal_sound` (default: `'tone5'`) |

**Detection/Pursuit:**

| Behavior | Description | Parameters |
| ---------- | ------------- | ------------ |
| `guard_area` | Guard home position, alert allies on spotting threat. | `vision_range`, `memory_duration`, `alert_allies` |
| `pursue_intruders` | Chase alerted target, remember last known position. | `memory_duration` |
| `follow_thread` | Follow thread trail entities toward the trail owner. | — |
| `ambush` | Lie in wait just inside a room beside its entryway, springing only when the target comes into view. Keeps ambushers out of corridors and off arbitrary wall corners. Walks toward the nearest ambush spot within `ambush_radius`; falls through to normal pursuit when the target is visible, when already alerted (e.g. after being hit), or when no spot exists. | `ambush_radius` (default: 6) |

**Utility:**

| Behavior | Description | Parameters |
| ---------- | ------------- | ------------ |
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
| `clock_tick` | Convenience composite for clocks: runs `countdown` then `countdown_display` in digit mode on the same turn, so one behavior gives a ticking, self-displaying counter. Always consumes the turn. | `interval` (default: 5, or actor's `clock_interval`), `countdown_event` (default: `toggle_and_propagate`), `countdown_sound` |
| `toggle_and_propagate` | Flip `toggled` attribute and propagate switch effects to linked actors. | — |

**Environmental:**

| Behavior | Description | Parameters |
| ---------- | ------------- | ------------ |
| `fire_spread` | Spread fire to adjacent flammable actors/items. | `spread_chance` |
| `fire_burn_out` | Countdown fire lifetime, damage actors standing in fire. | `damage_per_turn` |
| `cloud_spread` | Expand cloud to adjacent tiles. | `spread_radius`, `spread_turns` |
| `cloud_disperse` | Edge clouds disperse into mist. | `disperse_to`, `disperse_threshold`, `disperse_chance` |
| `cloud_affect_actors` | Apply cloud's collision_effect/apply_state to actors in tile. | — |
| `cloud_lifetime` | Countdown and remove cloud. | — |
| `merge_clouds` | Collapse gas sharing this tile into a single actor with two density levels — cloud absorbs everything, two or more mists concentrate into one cloud. Unlike `avoid_crowding` (which moves same-type actors apart), this merges them. Consumes the turn only when this actor is the one absorbed. | — |
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
| ---------- | ------------- | ------------ |
| `chain_head_ai` | Head segment pursues player, records path for body. | — |
| `chain_body_follow` | Body segment follows previous segment's path. | — |
| `chain_scatter` | Severed body segment wanders randomly. | — |

## Sound Attributes

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `collision_sound` | string | Played on collision/attack |
| `death_sound` | string | Played on death |
| `entry_sound` | string | Played when another actor steps on this tile |

## Actor Examples

```json
// Basic enemy
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

// Color-locked door — needs a key whose lock_color matches
"locked_door": {
  "name": "Door",
  "tileIndexBase": "OPAQUE_DOOR_BOTTOM",
  "tileIndexTop": "OPAQUE_DOOR_TOP",
  "tileIndexBase_open": "DOOR_OPEN_BOTTOM",
  "tileIndexTop_open": "DOOR_OPEN_TOP",
  "random_color": true,
  "attributes": { "openable": true, "color_locked": true, "open": false, "locked": true }
}

// Fire — non-solid, doesn't re-ignite itself, lights its surroundings
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
