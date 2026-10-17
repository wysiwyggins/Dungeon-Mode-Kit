# Types

A **type** is a named bundle of defaults an entity inherits by declaring `"type": "beast"`.
Both actors and items use them.

The point is to **say what a thing is once, instead of restating it on every entity**. A rat,
a jackal and a spider are all beasts: each one had to declare `sentient`, `flammable`,
`opaque`, an inventory size and what it leaves behind when it dies. That's five lines of
bookkeeping per creature before you get to the three that make it a *rat*. A type holds the
shared five; the actor keeps the interesting three.

The second benefit is that broad rules become expressible. `states.json` has always had a
`poison_immune` immunity flag, but no actor declared it — annotating every skeleton, ghast
and wraith by hand was more trouble than the feature was worth. `undead` declares it once
and all of them get it.

The third is that **membership replaces bookkeeping**. Item types used to be inverted: eight
hollow `items.json` entries held `random_type` arrays pointing down at their members, so
adding a potion meant remembering to edit a list somewhere else. Now an item declaring
`"type": "potion"` *is* a potion, and the spawn pools are derived from that.

## Where types live

Types are **data files, not prototype content** — the same pattern as `actors.json`:

```
data/types.json                   ← the default library
prototypes/<name>/types.json      ← optional; adds to or overrides defaults by name
```

At load, `Prototype.loadAssets()` merges them:

```js
this.types = { ...globalTypes, ...prototypeTypes };
```

Resolution happens in `Prototype.getActorData()` and `Prototype.getItemData()`, which every
spawn path funnels through, so the rest of the engine only ever sees one flat definition and
needs no knowledge of types. Results are cached per entity id.

Both the **Actor Editor** and the **Item Editor** have a Type dropdown showing what the
selected type contributes.

## Domains

One file holds both kinds, so each type says which it is:

```jsonc
"beast":  { "domain": "actor", ... }
"potion": { "domain": "item",  ... }
```

`domain` is enforced. An item resolves only against `domain: "item"` types; an actor resolves
against everything else, so a type predating the field still works. A mismatch logs a warning
and the entity is used as-is.

## Shape

```jsonc
"beast": {
  "name": "Beast",                  // describes the type; NOT inherited
  "domain": "actor",                // reserved; only "actor" resolves today
  "description": "Animals and ...", // describes the type; NOT inherited
  "attributes": {
    "sentient": true,
    "flammable": true,
    "opaque": false,
    "inventory": 0,
    "remains": "blood"
  }
}
```

A type may declare any key its entity can — most usefully `attributes`, `stats` and
`personality`. `description` and `domain` are the type's own bookkeeping and are never
inherited.

`name` is the exception, and it differs by domain. **Actors don't inherit it** — that would
rename every beast to "Beast". **Items do**, because for an item `name` is the unidentified
display noun: you see *a scroll* before you know which one, and all eleven scrolls agree on
it. Item types whose members each have their own noun (`weapon`, `armor`, `staff`, `food`)
simply don't declare one.

## Merge rules

The actor always wins over its type:

| Key | Behavior |
| --- | --- |
| `attributes`, `stats`, `collision_effect` | Merged one level deep — an actor can change a single attribute without restating the bag |
| `default_items` | **Replaced**, so an actor can specify an empty loadout |
| everything else | Replaced wholesale |

```jsonc
// data/types.json
"beast": { "attributes": { "sentient": true, "remains": "blood", "inventory": 0 } }

// data/actors.json
"monkey": {
  "type": "beast",
  "attributes": { "remains": "skull", "inventory": 1 }
}

// resolved: sentient=true (inherited), remains=skull, inventory=1 (both overridden)
```

Types do not inherit from other types. An actor naming a type that doesn't exist logs a warning and is used
as-is.

### Removing an inherited value

An explicit `null` unsets a key the type declared. This is the only way to drop something a
type gives you:

