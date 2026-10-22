# Item System

Items are defined in `data/items.json` or prototype-specific `items.json` files.
Level-specific files are merged with global data at load — only define what's new or different.

## Basic Item Structure

```json
"item_id": {
  "name": "Display Name",
  "tileIndex": "TILE_NAME",
  "tint": "#FFFFFF",
  "attributes": {
    "pickupable": true,
    "visible": true
  }
}
```

---

## Root-Level Properties vs Attributes

Item JSON has two layers, and knowing which layer a property belongs to matters.

**Root-level properties** are a fixed set extracted by name in the `Item` constructor. They control rendering, identification, and stats. You cannot add new root-level properties without modifying engine code — unknown root-level keys are silently ignored.

**Attributes** (inside `"attributes": {}`) are an open-ended key-value store. The engine iterates all of them generically via `setAttribute()`. Designers can add any new gameplay attribute here without engine changes — the rest of the codebase reads them with `getAttribute()` and `hasAttribute()`.

**Rule of thumb:** if the property affects how the item *looks* or *identifies*, it's root-level. If it affects what the item *does*, it's an attribute.

### All root-level properties

| Property | Type | Purpose |
| ---------- | ------ | --------- |
| `name` | string | Display name |
| `tileIndex` | string | Sprite tile name from the tileset |
| `tint` | string | Hex color tint (`"#FF0000"`) |
| `flipH` | boolean | Flip sprite horizontally |
| `flipV` | boolean | Flip sprite vertically |
| `ignore_darkness` | boolean | Render even in unlit tiles |
| `effect` | string | Named visual effect from [`data/effects.json`](../data/effects.json), e.g. `"flicker_tint"` (torches, phials) or `"ripple_tint"`. Deprecated aliases: `flickerTint: true`, `rippleTint: true` |
| `identified` | boolean | `false` = starts unidentified |
| `unidentified_template` | string | Display name before identification |
| `identified_template` | string | Display name after identification |
| `use_description` | string | Message template shown when item is used (see [Description fields](#description-fields)) |
| `effect_description` | string | What the effect does, stated abstractly (see [Description fields](#description-fields)) |
| `template_vars` | object | Additional template substitution variables |
| `random_color` | boolean | Assign a random color per item type |
| `random_glyph_name` | boolean | Assign a random runic name per item type |
| `random_effect` | boolean | Generate a random potion effect |
| `random_value` | `[min, max]` | Random numeric value on spawn (e.g. gold nuggets) |
| `stats` | object | Item stat definitions (charges, fuel, etc.) |

Everything else goes in `attributes`. If you're not sure, put it in `attributes` — that's always safe.

### Description fields

Four fields describe an item to the player. They answer different questions and are
deliberately not merged — a UI picks the one that fits the moment it is describing.
All four resolve templates against the item, and all four are read from attributes
(root-level authoring is bridged in, see the note below).

| Field | Answers | Read by | Behaviour |
| --- | --- | --- | --- |
| `description` | What is it? | `getDescription()` | Memoized — the panel is re-read while browsing, so words must not change between renders. Callers hide it for unidentified items. |
| `use_description` | What happened when I used it? | `getUseDescription()` | Re-rolls random words on every call — read once per use, so variety is the point. Supports `[item_name]` and `[effect_description]`. |
| `effect_description` | What does the effect do? | `getEffectDescription()` | Memoized. Independent of using the item, so a UI can name an effect without implying the player just triggered it. An item with `random_effect` gets this from `templateVars` instead. |
| `collision_description` | What happens when I hit something with it? | combat message templates | Resolved at hit time; a weapon's value overrides the attacker's. |

Actors have their own `description`, read by `Actor.getDescription()` with the same
memoization. It says nothing about whether the player has seen or identified the actor —
that gating belongs to the caller.

> **Note for actors:** The `Actor` constructor has a bridge that copies `collision_sound`, `collision_effect`, `collision_description`, `death_sound`, `death_description` and `description` from root-level into attributes.
>
> **Description fields bridge on items too.** `description`, `use_description`, `effect_description` and `collision_description` (`Item.DESCRIPTION_FIELDS`) may be authored at either level — the `Item` constructor copies root-level ones into attributes, and an explicit attribute wins over a root-level value of the same name. Every *other* root-level key on an item is still dropped unless it is in the extraction list above, so when in doubt use `attributes`.

---

## Core Attributes

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `pickupable` | boolean | Item can be picked up by actors |
| `visible` | boolean | Item is rendered on the map |
| `stackable` | boolean | Multiple instances combine in inventory |
| `consumable` | boolean | Removed from inventory after successful use |
| `flammable` | boolean | Can be destroyed by fire |
| `pickup_sound` | string | Sound on pickup (default `"tone3"`) |
| `use_sound` | string | Sound on use (default `"tone1"`) |
| `description` | string | Shown in inventory action menu |

---

## Equipment (Wearable Items)

'worn' items actually appear on the actor as tiles. Since most actors are two tiles high this doesn't usually conform to traditional helmet/body/legs, but is more like hat/face/legs. I am actually not in love with how this works during play and I've considered turning this off!

### Wearable Slots

| Slot | Position | Use Case |
| ------ | ---------- | ---------- |
| `"top"` | Above actor's head | Crowns, horns |
| `"middle"` | Actor's top tile | Helmets, masks |
| `"lower"` | Actor's base tile | Armor, pants |

### Wear Effects

`wear_effect` modifies the wearer's attributes while the item is equipped.

```json
"attributes": {
  "wearable": "lower",
  "wear_effect": { "defense": 3, "strength": 1 }
}
```

| Value type | On equip | On unequip |
| ------------ | ---------- | ------------ |
| Number | Add to attribute | Subtract from attribute |
| Boolean | Set attribute (stores original) | Restore original |
| `"toggle"` | Toggle attribute | Toggle back |

Effects only apply if the actor already has the target attribute.

---

## Collision Effects

`collision_effect` applies to actors the holder bumps into (melee weapons, keys, etc.).

```json
"attributes": {
  "collision_effect": { "health": -10 }
}
```

| Value type | Effect |
| ------------ | -------- |
| Number | Add to target's stat/attribute (negative = damage) |
| Boolean | Set target's attribute |
| `"toggle"` | Toggle target's attribute |

If `health` drops to 0 or below, the target dies. See [COMBAT.md](COMBAT.md). Effects only apply if the target has the attribute.

### Weapon Attributes

| Attribute | Effect |
| ----------- | -------- |
| `weapon: true` | Marks item as a weapon (affects combat calculations) |
| `attack_style` | Targeting pattern: `"lunge"`, `"sweep"`, or `"penetrate"`. See [COMBAT.md](COMBAT.md) |
| `lunge_range` | Distance to lunge target in tiles (default `2`). Only with `attack_style: "lunge"` |
| `penetrate_depth` | Extra enemies hit behind the primary target (default `1`). Only with `attack_style: "penetrate"` |
| `weapon_proc` | Post-hit proc: `"knockback"`, `"lifesteal"`, or `"critical"` |
| `knockback_distance` | Tiles to push target on knockback hit (default `1`) |
| `lifesteal_percent` | Percent of damage healed on lifesteal hit (default `25`) |
| `critical_chance` | Percent chance for double damage on critical (default `15`) |
| `attack_sound` | Sound played on every swing (hit or miss). Typically `"bow"` (swish). |
| `collision_sound` | Sound played on successful hit. Typically `"hit"`. |
| `enchantable` | Item can receive enchantment bonuses (from scrolls or on spawn) |
| `enchant_range` | `[min, max]` — random enchantment rolled on spawn. E.g. `[-1, 3]`. |
| `id_blows` | Blows struck (weapons) or taken while worn (armor) before the item auto-identifies. Set on the `weapon` and `armor` types; defaults to 20. |
| `nameable` | Once identified, the item's action menu offers **Name**, letting the player give it a name that replaces its own in the pack and in messages (the enchantment still shows). Set on the `weapon` type. |
| `id_turns` | Turns a ring must be worn before it auto-identifies. Set on the `ring` type; defaults to 1500. |

### Launchers and Ammo

A launcher is a weapon that fires other items, modeled on Moria's bows. There's no separate
projectile system: firing is throwing while you wield a launcher that takes the item. You can
throw the ammo with **t**, or press **f** (Fire) to aim the first ammo in your pack that the
wielded launcher takes. The item menu and aiming prompt say "Fire" whenever a throw counts as a shot.

A shot differs from a plain throw in three ways:

- **Range:** the launcher's `launch_range` instead of 10 + strength.
- **Accuracy:** `launch_accuracy` is added to the thrower's accuracy for the hit roll.
- **Damage:** (the ammo's `collision_effect` health + the launcher's enchantment) × `launch_multiplier`.
  Enchantment goes in before the multiplier, as in Moria, which is what makes an enchanted bow strong.

Ammo the launcher doesn't name gets a plain throw, even while it's wielded. Shots that hit count
toward identifying the launcher, like melee blows. The launcher sits in the weapon slot, so wielding
a bow means giving up your melee weapon. It hits for 1 up close.

| Attribute | On | Effect |
| ----------- | ---- | -------- |
| `launches` | launcher | Ammo it fires: an item id or type, or a list (`["arrow", "spike"]`). |
| `launch_multiplier` | launcher | Damage multiplier for shots (Moria: 2 for a short bow, 3 for a long bow, 4 for a composite bow). |
| `launch_range` | launcher | Range of a shot, in tiles. Default `20`. |
| `launch_accuracy` | launcher | Accuracy bonus for shots only; doesn't help melee. |
| `launch_sound` | launcher | Sound when a shot is loosed. Default `"bow"`. |
| `break_chance` | ammo | Percent chance the item breaks when it hits, thrown or fired. Otherwise it drops by the target. Misses always land nearby. Items without it keep `breakable_on_throw` (default: they break on a hit). |

#### Bursting on landing

| Attribute | Effect |
| ----------- | -------- |
| `burst_into` | Actor id spawned where the thrown item lands; the item is used up. There's no accuracy roll and no weapon damage. It bursts on a creature or a flammable obstruction (a tree), but other walls stop it a tile short. Over a void it falls like any thrown item. Gas is started as a spreading cloud and fire burns as usual; any other actor just appears. On a breakable explosive (a potion) it names what the explosion releases instead — see [Explosive Items](#explosive-items). |
| `burst_description` | Message shown when it bursts. `[item_name]` is filled in. Default "The [item_name] bursts!" |

### Mining Tools

| Attribute | Effect |
| ----------- | -------- |
| `mining: true` | Lets the item damage `breakable` actors. Without it, walking into a mineable wall just bumps. |
| `mining_power` | Progress added per successful swing (default `25`). The target breaks once accumulated progress reaches its `break_threshold`, default `100`. |
| `dig_chance` | Chance a swing bites, `0`–`1` (default `1` = always). A glancing swing costs the turn but causes no progress and no wear. A target may override this — soft ground yields to a crude tool that would skitter off rock. |
| `dig_fail_message` | Shown on a glancing swing. A target may override this — see `dig_fail_message` in [ACTORS.md](ACTORS.md#physics), since only the target knows if it's stone or soil. |
| `degrade_per_use` | `condition` spent per *productive* swing. Needs a `condition` stat, or the tool never wears out. |

A mining tool digs walls by being **equipped** and walking into them. Give it
`use_verb: "Dig"` and `use_effect: "dig"` as well, and it also offers a Dig action in
the inventory — the only way to reach a walkable `breakable` such as a grave, and usable
without equipping the tool at all. Equipping is still what lets you bump walls as you
walk and swing the tool at enemies; the Dig verb is the deliberate one-target use.

The verb also has a key: `dig` in the `actions` block of `keybindings.json` (`d` by
default). Carrying exactly one item with `use_verb: "Dig"` — the normal case — goes
straight to the direction picker, so the key is one press plus a direction. Carry two and
it asks which tool first; carry none and it says so without costing a turn. Nothing about
the key is specific to mining: it filters the pack by verb, so any item declaring
`use_verb: "Dig"` is offered.

---

## Use Effects (UI-Triggered)

Items with `use_verb` appear with an action button in the inventory UI.

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `use_verb` | string | Inventory button label (`"Quaff"`, `"Read"`, `"Zap"`) |
| `use_effect` | string or object | What happens on use |
| `use_sound` | string | Sound played on use |
| `use_description` | string | Message shown after use (supports `[item_name]`, `[effect_description]`, `[adjectives.yucky]` etc.) |
| `use_ceremony` | boolean or object | Play a dramatic build-up effect before activation. `true` uses defaults (build sound, darken, flash). Object overrides: `build_sound`, `build_effect`, `release_sound`, `release_effect`, `duration`. |
| `deferred` | boolean | Item effect requires a follow-up UI interaction (picker, aiming); consumption handled after completion |

### Object format — stat and state effects

Pass an object to modify stats, attributes, or apply states directly:

```json
"use_effect": { "health": 20 }
"use_effect": { "apply_state": "poisoned" }
"use_effect": { "health": 15, "apply_state": "regenerating" }
```

### String format — named effects

| Effect string | Description |
| --------------- | ------------- |
| `"targeted_spell"` | Enters aiming mode; fires `spell_effect` at target tile (staffs) |
| `"identify_item"` | Opens item picker; player selects one unidentified item to reveal |
| `"teleport"` | Moves player to a random walkable tile |
| `"reveal_map"` | Marks all tiles on the floor explored, and reveals the machine-link overlay (lines connecting each switch to the gates/doors it drives). A lasting per-level reveal: it persists when you leave the floor and return. See [Magic Mapping](#magic-mapping) |
| `"aggravate_monsters"` | *non-working stub* - All hostile actors on the level become aware of the player |
| `"summon_monsters"` | Spawns 2–4 random monsters adjacent to the player |
| `"recharge_items"` | Restores all `charge_stat` items in inventory to full |
| `"sanctuary"` | Spawns a `glyph_actor` (default `sacred_glyph`) on every floor tile within `effect_radius` steps (default 2), flooding outward so it doesn't pass through walls. The glyph's hostile `ward` keeps hostile creatures out. `effect_message` and `fail_message` replace the built-in result text. |
| `"shatter_walls"` | Destroys breakable solid actors within radius 3; triggers a screen shake, amber flash, and radiating tile fill effect |
| `"targeted_spell"` (bolt) | Bolt spells display a white-blue tile fill along the bolt path with screen shake, instead of a projectile sprite |
| `"darkness_field"` | Extinguishes all light-source items within radius 5 |
| `"enchant_item"` | Opens item picker; player selects an `enchantable` item to increase its enchantment by +1 |
| `"remove_curse"` | Clears `cursed` attribute from all currently equipped items |
| `"detect_magic"` | Senses the polarity of every item on the level (on the floor or carried by a creature) and in the pack. See [Detect Magic](#detect-magic) |
| `"dig"` | Prompts for a tile within one step (including your own) and digs any `breakable` actor there — a grave underfoot, or a wall beside you. Works with the tool **in the pack**: the item you dug with supplies the `mining_power`, `dig_chance` and `condition`, so it needn't be equipped. Digging a wall this way is the same single swing as bumping it while equipped. Requires `mining: true` on the same item. |

### Magic Mapping

`reveal_map` (the Scroll of Magic Mapping) does two things to the current floor:

1. Marks every tile explored, so the layout is remembered under fog of war/darkness.
2. Reveals the **machine-link overlay** — diagrammatic lines connecting each switch
   (lever, pressure plate) to the gates, doors, and pedestals sharing its `machine_id`,
   drawn in that machine's paired color. Only `machine_id` groups are drawn;
   proximity-linked machines are out of scope.

Step 1 is skipped on a fully-lit floor (`darkness: false`) — there's no fog to clear — but
step 2 still applies, so the scroll is useful on bright levels. The message names whatever
actually happened, and reports no effect only on a lit floor with no machines to reveal.

Unlike a timed sense, this is a **lasting reveal of one level**. The floor is recorded in
`engine.mappedFloors`, and its exploration is saved with the rest of the floor state — so
leaving and coming back preserves both the layout and the overlay. The reveal is per-floor:
mapping floor 3 tells you nothing about floor 4. Everything resets on a new game or a
prototype switch.

Authors can also force the overlay on for any floor with the `infrastructureDebugForced`
renderer flag, independent of whether the floor has been mapped.

### Object format — maximums and cures

| Key | Effect |
| ----- | -------- |
| `<stat>_max` | Raises (or lowers) a stat's maximum, moving its current value by the same amount: `"health_max": 10`. Applied before the other keys. |
| `"max"` as a value | Fills the stat to its maximum: `"health": "max"`. |
| `remove_all_states` | `true` clears every state on the user, good and bad alike. |

```json
"use_effect": { "health_max": 10, "health": "max", "remove_all_states": true }
```

### Object format — area effects

Use an object `use_effect` with `apply_state_radius` or `remove_states_radius` for data-driven radius-based effects:

```json
"use_effect": {
  "apply_state_radius": {
    "state": "discordant",
    "radius": 5,
    "filter": "hostile",
    "message": "A wave of discord washes over nearby creatures!",
    "empty_message": "The scroll crumbles, but nothing happens."
  }
}
```

```json
"use_effect": {
  "remove_states_radius": {
    "radius": 5,
    "message": "A nullifying wave strips away all magical effects!",
    "empty_message": "The scroll crumbles, but nothing happens."
  }
}
```

| Property | Type | Description |
| ---------- | ------ | ------------- |
| `state` | string | State to apply (for `apply_state_radius`) |
| `radius` | number | Effect radius in tiles |
| `filter` | string | `"hostile"`, `"friendly"`, or omit for all actors |
| `message` | string | Shown when at least one actor is affected |
| `empty_message` | string | Shown when no actors are in range |

---

## Light Sources

An item with `light_source: true` emits light when carried in an actor's inventory, or when lying on the ground.

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `light_source` | boolean | Emits light; uses item `tint` as light color |
| `lightRadius` | number | Light radius in tiles (default `5`) |
| `lightIntensity` | number | Light strength 0–1 (default `1.0`) |
| `burns_out_item` | string | Item type to replace this one when its `burns` stat hits 0 |
| `burnout_message` | string | Message shown to player when the item burns out |
| `toggle_to` | string | Item type this becomes when toggled by the `toggle_torch` use effect (lit ↔ unlit) |

```json
"torch": {
  "name": "Torch",
  "tileIndex": "BOX_VERTICAL_INVERSE_TOP",
  "tint": "#EC7505",
  "attributes": {
    "pickupable": true,
    "light_source": true,
    "lightRadius": 6,
    "burns_out_item": "torch_unlit",
    "burnout_message": "Your torch burns out."
  },
  "stats": {
    "burns": {
      "max": 500,
      "per_turn": -1,
      "display_label": "Fuel",
      "warnings": [{ "threshold": 0.1, "message": "Your torch is almost out!" }]
    }
  }
}
```

### Lighting, Extinguishing, and Fuel

A lit/unlit pair is defined entirely in data. Each type points at the other with
`toggle_to`, and **each declares its own `burns` block** — the engine holds no fuel
constants. The lit torch burns (`per_turn: -1`); the unlit one holds its reserve
without consuming it (`per_turn: 0`):

```json
"torch_unlit": {
  "attributes": {
    "use_verb": "Light",
    "use_effect": "toggle_torch",
    "toggle_to": "torch"
  },
  "stats": {
    "burns": { "max": 500, "per_turn": 0, "display_label": "Fuel" }
  }
}
```

When an item toggles (via the use verb, or automatically when submerged in deep
liquid), the engine copies only the **current** value across; `max`, `per_turn`,
`display_label`, and `warnings` all come from the destination type's own JSON. So
burn rate, fuel capacity, and warning text are per-item authoring decisions.

Notes:

- An item with **no** `burns` stat is treated as never running out — omit the stat for a permanent lamp.
- Only an item actively consuming fuel (`per_turn` negative) can *burn out*. An unlit torch at 0 fuel is simply empty: it won't trigger `burns_out_item` and can't be relit.
- `burns_out_item` fires when a burning item's fuel reaches 0, replacing it (e.g. a torch becomes `torch_spent`).
- A burning item keeps burning when dropped: floor items with a negative `burns.per_turn` tick once per round, spend fuel, and burn out in place.

### Emitting Gas (Incense)

A burning item with `emits` releases a spreading puff of that gas actor every `emit_interval` turns (default `3`), both when carried and when dropped. `incense` emits `incense_smoke`, whose `ward` attribute repels and harms the undead (see [Ward Gas](ACTORS.md#ward-gas)).

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `emits` | string | Gas actor type released while the item is burning |
| `emit_interval` | number | Turns between puffs (default `3`); waits while dense gas still covers the tile |

---

## Treasure

Items of the `treasure` type are banked, not carried. Picking one up adds its `value` (rolled from `random_value`, or 1 if it has none) to a running total and uses up the item, so it never takes an inventory slot. Only the player banks treasure; a creature that grabs some carries it like anything else.

Each total is named by the item's `tally_as` attribute, or its own name if it has none. The sidebar lists every total the player has, such as "Gold nugget: 34". Where there are totals, the plain Wealth counter isn't shown. Items can share a total: give a thaler `tally_as: "gold"` and it adds to the same line as other gold.

```json
"ruby": {
  "name": "ruby",
  "type": "treasure",
  "tileIndex": "OPAQUE_WHITE_DIAMOND_SUITE",
  "tint": "#E0115F",
  "random_value": [5, 20]
}
```

Win conditions can check totals with `{ "treasure": "ruby", "op": ">=", "value": 100 }`. The treasure pool is local to each prototype (see [Types and item pools](TYPES.md#types-and-item-pools)).

---

## Item Stats

Items support the same stat format as actors. Stats are defined at the top level alongside `attributes`.

Simple form (expands to `{ max: N, current: N }`):

```json
"stats": { "charges": 3 }
```

Extended form:

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

| Stat field | Description |
| ------------ | ------------- |
| `max` | Maximum value |
| `per_turn` | Change each turn (negative depletes, positive recharges) |
| `display_label` | Shows `"Label: current/max"` with a progress bar in the inventory UI |
| `warnings` | Array of `{ threshold, message }` — message fires when stat drops below `threshold × max` |
| `ready_at` | Used with `charge_stat` — minimum value needed to fire |
| `ready_message` | Message shown when a recharging item reaches `ready_at` (supports `[item_name]`) |

A stat with `display_label` is shown automatically in inventory. Items without `charge_stat` or `display_label` show no stat bar.

### Charged Items (Staffs)

Items that recharge and fire spells use `charge_stat` and `uses`:

Both the `staff` and `wand` types declare `use_verb: "Zap"`, which is bound to the `zap`
action (`z` by default). Like `dig`, the key filters the pack by verb rather than by type,
so any item declaring `use_verb: "Zap"` is offered. Carrying exactly one goes straight to
aiming; carry two and it asks which first. Picking one hands off to its `use_effect` —
`targeted_spell` for both, which enters aiming mode.

| Attribute | Description |
| ----------- | ------------- |
| `charge_stat` | Name of the stat that tracks charge |
| `uses` | Number of casts per full charge (determines `ready_at` if not set explicitly) |
| `spell_effect` | Object describing the AoE: `{ "center": "actor_type", "radius": N, "outer": "actor_type" }` |
| `projectile_tile` | Tile name for the projectile animation |
| `projectile_tint` | Hex tint for the projectile |
| `cast_sound` | Sound played on cast |

```json
"staff_of_fireball": {
  "name": "Staff of Fireball",
  "tileIndex": "SOLIDUS",
  "identified": false,
  "unidentified_template": "[substances.substances] staff",
  "identified_template": "Staff of Fireball",
  "attributes": {
    "pickupable": true,
    "use_verb": "Zap",
    "use_effect": "targeted_spell",
    "charge_stat": "pow",
    "uses": 1,
    "spell_effect": { "center": "intense_fire", "radius": 1, "outer": "fire" },
    "projectile_tile": "OPAQUE_INVERSE_DIAMOND_SUITE",
    "projectile_tint": "#FF6600"
  },
  "stats": {
    "pow": {
      "max": 800,
      "per_turn": 1,
      "ready_message": "Your [item_name] is fully charged!"
    }
  }
}
```

### Aim targeting (`target_filter`)

While aiming a throw or a zap, the target-cycling key (`Tab` by default, bound to the
`cycle_target` action) steps through valid targets nearest-first, and the nearest one is
selected automatically when aiming begins. The mouse still overrides the keyboard pick.

`target_filter` is an optional array on an item that says what it may cycle to. Omit it and
the item gets a sensible default — thrown items offer `["hostile", "trap"]`, zapped items
offer `["hostile"]` — so most items need no entry at all.

| Token | Cycles to |
| --- | --- |
| `hostile` | Enemies (hostile personality, `hostile` attribute, or `collision_effect`) |
| `ally` | Non-hostile creatures with a health stat — for beneficial effects |
| `trap` | Traps, so a thrown object can spring one from a safe distance |
| `tile` | Open floor the caster could stand on — for self-teleport effects |

Tokens combine as a union, so `["hostile", "trap"]` cycles both.

```json
"target_filter": ["tile"]
```

**Unidentified items ignore `target_filter` entirely** and offer the same
`["hostile", "ally"]` list as every other unidentified item. This is deliberate: if an
unknown staff skipped your allies, its target list would tell you it was offensive before
you had identified it. Every unknown item cycling the same list means comparing two of them
against each other leaks nothing either. Once identified, the item's real filter applies.

---

## Identification System

Items with `"identified": false` have two display names — an unidentified placeholder and a revealed true name. All instances of the same item type share the same placeholder within a run.

| Field | Description |
| ------- | ------------- |
| `identified` | `false` = item starts unidentified |
| `unidentified_template` | Display name before identification |
| `identified_template` | Display name after identification |
| `random_color` | Assigns a random consistent color per item type; use `[color]` in templates |
| `random_glyph_name` | Assigns a random runic two-word name per item type; use `[glyph_name]` in templates |

Templates support substitution tokens in `[brackets]`:

| Token | Resolves to |
| ------- | ------------- |
| `[color]` | Random color name assigned to this item type (requires `random_color: true`) |
| `[glyph_name]` | Random runic name assigned to this item type (requires `random_glyph_name: true`) |
| `[reagents.reagents]` | Random entry from `data/reagents.json` |
| `[substances.substances]` | Random entry from `data/substances.json` |
| `[adjectives.yucky]` | Random entry from the `adjectives.yucky` list in `data/words.json` |
| `[item_name]` | The item's current display name (identified or not) |

Weapons, armor and rings also identify themselves through use: a weapon after `id_blows` (20) blows struck with it, armor after `id_blows` blows taken while wearing it, and a ring after `id_turns` (1500) turns worn. Both are type attributes, so a prototype can tune them per type or override them on a single item. The counts are kept per item (`combatUseCount`, `wornTurns`) and the info panel shows how many blows or turns remain.

### Potions

```json
"health_potion": {
  "name": "Potion",
  "tileIndex": "FEMALE_SYMBOL",
  "random_color": true,
  "identified": false,
  "unidentified_template": "[color] potion",
  "identified_template": "Potion of Healing",
  "use_description": "The [item_name] tastes [adjectives.wine_descriptions].",
  "attributes": {
    "pickupable": true,
    "stackable": true,
    "consumable": true,
    "use_verb": "Quaff",
    "use_effect": { "health": 20 }
  }
}
```

### Scrolls

```json
"scroll_of_identify": {
  "name": "Scroll",
  "tileIndex": "LATIN_SMALL_LETTER_S",
  "random_glyph_name": true,
  "identified": false,
  "unidentified_template": "[glyph_name] scroll",
  "identified_template": "Scroll of Identify",
  "attributes": {
    "pickupable": true,
    "stackable": true,
    "consumable": true,
    "use_verb": "Read",
    "use_effect": "identify_item"
  }
}
```

---

## Enchantment

Weapons and armor with `enchantable: true` can have an `enchantment` bonus (positive or negative) that modifies their effectiveness.

### Display

Enchanted items show their bonus as a suffix: **Sword +2**, **Chainmail -1**. Items with enchantment 0 show no suffix.

### Effects

- **Weapons**: Each point of enchantment adds 1 extra damage (applied after strength scaling)
- **Armor**: Each point of enchantment adds 1 defense (added to `wear_effect.defense`)

### Spawning with Enchantment

Add `enchant_range` to an item's attributes to roll a random enchantment on spawn:

```json
"sword": {
  "attributes": {
    "enchantable": true,
    "enchant_range": [-1, 3]
  }
}
```

The roll is inclusive: `[-1, 3]` can produce -1, 0, 1, 2, or 3. Items with an explicit `enchantment` value in their data skip the roll.

### Scroll of Enchantment

The `"enchant_item"` use effect opens a picker showing all `enchantable` items in inventory. Selecting one increases its enchantment by +1 and recalculates combat bonuses if the item is equipped.

### Scroll of Protection

The `"protect_item"` use effect (with `deferred: true`) opens the same picker, listing every weapon and wearable in the inventory that isn't already `protected`. The chosen item gains `protected: true`, which makes it immune to `acidic` corrosion (see Acid in ACTORS.md), and its info panel then reads "It is protected from acid." The scroll is defined only in the dungeon prototype, where acid monsters live, so it stays out of other prototypes' scroll pools.

### Detect Magic

`detect_magic` (the Potion of Detect Magic) marks items as detected. A detected item shows an `EVIL_EYE` beside it in the pack: blue for good magic, red for bad. A detected item you can't currently see also gets an eye on the map, and so does an unseen creature carrying one. Plain weapons and armor (enchantment 0) are identified outright, since there's nothing left to learn.

An item's polarity follows Brogue:

1. `cursed` or negative enchantment → bad.
2. Otherwise the `magic_polarity` attribute, `"good"` or `"bad"`. The potion, scroll, staff and wand types default to `"good"`, and harmful items override it with `"bad"`.
3. Otherwise an `enchantable` item with positive enchantment → good.
4. Anything else has no magic and shows nothing.

A `random_effect` potion takes its polarity from its roll: a stat drain is bad, a stat boost good, and a state is bad if it declares `"magic_polarity": "bad"` in `states.json`.

### Cursed Items

Items with negative enchantment are automatically marked `cursed: true` on spawn. Cursed equipment cannot be unequipped — the player sees "The [item] is cursed! You can't remove it." when they try.

The curse is revealed when the item is equipped: "You feel a malevolent force bind the [item] to you!"

**Removing curses**: The `"remove_curse"` use effect (Scroll of Remove Curse) clears the `cursed` attribute from all currently equipped items.

Cursed items can also be defined directly in data:

```json
"cursed_ring": {
  "attributes": {
    "cursed": true,
    "enchantable": true
  },
  "enchantment": -2
}
```

---

## States (apply_state)

Use effects can apply states from `data/states.json` to the user:

```json
"use_effect": { "apply_state": "hasted" }
"use_effect": { "health": 20, "apply_state": "confused" }
```

A state lasts for its `duration` in turns and carries its own effects, messages and
visuals. The named state must exist in `data/states.json`; see
[ACTORS.md](ACTORS.md#state-properties) for the properties a state can declare.

---

## Rings (Passive Items)

Rings provide bonuses while carried in inventory — they don't need to be equipped.

```json
"ring_of_protection": {
  "name": "Ring",
  "tileIndex": "WHITE_RING",
  "random_color": true,
  "identified": false,
  "unidentified_template": "[color] ring",
  "identified_template": "Ring of Protection",
  "attributes": {
    "pickupable": true,
    "passive_effect": { "type": "stat_bonus", "defense": 3 }
  }
}
```

### Passive Effect Types

| Passive key | Effect |
| ------------- | -------- |
| `defense` | Adds to effective defense |
| `strength` | Adds to effective strength |
| `visionRange` | Extends AI detection/vision range |
| `health_per_turn` | Adds to health regeneration rate |
| `nutrition_per_turn` | Modifies nutrition drain rate (positive = slower drain) |
| `recharge_multiplier` | `wear_effect` only, so the ring must be worn: carried staffs recharge this many times faster, raised to the power of (1 + enchantment), and several worn items multiply together. Brogue's ring of wisdom is `1.3`. A cursed ring slows them. Wands don't recharge, so it doesn't touch them. |

Rings can also use `light_source: true` to emit light while carried (no fuel stat needed — glows permanently).

`ring` is an item type: naming it spawns a random ring. Add `"ring"` to `item_catalog` or `random_items` to include rings in a prototype.

---

## Wands (Targeted Charged Items)

Wands are single-target charged items that apply effects at range. Like staves, they use the `targeted_spell` system with `charge_stat` for charge management. Wands recharge over time and use `random_color` for the identification system.

```json
"wand_of_slowness": {
  "name": "Wand of Slowness",
  "tileIndex": "EXCLAMATION_MARK",
  "random_color": true,
  "identified": false,
  "unidentified_template": "[color_name] wand",
  "identified_template": "Wand of Slowness",
  "attributes": {
    "use_verb": "Zap",
    "use_effect": "targeted_spell",
    "deferred": true,
    "charge_stat": "pow",
    "uses": 3,
    "spell_range": 8,
    "spell_effect": {
      "apply_state": "slowed"
    }
  },
  "stats": {
    "pow": { "max": 300, "start": 300, "per_turn": 1 }
  }
}
```

### Spell Effect Properties (Single-Target)

| Property | Type | Effect |
| ---------- | ------ | -------- |
| `apply_state` | string | Apply named state to target actor |
| `remove_states` | boolean | Strip all states from target actor |
| `teleport_target` | boolean | Teleport target to a random walkable tile |
| `beckon_target` | boolean | Pull target toward the caster |
| `target_effect` | object | Stat changes on the target, friend or foe: `{ "health": 15 }` heals |
| `clone_target` | boolean | A copy of the target appears beside it and they split its current health; the copy carries nothing. Not the player or chain creatures |
| `polymorph_target` | boolean, string, string[] or object | The target becomes a random other creature (see `no_polymorph` in [ACTORS.md](ACTORS.md)), keeping its health fraction and what it carries. `true` draws from any creature; an actor id or actor type (or a list of them, e.g. `"beast"`) limits the draw. `{ "floors": "current" }` draws from what can randomly spawn on this floor (biome catalog rows and `random_actors`); give a range instead (`"3-6"` or `[3, 6]`) for those floors |
| `tunnel` | number | Bore this many tiles from the caster toward the aim point, turning breakable obstructions to rubble. Passes through creatures, stops at the first unbreakable solid. Pair with `target_filter: ["tile"]` to aim at walls |
| `fill` | string | Actor spawned over the open ground where the bolt stopped, flooding out from the last open tile before whatever stopped it. Walls contain it, and tiles a solid actor holds are skipped |
| `fill_radius` | number | Reach of `fill` from its center (default `1`) |

`clone_target`, `polymorph_target` and `tunnel` print built-in result messages. Set `effect_message` and `fail_message` on the item's attributes to replace them; both take `[item_name]` and `[target_name]` (capitalized, for the start of a sentence), and polymorph adds `[new_form_name]`. Tunneling only has a `fail_message`.

These can be combined with the area-effect properties (`center`, `radius`, `outer`) used by staves. A spell with only single-target properties fires a projectile but spawns no area actors.

`wand` is an item type: naming it spawns a random wand. Add `"wand"` to `item_catalog` or `random_items` to include wands in a prototype.

---

## Explosive Items

| Attribute | Type | Description |
| ----------- | ------ | ------------- |
| `explosive` | boolean | Item can explode |
| `breakable` | boolean | Item shatters on impact when thrown |
| `fire_explosion` | boolean | Explosion spawns fire instead of a gas cloud |
| `burst_into` | string | Actor the explosion releases, usually a gas actor like `caustic_gas` (see [Bursting on landing](#bursting-on-landing)) |
| `explosion_radius` | number | Radius of fire burst (default `2`) |
| `cloud_lifetime` | number | Lifetime of a gas cloud in turns (default: the gas actor's own `lifetime`, else `10`) |

### Detonation rules

- `explosive` + `breakable` → detonates on throw **and** when ignited by fire (potions)
- `explosive` without `breakable` → detonates **only** when ignited by fire (powder kegs)

**Fire burst** (`fire_explosion: true`): spawns `intense_fire` at center and adjacent tiles, `fire` at the outer radius. Breakable solid actors in range have a 60% chance to be destroyed.

**Burst actor** (`burst_into`): spawns that actor. A gas actor (one with the `cloud` or `mist`
personality) starts as a spreading cloud and keeps its own tint, effects and flammability, so the
gas is defined once in `actors.json` and any trap, vent or item can release it.

**Gas cloud** (neither): spawns a generic `cloud` tinted like the item that applies the item's
`use_effect` to actors standing in it, flammable only with `cloud_flammable: true`. Random-effect
potions use this, since their effect isn't known until rolled.
