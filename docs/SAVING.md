# Save & Load

Two systems exist for preserving game state:

1. **Seed URLs** — A `?seed=` parameter makes map generation deterministic. Fully implemented.
2. **Full state snapshots** — Serialize mid-game state to JSON for floor transitions and save/restore.

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

Entity, Item, and Actor each implement `serialize()` / `deserialize()`. These are used internally by `saveGameState()`, floor transitions, and are available for custom prototype logic.

### Entity.serialize()

Returns a plain object with:

| Field | Description |
|-------|-------------|
| `x`, `y` | Map coordinates |
| `type` | Entity type identifier |
| `name` | Display name |
| `attributes` | All attributes as an array of `[key, value]` pairs |
| `tint` | Color tint value |
| `isEntity` | Always `true` — discriminator for deserialization |

`fillColor` and `tileIndex` are deliberately **not** saved: they are re-derived from
`data/entities.json` on restore, so editing that file updates existing saves rather than
leaving a stale look frozen into them.

### Item.serialize()

Extends `Entity.serialize()` with:

| Field | Description |
|-------|-------------|
| `identified` | Whether the item has been identified |
| `templateVars` | Template variable values (color, glyph name, etc.) |
| `stats` | Full stats object (charges, fuel, etc.) |
| `isItem` | Always `true` — discriminator for deserialization |

### Actor.serialize()

Extends `Entity.serialize()` with:

| Field | Description |
|-------|-------------|
| `stats` | Full stats object (health, strength, etc.) — deep copy |
| `inventory` | Array of serialized item objects |
| `personality` | Personality name string, if any |
| `isDead` | Whether the actor is dead |
| `equipment` | Equipment slot → item type mapping (`weapon`, `top`, `middle`, `lower`) |
| `states` | Active temporary states with durations (burning, poisoned, etc.) |
| `isActor` | Always `true` — discriminator for deserialization |

### Actor.deserialize(data)

Fully restores stats, personality, dead state, active states, and reconstructs inventory items from serialized data. Equipment slots are re-linked to matching inventory items.

### EntityManager.deserializeEntities(data)

Reconstructs all entities from serialized data. Uses the `isActor` / `isItem` / `isEntity` discriminator fields to determine entity type, creates instances from prototype definitions, and calls `deserialize()` on each.

The three are tested **in that order**, because Item and Actor records spread the base
payload and therefore carry `isEntity` as well. Plain entities (decorations, rubble,
blood) take the `isEntity` branch and are rebuilt with `spawnEntity()` rather than
`addEntity()` — the latter creates sprites for Items but not for plain Entities, so an
entity restored through it would exist but never be drawn.

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

## Floor State Serialization

Multi-level prototypes save and restore floor state when transitioning between floors:

```js
engine.currentFloor    // 1-indexed current floor number
engine.floorStates     // Map of floor# → { entities, map, explored, rngState }
```

`saveFloorState()` serializes all non-player entities and the full map state. The player entity is serialized separately and carried across floors with inventory, stats, and equipment intact. `explored` carries the fog-of-war reveal across the round trip — `restoreFloor()` builds a fresh `LightingManager` whose `initialize()` zeroes the explored map, so without it a revisited floor would re-fog entirely.

When returning to a previously visited floor, the saved state is restored — all entities reappear in their last positions, and the map is exactly as it was left. The ROT.js RNG state is also saved per floor for deterministic regeneration if needed.

### Entities in transit between floors

Three queues hold entities that have left one floor but not yet been placed on the next. Each is a `Map` of destination floor# → array of serialized entities, drained when that floor is entered:

```js
engine.pendingFallenActors    // fell through a collapsing floor / pit
engine.pendingFallenItems     // items that fell with them
engine.pendingStairFollowers  // hostiles that chased the player through a stairway
```

`gatherStairFollowers()` fills the last of these, and it must run *before* `saveFloorState()`: a follower still on the live entity list when the floor is saved would be cached onto the floor it left *and* carried forward, appearing twice. Followers leave via `removeEntity()` rather than `die()`, so nothing dies, drops loot, or announces itself.

All three drain after the player is placed and before `initializeTurnEngine()`, which rebuilds the scheduler from the live actor list — so arrivals are scheduled automatically. Because AI memory is not serialized, `spawnPendingStairFollowers()` reapplies the hunt state (`_alerted`, `_alertTarget`, `_lastKnownTargetX/Y`) on arrival.

All three are cleared on a full prototype change, prototype transition, or engine cleanup — pending entities never survive into a different prototype.

### Map Serialization

`Architect.serializeMap()` saves all map layers:

| Field | Description |
|-------|-------------|
| `width`, `height` | Map dimensions |
| `floorMap` | Walkable terrain tiles |
| `backgroundMap` | Background/void tiles |
| `wildcardMap` | Procedural generation markers |
| `overlayMap` | Tiles drawn above the rest |
| `walkableTiles` | Array of walkable tile positions |

## Not Yet Implemented

- State compression and URL export (`?state=` parameter)
- localStorage save slots
- Save/load UI and hotkeys
