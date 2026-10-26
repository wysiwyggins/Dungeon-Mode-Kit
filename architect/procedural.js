/**
 * Architect methods: generateProceduralMap, the whole-floor procedural
 * pipeline, and its shortcut test.
 */

import { anyNeighbor8 } from './architect.js';

export const ArchitectProcedural = {
    // ========================================================================
    // PROCEDURAL GENERATION
    // ========================================================================

    generateProceduralMap(generatorConfig = {}) {
        const generatorType = generatorConfig.type || 'digger';
        const options = generatorConfig.options || {};

        if (options.map_width) this.width = options.map_width;
        if (options.map_height) this.height = options.map_height;

        this.backgroundMap = this.createEmptyMap();
        this.floorMap = this.createEmptyMap();
        this.wildcardMap = this.createEmptyMap();
        this.overlayMap = this.createEmptyMap();
        this.walkableTiles = [];

        console.log(`Generating procedural map with ${generatorType} generator (${this.width}x${this.height})`);

        let generator;

        switch (generatorType) {
            case 'cellular': {
                generator = new ROT.Map.Cellular(this.width, this.height, {
                    born: options.born || [5, 6, 7, 8],
                    survive: options.survive || [4, 5, 6, 7, 8],
                    topology: options.topology || 8
                });
                generator.randomize(options.probability || 0.5);
                const iterations = options.iterations || 4;
                for (let i = 0; i < iterations - 1; i++) {
                    generator.create();
                }
                const floorTiles = new Set();
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                        floorTiles.add(`${x},${y}`);
                    }
                });
                if (options.connected !== false) {
                    generator.connect((x, y, value) => {
                        if (value === 0 && !this.floorMap[y][x]) {
                            this.floorMap[y][x] = this._floorTile();
                            this.walkableTiles.push({ x, y });
                            floorTiles.add(`${x},${y}`);
                        }
                    }, 1);
                }
                const wallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (!floorTiles.has(`${x},${y}`)) {
                            // Floor goes under the wall actor too. A wall sits ON a floor
                            // tile everywhere else in the engine, and leaving it null here
                            // reads as void downstream. It also shows: actors whose base
                            // tile isn't a solid block — a tree — let the floor show
                            // through, and with no floor that gap renders as nothing.
                            this.floorMap[y][x] = this._floorTile();
                            this.pendingWallSpawns.push({ x, y, type: this._pickWeightedWallType(wallTypes) });
                        }
                    }
                }
                break;
            }

            case 'uniform':
                generator = new ROT.Map.Uniform(this.width, this.height, {
                    roomWidth: options.roomWidth || [3, 9],
                    roomHeight: options.roomHeight || [3, 5],
                    roomDugPercentage: options.roomDugPercentage || 0.1
                });
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'rogue':
                generator = new ROT.Map.Rogue(this.width, this.height, {
                    cellWidth: options.cellWidth || 3,
                    cellHeight: options.cellHeight || 3,
                    roomWidth: options.roomWidth || [3, 9],
                    roomHeight: options.roomHeight || [3, 5]
                });
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'divided_maze':
                generator = new ROT.Map.DividedMaze(this.width, this.height);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'icey_maze':
                generator = new ROT.Map.IceyMaze(this.width, this.height, options.regularity || 0);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'eller_maze':
                generator = new ROT.Map.EllerMaze(this.width, this.height);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'arena':
                generator = new ROT.Map.Arena(this.width, this.height);
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                    }
                });
                break;

            case 'infernal': {
                const infernalCave = new ROT.Map.Cellular(this.width, this.height, {
                    born: options.born || [5, 6, 7, 8],
                    survive: options.survive || [4, 5, 6, 7, 8],
                    topology: options.topology || 8
                });

                infernalCave.randomize(options.probability || 0.5);

                const infernalIterations = options.iterations || 4;
                for (let i = 0; i < infernalIterations; i++) {
                    infernalCave.create();
                }

                const infernalFloorTiles = new Set();

                infernalCave.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                        infernalFloorTiles.add(`${x},${y}`);
                    }
                });

                if (options.connected !== false) {
                    infernalCave.connect((x, y, value) => {
                        if (value === 0 && !this.floorMap[y][x]) {
                            this.floorMap[y][x] = this._floorTile();
                            this.walkableTiles.push({ x, y });
                            infernalFloorTiles.add(`${x},${y}`);
                        }
                    }, 1);
                }

                const infernalWallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];


                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (!infernalFloorTiles.has(`${x},${y}`)) {
                            this.pendingWallSpawns.push({ x, y, type: this._pickWeightedWallType(infernalWallTypes) });
                        }
                    }
                }

                console.log(`Infernal map generated: ${infernalFloorTiles.size} floor tiles`);
                break;
            }

            // 'brogue' is the generator's original name, from when it was written
            // while studying Brogue's architect. It has diverged since; the name is
            // kept as a silent alias so prototypes outside this repo keep loading.
            case 'brogue':
            case 'dungeon': {
                // maxRooms is optional in prototype data: when omitted, scale it to
                // the map area (~200 tiles per room+corridor footprint), clamped so
                // tiny/huge maps stay sane. The divisor leaves gaps between rooms
                // for corridors to snake through. An explicit maxRooms wins.
                const autoMaxRooms = Math.min(120, Math.max(8,
                    Math.round((this.width * this.height) / 200)));
                const autoMaxAttempts = Math.min(600, Math.max(50, autoMaxRooms * 4));
                const autoWindingCorridors = Math.min(16, Math.max(3,
                    Math.round((this.width * this.height) / 1250)));
               
                options.secretWallChance ??= 3;
                const dungeonCfg = {
                    maxRooms: options.maxRooms || autoMaxRooms,
                    maxAttempts: options.maxAttempts || autoMaxAttempts,
                    corridorChance: options.corridorChance ?? 55,
                    corridorLength: options.corridorLength || [3, 9],

                    maxWindingCorridors: options.maxWindingCorridors ?? autoWindingCorridors,
                    windingLength: options.windingLength || [6, 22],
                    windingBranchChance: options.windingBranchChance ?? 25,
                    loopMinDistance: options.loopMinDistance || 20,
                    maxLoops: options.maxLoops || 5,
                    doorChance: options.doorChance ?? 50,
                    torchChance: options.torchChance ?? 30,

                    secretDoorChance: options.secretDoorChance ?? 35,
                    wall_types: options.wall_types || [{ type: 'wall', weight: 100 }],
                    roomWeights: {
                        rectangle: options.roomWeights?.rectangle ?? 30,
                        cross: options.roomWeights?.cross ?? 25,
                        circular: options.roomWeights?.circular ?? 20,
                        cavern: options.roomWeights?.cavern ?? 25
                    },
                    rectWidth: options.rectWidth || [3, 12],
                    rectHeight: options.rectHeight || [3, 8],
                    crossWidth: options.crossWidth || [7, 16],
                    crossHeight: options.crossHeight || [7, 14],
                    circularRadius: options.circularRadius || [2, 5],
                    hollowChance: options.hollowChance ?? 20,
                    cavernWidth: options.cavernWidth || [8, 20],
                    cavernHeight: options.cavernHeight || [8, 15],
                };

                const dungeonGrid = Array.from({ length: this.height }, () => new Uint8Array(this.width));
                const rooms = [];

                // Seed the first room in a randomly-chosen corner. Rooms attach
                // outward from the seed, so a corner seed spreads them across the
                // whole map instead of clustering them in the middle. (margin keeps
                // the room's 1-tile wall border off the map edge.)
                const firstType = this._dungeonMakeRoom('rectangle', dungeonCfg);
                const margin = 2;
                const cornerX = ROT.RNG.getUniform() < 0.5;  // true = left, false = right
                const cornerY = ROT.RNG.getUniform() < 0.5;  // true = top,  false = bottom
                // Clamp to >=1 so an oversized first room on a small map never
                // yields a negative offset (which would write out of bounds).
                const cx = Math.max(1, cornerX
                    ? margin
                    : this.width - firstType.width - margin);
                const cy = Math.max(1, cornerY
                    ? margin
                    : this.height - firstType.height - margin);
                for (let ry = 0; ry < firstType.height; ry++) {
                    for (let rx = 0; rx < firstType.width; rx++) {
                        if (firstType.grid[ry][rx] === 1) {
                            dungeonGrid[cy + ry][cx + rx] = 1;
                        }
                    }
                }
                rooms.push(this._makeRoomRecord(firstType.grid, firstType.width, firstType.height, cx, cy, []));

                // Attach rooms via cellophane sliding
                let roomsBuilt = 1;
                let consecutiveFails = 0;
                let totalFails = 0;
                let attemptsUsed = 0;
                let corridorAttempts = 0;
                let corridorsPlaced = 0;
                let corridorFails = 0;
                let stopReason = 'maxAttempts reached';
                for (let attempt = 0; attempt < dungeonCfg.maxAttempts && roomsBuilt < dungeonCfg.maxRooms; attempt++) {
                    attemptsUsed = attempt + 1;
                    const type = this._dungeonPickRoomType(dungeonCfg.roomWeights);
                    let room = this._dungeonMakeRoom(type, dungeonCfg);
                    let doorSites = this._dungeonFindDoorSites(room.grid, room.width, room.height);
                    if (doorSites.length === 0) continue;

                    const corrResult = this._dungeonMaybeAddCorridor(room.grid, room.width, room.height, doorSites, dungeonCfg);
                    const hadCorridor = corrResult.hasCorridor;
                    if (hadCorridor) corridorAttempts++;
                    room = { grid: corrResult.grid, width: corrResult.width, height: corrResult.height };
                    doorSites = corrResult.doorSites;

                    const placement = this._dungeonPlaceRoom(dungeonGrid, room.grid, room.width, room.height, doorSites, this.width, this.height, corrResult.corridorCells);
                    if (!placement) {
                        consecutiveFails++;
                        totalFails++;
                        if (hadCorridor) corridorFails++;
                        if (consecutiveFails > 10) { stopReason = `10 consecutive placement failures (attempt ${attemptsUsed})`; break; }
                        continue;
                    }
                    consecutiveFails = 0;
                    if (hadCorridor) corridorsPlaced++;

                    // Stamp room onto dungeon grid
                    for (let ry = 0; ry < room.height; ry++) {
                        for (let rx = 0; rx < room.width; rx++) {
                            if (room.grid[ry][rx] === 1) {
                                dungeonGrid[placement.offsetY + ry][placement.offsetX + rx] = 1;
                            }
                        }
                    }
                    dungeonGrid[placement.doorWorldY][placement.doorWorldX] = 2;

                    const record = this._makeRoomRecord(
                        room.grid, room.width, room.height,
                        placement.offsetX, placement.offsetY,
                        [{ x: placement.doorWorldX, y: placement.doorWorldY }]
                    );
                    rooms.push(record);
                    roomsBuilt++;
                }

                if (roomsBuilt >= dungeonCfg.maxRooms) stopReason = `maxRooms reached (${dungeonCfg.maxRooms})`;

                // Create loops
                this._dungeonMakeLoops(dungeonGrid, rooms, this.width, this.height, dungeonCfg);

                const winding = this._dungeonCarveWindingCorridors(
                    dungeonGrid, rooms, this.width, this.height, dungeonCfg
                );
                const secretWalls = this._dungeonFixDeadEnds(dungeonGrid, this.width, this.height);

                // Convert to framework output
                this._finalizeMap(dungeonGrid, rooms, this.width, this.height, dungeonCfg, secretWalls);

                const mapArea = this.width * this.height;
                const fillPct = ((this.walkableTiles.length / mapArea) * 100).toFixed(1);
                const maxRoomsSource = options.maxRooms ? 'explicit' : 'auto';
                console.log(
                    `Dungeon map ${this.width}x${this.height} (${mapArea} tiles): ` +
                    `${roomsBuilt} rooms placed (maxRooms ${dungeonCfg.maxRooms} [${maxRoomsSource}], ` +
                    `maxAttempts ${dungeonCfg.maxAttempts}) — stopped: ${stopReason}. ` +
                    `${attemptsUsed} attempts, ${totalFails} placement fails. ` +
                    `Corridors: ${corridorsPlaced} placed / ${corridorAttempts} tried ` +
                    `(${corridorFails} rejected; chance ${dungeonCfg.corridorChance}%, len ${dungeonCfg.corridorLength[0]}-${dungeonCfg.corridorLength[1]}). ` +
                    `${this.walkableTiles.length} floor tiles (${fillPct}% fill), ` +
                    `${this.pendingDoorSpawns.length} doors, ` +
                    `Winding: ${winding.carved} carved / ${winding.attempted} attempted ` +
                    `(${winding.branches} branched, max ${dungeonCfg.maxWindingCorridors}). ` +
                    `${this.pendingSecretDoorSpawns.length} secret doors so far (dead ends).`
                );
                break;
            }

            case 'palladian': {
                // a bilaterally symmetric villa with a north-south axis, with a grand axial room. 
                // Intended for a boss floor or a reward vault. Experimental
               
                const palCfg = {
                    // Stage 1 — the tartan grid.
                    bayColumns: options.bayColumns || [3, 7],
                    bayRows: options.bayRows || [2, 4],
                    bayWidth: options.bayWidth || [4, 11],
                    bayHeight: options.bayHeight || [4, 9],
                    centralBias: options.centralBias ?? 150,
                    // Stage 3 — room layout.
                    mergeChance: options.mergeChance ?? 45,
                    sanctumChance: options.sanctumChance ?? 70,
                    sanctumShapes: options.sanctumShapes || ['cross', 'tee', 'eye'],
                    // Stage 5/6 — portico and colonnade.
                    porticoStyle: options.porticoStyle || 'prostyle',
                    porticoDepth: options.porticoDepth ?? 3,
                    columnSpacing: options.columnSpacing ?? 2,
                    // Stage 7 — openings. doorChance/torchChance/wall_types are
                    // consumed by _finalizeMap. brick_wall as the default
                    // also disables the shared pushable-wall conversion pass below
                    // (it skips any type !== 'wall'); switch to 'wall' to get
                    // secret passages in the villa walls.
                    doorChance: options.doorChance ?? 55,
                    torchChance: options.torchChance ?? 40,
                    wall_types: options.wall_types || [{ type: 'brick_wall', weight: 100 }],
                    // Stage 7b — concealed passages between apartments the plan
                    // left unconnected, and the share of those barred by a hidden
                    // lever rather than opening on discovery.
                    secretPassageChance: options.secretPassageChance ?? 40,
                    secretPassageLeverChance: options.secretPassageLeverChance ?? 35,
                };

                const dungeonGrid = Array.from({ length: this.height }, () => new Uint8Array(this.width));
                const plan = this._palladianBuildGrid(palCfg);

                if (!plan) {
                    // Degradation floor: the map is too small for even a 1x1 villa.
                    // Fall back to an arena rather than throwing — a generator that
                    // throws breaks loadFloor.
                    console.warn(`Palladian: map ${this.width}x${this.height} too small for a villa; falling back to a single hall`);
                    for (let y = 2; y < this.height - 2; y++) {
                        for (let x = 2; x < this.width - 2; x++) dungeonGrid[y][x] = 1;
                    }
                    this._finalizeMap(dungeonGrid, [], this.width, this.height, palCfg);
                    break;
                }

                this._palladianCarveBays(dungeonGrid, plan);
                const rooms = this._palladianLayoutRooms(dungeonGrid, plan, palCfg);
                const portico = this._palladianAddPortico(dungeonGrid, plan, palCfg);
                const openings = this._palladianAddOpenings(dungeonGrid, plan, rooms, portico, palCfg);
                this._palladianEnsureConnected(dungeonGrid, plan, rooms, portico);
                // After EnsureConnected: a secret passage is a bonus route, never
                // the one that makes the villa traversable. The connectivity pass
                // must have already succeeded without it.
                const secrets = this._palladianAddSecretPassages(dungeonGrid, plan, rooms, palCfg);

                const records = this._palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings);
                this._finalizeMap(dungeonGrid, records, this.width, this.height, palCfg);
                this._palladianQueueSecrets(secrets);

                // Decoration runs AFTER finalize on purpose: finalize's torch pass
                // would otherwise convert a column into a wall torch, and its
                // perimeter rule would rewrite one as metal_wall.
                this._palladianPlaceColumns(plan, portico, palCfg);
                this._palladianPlaceWindows(openings);
                this._palladianPublishRegions(dungeonGrid, plan, records, portico);
                // Exposed for tools/palladian-dump.js, which asserts symmetry about
                // the axis and cannot reliably infer it from tile extents.
                this.palladianPlan = plan;

                const sanctum = records.find(r => r.isSanctum);
                console.log(
                    `Palladian villa ${plan.nCols}x${plan.nRows} bays ` +
                    `(${plan.footprintW}x${plan.footprintH} tiles at ${plan.left},${plan.top}, axis x=${plan.axisX}): ` +
                    `${records.length} rooms, ` +
                    `sanctum ${sanctum ? sanctum.shape : 'none'}, ` +
                    `portico ${portico ? portico.style : 'none'}, ` +
                    `${openings.windows.length} windows, ${this.pendingDoorSpawns.length} doors, ` +
                    `${secrets.doors.length} secret passages (${secrets.levers.length} lever-barred), ` +
                    `${this.walkableTiles.length} floor tiles.`
                );
                break;
            }

            case 'digger':
            default: {
                const diggerFloorTiles = new Set();
                generator = new ROT.Map.Digger(this.width, this.height, {
                    roomWidth: options.roomWidth || [3, 9],
                    roomHeight: options.roomHeight || [3, 5],
                    corridorLength: options.corridorLength || [3, 10],
                    dugPercentage: options.dugPercentage || 0.2
                });
                generator.create((x, y, value) => {
                    if (value === 0) {
                        this.floorMap[y][x] = this._floorTile();
                        this.walkableTiles.push({ x, y });
                        diggerFloorTiles.add(`${x},${y}`);
                    }
                });

                const diggerWallTypes = options.wall_types || [{ type: 'wall', weight: 100 }];


                const hasDiggerFloor = (fx, fy) => diggerFloorTiles.has(`${fx},${fy}`);

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (diggerFloorTiles.has(`${x},${y}`)) continue;

                        const adjacentToFloor = anyNeighbor8(hasDiggerFloor, x, y);

                        if (adjacentToFloor && y > 0) {
                            this.floorMap[y][x] = this._floorTile();
                            this.pendingWallSpawns.push({ x, y, type: this._pickWeightedWallType(diggerWallTypes) });
                        }
                    }
                }

                const isPerimeter = (px, py) =>
                    px === 0 || px === this.width - 1 || py === 0 || py === this.height - 1;

                for (const wall of this.pendingWallSpawns) {
                    if (isPerimeter(wall.x, wall.y)) {
                        wall.type = 'metal_wall';
                    }
                }

                this._fillPerimeterGaps(hasDiggerFloor, this.width, this.height);

                const rooms = generator.getRooms();
                this.diggerRooms = rooms;
                this.publishRoomRegions(rooms, diggerFloorTiles);
                const wallPositions = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));

                for (const room of rooms) {
                    room.getDoors((x, y) => {
                        if (y > 0 && ROT.RNG.getPercentage() <= 50) {
                            this.pendingDoorSpawns.push({ x, y });
                        }
                    });

                    if (ROT.RNG.getPercentage() <= 30) {
                        const roomWalls = [];
                        const left = room.getLeft();
                        const right = room.getRight();
                        const top = room.getTop();
                        const bottom = room.getBottom();

                        for (const wallPos of this.pendingWallSpawns) {
                            if (wallPos.x >= left - 1 && wallPos.x <= right + 1 &&
                                wallPos.y >= top - 1 && wallPos.y <= bottom + 1) {
                                roomWalls.push(wallPos);
                            }
                        }

                        if (roomWalls.length > 0) {
                            // ROT digger rooms are rectangles, so the getters give the
                            // real floor extent; the helpers want the _x1 form.
                            const bounds = { _x1: left, _y1: top, _x2: right, _y2: bottom };
                            this.queueRoomLights(
                                roomWalls,
                                this.countRoomFloorTiles(bounds, diggerFloorTiles),
                                bounds,
                                diggerFloorTiles
                            );
                        }
                    }
                }

                console.log(`Digger map: ${diggerFloorTiles.size} floors, ${this.pendingWallSpawns.length} walls, ${this.pendingDoorSpawns.length} doors, ${this.pendingTorchSpawns.length} torches`);
                break;
            }
        }

        if (options.lakes) {
            this.generateOverlayBlobs(options.lakes);
        }
        if (options.abyss) {
            this.generateOverlayBlobs(options.abyss);
        }

        // Blobs carve without asking whether the map survives it, so connectivity
        // is restored here rather than protected up front. Must precede
        // generateBridges, whose worthiness gate measures the walk-around distance
        // and should be measuring the repaired map.
        if (options.lakes || options.abyss) {
            this.repairBlobConnectivity(options.connectivity_repair || {});
        }

        if (options.bridges) {
            this.generateBridges(options.bridges);
        }

        if (options.collapsing_floors) {
            this.generateCollapsingFloors(options.collapsing_floors);
            // Collapsing floors punch fresh holes in ground the repair above
            // already signed off on, and a patch across a corridor mouth severs the
            // map just as an abyss blob would. Sweep again.
            this.repairBlobConnectivity(options.connectivity_repair || {});
        }

        // Snapshot before the interior-wall pass so the summary below can report
        // dead-end and interior-wall secret doors as one total.
        const secretDoorsFromDeadEnds = this.pendingSecretDoorSpawns.length;

        if (this.pendingWallSpawns.length > 0) {
            const hasFloor = (x, y) => {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
                return this.floorMap[y][x] !== null;
            };
            const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
            const converted = [];
            let secretConverted = 0;
            let secretRejected = 0;
            let pushRejected = 0;
            // How far apart the two sides must already be for a hidden door between
            // them to be worth finding. 0 (the default) disables the test.
            //
            // Off by default, but no longer inert. It used to reject the entire pool:
            // betweenFloors tested the floor map, which is painted under walls too, so
            // the candidates were dominated by cells inside wall runs, and measuring
            // 3322 of them gave a detour of exactly 4 for 100%. Now that openness is
            // tested against walkableTiles, the pool is genuinely walls between two
            // open spaces and the gate thins it gradually instead — measured over 120
            // dungeon maps: 340 doors at 0, 273 at 4, 188 at 8. Left at 0 so existing
            // maps are unchanged; raise it if secret doors feel too easily found.
            const minDetour = options.secretWallMinDetour ?? 0;
            // Pushable walls get the gate the secret-door path can't use. Their
            // candidates come from the same pool, but unlike secret doors they are
            // not load-bearing for anything, so thinning them costs nothing: half
            // the raw pool measured as 4-tile walk-around stubs. 0 disables.
            const pushMinDetour = options.pushableWallMinDetour ?? 8;
            // Doors already on the map, so a hidden one is never set beside a visible
            // one. Both lists matter: pendingDoorSpawns is the ordinary doors, and
            // pendingSecretDoorSpawns already holds the dead-end pass's output, which
            // would otherwise pair up with an interior-wall pick.
            const doorSet = new Set([
                ...this.pendingDoorSpawns.map(p => `${p.x},${p.y}`),
                ...this.pendingSecretDoorSpawns.map(p => `${p.x},${p.y}`)
            ]);
            const doorNear = (x, y) => {
                for (let ny = y - 1; ny <= y + 1; ny++) {
                    for (let nx = x - 1; nx <= x + 1; nx++) {
                        if (nx === x && ny === y) continue;
                        if (doorSet.has(`${nx},${ny}`)) return true;
                    }
                }
                return false;
            };
            // Open means floor an actor can stand on, which is exactly walkableTiles.
            // hasFloor is not that test twice over: _finalizeMap paints a floor tile
            // under every wall (so a wall answers true, and a door gets cut into the
            // middle of a wall run with rock on both sides), and it paints one under
            // the ungenerated cells ringing the map (so a door opens onto void).
            const walkableSet = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
            const isOpen = (x, y) => walkableSet.has(`${x},${y}`) && !wallSet.has(`${x},${y}`);
            for (let i = this.pendingWallSpawns.length - 1; i >= 0; i--) {
                const wall = this.pendingWallSpawns[i];
                if (wall.type && wall.type !== 'wall') continue;
                const betweenFloors =
                    (isOpen(wall.x - 1, wall.y) && isOpen(wall.x + 1, wall.y)) ||
                    (isOpen(wall.x, wall.y - 1) && isOpen(wall.x, wall.y + 1));
                if (!betweenFloors) continue;

                // A wall with floor on both sides is a passage waiting to happen.
                // The two chances are independent rolls against the same candidate
                // pool, not a split of one: pushableWallChance is deliberately tiny
                // (2%), so taking a share of it would make secret doors vanishingly
                // rare. secretWallChance is its own rate, off by default so existing
                // maps are unchanged. (Distinct from the dungeon generator's
                // secretDoorChance, which splits dead-end shortcuts.)
                const secret = ROT.RNG.getPercentage() <= (options.secretWallChance ?? 0);
                if (!secret && ROT.RNG.getPercentage() > (options.pushableWallChance ?? 2)) continue;

                if (secret) {
                    // A secret door is only worth finding if it actually saves the
                    // player a walk. Without this the pass happily hides a door
                    // between two rooms already joined by an open corridor three
                    // tiles away — mechanically a secret, practically a shortcut to
                    // nowhere. Same test _dungeonMakeLoops applies to its loops:
                    // reject when the two sides are already close together.
                    if (!this._isWorthwhileShortcut(wall, minDetour)) {
                        secretRejected++;
                        continue;
                    }
                    // Two doors side by side read as a generation slip, and the
                    // hidden one is redundant when the visible one already goes
                    // through. Only the secret path is gated: a pushable wall next
                    // to a door is unremarkable.
                    if (doorNear(wall.x, wall.y)) {
                        secretRejected++;
                        continue;
                    }
                    this.pendingSecretDoorSpawns.push({ x: wall.x, y: wall.y });
                    doorSet.add(`${wall.x},${wall.y}`);
                    secretConverted++;
                } else {
                    // Same test, and for the same reason: a pushable wall you can
                    // simply step around is scenery, not a puzzle. Measured on the
                    // raw pool, half of these were stub tips with a 4-tile detour.
                    if (!this._isWorthwhileShortcut(wall, pushMinDetour)) {
                        pushRejected++;
                        continue;
                    }
                    this.pendingPushableWallSpawns.push({ x: wall.x, y: wall.y });
                }
                this.pendingWallSpawns.splice(i, 1);
                converted.push(wall);
            }
            if (converted.length > 0 || secretRejected > 0) {
                console.log(
                    `Pushable wall generation: ${converted.length - secretConverted} pushable walls, ` +
                    `${secretConverted} secret doors` +
                    (secretRejected + pushRejected > 0
                        ? ` (${secretRejected + pushRejected} rejected as pointless shortcuts)` : '')
                );
            }
        }

        // The authoritative secret-door count. The per-pass lines above each see
        // only their own share, and the dead-end one reads 0 on most maps, so state
        // the total and its breakdown once, here, where both are known.
        const secretDoorTotal = this.pendingSecretDoorSpawns.length;
        console.log(
            `Procedural map generated with ${this.walkableTiles.length} walkable tiles, ` +
            `${secretDoorTotal} secret doors ` +
            `(${secretDoorsFromDeadEnds} dead-end, ${secretDoorTotal - secretDoorsFromDeadEnds} interior-wall)`
        );
    },

    /**
     * Would a hidden door in this wall actually open a shortcut?
     *
     * Answers by walking the finished map from one side of the wall to the other,
     * *without* going through the wall itself: if the detour is already short, the
     * door saves nobody anything and shouldn't be a secret. This is the same
     * judgement _dungeonMakeLoops makes about loops, but it can't share
     * _dungeonBFS — that one reads the generator's dungeonGrid, which is out of
     * scope by the time this pass runs and is stale anyway, since lakes, abysses,
     * bridges and connectivity repair have all reshaped the map since. Walking
     * floorMap instead measures the map the player will actually be dropped into,
     * and gets abyss handling for free: blob cells clear floorMap, so a path is
     * never routed across a chasm.
     *
     * Returns true when the sides are far apart, unreachable from each other, or
     * beyond the search cap — all cases where the door is a genuine discovery.
     *
     * @param {{x:number,y:number}} wall     the candidate wall cell
     * @param {number} minDetour  required existing walking distance; 0 disables
     */
    _isWorthwhileShortcut(wall, minDetour) {
        if (!minDetour || minDetour <= 0) return true;

        // floorMap alone is NOT walkability: a wall actor sits on a floor tile, so
        // floorMap[y][x] is non-null for walls too. Testing it by itself lets the
        // search walk straight through walls, which makes every detour look short
        // and the whole test a no-op. The pending wall set is what makes it mean
        // what it says.
        const blocked = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const walkable = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            if (x === wall.x && y === wall.y) return false;   // never through the door
            if (blocked.has(`${x},${y}`)) return false;
            return this.floorMap[y][x] !== null;
        };

        // The pair of opposing floor cells this wall sits between. betweenFloors
        // has already established that one of these axes holds.
        const [a, b] = walkable(wall.x - 1, wall.y) && walkable(wall.x + 1, wall.y)
            ? [{ x: wall.x - 1, y: wall.y }, { x: wall.x + 1, y: wall.y }]
            : [{ x: wall.x, y: wall.y - 1 }, { x: wall.x, y: wall.y + 1 }];

        // Cap the search at the distance we care about: anything further is "far
        // enough" and there's no reason to keep expanding. Bounds the cost of
        // running this per candidate wall.
        const cap = minDetour;
        const visited = new Set([`${a.x},${a.y}`]);
        let frontier = [a];
        let dist = 0;

        while (frontier.length > 0 && dist < cap) {
            dist++;
            const next = [];
            for (const cell of frontier) {
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    const nx = cell.x + dx, ny = cell.y + dy;
                    if (!walkable(nx, ny)) continue;
                    const key = `${nx},${ny}`;
                    if (visited.has(key)) continue;
                    // Reached the far side within the cap — the detour is short, so
                    // the door would be a shortcut to nowhere.
                    if (nx === b.x && ny === b.y) return false;
                    visited.add(key);
                    next.push({ x: nx, y: ny });
                }
            }
            frontier = next;
        }

        return true;
    },
};
