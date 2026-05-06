# Architect - Dungeon Generation System

The Architect class handles all map generation, loading, and terrain management.

## Overview

```
architect.js
├── Map Layer Management (background, floor, wall, wildcard)
├── Tiled Map Loading (.tmj files)
├── Procedural Generation (ROT.js integration)
│   ├── Generator Types (digger, cellular, shaped, infernal, etc.)
│   ├── Post-Processing Pipeline (lakes, sewage, fungus, bridges, connections)
│   └── Depth-Based Room Weight Scaling
├── Wildcard Processing (region-based generation)
├── Room Type Registry (data-driven room shapes)
└── Entity Spawning (deferred wall/door/torch/lake/fungus/bridge spawning)
```

## Map Layers

The Architect manages four map layers, each a 2D array of tile data:

| Layer | Purpose | Contents |
|-------|---------|----------|
| `backgroundMap` | Behind everything | Void tiles, shadows, decoration |
| `floorMap` | Walkable terrain | Floor tiles (tracked in `walkableTiles`) |
| `wallMap` | Wall entities | Reserved for future use |
| `wildcardMap` | Generation markers | Special tiles that trigger procedural content |

## Tiled Map Loading

Load authored maps from `.tmj` files:

```javascript
await architect.loadTiledMap('prototypes/default/map.tmj');
```

**Supported Layers:**

- `background` (tilelayer) - Populates `backgroundMap`
- `floor` (tilelayer) - Populates `floorMap`, tracks walkable tiles
- `wildcards` (tilelayer) - Populates `wildcardMap` for procedural regions
- Object layers - Stored in `objectLayers` for EntityManager

## Wildcard System

Wildcards are special tiles that define regions for procedural content generation. When `processWildcards()` is called, the Architect:

1. Finds contiguous regions of each wildcard type
2. Generates appropriate content sized to fit
3. Preserves any authored content within gaps

### Built-in Wildcard Types

| Type | Tile ID | Generator | Description |
|------|---------|-----------|-------------|
| `maze` | 210 | ROT.js EllerMaze | Perfect maze corridors, no walls |
| `dungeon` | 9, 16, 152 | ROT.js Digger | Walled rooms + corridors with doors |
| `cave` | 10 | ROT.js Cellular | Organic cave shapes |
| `infernal` | 11 | Cellular + lava | Cave with lava pools |
| `room` | 143, 144 | Room type system | Single room with walls (uses `selectRoomTypeForDepth`) |
| `item_spawn` | 12 | (placeholder) | Random item placement |
| `actor_spawn` | 3 | (placeholder) | Random actor placement |

### Actor Wildcards

Actors can define a `paint_tile` attribute to create custom wildcards:

```json
{
  "lava": {
    "attributes": {
      "paint_tile": "DOUBLE_EXCLAMATION_MARK"
    }
  }
}
```

When that tile appears in the wildcards layer, the Architect spawns the corresponding actor at each tile position. Note: `paint_tile` is only used at architect time for wildcard matching — it does not affect runtime rendering. The `tileIndexBase` attribute controls the visual sprite.

## Procedural Generation

When no Tiled map exists, generate a full procedural map:

```javascript
architect.generateProceduralMap({
  type: 'cellular',
  options: { ... }
}, depth);
```

The `depth` parameter (dungeon floor number, starting at 1) drives depth-based room weight scaling so early floors favor geometric rooms and deeper floors produce more organic shapes.

### Generator Types

