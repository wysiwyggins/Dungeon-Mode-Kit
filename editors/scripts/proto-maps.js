/* =========================================================================
   proto-maps.js — the prototype editor's Maps section: Tiled maps (.tmj) in
   the workspace
   -------------------------------------------------------------------------
   The engine finds maps by name: floor 1 is map.tmj, floor N is N.tmj, and a
   floor without one is generated (engine/dungeon-engine/floors.js). A
   cutscene's flipbook is the .tmj its prototype.json names. Maps are made in
   Tiled, not here: this uploads, downloads and removes them, and checks an
   upload for the mistakes that would break it in the engine.

   Classic script in the shared global scope; loaded after proto-workspace.js
   (setStatus), before proto-render.js.
   ========================================================================= */
"use strict";

function floorMapFile(floor) {
    return floor === 1 ? 'map.tmj' : `${floor}.tmj`;
}

/* The floor a file is the map of, or null. */
function floorOfMapFile(file) {
    if (file === 'map.tmj') return 1;
    const m = /^(\d+)\.tmj$/.exec(file);
    return m && Number(m[1]) > 1 ? Number(m[1]) : null;
}

/* Re-read which .tmj files the workspace has, and their sizes, into
   state.mapFiles (file -> { width, height } or {} if unreadable). */
async function refreshMapFiles() {
    state.mapFiles = new Map();
    if (!state.protoName) return;
    const files = (await Workspace.listFiles(state.protoName)).filter(f => !f.includes('/') && f.endsWith('.tmj'));
    for (const file of files) {
        const map = await Workspace.readJSON(file, {});
        state.mapFiles.set(file, { width: map.width, height: map.height });
    }
}

/* Problems with an uploaded map. `error` stops the upload; `warnings` don't.
   kind is 'floor' or 'cutscene'. */
function checkTiledMap(text, kind) {
    const trimmed = text.trim();
    if (trimmed.startsWith('<')) {
        return { error: 'is a .tmx (XML) map. In Tiled, use File › Export As and choose JSON map files (*.tmj).' };
    }
    let map;
    try { map = JSON.parse(trimmed); }
    catch { return { error: "isn't valid JSON." }; }
    if (!Number.isFinite(map.width) || !Number.isFinite(map.height) || !Array.isArray(map.layers)) {
        return { error: "isn't a Tiled map (it has no width, height and layers)." };
    }
    if (map.infinite) {
        return { error: 'is an infinite map. In Tiled, turn off Infinite in Map › Map Properties.' };
    }
    const tileLayers = map.layers.filter(l => l.type === 'tilelayer');
    if (tileLayers.some(l => l.encoding === 'base64' || l.compression || !Array.isArray(l.data))) {
        return { error: 'stores its tile layers compressed. In Tiled, set Tile Layer Format to CSV in Map › Map Properties.' };
    }

    const warnings = [];
    const tilesets = Array.isArray(map.tilesets) ? map.tilesets : [];
    const kitTileset = tilesets.length === 1 && tilesets[0].firstgid === 1
        && (!tilesets[0].source || tilesets[0].source.endsWith('static-tiles.tsj'));
    if (!kitTileset) {
        warnings.push("its tiles may not match the kit's: maps should use one tileset, tiled/static-tiles.tsj");
    }
    if (kind === 'cutscene') {
        if (!tileLayers.some(l => /-\d+$/.test(l.name || ''))) {
            warnings.push('it has no frame layers (tile layers named like frame-1, frame-2)');
        }
    } else if (!tileLayers.some(l => l.name === 'floor')) {
        warnings.push('it has no floor layer, so nothing on it is walkable');
    }
    return { warnings };
}

/* Ask for a .tmj file, check it and write it into the workspace as `target`. */
function chooseMapUpload(target, kind, onUploaded) {
    const input = el('input', { type: 'file', accept: '.tmj,.json,application/json' });
    input.addEventListener('change', async () => {
        const upload = input.files[0];
        if (!upload) return;
        const text = await upload.text();
        const { error, warnings = [] } = checkTiledMap(text, kind);
        if (error) {
            setStatus(`${upload.name} ${error}`);
            return;
        }
        if (state.mapFiles.has(target) && !window.confirm(`Replace ${target} with ${upload.name}?`)) return;
        try {
            await Workspace.writeBlob(target, new Blob([text], { type: 'application/json' }));
        } catch (e) {
            console.error(e);
            setStatus('upload failed: ' + e.message);
            return;
        }
        await refreshMapFiles();
        onUploaded?.();
        render();
        const named = upload.name === target ? target : `${upload.name} as ${target}`;
        setStatus(`uploaded ${named}` + (warnings.length ? `, but ${warnings.join('; ')}` : ''));
    });
    input.click();
}

