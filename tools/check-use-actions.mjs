#!/usr/bin/env node
//
// Check that core/use-actions.js (what the item editor offers) names exactly
// the string use_effects Actor.executeItemEffect handles, and that every
// string use_effect in the data is one of them.
//
//   node tools/check-use-actions.mjs
//
// The editor's hand-written action list once fell seven actions behind the
// engine without anything noticing; this is the something.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { USE_ACTIONS } from '../core/use-actions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'engine/actor/items.js'), 'utf8');
const body = src.slice(src.indexOf('executeItemEffect(item, effect)'), src.indexOf('getUsableItems()'));
const handled = [...body.matchAll(/case '([a-z_]+)'/g)].map(m => m[1]);
const listed = Object.keys(USE_ACTIONS);

const problems = [];
for (const name of handled) if (!listed.includes(name)) problems.push(`engine handles '${name}' but core/use-actions.js doesn't list it`);
for (const name of listed) if (!handled.includes(name)) problems.push(`core/use-actions.js lists '${name}' but the engine doesn't handle it`);

const itemFiles = [join(ROOT, 'data/items.json'), join(ROOT, 'data/types.json'),
    ...readdirSync(join(ROOT, 'prototypes')).flatMap(p => ['items.json', 'types.json'].map(f => join(ROOT, 'prototypes', p, f)))];
for (const file of itemFiles) {
    const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    if (!text) continue;
    for (const [id, def] of Object.entries(JSON.parse(text))) {
        const effect = def?.attributes?.use_effect;
        if (typeof effect === 'string' && !listed.includes(effect)) {
            problems.push(`${file.slice(ROOT.length + 1)}: '${id}' uses unknown action '${effect}'`);
        }
    }
}

if (problems.length) {
    console.log(problems.join('\n'));
    process.exit(1);
}
console.log(`OK: ${listed.length} actions, engine and registry agree, data uses only known actions.`);
