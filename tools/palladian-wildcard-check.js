#!/usr/bin/env node
//
// Containment checks for the `palladian` WILDCARD region generator.
//
//   node tools/palladian-wildcard-check.js [seeds]
//
// The full-floor generator owns the whole map, so its invariants (symmetry about
// the axis, perimeter sealing) are checked by palladian-dump.js. The wildcard path
// has a different core contract: it must stay INSIDE its region and must not
// clobber state belonging to other generators on the same floor. That is what this
// checks, across a range of region sizes and placements.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROT = require(path.join(ROOT, 'lib/rot.js'));

const src = fs.readFileSync(path.join(ROOT, 'architect.js'), 'utf8');
const Architect = new Function('ROT', 'console', src + '\n;return Architect;')(ROT, {
    log: () => {}, warn: () => {}, error: (...a) => console.error(...a)
});

const SEEDS = Number(process.argv[2]) || 40;

// A region placed inside a larger map, with pre-existing floor around it that must
// survive untouched, plus a sentinel room from a "previous generator".
function run(seed, mapW, mapH, rx, ry, rw, rh) {
    ROT.RNG.setSeed(seed);
    const a = new Architect({ width: mapW, height: mapH });
    a.width = mapW;
    a.height = mapH;
    a.floorMap = Array.from({ length: mapH }, () => new Array(mapW).fill(null));
    a.backgroundMap = Array.from({ length: mapH }, () => new Array(mapW).fill(null));
    a.overlayMap = Array.from({ length: mapH }, () => new Array(mapW).fill(null));
    a.wildcardMap = Array.from({ length: mapH }, () => new Array(mapW).fill(null));
    a.walkableTiles = [];

    for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
            a.wildcardMap[y][x] = { type: 'palladian', tileId: 226 };   // CROWN
        }
    }

    // Sentinel: a room from an earlier generator. Must still be present afterwards.
    const sentinelRoom = { _x1: 1, _y1: 1, _x2: 2, _y2: 2 };
    a.diggerRooms = [sentinelRoom];

    a.generatePalladianAt(rx, ry, rw, rh, null);

    const fails = [];
    const inRegion = (x, y) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

    for (const t of a.walkableTiles) {
        if (!inRegion(t.x, t.y)) {
            fails.push(`floor escaped region at ${t.x},${t.y}`);
            break;
        }
    }
    for (const p of a.pendingWallSpawns) {
        if (!inRegion(p.x, p.y)) {
            fails.push(`wall escaped region at ${p.x},${p.y} (${p.type})`);
            break;
        }
    }
    for (const p of a.pendingDoorSpawns) {
        if (!inRegion(p.x, p.y)) { fails.push(`door escaped at ${p.x},${p.y}`); break; }
    }
    for (const p of a.pendingTorchSpawns) {
        if (!inRegion(p.x, p.y)) { fails.push(`torch escaped at ${p.x},${p.y}`); break; }
    }
    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            if (!inRegion(x, y) && a.floorMap[y][x]) {
                fails.push(`floorMap written outside region at ${x},${y}`);
                y = mapH; break;
            }
        }
    }

    // No metal_wall: that rule seals the edge of the world and would wall the villa
    // off from the floor it sits in.
    if (a.pendingWallSpawns.some(p => p.type === 'metal_wall')) {
        fails.push('metal_wall emitted inside a wildcard region');
    }

    // Other generators' rooms must survive.
    if (!(a.diggerRooms || []).includes(sentinelRoom)) {
        fails.push('diggerRooms clobbered: sentinel room from a prior generator was lost');
    }

    if (a.walkableTiles.length === 0) fails.push('no floor generated at all');

    return { fails, floors: a.walkableTiles.length, rooms: (a.diggerRooms || []).length };
}

const CASES = [
    // mapW, mapH, regionX, regionY, regionW, regionH
    [80, 60, 10, 8, 40, 30],
    [80, 60, 0, 0, 30, 24],       // flush against the map origin
    [80, 60, 50, 35, 29, 24],     // flush against the far corner
    [60, 40, 20, 12, 18, 14],     // small but viable
    [60, 40, 25, 18, 8, 7],       // too small -> plain-hall fallback
    [120, 90, 30, 20, 60, 45],    // large
];

let runs = 0, failures = 0;
for (const [mw, mh, rx, ry, rw, rh] of CASES) {
    for (let seed = 1; seed <= SEEDS; seed++) {
        runs++;
        let r;
        try {
            r = run(seed, mw, mh, rx, ry, rw, rh);
        } catch (e) {
            failures++;
            console.error(`seed ${seed} region ${rw}x${rh}@${rx},${ry} on ${mw}x${mh}: THREW ${e.message}`);
            continue;
        }
        if (r.fails.length) {
            failures++;
            console.error(`seed ${seed} region ${rw}x${rh}@${rx},${ry} on ${mw}x${mh}:`);
            for (const f of r.fails) console.error(`    ${f}`);
        }
    }
}

console.log(`wildcard: ${runs} runs, ${failures} failures`);
process.exit(failures ? 1 : 0);