```jsonc
"fire_drake": {
  "type": "beast",
  "attributes": { "flammable": null }
}
```

## Prototype overrides

Every prototype data file adds new entries and overrides existing ones by name. What differs
between them is what overriding an existing entry *does*.

For `actors.json`, the prototype entry is layered over the base one, so an override only
states what it changes and inherits the rest — including the base's `type`:

```jsonc
// prototypes/mine/actors.json — inherits everything else from the base kobold
"kobold": {
  "tint": "#88ddff",
  "attributes": { "hostile": false }
}
```

`attributes` and `stats` merge one level deep here too, and `null` unsets.

For `items.json`, `personalities.json`, `effects.json`, `biomes.json` and `types.json`
itself, a prototype entry replaces the base definition outright — anything it leaves out is
gone, so each definition has to be self-contained.

**So a prototype item that shadows a base item must restate its `type`.** Nothing is layered,
so leaving it out drops the defaults rather than keeping them:

```jsonc
// prototypes/arena/items.json — the type is what keeps this short
"defense_potion": {
  "type": "potion",
  "random_color": null,        // it has a deliberate blue, not a random one
  "tint": "#4444FF",
  "identified": true,
  "attributes": { "use_effect": { "defense": 5 } }
}
```

## Built-in actor types

| Type | Grants | Notes |
| ---- | ------ | ----- |
| `beast` | `sentient`, `flammable`, `hostile`, `opaque: false`, `inventory: 0`, `remains: blood` | Animals and vermin — a mind, but no hands |
| `prey` | as `beast` but `hostile: false`, plus `default_items: [meat]` | Non-hostile animals |
| `undead` | `sentient`, `flammable`, `hostile`, `dark_vision`, `poison_immune`, `gas_immune`, `remains: skull` | Nothing left to poison and no breath to hold, but fire still finds them |
| `humanoid` | `sentient`, `flammable`, `opaque: false`, `inventory: 1`, `remains: skull` | Upright folk who carry things. No `hostile` — a guard may be friendly |
| `arcane` | as `humanoid` but `remains: blood`, plus `default_items: [potion, scroll]` | Spellcasters, who start with something to read and something to quaff |
| `jelly` | `solid`, `sentient`, `flammable`, `hostile`, `accuracy: 50`, `splits`, `split_min_health: 4`, plus the `jelly` personality, a full-block pink sprite, a `health: -2` slime attack and `step_mud` split sound | Splitting slimes. Members override `name` and `tint`; `collision_effect` merges, so a member's own attack keeps the `health: -2` unless it sets `health: null` |
| `terrain` | `solid`, `flammable: false`, `pushable: false`, `conductive: false`, `blocks_diagonal`, `remains: rubble` | Mindless, so it can burn or be stuck but never confused |
| `gas` | `solid: false`, `flies`, `mass_noun`, `flammable: false` | Clouds, mist, smoke |
| `liquid` | `solid: false`, `liquid`, `mass_noun`, `flammable: false`, `spreads: false`, `entry_sound: step_mud` | Water, sewage, quicksand. `paint_tile` stays per-liquid (the Tiled wildcard reads raw defs) |
| `trap` | `solid: false`, `visible`, `hidden`, `trap`, `flammable: false`, `render_layer: bottom` | Random trap placement resolves through the type |
| `doorway` | `openable`, `lockable`, `open: false`, `flammable: false`, `conductive: false`, `blocks_diagonal` | Doors and the gate; `locked`/`swings_shut` are per-door |
| `container` | `solid`, `openable`, `container`, `open: false`, `flammable`, `breakable`, `death_sound: plunk3` | Chests; `drops` and `smash_loss` are per-chest |
| `switch` | `switchable`, `toggled: false` | Levers and pressure plates |

## Built-in item types

