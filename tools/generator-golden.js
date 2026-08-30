#!/usr/bin/env node
//
// Seeded golden-map dump for every map generator.
//
//   node tools/generator-golden.js            # print a digest per generator/seed
//   node tools/generator-golden.js --full     # print the full serialized map too
//
// Purpose: prove that a refactor which is supposed to be behaviour-preserving
// (a rename, an extraction) did not change a single generated tile. Run it
// before the change, save the output, run it after, and diff.
//
//   node tools/generator-golden.js > /tmp/before.txt
//   ...refactor...
//   node tools/generator-golden.js > /tmp/after.txt
//   diff /tmp/before.txt /tmp/after.txt && echo IDENTICAL
//
// Loads the real architect.js (same trick as palladian-dump.js) so it checks the
// shipped code rather than a copy. Reads the Architect's OUTPUT structures, which
// is the contract the engine actually consumes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ROT = require(path.join(ROOT, 'lib/rot.js'));

const src = fs.readFileSync(path.join(ROOT, 'architect.js'), 'utf8');
const Architect = new Function('ROT', 'console', src + '\n;return Architect;')(ROT, {
    log: () => {}, warn: () => {}, error: () => {}
});

const FULL = process.argv.includes('--full');

// The generator name is passed through unchanged, so this same script works
// before and after a rename by listing both spellings — an unknown type falls
// through to `digger`, which would show up as a digest collision with digger.
const GENERATORS = process.argv.find(a => a.startsWith('--only='))
    ? [process.argv.find(a => a.startsWith('--only=')).slice(7)]
    : ['brogue', 'dungeon', 'palladian', 'infernal', 'digger', 'cellular',
       'uniform', 'rogue', 'arena', 'divided_maze', 'icey_maze', 'eller_maze'];

const SEEDS = [1, 7, 42];
const W = 60, H = 50;

// Everything the engine reads back out of the Architect after generation.
// Sorted where order is not itself meaningful, so an incidental reordering
// doesn't masquerade as a map change.
function snapshot(a) {
    const pending = {};
    for (const key of Object.keys(a).filter(k => /^pending[A-Za-z]+Spawns$/.test(k))) {
        pending[key] = (a[key] || []).map(p =>
            `${p.x},${p.y},${p.type || ''}`).sort();
    }
    return {
        width: a.width,
        height: a.height,
        walkable: a.walkableTiles.map(t => `${t.x},${t.y}`).sort(),
        floor: a.serializeMap().floorMap,
        rooms: (a.diggerRooms || []).length,
        namedRegions: Object.fromEntries(
            Object.entries(a.namedRegions || {}).map(([k, v]) => [k, (v || []).length])),
        pending,
    };
}

function digest(obj) {
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

let failures = 0;

for (const type of GENERATORS) {
    for (const seed of SEEDS) {
        ROT.RNG.setSeed(seed);
        const a = new Architect({ width: W, height: H });
        let snap, err = null;
        try {
            a.generateProceduralMap({ type, options: { map_width: W, map_height: H } });
            snap = snapshot(a);
        } catch (e) {
            err = e;
        }
        if (err) {
            console.log(`${type.padEnd(14)} seed ${String(seed).padEnd(4)} ERROR ${err.message}`);
            failures++;
            continue;
        }
        const counts = Object.entries(snap.pending)
            .filter(([, v]) => v.length)
            .map(([k, v]) => `${k.replace(/^pending|Spawns$/g, '')}=${v.length}`)
            .join(' ');
        console.log(
            `${type.padEnd(14)} seed ${String(seed).padEnd(4)} ${digest(snap)}  ` +
            `walkable=${String(snap.walkable.length).padEnd(5)} rooms=${String(snap.rooms).padEnd(4)} ${counts}`);
        if (FULL) console.log(JSON.stringify(snap, null, 1));
    }
}

process.exit(failures ? 1 : 0);
