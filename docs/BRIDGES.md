# Rope Bridges

How rope bridges are generated across abysses in procedurally-generated levels, and how to configure them-

Bridge generation lives entirely in `architect.js` (`generateBridges`), runs during map generation, and produces `rope_bridge` actors. This doc covers the terrain model, the algorithm, configuration, and how the approach compares to Brogue's `buildABridge`.

---

## What a bridge is

A rope bridge is a straight line of walkable tiles that spans an **abyss** from one solid shore to the opposite shore — `walkable floor → bridge tiles → walkable floor`. Each bridge tile becomes a `rope_bridge` actor (see `data/actors.json`), which is:

| Attribute | Value | Meaning |
|-----------|-------|---------|
| `solid` | `false` | actors can enter the tile |
| `platform` | `true` | provides footing over a void (no floor beneath) |
| `flammable` | `true` | can burn (fire destroys the crossing) |
| `render_layer` | `bottom` | drawn under actors standing on it |

A bridge cell keeps `floorMap === null` — the crossing is **purely** the platform actor sitting over the void, exactly like a `collapsing_floor`. No real floor tile is laid beneath it. This is what makes it walk correctly *and* burn correctly: movement and fire code check `hasPlatformAt` alongside `hasFloorAt` (see `behaviors.js`), so while the bridge exists the cell is walkable, and when it burns the platform vanishes and the void (with its cliffside background) is revealed rather than a leftover floor tile. See [Burning and destruction](#burning-and-destruction).

Rope bridge actors use connected box-drawing tiles, like the thread trail left by the ball of thread item.

---

## The terrain model

### How abysses are represented

At **generation time**, an abyss cell is defined as:

```js
backgroundMap[y][x].tileId === 217 && floorMap[y][x] === null
```

i.e. the black void background tile (217) with no floor. Abysses are carved by `generateOverlayBlobs` (the same routine that makes lakes/lava), which grows **compact, roughly-circular blobs**, not clean channels — frontier expansion is deliberately biased toward dense shapes. **All of the bridge logic (blob flood-fill, `isAbyss`, crossing detection) runs at this stage, when abyss cells are still uniformly tile 217.**

For **display**, `addBaseAndShadows()` runs later (after generation, in `engine.js`) and rewrites many abyss backgrounds into cliffside tiles to imply depth — `SHADOW_DIAGONAL` (128) along floor-to-void edges and `DARK_SHADE` (178) filling below them. So a *rendered* abyss cell's background is often 128 or 178, **not** 217. Two consequences for bridges:

- The bridge algorithm must run *before* `addBaseAndShadows` (it does) so it sees the clean 217 abyss.
- A bridge cell must be left as a real abyss cell (`floorMap === null`, background 217) so `addBaseAndShadows` decorates it with the same cliffside shadow as its surroundings. If a bridge instead laid a floor tile, `addBaseAndShadows` would skip the cell (it looks like floor) and it would keep a flat, undecorated void — and that flat tile would remain visible after the bridge burned. This was the "burned bridge leaves a raw void tile" bug; see [Burning and destruction](#burning-and-destruction).

### The boundary-wall ring

When a blob is carved, `generateOverlayBlobs` rings it with **boundary walls** — but only around blob cells that ate an *original* wall. Those walls are pushed to `pendingWallSpawns` and always have real floor underneath them. The practical consequence: the rim of an abyss is a **mix** of exposed walkable floor and boundary walls. A naive "find floor next to the abyss" check fails on the walled portions, which is why bridge landing needs the wall-punch step below.

### Generation order

```text
lakes → abyss → bridges → collapsing_floors
```

Bridges run *after* abysses exist (correct) and *before* walls are spawned into actors (`engine.js`), so a bridge can remove a boundary wall from `pendingWallSpawns` and that removal is honored. `generateCollapsingFloors` runs next and already excludes bridge cells via its `bridgeSet`.

---

## The algorithm (`generateBridges`)

Four stages:

### 1. Flood-fill abyss into blobs

All abyss cells are flood-filled (4-directional) into connected components. Each blob records its cells and bounding box. Bridges are reasoned about **one blob at a time** — a bridge always belongs to exactly one abyss.

### 2. Find full-cross-section crossings

For each blob, candidate crossings are found by scanning within its bounding box:

- **Horizontal:** for each row, the abyss run must equal the blob's **full horizontal cross-section on that row** (`startX === rowMinX && endX === rowMaxX`, one solid band).
- **Vertical:** symmetric, per column.

Requiring the run to be the *full* cross-section is the key defense against the old "short line along one edge" bug: it forces the two landings onto genuinely **opposite shores** rather than clipping a corner. A minimum length of `max(2, ceil(blobWidth * 0.4))` rejects thin corner rows.

### 3. Resolve landings (wall-punching)

The cell just outside each end of the run must connect to walkable floor:

- if it's already walkable floor → use it directly;
- if it's a **boundary wall** with real floor one cell further out → mark it a *punch*: the wall is removed from `pendingWallSpawns` when the bridge is placed, exposing the floor as the landing;
- otherwise (true void / map border) → that side has no shore, reject the candidate.

At most **one** wall is punched per side, so a bridge never tunnels through a thick wall mass into nothing.

### 4. Connectivity gate (Brogue-style)

A crossing is only built if walking **around** the abyss is much longer than crossing it. A bounded breadth-first search runs over existing walkable floor (treating abyss and walls as blockers) from one shore toward the other:

- if the far shore is reached within `ceil(bridgeLength × minDetourRatio)` steps → the bridge is merely convenient, **skip it**;
- if the far shore is not reached within that cap (or is unreachable on foot) → the detour is long enough, **build**.

This means a big abyss sitting in wide-open floor that you can simply circle gets **no** bridge, while an abyss that genuinely partitions two areas does. `minDetourRatio` defaults to **3** (Brogue's shallow-level behavior).

### Placement

Blobs are processed **largest-first**. For each, the **narrowest** valid crossing (tie-broken toward zero-punch, then randomness) that passes the gate is placed, up to the global `max` cap. Bridge cells are queued in `pendingBridgeSpawns` (and their `floorMap` is left `null` — see below); `spawnPendingBridges` later turns them into `rope_bridge` actors.

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

## Comparison to Brogue's `buildABridge`

Both solve the same problem — bridge a chasm shore-to-shore, only where it's worthwhile — but structurally differ. (Brogue source: `Architect.c`, `buildABridge`.)

| | This kit | Brogue |
|---|----------|--------|
| **Unit of work** | Whole abyss blob (flood-filled), one bridge per blob | Single candidate cell, scanned in random order; one bridge per call, looped `while (buildABridge())` |
| **Shore guarantee** | Run must be the blob's **full cross-section** (geometric opposite-shores proof) | Straight chasm run with solid land at both ends + an "exposure" check that it isn't a walled corridor |
| **Worthwhile check** | Bounded BFS detour gate (`minDetourRatio`, default 3) | `pathingDistance / bridgeLength > bridgeRatio` (depth-scaled ~3–5×) |
| **Wall handling** | Punches ≤1 boundary wall per side to reach floor (our abysses are wall-ringed) | Not needed; Brogue chasms aren't wall-ringed |
| **Distribution** | Explicit one-per-abyss, largest first, `max` cap | Greedy; may stack several bridges on one big chasm |
| **Min length** | `max(2, ceil(blobWidth·0.4))` | `> 3` spaces |

The **connectivity gate is directly inspired by Brogue's `bridgeRatio` test** — the core insight that a bridge should only exist where it meaningfully shortens travel, not merely wherever a gap happens to be crossable. The main divergence is that this kit reasons about whole abyss blobs and their full cross-sections (guaranteeing opposite shores geometrically), whereas Brogue reasons per-cell and leans on its pathing-distance test to reject bad placements.

---

## Known limitations / follow-ups

- **Sprite orientation is cosmetic-only.** The `rope_bridge` actor hardcodes the `INVERSE_BOX_HORIZONTAL` tile, so a correct *vertical* bridge still renders with a horizontal-looking sprite. The engine already has connection-aware tile selection (`getTrailTileName` in `engine.js`, which produces `INVERSE_BOX_VERTICAL` and corner tiles); wiring bridges to it — by passing per-cell orientation into `createActor` — is a future cosmetic improvement, not a walkability issue.
- **Very-thin chasms (1 tile wide) are never bridged** — the minimum-length rule forbids a single-tile bridge. In practice abysses come from `generateOverlayBlobs` with `minSize ≥ 10`, so they're always fat blobs; a 1-wide gap doesn't occur naturally.

---

See also: [MAP.md](MAP.md) (abyss wildcard tile 218, map layers), [PROTOTYPE.md](PROTOTYPE.md) (`map_generator` block), [MOVEMENT.md](MOVEMENT.md) (platform/floor traversal).