| Type | ROT.js Class | Description |
|------|--------------|-------------|
| `digger` | Digger | Rooms connected by corridors (default) |
| `cellular` | Cellular | Cave-like organic shapes |
| `shaped` | Custom | Shaped rooms attached via hallways (see below) |
| `uniform` | Uniform | Evenly distributed rooms |
| `rogue` | Rogue | Classic roguelike grid rooms |
| `infernal` | Cellular | Cave + built-in lava pools |
| `divided_maze` | DividedMaze | Recursive division maze |
| `icey_maze` | IceyMaze | Maze with regularity control |
| `eller_maze` | EllerMaze | Perfect maze (Eller's algorithm) |
| `arena` | Arena | Simple empty rectangle |

### Post-Processing Pipeline

After any generator type finishes, the following steps run in order on all maps:

```
[Generator] → Blob Lakes → Sewage → Fungus → Secondary Connections → Rope Bridges → Pushable Walls
```

Each step is controlled by options in the `map_generator.options` config. If an option is absent or zero, that step is skipped.

### Shaped Generator

The `shaped` generator builds levels by attaching shaped rooms via hallways, producing more varied and organic layouts than the standard digger.

Algorithm:
1. Place a first room near the center of the map
2. Iteratively pick random door sites from existing rooms
3. Carve a corridor of random length from each door site
4. Generate a new room in isolated space, attempt to stamp it at the corridor endpoint
5. Accept only if no overlap with existing floors
6. Continue until `dugPercentage` of the map is carved or max attempts exhausted
7. Queue walls, doors (50% chance), and torches (30% of rooms) via the deferred spawn system

Rooms are selected via `selectRoomTypeForDepth()`, so the shaped generator produces a mix of rectangular, cross, circular, chunky, and donut rooms weighted by depth.

The generator creates `ShapedRoom` adapter objects that expose the same API as ROT.js Room objects (`getLeft`, `getRight`, `getTop`, `getBottom`, `getDoors`), maintaining compatibility with the treasure room system.

**Config:**

```json
"map_generator": {
  "type": "shaped",
  "options": {
    "map_width": 80, "map_height": 80,
    "roomWidth": [5, 14], "roomHeight": [4, 12],
    "corridorLength": [2, 6],
    "dugPercentage": 0.3,
    "room_weights": { "rectangular": 60, "cross": 25, "circular": 20, "chunky": 15, "donut": 8 }
  }
}
```

The optional `room_weights` object overrides default weights for room type selection within this generator.

## Blob Lakes

Blob-shaped lakes replace the old uniform cellular automata lake system. They use a cellular automata blob generator with connectivity validation to ensure no walkable tiles are stranded.

**Algorithm:**
1. `createBlob()` generates a random organic shape using CA rules (born: [5,6,7,8], survive: [4,5,6,7,8])
2. Flood fill extracts the largest connected region
3. Random placement is attempted (up to 20 tries) — blob tiles must overlap walkable tiles
4. `checkConnectivity()` verifies all remaining walkable tiles are still reachable via BFS
5. Water lakes get **shallow water wreaths**: walkable tiles within Euclidean distance ≤ 2 of deep water become shallow water

**Config:**

```json
"lakes": {
  "count": [1, 3],
  "types": ["water"],
  "minSize": 15,
  "maxSize": 120
}
```

| Field | Description |
|-------|-------------|
| `count` | `[min, max]` number of lake attempts |
| `types` | Array of `"water"` and/or `"lava"` — one chosen randomly per lake |
| `minSize` | Minimum blob tile count |
| `maxSize` | Maximum blob tile count |

Water lakes produce `deep_water` centers with `water` (shallow) borders. Lava lakes produce `lava` tiles with no wreath.

Legacy fallback: if `lake_chance` (0-100) is set instead of `lakes`, the old cellular automata lake generation is used.

## Fungus Patches

Luminescent fungus patches are generated using the same cellular automata approach as sewage. They appear as teal-green ground cover that emits dim light.

**Config:**

```json
"fungus_chance": 8
```

Value is 0-100, used as the CA seeding probability. Fungus tiles are placed only on walkable tiles that don't overlap lakes or lava. The `fungus` actor is flammable (fire clears patches) and emits a dim green light (radius 2, color `#225544`).

## Rope Bridges

Rope bridges span voids (gaps between walkable areas with no floor or walls) using INVERSE_BOX directional tiles tinted brown (`#8B6914`). Bridge segments are entities with the `bridge` attribute — they provide walkability over void tiles without placing floor tiles underneath.

**Algorithm:**
1. Find walkable tiles adjacent to void (non-floor, non-wall tiles) — these are **edge tiles**
2. Cast rays in cardinal directions from each edge tile across the void
3. If a ray hits another walkable tile within `max_span` and the walking distance between edges is significantly greater than the span (shortcut ratio), mark as candidate
4. Select up to `max` bridges, preferring highest pathing distance ratio
5. Each bridge segment gets the correct directional INVERSE_BOX tile (`HORIZONTAL`, `VERTICAL`, etc.)

Bridge segments are flammable actors, not floor tiles. When a bridge segment is destroyed by fire, the void underneath is exposed and actors standing there will fall. Fire spreads along adjacent bridge segments even over void. Movement and pathfinding recognize bridge actors as walkable via the `bridge` attribute on `hasFloorAt()`.

**Config:**

```json
"bridges": {
  "max": 2,
  "min_span": 3,
  "max_span": 10
}
```

| Field | Description |
|-------|-------------|
| `max` | Maximum number of bridges to generate |
| `min_span` | Minimum void tiles a bridge must cross |
| `max_span` | Maximum span (longer bridges are rejected) |

## Secondary Connections

After dungeon generation, walls separating floor regions with high walking distance can be converted to doorways, creating shortcuts and loops that make navigation more interesting.

**Algorithm:**
1. Sample up to 200 random walls from `pendingWallSpawns` (excluding `metal_wall`)
2. Check if floor exists on two opposite sides (N/S or E/W)
3. BFS from one side to measure walking distance to the other
4. If distance exceeds `min_distance`, mark as candidate
5. Sort by distance (descending) and convert up to `max` candidates from walls to doors

**Config:**

```json
"secondary_connections": {
  "max": 3,
  "min_distance": 20
}
```

## Room Type Registry

The Architect uses a data-driven room type system for varied room shapes. Room types are selected based on dungeon depth and weighted randomness.

### Default Room Types

| Type | Min Depth | Weight | Min Size | Depth Scale | Description |
|------|-----------|--------|----------|-------------|-------------|
| `rectangular` | 1 | 100 | 3x3 | 1.5 → 0.5 | Standard rectangular room |
| `cross` | 2 | 30 | 7x7 | 1.3 → 0.7 | Two overlapping rectangles (+ shape) |
| `circular` | 3 | 20 | 5x5 | 1.0 → 1.0 | Ellipse fitted to region |
| `chunky` | 4 | 15 | 7x7 | 0.3 → 2.0 | Organic blob (overlapping circles) |
| `donut` | 3 | 8 | 11x11 | 0.5 → 1.5 | Ring-shaped room with inner wall island |

### Depth-Based Weight Scaling

Each room type has a `depthScale: { start, end }` that modifies its selection weight based on dungeon depth. The weight is interpolated linearly:

```
t = min(1, (depth - 1) / 25)
effectiveWeight = baseWeight * lerp(start, end, t)
```

Shallow levels (depth 1) favor geometric rooms (`rectangular` at 1.5x weight). Deep levels (depth 25+) shift toward organic shapes (`chunky` at 2.0x weight, `rectangular` at 0.5x).

### Registering Custom Room Types

```javascript
architect.registerRoomType('custom_room', {
  generator: (x, y, w, h, opts) => {
    // Return { floorTiles: [{x, y}], wallTiles: [{x, y}] }
  },
  minDepth: 1,
  maxDepth: 10,
  weight: 25,
  minSize: { w: 5, h: 5 },
  depthScale: { start: 1.0, end: 1.0 },
  wildcardTileId: 200  // Optional: explicit tile ID for Tiled
});
```

## Context Injection

The Architect uses a context injection pattern to access engine resources without tight coupling:

```javascript
const architectContext = {
  getActorData: (type) => prototype.getActorData(type),
  getTileIdByName: (name) => spriteLibrary.getTileIdByName(name),
  getPrototypeActors: () => prototype.actors,
  getMapGeneratorConfig: () => prototype.config.map_generator.options,
  createActor: (x, y, type, actorData) => {
    // Spawn and return actor
  }
};

await architect.processWildcards(architectContext);
architect.spawnPendingWalls(architectContext);
```

## Deferred Spawning

During generation, the Architect collects spawn positions but defers actual entity creation until the EntityManager exists:

```javascript
// During generation (populated by generateProceduralMap and post-processing pipeline)
architect.pendingWallSpawns       // { x, y, type }
architect.pendingDoorSpawns       // { x, y }
architect.pendingTorchSpawns      // { x, y }
architect.pendingLavaSpawns       // { x, y }
architect.pendingLakeSpawns       // { x, y, type: 'water'|'deep_water' }
architect.pendingSewageSpawns     // { x, y }
architect.pendingFungusSpawns     // { x, y }
architect.pendingBridgeSpawns     // { x, y, tileIndexBase }
architect.pendingPushableWallSpawns // { x, y }

// After EntityManager exists — call in this order:
architect.spawnPendingWalls(context);
architect.spawnPendingDoors(context);
architect.spawnPendingTorches(context);
architect.spawnPendingLava(context);
architect.spawnPendingLakes(context);
architect.spawnPendingSewage(context);
architect.spawnPendingFungus(context);
architect.spawnPendingBridges(context);
architect.spawnPendingPushableWalls(context);
```

Lake entries dispatch on `entry.type`: `'water'` spawns shallow water, `'deep_water'` spawns deep water. Entries without a type default to `'water'`.

Bridge entries include a `tileIndexBase` per segment that overrides the default `INVERSE_BOX_HORIZONTAL` with the correct directional tile for that segment.

## Utility Functions

### `createBlob(minWidth, maxWidth, minHeight, maxHeight, percentSeeded, iterations)`

Generates a random organic shape using cellular automata. Seeds a grid randomly, runs CA rules for `iterations` rounds, then flood-fills to extract the largest connected region. Returns `{ grid, width, height, offsetX, offsetY }`.

### `floodFill(startX, startY, isPassable, width, height)`

BFS from a starting tile. `isPassable(x, y)` determines which tiles can be traversed. Returns a `Set<"x,y">` of all reachable positions. 4-connected neighbors.

### `checkConnectivity(walkableSet, excludeSet)`

Verifies that all tiles in `walkableSet` minus `excludeSet` are still reachable from each other. Picks an arbitrary start tile and flood-fills — returns `true` if the fill reaches every tile.

### `bfsDistance(x1, y1, x2, y2, walkableSet)`

Point-to-point BFS returning the shortest path distance between two positions through the walkable set. Returns `Infinity` if unreachable.

## Public API

### Layer Access

- `getLayer(layerName)` - Get entire layer array
- `getTile(layerName, x, y)` - Get tile ID at position
- `setTile(layerName, x, y, tileId)` - Set tile ID at position
- `getNeighbors(x, y)` - Get 8-directional neighbor positions
- `forEach(callback)` - Iterate all map positions

### Map Loading

- `loadTiledMap(path, options)` - Load .tmj map file
- `generateProceduralMap(config, depth)` - Generate full procedural map

### Wildcard Processing

- `processWildcards(context)` - Generate content in wildcard regions
- `getWildcardType(tileId, context)` - Map tile ID to wildcard type

### Room Types

- `registerRoomType(name, config)` - Add custom room type
- `selectRoomTypeForDepth(depth, region)` - Pick room type for depth

### Spawning

- `spawnPendingWalls(context)` - Spawn accumulated wall actors
- `spawnPendingDoors(context)` - Spawn accumulated door actors
- `spawnPendingTorches(context)` - Spawn accumulated torch actors
- `spawnPendingLava(context)` - Spawn accumulated lava actors
- `spawnPendingLakes(context)` - Spawn accumulated lake actors (water + deep water)
- `spawnPendingSewage(context)` - Spawn accumulated sewage actors
- `spawnPendingFungus(context)` - Spawn accumulated fungus actors
- `spawnPendingBridges(context)` - Spawn accumulated rope bridge actors
- `spawnPendingPushableWalls(context)` - Spawn accumulated pushable wall actors

### Utilities

- `createBlob(minW, maxW, minH, maxH, percentSeeded, iterations)` - Generate CA blob shape
- `floodFill(x, y, isPassable, w, h)` - BFS reachability
- `checkConnectivity(walkableSet, excludeSet)` - Verify map connectivity
- `bfsDistance(x1, y1, x2, y2, walkableSet)` - Shortest path distance
- `getRandomWalkableTile()` - Random position from walkable tiles
- `isWalkable(x, y)` - Check if position is walkable
- `addBaseAndShadows()` - Add diagonal shadow effects
- `serializeMap()` / `deserializeMap(data)` - Save/load full map state
- `cleanup()` - Reset map layers

## Example Configs

### Cave with lakes, fungus, and bridges

```json
{
  "map_generator": {
    "type": "cellular",
    "options": {
      "map_width": 80, "map_height": 80,
      "lakes": { "count": [1, 3], "types": ["water"], "minSize": 15, "maxSize": 120 },
      "fungus_chance": 8,
      "bridges": { "max": 2, "min_span": 3, "max_span": 10 }
    }
  }
}
```

### Shaped dungeon with loops

```json
{
  "map_generator": {
    "type": "shaped",
    "options": {
      "map_width": 80, "map_height": 80,
      "roomWidth": [5, 14], "roomHeight": [4, 12],
      "corridorLength": [2, 6],
      "dugPercentage": 0.3,
      "secondary_connections": { "max": 3, "min_distance": 20 }
    }
  }
}
```

### Infernal cave with extra lava lakes

```json
{
  "map_generator": {
    "type": "infernal",
    "options": {
      "map_width": 75, "map_height": 60,
      "lakes": { "count": [1, 2], "types": ["lava"], "minSize": 20, "maxSize": 100 }
    }
  }
}
```

### Digger with sewage and shortcuts

```json
{
  "map_generator": {
    "type": "digger",
    "options": {
      "map_width": 80, "map_height": 80,
      "roomWidth": [5, 12], "roomHeight": [4, 10],
      "corridorLength": [3, 8],
      "dugPercentage": 0.35,
      "sewage_chance": 10,
      "secondary_connections": { "max": 2, "min_distance": 25 }
    }
  }
}
```
