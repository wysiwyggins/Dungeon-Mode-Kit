#!/usr/bin/env node
//
// ASCII dump + invariant checks for the `palladian` map generator.
//
//   node tools/palladian-dump.js [seed] [width] [height] [--json '{"bayRows":[3,3]}']
//   node tools/palladian-dump.js --fuzz          # all sizes x 60 seeds, quiet
//   node tools/palladian-dump.js 7 --enfilade    # mark sight-lines
//
// Loads the real architect.js so the checks run against the shipped code rather
// than a copy. Reads only the Architect's OUTPUT structures (walkableTiles,
// pendingWallSpawns, diggerRooms, namedRegions), so it validates the contract the
// engine actually consumes.
//
// Exits non-zero on any failed invariant, so this works as a fuzz loop:
//   for s in $(seq 1 200); do node tools/palladian-dump.js $s || break; done

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROT = require(path.join(ROOT, 'lib/rot.js'));

// architect.js is a plain script declaring `class Architect`; it only touches
// `fetch` inside loadTiledMap, which we never call.
const src = fs.readFileSync(path.join(ROOT, 'architect.js'), 'utf8');
const Architect = new Function('ROT', 'console', src + '\n;return Architect;')(ROT, {
    log: () => {}, warn: () => {}, error: (...a) => console.error(...a)
});

// ---------------------------------------------------------------- arg parsing

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const positional = argv.filter(a => !a.startsWith('--') && !a.startsWith('{'));
const jsonIdx = argv.indexOf('--json');
const optOverride = jsonIdx >= 0 && argv[jsonIdx + 1] ? JSON.parse(argv[jsonIdx + 1]) : {};

const SEED = Number(positional[0]) || 1;
const WIDTH = Number(positional[1]) || 60;
const HEIGHT = Number(positional[2]) || 50;

// ---------------------------------------------------------------- generation

function generate(seed, w, h, options = {}) {
    ROT.RNG.setSeed(seed);
    const a = new Architect({ width: w, height: h });
    a.generateProceduralMap({ type: 'palladian', options });
    return a;
}

// Classify a cell for rendering. Wall variants collapse to one class so the
// symmetry check compares structure, not the wall_types weighted roll.
function buildGrid(a, w, h) {
    const g = Array.from({ length: h }, () => new Array(w).fill(' '));
    const put = (x, y, ch) => { if (y >= 0 && y < h && x >= 0 && x < w) g[y][x] = ch; };

    for (const t of a.walkableTiles) put(t.x, t.y, '.');
    for (const p of a.pendingWallSpawns) {
        if (p.type === 'metal_wall') put(p.x, p.y, 'M');
        else if (p.type === 'column') put(p.x, p.y, 'I');
        else if (p.type === 'fortification') put(p.x, p.y, 'W');
        else put(p.x, p.y, '#');
    }
    for (const p of a.pendingPushableWallSpawns) put(p.x, p.y, 'P');
    for (const p of a.pendingTorchSpawns) put(p.x, p.y, 't');
    for (const p of a.pendingDoorSpawns) put(p.x, p.y, '+');
    return g;
}

// For symmetry: torches and pushable walls are per-room / 2%-global random rolls
// and legitimately asymmetric. Everything else must mirror exactly.
const SYM_EXEMPT = new Set(['t', 'P']);
const symClass = (ch) => {
    if (SYM_EXEMPT.has(ch)) return '?';
    if (ch === '#' || ch === 'M') return '#';   // wall material is a weighted roll
    if (ch === '+' ) return '.';                // doorChance roll; the gap is what matters
    return ch;
};

// ---------------------------------------------------------------- invariants

