/**
 * Architect methods: the Palladian generator: the bay grid, room layout,
 * portico, columns, openings, secret passages and hidden levers, connectivity,
 * windows and region publishing.
 */

export const ArchitectPalladian = {
    // ========================================================================
    // PALLADIAN GENERATOR
    // ========================================================================
    //
    // Stage 1: the tartan grid.
    //
    // A (2m+1) x n array of variously-dimensioned rectangles ("bays"), mirrored
    // about a north-south axis, with adjacent bays separated by exactly ONE wall
    // thickness. The odd count is on the columns, since the axis is N-S.
    //
    // Two invariants everything downstream leans on:
    //
    //  - The central column's interior width is ODD, which makes axisX an exact
    //    tile column and mirror(x) = 2*axisX - x exact.
    //
    //  - Symmetry is MIRROR-BY-CONSTRUCTION: roll the west half, assign the east
    //    half from it. There is no "mirror afterwards" pass. Every later stage
    //    follows the same discipline.

    /**
     * @param {object} cfg - palladian config
     * @param {object} [bounds] - sub-rectangle to fit the villa into, for the wildcard
     *   path. Defaults to the whole map, which is the full-floor generator's behavior.
     *   The villa is centered inside these bounds and every returned coordinate is
     *   still absolute/world, so downstream stages need no offsetting.
     */
    _palladianBuildGrid(cfg, bounds = null) {
        const area = bounds || { x: 0, y: 0, width: this.width, height: this.height };
        const rollRange = (range, lo = 1) => {
            const a = Math.max(lo, Math.min(range[0], range[1]));
            const b = Math.max(lo, Math.max(range[0], range[1]));
            return ROT.RNG.getUniformInt(a, b);
        };

        let nCols = rollRange(cfg.bayColumns, 1);
        if (nCols % 2 === 0) nCols++;               // the grammar requires 2m+1
        let nRows = rollRange(cfg.bayRows, 1);

        const axisCol = (nCols - 1) / 2;

        // Roll the WEST half only, then assign the east half by mirror.
        const widths = new Array(nCols).fill(0);
        for (let c = 0; c < axisCol; c++) widths[c] = rollRange(cfg.bayWidth, 2);
        let centerWidth = Math.round(rollRange(cfg.bayWidth, 2) * (cfg.centralBias / 100));
        centerWidth = Math.max(2, centerWidth);
        if (centerWidth % 2 === 0) centerWidth++;   // must be odd to be bisected
        widths[axisCol] = centerWidth;
        for (let k = 1; k <= axisCol; k++) widths[axisCol + k] = widths[axisCol - k];

        // Rows need no symmetry — the axis is N-S. That freedom is what lets a
        // villa have a deep portico row and a shallow service row.
        const heights = [];
        for (let r = 0; r < nRows; r++) heights.push(rollRange(cfg.bayHeight, 2));

        // Only a projecting portico needs extra height reserved; an in-antis one is
        // recessed into the mass and costs nothing. 'random' may resolve either
        // way later, so reserve for the worst case.
        const projects = cfg.porticoStyle === 'prostyle' || cfg.porticoStyle === 'random';
        const porticoDepth = projects ? Math.max(1, cfg.porticoDepth) : 0;
        const sum = (arr) => arr.reduce((a, b) => a + b, 0);
        // nCols + 1 walls: one between each adjacent pair, plus the two exterior.
        const footprint = () => ({
            w: sum(widths) + nCols + 1,
            h: sum(heights) + nRows + 1
        });
        // MARGIN of 2, not 1. The villa's own exterior wall must not sit at x=1 or
        // y=1: _finalizeMap's perimeter gap-fill (its pass 3) writes a
        // metal_wall in any perimeter cell adjacent to floor, which would land at
        // x=0/y=0 — outside the reserve, and on row 0 where `y > 0` guards apply.
        const MARGIN = 2;
        const fits = () => {
            const { w, h } = footprint();
            return w <= area.width - 2 * MARGIN && h + porticoDepth <= area.height - 2 * MARGIN;
        };

        // Degradation ladder. Never throws: a generator that throws breaks
        // loadFloor. Shrink dimensions first (keeps the silhouette), then drop
        // column PAIRS (preserving oddness and symmetry), then rows.
        let guard = 0;
        while (!fits() && guard++ < 200) {
            // axisCol moves as columns are dropped, so recompute it each pass.
            const mid = (nCols - 1) / 2;
            const shrinkable = widths.some((w, c) => w > (c === mid ? 3 : 2))
                || heights.some(h => h > 2);
            if (shrinkable) {
                for (let c = 0; c < nCols; c++) {
                    if (c === mid) {
                        // The central column must stay ODD to be bisected by the
                        // axis, so it shrinks by 2 rather than rounding back up.
                        widths[c] = Math.max(3, widths[c] - 2);
                    } else {
                        widths[c] = Math.max(2, widths[c] - 1);
                    }
                }
                for (let k = 1; k <= mid; k++) widths[mid + k] = widths[mid - k];
                for (let r = 0; r < nRows; r++) heights[r] = Math.max(2, heights[r] - 1);
                continue;
            }
            if (nCols > 1) {
                // Drop the outermost pair. splice() lops off the two EAST-most
                // entries, which shifts the centre, so re-establish both invariants
                // afterwards: the new centre must be odd, and the surviving east
                // half must be re-mirrored from the west.
                nCols -= 2;
                widths.splice(nCols);
                const newAxis = (nCols - 1) / 2;
                if (widths[newAxis] % 2 === 0) widths[newAxis]++;
                for (let k = 1; k <= newAxis; k++) widths[newAxis + k] = widths[newAxis - k];
                continue;
            }
            if (nRows > 1) {
                nRows -= 1;
                heights.splice(nRows);
                continue;
            }
            break;
        }
        if (!fits()) return null;

        // Dropping column pairs shifts the axis, so recompute it.
        const finalAxisCol = (nCols - 1) / 2;

        // Every downstream stage assumes bilateral symmetry; check it here while a
        // violation is still one array to inspect.
        if (widths[finalAxisCol] % 2 === 0) {
            console.error(`Palladian: central width ${widths[finalAxisCol]} is even; cannot be bisected`);
            return null;
        }
        for (let k = 1; k <= finalAxisCol; k++) {
            if (widths[finalAxisCol - k] !== widths[finalAxisCol + k]) {
                console.error(`Palladian: asymmetric widths ${JSON.stringify(widths)} about column ${finalAxisCol}`);
                return null;
            }
        }
        const { w: footprintW, h: footprintH } = footprint();

        // Center the FOOTPRINT and derive the axis from it. Centering axisX on
        // this.width/2 instead introduces off-by-one asymmetry when the map width
        // and the footprint width differ in parity.
        const X0 = area.x + Math.max(MARGIN, Math.floor((area.width - footprintW) / 2));
        const Y0 = area.y + Math.max(MARGIN, Math.floor((area.height - footprintH - porticoDepth) / 2));

        const colX = [];
        let x = X0 + 1;
        for (let c = 0; c < nCols; c++) {
            colX.push([x, x + widths[c] - 1]);
            x += widths[c] + 1;                     // +1 for the wall between bays
        }
        const rowY = [];
        let y = Y0 + 1;
        for (let r = 0; r < nRows; r++) {
            rowY.push([y, y + heights[r] - 1]);
            y += heights[r] + 1;
        }

        // Pins the one-wall-thickness scheme; catches off-by-ones at their source
        // rather than as a 2-tile-thick wall much later.
        for (let c = 0; c + 1 < nCols; c++) {
            if (colX[c + 1][0] !== colX[c][1] + 2) {
                console.error(`Palladian: column spacing broken at ${c} (${colX[c][1]} -> ${colX[c + 1][0]})`);
                return null;
            }
        }
        for (let r = 0; r + 1 < nRows; r++) {
            if (rowY[r + 1][0] !== rowY[r][1] + 2) {
                console.error(`Palladian: row spacing broken at ${r} (${rowY[r][1]} -> ${rowY[r + 1][0]})`);
                return null;
            }
        }

        const axisX = colX[finalAxisCol][0] + (widths[finalAxisCol] - 1) / 2;

        const bays = [];
        for (let r = 0; r < nRows; r++) {
            const row = [];
            for (let c = 0; c < nCols; c++) {
                row.push({ col: c, row: r, x1: colX[c][0], y1: rowY[r][0], x2: colX[c][1], y2: rowY[r][1] });
            }
            bays.push(row);
        }

        return {
            nCols, nRows, axisCol: finalAxisCol, axisX,
            colX, rowY, bays, widths, heights,
            footprintW, footprintH,
            left: X0,
            right: X0 + footprintW - 1,
            top: Y0,
            bottom: Y0 + footprintH - 1,
            porticoDepth
        };
    },

    // Stage 2 is implicit: dungeonGrid starts all-zero, we carve only interiors,
    // and the surrounding ring of zeros IS the exterior wall — _finalizeMap
    // turns it into wall actors for free.
    _palladianCarveBays(dungeonGrid, plan) {
        for (let r = 0; r < plan.nRows; r++) {
            for (let c = 0; c < plan.nCols; c++) {
                const b = plan.bays[r][c];
                this._carveRect(dungeonGrid, b.x1, b.y1, b.x2, b.y2);
            }
        }
    },
    // Stage 3: room layout by concatenation.
    //
    // Start with one room per bay, then merge adjacent bays. The paper permits AT
    // MOST ONE non-rectangular room, bisected by the axis — the sanctum. Enforced
    // structurally: phase A builds it, phase B rejects any merge creating a second.
    //
    // Bays in a column share an x-span and bays in a row share a y-span, so a
    // bay-set that is a rectangle in GRID space is always a rectangle in TILE
    // space too — which makes the rectangularity test pure integer bookkeeping.
    _palladianLayoutRooms(dungeonGrid, plan, cfg) {
        const { nCols, nRows, axisCol } = plan;
        const key = (c, r) => `${c},${r}`;

        // Union-find over bay keys, tracking each set's grid extent and size so
        // the rectangularity test is O(1).
        const parent = new Map();
        const meta = new Map();
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const k = key(c, r);
                parent.set(k, k);
                meta.set(k, { colMin: c, colMax: c, rowMin: r, rowMax: r, size: 1 });
            }
        }
        const find = (k) => {
            while (parent.get(k) !== k) {
                parent.set(k, parent.get(parent.get(k)));
                k = parent.get(k);
            }
            return k;
        };
        const isRect = (m) => m.size === (m.colMax - m.colMin + 1) * (m.rowMax - m.rowMin + 1);

        const union = (ka, kb) => {
            const ra = find(ka), rb = find(kb);
            if (ra === rb) return true;
            const ma = meta.get(ra), mb = meta.get(rb);
            const m = {
                colMin: Math.min(ma.colMin, mb.colMin), colMax: Math.max(ma.colMax, mb.colMax),
                rowMin: Math.min(ma.rowMin, mb.rowMin), rowMax: Math.max(ma.rowMax, mb.rowMax),
                size: ma.size + mb.size
            };
            parent.set(rb, ra);
            meta.set(ra, m);
            return true;
        };
        // A merge is legal only if the result stays a grid-rectangle. Trying it
        // on a scratch copy avoids having to undo a real union.
        const wouldStayRect = (ka, kb) => {
            const ra = find(ka), rb = find(kb);
            if (ra === rb) return true;
            const ma = meta.get(ra), mb = meta.get(rb);
            return isRect({
                colMin: Math.min(ma.colMin, mb.colMin), colMax: Math.max(ma.colMax, mb.colMax),
                rowMin: Math.min(ma.rowMin, mb.rowMin), rowMax: Math.max(ma.rowMax, mb.rowMax),
                size: ma.size + mb.size
            });
        };

        // ---- Phase A: the sanctum, the one permitted non-rectangular room ----
        const sanctumKeys = new Set();
        let sanctumShape = null;
        if (ROT.RNG.getPercentage() <= cfg.sanctumChance && nRows >= 2) {
            const pool = Array.isArray(cfg.sanctumShapes) && cfg.sanctumShapes.length
                ? cfg.sanctumShapes : ['cross', 'tee', 'eye'];
            let want = pool[Math.floor(ROT.RNG.getUniform() * pool.length)];
            // Fall back down the ladder when the grid can't host the shape.
            const order = ['cross', 'tee', 'eye'];
            let idx = order.indexOf(want);
            if (idx < 0) idx = 0;
            for (let attempt = 0; attempt < order.length; attempt++) {
                const shape = order[(idx + attempt) % order.length];
                if (shape === 'cross' && (nRows < 3 || nCols < 3)) continue;
                if (shape === 'tee' && nCols < 3) continue;
                if (shape === 'eye' && nRows < 2) continue;
                sanctumShape = shape;
                break;
            }

            if (sanctumShape) {
                // Every shape is built as a bay-set symmetric about axisCol, so it
                // is bisected by the axis automatically.
                const addAxial = (r0, r1) => {
                    for (let r = r0; r <= r1; r++) sanctumKeys.add(key(axisCol, r));
                };
                const addFullRow = (r) => {
                    for (let c = 0; c < nCols; c++) sanctumKeys.add(key(c, r));
                };
                if (sanctumShape === 'cross') {
                    // Axial column across a run, plus one full interior row.
                    const r0 = 0, r1 = nRows - 1;
                    addAxial(r0, r1);
                    const rm = r0 + 1 + Math.floor(ROT.RNG.getUniform() * (r1 - r0 - 1));
                    addFullRow(rm);
                } else if (sanctumShape === 'tee') {
                    // Axial column plus the full first row: a T opening on the front.
                    addAxial(0, nRows - 1);
                    addFullRow(0);
                } else {
                    // 'eye' (I): axial column plus the full first and last rows.
                    addAxial(0, nRows - 1);
                    addFullRow(0);
                    addFullRow(nRows - 1);
                }

                // Union every sanctum bay together, recording the adjacencies so
                // their dividing walls get carved away below.
                const keys = [...sanctumKeys];
                for (const k of keys) {
                    const [c, r] = k.split(',').map(Number);
                    for (const [dc, dr] of [[1, 0], [0, 1]]) {
                        const nk = key(c + dc, r + dr);
                        if (!sanctumKeys.has(nk)) continue;
                        union(k, nk);
                    }
                }
            }
        }

        // ---- Phase B: rectangular merges, always applied as mirror pairs ----
        const mirrorCol = (c) => 2 * axisCol - c;
        const touchesSanctum = (c, r) => sanctumKeys.has(key(c, r));

        const tryMerge = (a, b) => {
            const ka = key(a.c, a.r), kb = key(b.c, b.r);
            if (touchesSanctum(a.c, a.r) || touchesSanctum(b.c, b.r)) return false;
            if (!wouldStayRect(ka, kb)) return false;
            union(ka, kb);
            return true;
        };

        // West-half adjacencies plus vertical adjacencies inside the axial column.
        // An axis-CROSSING adjacency is deliberately never offered here: applying
        // one unpaired would break bilateral symmetry. The only axis-crossing
        // merge allowed is a full-row merge, which is self-mirror (below).
        const candidates = [];
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                // East-west, both bays strictly west of the axis.
                if (c + 1 < axisCol) candidates.push({ kind: 'pair', a: { c, r }, b: { c: c + 1, r } });
                // North-south, west half or on the axis (the latter is self-mirror).
                if (r + 1 < nRows && c <= axisCol) {
                    candidates.push({ kind: c === axisCol ? 'self' : 'pair', a: { c, r }, b: { c, r: r + 1 } });
                }
            }
        }
        for (const cand of candidates) {
            if (ROT.RNG.getPercentage() > cfg.mergeChance) continue;
            // One roll decides both twins: apply to both or neither.
            tryMerge(cand.a, cand.b);
            if (cand.kind === 'pair') {
                tryMerge(
                    { c: mirrorCol(cand.a.c), r: cand.a.r },
                    { c: mirrorCol(cand.b.c), r: cand.b.r }
                );
            }
        }
        // Full-row merges: all nCols bays of one row into a single hall. Self-mirror,
        // so this is the one way a room may legally span the axis in phase B.
        for (let r = 0; r < nRows; r++) {
            if (ROT.RNG.getPercentage() > cfg.mergeChance) continue;
            let ok = true;
            for (let c = 0; c < nCols; c++) if (touchesSanctum(c, r)) { ok = false; break; }
            if (!ok) continue;
            for (let c = 0; c + 1 < nCols; c++) tryMerge({ c, r }, { c: c + 1, r });
        }

        // Carve away the dividing walls, driven by FINAL room membership rather
        // than the log of attempted merges: union-find makes bays same-room
        // transitively (merge A-B and B-C and A is C's roommate without A|C ever
        // appearing in the log).
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const here = find(key(c, r));
                // East-west divider.
                if (c + 1 < nCols && find(key(c + 1, r)) === here) {
                    const wallX = plan.colX[c][1] + 1;
                    this._carveRect(dungeonGrid, wallX, plan.rowY[r][0], wallX, plan.rowY[r][1]);
                }
                // North-south divider.
                if (r + 1 < nRows && find(key(c, r + 1)) === here) {
                    const wallY = plan.rowY[r][1] + 1;
                    this._carveRect(dungeonGrid, plan.colX[c][0], wallY, plan.colX[c][1], wallY);
                }
            }
        }
        // Carving strips leaves the wall CORNERS where a vertical and a horizontal
        // strip cross. A corner belongs to the room iff all four bays around it do.
        for (let r = 0; r + 1 < nRows; r++) {
            for (let c = 0; c + 1 < nCols; c++) {
                const roots = [
                    find(key(c, r)), find(key(c + 1, r)),
                    find(key(c, r + 1)), find(key(c + 1, r + 1))
                ];
                if (!roots.every(root => root === roots[0])) continue;
                this._carveRect(
                    dungeonGrid,
                    plan.colX[c][1] + 1, plan.rowY[r][1] + 1,
                    plan.colX[c][1] + 1, plan.rowY[r][1] + 1
                );
            }
        }

        // Collect the resulting rooms.
        const byRoot = new Map();
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const root = find(key(c, r));
                if (!byRoot.has(root)) byRoot.set(root, []);
                byRoot.get(root).push(plan.bays[r][c]);
            }
        }

        const rooms = [];
        for (const [root, bayList] of byRoot) {
            const isSanctum = sanctumKeys.size > 0 && bayList.some(b => sanctumKeys.has(key(b.col, b.row)));
            const m = meta.get(root);
            rooms.push({
                id: rooms.length,
                bays: bayList,
                bayKeys: new Set(bayList.map(b => key(b.col, b.row))),
                x1: Math.min(...bayList.map(b => b.x1)),
                y1: Math.min(...bayList.map(b => b.y1)),
                x2: Math.max(...bayList.map(b => b.x2)),
                y2: Math.max(...bayList.map(b => b.y2)),
                shape: isSanctum ? sanctumShape : 'rect',
                isSanctum,
                isRectangular: isRect(m),
                doors: []
            });
        }
        return rooms;
    },

    // Stage 5: the principal entrance.
    //
    // On the SOUTH elevation: the player conventionally arrives from below, and it
    // keeps the portico well clear of the row-0 hazard in _finalizeMap. The
    // span is the central bay's interior, so it is symmetric about the axis by
    // construction.
    _palladianAddPortico(dungeonGrid, plan, cfg) {
        let style = cfg.porticoStyle;
        if (style === 'none') return null;
        if (style === 'random') style = ROT.RNG.getUniform() < 0.5 ? 'prostyle' : 'in_antis';
        if (style !== 'prostyle' && style !== 'in_antis') style = 'prostyle';

        const spanX1 = plan.colX[plan.axisCol][0];
        const spanX2 = plan.colX[plan.axisCol][1];
        if ((spanX1 + spanX2) !== 2 * plan.axisX) {
            console.error(`Palladian: portico span ${spanX1}-${spanX2} not symmetric about axis ${plan.axisX}`);
            return null;
        }

        let depth = Math.max(1, cfg.porticoDepth);
        if (style === 'prostyle' && plan.bottom + depth > this.height - 2) {
            depth = Math.max(1, this.height - 2 - plan.bottom);
            if (plan.bottom + depth > this.height - 2) style = 'in_antis';
        }
        if (style === 'in_antis') {
            // Clamp the recess to the south row's interior. Any deeper and it eats
            // north through interior walls, which is not what "in antis" means and
            // on a shallow plan would breach the top of the villa entirely.
            const southRow = plan.rowY[plan.nRows - 1];
            depth = Math.min(depth, southRow[1] - southRow[0] + 1);
        }

        // The whole opening is carved as plain floor (1), never as a door
        // candidate (2): finalize rolls doorChance on 2-cells, and a wide portico
        // must never sprout a door actor in the middle of it.
        let colonnadeY;
        if (style === 'prostyle') {
            // Carves through the exterior wall row at plan.bottom — that gap is the
            // principal doorway. The projecting block's own walls are the
            // surrounding zeros, which finalize turns into walls for free.
            this._carveRect(dungeonGrid, spanX1, plan.bottom, spanX2, plan.bottom + depth);
            colonnadeY = plan.bottom + depth;
        } else {
            // In antis: the recess eats the southern part of the south-row axial
            // bay, which is exactly what the term means. Enclosing walls come free.
            this._carveRect(dungeonGrid, spanX1, plan.bottom - depth, spanX2, plan.bottom);
            colonnadeY = plan.bottom;
        }

        return { style, depth, spanX1, spanX2, colonnadeY, innerY: Math.min(this.height - 2, plan.bottom - 1) };
    },

    // Stage 6: the colonnade.
    //
    // Pushed to pendingWallSpawns AFTER _finalizeMap, so finalize's torch
    // pass can't convert a column into a wall torch and its perimeter rule can't
    // rewrite one as metal_wall. The column tiles stay in walkableTiles, which is
    // correct: spawnPendingWalls creates solid actors there before any random
    // spawning, and getAvailableTiles filters by actor occupancy.
    _palladianPlaceColumns(plan, portico, cfg) {
        if (!portico || cfg.columnSpacing <= 0) return;
        const { spanX1, spanX2, colonnadeY } = portico;
        const span = spanX2 - spanX1 + 1;
        if (span < 2) return;

        let n = Math.floor((span - 1) / (cfg.columnSpacing + 1)) + 1;
        // An odd count puts a column ON the axis, blocking the principal doorway.
        // The axis is always an intercolumniation.
        if (n % 2 === 1) n--;
        if (n < 2) return;

        for (let i = 0; i < n; i++) {
            const x = spanX1 + Math.round((i * (span - 1)) / (n - 1));
            if (x === plan.axisX) continue;      // belt and braces
            this.pendingWallSpawns.push({ x, y: colonnadeY, type: 'column' });
        }
    },

    // Stage 7: windows, doors, and enfilade. This stage also delivers connectivity.
    //
    // Doors are positioned BY ALIGNMENT, not randomly. Two registries hold the
    // sight-lines established so far, seeded from the exterior window centres;
    // each interior door prefers to reuse an existing line and only establishes a
    // new one when it must. That greedy rule is the enfilade mechanism: doors
    // chain onto the window centres, giving a straight sight-line from a window on
    // one flank, through every intervening room, out the other side.
    _palladianAddOpenings(dungeonGrid, plan, rooms, portico, cfg) {
        const { axisX } = plan;
        const mirrorX = (x) => 2 * axisX - x;
        const mirrorCol = (c) => 2 * plan.axisCol - c;
        const hAxes = new Set();     // y values with an established east-west line
        const vAxes = new Set();     // x values with an established north-south line
        const windows = [];

        const roomAt = (c, r) => rooms.find(rm => rm.bayKeys.has(`${c},${r}`));

        // ---- Exterior windows ----
        // Generated for the WEST flank and mirrored; never computed independently
        // on the east side.
        const addWindow = (x, y) => {
            if (x < 1 || x > this.width - 2 || y < 1 || y > this.height - 2) return;
            if (dungeonGrid[y][x] >= 1) return;
            dungeonGrid[y][x] = 1;
            windows.push({ x, y });
        };

        // Left and right walls: one opening per row, at the row's centre.
        const sideOpenings = [];
        for (let r = 0; r < plan.nRows; r++) {
            const cy = Math.floor((plan.rowY[r][0] + plan.rowY[r][1]) / 2);
            sideOpenings.push(cy);
        }
        // The paper's rule: an odd number of openings per elevation. If even, drop
        // the one furthest from the axis — that is what makes elevations read as
        // classical.
        if (sideOpenings.length % 2 === 0 && sideOpenings.length > 0) {
            const midY = (plan.top + plan.bottom) / 2;
            let worst = 0;
            for (let i = 1; i < sideOpenings.length; i++) {
                if (Math.abs(sideOpenings[i] - midY) > Math.abs(sideOpenings[worst] - midY)) worst = i;
            }
            sideOpenings.splice(worst, 1);
        }
        for (const cy of sideOpenings) {
            addWindow(plan.left, cy);
            addWindow(plan.right, cy);       // mirror of the left wall
            hAxes.add(cy);                   // seeds the east-west sight-lines
        }

        // Top wall: one opening per column, generated for x <= axisX and mirrored.
        const topOpenings = [];
        for (let c = 0; c <= plan.axisCol; c++) {
            topOpenings.push(Math.floor((plan.colX[c][0] + plan.colX[c][1]) / 2));
        }
        for (const cx of topOpenings) {
            if (cx === axisX) {
                // The axial opening is the principal rear door: always open, so the
                // north-south sight-line is never interrupted.
                addWindow(axisX, plan.top);
            } else {
                addWindow(cx, plan.top);
                addWindow(mirrorX(cx), plan.top);
            }
            vAxes.add(cx);
            vAxes.add(mirrorX(cx));
        }
        vAxes.add(axisX);

        // ---- Interior doors ----
        // Pick the position that reuses an existing sight-line if one crosses the
        // shared wall; otherwise establish a new line at the overlap's centre.
        const pickAligned = (axes, lo, hi) => {
            let best = null;
            const mid = Math.floor((lo + hi) / 2);
            for (const v of axes) {
                if (v < lo || v > hi) continue;
                if (best === null || Math.abs(v - mid) < Math.abs(best - mid)) best = v;
            }
            if (best !== null) return best;
            axes.add(mid);
            return mid;
        };

        // East-west adjacencies (a vertical wall between two bays): walk the west
        // half and mirror.
        //
        // A mirrored pair is decided ATOMICALLY — one y for both twins, and the
        // twin is carved even if this side turned out not to need a door. Testing
        // each side independently would leave a lone door with no counterpart.
        for (let r = 0; r < plan.nRows; r++) {
            for (let c = 0; c + 1 < plan.nCols; c++) {
                const wallX = plan.colX[c][1] + 1;
                if (wallX > axisX) continue;                       // handled by the mirror
                const mc = mirrorCol(c);
                const needsWest = this._palladianNeedsDoor(roomAt(c, r), roomAt(c + 1, r));
                const needsEast = this._palladianNeedsDoor(roomAt(mc - 1, r), roomAt(mc, r));
                if (!needsWest && !needsEast) continue;
                // Both bays are in the same row, so they share a y-span exactly.
                const y = pickAligned(hAxes, plan.rowY[r][0], plan.rowY[r][1]);
                this._palladianRegisterDoor(dungeonGrid, plan, rooms, wallX, y, false);
                const mx = mirrorX(wallX);
                if (mx !== wallX) this._palladianRegisterDoor(dungeonGrid, plan, rooms, mx, y, false);
            }
        }

        // North-south adjacencies (a horizontal wall). An adjacency crossed at
        // x === axisX is self-mirror, and placing it there is what runs the axial
        // enfilade from the rear door, through the sanctum, out the portico.
        for (let r = 0; r + 1 < plan.nRows; r++) {
            // Only the west half and the axial column: the east half is produced by
            // mirroring, never computed independently.
            for (let c = 0; c <= plan.axisCol; c++) {
                const onAxis = (c === plan.axisCol);
                const mc = mirrorCol(c);
                const needsWest = this._palladianNeedsDoor(roomAt(c, r), roomAt(c, r + 1));
                const needsEast = onAxis
                    ? needsWest
                    : this._palladianNeedsDoor(roomAt(mc, r), roomAt(mc, r + 1));
                if (!needsWest && !needsEast) continue;
                const wallY = plan.rowY[r][1] + 1;
                const lo = plan.colX[c][0], hi = plan.colX[c][1];
                // The axial column's door sits exactly on the axis, which is what
                // runs the enfilade from the rear door, through the sanctum, out
                // through the portico.
                const x = onAxis ? axisX : pickAligned(vAxes, lo, hi);
                this._palladianRegisterDoor(dungeonGrid, plan, rooms, x, wallY, onAxis);
                if (!onAxis) {
                    this._palladianRegisterDoor(dungeonGrid, plan, rooms, mirrorX(x), wallY, false);
                }
            }
        }

        return { windows, hAxes, vAxes };
    },

    /**
     * Stage 7b — concealed passages.
     *
     * A tartan grid has no dead ends, so the Brogue generator's secret-door trick
     * (a shortcut hidden at the end of a blind corridor) has nowhere to go here.
     * The villa's version is a doorway that reads as blank wall: the door pass
     * connects every pair of adjacent rooms, so the raw material is an ordinary
     * interior door, disguised rather than a passage cut somewhere new.
     *
     * Concealing a door changes the reading of the plan: an apartment whose other
     * entrance is concealed becomes a private cabinet, which is the point of the
     * type. Two rules keep it from also changing whether the villa is playable.
     * Every room keeps at least one door that can simply be walked through, so a
     * search is always a shortcut. And a lever-barred passage — which genuinely
     * does block until its lever is pulled — only ever sites that lever where it
     * can be reached with the door shut, counting every barred door already placed,
     * so two passages can never hold each other's lever.
     *
     * The axial door is never touched. It carries the enfilade from the rear door
     * through the sanctum and out the portico, and hiding it would break the one
     * sight-line the generator exists to produce. Mirrored twins are converted as
     * a pair, so the villa is never asymmetric about its axis.
     */
    _palladianAddSecretPassages(dungeonGrid, plan, rooms, cfg) {
        const chance = cfg.secretPassageChance ?? 0;
        if (chance <= 0) return { doors: [], levers: [] };

        const { axisX } = plan;
        const mirrorX = (x) => 2 * axisX - x;

        // Interior doors only: grid 2. Exterior windows and the axial opening are
        // carved as 1 and so are excluded automatically.
        const interior = [];
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (dungeonGrid[y][x] !== 2) continue;
                if (x === axisX) continue;               // never hide the enfilade
                interior.push({ x, y });
            }
        }
        if (interior.length === 0) return { doors: [], levers: [] };

        const roomsAt = (x, y) => rooms.filter(rm =>
            rm.doors.some(d => d.x === x && d.y === y));

        // A room must keep at least one door the player can simply walk through, or
        // the secret stops being a shortcut and becomes the only way in. Counting is
        // done against a live set of concealed tiles rather than a per-room tally:
        // a door is shared by the rooms on both sides (and the sanctum touches many),
        // so decrementing per-room counters miscounts as soon as one door is claimed
        // by two rooms.
        const concealed = new Set();
        const wouldStrand = (pts) => {
            const trial = new Set([...concealed, ...pts.map(q => `${q.x},${q.y}`)]);
            const affected = new Set(pts.flatMap(q => roomsAt(q.x, q.y)));
            for (const rm of affected) {
                if (!rm.doors.some(d => !trial.has(`${d.x},${d.y}`))) return true;
            }
            return false;
        };

        const doors = [], levers = [];
        const taken = new Set();
        // Every barred cell placed so far, so later passages account for them.
        const barredSoFar = [];
        // Wall cells already given to a lever. Two passages can otherwise pick the
        // same cell and stack two levers on one tile.
        const leverCells = new Set();

        for (const pt of interior) {
            const key = `${pt.x},${pt.y}`;
            if (taken.has(key)) continue;                // already claimed as a twin
            if (pt.x > axisX) continue;                  // west half drives; east mirrors
            if (ROT.RNG.getPercentage() > chance) continue;

            const twin = { x: mirrorX(pt.x), y: pt.y };
            const pair = (twin.x !== pt.x && dungeonGrid[twin.y]?.[twin.x] === 2)
                ? [pt, twin] : [pt];

            // Both twins must survive the last-door test, or neither is hidden.
            if (wouldStrand(pair)) continue;

            for (const q of pair) concealed.add(`${q.x},${q.y}`);
            for (const q of pair) {
                taken.add(`${q.x},${q.y}`);
                // Grid 1, not 2: finalize turns a 2 into an ordinary visible door.
                dungeonGrid[q.y][q.x] = 1;
            }

            // Bar the pair or neither, and site the west lever only — the twin's
            // lever is its mirror image. Rolling each side independently would put
            // the two levers in unrelated places, which is visible asymmetry.
            //
            // A barred door DOES block passage until its lever is pulled, so unlike a
            // plain concealed door it can strand: put the lever behind the door it
            // opens and the room is sealed for good. The lever therefore has to go in
            // whichever of the two rooms is still reachable with this door treated as
            // wall — checked against the live grid, so earlier passages in this same
            // pass are already accounted for.
            // Reachability is tested against THIS pair plus every barred door already
            // placed. Testing only this pair lets two passages each hold the other's
            // lever — a deadlock neither search can break, since a barred door has no
            // other opener.
            this._palladianRegionCache = null;
            const barred = ROT.RNG.getPercentage() <= (cfg.secretPassageLeverChance ?? 0);
            const shut = [...pair, ...barredSoFar];
            const hostRooms = barred
                ? this._palladianRoomsReachableWithout(dungeonGrid, roomsAt(pt.x, pt.y), shut)
                : [];
            const candidate = (barred && hostRooms.length > 0)
                ? this._palladianFindHiddenLeverSpot(dungeonGrid, plan, hostRooms, pt, leverCells)
                : null;
            // A reachable room is not enough: the lever is in a wall cell, and that
            // cell has to border the part of the room that is still reachable.
            const spot = (candidate &&
                this._palladianCellReachableWithout(dungeonGrid, candidate, shut))
                ? candidate : null;
            // The twin's lever is the mirror of this one. The mirror of a wall cell is
            // a wall cell, but only inside the villa envelope — and mirroring does not
            // preserve reachability, since the twin door blocks a different region. So
            // the reflected cell is checked for both.
            const twinSpot = spot
                ? { x: mirrorX(spot.x), y: spot.y }
                : null;
            const twinSpotOk = twinSpot &&
                twinSpot.x >= 1 && twinSpot.x < this.width - 1 &&
                dungeonGrid[twinSpot.y]?.[twinSpot.x] < 1 &&
                !leverCells.has(`${twinSpot.x},${twinSpot.y}`) &&
                this._palladianCellReachableWithout(dungeonGrid, twinSpot, shut);

            if (!spot || (pair.length > 1 && !twinSpotOk)) {
                doors.push(...pair);
                continue;
            }

            const spots = pair.length > 1 ? [spot, twinSpot] : [spot];
            pair.forEach((q, i) => {
                const machineId = `palladian_secret_${doors.length}`;
                doors.push({ ...q, machine_id: machineId });
                levers.push({ ...spots[i], machine_id: machineId });
                leverCells.add(`${spots[i].x},${spots[i].y}`);
                barredSoFar.push({ x: q.x, y: q.y });
            });
        }

        return { doors, levers };
    },

    /**
     * Hand the finished secret passages to the spawn queues.
     *
     * Runs AFTER finalize, for the same reason the colonnade does: finalize
     * queues a wall on every void cell touching floor, which includes the tile a
     * hidden lever wants. Claiming the tile here — and dropping the wall finalize
     * queued for it — is what stops the two actors landing on top of each other.
     */
    _palladianQueueSecrets(secrets) {
        if (!secrets) return;
        if (secrets.levers.length > 0) {
            const claimed = new Set(secrets.levers.map(l => `${l.x},${l.y}`));
            const free = (p) => !claimed.has(`${p.x},${p.y}`);
            this.pendingWallSpawns = this.pendingWallSpawns.filter(free);
            // Finalize's torch pass draws from pendingWallSpawns, so it may already
            // have picked this tile before the wall itself was dropped.
            this.pendingTorchSpawns = this.pendingTorchSpawns.filter(free);
        }
        this.pendingSecretDoorSpawns.push(...secrets.doors);
        this.pendingHiddenLeverSpawns.push(...secrets.levers);
    },

    /**
     * Which of a passage's two rooms are still reachable with that passage shut.
     *
     * Flood-fills the live grid from the largest open region with the barred cells
     * treated as wall, then keeps the rooms that region touches. A lever sited in a
     * room this returns can always be reached, so a barred passage can never seal
     * itself off — the failure mode is permanent, since nothing else opens it.
     */
    _palladianRoomsReachableWithout(dungeonGrid, candidateRooms, barredCells) {
        if (candidateRooms.length === 0) return [];
        const region = this._palladianOpenRegionWithout(dungeonGrid, barredCells);
        if (region.size === 0) return [];

        // A room counts as reached when any of its own bay cells is in the region;
        // its doors are not enough, since a door can be the barred cell itself.
        return candidateRooms.filter(rm => rm.bays.some(b => {
            for (let y = b.y1; y <= b.y2; y++) {
                for (let x = b.x1; x <= b.x2; x++) {
                    if (region.has(`${x},${y}`)) return true;
                }
            }
            return false;
        }));
    },

    /**
     * The largest open region of the grid with `barredCells` treated as wall.
     *
     * Seeded from the largest component rather than an arbitrary tile: the player
     * arrives by the stairs, which land in open floor, and the biggest component is
     * the best proxy for that available at this stage. Memoized so the three checks
     * for one passage share a single flood fill; the caller drops the cache when it
     * moves to the next passage, since carving one mutates the grid.
     */
    _palladianOpenRegionWithout(dungeonGrid, barredCells) {
        const blocked = new Set(barredCells.map(p => `${p.x},${p.y}`));
        const cacheKey = [...blocked].sort().join('|');
        if (this._palladianRegionCache?.key === cacheKey) return this._palladianRegionCache.region;

        const open = (x, y) => dungeonGrid[y]?.[x] >= 1 && !blocked.has(`${x},${y}`);
        const seenAll = new Set();
        let best = new Set();
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const k = `${x},${y}`;
                if (seenAll.has(k) || !open(x, y)) continue;
                const comp = new Set([k]);
                const stack = [[x, y]];
                while (stack.length) {
                    const [cx, cy] = stack.pop();
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nx = cx + dx, ny = cy + dy, nk = `${nx},${ny}`;
                        if (comp.has(nk) || !open(nx, ny)) continue;
                        comp.add(nk);
                        stack.push([nx, ny]);
                    }
                }
                for (const c of comp) seenAll.add(c);
                if (comp.size > best.size) best = comp;
            }
        }
        this._palladianRegionCache = { key: cacheKey, region: best };
        return best;
    },

    // Can the player stand next to this wall cell with the barred cells shut? A wall
    // is worked from the floor beside it, so that is what has to be reachable.
    _palladianCellReachableWithout(dungeonGrid, cell, barredCells) {
        const region = this._palladianOpenRegionWithout(dungeonGrid, barredCells);
        return [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .some(([dx, dy]) => region.has(`${cell.x + dx},${cell.y + dy}`));
    },

    /**
     * A wall cell inside one of the passage's two rooms, to hide the lever in.
     *
     * The lever must be a wall the villa would have had anyway — it replaces the
     * wall actor on its tile, so it has to sit on a cell that finalize is going to
     * turn into wall (void in the grid, adjacent to that room's floor). Sitting it
     * one room away from the door it opens is deliberate: finding the lever and
     * finding the passage are two separate discoveries.
     */
    _palladianFindHiddenLeverSpot(dungeonGrid, plan, roomsPair, doorPt, taken = null) {
        const spots = [];
        for (const room of roomsPair) {
            for (const b of room.bays) {
                for (let y = b.y1 - 1; y <= b.y2 + 1; y++) {
                    for (let x = b.x1 - 1; x <= b.x2 + 1; x++) {
                        if (x < 1 || y < 1 || x >= this.width - 1 || y >= this.height - 1) continue;
                        if (dungeonGrid[y][x] >= 1) continue;           // must be wall
                        if (x === doorPt.x && y === doorPt.y) continue;
                        if (taken?.has(`${x},${y}`)) continue;         // another lever has it
                        // Needs floor beside it, or it is a wall nobody can reach.
                        const reachable = [[1, 0], [-1, 0], [0, 1], [0, -1]]
                            .some(([dx, dy]) => dungeonGrid[y + dy]?.[x + dx] >= 1);
                        if (!reachable) continue;
                        spots.push({ x, y });
                    }
                }
            }
        }
        if (spots.length === 0) return null;
        return spots[Math.floor(ROT.RNG.getUniform() * spots.length)];
    },

    // Two bays need a door between them when they exist and are different rooms.
    // Same room means the dividing wall was already carved away by a merge.
    _palladianNeedsDoor(roomA, roomB) {
        return !!roomA && !!roomB && roomA !== roomB;
    },

    // Which bay (if any) contains a tile. Used to attribute a door to the rooms on
    // either side of it.
    _palladianBayAt(plan, x, y) {
        for (let r = 0; r < plan.nRows; r++) {
            if (y < plan.rowY[r][0] || y > plan.rowY[r][1]) continue;
            for (let c = 0; c < plan.nCols; c++) {
                if (x >= plan.colX[c][0] && x <= plan.colX[c][1]) return [c, r];
            }
        }
        return null;
    },

    // Carve one opening and attribute it to the rooms on both sides. addDoor is
    // idempotent, and every room needs at least one door to be eligible for
    // treasure rooms and switch puzzles.
    _palladianRegisterDoor(dungeonGrid, plan, rooms, x, y, axial) {
        if (x < 1 || x > this.width - 2 || y < 1 || y > this.height - 2) return;
        if (dungeonGrid[y][x] >= 1) return;
        dungeonGrid[y][x] = axial ? 1 : 2;

        const sides = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        const seen = new Set();
        for (const [sx, sy] of sides) {
            const bay = this._palladianBayAt(plan, sx, sy);
            if (!bay) continue;
            const room = rooms.find(rm => rm.bayKeys.has(`${bay[0]},${bay[1]}`));
            if (!room || seen.has(room.id)) continue;
            seen.add(room.id);
            room.doors.push({ x, y });
        }
    },
    // The door pass covers every adjacency, so the plan should already be
    // connected — but an off-by-one in an overlap, or an in-antis recess eating a
    // bay's only opening, can still orphan a room.
    _palladianEnsureConnected(dungeonGrid, plan, rooms, portico) {
        const mirrorX = (x) => 2 * plan.axisX - x;
        const start = portico
            ? { x: plan.axisX, y: portico.innerY }
            : { x: rooms[0].x1, y: rooms[0].y1 };

        for (let pass = 0; pass <= rooms.length; pass++) {
            const seen = this._floodFillRegion(dungeonGrid, start.x, start.y);
            const reached = (room) => {
                for (const b of room.bays) {
                    for (let y = b.y1; y <= b.y2; y++) {
                        for (let x = b.x1; x <= b.x2; x++) if (seen.has(`${x},${y}`)) return true;
                    }
                }
                return false;
            };
            const orphans = rooms.filter(r => !reached(r));
            if (orphans.length === 0) return;
            if (pass === rooms.length) {
                console.warn(`Palladian: ${orphans.length} room(s) still unreachable after repair`);
                return;
            }

            for (const room of orphans) {
                // Find a wall tile between this room and anything already reached,
                // and punch it. A repair opening is plain floor (1), never a door
                // candidate — it must not be gated on a doorChance roll.
                let done = false;
                for (const b of room.bays) {
                    const probes = [];
                    for (let y = b.y1; y <= b.y2; y++) {
                        probes.push({ wx: b.x1 - 1, wy: y, ox: b.x1 - 2, oy: y });
                        probes.push({ wx: b.x2 + 1, wy: y, ox: b.x2 + 2, oy: y });
                    }
                    for (let x = b.x1; x <= b.x2; x++) {
                        probes.push({ wx: x, wy: b.y1 - 1, ox: x, oy: b.y1 - 2 });
                        probes.push({ wx: x, wy: b.y2 + 1, ox: x, oy: b.y2 + 2 });
                    }
                    for (const p of probes) {
                        if (p.wx < 1 || p.wx > this.width - 2 || p.wy < 1 || p.wy > this.height - 2) continue;
                        if (p.ox < 0 || p.ox >= this.width || p.oy < 0 || p.oy >= this.height) continue;
                        if (dungeonGrid[p.wy][p.wx] >= 1) continue;
                        if (!seen.has(`${p.ox},${p.oy}`)) continue;
                        dungeonGrid[p.wy][p.wx] = 1;
                        room.doors.push({ x: p.wx, y: p.wy });
                        // Mirror every repair. If the twin's room was already
                        // connected the extra opening is harmless.
                        const mx = mirrorX(p.wx);
                        if (mx !== p.wx && mx >= 1 && mx <= this.width - 2 && dungeonGrid[p.wy][mx] < 1) {
                            dungeonGrid[p.wy][mx] = 1;
                        }
                        done = true;
                        break;
                    }
                    if (done) break;
                }
            }
        }
    },

    // Build the ROT.js-Room-duck-typed records that diggerRooms consumers expect.
    // The getLeft/getDoors/addDoor shape from _makeRoomRecord is consumed by
    // spawnTreasureRoom, _placeSwitchPuzzle_gatedRoom and finalize's torch pass.
    _palladianMakeRecords(dungeonGrid, plan, rooms, portico, openings) {
        // A room that swallowed the whole grid has no interior adjacency, so the
        // door pass never gave it one. Its exterior openings are its entrances —
        // and every room needs at least one door or spawnTreasureRoom and the
        // switch-puzzle placer filter it out entirely.
        if (openings) {
            for (const room of rooms) {
                if (room.doors.length > 0) continue;
                for (const w of openings.windows) {
                    const touches = room.bays.some(b =>
                        w.x >= b.x1 - 1 && w.x <= b.x2 + 1 && w.y >= b.y1 - 1 && w.y <= b.y2 + 1);
                    if (touches) room.doors.push({ x: w.x, y: w.y });
                }
            }
        }

        const records = [];
        for (const room of rooms) {
            const w = room.x2 - room.x1 + 1, h = room.y2 - room.y1 + 1;
            const local = Array.from({ length: h }, () => new Uint8Array(w));
            for (const b of room.bays) {
                for (let y = b.y1; y <= b.y2; y++) {
                    for (let x = b.x1; x <= b.x2; x++) local[y - room.y1][x - room.x1] = 1;
                }
            }
            const rec = this._makeRoomRecord(local, w, h, room.x1, room.y1, room.doors);
            rec.shape = room.shape;
            rec.isSanctum = !!room.isSanctum;
            records.push(rec);
        }

        if (portico) {
            const y1 = portico.style === 'prostyle' ? plan.bottom : plan.bottom - portico.depth;
            const y2 = portico.style === 'prostyle' ? plan.bottom + portico.depth : plan.bottom;
            const w = portico.spanX2 - portico.spanX1 + 1, h = y2 - y1 + 1;
            const local = Array.from({ length: h }, () => new Uint8Array(w).fill(1));
            const rec = this._makeRoomRecord(local, w, h, portico.spanX1, y1,
                [{ x: plan.axisX, y: plan.bottom }]);
            rec.shape = 'rect';
            rec.isPortico = true;
            records.push(rec);
        }

        // Protect the sanctum from being claimed by a switch puzzle or converted
        // into a locked treasure room — the boss is authored to live there.
        const sanctumIdx = records.findIndex(r => r.isSanctum);
        if (sanctumIdx >= 0) this.claimedRoomIndices.add(sanctumIdx);

        return records;
    },

    // Exterior window openings get a see-through solid actor. `fortification` is
    // solid with opaque:false — a barred window, keeping the villa's envelope
    // sealed. Pushed after finalize for the same reason as the colonnade.
    _palladianPlaceWindows(openings) {
        for (const w of openings.windows) {
            this.pendingWallSpawns.push({ x: w.x, y: w.y, type: 'fortification' });
        }
    },

    // Publish the sanctum and portico so a random_actors/random_items entry can
    // name one via its `region` key. The dungeonGrid >= 1 test is what correctly
    // handles a cross-shaped sanctum, whose bbox includes non-floor cells.
    _palladianPublishRegions(dungeonGrid, plan, records, portico) {
        const tilesOf = (rec) => {
            const tiles = [];
            for (let y = rec._y1; y <= rec._y2; y++) {
                for (let x = rec._x1; x <= rec._x2; x++) {
                    if (y < 0 || y >= this.height || x < 0 || x >= this.width) continue;
                    if (dungeonGrid[y][x] >= 1) tiles.push({ x, y });
                }
            }
            return tiles;
        };
        const sanctum = records.find(r => r.isSanctum);
        if (sanctum) this.namedRegions.sanctum = tilesOf(sanctum);
        const porticoRec = records.find(r => r.isPortico);
        if (porticoRec) this.namedRegions.portico = tilesOf(porticoRec);
        if (this.namedRegions.portico?.length) {
            this.suggestedStairwayRegions.up = 'portico';
        }
    },
};
