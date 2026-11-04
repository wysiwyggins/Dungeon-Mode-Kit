# Items

An item is anything an actor can carry, or that lies on the floor waiting to be carried. Items live in `data/items.json`, and a prototype's own `items.json` adds new ones or changes existing ones. It only needs to say what's different.

This page explains how items are put together and the main ways they act in the game. It doesn't list every attribute. Most are named for what they do, and the item editor (`editors/item-editor.html`) and the existing items in `data/items.json` show them in use. Like Actors, Items can be given new, arbitrary attributes in their data files without causing any issues.

## The big ideas

**An item is mostly its type.** Nearly every item names a `type`, such as `potion`, `scroll`, `weapon` or `wand`. The [type](TYPES.md) offloads item data that gets reused across multiple items in order to keep an items file tidier. For example, a wand of slowness is the `wand` type plus a name and a spell. Types are also loot pools: naming a type where an item is expected (`"ring"` in `random_items`) picks a random member. See [TYPES.md](TYPES.md).

**Values are layered.** An item's final values are built up as type, then spell, then the item's own data, and the later layer wins. So an item can change one detail it inherited and leave the rest alone.

**Three kinds of data.** Root-level fields say how an item looks and how it's identified. `attributes` say what it does. `stats` are meters that change over time, like fuel and charges.

**Items act at certain moments.** Most attributes hook into one of these:

| Moment | What triggers it | Examples |
| --- | --- | --- |
| Carried | Being in an actor's pack | Light, gas, ring bonuses |
| Worn or wielded | Being equipped | Armor, weapons, launchers, mining tools |
| Used | The player picks its verb (Quaff, Read, Zap) | Potions, scrolls, staffs, wands |
| Thrown or struck | Hitting something | Weapon damage, bursting potions, explosives |
| Picked up | Being picked up | Treasure |
| Every turn | Time passing | Burning fuel, recharging |

**What the player knows is part of the item.** Many items start unidentified under a random name, carry a hidden enchantment, or turn out to be cursed. Finding out what they are is part of the game.

## Anatomy

```json
"wand_of_slowness": {
  "type": "wand",
  "tint": "#8888FF",
  "identified_template": "Wand of Slowness",
  "effect_description": "The target slows to a crawl.",
  "attributes": {
    "spell": "slowness"
  }
}
```

### Root-level fields

The `Item` constructor reads a fixed set of root-level fields and ignores any others. When in doubt, put a field in `attributes`.

- **Look:** `name`, `tileIndex`, `tint`, `flipH`, `flipV`, `ignore_darkness`, `vfx` (a looping visual from `data/vfx.json`, like `flicker_tint` on a torch).
- **Identity:** `identified`, `unidentified_template`, `identified_template`, `random_color`, `random_glyph_name`, `template_vars`.
- **Rolled on spawn:** `random_value` (`[min, max]`, for treasure) and `random_effect` (a potion that rolls its effect).
- **Meters:** `stats`.
- **Text:** the description fields below can sit at root level or in attributes.

### Attributes

Attributes are an open set. The engine reads the ones it knows about, and you can add your own for new mechanics without changing the constructor. A few that almost every item has come from its type: `pickupable`, `visible` and `stackable`.

### Stats

Items use the same stat format as actors. A plain number means a full meter (`"charges": 3`). The long form adds behavior:

```json
"stats": {
  "burns": {
    "max": 500,
    "per_turn": -1,
    "display_label": "Fuel",
    "warnings": [{ "threshold": 0.1, "message": "Your torch is almost out!" }]
  }
}
```

