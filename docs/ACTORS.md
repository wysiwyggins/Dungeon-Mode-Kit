# Actors

## About Actors

In Dungeon Mode Kit, Actors are the living and environmental objects in the world — enemies, the player, doors, fire, water, walls, and more. Actors have attributes. A designer working with DMK can give an actor any kind of attribute they want, but there are also a lot created already that have existing functionality that can be reused. Additionally there are actor 'types' that works as templates and can be added via the `type` attribute. A type can be loaded this way and its attributes can be overridden (in case, say you want a default Goblin but want to call it a gooblin and make it fireproof).

## An Example Actor From actors.json

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

### Defaults

Some attributes are added to all actors by default—`solid` and `visible`. You can override those by simply adding `solid: false` or `visible: false` to the attributes block. All attributes are optional, including `type`. You can see the existing actor and item types in `/data/types.json`.

### Actor Tiles

Actors have two normal tile slots, implying height. For a one tile actor just use a blank tile in one of the slots. A side tile attribute can be used with an offset value to make a tail or other appendage. Any of these tiles can be flipped vertically or horizontally with an attribute.

Other tile attributes exist for things like open and closed states. Check the existing examples in `data/actors.json` for many, many variations.

There are also a few tiles that are animated even when no turns are being taken in order to represent things like liquid, fire and smoke. Check `actors.json` for examples.

Actors can have a default 'facing' direction that will flip depending on which way they are moving. Set `defaultFacing` to `"left"` or `"right"` to turn it on.

## Core Attributes

While attributes can be arbitrarily invented by designers, here are a few already used by the game system:

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
| `hunts` | string or array | What the `hunt` behavior goes after: actors to kill and items to collect. Each entry is an id (`"rat"`, `"meat"`) or a type that covers every member (`"prey"` for deer and chickens, `"food"`), and a list mixes them freely: `["prey", "meat"]`. Independent of faction/hostility, so a hunter can chase quarry it isn't otherwise hostile to while still attacking its normal enemies. Requires the `hunt` behavior in the actor's personality. Editable in the actor editor's AI section. |
| `seeks` | string or array | Items the `seek_item` behavior picks up, by id or type like `hunts`. Overrides the personality's `item_type`; absent, the personality's applies (and absent there too, any item). Editable in the actor editor. |
| `search_radius` | number | How far `seek_item` looks for items. Overrides the personality's `search_radius` (default 10). The item must also be in sight. |
| `tactician` | boolean | This actor reads fights numerically: info panels it opens include hit chances and hits-to-kill. Default `false`. |
| `dark_vision` | boolean | Actor can see and act normally without light (bypasses darkness AI penalties) |
| `opaque` | boolean | Whether this actor blocks line of sight. Independent of `solid`: unset, a solid actor blocks sight and a non-solid one doesn't, so set `opaque: false` for see-through solids (columns, statues, creatures — most types supply it) and `opaque: true` for walkable cover that still hides what's behind it (tall mushrooms). |
| `inventory` | number | Max items this actor can carry |
| `remains` | string | Entity (from `entities.json`) spawned at this actor's position on death |
| `mass_noun` | boolean | Suppress "the" article — use for clouds, water, etc. |
| `proper_named` | boolean | Suppress "the" article — use for named characters |
| `pack` | boolean | Spawn clustered together (within Manhattan distance 2) instead of scattered |

## Personality

```json
"personality": "stationed_melee"
```

Personalities are defined in `data/personalities.json`. Each turn, the personality runs through its behavior list in order until one returns `true` (succeeds), then stops. Behaviors that return `false` are skipped and the next is tried. This priority ordering is the core of actor AI design — put the most important action first.

## Collision Effects

The `collision_effect` object defines what happens when an actor is walked into or attacked. Set it as a top-level field (not inside `attributes`).

```json
"collision_effect": { "health": -5 }
```

## Combat Attributes