function check(a, w, h, label) {
    const g = buildGrid(a, w, h);
    const rooms = a.diggerRooms || [];
    const fails = [];
    const fail = (name, detail) => fails.push(`${name}: ${detail}`);

    const floor = new Set(a.walkableTiles.map(t => `${t.x},${t.y}`));
    const walls = new Set(a.pendingWallSpawns.map(p => `${p.x},${p.y}`));
    const push = new Set(a.pendingPushableWallSpawns.map(p => `${p.x},${p.y}`));
    const doors = new Set(a.pendingDoorSpawns.map(p => `${p.x},${p.y}`));
    // Torches are walls that finalize moved out of pendingWallSpawns, so they
    // still enclose the villa.
    const torches = new Set(a.pendingTorchSpawns.map(p => `${p.x},${p.y}`));

    // The generator publishes its plan for exactly this purpose; tile extents
    // can't be trusted to yield an integer axis on a degraded plan.
    const cols = a.pendingWallSpawns.filter(p => p.type === 'column');
    const axisX = a.palladianPlan ? a.palladianPlan.axisX : null;

    // 1. Bilateral symmetry — the master assertion.
    if (axisX !== null && Number.isInteger(axisX)) {
        let bad = null, count = 0;
        for (let y = 0; y < h && !bad; y++) {
            for (let x = 0; x < w; x++) {
                const mx = 2 * axisX - x;
                if (mx < 0 || mx >= w) continue;
                const A = symClass(g[y][x]), B = symClass(g[y][mx]);
                if (A === '?' || B === '?') continue;
                if (A !== B) { count++; if (!bad) bad = `(${x},${y})='${g[y][x]}' vs (${mx},${y})='${g[y][mx]}'`; }
            }
        }
        if (bad) fail('symmetry', `${count} mismatches, first ${bad} (axis x=${axisX})`);
    } else if (a.walkableTiles.length && a.palladianPlan) {
        fail('symmetry', `plan published a non-integer axis (${axisX})`);
    }
    // No plan at all means the arena fallback fired (map too small for a villa);
    // symmetry doesn't apply, but the remaining structural checks still do.

    // 2. Connectivity — one component covering every floor tile.
    if (a.walkableTiles.length) {
        const seen = new Set();
        const start = `${a.walkableTiles[0].x},${a.walkableTiles[0].y}`;
        const stack = [a.walkableTiles[0]];
        seen.add(start);
        while (stack.length) {
            const t = stack.pop();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const k = `${t.x + dx},${t.y + dy}`;
                if (seen.has(k) || !floor.has(k)) continue;
                seen.add(k);
                stack.push({ x: t.x + dx, y: t.y + dy });
            }
        }
        if (seen.size !== floor.size) {
            fail('connectivity', `${seen.size}/${floor.size} floor tiles reachable`);
        }
        for (const r of rooms) {
            let hit = false;
            for (let y = r._y1; y <= r._y2 && !hit; y++) {
                for (let x = r._x1; x <= r._x2; x++) if (seen.has(`${x},${y}`)) { hit = true; break; }
            }
            if (!hit) { fail('connectivity', `room bbox ${r._x1},${r._y1}-${r._x2},${r._y2} unreachable`); break; }
        }
    }

    // 3. No leaks: nothing on row 0, and every floor tile is fully enclosed by
    //    floor / wall / door / pushable. Catches an escape at any edge.
    if (a.walkableTiles.some(t => t.y === 0)) fail('row0', 'floor tile on row 0');
    for (const t of a.walkableTiles) {
        let leak = null;
        for (let dy = -1; dy <= 1 && !leak; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const k = `${t.x + dx},${t.y + dy}`;
                if (t.x + dx < 0 || t.x + dx >= w || t.y + dy < 0 || t.y + dy >= h) continue;
                if (!floor.has(k) && !walls.has(k) && !push.has(k) && !doors.has(k) && !torches.has(k)) leak = k;
                if (leak) break;
            }
        }
        if (leak) { fail('leak', `floor (${t.x},${t.y}) borders raw nothing at ${leak}`); break; }
    }

    // 4. Plan fits inside the reserved margin.
    const allCells = [...a.walkableTiles, ...a.pendingWallSpawns, ...a.pendingTorchSpawns];
    for (const c of allCells) {
        if (c.x < 1 || c.x > w - 2 || c.y < 1 || c.y > h - 2) {
            fail('bounds', `cell (${c.x},${c.y}) outside [1..${w - 2}]x[1..${h - 2}]`);
            break;
        }
    }

    // 5. Room shapes: at most one sanctum, bisected by the axis, and every other
    //    room exactly fills its bbox (the at-most-one-non-rectangular rule,
    //    checked geometrically rather than trusting the bookkeeping).
    const sanctums = rooms.filter(r => r.isSanctum);
    if (sanctums.length > 1) fail('shape', `${sanctums.length} sanctums (max 1)`);
    if (sanctums.length === 1 && axisX !== null) {
        const s = sanctums[0];
        if (!(s._x1 <= axisX && axisX <= s._x2)) {
            fail('shape', `sanctum ${s._x1}-${s._x2} not bisected by axis ${axisX}`);
        }
    }
    for (const r of rooms) {
        if (r.isSanctum || r.isPortico) continue;
        let missing = 0;
        for (let y = r._y1; y <= r._y2; y++) {
            for (let x = r._x1; x <= r._x2; x++) if (!floor.has(`${x},${y}`)) missing++;
        }
        // Interior wall strips between unmerged bays legitimately fall inside a
        // multi-bay bbox only for the sanctum; a plain room must be solid.
        if (missing > 0) { fail('shape', `room ${r._x1},${r._y1}-${r._x2},${r._y2} has ${missing} non-floor cells in bbox`); break; }
    }

    // 6. Every room has a door, else spawnTreasureRoom and switch puzzles see
    //    zero eligible rooms.
    for (const r of rooms) {
        let n = 0; r.getDoors(() => n++);
        if (n === 0) { fail('doors', `room ${r._x1},${r._y1}-${r._x2},${r._y2} has no doors`); break; }
    }

    // 7. Colonnade: symmetric about the axis, none on it, all on one row.
    if (cols.length) {
        const ys = new Set(cols.map(c => c.y));
        if (ys.size !== 1) fail('colonnade', `columns on ${ys.size} rows`);
        if (cols.length % 2 !== 0) fail('colonnade', `${cols.length} columns (must be even so the axis is a gap)`);
        if (cols.some(c => c.x === axisX)) fail('colonnade', `a column sits on the axis x=${axisX}`);
        const xs = cols.map(c => c.x).sort((p, q) => p - q);
        for (let i = 0, j = xs.length - 1; i < j; i++, j--) {
            if (xs[i] + xs[j] !== 2 * axisX) { fail('colonnade', `pair ${xs[i]}/${xs[j]} not symmetric about ${axisX}`); break; }
        }
    }

    // 8. Regions publish correctly and only reference real floor.
    const regions = a.namedRegions || {};
    if (sanctums.length === 1) {
        if (!regions.sanctum || !regions.sanctum.length) fail('regions', 'sanctum region missing/empty');
        else if (regions.sanctum.some(t => !floor.has(`${t.x},${t.y}`))) fail('regions', 'sanctum region includes non-floor');
        const idx = rooms.findIndex(r => r.isSanctum);
        if (!a.claimedRoomIndices.has(idx)) fail('regions', `sanctum index ${idx} not claimed`);
    }
    for (const [name, tiles] of Object.entries(regions)) {
        if (tiles.some(t => !floor.has(`${t.x},${t.y}`))) { fail('regions', `region "${name}" includes non-floor`); break; }
    }

    return { g, fails, rooms, axisX, cols, floorCount: floor.size };
}

