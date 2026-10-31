#!/usr/bin/env node
//
// Resolved item-definition dump, for proving a data refactor changed nothing.
//
//   node tools/item-golden.mjs > /tmp/before.json
//   ...move fields between items.json / types.json / spells.json...
//   node tools/item-golden.mjs > /tmp/after.json
//   diff /tmp/before.json /tmp/after.json && echo IDENTICAL
//
// Runs every item id through the real Prototype.getItemData (type inheritance,
// spell expansion, prototype overrides), once for the base data and once per
// prototype that ships an items.json, types.json or spells.json. Category ids
// that roll a random member are skipped: their output depends on the RNG.

import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Prototype } from '../engine/prototype.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// An empty file (some prototypes ship a placeholder) reads as the fallback.
const readJSON = (path, fallback) => {
    const text = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
    return text ? JSON.parse(text) : fallback;
};

const globalItems = readJSON(join(ROOT, 'data/items.json'), {});
const globalTypes = readJSON(join(ROOT, 'data/types.json'), {});
const globalSpells = readJSON(join(ROOT, 'data/spells.json'), {});

function resolveAll(protoDir) {
    const local = name => protoDir ? readJSON(join(protoDir, name), {}) : {};
    const proto = new Prototype('golden', {}, {});
    proto.items = { ...globalItems, ...local('items.json') };
    proto.types = { ...globalTypes, ...local('types.json') };
    proto.spells = { ...globalSpells, ...local('spells.json') };
    const out = {};
    for (const id of Object.keys(proto.items).sort()) {
        const def = proto.items[id];
        if (Array.isArray(def.random_type) && def.random_type.length) continue;
        out[id] = proto.getItemData(id);
    }
    return out;
}

// Key order is not part of the contract, so sort it away before printing.
const sortKeys = value => Array.isArray(value) ? value.map(sortKeys)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]))
        : value;

const result = { base: resolveAll(null) };
const protoRoot = join(ROOT, 'prototypes');
for (const name of readdirSync(protoRoot).sort()) {
    const dir = join(protoRoot, name);
    if (['items.json', 'types.json', 'spells.json'].some(f => existsSync(join(dir, f)))) {
        result[name] = resolveAll(dir);
    }
}

console.log(JSON.stringify(sortKeys(result), null, 2));
