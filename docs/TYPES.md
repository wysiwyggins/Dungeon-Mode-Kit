# Types

A **type** is a named bundle of defaults an actor inherits by declaring `"type": "beast"`.

The point is to **say what a thing is once, instead of restating it on every actor**. A rat,
a jackal and a spider are all beasts: each one had to declare `sentient`, `flammable`,
`opaque`, an inventory size and what it leaves behind when it dies. That's five lines of
bookkeeping per creature before you get to the three that make it a *rat*. A type holds the
shared five; the actor keeps the interesting three.

The second benefit is that broad rules become expressible. `states.json` has always had a
`poison_immune` immunity flag, but no actor declared it — annotating every skeleton, ghast
and wraith by hand was more trouble than the feature was worth. `undead` declares it once
and all of them get it.

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

Resolution happens in `Prototype.getActorData()`, which every spawn path funnels through, so
the rest of the engine only ever sees one flat actor definition and needs no knowledge of
types. Results are cached per actor id.

Types are edited by hand for now; the **Actor Editor** (`editors/actor-editor.html`) has a
Type dropdown that shows what the selected type contributes.

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

A type may declare any key an actor can — most usefully `attributes`, `stats` and
`personality`. Three keys are the type's own bookkeeping and are never inherited: `name`,
`description` and `domain`. (Inheriting `name` would rename every beast to "Beast".)

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

## Built-in types

| Type | Grants | Notes |
| ---- | ------ | ----- |
| `beast` | `sentient`, `flammable`, `opaque: false`, `inventory: 0`, `remains: blood` | Says nothing about temper — a deer and a jackal are both beasts, so each declares its own `hostile` |
| `undead` | `sentient`, `flammable`, `hostile`, `dark_vision`, `poison_immune`, `gas_immune`, `remains: skull` | Nothing left to poison and no breath to hold, but fire still finds them |
| `humanoid` | `sentient`, `flammable`, `opaque: false`, `inventory: 1`, `remains: skull` | Upright folk who carry things. No `hostile` — a guard may be friendly |
| `terrain` | `solid`, `flammable: false`, `pushable: false`, `conductive: false`, `remains: rubble` | Mindless, so it can burn or be stuck but never confused |

## Types and states

Types are how the state system gets useful. See [ACTORS.md](ACTORS.md#states) for the full
picture, but in short:

- **Immunities are ordinary attributes.** A state names one (`"immunity": "poison_immune"`),
  and any actor with that attribute is immune. A type is just a convenient place to declare
  it for a whole family.
- **Most states now apply to anything.** `applyState()` works on walls, trees and doors.
  Only states that act on a mind — anything that alters how its holder takes turns, plus the
  player-perception effects — still require `sentient` or `controlled`.

## Adding a type

1. Add an entry to `data/types.json` (or a prototype's `types.json`).
2. Put only what's genuinely shared by the whole family in it. If members disagree about a
   value, leave it out and let each declare its own.
3. Add `"type": "<key>"` to the actors, and delete the attributes the type now supplies.