// ---------------------------------------------------------------- rendering

function render(res, w, h, a) {
    const { g, axisX } = res;
    const lines = g.map(row => row.join(''));
    console.log(lines.join('\n'));
    if (axisX !== null && Number.isInteger(axisX)) {
        console.log(' '.repeat(axisX) + '^ axis x=' + axisX);
    }
    console.log('');
    console.log('legend  . floor   # wall   M metal_wall   I column   W window(fortification)');
    console.log('        + door    t torch  P pushable');
    const sanct = res.rooms.find(r => r.isSanctum);
    console.log(`rooms ${res.rooms.length}   floor ${res.floorCount}   ` +
        `sanctum ${sanct ? `${sanct.shape} @ ${sanct._x1},${sanct._y1}-${sanct._x2},${sanct._y2}` : 'none'}   ` +
        `columns ${res.cols.length}   ` +
        `regions [${Object.keys(a.namedRegions || {}).join(', ') || 'none'}]`);
}

// Print each established sight-line row/column with blockers marked, so the
// enfilade is eyeballable. ASCII shows this better than the game does.
function renderEnfilade(res, w, h) {
    const { g, axisX } = res;
    console.log('\n--- enfilade: rows with an unbroken run through 3+ rooms ---');
    for (let y = 0; y < h; y++) {
        const row = g[y];
        let run = 0, best = 0, gaps = 0;
        for (let x = 0; x < w; x++) {
            const c = row[x];
            if (c === '.' || c === '+') { run++; best = Math.max(best, run); }
            else if (c === 'W' || c === 'I') { run++; }        // see-through
            else { if (run > 0) gaps++; run = 0; }
        }
        if (best >= Math.floor(w * 0.45)) console.log(`y=${String(y).padStart(3)} ${row.join('')}`);
    }
    if (axisX !== null) {
        let col = '';
        for (let y = 0; y < h; y++) col += g[y][axisX];
        console.log(`\naxial (x=${axisX}, read top-to-bottom): ${col}`);
    }
}

