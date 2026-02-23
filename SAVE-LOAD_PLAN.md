# Save/Load Game State — Implementation Plan

## Overview

Two complementary systems for a single prototype (no cross-level persistence):

1. **Seed URLs** — A `?seed=` parameter that makes map generation deterministic, so the same seed always produces the same starting layout. Shareable, short, fits in a URL alongside `?prototype=`. (how does this interact with the authored portions of a .tmj map?)
2. **Full state snapshots** — Serialize the complete mid-game state (entities, stats, inventories, fog, etc.) to a compressed string. Can be loaded via `?state=` URL parameter, saved to localStorage, or exported/imported as a file.

## Part 1: Deterministic Seed System

### 1A. Replace `Math.random()` with `ROT.RNG` in generation code

Only the calls that affect game-state need replacing. Cosmetic randomness (sound pitch variance, animation frames) can stay as `Math.random()`.

**architect.js** (~4 replacements):
- Lines 674, 823, 878: Wall type weighted selection → `ROT.RNG.getUniform()`
- Line 1604: Random walkable tile selection → `ROT.RNG.getUniform()`

**engine.js** — generation-time calls (~9 replacements):
- Lines 4952, 4962: `random_walk` AI direction → `ROT.RNG.getUniform()`
- Lines 5505, 5532, 5534, 5588, 5697, 5732, 5771, 5802: Cloud/mist/fire/water behavior → `ROT.RNG.getUniform()`
- Line 5980: Fire spread chance → `ROT.RNG.getUniform()`
- Lines 6592, 6596: Item drop count/position → `ROT.RNG.getUniform()`

**Non-critical (leave as Math.random):**
- Sound variance (sound.js lines 94-95)
- Animation frame jitter (engine.js lines 7828, 8160-8161)
- Color generation for unidentified items (engine.js lines 1323, 1346, 1354, 1378) — these actually DO matter for gameplay, so include these too

### 1B. Wire up `?seed=` URL parameter

In `initializeGame()` (engine.js ~line 8356):
- Parse `?seed=` from URL params
- If present, call `ROT.RNG.setSeed(parsedSeed)` before `loadPrototype()`
- If absent, generate a seed from `Date.now()`, store it on `engine.currentSeed`
- Move the `ROT.RNG.setSeed()` call from `initializeTurnEngine()` (line 624) to `initializeGame()` so it happens before any generation

### 1C. Display/copy current seed

Add a small UI element or console log showing the current seed so players can share it. Could be a "Copy seed" button in the interface, or just exposed on `engine.currentSeed`.

**URL format:** `index.html?prototype=labyrinth&seed=1708642800000`

## Part 2: Full State Snapshot System

### 2A. Complete the existing serialization

The codebase already has `saveGameState()` / `restoreGameState()` stubs and `serialize()` / `deserialize()` on Entity/Actor/Item. The gaps to fill:

**Entity.serialize()** (engine.js ~line 1492) — already works, returns `{x, y, type, attributes, tint}`

