# Architect - Dungeon Generation System

The Architect class handles all map generation, loading, and terrain management.

## Overview

```
architect.js
├── Map Layer Management (background, floor, wall, wildcard)
├── Tiled Map Loading (.tmj files)
├── Procedural Generation (ROT.js integration)
├── Wildcard Processing (region-based generation)
├── Room Type Registry (data-driven room shapes)
└── Entity Spawning (deferred wall/door/torch/lava spawning)
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
| `dungeon` | 9, 16, 152 | ROT.js Digger | walled Rooms + corridors with doors |
| `cave` | 10 | ROT.js Cellular | Organic cave shapes |
| `infernal` | 11 | Cellular + lava | Cave with lava pools |
| `room` | 143, 144 | Room type system | Define one rectangular room with walls |
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

When that tile appears in the wildcards layer, the Architect spawns the corresponding actor at each tile position.

## Procedural Generation

When no Tiled map exists, generate a full procedural map:

```javascript
architect.generateProceduralMap({
  type: 'cellular',  // Generator type
  options: {
    born: [5, 6, 7, 8],
    survive: [4, 5, 6, 7, 8],
    probability: 0.5,
    iterations: 4,
    connected: true,
    wall_types: [
      { type: 'rock_wall', weight: 95 },
      { type: 'pitchblende_wall', weight: 5 }
    ]
  }
});
```

### Generator Types

| Type | ROT.js Class | Description |
|------|--------------|-------------|
| `digger` | Digger | Rooms connected by corridors (default) |
| `cellular` | Cellular | Cave-like organic shapes |
| `uniform` | Uniform | Evenly distributed rooms |
| `rogue` | Rogue | Classic roguelike grid rooms |
| `divided_maze` | DividedMaze | Recursive division maze |
| `icey_maze` | IceyMaze | Maze with regularity control |
| `eller_maze` | EllerMaze | Perfect maze (Eller's algorithm) |
| `arena` | Arena | Simple empty rectangle |
| `infernal` | Cellular | Cave + lava pools |

## Room Type Registry

The Architect uses a data-driven room type system for varied room shapes. Room types are selected based on dungeon depth and weighted randomness.

### Default Room Types

| Type | Min Depth | Weight | Min Size | Description |
|------|-----------|--------|----------|-------------|
| `rectangular` | 1 | 100 | 3x3 | Standard rectangular room |
| `cross` | 2 | 30 | 7x7 | Two overlapping rectangles (+ shape) |
| `circular` | 3 | 20 | 5x5 | Ellipse fitted to region |
| `chunky` | 4 | 15 | 7x7 | Organic blob (overlapping circles) |

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
  wildcardTileId: 200  // Optional: explicit tile ID for Tiled
});
```

### Depth-Based Selection

```javascript
const roomType = architect.selectRoomTypeForDepth(depth);
// Returns room type name based on:
// 1. Depth must be within [minDepth, maxDepth]
// 2. Weighted random selection among valid types
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

During generation, the Architect collects spawn positions but defers actual entity creation:

```javascript
// During generation
architect.pendingWallSpawns.push({ x, y, type: 'wall' });
architect.pendingDoorSpawns.push({ x, y });
architect.pendingTorchSpawns.push({ x, y });
architect.pendingLavaSpawns.push({ x, y });

// After EntityManager exists
architect.spawnPendingWalls(context);
architect.spawnPendingDoors(context);
architect.spawnPendingTorches(context);
architect.spawnPendingLava(context);
```

## Public API

### Layer Access

- `getLayer(layerName)` - Get entire layer array
- `getTile(layerName, x, y)` - Get tile ID at position
- `setTile(layerName, x, y, tileId)` - Set tile ID at position
- `getNeighbors(x, y)` - Get 8-directional neighbor positions
- `forEach(callback)` - Iterate all map positions

### Map Loading

- `loadTiledMap(path, options)` - Load .tmj map file
- `generateProceduralMap(config)` - Generate full procedural map

### Wildcard Processing

- `processWildcards(context)` - Generate content in wildcard regions
- `getWildcardType(tileId, context)` - Map tile ID to wildcard type

### Room Types

- `registerRoomType(name, config)` - Add custom room type
- `selectRoomTypeForDepth(depth)` - Pick room type for depth

### Spawning

- `spawnPendingWalls(context)` - Spawn accumulated wall actors
- `spawnPendingDoors(context)` - Spawn accumulated door actors
- `spawnPendingTorches(context)` - Spawn accumulated torch actors
- `spawnPendingLava(context)` - Spawn accumulated lava actors

### Utilities

- `getRandomWalkableTile()` - Random position from walkable tiles
- `isWalkable(x, y)` - Check if position is walkable
- `addBaseAndShadows()` - Add diagonal shadow effects
- `serializeMap()` / `deserializeMap(data)` - Save/load map state
- `cleanup()` - Reset map layers

## Example: Custom Cave Generator

```javascript
// In prototype.json
{
  "map_generator": {
    "type": "cellular",
    "options": {
      "born": [5, 6, 7, 8],
      "survive": [4, 5, 6, 7, 8],
      "probability": 0.45,
      "iterations": 5,
      "connected": true,
      "wall_types": [
        { "type": "rock_wall", "weight": 90 },
        { "type": "crystal_wall", "weight": 10 }
      ],
      "lava_chance": 20
    }
  }
}
```
