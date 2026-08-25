# Entity System

Entity is the base class for all game objects. Every Item and Actor is an Entity. It provides the coordinate system, attribute storage, naming, sound, and serialization that subclasses build on.

## Basic Entity Fields

These fields are set in data files or by the engine at spawn time.

| Field | Default | Description |
| ------- | --------- | ------------- |
| `x`, `y` | required | Map coordinates |
| `type` | required | Entity type identifier string (matches the key in the data JSON) |
| `tint` | `#FFFFFF` | Color tint applied to the sprite. White means no tint. |
| `zIndex` | `1` | Rendering depth. Higher values render on top. Assigned by the renderer, not authored in data — see below. |

### Render order within the entity container

Everything on a tile shares one container, so these values decide what covers what.
The renderer assigns them; the only thing authored in data is an actor's
`render_layer`, which picks its band.

| zIndex | What |
| -------- | ------ |
| 5 | An entity's `fillColor` rectangle (blood, liquid tracks) |
| 6 | An entity's tile sprite (rubble, moss, skull, hole) — floor dressing |
| 6 | An actor with `render_layer: "bottom"` (pressure plate, rope bridge, collapsing floor) |
| 7 | A dropped item on dry land (`ITEM_Z`) |
| 10 / 11 | An actor's base / top sprite — the default band |
| 11 | A dropped item in liquid, so it reads as floating |
| 12 | Fire attached to a burning actor |
| 14 | An actor with `render_layer: "top"` |

The ordering that matters: an item sits **above** floor dressing, because something you
can pick up must never hide under rubble or in a dug-out hole, and **below** actors,
because a creature standing on an item should be drawn over it.

## Attributes System

All game logic data is stored in an **attributes Map**. Attributes are set from the `attributes` object in data JSON and can also be set at runtime by the engine.

```json
"my_entity": {
  "name": "Widget",
  "tileIndex": "SOME_TILE",
  "attributes": {
    "visible": true,
    "solid": false
  }
}
```

Three methods on every entity interact with attributes:

| Method | Description |
| -------- | ------------- |
| `getAttribute(key)` | Returns the value, or `undefined` if not set |
| `setAttribute(key, value)` | Sets a value |
| `hasAttribute(key)` | Returns `true` only if the attribute exists **and** is truthy |

## Common Attributes

These attributes are meaningful on any entity type (Item or Actor).

### Rendering

| Attribute | Type | Description |
|-----------|------|-------------|
| `visible` | boolean | Entity is rendered on the map |
| `solid` | boolean | Entity blocks movement |

### Naming

Entity names are displayed with a "the" article by default (e.g., "the sword", "the goblin"). Two attributes suppress the article:

| Attribute | Type | Description |
|-----------|------|-------------|
| `proper_named` | boolean | Suppresses "the" — use for named characters (e.g., "Gandalf") |
| `mass_noun` | boolean | Suppresses "the" — use for uncountable things (e.g., "smoke", "fire") |

### Player Control

| Attribute | Type | Description |
|-----------|------|-------------|
| `controlled` | boolean | Marks this entity as player-controlled. Player messages and sounds only fire on the controlled entity. |

## Serialization

Entity provides `serialize()` and `deserialize()` for save/load. The base serialize saves `x`, `y`, `type`, `name`, `tint`, all attributes, and an `isEntity` flag. Subclasses extend this: Item adds `identified`, `templateVars`, `stats`, and an `isItem` flag; Actor adds `stats`, `inventory`, `isDead`, `equipment`, `states`, and an `isActor` flag. The `isActor`/`isItem`/`isEntity` discriminators let `EntityManager.deserializeEntities()` reconstruct the correct class — it tests them in that order, since Item and Actor records spread the base payload and therefore carry `isEntity` too.

A plain Entity is restored through `spawnEntity(type, x, y, overrides)` rather than `addEntity()`: `addEntity` creates sprites for Items but not for plain Entities, so an entity restored through it would exist but be invisible. Going via `spawnEntity` also re-derives `tileIndex` and `fillColor` from `entities.json`, which is why those two are deliberately *not* in the saved payload — editing the data file updates old saves instead of freezing a stale look into them.

> Before this discriminator existed, plain Entities were serialized but matched neither branch on the way back in, so they were silently discarded: dug rubble and spilled blood vanished whenever you left a floor and returned.

**Known gap:** `liquid_track` has no `entities.json` entry (its `tileIndex` is computed from movement direction), so it still warns and is dropped on restore.

You don't need to do anything special — entities are serialized automatically by the engine. See [SAVING.md](SAVING.md) for the full field reference.

## Subclasses

| Class | Description | Reference |
|-------|-------------|-----------|
| `Item` | Pickupable objects, weapons, consumables, equipment | See [ITEMS.md](ITEMS.md) |
| `Actor` | Characters, enemies, doors, environmental hazards | See [ACTORS.md](ACTORS.md) |