**Actor.serialize()** (engine.js ~line 4850) — mostly works but needs additions:
- Add: `equipment` (serialize each slot's item)
- Add: `states` (burning, poisoned, etc. with durations)
- Add: `_equippingItem` / `_equippingTurnsLeft` if mid-equip
- Add: `isDead` flag
- Add: `visionRange`
- Add: `lifetime` (for temporary actors like fire)
- Add: `flipBaseH/V`, `flipTopH/V`

**Item.serialize()** (extends Entity) — needs:
- Add: `identified` status
- Add: `templateVars` (per-instance random names/colors)

**EntityManager.deserializeEntities()** (engine.js ~line 7212) — currently empty stub. Needs to:
1. Clear existing entities/actors/items arrays
2. For each serialized entity, look up its type definition from `currentPrototype.getActorData()` or `getItemData()`
3. Construct a new Actor or Item from the definition + serialized overrides
4. Restore position, attributes, stats, inventory, equipment, states
5. Create sprites via the render system
6. Re-add to scheduler if actor has personality or controlled attribute

**Additional state to save** (extend `saveGameState()`):
- `seed`: The RNG seed used for this prototype
- `rngState`: `ROT.RNG.getState()` — captures exact RNG position for mid-game resume
- `prototypeName`: Current prototype name
- `exploredMap`: From `lightingManager.exploredMap` (2D boolean array, only if fog_of_war)
- `identifiedTypes`: Array from `currentPrototype.identifiedTypes` Set
- `itemColorAssignments`: From `currentPrototype.itemColorAssignments` Map
- `gameOver`: boolean flag

### 2B. Encode state as a URL-safe string

The full state object will be too large for most URLs raw, but can be compressed:

1. `JSON.stringify()` the save state
2. Compress with `CompressionStream('deflate')` (built-in browser API, no library needed)
3. Base64url encode the result
4. Use as `?state=` parameter

**Fallback for very large states:** If the compressed string exceeds ~2000 characters (safe URL limit), fall back to localStorage with a short state ID in the URL: `?stateId=abc123`

**URL format:** `index.html?prototype=labyrinth&state=eJxVjsEOgCAMQ...`

### 2C. Save/Load triggers

**Saving:**
- `engine.exportStateString()` — returns the compressed base64 state string
- `engine.exportStateURL()` — returns full URL with `?prototype=X&state=Y`
- `engine.saveToLocalStorage(slotName)` — saves to `localStorage['dungeonkit_save_' + slotName]`
- Automatic: Update URL hash or history state on each save (optional)

**Loading:**
- On `initializeGame()`: Check for `?state=` param. If present, decode and restore instead of generating fresh
- `engine.loadFromLocalStorage(slotName)` — loads from localStorage
- `engine.importStateString(str)` — decodes and restores from a string

**Loading flow when `?state=` is present:**
1. Parse prototype name from state (or from `?prototype=` param)
2. Load prototype config and assets (same as normal)
3. Load/generate the map using the saved seed (deterministic, produces same map)
4. Instead of spawning entities from map data, call `restoreGameState(decodedState)`
5. Rebuild sprites, scheduler, lighting from restored entity state
6. Resume play

### 2D. UI integration

Add to input.js key bindings:
- A save/load hotkey or add to an existing menu

Add to interface.js:
- "Copy save link" option that puts the state URL on clipboard
- Visual feedback when save/load occurs

## Part 3: Implementation Order

### Step 1: RNG Determinism
- Replace `Math.random()` calls with `ROT.RNG` in architect.js and engine.js (game-affecting calls only)
- Move `ROT.RNG.setSeed()` to before prototype loading
- Wire up `?seed=` URL parameter parsing
- Test: Same seed + same prototype = identical map layout

### Step 2: Complete Serialization
- Extend `Actor.serialize()` and `Item.serialize()` with missing fields
- Extend `Actor.deserialize()` and `Item.deserialize()` to restore those fields
- Implement `EntityManager.deserializeEntities()` — the main missing piece
- Extend `saveGameState()` with seed, RNG state, explored map, identified types
- Extend `restoreGameState()` to handle the new fields + rebuild scheduler/lighting

### Step 3: State Encoding & URL Integration
- Implement compress/decompress helpers using `CompressionStream`/`DecompressionStream`
- Add `?state=` parameter parsing to `initializeGame()`
- Implement `exportStateURL()` and `importStateString()`
- Add localStorage save/load methods

### Step 4: UI & Polish
- Add seed display somewhere accessible
- Add save/load keyboard shortcut or menu option
- Add "Copy link" functionality
- Handle edge cases (invalid state strings, version mismatches)

## Files Modified

| File | Changes |
|------|---------|
| **engine.js** | Replace ~12 `Math.random()` calls with `ROT.RNG`; extend serialize/deserialize on Actor, Item, EntityManager; extend `saveGameState()`/`restoreGameState()`; add `exportStateURL()`/`importStateString()`; add compression helpers; modify `initializeGame()` to parse `?seed=` and `?state=` |
| **architect.js** | Replace 4 `Math.random()` calls with `ROT.RNG` |
| **input.js** | Add save/load hotkey handling |
| **interface.js** | Add save link copy UI, seed display |
| **index.html** | No changes needed (URL params handled in JS) |

## Key Risks & Mitigations

- **State string too large for URL**: Compression typically achieves 3-5x on JSON. A typical game state (~50-100 entities) should compress to ~1-3KB base64, well within URL limits. For large maps, fall back to localStorage + short ID.
- **Deserialization breaks sprites**: The restore flow must re-run sprite creation after entity reconstruction. This means calling into the render system after `restoreGameState()`.
- **Scheduler order changes**: `ROT.Scheduler.Simple` processes actors in add-order. Save the actor order and re-add in the same sequence during restore.
- **ROT.RNG state format**: ROT.js exposes `getState()`/`setState()` for capturing exact RNG position. This is needed for mid-game saves (not just seed replay).
