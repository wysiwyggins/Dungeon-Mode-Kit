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

The optional `type` key names an entry in `data/types.json` whose defaults an actor
inherits — a bundle of the attributes, stats and personality shared by a whole family, so
each member only declares what makes it distinct.

```json
"rat": {
  "type": "beast",
  "name": "rat",
  "attributes": { "hostile": true, "accuracy": 40 }
}
```

`beast`, `undead`, `humanoid` and `terrain` exist now. See [TYPES.md](TYPES.md) for the
merge rules, how to remove an inherited value, and how to add your own.

## Visual Fields

Actors are two tiles tall: `tileIndexTop` renders at head height (y-1), `tileIndexBase` at foot height (y). Actors can optionally have a third **side tile** at an offset from the base (e.g., a tail).

| Field | Type | Description |
| ------- | ------ | ------------- |
| `tileIndexBase` | string or `{x, y}` | Tile for the actor's base (lower body) |
| `tileIndexTop` | string or `{x, y}` | Tile for the actor's top (head/upper body) |
| `tileIndexSide` | string or `{x, y}` | Tile for a side-attached decorative tile (e.g., tail) |
| `sideOffset` | `{dx, dy}` | Grid offset from base for the side tile (default: `{dx: 1, dy: 0}`) |
| `tileIndexBase_open` | string or `{x, y}` | Base tile when actor is in open state (doors) |
| `tileIndexTop_open` | string or `{x, y}` | Top tile when actor is in open state (doors) |
| `tileIndexBase_toggled` | string or `{x, y}` | Base tile when actor is in toggled state (switches, levers) |
| `tileIndexTop_toggled` | string or `{x, y}` | Top tile when actor is in toggled state (switches, levers) |
| `animationBase` | string | Animation name for base sprite (see [Animated sprites](#animated-sprites)) |
| `animationTop` | string | Animation name for top sprite |
| `animationSide` | string | Animation name for side sprite |
| `flipBaseH` / `flipBaseV` | boolean | Flip base sprite horizontally or vertically |
| `flipTopH` / `flipTopV` | boolean | Flip top sprite horizontally or vertically |
| `flipSideH` / `flipSideV` | boolean | Flip side sprite horizontally or vertically |
| `flipBaseV_toggled` / `flipTopV_toggled` | boolean | Flip applied only while the actor is in its toggled state (levers) |
| `facingEnabled` | boolean | Enable dynamic horizontal flipping based on movement direction |
| `defaultFacing` | string | Canonical orientation of the tile art: `"left"` (default) or `"right"` |
| `effect` | string | Named visual effect from [`data/effects.json`](../data/effects.json), e.g. `"flicker_tint"` (fire, torches) or `"ripple_tint"` (water, liquids) |
| `vision_range` | number | How far this actor can see (default: `8`). Valid as a top-level field or inside `attributes`. |

> **Visual effects:** `effect` names an entry in `data/effects.json`, which a prototype can extend or override with its own `effects.json`. Any effect declared with `"target": "sprite"` is valid here; the editors offer exactly those. An actor has at most one effect — the field is a single string, not a list.
>
> **Deprecated:** `flickerTint: true` and `rippleTint: true` are the old spellings of `effect: "flicker_tint"` and `effect: "ripple_tint"`. They still work, but warn once per key on load. Use `effect`.

### Side Tiles

The side tile sits at the base's vertical level, offset by `sideOffset`. It is purely
cosmetic — no collision footprint — and is lit at its own grid position, so a tail
reaching around a corner into darkness is hidden on its own.

**A zero offset layers instead of extending.** `sideOffset: {"dx": 0, "dy": 0}` puts the
side tile — or a side *animation* — directly over the base tile rather than beside it, so
an actor can keep its own artwork and still burn, smoke or ripple. Because the offset is
zero, the overlay resolves to the actor's own coordinates and is culled and lit exactly
like the base sprite. The tradeoff is that the slot is spent, so an actor doing this can't
also use its side tile for a two-tile body. `hell_hound` is the shipped example.

```json
// A skull that burns, keeping its own tile
"tileIndexBase": "SKULL",
"animationSide": "fire",
"sideOffset": { "dx": 0, "dy": 0 }
```

**Write the offset explicitly when you mean zero.** Omitting `sideOffset` is not the same
as `{dx: 0, dy: 0}` — an absent key means the default `{dx: 1, dy: 0}`, one tile to the
right.

### Facing

With `facingEnabled`, all of an actor's sprites (base, top, side, equipment) mirror when it
moves or attacks left vs. right, and the side offset flips with them. `defaultFacing`
declares which way the art was drawn. Vertical-only movement preserves current facing.

### Animated Sprites

`animationBase` / `animationTop` / `animationSide` name an animation instead of a static
tile. When set, the animation replaces that slot's tile entirely — to animate *over* an
actor's own artwork, use a side animation with a zero `sideOffset` (see [Side Tiles](#side-tiles)).

The available animations are data, not code. They live in **`data/animations.json`**:

```json
{
  "fire":  { "file": "fire-animation.png" },
  "mist":  { "file": "light-smoke-animation.png" },
  "torch": { "file": "torch-animation.png", "speed": 0.2 }
}
```

| Key | Type | Description |
| ----- | ------ | ------------- |
| `file` | string | PNG filename, relative to `assets/sprites/` (or the prototype folder) |
| `speed` | number | Optional PIXI frame advance per tick. Defaults to `0.1` |
| `description` | string | Optional note for whoever reads the file next |

**Adding one is a PNG plus a line of JSON.** The sheet is a horizontal strip of
`TILE_WIDTH`-wide frames; the frame count is read from the image's width, so nothing
declares it. The actor editor's animation dropdowns are built from this file, so a new
entry appears there with no edit.

A prototype can ship its own animations in **`prototypes/<name>/animations.json`**, merged
over the base set, with `file` resolved against the prototype folder — so a sprite only one
prototype needs doesn't have to sit in the shared assets folder:

```json
{ "pac": { "file": "pac-animation.png", "speed": 0.05 } }
```

A prototype entry reusing a base name can only change `speed`; the base artwork wins,
since the texture is already registered. Give genuinely new art a new name.

## Core Attributes

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `description` | string | What this actor is, for info panels — read by `Actor.getDescription()`. A template, resolved and memoized. Says nothing about whether the player has seen or identified the actor; that gating is the caller's job. May be authored at root level or in `attributes` (the constructor bridges root-level ones in). |
| `solid` | boolean | Blocks movement. Default `true`. |
| `visible` | boolean | Rendered on the map. Default `true`. |
| `flammable` | boolean | Can be set on fire. Default `false`. |
| `hostile` | boolean | AI will attack the player. Default `false`. |
| `sentient` | boolean | This actor has a mind: mind-states (sleep, confusion, stun) can be applied to it, telepathy reveals it, and it watches its footing while wandering (won't walk off a cliff unless confused). Usually supplied by a [type](TYPES.md). Default `false`. |
| `controlled` | boolean | This is the player character |
| `pov` | boolean | Point-of-view actor: acts as the field-of-view and camera-follow origin even though it is **not** player-controlled. Use for an AI "hero" in a zero-player observer prototype so a dark/fog level renders around it (it carries the auto-light and the camera follows it). Turn/input logic still keys on `controlled`, not `pov`. |
| `hunts` | string | Names a quarry the `hunt` behavior pursues: an actor **type** to kill (e.g. `"rat"`) or an item **type** to collect (e.g. `"meat"`). Independent of faction/hostility, so a hunter can chase quarry it isn't otherwise hostile to while still attacking its normal enemies. Requires the `hunt` behavior in the actor's personality. |
| `tactician` | boolean | This actor reads fights numerically: info panels it opens include hit chances and hits-to-kill. See [Info Panel](#info-panel). Default `false`. |
| `dark_vision` | boolean | Actor can see and act normally without light (bypasses darkness AI penalties) |
| `opaque` | boolean | Whether this actor blocks line of sight. Independent of `solid`: unset, a solid actor blocks sight and a non-solid one doesn't, so set `opaque: false` for see-through solids (columns, statues, creatures — most types supply it) and `opaque: true` for walkable cover that still hides what's behind it (tall mushrooms). |
| `inventory` | number | Max items this actor can carry |
| `remains` | string | Entity (from `entities.json`) spawned at this actor's position on death |
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
| `melee_immune` | boolean | Cannot be hurt by melee. Blows still swing and connect, they just do nothing. |
| `melee_harmless` | boolean | Cannot hurt anything with melee — the mirror of `melee_immune`, checked on the attacker. |

`melee_immune` and `melee_harmless` are absolutes, applied after the hit roll rather
than as part of it: the attack animates, sounds and consumes the turn, and only the
damage is dropped. Neither makes the target passable, so the attacker still bumps and
stops.

Both are worth granting from a state rather than baking in permanently. Pac's power
pill is the round trip: the player is `melee_harmless` by default so ghosts always win
the exchange, and the `impervious` state suppresses that while granting `melee_immune`,
reversing who eats whom. Without it the outcome depends on who moved first, which is
right for a chess-like game and wrong for this one.

### Rank hierarchies

A third way a blow can come to nothing: the attacker is outranked. Declare an ordered
hierarchy in `prototype.json` and captures follow it — the Animals' Chess (Dou Shou Qi)
rule, where higher takes lower but the weakest piece takes the strongest.

```json
"rank_order": ["rat", "cat", "dog", "wolf", "leopard", "tiger", "lion", "elephant"]
```

The array is actor ids, weakest first. Rank is membership in that list rather than a
number on each actor, so inserting a piece mid-hierarchy is a one-line edit instead of
a renumbering, and the ends of the span are derived — which is what makes the
wrap-around general rather than a rat-vs-elephant special case.

| Matchup | Result |
| --------- | -------- |
| Higher rank attacks lower | Captures |
| Equal rank | Captures — pieces trade |
| Lower rank attacks higher | Blow does nothing |
| First entry attacks last | Captures (the wrap-around) |
| Last entry attacks first | Blow does nothing |

An actor may instead carry a numeric `rank` attribute, which wins over the list — for a
piece that needs a rank without being listed, such as a disguise or a promotion.

The hierarchy is inert unless `rank_order` is declared, and unranked actors are exempt:
if either side has no rank, capture is allowed. A ranked prototype can therefore still
contain ordinary monsters.

Note this gates *damage only*. AI target selection goes through `isEnemyOf`, which is
flat faction membership and knows nothing about rank, so a ranked AI will keep
attacking a piece it cannot take unless its behavior is written to check
`outranksForCapture`.

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
| `cancels` | string or array | Opposed states. Applying one onto the other removes *both* and applies neither — `hasted` cancels `slowed`, so a speed potion drunk while sluggish leaves you at normal speed. Read in both directions, so only one side of a pair declares it. The item still counts as used (consumed and identified). |
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
| `suppresses_attribute` | string or array | Takes an attribute away for the duration, whether it is innate or granted by another state. Wins over any grant. |
| `on_apply_effect` | object | One-off stat/property change applied on start and reversed on removal (`{ "visionRange": -3 }`). |
| `flying` | boolean | Hovers above the ground: no falling into voids, no submersion, immune to ground hazards (lava, fire), doesn't trigger traps or collapse platforms, and liquids don't douse it. |
| `invisible`, `telepathic`, `stuck`, `hallucinating` | boolean | Flags the engine reads directly for that behavior. |

#### Presentation

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `name` | string | Display name, used in the sidebar and damage messages. |
| `tint` | string | Hex color washed over the holder's sprite while active. Innate states don't tint — states listed in `innate_states`, and the `flying` state the `flies` attribute grants, leave the actor's own color alone, since a permanent trait isn't news. They still appear in the sidebar. |
| `effect` | string | Visual effect from `data/effects.json` run on the holder's sprites while active (`"flicker_tint"`). Outranks the actor's own `effect`, which resumes when the state ends. If several active states name one, the most recent wins. |
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

An entry may be an item id (`"torch"`) **or an item type** (`"potion"`), in which case a
random member of that type is rolled per spawn — which is how the `arcane` type starts its
casters with something to read and something to drink.

`default_items` **ignores the `inventory` capacity attribute**: that attribute governs what an
actor can pick up or be looted for at runtime, not what it can start holding. This is why a
`pedestal` or a `chest` holds an item without declaring an `inventory` at all.

A single placement's loadout can be overridden from Tiled with a `default_items` custom
property on the actor object — see
[MAP.md](MAP.md#per-object-property-overrides-actors-layer).

## Interaction Attributes

### Doors & Containers

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `openable` | boolean | Actor can be opened (door, chest) |
| `open` | boolean | Current open/closed state |
| `locked` | boolean | Requires a key to open |
| `color_locked` | boolean | Requires a key matching `lock_color` |
| `lock_color` | string | Color name of the lock (`"red"`, `"blue"`, etc.) |
| `random_color` | boolean | Assign a random lock color on spawn |
| `container` | boolean | This openable is furniture, not a doorway — see below |
| `trap_chance` | number | Percent chance a container is trapped instead of holding loot |
| `smash_loss` | number | Percent chance *per item* that contents are destroyed when it's broken open |

**Containers.** A chest is an ordinary `openable` plus `container: true`. Opening one is the
whole mechanism: `open()` sets `solid: false`, and stepping onto a non-solid actor already
transfers its inventory to you, so bumping a chest lifts the lid and the next step in takes
what's inside. Your pack capacity applies, so a full pack leaves the rest in the chest.

`container` exists because `openable` alone reads as *door* in two places that reason about
doorways: auto-routing treats an unlocked door as passable (it bumps it open and walks
through), and room-mouth detection counts a door tile as an entryway. A chest is neither, so
containers are excluded from both. It also marks a thing as worth a Tab-stop and an info
panel, and makes it a valid machine target — which is why the `pedestal` uses it too.

Contents come from `default_items`, or from a weighted `drops` table rolled once at spawn.
**Authored contents win outright** — they suppress both the roll and the trap, so a chest a
designer filled always yields what they put in it. A trapped container holds nothing and
spends its trap payload (the same `trap_*` keys floor traps use) on whoever opens it.

Don't give a container `swings_shut` — the lid would close as you stepped away, before you
could take anything.

### Physics

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `pushable` | boolean | Can be pushed by walking actors |
| `push_sound` | string | Sound played when this actor is pushed. Overrides the default `push1`. |
| `conductive` | boolean | Bolt attacks pass through this actor to hit targets behind. Default `true` for most actors; set `false` on walls/pillars to block bolts. |
| `reflective` | boolean | Bolts bounce off this actor instead of stopping. The bolt flips off the face it struck (straight back off a corner or lone pillar) and travels on as far as it had already come, or for the rest of its aim if that's farther — so it can come back and hit its caster. Three bounces per bolt, then the next reflector stops it. The `metal_wall` has it. |
| `breakable` | boolean | Can be destroyed by mining |
| `break_threshold` | number | Mining damage required to break. Default `100`. |
| `lode` | string | Item dropped when mined |
| `lode_chance` | number | Percent chance (0–100) to drop lode item |
| `mine_messages` | object | Per-target excavation messages, keyed by the progress band reached: `"25"`, `"50"`, `"75"`, `"100"` (and `"0"` for the first swing when the tool is weak enough to land under 25%). Bands you omit keep the default stone wording, so a wall that declares nothing reads as it always did. Tokens: `[name]`, `[tool_name]`. |
| `dig_chance` | number | Chance a swing bites, `0`–`1`. Overrides the tool's own `dig_chance` — how reliably a swing lands is as much about what you're digging as what you're digging with, and rock turns a blade aside where loose earth doesn't. Set `1` for ground that always yields (a multi-swing dig where every turn visibly advances), or `0` for something no tool can open. Absent, the tool's value applies. |
| `dig_fail_message` | string | Shown when a swing glances off. Authored here it overrides the tool's own message — only the target knows whether it is stone or soil. Pointless alongside `dig_chance: 1`, which never glances. |
| `paint_tile` | string | Named tile that stands for this actor when painting a Tiled map — drawing that tile spawns this actor. Values must be unique across actors, or they collide. Also marks an actor as a "wall the engine may swap", e.g. for a stairway's flanking mounted torches. |
| `ornament` | boolean | Marks a solid as deliberately-placed architecture (a colonnade column, a window grille) rather than part of a wall run. The engine won't repurpose these — a stairway's flanking torches skip them instead of eating the structure a generator just built. Default `false`. |

#### Diggable, walkable actors

A `breakable` actor is normally a wall: you mine it by walking into it, because every
bump interaction is reached through the solid actor at the target tile. Combine
`breakable: true` with `solid: false` and you get something you stand *on* and dig —
a grave, a cairn, a compost heap — which no bump can reach. Those are dug with a
mining tool's **Dig** verb from the inventory, which targets one tile in any
direction including your own, and works whether or not the tool is equipped.

Set `break_threshold` at or below the tool's `mining_power` for a one-action dig; leave
it higher for a multi-swing job. A grave uses `35` (one mattock swing) where a rock wall
takes the default `100` (three).

Two things to know when authoring one:

- Put its loot in `drops`, **not** `default_items`. Walking onto a non-solid actor
  transfers its whole inventory to you automatically, so an inventory would hand the
  player the contents without any digging.
- `render_layer: "bottom"` puts it in the floor plane and tints it like floor, but
  hides `tileIndexTop`/`tileIndexSide` — a bottom-layer actor draws `tileIndexBase`
  only.

### Level Transitions

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `stairway` | string | `"up"` or `"down"` — triggers level transition |
| `hidden` | boolean | Actor exists in the world but is not rendered. |

Taking a stairway is not a free escape. In a multi-floor prototype, any hostile actor standing adjacent to the player and aware of them at the moment of transition follows to the destination floor, arriving beside the player and still hunting. This needs no attribute — being adjacent and alert *is* what makes an actor a pursuer. At most two follow, nearest first. Break line of sight or gain a few tiles of lead and nothing comes with you. Segmented creatures are excluded, and the legacy cross-prototype stairway path never carries followers.

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

### Teleporters

Anything that walks onto a `teleporter` (the player or a monster) comes out at its partner:
another teleporter with the same `machine_id`. If a pad links to several, one is picked at
random. Teleporters with no `machine_id` all link to each other. You arrive on the partner
pad without setting it off, so step off and back on to return. If something solid is
standing on the partner, you land beside it instead.

Linked pads share a color, like levers and gates, so each pair is easy to spot. Auto-explore
and click-to-walk paths route around teleporters, but you can still pick one as your
destination. Place them in Tiled as `teleporter` objects with a `machine_id` property.

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `teleporter` | boolean | Stepping onto this actor sends the mover to a partner teleporter. |
| `teleport_sound` | string | Sound played on a teleport the player sees. Default `magic`. |

### Splitting & Grabbing

Jelly-type actors split when wounded. To *hold* an actor standing on a tile (quicksand
applying `stuck`), use `apply_state` with the `apply_state_on_tile` behavior.

| Attribute / Field | Type | Description |
| ------------------- | ------ | ------------- |
| `splits` | boolean | Actor splits into copies when damaged. |
| `split_min_health` | number | Health floor below which the actor stops splitting (default `2`). |
| `split_into` | string | Actor type spawned for each split-off piece. |
| `split_sound` | string | Sound played on split. |

### Acid

An `acidic` actor corrodes gear, as Brogue's acid mound does. When a weapon lands a blow on it, the weapon loses one point of enchantment. When it lands a blow, one random defense-giving armor piece the victim wears (`top`, `middle` or `lower`) loses one point. Misses and unarmed blows do nothing. Only `enchantable` items corrode, and a `protected` item never does (see Scroll of Protection in ITEMS.md). Corrosion never adds `cursed`. The dungeon's `acid_jelly` (splits) and `acid_mound` (`splits: false`) are both `jelly`-type actors with `acidic: true`.

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `acidic` | boolean | Weapons that hit this actor, and armor this actor hits, lose 1 enchantment. |

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

### Ward Gas

A gas actor with a `ward` attribute affects only the actor types it lists. `types` matches either an actor id (`"skeleton"`) or its actor type (`"undead"`). The ward carries over as the gas spreads, disperses into mist, and merges.

```json
"ward": {
  "types": ["undead"],
  "repel": true,
  "collision_effect": { "health": -1 }
}
```

- `repel`: matching actors won't path, step, or attack into a warded tile, and one caught in the gas spends its turn stepping out.
- `collision_effect`: applied each turn (by `cloud_affect_actors`) to matching actors in the gas only, ignoring `gas_immune`.

`incense_smoke`, released by burning `incense`, is the built-in example.

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

`death_sound` plays on death; the `remains` attribute names an entity spawned in place
(a skull, a corpse). Actors with a `lifetime` expire instead, leaving nothing.

Three ways to leave loot, which compose:

| | Fires | Yields |
| ----------- | ------ | ------------- |
| `remains` | always | one entity |
| `lode` + `lode_chance` | a percentage roll | one item |
| `drops` | always, one winner | one item **or** entity, chosen by weight |

```json
"drops": [
  { "item": "skull", "weight": 50 },
  { "item": "weapon", "weight": 10 },
  { "weight": 40 }
]
```

`drops` is a weighted list of alternatives — exactly one entry wins. Weights are
relative, so they needn't total 100. An entry with **no `item`** is the "nothing"
outcome, which is how a drop chance is expressed without a second attribute.

`item` resolves in order as an item id, an item **type** (`"weapon"` rolls a random
weapon), then an entity id (`"skull"`) — so one table can mix buried treasure with
bare bones. `drop_message` narrates the result, with `[name]` supplying the item's
article-aware name; it also overrides the default wording for a `lode` drop.

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

Movement behaviors route around hazards: any tile holding a live actor with a `damage_type` (lava, fire), unless the mover flies, is `hazard_immune`, or is immune to that type (`fireproof` for fire, `<type>_immune` otherwise). The check is `Actor.isHazardAt`. It only steers route choice, so a confused, pushed or pulled actor can still end up in lava.

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
| `patrol_route` | Walk a fixed loop of waypoints, repeating forever, so the player can learn the route and slip past. The loop is picked on the first turn: the start tile plus up to `patrol_points` room-interior tiles (floor on all eight sides, never a corridor, doorway or wall edge) reachable within `patrol_radius` steps, spread apart and visited nearest-first. Falls through when the target is in sight or the actor is alerted, so put pursuit after it; the actor returns to its route once calm. Skips a waypoint it can't reach after three tries. Used by the `sentry` personality. | `patrol_points` (default: 4, including the start), `patrol_radius` (default: 24) |
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
| `fire_smoke` | Emit a smoke cloud when surrounded by enough fire (cellular automata). | `smoke_type`, `smoke_threshold`, `smoke_chance`, `smoke_cap`, `smoke_lifetime`, `check_cardinal` |
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

## Info Panel

**Hovering** a visible actor opens an info panel describing it; the panel swaps as the
pointer moves between actors and closes when it leaves. **Clicking** is unaffected by the
panel — it travels to the tile, which means attacking whatever is standing there.

The pointer has to *rest* on the actor for `InterfaceManager.HOVER_INFO_DELAY` (260ms)
before the panel opens, so sweeping across a crowded room opens nothing; moving on before
the delay elapses cancels the open rather than opening a panel for an actor the pointer
has already left. The panel then grows in via `InterfaceManager.growBoxOpen` — an empty
box border expanding from the actor's tile to where the panel lands, drawn with the same
box tiles as the panel itself, so it reads as coming *from* the thing you pointed at. The
whole intro is under a tenth of a second, and it's abandoned mid-flight if anything closes
the panel. `growBoxOpen` is generic and knows nothing about actors, so any window can open
this way — pass the tile to grow from and a callback that draws the contents. The keyboard
route opens flat: `Tab` already moved the player's attention to the target, so a second
flourish would only delay it.

The keyboard route is `Tab` to cycle targets, then the confirm key (`Enter` by default),
which looks instead of travelling when the armed target is worth reading about. On
anything else — an item, a frontier tile, a door — it travels as it always did.

The panel is large enough to cover much of the map, so **any action dismisses it**, not
just `Esc`: every key that isn't consumed by a modal closes the panel and then does its
normal job, and `InputManager.onPlayerAction` catches the turn-taking routes that don't
come from a keypress (mouse travel, menu commands). Reading a monster therefore never
costs a keystroke or a turn.

### What earns a panel (`Actor.hasInfoPanel()`)

Not every actor gets one. A door, a stairway, a wall or a lever has nothing to say that
the sidebar's hover line doesn't already say, and the trait sentence would answer
questions nobody asked — *"It does not burn and acts on instinct alone."* — because
`flammable` and `sentient` both speak for their falsy case. So a panel is earned, two
ways:

- an authored **`description`**, the designer saying "this is worth reading about"; or
- **`sentient`**, so a creature always offers its traits and combat forecast even before
  anyone writes its flavour text.

That gives panels to every monster, plus described scenery like `turret`, `fungus` and
`grave`, while doors, stairways, walls, levers and pedestals stay silent.

Fire, gas and liquid are deliberately excluded and should stay that way: dozens are in
play at once, so a panel per tile would fight the map for space while repeating itself.
Their hover name plus the obvious fact that they're dangerous is the whole message.
Adding a `description` to one would opt it in, which is why none has one.

The panel itself is built from three sources, each independently optional:

1. **`description`** — the actor's own text (see [Core Attributes](#core-attributes)).
2. **Traits** — phrases derived from the actor's attributes, joined into one sentence.
3. **Combat forecast** — hit chances and hits-to-kill, both directions. Gated; see below.

### Trait phrasing (`data/attribute-info.json`)

An attribute is only ever mentioned if it has an entry in `data/attribute-info.json`,
which maps an attribute name to the phrase the panel uses. This keeps engine plumbing
(`paint_tile`, `render_layer`, `deferred`) invisible and means a new attribute reveals
nothing until someone writes words for it.

```json
{
  "flies": "flies",
  "flammable": { "true": "burns easily", "false": "does not burn" }
}
```

A string describes the truthy case only. An object may also speak for the falsy case —
which is how "does not burn" gets said at all — and omitting a side keeps it silent.
Phrases are verb phrases with no subject and no trailing period; the panel supplies the
subject and the punctuation, rendering *"It flies and burns easily."* Order in the file
is the order they read, so related traits can be grouped.

Adding a trait needs no engine change.

### Attack states

An actor whose `collision_effect` carries an `apply_state` warns about it in the panel,
one line under the traits:

> Its attack can leave you bleeding.

The wording comes from the state's `name` in `states.json`, lowercased — so a new state
describes itself and needs no engine change.

This line is **not** behind `tactician`. "Its bite makes you bleed" is a qualitative
warning like the traits above it rather than a number, and a player without the combat
forecast is the one who most needs to be told.

It is also honest about whether the state would actually land. `Actor.predictAppliedState`
mirrors the three refusals in `applyState` — perception states that only apply to the
controlled actor, mind states that need something taking turns, and a declared
`immunity` attribute — so a `bloodless` player reading a bat gets no bleeding warning,
because a bat cannot make them bleed. A state-only attack (no `health` in the effect)
still warns, since that is exactly the case worth knowing about.

The same line runs in reverse inside the `tactician` forecast for a weapon that inflicts
a state (*"Your attack can leave it paralyzed."*); no shipped weapon does yet.

### Combat forecast (`tactician`)

The two combat lines appear only when the **viewing** actor has `tactician: true`:

> You have a 49% chance to hit it, and could defeat it in 5 hits.
> It has a 40% chance to hit you, and could defeat you in 7 hits.

This is a per-actor attribute rather than a prototype toggle, so it can be granted or
lost mid-run — by a ring, a state, or the actor the player is currently controlling.
Without it the panel still shows name, description and traits.

The numbers come from `Actor.predictCombat(defender)`, which mirrors the live damage
pipeline (base → critical → backstab → strength → enchantment) and shares its
arithmetic with `applyCollisionEffects` via `Actor.scaleDamage`, so the forecast and the
damage actually dealt cannot drift apart.

Two details worth knowing when authoring:

- **The numbers move.** They are computed against the world right now, so an unaware
  monster shows its backstab figure (3× damage) and that figure changes the moment it
  notices you. A static number would be wrong more often than this is surprising.
- **A best case is only mentioned when it differs.** A weapon with
  `weapon_proc: "critical"` adds *"— 3 with a lucky strike"* only when the critical
  would actually save a swing.

An actor with no `health` stat reports that it cannot be harmed; one whose
`collision_effect` deals no health damage reports that it deals none.

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

// Chest — bump to open, step in to take. Conceals its contents, unlike a pedestal.
"chest": {
  "name": "chest",
  "description": "A stout wooden chest. No telling what is inside until the lid is up.",
  "tileIndexBase": "OPAQUE_DOOR_BOTTOM",
  "tileIndexTop": "UNDERSCORE",
  "tileIndexBase_open": "OPAQUE_DOOR_BOTTOM",
  "tileIndexTop_open": "PRISON_WINDOW",
  "tint": "#8A6233",
  "stats": { "health": 10 },
  "attributes": {
    "solid": true,
    "openable": true,
    "container": true,
    "open": false,
    "breakable": true,
    "drops": [
      { "item": "potion", "weight": 28 },
      { "item": "scroll", "weight": 22 },
      { "item": "staff", "weight": 7 }
    ],
    "trap_chance": 12,
    "smash_loss": 50
  },
  "trap_spawn": "cloud",
  "trap_apply_state": "paralyzed",
  "trap_message": "A needle springs from the lock!"
}

// Fire — non-solid, doesn't re-ignite itself, lights its surroundings
"fire": {
  "name": "Fire",
  "tileIndexBase": "BLANK",
  "tileIndexTop": "BLANK",
  "animationBase": "fire",
  "tint": "#EC7505",
  "effect": "flicker_tint",
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
