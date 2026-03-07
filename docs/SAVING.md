# Save & Load

Two systems exist for preserving game state:

1. **Seed URLs** — A `?seed=` parameter makes map generation deterministic. Fully implemented.
2. **Full state snapshots** — Serialize mid-game state to JSON. Partially implemented; restore is not yet functional end-to-end.

## Seed URLs

Every session uses an integer seed to drive all game-affecting randomness (map layout, actor placement, item drops, fire spread, etc.). Cosmetic randomness — sound pitch variance and animation frame jitter — uses `Math.random()` intentionally and is not seeded.

### Using a Seed

Append `?seed=` to the URL before loading a prototype:

```
index.html?prototype=labyrinth&seed=1708642800000
```

The same seed with the same prototype always produces an identical starting layout.

### Getting the Current Seed

If no `?seed=` is provided, a seed is generated from `Date.now()` and logged to the browser console:

```
RNG seeded: 1708642800000 (generated)
```

The seed is also stored on the engine instance for runtime access:

```js
engine.currentSeed  // → 1708642800000
```

## Serialization API

Entity, Item, and Actor each implement `serialize()` / `deserialize()`. These are used internally by `saveGameState()` and are available for custom prototype logic.

### Entity.serialize()

Returns a plain object with:

| Field | Description |
|-------|-------------|
| `x`, `y` | Map coordinates |
| `type` | Entity type identifier |
| `attributes` | All attributes as an array of `[key, value]` pairs |
| `tint` | Color tint value |

### Actor.serialize()

Extends `Entity.serialize()` with:

| Field | Description |
|-------|-------------|
| `stats` | Full stats object (health, strength, etc.) |
| `inventory` | Array of serialized item objects |
| `personality` | Personality name string, if any |

### Actor.deserialize(data)

Restores stats and personality. Inventory reconstruction from serialized items is not yet implemented.

## saveGameState() / restoreGameState()

`saveGameState()` captures a snapshot of the current game:

```js
const state = engine.saveGameState();
// Returns: { player, entities, map }
```

`restoreGameState(state)` applies a snapshot:

```js
engine.restoreGameState(state);
```

**Current limitation:** Only the player entity is fully restored. Non-player entity reconstruction (`EntityManager.deserializeEntities`) is not yet implemented, so loading a mid-game snapshot restores the player but not other actors or items.

## Not Yet Implemented

- Full entity reconstruction from snapshots (non-player actors and items)
- Missing serialize fields: equipment, active states (burning/poisoned), dead flag, vision range, lifetime
- State compression and URL export (`?state=` parameter)
- localStorage save slots
- Save/load UI and hotkeys