Combat is still in flux and not well balanced. Here are some attributes that already relate to what happens when hostile actors walk into one another:

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `accuracy` | number | Base chance to hit (0–100). |
| `defense` | number | Reduces attacker's effective hit chance. |
| `strength` | number | Damage multiplier. `10` = 1×, `15` = 1.5× (default: `10`) |
| `melee_immune` | boolean | Cannot be hurt by melee. Blows still swing and connect, they just do nothing. |
| `melee_harmless` | boolean | Cannot hurt anything with melee — the mirror of `melee_immune`, checked on the attacker. |

## Rank

Designers who want to make a game more like chess, where pieces have a hierarchy rather than dice-style combat, an actor rank order can be added to a prototype.json file. For more information check [PROTOTYPE.md](./PROTOTYPE.md)

## Stats

Stats track numeric values that change over time or from damage. Define them in the `stats` object.

### Simple Format

```json
"stats": { "health": 30 }
```

### Verbose Format

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

Check examples in `actors.json`. Complicated interdependent stats can be created, like a `nutrition` stat that creates a `starvation` state, a `strength` stat that increases how fast the `nutrition` stat ticks down, or a `health` stat that restores from a `nutrition` state. These are just things that exist now, but new attributes can be made in the same ways. Stat values stay whole numbers and process in JSON order.

## States

States are temporary conditions. They are defined in `data/states.json` and can be applied through `collision_effect`, item effects, traps, or condition-driven stat thresholds.

## Equipment

Actors can carry and equip items. The four equipment slots are:

| Slot | Renders At | Use Case |
| ------ | ----------- | ---------- |
| `weapon` | (hand) | Melee weapons — used for collision damage |
| `top` | y-2 (above head) | Crowns, halos, horns |
| `middle` | y-1 (head) | Helmets, masks |
| `lower` | y (body) | Armor, cloaks |

`middle` is a little confusing, since actors are typically two tiles high. This may not be a good design!

### Default Items

```json
"default_items": ["mattock", "torch"]
```

Items listed in `default_items` are added to the actor's inventory on spawn. Weapons auto-equip if the slot is empty. Wearable items auto-equip if any stat requirements are met.

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
| `unlock_conditions` | array | Locked until all conditions are met; re-locks if they stop. See below |
| `unlock_message` | string | Shown when `unlock_conditions` opens the lock |

### Machines

Actors can be connected together by a `machine_id` attribute (a string like a name or a number). This allows levers and pressure plates to connect to things like gates and item pedestals and teleporters to connect to one another. There are a number of supporting attributes:

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `switchable` | boolean | Actor can be toggled (by bumping it or by another machine). |
| `toggled` | boolean | Current toggle state. Drives the `*_toggled` tile/flip variants. |
| `one_shot` | boolean | Toggles once and then stays put (pressure plate). |
| `pausable` | boolean | Can be paused/resumed by bumping (e.g. a clock countdown). |
| `gate` | boolean | A barrier that receives propagated switch effects. |
| `pedestal` | boolean | Holds an item on display; can also receive switch effects. |
| `lockable` | boolean | Can be locked/unlocked (doors, gates). |
| `display_inventory` | boolean | Renders the actor's first held item as a sprite on top (pedestals). |
| `switch_effects` | object | Attribute to value map applied to linked actors on toggle (e.g. `{ "solid": false, "open": true }`). |
| `switch_message` | string | Message shown when the switch is toggled. `[name]` interpolates the actor's color-aware name (see below). |
| `switch_sound` | string | Sound played when the switch is toggled. |

### Traps

Trap actors are invisible (`visible: false`) until triggered, then fire an effect and reveal themselves. They use the `trap` personality. Check the `actor.json` and `type.json` data files for examples.

## Info Panel

When using the mouse, you can hover over an actor or item to see data-derived info about it. When playing with the keyboard you can tab through visible items and actors to see info about them. Any action dismisses the info window. Actors with descriptions or the sentient attribute currently spawn info windows. If a playable actor has the `tactician` attribute, hovering over actors that can attack shows a forcast of combat odds.

## Sound Attributes

Sounds can be previewed and names can be checked in the sound player (localhost/editors/sound-player.html)

Some attributes that take sound names:

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `collision_sound` | string | Played on collision/attack |
| `death_sound` | string | Played on death |
| `entry_sound` | string | Played when another actor steps on this tile |