Naming one of these instead of an item id spawns a random member — see
[PROTOTYPE.md](PROTOTYPE.md#item-pools-item-types).

| Type | Grants | Notes |
| ---- | ------ | ----- |
| `potion` | `name: potion`, `random_color`, `consumable`, `stackable`, `breakable`, `use_verb: Quaff`, `use_sound: swallow` | color-coded until identified |
| `food` | `consumable`, `stackable`, `mass_noun`, `flammable`, `use_verb: Eat`, `use_sound: swallow` | Members name themselves (meat, apple) |
| `weapon` | `weapon`, `enchantable`, `enchant_range: [-1, 3]`, `attack_sound`, `collision_sound`, `stackable: false` | Damage and reach are per-weapon |
| `armor` | `enchantable`, `enchant_range: [-1, 2]`, `stackable: false` | The slot (`wearable`) is per-piece |
| `staff` | `name`-less, `random_material`, `charge_stat: pow`, `treasure_loot`, `use_verb: Zap` | Recharges over time; `per_turn` is what distinguishes it from a wand |
| `scroll` | `name: scroll`, `random_glyph_name`, `consumable`, `use_ceremony`, `use_verb: Read`, `use_sound: magic` | Titled with nonsense glyphs until read |
| `ring` | `name: ring`, `random_material`, `wearable: ring`, `enchantable`, `enchant_range: [-1, 2]`, `stackable: false` | Material-coded until identified |
| `wand` | `name: wand`, `random_color`, `charge_stat: pow`, `uses: 3`, `spell_range: 50` | Fixed charges, no recharge |
| `treasure` | `treasure`, `pickupable`, `visible`, `ignore_darkness`, `stackable: false`, `flammable: false`; `pool: prototype` | Banked on pickup, never carried. See [Treasure](ITEMS.md#treasure) |

## Types and states

Types are how the state system gets useful. See [ACTORS.md](ACTORS.md#states) for the full
picture, but in short:

- **Immunities are ordinary attributes.** A state names one (`"immunity": "poison_immune"`),
  and any actor with that attribute is immune. A type is just a convenient place to declare
  it for a whole family.
- **Most states now apply to anything.** `applyState()` works on walls, trees and doors.
  Only states that act on a mind — anything that alters how its holder takes turns, plus the
  player-perception effects — still require `sentient` or `controlled`.

## Types and item pools

For items, the type does a second job: it *is* the spawn pool. Every item declaring
`"type": "potion"` is a member, so `item_catalog` and `random_items` can name `potion` and get
a random one — no list to maintain. Adding a potion is one line:

```jsonc
"sleep_potion": {
  "type": "potion",
  "identified_template": "Potion of Slumber",
  "attributes": { "use_effect": { "apply_state": "asleep" } }
}
```

A type can declare `"pool": "prototype"` to keep its pool local. Its pool then holds only items the current prototype defines in its own `items.json`, so a prototype never inherits the base game's members. `treasure` works this way, so a drop table naming `treasure` gives nothing in a prototype that defines no treasure. To use base items anyway, name them in an explicit `item_catalog` pool (`"treasure": { "pool": ["gold_nugget"], "weight": 0 }`, where weight 0 keeps it off the floor and only in loot tables).

An item with no type is in no pool, which is how the torches and keys stay out of the
random draws. For a curated pool that isn't simply "everything of this type", an item entry may
carry an explicit `random_type` array instead; it wins over derived membership.

## Adding a type

1. Add an entry to `data/types.json` (or a prototype's `types.json`), with a `domain`.
2. Put only what's genuinely shared by the whole family in it. If members disagree about a
   value, leave it out and let each declare its own.
3. Add `"type": "<key>"` to the entities, and delete what the type now supplies.
4. Check for code that scans raw definitions instead of resolving them (`getActorData` / `getItemData`). Such code silently loses any attribute that moved into a type. The editors' attribute filters use `resolvedActorAttrs` (editor-constants.js) for this.

A useful check: resolve a member before and after and diff them. If anything changed, the type
is claiming something its members don't actually agree on.
