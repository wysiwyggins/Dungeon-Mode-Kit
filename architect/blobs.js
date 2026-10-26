/**
 * Architect methods: overlay blobs (lakes of liquid, chasms and the like):
 * stamping them, walling their rims, and repairing the connectivity they break.
 */

export const ArchitectBlobs = {
    /**
     * Lakes and abysses, generated the way Brogue does it (designLakes,
     * Architect.c:2562): the shape is built off-map by a cellular automaton and
     * then stamped at a random position, carving through whatever it lands on —
     * rock, room wall or floor alike. Nothing here consults room bounds.
     *
     * config: { count, types, minSize, maxSize, mask?, requireFloorOverlap? }
     * `mask` (a Set of "x,y") hard-confines every cell a blob may write, so a caller can
     * fence blobs to a sub-area instead of the whole floor.
     */
    generateOverlayBlobs(config) {
        if (!config || !config.count) return;

        const count = Array.isArray(config.count)
            ? ROT.RNG.getUniformInt(config.count[0], config.count[1])
            : config.count;
        if (count <= 0) return;

        const types = this._normalizeBlobTypes(config.types);
        const minSize = config.minSize || 10;
        const maxSize = config.maxSize || 60;

        // Brogue insets lake placement by 1 cell (Architect.c:2585). We need 2:
        // the outermost ring is metal_wall, and a blob abutting it would leave
        // the map edge with no rock behind the wall.
        const INSET = 2;
        const PLACEMENT_ATTEMPTS = 20;
        // Not a passability gate (blobs are committed unconditionally and any
        // damage is repaired later by repairBlobConnectivity). This only proves
        // the lake landed near the dungeon rather than marooned in solid rock
        // where the player would never find it.
        const minFloorOverlap = config.requireFloorOverlap ?? 8;

        const perimeterProtected = this._blobProtectedPerimeter();
        // Brogue's accumulating lakeMap (Architect.c:2595): each new blob is
        // placed against the ones already committed, so two blobs of different
        // liquid types never overlap and fight over the same cell.
        const claimedCells = new Set();

        const allVoidCells = new Set();
        const allLiquidCells = new Set();
        const hazardCells = new Set();
        let totalPlaced = 0;

        for (let i = 0; i < count; i++) {
            const type = this._pickWeighted(types) ?? 'water';
            const shape = this._makeCavernShape(this._blobPickCanvas(minSize, maxSize));

            let placed = null;
            for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
                const maxOriginX = this.width - shape.width - INSET;
                const maxOriginY = this.height - shape.height - INSET;
                if (maxOriginX < INSET || maxOriginY < INSET) break; // shape larger than the map
                const originX = ROT.RNG.getUniformInt(INSET, maxOriginX);
                const originY = ROT.RNG.getUniformInt(INSET, maxOriginY);

                const cells = [];
                let floorOverlap = 0;
                let blocked = false;
                for (let localY = 0; localY < shape.height && !blocked; localY++) {
                    for (let localX = 0; localX < shape.width; localX++) {
                        if (shape.grid[localY][localX] !== 1) continue;
                        const x = originX + localX;
                        const y = originY + localY;
                        const key = `${x},${y}`;
                        if (config.mask && !config.mask.has(key)) { blocked = true; break; }
                        if (perimeterProtected.has(key)) { blocked = true; break; }
                        if (claimedCells.has(key)) { blocked = true; break; }
                        cells.push({ x, y, key });
                        if (this.floorMap[y][x]) floorOverlap++;
                    }
                }
                if (blocked || cells.length === 0) continue;
                if (floorOverlap < Math.min(minFloorOverlap, cells.length)) continue;
                placed = cells;
                break;
            }

            if (!placed) {
                console.log(`  ${type} blob: no placement found in ${PLACEMENT_ATTEMPTS} attempts`);
                continue;
            }

            this._blobStampAt(placed, type);
            totalPlaced += placed.length;
            // Nothing spawns on a blob that would hurt or swallow what lands there.
            // Read off the actor rather than matching 'lava' by name, so quicksand
            // and deep water get the same treatment without another special case.
            const isHazard = this._isHazardousBlobType(type);
            for (const cell of placed) {
                claimedCells.add(cell.key);
                if (type === 'abyss') allVoidCells.add(cell.key);
                else allLiquidCells.add(cell.key);
                if (isHazard) hazardCells.add(cell.key);
            }

            console.log(`  ${type} blob: ${placed.length} tiles`);
        }

        const allBlobCells = new Set([...allLiquidCells, ...allVoidCells]);
        if (allBlobCells.size === 0) {
            console.log(`Overlay generation: 0 tiles placed in ${count} attempted blobs`);
            return;
        }

        // Anything a blob covered is gone: walls bitten open, doors drowned,
        // torches and braziers swallowed. Every spawn array gets the same
        // treatment.
        const covered = (p) => allBlobCells.has(`${p.x},${p.y}`);
        this.pendingWallSpawns = this.pendingWallSpawns.filter(p => !covered(p));
        this.pendingDoorSpawns = this.pendingDoorSpawns.filter(p => !covered(p));
        this.pendingTorchSpawns = this.pendingTorchSpawns.filter(p => !covered(p));
        this.pendingBrazierSpawns = this.pendingBrazierSpawns.filter(p => !covered(p));
        this.pendingPushableWallSpawns = this.pendingPushableWallSpawns.filter(p => !covered(p));
        this.pendingSecretDoorSpawns = this.pendingSecretDoorSpawns.filter(p => !covered(p));
        this.pendingHiddenLeverSpawns = this.pendingHiddenLeverSpawns.filter(p => !covered(p));
        // Liquid needs a floor to lie on. Testing the map rather than this call's
        // own void set also catches water queued by the earlier lakes pass on a
        // cell this pass has since turned into chasm — otherwise the actor spawns
        // hanging in the middle of the void.
        const hasFloor = (p) => !!this.floorMap[p.y][p.x];
        this.pendingLiquidSpawns = this.pendingLiquidSpawns.filter(hasFloor);

        this._blobRingBoundaryWalls(allBlobCells, perimeterProtected);
        this._blobRebuildWalkableTiles(allLiquidCells, hazardCells);

        console.log(`Overlay generation: ${totalPlaced} total tiles in ${count} blobs`);
    },

    /**
     * Cells no blob may ever touch: the metal_wall ring that seals the map, plus
     * the outermost row and column outright. Row 0 matters on its own: every
     * wall-spawn site in this file is guarded `y > 0`, so a blob up there would
     * leave floor with no wall above it.
     */
    _blobProtectedPerimeter() {
        const protectedCells = new Set();
        for (const wall of this.pendingWallSpawns) {
            if (wall.type === 'metal_wall') protectedCells.add(`${wall.x},${wall.y}`);
        }
        for (let x = 0; x < this.width; x++) {
            protectedCells.add(`${x},0`);
            protectedCells.add(`${x},${this.height - 1}`);
        }
        for (let y = 0; y < this.height; y++) {
            protectedCells.add(`0,${y}`);
            protectedCells.add(`${this.width - 1},${y}`);
        }
        return protectedCells;
    },

    /**
     * Translates the cell-count sizing the config files use (minSize/maxSize)
     * into the canvas dimensions _makeCavernShape wants. A B5678/S45678 blob
     * settles at roughly half its canvas, so a canvas of area (target / 0.5)
     * lands near the requested size — near, not exact. The random aspect keeps
     * every lake from sharing one silhouette; Brogue's own run 30x15 down to 20x10.
     */
    _blobPickCanvas(minSize, maxSize) {
        const targetCells = ROT.RNG.getUniformInt(minSize, maxSize);
        const area = Math.max(16, Math.round(targetCells / 0.5));
        const aspect = 0.6 + ROT.RNG.getUniform() * 1.3;
        let canvasWidth = Math.round(Math.sqrt(area * aspect));
        let canvasHeight = Math.round(area / Math.max(1, canvasWidth));
        canvasWidth = Math.max(5, Math.min(canvasWidth, Math.floor(this.width * 0.55)));
        canvasHeight = Math.max(5, Math.min(canvasHeight, Math.floor(this.height * 0.55)));
        return {
            cavernWidth: [canvasWidth, canvasWidth],
            cavernHeight: [canvasHeight, canvasHeight],
            // _makeCavernShape falls back to _dungeonMakeRectangle when the
            // automaton produces fewer than 6 cells, and that reads these.
            rectWidth: [Math.max(2, Math.floor(canvasWidth / 2)), Math.max(3, canvasWidth - 1)],
            rectHeight: [Math.max(2, Math.floor(canvasHeight / 2)), Math.max(3, canvasHeight - 1)]
        };
    },

    /**
     * Writes one blob's cells. The shape wins over whatever was there: rock, room
     * wall and open floor all become part of the lake or chasm (Brogue's
     * designLakes sets DUNGEON = FLOOR for every covered cell).
     */
    _blobStampAt(cells, type) {
        const isAbyss = (type === 'abyss');

        for (const { x, y } of cells) {
            if (isAbyss) {
                // The abyss layer contract addBaseAndShadows keys off: floorless,
                // void background, nothing above it.
                this.floorMap[y][x] = null;
                this.backgroundMap[y][x] = { tileId: this.config.voidTileId, layer: 'background' };
                this.overlayMap[y][x] = null;
                continue;
            }

            // Liquid sits on ordinary floor. Rock has no floor at all, so carving
            // into it means writing one; clearing the background stops the cell
            // keeping whatever art was behind the rock.
            if (!this.floorMap[y][x] || this.floorMap[y][x].tileId !== this.config.defaultFloorTileId) {
                this.floorMap[y][x] = this._floorTile();
            }
            this.backgroundMap[y][x] = null;
            this.overlayMap[y][x] = null;
            // The type rides along: one queue, one drain, any actor.
            this.pendingLiquidSpawns.push({ x, y, type });
        }
    },

    /**
     * Rings the carved region with walls, giving the lake a cliff edge where it
     * borders raw rock.
     *
     * Walls get floor written under them, per this file's convention, which is
     * what lets generateBridges punch a boundary wall into a landing. The pushed
     * entry is typeless: spawnPendingWalls defaults it to 'wall', and the bridge
     * landing test looks for exactly that.
     */
    _blobRingBoundaryWalls(blobCells, perimeterProtected) {
        const existingWallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
        let boundaryWalls = 0;

        for (const key of blobCells) {
            const [bx, by] = key.split(',').map(Number);
            for (const [dx, dy] of dirs) {
                const nx = bx + dx;
                const ny = by + dy;
                if (nx < 1 || nx >= this.width - 1 || ny < 1 || ny >= this.height - 1) continue;
                const nk = `${nx},${ny}`;
                if (blobCells.has(nk)) continue;
                if (existingWallSet.has(nk)) continue;
                if (perimeterProtected.has(nk)) continue;
                if (this.floorMap[ny][nx]) continue;
                // Void carved by an earlier pass (lakes run before abyss) is
                // already a legitimate edge. Papering floor back over it would
                // strand a walled cell mid-chasm and stop the cliff shading.
                const background = this.backgroundMap[ny][nx];
                if (background && this.isVoidTile(background.tileId)) continue;

                this.floorMap[ny][nx] = this._floorTile();
                this.pendingWallSpawns.push({ x: nx, y: ny });
                existingWallSet.add(nk);
                boundaryWalls++;
            }
        }

        if (boundaryWalls > 0) {
            console.log(`  Boundary walls added: ${boundaryWalls}`);
        }
    },

    _blobRebuildWalkableTiles(liquidCells, hazardCells) {
        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const seen = new Set();
        const rebuilt = [];

        const admit = (x, y) => {
            const key = `${x},${y}`;
            if (seen.has(key)) return;
            if (hazardCells.has(key)) return;
            if (wallSet.has(key)) return;
            if (!this.isWalkable(x, y)) return; // abyss drops out here
            seen.add(key);
            rebuilt.push({ x, y });
        };

        for (const tile of this.walkableTiles) admit(tile.x, tile.y);
        // Shore carved out of rock was never in the list to begin with.
        for (const key of liquidCells) {
            const [x, y] = key.split(',').map(Number);
            admit(x, y);
        }

        this.walkableTiles = rebuilt;
    },

    repairBlobConnectivity(config = {}) {
        const minOrphanSize = config.minOrphanSize ?? 6;
        const maxNeckLength = config.maxNeckLength ?? 40;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && this.isVoidTile(bg.tileId) && this.floorMap[y][x] === null;
        };

        let causeways = 0;
        let ignoredLedges = 0;

        for (let round = 0; ; round++) {
            const { regions, label } = this._blobLabelOpenRegions();
            const orphans = regions
                .filter(r => r.cells.length >= minOrphanSize)
                .sort((a, b) => b.cells.length - a.cells.length);
            if (orphans.length <= 1) {
                ignoredLedges = regions.length - orphans.length;
                break;
            }
            // A causeway can fail to land, so cap the rounds instead of trusting
            // every pass to make progress.
            if (round >= orphans.length + 4) {
                console.warn(
                    `  Connectivity: gave up with ${orphans.length} regions still separate`
                );
                break;
            }

            const mainland = orphans[0];
            const connectedLabels = new Set([mainland.id]);
            let joinedAny = false;

            for (let i = 1; i < orphans.length; i++) {
                const orphan = orphans[i];
                const neck = this._blobFindNeck(orphan, label, connectedLabels, isAbyss, maxNeckLength);
                if (!neck) {
                    console.warn(
                        `  Connectivity: ${orphan.cells.length}-cell region near ` +
                        `(${orphan.cells[0].x},${orphan.cells[0].y}) has no crossing within ${maxNeckLength} tiles`
                    );
                    continue;
                }

                // The wandering walk is for looks and can wander itself into a
                // dead end; the neck's own BFS chain is the crossing that is
                // guaranteed to join the two shores. Take the scenic route only
                // when it actually reaches the far side.
                const scenic = this._carveWanderingPath(neck.from, neck.to, isAbyss);
                const reaches = scenic.length > 0 && scenic.some(c =>
                    Math.abs(c.x - neck.to.x) + Math.abs(c.y - neck.to.y) === 1);
                const path = reaches ? scenic : neck.cells;
                if (path.length === 0) {
                    console.warn(`  Connectivity: causeway from (${neck.from.x},${neck.from.y}) carved nothing`);
                    continue;
                }

                for (const cell of path) {
                    this.floorMap[cell.y][cell.x] = this._floorTile();
                    // Stop being a chasm in every sense: leaving the void background
                    // would keep addBaseAndShadows shading this as a pit, and would
                    // leave generateBridges and generateCollapsingFloors still
                    // seeing abyss here.
                    this.backgroundMap[cell.y][cell.x] = null;
                    this.walkableTiles.push({ x: cell.x, y: cell.y });
                    this._causewayCells.add(`${cell.x},${cell.y}`);
                }
                causeways++;
                joinedAny = true;
                // Only one carve per round: the labelling this loop is reading is
                // now out of date, and the next round will see the new ground.
                break;
            }

            if (!joinedAny) break;
        }

        if (ignoredLedges > 0) {
            console.log(`  Connectivity: ${ignoredLedges} ledge(s) under ${minOrphanSize} cells left as scenery`);
        }
        if (causeways > 0) {
            console.log(`Connectivity repair: ${causeways} causeway(s) carved`);
        }
    },

    /**
     * Labels every connected region of open floor. Modelled on
     * _floodFillRegion, but reads live map state instead of a grid so it can
     * run after carving, and labels all components rather than one.
     *
     * Liquid counts as open, only the abyss actually blocks. Pass
     * extraBlocked to treat something else as a barrier too (the lava dry-path
     * pass uses it to ask which regions are reachable without walking through fire).
     */
    _blobLabelOpenRegions(extraBlocked = null) {
        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const isOpen = (x, y) => {
            if (x < 1 || x >= this.width - 1 || y < 1 || y >= this.height - 1) return false;
            const key = `${x},${y}`;
            if (wallSet.has(key)) return false;
            if (extraBlocked && extraBlocked.has(key)) return false;
            return this.isWalkable(x, y);
        };

        const label = new Map();
        const regions = [];

        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const key = `${x},${y}`;
                if (label.has(key) || !isOpen(x, y)) continue;

                const id = regions.length;
                const cells = [];
                const stack = [{ x, y }];
                label.set(key, id);
                while (stack.length > 0) {
                    const cell = stack.pop();
                    cells.push(cell);
                    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                        const nx = cell.x + dx;
                        const ny = cell.y + dy;
                        const nk = `${nx},${ny}`;
                        if (label.has(nk) || !isOpen(nx, ny)) continue;
                        label.set(nk, id);
                        stack.push({ x: nx, y: ny });
                    }
                }
                regions.push({ id, cells });
            }
        }

        return { regions, label };
    },

    /**
     * Finds the shortest crossing from an orphaned region to anything already
     * connected — the narrowest neck, so the causeway is a short hop rather than
     * a trek across the widest part of the chasm.
     *
     * A breadth-first flood through the barrier itself, rather than a cardinal
     * ray, so it finds a crossing at any angle: an abyss that severs a room
     * complex usually leaves it touching the void along a ragged diagonal.
     */
    _blobFindNeck(orphan, label, connectedLabels, isBarrier, maxNeckLength) {
        const cardinalDirs = [[1,0],[-1,0],[0,1],[0,-1]];
        const cameFrom = new Map();
        const queue = [];
        let head = 0;

        // Seed with every barrier cell touching the orphan's shore, remembering
        // which shore cell each came from so the crossing has both endpoints.
        for (const cell of orphan.cells) {
            for (const [dx, dy] of cardinalDirs) {
                const nx = cell.x + dx;
                const ny = cell.y + dy;
                const key = `${nx},${ny}`;
                if (cameFrom.has(key) || !isBarrier(nx, ny)) continue;
                cameFrom.set(key, { x: nx, y: ny, shore: cell, steps: 1, parent: null });
                queue.push(key);
            }
        }

        while (head < queue.length) {
            const node = cameFrom.get(queue[head++]);
            if (node.steps >= maxNeckLength) continue;

            for (const [dx, dy] of cardinalDirs) {
                const nx = node.x + dx;
                const ny = node.y + dy;
                if (nx < 1 || nx >= this.width - 1 || ny < 1 || ny >= this.height - 1) continue;
                const key = `${nx},${ny}`;

                // Reached open ground: a win only if it belongs to a region that
                // is already joined to the mainland.
                if (!isBarrier(nx, ny)) {
                    const landing = label.get(key);
                    if (landing !== undefined && connectedLabels.has(landing)) {
                        // Walk the parent chain back to the shore. This is the
                        // guaranteed-contiguous crossing; the wandering walk is
                        // layered on top of it only when there is room to wander.
                        const cells = [];
                        for (let step = node; step; step = step.parent) {
                            cells.push({ x: step.x, y: step.y });
                        }
                        cells.reverse();
                        return { from: node.shore, to: { x: nx, y: ny }, steps: node.steps, cells };
                    }
                    continue;
                }

                if (cameFrom.has(key)) continue;
                cameFrom.set(key, { x: nx, y: ny, shore: node.shore, steps: node.steps + 1, parent: node });
                queue.push(key);
            }
        }

        return null;
    },
};