// ---------------------------------------------------------------- main

if (flags.has('--fuzz')) {
    const sizes = [[10, 10], [14, 9], [20, 20], [40, 30], [60, 50], [100, 100]];
    const pathological = [
        { bayColumns: [9, 9], bayWidth: [15, 16], bayHeight: [15, 16] },
        { bayColumns: [1, 1], bayRows: [1, 1] },
        { mergeChance: 100, sanctumChance: 100 },
        { mergeChance: 0, sanctumChance: 0 },
        { porticoStyle: 'none' },
        { porticoStyle: 'in_antis', porticoDepth: 8 },
        { columnSpacing: 0 },
        { sanctumShapes: ['tee'] },
        { sanctumShapes: ['eye'] },
        { sanctumShapes: ['cross'] },
    ];
    let runs = 0, bad = 0;
    const seen = new Map();
    for (const [w, h] of sizes) {
        for (let seed = 1; seed <= 60; seed++) {
            const variants = [{}, pathological[seed % pathological.length]];
            for (const opts of variants) {
                runs++;
                let a;
                try { a = generate(seed, w, h, opts); }
                catch (e) { bad++; console.error(`THROW ${w}x${h} seed ${seed} ${JSON.stringify(opts)}: ${e.message}`); continue; }
                if (!a.walkableTiles.length) { bad++; console.error(`EMPTY ${w}x${h} seed ${seed} ${JSON.stringify(opts)}`); continue; }
                const res = check(a, w, h, `${w}x${h}#${seed}`);
                for (const f of res.fails) {
                    bad++;
                    const kind = f.split(':')[0];
                    if (!seen.has(kind)) seen.set(kind, []);
                    if (seen.get(kind).length < 3) {
                        seen.get(kind).push(`${w}x${h} seed ${seed} ${JSON.stringify(opts)} -> ${f}`);
                    }
                }
            }
        }
    }
    console.log(`fuzz: ${runs} runs, ${bad} failures`);
    for (const [kind, examples] of seen) {
        console.log(`\n[${kind}]`);
        for (const e of examples) console.log('  ' + e);
    }
    process.exit(bad ? 1 : 0);
}

const a = generate(SEED, WIDTH, HEIGHT, optOverride);
const res = check(a, WIDTH, HEIGHT, 'single');
console.log(`palladian  seed ${SEED}  ${WIDTH}x${HEIGHT}  ${JSON.stringify(optOverride)}\n`);
render(res, WIDTH, HEIGHT, a);
if (flags.has('--enfilade')) renderEnfilade(res, WIDTH, HEIGHT);
console.log('');
if (res.fails.length) {
    for (const f of res.fails) console.log('FAIL  ' + f);
    process.exit(1);
}
console.log('PASS  all invariants');
