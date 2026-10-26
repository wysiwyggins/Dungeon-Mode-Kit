/**
 * Architect methods: the Brogue-style dungeon generator's helpers: room shapes,
 * door sites, corridors, loops, winding corridors and dead-end fixing.
 */

import { TP_DIRS4, TP_DIRS8 } from './architect.js';

export const ArchitectBrogue = {
    // ========================================================================
    // BROGUE GENERATOR HELPERS
    // ========================================================================

    _dungeonMakeRoom(type, cfg) {
        switch (type) {
            case 'cross': return this._dungeonMakeCross(cfg);
            case 'circular': return this._dungeonMakeCircular(cfg);
            case 'cavern': return this._makeCavernShape(cfg);
            case 'rectangle':
            default: return this._dungeonMakeRectangle(cfg);
        }
    },

    _dungeonPickRoomType(weights) {
        const entries = Object.entries(weights);
        const total = entries.reduce((s, [, w]) => s + w, 0);
        let roll = ROT.RNG.getUniform() * total;
        for (const [type, weight] of entries) {
            roll -= weight;
            if (roll <= 0) return type;
        }
        return entries[0][0];
    },

    _dungeonMakeRectangle(cfg) {
        const w = ROT.RNG.getUniformInt(cfg.rectWidth[0], cfg.rectWidth[1]);
        const h = ROT.RNG.getUniformInt(cfg.rectHeight[0], cfg.rectHeight[1]);
        const grid = Array.from({ length: h }, () => new Uint8Array(w).fill(1));
        return { grid, width: w, height: h };
    },

    _dungeonMakeCross(cfg) {
        const totalW = ROT.RNG.getUniformInt(cfg.crossWidth[0], cfg.crossWidth[1]);
        const totalH = ROT.RNG.getUniformInt(cfg.crossHeight[0], cfg.crossHeight[1]);
        const grid = Array.from({ length: totalH }, () => new Uint8Array(totalW));

        const hBarH = ROT.RNG.getUniformInt(2, Math.max(3, Math.floor(totalH * 0.5)));
        const hBarTop = Math.floor((totalH - hBarH) / 2);
        for (let y = hBarTop; y < hBarTop + hBarH; y++) {
            for (let x = 0; x < totalW; x++) grid[y][x] = 1;
        }

        const vBarW = ROT.RNG.getUniformInt(2, Math.max(3, Math.floor(totalW * 0.5)));
        const vBarLeft = Math.floor((totalW - vBarW) / 2);
        for (let y = 0; y < totalH; y++) {
            for (let x = vBarLeft; x < vBarLeft + vBarW; x++) grid[y][x] = 1;
        }

        return { grid, width: totalW, height: totalH };
    },

    _dungeonMakeCircular(cfg) {
        const radius = ROT.RNG.getUniformInt(cfg.circularRadius[0], cfg.circularRadius[1]);
        const size = radius * 2 + 1;
        const grid = Array.from({ length: size }, () => new Uint8Array(size));
        const center = radius;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - center;
                const dy = y - center;
                if (dx * dx + dy * dy < radius * radius + radius) {
                    grid[y][x] = 1;
                }
            }
        }

        if (radius >= 4 && ROT.RNG.getPercentage() <= cfg.hollowChance) {
            const innerR = radius - 2;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const dx = x - center;
                    const dy = y - center;
                    if (dx * dx + dy * dy < innerR * innerR) {
                        grid[y][x] = 0;
                    }
                }
            }
        }

        return { grid, width: size, height: size };
    },

    _makeCavernShape(cfg) {
        const w = ROT.RNG.getUniformInt(cfg.cavernWidth[0], cfg.cavernWidth[1]);
        const h = ROT.RNG.getUniformInt(cfg.cavernHeight[0], cfg.cavernHeight[1]);
        let grid = Array.from({ length: h }, () => {
            const row = new Uint8Array(w);
            for (let x = 0; x < w; x++) row[x] = ROT.RNG.getUniform() < 0.55 ? 1 : 0;
            return row;
        });

        // B5678/S45678 cellular automata, 5 iterations
        for (let iter = 0; iter < 5; iter++) {
            const next = Array.from({ length: h }, () => new Uint8Array(w));
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let neighbors = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny][nx] === 1) neighbors++;
                        }
                    }
                    if (grid[y][x] === 1) {
                        next[y][x] = neighbors >= 4 ? 1 : 0; // survive with 4+
                    } else {
                        next[y][x] = neighbors >= 5 ? 1 : 0; // birth with 5+
                    }
                }
            }
            grid = next;
        }

        // Flood-fill to find largest connected component
        const visited = Array.from({ length: h }, () => new Uint8Array(w));
        let bestBlob = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] !== 1 || visited[y][x]) continue;
                const blob = [];
                const stack = [{ x, y }];
                while (stack.length > 0) {
                    const cell = stack.pop();
                    if (cell.x < 0 || cell.x >= w || cell.y < 0 || cell.y >= h) continue;
                    if (visited[cell.y][cell.x] || grid[cell.y][cell.x] !== 1) continue;
                    visited[cell.y][cell.x] = 1;
                    blob.push(cell);
                    stack.push({ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y },
                               { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 });
                }
                if (blob.length > bestBlob.length) bestBlob = blob;
            }
        }

        // Rebuild grid with only the largest blob
        const result = Array.from({ length: h }, () => new Uint8Array(w));
        for (const cell of bestBlob) result[cell.y][cell.x] = 1;

        // If blob is too small, fall back to rectangle
        if (bestBlob.length < 6) return this._dungeonMakeRectangle(cfg);

        return { grid: result, width: w, height: h };
    },

    _dungeonFindDoorSites(grid, w, h) {
        const dirs = [
            { name: 'north', dx: 0, dy: -1 },
            { name: 'south', dx: 0, dy: 1 },
            { name: 'east', dx: 1, dy: 0 },
            { name: 'west', dx: -1, dy: 0 }
        ];

        // Work on a padded grid so edge-adjacent floor cells get door candidates
        const pw = w + 2, ph = h + 2;
        const padded = Array.from({ length: ph }, () => new Uint8Array(pw));
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                padded[y + 1][x + 1] = grid[y][x];
            }
        }

        const candidates = { north: [], south: [], east: [], west: [] };

        for (let y = 0; y < ph; y++) {
            for (let x = 0; x < pw; x++) {
                if (padded[y][x] !== 0) continue;
                for (const dir of dirs) {
                    const ix = x - dir.dx, iy = y - dir.dy;
                    const ox = x + dir.dx, oy = y + dir.dy;
                    if (ix < 0 || ix >= pw || iy < 0 || iy >= ph) continue;
                    if (padded[iy][ix] !== 1) continue;
                    if (ox >= 0 && ox < pw && oy >= 0 && oy < ph && padded[oy][ox] !== 0) continue;
                    // Convert back to original grid coordinates (offset by -1)
                    candidates[dir.name].push({ localX: x - 1, localY: y - 1, direction: dir.name });
                }
            }
        }

        const result = [];
        for (const dir of dirs) {
            const cands = candidates[dir.name];
            if (cands.length > 0) {
                result.push(cands[Math.floor(ROT.RNG.getUniform() * cands.length)]);
            }
        }
        return result;
    },

    _dungeonMaybeAddCorridor(grid, w, h, doorSites, cfg) {
        if (ROT.RNG.getPercentage() > cfg.corridorChance || doorSites.length === 0) {
            return { grid, width: w, height: h, doorSites, hasCorridor: false, corridorCells: [] };
        }

        const dirNames = ['north', 'south', 'east', 'west'];
        const dirVecs = { north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 }, east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 } };
        const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };

        // Pick a random door site that has enough room for a corridor
        const shuffled = [...doorSites];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        let site = null;
        for (const s of shuffled) {
            const dv = dirVecs[s.direction];
            const endX = s.localX + dv.dx * cfg.corridorLength[1];
            const endY = s.localY + dv.dy * cfg.corridorLength[1];
            if (endX >= -w && endX < w * 2 && endY >= -h && endY < h * 2) {
                site = s;
                break;
            }
        }
        if (!site) return { grid, width: w, height: h, doorSites, hasCorridor: false, corridorCells: [] };

        const dv = dirVecs[site.direction];
        const len = ROT.RNG.getUniformInt(cfg.corridorLength[0], cfg.corridorLength[1]);

        // Calculate new grid dimensions. Extend to i = len + 1 (one past the
        // corridor tip) so the forward-facing door site — which sits at tip + dv —
        // lands INSIDE the padded grid.
        let padLeft = 0, padRight = 0, padTop = 0, padBottom = 0;
        for (let i = 1; i <= len + 1; i++) {
            const nx = site.localX + dv.dx * i;
            const ny = site.localY + dv.dy * i;
            if (nx < 0) padLeft = Math.max(padLeft, -nx);
            if (nx >= w) padRight = Math.max(padRight, nx - w + 1);
            if (ny < 0) padTop = Math.max(padTop, -ny);
            if (ny >= h) padBottom = Math.max(padBottom, ny - h + 1);
        }

        const newW = w + padLeft + padRight;
        const newH = h + padTop + padBottom;
        const newGrid = Array.from({ length: newH }, () => new Uint8Array(newW));

        // Copy old grid with offset
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                newGrid[y + padTop][x + padLeft] = grid[y][x];
            }
        }

        // Draw corridor, recording each corridor cell (local coords). i=0 is the
        // room's own door cell — skip it; only i>=1 are true corridor tiles that
        // should get the relaxed adjacency rule at placement time.
        const corridorCells = [];
        for (let i = 0; i <= len; i++) {
            const cx = site.localX + padLeft + dv.dx * i;
            const cy = site.localY + padTop + dv.dy * i;
            newGrid[cy][cx] = 1;
            if (i >= 1) corridorCells.push({ x: cx, y: cy });
        }

        // Last interior cell of the corridor
        const lastX = site.localX + padLeft + dv.dx * len;
        const lastY = site.localY + padTop + dv.dy * len;

        // Replace ALL door sites with ones radiating from corridor end (Brogue's approach).
        // Forward-facing (same dir as corridor) is always kept.
        // Perpendicular exits only 15% of the time. Opposite dir (back into room) never.
        const allowOblique = ROT.RNG.getPercentage() <= 15;
        const newDoorSites = [];
        for (const dirName of dirNames) {
            const ddv = dirVecs[dirName];
            const doorX = lastX + ddv.dx;
            const doorY = lastY + ddv.dy;

            if (doorX < 0 || doorX >= newW || doorY < 0 || doorY >= newH) continue;
            if (newGrid[doorY][doorX] === 1) continue;

            if (dirName === site.direction) {
                newDoorSites.push({ localX: doorX, localY: doorY, direction: dirName });
            } else if (dirName !== opposite[site.direction] && allowOblique) {
                newDoorSites.push({ localX: doorX, localY: doorY, direction: dirName });
            }
        }

        return { grid: newGrid, width: newW, height: newH, doorSites: newDoorSites, hasCorridor: true, corridorCells };
    },

    _dungeonPlaceRoom(dungeonGrid, roomGrid, roomW, roomH, doorSites, mapW, mapH, corridorCells = []) {
        const dirVecs = { north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 }, east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 } };
        // Corridor cells get a relaxed adjacency rule: unlike room bodies (which
        // must keep a clear 3x3 gap so they don't fuse), a 1-wide corridor is
        // meant to run alongside walls and thread past room corners. For corridor
        // cells only ORTHOGONAL adjacency to foreign floor is forbidden (prevents
        // fusing two passages side-by-side); diagonal proximity is allowed.
        const corridorSet = new Set(corridorCells.map(c => c.x + ',' + c.y));

        // Collect attachment targets: empty cells adjacent to existing floor
        const targets = [];
        for (let y = 1; y < mapH - 1; y++) {
            for (let x = 1; x < mapW - 1; x++) {
                if (dungeonGrid[y][x] !== 0) continue;
                const adjFloor =
                    (y > 0 && dungeonGrid[y - 1][x] >= 1) ||
                    (y < mapH - 1 && dungeonGrid[y + 1][x] >= 1) ||
                    (x > 0 && dungeonGrid[y][x - 1] >= 1) ||
                    (x < mapW - 1 && dungeonGrid[y][x + 1] >= 1);
                if (adjFloor) targets.push({ x, y });
            }
        }

        // Fisher-Yates shuffle
        for (let i = targets.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [targets[i], targets[j]] = [targets[j], targets[i]];
        }

        // Also shuffle door sites to avoid directional bias
        const shuffledDoors = [...doorSites];
        for (let i = shuffledDoors.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [shuffledDoors[i], shuffledDoors[j]] = [shuffledDoors[j], shuffledDoors[i]];
        }

        const maxTargets = Math.min(targets.length, 300);

        for (let ti = 0; ti < maxTargets; ti++) {
            const target = targets[ti];
            for (const doorSite of shuffledDoors) {
                const dv = dirVecs[doorSite.direction];

                // Door's outward direction must point toward existing floor
                const floorX = target.x + dv.dx;
                const floorY = target.y + dv.dy;
                if (floorX < 0 || floorX >= mapW || floorY < 0 || floorY >= mapH) continue;
                if (dungeonGrid[floorY][floorX] < 1) continue;

                const offsetX = target.x - doorSite.localX;
                const offsetY = target.y - doorSite.localY;

                // Validate placement
                let valid = true;
                for (let ry = 0; ry < roomH && valid; ry++) {
                    for (let rx = 0; rx < roomW && valid; rx++) {
                        if (roomGrid[ry][rx] !== 1) continue;
                        const wx = offsetX + rx;
                        const wy = offsetY + ry;

                        if (wx < 1 || wx >= mapW - 1 || wy < 1 || wy >= mapH - 1) { valid = false; break; }
                        if (dungeonGrid[wy][wx] !== 0) { valid = false; break; }

                        const isCorridorCell = corridorSet.has(rx + ',' + ry);
                        if (isCorridorCell) {
                            // Relaxed rule: only forbid ORTHOGONAL adjacency to foreign
                            // floor (keeps corridors from fusing side-by-side into a
                            // 2-wide passage or merging rooms); diagonal proximity is
                            // fine, so the corridor can hug walls and pass room corners.
                            for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                                if (!valid) break;
                                const nx = wx + ox, ny = wy + oy;
                                if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                                if (nx === target.x && ny === target.y) continue;
                                const nrx = nx - offsetX, nry = ny - offsetY;
                                if (nrx >= 0 && nrx < roomW && nry >= 0 && nry < roomH && roomGrid[nry][nrx] === 1) continue;
                                if (dungeonGrid[ny][nx] >= 1) valid = false;
                            }
                        } else {
                            // Room-body cell: strict 3x3 separation so rooms don't fuse.
                            for (let dy = -1; dy <= 1 && valid; dy++) {
                                for (let dx = -1; dx <= 1 && valid; dx++) {
                                    if (dx === 0 && dy === 0) continue;
                                    const nx = wx + dx, ny = wy + dy;
                                    if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                                    if (nx === target.x && ny === target.y) continue;
                                    // Check if this neighbor is also a room floor cell
                                    const nrx = nx - offsetX, nry = ny - offsetY;
                                    if (nrx >= 0 && nrx < roomW && nry >= 0 && nry < roomH && roomGrid[nry][nrx] === 1) continue;
                                    if (dungeonGrid[ny][nx] >= 1) valid = false;
                                }
                            }
                        }
                    }
                }

                if (valid) {
                    return { offsetX, offsetY, doorWorldX: target.x, doorWorldY: target.y, doorSite };
                }
            }
        }

        return null;
    },

    _makeRoomRecord(roomGrid, w, h, offsetX, offsetY, doors) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (roomGrid[y][x] === 1) {
                    const wx = offsetX + x, wy = offsetY + y;
                    if (wx < minX) minX = wx;
                    if (wx > maxX) maxX = wx;
                    if (wy < minY) minY = wy;
                    if (wy > maxY) maxY = wy;
                }
            }
        }

        const record = {
            _x1: minX, _y1: minY, _x2: maxX, _y2: maxY,
            _doors: {},
            getLeft() { return this._x1; },
            getRight() { return this._x2; },
            getTop() { return this._y1; },
            getBottom() { return this._y2; },
            getDoors(cb) {
                for (const key in this._doors) {
                    const parts = key.split(',');
                    cb(parseInt(parts[0]), parseInt(parts[1]));
                }
                return this;
            },
            addDoor(x, y) { this._doors[`${x},${y}`] = 1; return this; }
        };

        for (const door of doors) {
            record.addDoor(door.x, door.y);
        }

        return record;
    },

    _dungeonMakeLoops(dungeonGrid, rooms, mapW, mapH, cfg) {
        const candidates = [];
        for (let y = 1; y < mapH - 1; y++) {
            for (let x = 1; x < mapW - 1; x++) {
                if (dungeonGrid[y][x] !== 0) continue;
                // Check horizontal: floor on both east and west
                if (dungeonGrid[y][x - 1] >= 1 && dungeonGrid[y][x + 1] >= 1) {
                    candidates.push({ x, y, side1: { x: x - 1, y }, side2: { x: x + 1, y } });
                }
                // Check vertical: floor on both north and south
                if (dungeonGrid[y - 1][x] >= 1 && dungeonGrid[y + 1][x] >= 1) {
                    candidates.push({ x, y, side1: { x, y: y - 1 }, side2: { x, y: y + 1 } });
                }
            }
        }

        // Shuffle candidates
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        let loopsCreated = 0;
        for (const cand of candidates) {
            if (loopsCreated >= cfg.maxLoops) break;
            const dist = this._dungeonBFS(dungeonGrid, cand.side1.x, cand.side1.y, cand.side2.x, cand.side2.y, mapW, mapH, cfg.loopMinDistance * 2);
            if (dist >= 0 && dist < cfg.loopMinDistance) continue;
            // dist === -1 means unreachable or exceeded cap — that's a good loop candidate too
            dungeonGrid[cand.y][cand.x] = 2;
            loopsCreated++;

            // Add to nearest room's doors
            let bestRoom = null, bestDist = Infinity;
            for (const room of rooms) {
                const rcx = (room._x1 + room._x2) / 2;
                const rcy = (room._y1 + room._y2) / 2;
                const d = Math.abs(rcx - cand.x) + Math.abs(rcy - cand.y);
                if (d < bestDist) { bestDist = d; bestRoom = room; }
            }
            if (bestRoom) bestRoom.addDoor(cand.x, cand.y);
        }

        if (loopsCreated > 0) console.log(`Brogue loops: ${loopsCreated} secondary connections`);
    },

    _dungeonBFS(dungeonGrid, x1, y1, x2, y2, mapW, mapH, maxDist) {
        if (x1 === x2 && y1 === y2) return 0;
        const visited = new Set();
        visited.add(`${x1},${y1}`);
        let frontier = [{ x: x1, y: y1 }];
        let dist = 0;
        const cardinals = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        while (frontier.length > 0 && dist < maxDist) {
            dist++;
            const next = [];
            for (const cell of frontier) {
                for (const [dx, dy] of cardinals) {
                    const nx = cell.x + dx, ny = cell.y + dy;
                    if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                    if (dungeonGrid[ny][nx] < 1) continue;
                    const key = `${nx},${ny}`;
                    if (visited.has(key)) continue;
                    if (nx === x2 && ny === y2) return dist;
                    visited.add(key);
                    next.push({ x: nx, y: ny });
                }
            }
            frontier = next;
        }

        return -1;
    },

    /**
     * Carves winding corridors through the rock left over after room accretion.
     *
     * Must run AFTER _dungeonMakeLoops (which would otherwise punch through the
     * fresh 1-tile walls this creates and dissolve the dead ends) and BEFORE
     * _dungeonFixDeadEnds (which is what harvests them).
     *
     * Writes only to dungeonGrid. _finalizeMap derives floorMap, walls and
     * walkableTiles from the finished grid, so a carved cell gets its wall ring
     * for free.
     */
    _dungeonCarveWindingCorridors(dungeonGrid, rooms, mapW, mapH, cfg) {
        const budget = cfg.maxWindingCorridors ?? 0;
        if (budget <= 0 || rooms.length === 0) return { carved: 0, attempted: 0 };

        const [minLen, maxLen] = cfg.windingLength || [6, 22];
        // Keep clear of the map edge: _finalizeMap skips row 0 when building
        // its wall ring (its `y > 0` guard), so floor carved too near the top would
        // never get capped. _carveWanderingPath clamps to the same inset.
        const inBounds = (x, y) => x >= 2 && y >= 2 && x <= mapW - 3 && y <= mapH - 3;
        const isRock = (x, y) => inBounds(x, y) && dungeonGrid[y][x] === 0;
        const isFloor = (x, y) =>
            x >= 0 && y >= 0 && x < mapW && y < mapH && dungeonGrid[y][x] >= 1;

        // Cells this corridor has already claimed. Kept separate from the grid so a
        // rejected path leaves nothing behind.
        let claimed = new Set();

        // Every room's wall ring, minus the cells that are the room itself. A
        // corridor may pierce this ring at its own mouth but must never run along
        // it: a passage carved flush against a room leaves no wall cell between the
        // two, and spawnTreasureRoom's seal only upgrades cells that are ALREADY
        // walls (it rewrites pendingWallSpawns entries inside the room's bbox+1).
        // With no wall there to upgrade, a vault picked on that room keeps a wide
        // open side and the loot is free. Reserving the ring keeps the wall that
        // the seal depends on.
        const roomRing = new Set();
        const ringOf = [];
        for (let r = 0; r < rooms.length; r++) {
            const room = rooms[r];
            const own = new Set();
            for (let y = room._y1 - 1; y <= room._y2 + 1; y++) {
                for (let x = room._x1 - 1; x <= room._x2 + 1; x++) {
                    if (x < 0 || y < 0 || x >= mapW || y >= mapH) continue;
                    if (dungeonGrid[y][x] === 0) { roomRing.add(`${x},${y}`); own.add(`${x},${y}`); }
                }
            }
            ringOf.push(own);
        }

        // The 1-tile-wall rule. Eight neighbours, not four: a corridor that slips
        // diagonally past a room corner would leave no wall cell between them, and
        // _finalizeMap's anyNeighbor8 wall pass would then quietly fuse the
        // corridor into the room.
        const clearOfOtherFloor = (x, y, allowed) => {
            for (const [dx, dy] of TP_DIRS8) {
                const nx = x + dx, ny = y + dy;
                const key = `${nx},${ny}`;
                if (allowed.has(key)) continue;
                if (isFloor(nx, ny)) return false;
            }
            return true;
        };

        // Seeds: a rock cell in a room's wall ring with the room on exactly one
        // side and somewhere to go on the other. Carving here reads as a doorway
        // punched in the room wall.
        const seeds = [];
        for (let r = 0; r < rooms.length; r++) {
            const room = rooms[r];
            for (let y = room._y1 - 1; y <= room._y2 + 1; y++) {
                for (let x = room._x1 - 1; x <= room._x2 + 1; x++) {
                    if (!isRock(x, y)) continue;
                    for (const [dx, dy] of TP_DIRS4) {
                        // floor behind, rock ahead and beyond
                        if (!isFloor(x - dx, y - dy)) continue;
                        if (!isRock(x + dx, y + dy)) continue;
                        if (!isRock(x + dx * 2, y + dy * 2)) continue;
                        seeds.push({ x, y, dx, dy, roomIndex: r });
                        break;
                    }
                }
            }
        }

        // Fisher-Yates, matching _dungeonMakeLoops. Not a sort: under a seeded RNG a
        // stable order would carve every map from the same corner outward.
        for (let i = seeds.length - 1; i > 0; i--) {
            const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
            [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
        }

        let carved = 0;
        let attempted = 0;
        let branches = 0;
        const attemptCap = budget * 8;
        let cursor = 0;

        while (carved < budget && attempted < attemptCap) {
            attempted++;

            // Most corridors start at a room; the rest branch off the tip of one
            // already carved, which turns a single dead end into a fork.
            let seed = null;
            const wantBranch = carved > 0 &&
                ROT.RNG.getPercentage() <= (cfg.windingBranchChance ?? 0);
            if (wantBranch) seed = this._dungeonFindCorridorTip(dungeonGrid, mapW, mapH, isRock);
            while (!seed && cursor < seeds.length) {
                const cand = seeds[cursor++];
                if (dungeonGrid[cand.y][cand.x] === 0) seed = cand;
            }
            if (!seed) break;   // out of seeds entirely

            // Aim at another room, not at empty rock. A corridor that stops in
            // open rock is a bare dead end: there is nothing on the far side of
            // its last wall, so _dungeonFixDeadEnds finds no floor within 2-3 tiles
            // and never turns it into a secret door. Brogue almost never leaves a
            // hallway hanging — a dead end is where a room is hiding. Targeting a
            // room means the corridor peters out one wall short of something, and
            // that wall is exactly what becomes the secret door.
            const target = this._dungeonFindCorridorTarget(rooms, seed, minLen, maxLen);
            if (!target) continue;
            const goal = target.goal;

            claimed = new Set([`${seed.x},${seed.y}`]);
            // The mouth is allowed to touch its own room; nothing else is.
            const mouthAllowance = new Set([`${seed.x - seed.dx},${seed.y - seed.dy}`]);
            // ...and the corridor has to be able to leave. The seed's own room ring
            // wraps the mouth on every side, so treating it as off-limits stopped
            // every path within two or three cells of where it started.
            const ownRing = seed.roomIndex === undefined ? null : ringOf[seed.roomIndex];
            // Same for the room's floor: the first corridor cell sits right beside
            // it by construction, so the separation test has to know that this one
            // room is allowed to be there. Only for the first couple of cells —
            // after that the corridor is clear and the normal rule applies.
            const ownFloor = seed.roomIndex === undefined ? null : rooms[seed.roomIndex];

            // isBarrier stays deliberately loose — is this cell rock? Putting the
            // separation rule in here instead would make the walk *skip* cells it
            // isn't allowed to collect while still stepping past them, returning a
            // list full of holes that the contiguity check below then cuts at the
            // first one. (That bug cost ~90% of every path: 7 cells raw, 0.8 kept.)
            // The rule belongs in the truncation pass, which can see the run so far.
            const raw = this._carveWanderingPath(seed, goal, (x, y) => isRock(x, y));

            // Walk the returned cells in order and stop at the first one that
            // breaks a rule. _carveWanderingPath cannot do this itself: it still
            // steps through cells it declines to collect, and its `collected` set
            // is private, so it can neither keep off existing floor nor notice the
            // path doubling back alongside itself.
            const path = [];
            let prev = seed;
            for (const cell of raw) {
                // A gap means the walk crossed ground it didn't collect; whatever
                // follows is a disconnected fragment, not more corridor.
                if (Math.abs(cell.x - prev.x) + Math.abs(cell.y - prev.y) !== 1) break;
                // Stopping *against* a room is the goal, not a failure: the wall
                // between this cell and the room is what _dungeonFixDeadEnds turns
                // into a secret door. So take the cell, then stop — the corridor
                // ends here, one wall short of somewhere worth getting to.
                // (Carving THROUGH the ring is still forbidden; that would fuse the
                // corridor into the room and leave no wall to hide.)
                const touchesRing = roomRing.has(`${cell.x},${cell.y}`) &&
                    !(ownRing && ownRing.has(`${cell.x},${cell.y}`));
                // Everything this corridor already owns is exempt from the
                // separation test — a passage is obviously adjacent to itself.
                // Only the seed's own room is additionally allowed.
                if (touchesRing) break;
                const allowed = new Set(claimed);
                for (const k of mouthAllowance) allowed.add(k);
                if (ownFloor && path.length < 2) {
                    for (let yy = ownFloor._y1; yy <= ownFloor._y2; yy++)
                        for (let xx = ownFloor._x1; xx <= ownFloor._x2; xx++)
                            allowed.add(`${xx},${yy}`);
                }
                if (!clearOfOtherFloor(cell.x, cell.y, allowed)) break;
                claimed.add(`${cell.x},${cell.y}`);
                path.push(cell);
                prev = cell;
            }

            if (path.length < minLen) continue;

            // Commit. Body cells are plain floor; the mouth is a door cell so
            // finalize can roll it against doorChance like any other doorway.
            for (const cell of path) this._carveRect(dungeonGrid, cell.x, cell.y, cell.x, cell.y, 1);
            this._carveRect(dungeonGrid, seed.x, seed.y, seed.x, seed.y, seed.roomIndex === undefined ? 1 : 2);

            // Register the mouth on its room. This is load-bearing for
            // spawnTreasureRoom, which builds its entrance list purely from
            // getDoors(): a mouth it cannot see is an unsealed back way into the
            // vault. Append only — that call keeps allEntrances[0] as the room's
            // original door and walls off the rest, and `_doors` preserves
            // insertion order because "x,y" keys are not integer indices.
            if (seed.roomIndex !== undefined) rooms[seed.roomIndex].addDoor(seed.x, seed.y);
            else branches++;

            carved++;
        }

        return { carved, attempted, branches };
    },

    /**
     * Pick a room for a corridor to head toward, and return an aim point just
     * short of it.
     *
     * The aim point matters more than it looks. `_carveWanderingPath` stops when
     * it reaches the goal, and the separation rule stops it one cell before it
     * touches the room's wall ring — so aiming at the room's edge leaves the
     * corridor ending against the room with a single wall between them. That wall
     * is what `_dungeonFixDeadEnds` sees floor behind, and what becomes the secret
     * door. Aiming at bare rock instead is what produced hallways that simply
     * stopped.
     *
     * Rooms nearer than minLen are skipped (nothing to wind through) and rooms
     * further than maxLen * 2 are skipped (the walk would cap out before
     * arriving, stranding the corridor in rock again).
     */
    _dungeonFindCorridorTarget(rooms, seed, minLen, maxLen) {
        const candidates = [];
        for (const room of rooms) {
            const cx = Math.round((room._x1 + room._x2) / 2);
            const cy = Math.round((room._y1 + room._y2) / 2);
            const dist = Math.abs(cx - seed.x) + Math.abs(cy - seed.y);
            if (dist < minLen || dist > maxLen * 2) continue;
            // Prefer rooms roughly ahead of the mouth: a target directly behind
            // would send the corridor straight back around its own room.
            const ahead = (cx - seed.x) * seed.dx + (cy - seed.y) * seed.dy;
            if (ahead <= 0) continue;
            candidates.push({ x: cx, y: cy, dist });
        }
        if (candidates.length === 0) return null;
        const pick = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
        return { goal: { x: pick.x, y: pick.y }, dist: pick.dist };
    },

    /**
     * A carved corridor's far tip: floor with exactly one floor neighbour, with
     * rock ahead to keep going into. Same shape as the dead-end test in
     * _dungeonFixDeadEnds, but looking for somewhere to branch rather than
     * somewhere to hide a door.
     */
    _dungeonFindCorridorTip(dungeonGrid, mapW, mapH, isRock) {
        const tips = [];
        for (let y = 2; y <= mapH - 3; y++) {
            for (let x = 2; x <= mapW - 3; x++) {
                if (dungeonGrid[y][x] < 1) continue;
                let open = 0;
                for (const [dx, dy] of TP_DIRS4) {
                    if (dungeonGrid[y + dy][x + dx] >= 1) open++;
                }
                if (open !== 1) continue;
                for (const [dx, dy] of TP_DIRS4) {
                    if (dungeonGrid[y + dy][x + dx] >= 1) continue;
                    if (isRock(x + dx, y + dy) && isRock(x + dx * 2, y + dy * 2)) {
                        tips.push({ x: x + dx, y: y + dy, dx, dy });
                    }
                }
            }
        }
        if (tips.length === 0) return null;
        return tips[Math.floor(ROT.RNG.getUniform() * tips.length)];
    },

    /**
     * Turn blind corridor ends into findable shortcuts: the wall at the tip of a
     * dead end, with open space directly behind it, becomes a secret door.
     *
     * The door has to be ONE tile thick. Searching out a hidden door and finding
     * bare rock behind it is the worst outcome this pass can produce, so the test
     * is that the cell straddles two open spaces along its own axis — dead end on
     * one side, floor on the other, nothing in between. An earlier version scanned
     * 2-3 tiles past the wall for floor and punched the door at distance 1, which
     * placed a door with rock behind it whenever the run of wall was thicker than
     * one tile: 12.8% of the doors it produced opened onto nothing.
     *
     * A door already standing next to the candidate disqualifies it too. Two doors
     * side by side in the same wall read as a mistake rather than a secret, and the
     * hidden one is pointless anyway — the visible door beside it already goes
     * through.
     */
    _dungeonFixDeadEnds(dungeonGrid, mapW, mapH, existingDoors = null) {
        const cardinals = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const secretWalls = [];
        const taken = new Set();

        const inBounds = (px, py) => px >= 0 && py >= 0 && px < mapW && py < mapH;
        const isOpen = (px, py) => inBounds(px, py) && dungeonGrid[py][px] >= 1;
        // A door cell (grid value 2) beside the candidate, or one already chosen by
        // an earlier dead end in this same pass.
        const doorNear = (px, py) => {
            for (let ny = py - 1; ny <= py + 1; ny++) {
                for (let nx = px - 1; nx <= px + 1; nx++) {
                    if (nx === px && ny === py) continue;
                    if (!inBounds(nx, ny)) continue;
                    if (dungeonGrid[ny][nx] === 2) return true;
                    if (taken.has(`${nx},${ny}`)) return true;
                    if (existingDoors && existingDoors.has(`${nx},${ny}`)) return true;
                }
            }
            return false;
        };

        for (let y = 1; y < mapH - 1; y++) {
            for (let x = 1; x < mapW - 1; x++) {
                if (dungeonGrid[y][x] < 1) continue;
                let floorNeighbors = 0;
                for (const [dx, dy] of cardinals) {
                    if (isOpen(x + dx, y + dy)) floorNeighbors++;
                }
                if (floorNeighbors !== 1) continue;

                // Dead end found — look for open space one wall away.
                for (const [dx, dy] of cardinals) {
                    if (isOpen(x + dx, y + dy)) continue;     // skip the open side
                    const wallX = x + dx, wallY = y + dy;
                    if (wallX < 1 || wallX >= mapW - 1 || wallY < 1 || wallY >= mapH - 1) continue;
                    if (taken.has(`${wallX},${wallY}`)) continue;
                    // One tile thick, and open on the far side. Both halves matter:
                    // without the second the door leads into rock.
                    if (!isOpen(x + dx * 2, y + dy * 2)) continue;
                    if (doorNear(wallX, wallY)) continue;

                    secretWalls.push({ x: wallX, y: wallY });
                    taken.add(`${wallX},${wallY}`);
                    break;
                }
            }
        }

        if (secretWalls.length > 0) console.log(`Brogue dead ends: ${secretWalls.length} shortcuts placed`);
        return secretWalls;
    },
};
