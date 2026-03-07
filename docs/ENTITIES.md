# Entity System

Entity is the base class for all game objects. Every Item and Actor is an Entity. It provides the coordinate system, attribute storage, naming, sound, and serialization that subclasses build on.

## Basic Entity Fields

These fields are set in data files or by the engine at spawn time.

| Field | Default | Description |
|-------|---------|-------------|
| `x`, `y` | required | Map coordinates |
| `type` | required | Entity type identifier string (matches the key in the data JSON) |
| `tint` | `#FFFFFF` | Color tint applied to the sprite. White means no tint. |
| `zIndex` | `1` | Rendering depth. Higher values render on top. |

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
|--------|-------------|
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

Entity provides `serialize()` and `deserialize()` for save/load. The base serialize saves `x`, `y`, `type`, `tint`, and all attributes. Subclasses (Item, Actor) extend this to include their additional state.

You don't need to do anything special — entities are serialized automatically by the engine.

## Subclasses

| Class | Description | Reference |
|-------|-------------|-----------|
| `Item` | Pickupable objects, weapons, consumables, equipment | See [ITEMS.md](ITEMS.md) |
| `Actor` | Characters, enemies, doors, environmental hazards | See ACTORS.md (coming soon) |
