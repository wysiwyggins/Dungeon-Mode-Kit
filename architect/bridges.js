/**
 * Architect methods: rope bridges across abyss blobs and collapsing floors.
 */

import { globalVars } from '../globals.js';

export const ArchitectBridges = {
    generateBridges(config) {
        const maxBridges = config.max || 1;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && globalVars.VOID_TILE_IDS.includes(bg.tileId) && this.floorMap[y][x] === null;
        };

        const hasFloor = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            return this.floorMap[y][x] !== null;
        };

        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const isLandable = (x, y) => hasFloor(x, y) && !wallSet.has(`${x},${y}`);
        // A boundary wall (added around abyss blobs) always has true floor under it,
        // so it can be "punched" into a landing by removing it from the wall spawns.
        const isBoundaryWall = (x, y) => hasFloor(x, y) && wallSet.has(`${x},${y}`);

        const cardinalDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        // 1. Flood-fill abyss cells into connected components (blobs).
        const blobId = new Map();
        const blobs = [];
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const key = `${x},${y}`;
                if (!isAbyss(x, y) || blobId.has(key)) continue;
                const id = blobs.length;
                const cells = [];
                let minX = x, maxX = x, minY = y, maxY = y;
                const stack = [{ x, y }];
                blobId.set(key, id);
                while (stack.length > 0) {
                    const cell = stack.pop();
                    cells.push(cell);
                    if (cell.x < minX) minX = cell.x;
                    if (cell.x > maxX) maxX = cell.x;
                    if (cell.y < minY) minY = cell.y;
                    if (cell.y > maxY) maxY = cell.y;
                    for (const [dx, dy] of cardinalDirs) {
                        const nx = cell.x + dx, ny = cell.y + dy;
                        const nk = `${nx},${ny}`;
                        if (isAbyss(nx, ny) && !blobId.has(nk)) {
                            blobId.set(nk, id);
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }
                blobs.push({ id, cells, minX, maxX, minY, maxY });
            }
        }

        if (blobs.length === 0) return;

        const belongsTo = (x, y, id) => blobId.get(`${x},${y}`) === id;

        // Resolve a landing just outside an abyss run. Returns null if there is no
        // walkable shore. Otherwise returns { punch, stand } where `punch` is the
        // boundary-wall cell to open (or null when the shore is already floor) and
        // `stand` is the walkable floor cell the bridge actually connects to.
        const resolveLanding = (x, y, dx, dy) => {
            if (isLandable(x, y)) return { punch: null, stand: { x, y } };
            if (isBoundaryWall(x, y) && isLandable(x + dx, y + dy)) {
                // One wall between the abyss and real floor: punchable.
                return { punch: { x, y }, stand: { x: x + dx, y: y + dy } };
            }
            return null;
        };

        // Brogue-style connectivity gate: a bridge is only worth building if walking
        // AROUND the abyss (over existing floor, treating abyss + walls as blockers)
        // is much longer than crossing it. Bounded BFS from one shore to the other;
        // if the far shore is unreachable within `cap` steps (or at all), the detour
        // is long enough and the bridge earns its place.
        const minDetourRatio = config.minDetourRatio != null ? config.minDetourRatio : 3;
        const isWalkAroundOpen = (x, y) => isLandable(x, y) && !isAbyss(x, y);
        const detourExceeds = (fromCell, toCell, bridgeLength) => {
            if (minDetourRatio <= 0) return true; // gate disabled
            const cap = Math.ceil(bridgeLength * minDetourRatio);
            const startKey = `${fromCell.x},${fromCell.y}`;
            const goalKey = `${toCell.x},${toCell.y}`;
            const visited = new Set([startKey]);
            let frontier = [fromCell];
            let dist = 0;
            while (frontier.length > 0) {
                if (dist > cap) return true; // walk-around already too long -> build
                const next = [];
                for (const cell of frontier) {
                    if (`${cell.x},${cell.y}` === goalKey) return false; // cheap walk exists -> skip
                    for (const [dx, dy] of cardinalDirs) {
                        const nx = cell.x + dx, ny = cell.y + dy;
                        const nk = `${nx},${ny}`;
                        if (visited.has(nk)) continue;
                        if (!isWalkAroundOpen(nx, ny)) continue;
                        visited.add(nk);
                        next.push({ x: nx, y: ny });
                    }
                }
                frontier = next;
                dist++;
            }
            return true; // far shore unreachable on foot -> definitely bridge
        };

        // 2. Find the best full-width/full-height crossing for a single blob.
        // Returns { h, v } — the best horizontal and best vertical crossing that
        // each pass the connectivity gate (either may be null). Placing both forms
        // an intersection where they share a cell.
        const chooseCrossing = (blob) => {
            const blobWidth = blob.maxX - blob.minX + 1;
            const blobHeight = blob.maxY - blob.minY + 1;
            const hCandidates = [];
            const vCandidates = [];

            // Horizontal crossings: for each row, the run must equal the blob's
            // full horizontal cross-section on that row (shore-to-shore).
            for (let y = blob.minY; y <= blob.maxY; y++) {
                let rowMinX = Infinity, rowMaxX = -Infinity;
                for (let x = blob.minX; x <= blob.maxX; x++) {
                    if (belongsTo(x, y, blob.id)) {
                        if (x < rowMinX) rowMinX = x;
                        if (x > rowMaxX) rowMaxX = x;
                    }
                }
                if (rowMinX === Infinity) continue;
                // Reject rows where the blob is not one solid band (interior floor island).
                let solid = true;
                for (let x = rowMinX; x <= rowMaxX; x++) {
                    if (!belongsTo(x, y, blob.id)) { solid = false; break; }
                }
                if (!solid) continue;
                const length = rowMaxX - rowMinX + 1;
                if (length < Math.max(2, Math.ceil(blobWidth * 0.4))) continue;
                const west = resolveLanding(rowMinX - 1, y, -1, 0);
                const east = resolveLanding(rowMaxX + 1, y, 1, 0);
                if (!west || !east) continue;
                const cells = [];
                for (let x = rowMinX; x <= rowMaxX; x++) cells.push({ x, y });
                hCandidates.push({
                    cells, dir: 'h', length,
                    punches: [west.punch, east.punch].filter(Boolean),
                    standA: west.stand, standB: east.stand
                });
            }

            // Vertical crossings: symmetric, per column.
            for (let x = blob.minX; x <= blob.maxX; x++) {
                let colMinY = Infinity, colMaxY = -Infinity;
                for (let y = blob.minY; y <= blob.maxY; y++) {
                    if (belongsTo(x, y, blob.id)) {
                        if (y < colMinY) colMinY = y;
                        if (y > colMaxY) colMaxY = y;
                    }
                }
                if (colMinY === Infinity) continue;
                let solid = true;
                for (let y = colMinY; y <= colMaxY; y++) {
                    if (!belongsTo(x, y, blob.id)) { solid = false; break; }
                }
                if (!solid) continue;
                const length = colMaxY - colMinY + 1;
                if (length < Math.max(2, Math.ceil(blobHeight * 0.4))) continue;
                const north = resolveLanding(x, colMinY - 1, 0, -1);
                const south = resolveLanding(x, colMaxY + 1, 0, 1);
                if (!north || !south) continue;
                const cells = [];
                for (let y = colMinY; y <= colMaxY; y++) cells.push({ x, y });
                vCandidates.push({
                    cells, dir: 'v', length,
                    punches: [north.punch, south.punch].filter(Boolean),
                    standA: north.stand, standB: south.stand
                });
            }

            // For each axis independently: prefer the narrowest neck, then the
            // crossing that needs no punches, then a little randomness for variety;
            // and keep only a crossing whose two shores are not already cheaply
            // connected on foot (Brogue's bridgeRatio test). Returns the narrowest
            // crossing on that axis that earns its place, or null.
            const pickBest = (candidates) => {
                candidates.sort((a, b) =>
                    a.length - b.length ||
                    a.punches.length - b.punches.length ||
                    (ROT.RNG.getUniform() - 0.5)
                );
                for (const candidate of candidates) {
                    if (detourExceeds(candidate.standA, candidate.standB, candidate.length)) {
                        return candidate;
                    }
                }
                return null;
            };

            // A horizontal and a vertical crossing that each pass the gate are placed
            // together as an intersection (they share a cell). Either may be null.
            return { h: pickBest(hCandidates), v: pickBest(vCandidates) };
        };

        // 3. Place one bridge per blob, largest abyss first, up to the global cap.
        blobs.sort((a, b) => b.cells.length - a.cells.length);

        const usedCells = new Set();
        let placed = 0;
        // Distinguishes one crossing's cells from another's in spawnPendingBridges.
        // The two crossings of the SAME blob deliberately share this id so their
        // shared cell still resolves to a "+" junction; unrelated bridges that merely
        // run next to each other get different ids and cannot bend each other's tiles.
        let crossingGroupId = 0;

        for (const blob of blobs) {
            if (placed >= maxBridges) break;
            const { h, v } = chooseCrossing(blob);
            // Take whichever crossings earned their place. When both exist they cross
            // this blob on opposite axes and are placed together as an intersection;
            // they may share one cell (the crossing point), rendered as a "+" tile.
            const crossings = [h, v].filter(Boolean);
            if (crossings.length === 0) continue;
            // Only reject a crossing if it collides with an ALREADY-placed bridge from
            // another blob. The two crossings of THIS blob are allowed to overlap each
            // other (that overlap is the intersection).
            if (crossings.some(cr => cr.cells.some(c => usedCells.has(`${c.x},${c.y}`)))) continue;

            crossingGroupId++;

            for (const crossing of crossings) {
                // Open any boundary walls the bridge lands on so the shore is walkable.
                for (const punch of crossing.punches) {
                    this.pendingWallSpawns = this.pendingWallSpawns.filter(p => !(p.x === punch.x && p.y === punch.y));
                    wallSet.delete(`${punch.x},${punch.y}`);
                }

                for (const c of crossing.cells) {
                    // The intersection cell is shared by both crossings; only queue it
                    // once so we don't stack two rope_bridge actors on one tile.
                    const ck = `${c.x},${c.y}`;
                    if (usedCells.has(ck)) continue;
                    // Leave the cell as abyss (floorMap null, void background) and let the
                    // rope_bridge platform actor provide footing — like a collapsing_floor.
                    // Do NOT lay real floor here: it would make addBaseAndShadows skip the
                    // cliffside shadow, and leave a floor tile behind when the bridge burns
                    // instead of revealing the void below.
                    // Orientation (dir) is recorded per cell, but the final box-drawing
                    // tile is chosen from bridge-cell adjacency in spawnPendingBridges so
                    // the intersection cell becomes a "+" junction. crossingGroup scopes
                    // that adjacency test to this blob's own crossings.
                    this.pendingBridgeSpawns.push({
                        x: c.x, y: c.y, dir: crossing.dir, crossingGroup: crossingGroupId
                    });
                    usedCells.add(ck);
                }
                console.log(`  Bridge: ${crossing.length} tiles (${crossing.dir === 'h' ? 'horizontal' : 'vertical'})`);
            }
            // One abyss consumes one slot even when it gets a crossing on both axes.
            placed++;
        }

        if (placed > 0) {
            console.log(`Bridge generation: ${placed} bridge(s)`);
        }
    },

    generateCollapsingFloors(config) {
        const maxPatches = config.max || 2;
        const minPatchSize = config.minSize || 2;
        const maxPatchSize = config.maxSize || 5;

        const isAbyss = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            const bg = this.backgroundMap[y][x];
            return bg && globalVars.VOID_TILE_IDS.includes(bg.tileId) && this.floorMap[y][x] === null;
        };

        const hasFloor = (x, y) => {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
            return this.floorMap[y][x] !== null;
        };

        const wallSet = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        const bridgeSet = new Set(this.pendingBridgeSpawns.map(p => `${p.x},${p.y}`));
        // Collapsing a floor out from under a lake would leave the water actor
        // hanging over the void.
        const liquidSet = new Set(this.pendingLiquidSpawns.map(p => `${p.x},${p.y}`));

        // Collect the floor tiles sitting on the lip of an abyss. Nothing is
        // painted; the rule only marks cells.
        const edgeTiles = this.applyTilePattern('floor', [{
            when: (ctx, x, y) => {
                if (!hasFloor(x, y)) return false;
                if (wallSet.has(`${x},${y}`)) return false;
                if (bridgeSet.has(`${x},${y}`)) return false;
                if (liquidSet.has(`${x},${y}`)) return false;
                // A causeway is somebody's only way home; don't drop it out.
                if (this._causewayCells.has(`${x},${y}`)) return false;
                return ctx.any4((c, nx, ny) => isAbyss(nx, ny), x, y);
            },
            paint: null
        }], {
            collect: true,
            bounds: { x1: 1, y1: 1, x2: this.width - 2, y2: this.height - 2 }
        });

        if (edgeTiles.length === 0) return;

        // Patches grow cardinally out from each seed tile.
        const cardinalDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        for (let i = edgeTiles.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [edgeTiles[i], edgeTiles[j]] = [edgeTiles[j], edgeTiles[i]];
        }

        const usedCells = new Set();
        let placed = 0;

        for (const seed of edgeTiles) {
            if (placed >= maxPatches) break;
            if (usedCells.has(`${seed.x},${seed.y}`)) continue;

            const patchSize = minPatchSize + Math.floor(ROT.RNG.getUniform() * (maxPatchSize - minPatchSize + 1));
            const patch = [seed];
            const patchSet = new Set([`${seed.x},${seed.y}`]);
            const frontier = [];

            const canCollapse = (x, y) => {
                const key = `${x},${y}`;
                return hasFloor(x, y) && !wallSet.has(key) && !bridgeSet.has(key)
                    && !liquidSet.has(key) && !this._causewayCells.has(key);
            };

            for (const [dx, dy] of cardinalDirs) {
                const nx = seed.x + dx, ny = seed.y + dy;
                if (canCollapse(nx, ny)) {
                    frontier.push({ x: nx, y: ny });
                }
            }

            while (patch.length < patchSize && frontier.length > 0) {
                const idx = Math.floor(ROT.RNG.getUniform() * frontier.length);
                const cell = frontier.splice(idx, 1)[0];
                const key = `${cell.x},${cell.y}`;
                if (patchSet.has(key) || usedCells.has(key)) continue;

                patch.push(cell);
                patchSet.add(key);

                for (const [dx, dy] of cardinalDirs) {
                    const nx = cell.x + dx, ny = cell.y + dy;
                    if (!patchSet.has(`${nx},${ny}`) && canCollapse(nx, ny)) {
                        frontier.push({ x: nx, y: ny });
                    }
                }
            }

            if (patch.length < minPatchSize) continue;

            for (const c of patch) {
                this.floorMap[c.y][c.x] = null;
                this.backgroundMap[c.y][c.x] = { tileId: globalVars.VOID_FILL, layer: 'background' };
                this.pendingCollapsingFloorSpawns.push(c);
                usedCells.add(`${c.x},${c.y}`);
            }

            placed++;
            console.log(`  Collapsing floor: ${patch.length} tiles`);
        }

        this.walkableTiles = this.walkableTiles.filter(
            t => !usedCells.has(`${t.x},${t.y}`)
        );

        if (placed > 0) {
            console.log(`Collapsing floor generation: ${placed} patch(es)`);
        }
    },
};
