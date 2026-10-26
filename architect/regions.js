/**
 * Architect methods: per-region generators (maze, rot.js maps, digger, cave,
 * infernal, room, dungeon and palladian) used by wildcard regions and as the
 * entry points of whole-floor generation.
 */

import { anyNeighbor8 } from './architect.js';

export const ArchitectRegions = {
    // ========================================================================
    // REGIONAL GENERATION METHODS
    // ========================================================================

    generateMazeAt(startX, startY, width, height) {
        const maze = new ROT.Map.EllerMaze(width, height);
        maze.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'maze') {
                    return;
                }

                if (value === 0) {
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = this._floorTile();
                    this.walkableTiles.push({ x: worldX, y: worldY });
                }
            }
        });
    },

    /**
     * Runs a plain ROT.Map generator inside one wildcard region and walls whatever it
     * leaves solid.
     *
     * The six generators this serves (uniform, rogue, divided_maze, icey_maze, arena,
     * and the region form of the maze family) build no walls of their own: as full-floor
     * generators the map edge bounds them, but a region is a hole in an authored map, so
     * an uncarved cell would just show whatever the designer already painted there and
     * the region would have no edge. Filling the remainder — the same thing
     * _generateCaveRegion and generateDiggerRegionAt do — is what makes a painted region
     * read as a place rather than a smudge.
     *
     * `maze` (tile 210) deliberately does NOT come through here. It predates this and
     * carves floor only; routing it here would put walls into existing authored maps.
     *
     * @param {string} wildcardType  region tag to claim cells by
     * @param {() => ROT.Map} makeGenerator  builds the generator at region size
     * @param {string} label         for the console line
     */
    _generateRotRegion(wildcardType, makeGenerator, label, startX, startY, width, height, context = null) {
        const mapGenConfig = context?.getMapGeneratorConfig?.() || {};
        const floorCells = new Set();
        const wallPositions = [];

        const claims = (worldX, worldY) =>
            worldX < this.width && worldY < this.height &&
            this.wildcardMap[worldY][worldX]?.type === wildcardType;

        const carve = (x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;
            if (value !== 0 || !claims(worldX, worldY)) return;
            this.backgroundMap[worldY][worldX] = null;
            this.floorMap[worldY][worldX] = this._floorTile();
            this.walkableTiles.push({ x: worldX, y: worldY });
            floorCells.add(`${x},${y}`);
        };

        // Some ROT generators throw on a region smaller than their own structure needs
        // — Rogue subdivides into a 3x3 cell grid and wants ~22 tiles a side, IceyMaze
        // wants 3. A designer painting a small patch shouldn't get a broken floor, and a
        // generator that throws takes loadFloor down with it, so fall back to open floor
        // (what Arena would have produced) and say so.
        try {
            makeGenerator().create(carve);
        } catch (e) {
            console.warn(`${label}: region ${width}x${height} is too small for this generator (${e.message}); filling it as open floor instead`);
            floorCells.clear();
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const isEdge = (x === 0 || x === width - 1 || y === 0 || y === height - 1);
                    if (!isEdge) carve(x, y, 0);
                }
            }
        }

        // Whatever the generator left solid becomes a wall, on a floor tile so it sits
        // on ground rather than over the void.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (floorCells.has(`${x},${y}`)) continue;
                const worldX = startX + x;
                const worldY = startY + y;
                if (!claims(worldX, worldY)) continue;
                this.backgroundMap[worldY][worldX] = null;
                this.floorMap[worldY][worldX] = this._floorTile();
                wallPositions.push({ x: worldX, y: worldY });
            }
        }

        const wallTypes = mapGenConfig.wall_types || [{ type: 'wall', weight: 100 }];
        for (const pos of wallPositions) {
            this.pendingWallSpawns.push({ x: pos.x, y: pos.y, type: this._pickWeightedWallType(wallTypes) });
        }

        console.log(`${label} generated: ${floorCells.size} floor tiles, ${wallPositions.length} walls`);
        return { floorCells, wallPositions };
    },

    generateUniformAt(startX, startY, width, height, context = null) {
        const cfg = context?.getMapGeneratorConfig?.() || {};
        const make = () => new ROT.Map.Uniform(width, height, {
            roomWidth: cfg.roomWidth || [3, 9],
            roomHeight: cfg.roomHeight || [3, 5],
            roomDugPercentage: cfg.roomDugPercentage || 0.1
        });
        return this._generateRotRegion('uniform', make, 'Uniform region', startX, startY, width, height, context);
    },

    generateRogueAt(startX, startY, width, height, context = null) {
        const cfg = context?.getMapGeneratorConfig?.() || {};
        const make = () => new ROT.Map.Rogue(width, height, {
            cellWidth: cfg.cellWidth || 3,
            cellHeight: cfg.cellHeight || 3,
            roomWidth: cfg.roomWidth || [3, 9],
            roomHeight: cfg.roomHeight || [3, 5]
        });
        return this._generateRotRegion('rogue', make, 'Rogue region', startX, startY, width, height, context);
    },

    generateDividedMazeAt(startX, startY, width, height, context = null) {
        const make = () => new ROT.Map.DividedMaze(width, height);
        return this._generateRotRegion('divided_maze', make, 'Divided maze region', startX, startY, width, height, context);
    },

    generateIceyMazeAt(startX, startY, width, height, context = null) {
        const cfg = context?.getMapGeneratorConfig?.() || {};
        const make = () => new ROT.Map.IceyMaze(width, height, cfg.regularity || 0);
        return this._generateRotRegion('icey_maze', make, 'Icey maze region', startX, startY, width, height, context);
    },

    generateArenaAt(startX, startY, width, height, context = null) {
        const make = () => new ROT.Map.Arena(width, height);
        return this._generateRotRegion('arena', make, 'Arena region', startX, startY, width, height, context);
    },

    generateDiggerRegionAt(startX, startY, width, height, context = null) {
        const minDimension = Math.min(width, height);
        // A room needs a wall on every side, so anything thinner digs nothing.
        if (minDimension < 3) {
            console.warn(`Digger region at (${startX}, ${startY}) is ${width}x${height}; it needs at least 3x3 — skipped`);
            return;
        }

        const maxRoomWidth = Math.min(12, Math.max(7, Math.floor(width / 4)));
        const maxRoomHeight = Math.min(10, Math.max(5, Math.floor(height / 5)));
        const maxCorridorLength = Math.min(8, Math.max(5, Math.floor(minDimension / 8)));
        const dugPercentage = Math.min(0.5, 0.25 + (minDimension / 200));

        // ROT places the first room at a random offset around the region's centre
        // with no bounds check, and _addDoors then reads one cell past the room on
        // every side. A room wider than this can land on the edge and throw, which
        // is what a small painted region (e.g. 5 wide) did.
        const fitRoom = (lo, hi, span) => {
            const cap = Math.min(Math.floor(span / 2), span - 1 - Math.floor(span / 2));
            return [Math.min(lo, cap), Math.min(hi, cap)];
        };
        const roomWidth = fitRoom(3, maxRoomWidth, width);
        const roomHeight = fitRoom(3, maxRoomHeight, height);

        const dungeon = new ROT.Map.Digger(width, height, {
            roomWidth,
            roomHeight,
            corridorLength: [2, maxCorridorLength],
            dugPercentage: dugPercentage
        });

        console.log(`Digger region: ${width}x${height}, rooms ${roomWidth.join('-')} x ${roomHeight.join('-')}, corridors 2-${maxCorridorLength}, dug ${(dugPercentage * 100).toFixed(0)}%`);

        const floorCells = new Set();
        const wallPositions = [];
        const doorPositions = [];

        dungeon.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;

            if (worldX < this.width && worldY < this.height) {
                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'digger_region') {
                    return;
                }

                if (value === 0) {
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = this._floorTile();
                    this.walkableTiles.push({ x: worldX, y: worldY });
                    floorCells.add(`${x},${y}`);
                }
            }
        });

        const hasFloor = (lx, ly) => floorCells.has(`${lx},${ly}`);
        const inBounds = (lx, ly) => lx >= 0 && lx < width && ly >= 0 && ly < height;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (hasFloor(x, y)) continue;

                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX >= this.width || worldY >= this.height) continue;

                const wildcard = this.wildcardMap[worldY][worldX];
                if (!wildcard || wildcard.type !== 'digger_region') continue;

                const adjacentToFloor =
                    (inBounds(x - 1, y) && hasFloor(x - 1, y)) ||
                    (inBounds(x + 1, y) && hasFloor(x + 1, y)) ||
                    (inBounds(x, y - 1) && hasFloor(x, y - 1)) ||
                    (inBounds(x, y + 1) && hasFloor(x, y + 1)) ||
                    (inBounds(x - 1, y - 1) && hasFloor(x - 1, y - 1)) ||
                    (inBounds(x + 1, y - 1) && hasFloor(x + 1, y - 1)) ||
                    (inBounds(x - 1, y + 1) && hasFloor(x - 1, y + 1)) ||
                    (inBounds(x + 1, y + 1) && hasFloor(x + 1, y + 1));

                if (adjacentToFloor && worldY > 0) {
                    wallPositions.push({ x: worldX, y: worldY });
                    this.backgroundMap[worldY][worldX] = null;
                    this.floorMap[worldY][worldX] = this._floorTile();
                }
            }
        }

        const rooms = dungeon.getRooms();
        const torchPositions = [];

        for (const room of rooms) {
            const roomWalls = [];

            room.getDoors((x, y) => {
                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX < this.width && worldY < this.height && worldY > 0) {
                    const wildcard = this.wildcardMap[worldY][worldX];
                    if (wildcard && wildcard.type === 'digger_region') {
                        if (ROT.RNG.getPercentage() <= 50) {
                            doorPositions.push({ x: worldX, y: worldY });
                        }
                    }
                }
            });

            const roomLeft = room.getLeft();
            const roomRight = room.getRight();
            const roomTop = room.getTop();
            const roomBottom = room.getBottom();

            for (const wallPos of wallPositions) {
                const localX = wallPos.x - startX;
                const localY = wallPos.y - startY;

                const isOnRoomPerimeter = (
                    (localX >= roomLeft - 1 && localX <= roomRight + 1 &&
                     localY >= roomTop - 1 && localY <= roomBottom + 1) &&
                    (localX === roomLeft - 1 || localX === roomRight + 1 ||
                     localY === roomTop - 1 || localY === roomBottom + 1)
                );

                if (isOnRoomPerimeter) {
                    roomWalls.push(wallPos);
                }
            }

            if (roomWalls.length > 0 && ROT.RNG.getPercentage() <= 30) {
                const torchIndex = Math.floor(ROT.RNG.getUniform() * roomWalls.length);
                const torchPos = roomWalls[torchIndex];
                torchPositions.push(torchPos);
            }
        }

        const torchSet = new Set(torchPositions.map(p => `${p.x},${p.y}`));
        const filteredWallPositions = wallPositions.filter(p => !torchSet.has(`${p.x},${p.y}`));

        this.pendingWallSpawns.push(...filteredWallPositions);
        this.pendingDoorSpawns.push(...doorPositions);
        this.pendingTorchSpawns.push(...torchPositions);

        console.log(`Dungeon generated: ${floorCells.size} floor tiles, ${filteredWallPositions.length} walls, ${doorPositions.length} doors, ${torchPositions.length} torches`);
    },

    /**
     * Carve a cellular-automaton cave inside a wildcard region, queueing walls
     * around its edges. `wildcardType` is which region cells to claim; `label` names
     * the generator in the log. Anything else the biome adds, such as lava lakes,
     * is applied by the caller afterwards.

    */
    _generateCaveRegion(wildcardType, label, startX, startY, width, height, context = null) {
        const mapGenConfig = context?.getMapGeneratorConfig?.() || {};

        const cave = new ROT.Map.Cellular(width, height, {
            born: mapGenConfig.born || [5, 6, 7, 8],
            survive: mapGenConfig.survive || [4, 5, 6, 7, 8],
            topology: mapGenConfig.topology || 8
        });

        cave.randomize(mapGenConfig.probability || 0.5);

        const iterations = mapGenConfig.iterations || 4;
        for (let i = 0; i < iterations; i++) {
            cave.create();
        }

        const floorCells = new Set();
        const wallPositions = [];

        // The region is a hole in an authored map, so only carve cells it claims.
        const claims = (worldX, worldY) =>
            worldX < this.width && worldY < this.height &&
            this.wildcardMap[worldY][worldX]?.type === wildcardType;

        const carveFloor = (worldX, worldY, localX, localY) => {
            this.backgroundMap[worldY][worldX] = null;
            this.floorMap[worldY][worldX] = this._floorTile();
            this.walkableTiles.push({ x: worldX, y: worldY });
            floorCells.add(`${localX},${localY}`);
        };

        cave.create((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;
            if (value === 0 && claims(worldX, worldY)) carveFloor(worldX, worldY, x, y);
        });

        cave.connect((x, y, value) => {
            const worldX = startX + x;
            const worldY = startY + y;
            if (value === 0 && claims(worldX, worldY) && !this.floorMap[worldY][worldX]) {
                carveFloor(worldX, worldY, x, y);
            }
        }, 1);

        // Whatever the automaton left solid becomes a wall, on a floor tile so it
        // sits on ground rather than over the void.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (floorCells.has(`${x},${y}`)) continue;
                const worldX = startX + x;
                const worldY = startY + y;
                if (!claims(worldX, worldY)) continue;

                this.backgroundMap[worldY][worldX] = null;
                this.floorMap[worldY][worldX] = this._floorTile();
                wallPositions.push({ x: worldX, y: worldY });
            }
        }

        const wallTypes = mapGenConfig.wall_types || [{ type: 'wall', weight: 100 }];
        for (const pos of wallPositions) {
            this.pendingWallSpawns.push({ x: pos.x, y: pos.y, type: this._pickWeightedWallType(wallTypes) });
        }

        console.log(`${label} generated: ${floorCells.size} floor tiles, ${wallPositions.length} walls`);
        return { floorCells, wallPositions };
    },

    generateCaveAt(startX, startY, width, height, context = null) {
        return this._generateCaveRegion('cave', 'Cave', startX, startY, width, height, context);
    },

    generateInfernalAt(startX, startY, width, height, context = null) {
        return this._generateCaveRegion('infernal', 'Infernal cave', startX, startY, width, height, context);
    },

    generateRoomAt(startX, startY, width, height, context = null) {
        const wallPositions = [];

        const hasMazeFloor = (wx, wy) => {
            if (wx < 0 || wx >= this.width || wy < 0 || wy >= this.height) return false;
            const floor = this.floorMap[wy][wx];
            return floor && floor.tileId === this.config.defaultFloorTileId;
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const worldX = startX + x;
                const worldY = startY + y;

                if (worldX < this.width && worldY < this.height) {
                    this.backgroundMap[worldY][worldX] = null;

                    const isPerimeter = (x === 0 || x === width - 1 || y === 0 || y === height - 1);

                    let hasAdjacentMazePath = false;
                    if (isPerimeter) {
                        if (x === 0 && hasMazeFloor(worldX - 1, worldY)) hasAdjacentMazePath = true;
                        if (x === width - 1 && hasMazeFloor(worldX + 1, worldY)) hasAdjacentMazePath = true;
                        if (y === 0 && hasMazeFloor(worldX, worldY - 1)) hasAdjacentMazePath = true;
                        if (y === height - 1 && hasMazeFloor(worldX, worldY + 1)) hasAdjacentMazePath = true;
                    }

                    if (isPerimeter && !hasAdjacentMazePath) {
                        if (worldY > 0) {
                            wallPositions.push({ x: worldX, y: worldY });
                        }
                        this.floorMap[worldY][worldX] = this._floorTile();
                    } else {
                        this.floorMap[worldY][worldX] = this._floorTile();
                        this.walkableTiles.push({ x: worldX, y: worldY });
                    }
                }
            }
        }

        this.pendingWallSpawns.push(...wallPositions);
    },

    /**
     * Wildcard counterpart to the full-floor 'dungeon' case: rooms, corridors, loops and
     * dead-end secret doors inside a single wildcard region.
     *
     * Builds on a full-map-sized grid rather than a region-sized one, so every stage
     * helper (_dungeonPlaceRoom, _dungeonMakeLoops, _dungeonCarveWindingCorridors,
     * _dungeonFixDeadEnds) takes world coordinates and needs no change — they already
     * accept mapW/mapH as parameters. Placement is kept inside the region by seeding
     * there and rejecting any room that lands outside the mask.
     *
     * Finalizes through _palladianFinalizeRegion, which despite the name is the generic
     * region finalizer: mask-clipped, APPENDS its rooms instead of assigning
     * this.diggerRooms, and skips the perimeter/metal_wall rule that would wall the
     * region off from the rest of the floor.
     */
    generateDungeonRegionAt(startX, startY, width, height, context = null) {
        const o = context?.getMapGeneratorConfig?.() || {};

        // Scale room count to the region rather than the whole map. The divisor is ~100
        // where the full-floor case uses ~200: a region has no map-edge margin to lose
        // and rooms are rejected for straying outside the mask, so a looser budget is
        // what actually fills it. Measured on a 28x28 region, this lands near the ~40%
        // open-floor fill a full floor gets; raising it further changes nothing, since
        // placement saturates.
        const autoMaxRooms = Math.min(40, Math.max(2, Math.round((width * height) / 100)));
        const cfg = {
            maxRooms: o.maxRooms || autoMaxRooms,
            maxAttempts: o.maxAttempts || Math.min(300, Math.max(30, autoMaxRooms * 8)),
            corridorChance: o.corridorChance ?? 55,
            corridorLength: o.corridorLength || [3, 9],
            maxWindingCorridors: o.maxWindingCorridors ?? Math.min(6, Math.max(1, Math.round((width * height) / 1250))),
            windingLength: o.windingLength || [6, 22],
            windingBranchChance: o.windingBranchChance ?? 25,
            loopMinDistance: o.loopMinDistance || 20,
            maxLoops: o.maxLoops || 5,
            doorChance: o.doorChance ?? 50,
            torchChance: o.torchChance ?? 30,
            secretDoorChance: o.secretDoorChance ?? 0,
            secretWallChance: o.secretWallChance ?? 0,
            wall_types: o.wall_types || [{ type: 'wall', weight: 100 }],
            roomWeights: o.roomWeights || { rectangle: 50, cross: 10, circular: 10, cavern: 30 },
            rectWidth: o.rectWidth || [4, 12], rectHeight: o.rectHeight || [4, 14],
            crossWidth: o.crossWidth || [7, 20], crossHeight: o.crossHeight || [7, 22],
            circularRadius: o.circularRadius || [2, 10],
            cavernWidth: o.cavernWidth || [8, 20], cavernHeight: o.cavernHeight || [8, 15],
        };

        const mask = new Set();
        for (let y = startY; y < Math.min(startY + height, this.height); y++) {
            for (let x = startX; x < Math.min(startX + width, this.width); x++) {
                if (this.wildcardMap[y][x]?.type === 'dungeon') mask.add(`${x},${y}`);
            }
        }
        if (mask.size === 0) return;

        const dungeonGrid = Array.from({ length: this.height }, () => new Uint8Array(this.width));
        const rooms = [];

        // Only cells the region claims may be dug. Everything downstream reads the grid,
        // so confining writes here confines the whole generator.
        const fits = (grid, w, h, ox, oy) => {
            for (let ry = 0; ry < h; ry++) {
                for (let rx = 0; rx < w; rx++) {
                    if (grid[ry][rx] !== 1) continue;
                    if (!mask.has(`${ox + rx},${oy + ry}`)) return false;
                }
            }
            return true;
        };

        const first = this._dungeonMakeRoom('rectangle', cfg);
        let seeded = false;
        for (let tries = 0; tries < 60 && !seeded; tries++) {
            const ox = startX + Math.floor(ROT.RNG.getUniform() * Math.max(1, width - first.width));
            const oy = startY + Math.floor(ROT.RNG.getUniform() * Math.max(1, height - first.height));
            if (!fits(first.grid, first.width, first.height, ox, oy)) continue;
            for (let ry = 0; ry < first.height; ry++) {
                for (let rx = 0; rx < first.width; rx++) {
                    if (first.grid[ry][rx] === 1) dungeonGrid[oy + ry][ox + rx] = 1;
                }
            }
            rooms.push(this._makeRoomRecord(first.grid, first.width, first.height, ox, oy, []));
            seeded = true;
        }
        if (!seeded) {
            // No room fit. Rather than leave the painted region as untouched background
            // — a hole in the floor the designer didn't ask for — fall back to a walled
            // open space, the same degradation the ROT region generators use.
            console.warn(`Dungeon region: ${width}x${height} is too small to seed a room; filling it as open floor instead`);
            const wallTypes = cfg.wall_types;
            for (const key of mask) {
                const [x, y] = key.split(',').map(Number);
                this.backgroundMap[y][x] = null;
                this.floorMap[y][x] = this._floorTile();
                const edge = !mask.has(`${x - 1},${y}`) || !mask.has(`${x + 1},${y}`) ||
                             !mask.has(`${x},${y - 1}`) || !mask.has(`${x},${y + 1}`);
                if (edge && y > 0) {
                    this.pendingWallSpawns.push({ x, y, type: this._pickWeightedWallType(wallTypes) });
                } else {
                    this.walkableTiles.push({ x, y });
                }
            }
            return;
        }

        let built = 1;
        for (let attempt = 0; attempt < cfg.maxAttempts && built < cfg.maxRooms; attempt++) {
            const type = this._dungeonPickRoomType(cfg.roomWeights);
            const room = this._dungeonMakeRoom(type, cfg);
            let doorSites = this._dungeonFindDoorSites(room.grid, room.width, room.height);
            const corr = this._dungeonMaybeAddCorridor(room.grid, room.width, room.height, doorSites, cfg);
            if (corr.grid) { room.grid = corr.grid; room.width = corr.width; room.height = corr.height; doorSites = corr.doorSites; }

            const placement = this._dungeonPlaceRoom(
                dungeonGrid, room.grid, room.width, room.height, doorSites,
                this.width, this.height, corr.corridorCells || []);
            if (!placement) continue;

            // _dungeonPlaceRoom only proposes a position — the caller stamps it. So an
            // out-of-region placement is simply skipped, never undone.
            if (!fits(room.grid, room.width, room.height, placement.offsetX, placement.offsetY) ||
                !mask.has(`${placement.doorWorldX},${placement.doorWorldY}`)) {
                continue;
            }

            for (let ry = 0; ry < room.height; ry++) {
                for (let rx = 0; rx < room.width; rx++) {
                    if (room.grid[ry][rx] === 1) dungeonGrid[placement.offsetY + ry][placement.offsetX + rx] = 1;
                }
            }
            dungeonGrid[placement.doorWorldY][placement.doorWorldX] = 2;

            rooms.push(this._makeRoomRecord(
                room.grid, room.width, room.height, placement.offsetX, placement.offsetY,
                [{ x: placement.doorWorldX, y: placement.doorWorldY }]));
            built++;
        }

        this._dungeonMakeLoops(dungeonGrid, rooms, this.width, this.height, cfg);
        this._dungeonCarveWindingCorridors(dungeonGrid, rooms, this.width, this.height, cfg);

        // Clip anything the loop/corridor passes pushed outside the region before it
        // reaches the finalizer, which would otherwise paint it.
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (dungeonGrid[y][x] && !mask.has(`${x},${y}`)) dungeonGrid[y][x] = 0;
            }
        }

        this._palladianFinalizeRegion(dungeonGrid, rooms, mask, cfg);
        this.diggerRooms = (this.diggerRooms || []).concat(rooms);
        console.log(`Dungeon region generated: ${built} rooms in ${mask.size} claimed tiles`);
    },

    /**
     * Wildcard counterpart to the full-floor 'palladian' case: drops a villa inside a
     * single wildcard region, so a temple can be one feature of a larger floor.
     *
     * Reuses every stage helper unchanged by having _palladianBuildGrid center the plan
     * inside the region's bounding box — the plan it returns is in world coordinates, so
     * carving, openings, columns and windows all work as they do on a full floor. Only
     * the finalize step differs (see _palladianFinalizeRegion).
     */
    generatePalladianAt(startX, startY, width, height, context = null) {
        const mapGenConfig = context?.getMapGeneratorConfig?.() || {};
        const cfg = {
            bayColumns: mapGenConfig.bayColumns || [3, 5],
            bayRows: mapGenConfig.bayRows || [2, 3],
            bayWidth: mapGenConfig.bayWidth || [3, 7],
            bayHeight: mapGenConfig.bayHeight || [3, 6],
            centralBias: mapGenConfig.centralBias ?? 150,
            mergeChance: mapGenConfig.mergeChance ?? 45,
            sanctumChance: mapGenConfig.sanctumChance ?? 70,
            sanctumShapes: mapGenConfig.sanctumShapes || ['cross', 'tee', 'eye'],
            // A wildcard villa sits inside an existing floor, so a projecting portico
            // would push its colonnade into whatever is already there. In-antis keeps
            // the whole composition inside the region footprint.
            porticoStyle: mapGenConfig.porticoStyle || 'in_antis',
            porticoDepth: mapGenConfig.porticoDepth ?? 2,
            columnSpacing: mapGenConfig.columnSpacing ?? 2,
            doorChance: mapGenConfig.doorChance ?? 55,
            torchChance: mapGenConfig.torchChance ?? 40,
            wall_types: mapGenConfig.wall_types || [{ type: 'brick_wall', weight: 100 }],
            secretPassageChance: mapGenConfig.secretPassageChance ?? 40,
            secretPassageLeverChance: mapGenConfig.secretPassageLeverChance ?? 35,
        };

        // The mask is the region as authored, which may be an irregular blob. The plan
        // is fitted to the bounding box, so a non-rectangular region can clip it; the
        // mask keeps that clip from corrupting neighbouring geometry.
        // The region's cells, in world coordinates. Reads wildcardMap directly
        // rather than ctx.get, which returns a tileId and not the wildcard's type.
        const mask = this.applyTilePattern('wildcards', [{
            when: (ctx, x, y) => this.wildcardMap[y][x]?.type === 'palladian',
            paint: null
        }], {
            collect: 'set',
            bounds: { x1: startX, y1: startY, x2: startX + width - 1, y2: startY + height - 1 }
        });
        if (mask.size === 0) return;

        const plan = this._palladianBuildGrid(cfg, { x: startX, y: startY, width, height });
        if (!plan) {
            // Too small for even a 1x1 villa. Carve the region as a plain hall rather
            // than leaving a hole in the floor the player can't cross.
            console.warn(`Palladian wildcard: region ${width}x${height} at (${startX},${startY}) too small for a villa; carving a plain hall`);
            for (const key of mask) {
                const [hx, hy] = key.split(',').map(Number);
                this.backgroundMap[hy][hx] = null;
                this.floorMap[hy][hx] = this._floorTile();
                this.walkableTiles.push({ x: hx, y: hy });
            }
            return;
        }

        const dungeonGrid = Array.from({ length: this.height }, () => new Uint8Array(this.width));
        this._palladianCarveBays(dungeonGrid, plan);
        const rooms = this._palladianLayoutRooms(dungeonGrid, plan, cfg);
        const portico = this._palladianAddPortico(dungeonGrid, plan, cfg);
        const openings = this._palladianAddOpenings(dungeonGrid, plan, rooms, portico, cfg);
        this._palladianEnsureConnected(dungeonGrid, plan, rooms, portico);
        const secrets = this._palladianAddSecretPassages(dungeonGrid, plan, rooms, cfg);

        const records = this._palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings);
        this._palladianFinalizeRegion(dungeonGrid, records, mask, cfg);
        this._palladianQueueSecrets(secrets);

        // Same ordering rule as the full-floor path: decoration must run after
        // finalize, or the torch pass converts a column into a wall torch.
        this._palladianPlaceColumns(plan, portico, cfg);
        this._palladianPlaceWindows(openings);
        this._palladianPublishRegions(dungeonGrid, plan, records, portico);
        this.palladianPlan = plan;

        const sanctum = records.find(r => r.isSanctum);
        console.log(
            `Palladian wildcard villa ${plan.nCols}x${plan.nRows} bays ` +
            `(${plan.footprintW}x${plan.footprintH} tiles at ${plan.left},${plan.top}, axis x=${plan.axisX}) ` +
            `in region ${width}x${height} at (${startX},${startY}): ` +
            `${records.length} rooms, sanctum ${sanctum ? sanctum.shape : 'none'}, ` +
            `portico ${portico ? portico.style : 'none'}, ${openings.windows.length} windows.`
        );
    },

    /**
     * Region-scoped variant of _finalizeMap.
     *
     * Differs in three ways that matter, all of them consequences of there being a
     * map outside the villa:
     *   - iteration and every write are clipped to `mask`, so the pass cannot repaint
     *     the surrounding floor;
     *   - there is no perimeter/metal_wall rule. That rule exists to seal the edge of
     *     the world; inside a floor it would wall the villa off from its surroundings;
     *   - rooms and regions are APPENDED. _finalizeMap assigns this.diggerRooms,
     *     which would discard the rooms of every other generator on the floor.
     */
    _palladianFinalizeRegion(dungeonGrid, rooms, mask, cfg) {
        const floorSet = new Set();
        const inMask = (x, y) => mask.has(`${x},${y}`);

        for (const key of mask) {
            const [x, y] = key.split(',').map(Number);
            if (dungeonGrid[y][x] >= 1) {
                this.backgroundMap[y][x] = null;
                this.floorMap[y][x] = this._floorTile();
                this.walkableTiles.push({ x, y });
                floorSet.add(key);
            }
        }

        const hasFloor = (fx, fy) => floorSet.has(`${fx},${fy}`);
        const wallTypes = cfg.wall_types;
        const pickWallType = () => this._pickWeightedWallType(wallTypes);

        for (const key of mask) {
            const [x, y] = key.split(',').map(Number);
            if (floorSet.has(key)) continue;
            const adj = anyNeighbor8(hasFloor, x, y);
            if (!adj || y === 0) continue;

            this.floorMap[y][x] = this._floorTile();
            this.pendingWallSpawns.push({ x, y, type: pickWallType() });
        }

        // Doors: dungeonGrid marks them with 2. Clipped to the mask like everything else.
        for (const key of mask) {
            const [x, y] = key.split(',').map(Number);
            if (dungeonGrid[y][x] === 2 && y > 0 && ROT.RNG.getPercentage() <= cfg.doorChance) {
                this.pendingDoorSpawns.push({ x, y });
            }
        }

        for (const room of rooms) {
            if (ROT.RNG.getPercentage() > cfg.torchChance) continue;
            const roomWalls = this.pendingWallSpawns.filter(p =>
                p.type !== 'metal_wall' && inMask(p.x, p.y) &&
                p.x >= room._x1 - 1 && p.x <= room._x2 + 1 &&
                p.y >= room._y1 - 1 && p.y <= room._y2 + 1
            );
            if (roomWalls.length === 0) continue;
            this.queueRoomLights(
                roomWalls, this.countRoomFloorTiles(room, floorSet), room, floorSet
            );
        }

        this.diggerRooms = [...(this.diggerRooms || []), ...rooms];
        this.publishRoomRegions(rooms, floorSet);
    },
};
