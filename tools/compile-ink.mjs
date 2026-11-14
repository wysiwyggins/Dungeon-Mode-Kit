/**
 * Compile ink dialogue to the JSON the engine loads.
 *
 *   npm run ink                      every .ink under prototypes/
 *   npm run ink -- path/to/a.ink     just these files
 *
 * Each foo.ink is written to foo.json beside it. Exporting JSON from Inky does
 * the same job; this is for working without it. Files that are only INCLUDEd
 * by others still compile on their own, so keep shared fragments in a folder
 * or file name starting with "_" to have them skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Compiler, CompilerOptions } from 'inkjs/compiler/Compiler';

function findInk(dir) {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...findInk(full));
        else if (entry.name.endsWith('.ink')) found.push(full);
    }
    return found;
}

/** Lets INCLUDE lines resolve relative to the including file. */
function fileHandler(rootDir) {
    return {
        ResolveInkFilename: (name) => path.resolve(rootDir, name),
        LoadInkFileContents: (fullName) => fs.readFileSync(fullName, 'utf8'),
    };
}

const files = process.argv.length > 2 ? process.argv.slice(2) : findInk('prototypes');
let failed = 0;

for (const file of files) {
    const issues = [];
    const options = new CompilerOptions(
        file, [], false,
        (message, type) => issues.push({ message, type }),
        fileHandler(path.dirname(file)),
    );
    let json = null;
    try {
        const story = new Compiler(fs.readFileSync(file, 'utf8'), options).Compile();
        json = story?.ToJson() ?? null;
    } catch (e) {
        issues.push({ message: e.message, type: 2 });
    }
    // ErrorType: 0 author note, 1 warning, 2 error.
    for (const { message, type } of issues) {
        console.log(`${type === 2 ? 'error' : type === 1 ? 'warning' : 'note'}: ${message}`);
    }
    if (!json || issues.some(i => i.type === 2)) {
        console.log(`✗ ${file}`);
        failed++;
        continue;
    }
    const out = file.replace(/\.ink$/, '.json');
    fs.writeFileSync(out, json + '\n');
    console.log(`✓ ${file} → ${out}`);
}

if (!files.length) console.log('No .ink files found.');
process.exitCode = failed ? 1 : 0;