async function downloadMap(file) {
    const blob = await Workspace.readBlob(file);
    if (blob) Workspace.download(blob, file);
}

async function removeMap(file, consequence) {
    if (!window.confirm(`Remove ${file} from this workspace? ${consequence}`)) return;
    try {
        await Workspace.removeFile(file);
    } catch (e) {
        console.error(e);
        setStatus('remove failed: ' + e.message);
        return;
    }
    await refreshMapFiles();
    render();
    setStatus('removed ' + file);
}

/* One map file: what it is, whether it's there, and its buttons. */
function mapFileRow(file, label, { kind = 'floor', onUploaded } = {}) {
    const info = state.mapFiles.get(file);
    const missing = kind === 'cutscene' ? 'not uploaded yet' : 'none, so this floor is generated';
    const status = info
        ? `${file}` + (info.width ? `, ${info.width}×${info.height}` : '')
        : missing;
    const upload = el('button', { title: `Upload a Tiled .tmj file as ${file}` }, info ? 'Replace…' : 'Upload…');
    upload.addEventListener('click', () => chooseMapUpload(file, kind, onUploaded));
    const row = el('div', { class: 'field-row' },
        el('label', {}, label),
        el('span', { class: info ? '' : 'status-text' }, status),
        upload);
    if (info) {
        const download = el('button', { title: `Download ${file} to edit it in Tiled` }, 'Download');
        download.addEventListener('click', () => downloadMap(file));
        const remove = el('button', { class: 'remove-btn', title: `Remove ${file} from this workspace` }, 'Remove');
        const consequence = {
            floor: 'That floor will be generated instead.',
            cutscene: 'The cutscene will have no frames.',
            other: '',
        }[kind];
        remove.addEventListener('click', () => removeMap(file, consequence));
        row.append(download, remove);
    }
    return row;
}

/* Prototype level: floor 1, every other map file the workspace has, and (for
   a multi-level prototype) a way to add a map for another floor. */
function sectionMaps() {
    const { det, body } = section('Maps');
    body.appendChild(el('div', { class: 'hint' },
        'A floor with a map uses it, and a floor without one is generated from Map generator. '
        + 'Make maps in Tiled with this prototype unzipped in the kit’s prototypes/ folder, '
        + 'so Tiled finds the tileset, then upload the .tmj here. See docs/MAP.md.'));

    const floors = new Set([1]);
    const others = [];
    for (const file of state.mapFiles.keys()) {
        const floor = floorOfMapFile(file);
        if (floor) floors.add(floor);
        else others.push(file);
    }
    const multi = isMultiLevel();
    for (const floor of [...floors].sort((a, b) => a - b)) {
        const beyond = floor > totalFloors() ? ' (past the last floor)' : '';
        body.appendChild(mapFileRow(floorMapFile(floor), (multi ? `Floor ${floor}` : 'Map') + beyond));
    }

    if (multi) {
        const floorInput = el('input', { type: 'number', min: 2, max: totalFloors(), value: 2, class: 'width-small' });
        const add = el('button', { class: 'add-btn' }, 'Upload…');
        add.addEventListener('click', () => {
            const floor = Math.round(Number(floorInput.value));
            if (!(floor >= 2 && floor <= totalFloors())) {
                setStatus(`choose a floor from 2 to ${totalFloors()}`);
                return;
            }
            chooseMapUpload(floorMapFile(floor), 'floor');
        });
        body.appendChild(el('div', { class: 'field-row' },
            el('label', {}, 'Map for floor'), floorInput, add));
    }

    // Other .tmj files: a cutscene flipbook kept from earlier, or a map named for
    // a floor the engine won't ask for (e.g. "level2.tmj").
    for (const file of others.sort()) {
        body.appendChild(mapFileRow(file, 'Other file', { kind: 'other' }));
    }
    return { det };
}

/* A floor tab: just that floor's map. */
function sectionFloorMap(floor) {
    const { det, body } = section('Map', { open: true });
    body.appendChild(mapFileRow(floorMapFile(floor), `Floor ${floor}`));
    return { det };
}
