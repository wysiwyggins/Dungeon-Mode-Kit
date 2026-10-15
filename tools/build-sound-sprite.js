#!/usr/bin/env node
//
// Compile the Howler.js audio sprite from the per-sound source files.
//
//   node tools/build-sound-sprite.js             # rebuild sprite + data/sounds.json
//   node tools/build-sound-sprite.js --dry-run   # list what would be packed, write nothing
//   node tools/build-sound-sprite.js --out /tmp/sprite --json /tmp/sprite.json
//
// Reads every audio file in assets/audio/source/ (alphabetical). Each filename,
// minus extension, becomes the sprite ID. Writes:
//
//   assets/audio/sounds.mp3 / .ac3 / .m4a   the concatenated sprite
//   data/sounds.json                       Howler sprite map read by sound.js
//
// Requires ffmpeg on PATH. No npm dependencies, so a future server-side sound
// manager can require() buildSoundSprite() directly.
//
// Layout matches the old ../audiosprite-master pipeline (`--format howler2`,
// 1s gap, each sound starting on a whole second), so rebuilding unchanged sources
// gives the same sprite offsets.
//
// Ported from audiosprite by Tõnis Tiigi (https://github.com/tonistiigi/audiosprite):
//
//   Copyright (c) 2012 Tõnis Tiigi
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//   THE SOFTWARE.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

const DEFAULTS = {
    sourceDir: path.join(ROOT, 'assets/audio/source'),
    outputBase: path.join(ROOT, 'assets/audio/sounds'),  // extension added per format
    jsonFile: path.join(ROOT, 'data/sounds.json'),
    urlPrefix: '/assets/audio/',                          // sound.js prepends BASE_PATH to leading-slash URLs
    formats: ['mp3', 'ac3', 'm4a'],
    gap: 1,                // seconds of silence after each sound
    roundToSecond: true,   // start every sound on a whole-second boundary
    bitrate: 128,
    samplerate: 44100,
    channels: 1
};

const SOURCE_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aif', '.aiff', '.flac'];

// ffmpeg encoder args per output format (from audiosprite)
function formatArgs(ext, opts) {
    const br = opts.bitrate + 'k';
    return {
        mp3: ['-ar', opts.samplerate, '-f', 'mp3', '-ab', br],
        ac3: ['-acodec', 'ac3', '-ab', br],
        m4a: ['-ab', br, '-strict', '-2'],
        ogg: ['-acodec', 'libvorbis', '-f', 'ogg', '-ab', br],
        webm: ['-acodec', 'libvorbis', '-f', 'webm', '-dash', '1', '-ab', br],
        wav: []
    }[ext];
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args.map(String));
        const chunks = [];
        let stderr = '';
        proc.stdout.on('data', d => chunks.push(d));
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('error', reject);
        proc.on('close', code => {
            if (code) reject(new Error(`${cmd} exited ${code}\n${stderr.split('\n').slice(-5).join('\n')}`));
            else resolve(Buffer.concat(chunks));
        });
    });
}

function listSources(sourceDir) {
    return fs.readdirSync(sourceDir)
        .filter(f => SOURCE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
        .sort()
        .map(f => ({ id: path.basename(f, path.extname(f)), file: path.join(sourceDir, f) }));
}

// Build the sprite. Returns the Howler sprite map object that was written.
async function buildSoundSprite(options = {}) {
    const opts = { ...DEFAULTS, ...options };
    const log = opts.log || (() => {});

    const sources = listSources(opts.sourceDir);
    if (!sources.length) throw new Error(`No audio files found in ${opts.sourceDir}`);

    const dupes = sources.map(s => s.id).filter((id, i, all) => all.indexOf(id) !== i);
    if (dupes.length) throw new Error(`Duplicate sound IDs (same name, different extension): ${dupes.join(', ')}`);

    await run('ffmpeg', ['-version']).catch(() => {
        throw new Error('ffmpeg was not found on your PATH');
    });

    // Decode each source to raw 16-bit PCM and concatenate with silence padding
    const bytesPerSecond = opts.samplerate * opts.channels * 2;
    const silence = seconds => Buffer.alloc(Math.round(bytesPerSecond * seconds));
    const pcmParts = [];
    const sprite = {};
    let cursor = 0;

    for (const { id, file } of sources) {
        const pcm = await run('ffmpeg', ['-i', file, '-ar', opts.samplerate, '-ac', opts.channels, '-f', 's16le', 'pipe:']);
        const duration = pcm.length / bytesPerSecond;
        sprite[id] = [cursor * 1000, duration * 1000];
        log(`  ${id.padEnd(20)} ${duration.toFixed(3)}s @ ${cursor}s`);

        const pad = (opts.roundToSecond ? Math.ceil(duration) - duration : 0) + opts.gap;
        pcmParts.push(pcm, silence(pad));
        cursor += duration + pad;
    }

    const tempFile = path.join(os.tmpdir(), `dmk-sound-sprite-${process.pid}.pcm`);
    fs.writeFileSync(tempFile, Buffer.concat(pcmParts));

    try {
        fs.mkdirSync(path.dirname(opts.outputBase), { recursive: true });
        const urls = [];
        for (const ext of opts.formats) {
            const args = formatArgs(ext, opts);
            if (!args) throw new Error(`Unsupported format: ${ext}`);
            const outFile = `${opts.outputBase}.${ext}`;
            await run('ffmpeg', ['-y', '-ar', opts.samplerate, '-ac', opts.channels, '-f', 's16le', '-i', tempFile, ...args, outFile]);
            urls.push(opts.urlPrefix + path.basename(outFile));
            log(`Exported ${path.relative(ROOT, outFile)}`);
        }

        const json = { urls, sprite };
        fs.mkdirSync(path.dirname(opts.jsonFile), { recursive: true });
        fs.writeFileSync(opts.jsonFile, JSON.stringify(json, null, 2));
        log(`Wrote ${path.relative(ROOT, opts.jsonFile)} (${sources.length} sounds)`);
        return json;
    } finally {
        fs.unlinkSync(tempFile);
    }
}

module.exports = { buildSoundSprite, listSources, DEFAULTS };

if (require.main === module) {
    const argv = process.argv.slice(2);
    const flag = name => {
        const i = argv.indexOf(name);
        return i === -1 ? undefined : argv[i + 1];
    };

    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 20).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
        process.exit(0);
    }

    const options = { log: console.log };
    if (flag('--source')) options.sourceDir = path.resolve(flag('--source'));
    if (flag('--out')) options.outputBase = path.resolve(flag('--out'));
    if (flag('--json')) options.jsonFile = path.resolve(flag('--json'));

    if (argv.includes('--dry-run')) {
        const sources = listSources(options.sourceDir || DEFAULTS.sourceDir);
        sources.forEach(s => console.log(`  ${s.id.padEnd(20)} ${path.relative(ROOT, s.file)}`));
        console.log(`${sources.length} sounds`);
        process.exit(0);
    }

    buildSoundSprite(options).catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}
