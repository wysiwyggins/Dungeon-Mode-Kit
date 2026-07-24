# Rope Bridges

How rope bridges are generated across abysses in procedurally-generated levels, and how to configure them-

Bridge generation lives entirely in `architect.js` (`generateBridges`), runs during map generation, and produces `rope_bridge` actors. This doc covers the terrain model, the algorithm, configuration, and how the approach compares to Brogue's `buildABridge`.

---

## What a bridge is

A rope bridge is a straight line of walkable tiles that spans an **abyss** from one solid shore to the opposite shore — `walkable floor → bridge tiles → walkable floor`. A single abyss can carry two crossings on opposite axes that meet in a `+` **intersection** (see [Intersecting crossings](#intersecting-crossings)). Each bridge tile becomes a `rope_bridge` actor (see `data/actors.json`), which is:

| Attribute | Value | Meaning |
|-----------|-------|---------|
| `solid` | `false` | actors can enter the tile |
| `platform` | `true` | provides footing over a void (no floor beneath) |
| `flammable` | `true` | can burn (fire destroys the crossing) |
| `render_layer` | `bottom` | drawn under actors standing on it |

A bridge cell keeps `floorMap === null` — the crossing is **purely** the platform actor sitting over the void, exactly like a `collapsing_floor`. No real floor tile is laid beneath it. This is what makes it walk correctly *and* burn correctly: movement and fire code check `hasPlatformAt` alongside `hasFloorAt` (see `behaviors.js`), so while the bridge exists the cell is walkable, and when it burns the platform vanishes and the void (with its cliffside background) is revealed rather than a leftover floor tile. See [Burning and destruction](#burning-and-destruction).
Rope bridge actors use connected box-drawing tiles, like the thread trail left by the ball of thread item.

---

## `generateBridges`

Four stages:

### 1. Flood-fill abyss into blobs

All abyss cells are flood-filled (4-directional) into connected components. Each blob records its cells and bounding box. Bridges are reasoned about **one blob at a time** — a bridge always belongs to exactly one abyss.

### 2. Find full-cross-section crossings

For each blob, candidate crossings are found by scanning within its bounding box:

- **Horizontal:** for each row, the abyss run must equal the blob's **full horizontal cross-section on that row** (`startX === rowMinX && endX === rowMaxX`, one solid band).
- **Vertical:** symmetric, per column.

A minimum length of `max(2, ceil(blobWidth * 0.4))` rejects thin corner rows.

### 3. Resolve landings (wall-punching)

The cell just outside each end of the run must connect to walkable floor:

- if it's already walkable floor → use it directly;
- if it's a **boundary wall** with real floor one cell further out → mark it a *punch*: the wall is removed from `pendingWallSpawns` when the bridge is placed, exposing the floor as the landing;
- otherwise (true void / map border) → that side has no shore, reject the candidate.

At most **one** wall is punched per side, so a bridge never tunnels through a thick wall mass into nothing.

### 4. Connectivity gate

A crossing is only built if walking **around** the abyss is much longer than crossing it. A bounded breadth-first search runs over existing walkable floor (treating abyss and walls as blockers) from one shore toward the other:

- if the far shore is reached within `ceil(bridgeLength × minDetourRatio)` steps → the bridge is merely convenient, **skip it**;
- if the far shore is not reached within that cap (or is unreachable on foot) → the detour is long enough, **build**.

This means a big abyss sitting in wide-open floor that you can simply circle gets **no** bridge, while an abyss that genuinely partitions two areas does. `minDetourRatio` defaults to **3** (Brogue's shallow-level behavior).

### Intersecting crossings

`chooseCrossing` evaluates each axis **independently** and returns `{ h, v }` — the best horizontal crossing *and* the best vertical crossing, each of which must separately pass the connectivity gate (either may be `null`). When a blob yields **both**, both are placed, forming a `+`-shaped **intersection** where the two crossings share one cell. This mirrors Brogue's greedy behaviour, where multiple `buildABridge` calls can independently bridge the same chasm: a crossing appears wherever the geometry supports one and it earns its place, without a special rule.

The shared intersection cell is queued in `pendingBridgeSpawns` only **once** (a `usedCells` guard prevents stacking two `rope_bridge` actors on one tile). A crossed abyss still counts as **one** against the `max` cap — `max` remains a per-abyss budget, so a level with `max: 4` bridges up to four distinct abysses, any of which may be a crossing.

### Placement

Blobs are processed **largest-first**. For each, the **narrowest** valid crossing per axis (tie-broken toward zero-punch, then randomness) that passes the gate is placed, up to the global `max` cap. Each bridge cell is queued in `pendingBridgeSpawns` as `{ x, y, dir }` — `dir` is that crossing's orientation (`'h'` or `'v'`) — and its `floorMap` is left `null` (see [Burning and destruction](#burning-and-destruction)). `spawnPendingBridges` later turns them into `rope_bridge` actors.

### Sprite orientation

`spawnPendingBridges` chooses each cell's box-drawing tile from **which of its four neighbours are also bridge cells** (the same connection-aware approach as `getTrailTileName` in `engine.js`), not from `dir` alone. A straight run stays straight; a `+` intersection cell (all four neighbours are bridge cells) becomes `INVERSE_BOX_VERTICAL_HORIZONTAL`; a cell with three connections becomes the matching T (`INVERSE_BOX_UP_/DOWN_HORIZONTAL`, `INVERSE_BOX_LEFT_/RIGHT_VERTICAL`); a two-connection bend becomes the matching corner (`INVERSE_BOX_TOP_LEFT` etc.); and an endpoint (0–1 connections) falls back to the straight tile for its `dir`. Every pattern maps to a tile in `data/static-tiles.json` — the full inverse-box junction set (`+`, all four `T`s, all four corners) is present. The actor's catalog entry is never mutated; each spawn uses a shallow-cloned `actorData` with the resolved `tileIndexBase`.

---

## Burning and destruction

A rope bridge is `flammable`, so fire destroys it. This is why bridge cells must be built as **platform-over-void**, never as real floor:

- `generateBridges` does **not** write `floorMap` for bridge cells — they stay abyss (`floorMap === null`, background 217), exactly like `collapsing_floor` cells. Footing comes entirely from the `rope_bridge` platform actor.
- When fire consumes the bridge, `consumeFlammableAt` calls the actor's `die()`, which simply hides its sprite and removes it. Because there is **no floor tile underneath**, the cell's abyss background — already decorated with cliffside shadows by `addBaseAndShadows` — is revealed directly, and the gap becomes an unwalkable void again (`hasPlatformAt` now false).

If a bridge cell had instead been given a real floor tile, two things broke: `addBaseAndShadows` would skip the cell (it looks like floor, so no cliffside shadow), and after burning the leftover floor tile would remain visible as a flat, out-of-place patch instead of the void. This is precisely the pattern `collapsing_floor` already uses correctly, and bridges now follow it.

---

## Configuration

Bridges are configured in a prototype's `map_generator.options` block, alongside `abyss`, `lakes`, and `collapsing_floors`:

```json
"map_generator": {
  "type": "brogue",
  "options": {
    "abyss": { "count": [0, 4], "types": ["abyss"], "minSize": 10, "maxSize": 60 },
    "bridges": { "max": 4 }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `max` | number | `1` | **Global cap** on bridges for the level. One bridge is placed per distinct abyss (largest first), so raising `max` bridges more separate abysses — it does not stack multiple bridges on one abyss. |
| `minDetourRatio` | number | `3` | Connectivity gate strength. A bridge is built only if the walk-around is at least this many times longer than the crossing. Higher = fewer, more purposeful bridges. `2` bridges more abysses; `0` disables the gate entirely (bridge any valid crossing). |

### Per-level gotcha

A floor's own `map_generator` **fully replaces** the prototype-level one (the engine uses `floorConfig.map_generator ?? prototypeConfig.map_generator` — no merge). So **any level that defines its own `map_generator` with an `abyss` block must also include a `bridges` block**, or that level gets zero bridges regardless of the top-level config. The deep infernal levels in `prototypes/dungeon/prototype.json` each carry their own `bridges` block for this reason.

---

See also: [MAP.md](MAP.md) (abyss wildcard tile 218, map layers), [PROTOTYPE.md](PROTOTYPE.md) (`map_generator` block), [MOVEMENT.md](MOVEMENT.md) (platform/floor traversal).