`per_turn` drains or refills the meter each turn. `display_label` shows it as a bar in the pack. `warnings` print a message when it drops below a fraction of `max`. Charged items add `ready_at` and `ready_message` (see [Charged items](#charged-items-staffs)).

### Description fields

Four text fields describe an item, each for a different moment. All of them fill in `[bracket]` templates.

| Field | Answers | Notes |
| --- | --- | --- |
| `description` | What is it? | Shown in the info panel. Hidden while the item is unidentified |
| `use_description` | What happened when I used it? | Picks new random words each use. Takes `[item_name]` and `[effect_description]` |
| `effect_description` | What does its effect do? | Shown when the item is identified by use |
| `collision_description` | What happens when I hit something with it? | A weapon's version replaces the wielder's |

Many uses also take `effect_message` and `fail_message` attributes, which replace the built-in result text.

Sounds work the same way. `pickup_sound`, `use_sound`, `attack_sound`, `collision_sound` and `break_sound` each name an entry in `data/sounds.json`.

## Carried

Some items work just by being in the pack:

- **Light.** `light_source` makes an item glow in its own `tint`, on the floor or carried. `true` gives a radius of 5, and a number sets the radius.
- **Gas.** A burning item with `emits` releases a puff of that gas actor every `emit_interval` turns. Incense uses this to keep the undead away.
- **Passive bonuses.** `passive_effect` adds to the carrier's numbers, such as `defense`, `strength` or `health_per_turn`. Rings use this.

### Fuel and toggling

A torch is two items that point at each other with `toggle_to`. The lit one burns its `burns` stat (`per_turn: -1`) and the unlit one holds its fuel (`per_turn: 0`). The `toggle_torch` use action swaps one for the other and carries the current fuel across. Everything else comes from the new item's own data, so each form sets its own burn rate and warnings. When a burning item runs dry it becomes its `burns_out_item`. An item with no `burns` stat never runs out.

## Worn and wielded

`wearable` names a slot: `"top"` (above the head), `"middle"` (the actor's upper tile) or `"lower"` (the base tile). Worn items are drawn on the actor. `wear_effect` changes the wearer while the item is on: numbers add to an attribute, `true`/`false` set it, and `"toggle"` flips it.

```json
"attributes": {
  "wearable": "lower",
  "wear_effect": { "defense": 3 }
}
```

### Weapons

A weapon (`weapon: true`) deals its `collision_effect` to whatever its wielder walks into. Negative `health` is damage. See [COMBAT.md](COMBAT.md) for hit chances and strength.

- `attack_style` changes who a swing reaches: `lunge` (strike from two tiles away), `sweep` (hit everything around) or `penetrate` (hit the creature behind as well).
- `weapon_proc` adds something extra on a hit: `knockback`, `lifesteal` or `critical`.

### Launchers and ammo

A launcher is a weapon that fires other items. Firing is throwing while you wield a launcher that takes the item. `launches` names the ammo it takes. A shot uses the launcher's `launch_range` and `launch_accuracy`, and its damage is the ammo's damage plus the launcher's enchantment, times `launch_multiplier`. Ammo can have a `break_chance` on hitting. Otherwise it lands by the target.

### Mining tools

An equipped tool with `mining: true` digs `breakable` walls when you walk into them. Each swing adds `mining_power` toward the wall's `break_threshold`, and `dig_chance` lets a tool glance off hard rock. Give the tool `use_verb: "Dig"` and `use_effect: "dig"` and it can also dig from the pack, including a grave underfoot.

## Used

An item with a `use_verb` gets a button in the pack. What happens is its `use_effect`, which takes one of three forms.

**Change the user directly** with an object of stats and states:

```json
"use_effect": { "health": 20, "apply_state": "regenerating" }
```

- A number changes that stat, and `"max"` fills it (`"health": "max"`).
- A `<stat>_max` key raises the stat's maximum.
- `apply_state` names a state from `data/states.json`.
- `remove_all_states: true` cures everything.

**Run a named action** such as `identify_item`, `teleport` or `enchant_item`. The list of actions lives in `core/use-actions.js`, with a one-line description of each, and the item editor offers them in a dropdown. `node tools/check-use-actions.mjs` checks that the data only uses actions the engine knows.

**Cast a spell.** `targeted_spell` aims the item's `spell` (staffs and wands), and `cast_spell` casts an area spell on the spot (several scrolls). See [SPELLS.md](SPELLS.md).

Some use options shape the moment itself:

- `consumable` uses the item up.
- `deferred` waits for a follow-up choice, like a picker or aiming, before the item counts as used.
- `use_ceremony` plays a short build-up before a scroll takes effect.

### Charged items (staffs)

Staffs and wands cast spells from a charge meter. `charge_stat` names the meter and `uses` says how many casts a full meter holds. A staff's meter refills over time. A wand's doesn't, though enchanting one adds charges. The item owns its charges and its spell owns what happens, so most staffs are just a spell and a meter:

```json
"staff_of_fireball": {
  "type": "staff",
  "identified_template": "Staff of Fireball",
  "stats": {
    "pow": { "max": 800, "start": 800, "per_turn": 1, "ready_message": "Your [item_name] is fully charged!" }
  },
  "attributes": { "uses": 1, "spell": "fireball" }
}
```

## Thrown and struck

Any item can be thrown. A thrown item applies its `collision_effect` to what it hits, and then either drops or breaks.

- `burst_into` names an actor released where the item lands, like a gas cloud from a thrown flask.
- `explosive` items go off. With `breakable` they explode when thrown and when they catch fire, which is how potions work. Without it they only explode in fire, like a powder keg. `fire_explosion` makes a fireball instead of gas.

An exploding potion with neither `burst_into` nor `fire_explosion` bursts into a cloud that applies its own `use_effect` to anyone standing in it.

## Picked up: treasure

Items of the `treasure` type are banked, not carried. Picking one up adds its value to a running total, named by `tally_as` or by the item's own name, and the sidebar shows each total. Win conditions can check them: `{ "treasure": "ruby", "op": ">=", "value": 100 }`.

## What the player knows

### Identification

An item with `"identified": false` shows its `unidentified_template` until the player learns what it is, then its `identified_template`. Every item of the same kind shares one random name within a run, so learning one teaches them all. Templates fill in `[brackets]`:

- `[color]` is a random color per item kind (needs `random_color`).
- `[glyph_name]` is a random runic name per item kind (needs `random_glyph_name`).
- `[item_name]` is the current display name.
- `[adjectives.yucky]` and similar draw from the word lists in `data/words.json`.

Using an item usually identifies it. Weapons, armor and rings also identify themselves with use: after `id_blows` blows struck or taken, or after `id_turns` turns worn.

### Enchantment and curses

An `enchantable` weapon or armor carries an `enchantment` bonus, shown as a suffix like **Sword +2**. Each point adds a point of damage to a weapon or of defense to armor. `enchant_range` rolls a random enchantment for items placed at random. An item placed by name comes in at +0 unless it sets `enchantment` itself.

A negative enchantment makes the item `cursed`. Cursed equipment can't be taken off once worn.

### Good and bad magic

Detect magic shows each item's polarity, following Brogue. Curses and negative enchantments are bad. Otherwise `magic_polarity` decides, set to `"good"` or `"bad"`. The magic item types default to good, and harmful items override it.

## Aiming

While aiming a throw or a zap, Tab cycles through targets, nearest first. `target_filter` limits what it cycles to:

| Token | Cycles to |
| --- | --- |
| `hostile` | Enemies |
| `ally` | Friendly creatures, for helpful effects |
| `trap` | Revealed traps, to spring them from a distance |
| `tile` | Open floor, for effects that move the caster |

Most items need no filter. Thrown items default to `["hostile", "trap"]` and zapped items to `["hostile"]`. Unidentified items always cycle `["hostile", "ally"]`, so the target list can't give away what an unknown wand does.
