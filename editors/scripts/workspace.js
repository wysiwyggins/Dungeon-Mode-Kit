/* =========================================================================
   workspace.js — prototype workspaces in the Origin Private File System
   -------------------------------------------------------------------------
   A workspace is a folder at OPFS dmk/workspaces/<name>/ laid out exactly like
   a prototype folder (prototype.json, actors.json, map.tmj, sheets…). OPFS
   belongs to the origin, not the page, so every editor page sees the same
   files: that's how an edit in one editor reaches the others. The workspace
   name is the folder name the exported zip unpacks to under prototypes/.
   See docs/EDITOR_WORKSPACE.md.

   Classic script defining one global, `Workspace`. Needs lib/fflate.min.js
   (global `fflate`) for exportZip/importZip only.

   The active workspace is localStorage 'dmk.workspace', overridden by a
   ?workspace=<name> URL parameter. File functions act on the workspace passed
   to open().

   Writes to one file are serialized with a Web Lock named after it, and every
   write is announced on BroadcastChannel('dmk-workspace') as
   { workspace, file } so other open editors can re-read it. BroadcastChannel
   doesn't deliver to the page that posted, so a page never hears its own saves.
   ========================================================================= */
"use strict";

const Workspace = (() => {
    const ROOT_PATH = ['dmk', 'workspaces'];
    const CURRENT_KEY = 'dmk.workspace';
    const NAME_RE = /^[a-z0-9_]+$/;

    // Every file the engine reads from a prototype folder (engine/prototype.js
    // loadAssets + floors.js loadPrototypeConfig). All optional but prototype.json.
    const DATA_FILES = [
        'actors.json', 'items.json', 'personalities.json', 'vfx.json',
        'keybindings.json', 'biomes.json', 'animations.json', 'types.json',
        'spells.json', 'states.json',
    ];

    // Junk that zip tools and Finder add; never imported or exported.
    const IGNORED = /(^|\/)(\.DS_Store|__MACOSX(\/|$)|Thumbs\.db$)/;

    const channel = typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('dmk-workspace') : null;

    let active = null; // name of the workspace open()ed on this page

    /* ---------------------------------------------------------------------
       Support / names
       --------------------------------------------------------------------- */
    function supported() {
        return !!(navigator.storage && navigator.storage.getDirectory);
    }

    function isValidName(name) { return typeof name === 'string' && NAME_RE.test(name); }

    function checkName(name) {
        if (!isValidName(name)) {
            throw new Error(`"${name}" isn't a valid workspace name: use lowercase letters, digits and _ (it becomes the prototype's folder name).`);
        }
    }

    /* The active workspace for this page: ?workspace= wins over localStorage. */
    function current() {
        const fromUrl = new URLSearchParams(location.search).get('workspace');
        if (fromUrl) return fromUrl;
        return localStorage.getItem(CURRENT_KEY) || '';
    }

    /* Remember `name` as the active workspace. If the page was opened with
       ?workspace=, rewrite it too, or a reload would jump back to the old one. */
    function setCurrent(name) {
        if (name) localStorage.setItem(CURRENT_KEY, name);
        else localStorage.removeItem(CURRENT_KEY);
        const url = new URL(location.href);
        if (url.searchParams.has('workspace')) {
            if (name) url.searchParams.set('workspace', name);
            else url.searchParams.delete('workspace');
            history.replaceState(history.state, '', url);
        }
    }

    /* ---------------------------------------------------------------------
       Directory handles
       --------------------------------------------------------------------- */
    async function rootDir() {
        if (!supported()) throw new Error('This browser has no Origin Private File System, so workspaces are unavailable.');
        let dir = await navigator.storage.getDirectory();
        for (const part of ROOT_PATH) dir = await dir.getDirectoryHandle(part, { create: true });
        return dir;
    }

    async function workspaceDir(name, create = false) {
        checkName(name);
        return (await rootDir()).getDirectoryHandle(name, { create });
    }

    async function exists(name) {
        if (!isValidName(name)) return false;
        try { await workspaceDir(name); return true; }
        catch { return false; }
    }

    function splitPath(path) {
        const parts = String(path).split('/').filter(Boolean);
        if (!parts.length || parts.some(p => p === '.' || p === '..')) {
            throw new Error(`Bad workspace file path "${path}"`);
        }
        return parts;
    }

    /* File handle for a path like "actors.json" or "sheets/hero.png" inside a
       workspace. Returns null when it doesn't exist and create is false. */
    async function fileHandle(ws, path, create = false) {
        const parts = splitPath(path);
        let dir = await workspaceDir(ws);
        try {
            for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
            return await dir.getFileHandle(parts[parts.length - 1], { create });
        } catch (e) {
            if (!create && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null;
            throw e;
        }
    }

    function requireActive() {
        if (!active) throw new Error('No workspace is open.');
        return active;
    }

    /* ---------------------------------------------------------------------
       Workspace lifecycle
       --------------------------------------------------------------------- */
    async function list() {
        if (!supported()) return [];
        const out = [];
        for await (const [name, handle] of (await rootDir()).entries()) {
            if (handle.kind === 'directory') out.push(name);
        }
        return out.sort();
    }

    /* Make `name` the open workspace for this page and remember it. */
    async function open(name) {
        if (!(await exists(name))) throw new Error(`No workspace named "${name}".`);
        active = name;
        setCurrent(name);
        return name;
    }

    function close() { active = null; }

    function openName() { return active; }

    /* Create a new workspace from a { path: contents } map. Contents may be a
       string, Blob, ArrayBuffer/typed array, or a plain object (written as JSON). */
    async function create(name, files = {}) {
        checkName(name);
        if (await exists(name)) throw new Error(`A workspace named "${name}" already exists.`);
        await workspaceDir(name, true);
        try {
            for (const [path, contents] of Object.entries(files)) {
                await writeRaw(name, path, toWritable(contents));
            }
        } catch (e) {
            // Don't leave a half-built workspace behind.
            await remove(name).catch(() => {});
            throw e;
        }
        requestPersist();
        return name;
    }

    async function remove(name) {
        checkName(name);
        await (await rootDir()).removeEntry(name, { recursive: true });
        if (active === name) active = null;
        if (localStorage.getItem(CURRENT_KEY) === name) setCurrent('');
    }

    /* Ask the browser not to evict OPFS under storage pressure. Best effort:
       browsers may grant it silently, prompt, or refuse. */
    let persistAsked = false;
    function requestPersist() {
        if (persistAsked || !navigator.storage?.persist) return;
        persistAsked = true;
        navigator.storage.persist().catch(() => {});
    }

    /* ---------------------------------------------------------------------
       Raw file IO
       --------------------------------------------------------------------- */
    function toWritable(contents) {
        if (contents instanceof Blob || contents instanceof ArrayBuffer
            || ArrayBuffer.isView(contents) || typeof contents === 'string') return contents;
        return JSON.stringify(contents, null, 2) + '\n';
    }

    async function writeRaw(ws, path, data) {
        const handle = await fileHandle(ws, path, true);
        if (typeof handle.createWritable !== 'function') {
            throw new Error('This browser can\'t write files to workspace storage (createWritable is missing). Try updating it, or use Chrome or Firefox.');
        }
        const w = await handle.createWritable();
        try { await w.write(data); }
        finally { await w.close(); }
    }

    async function readFile(ws, path) {
        const handle = await fileHandle(ws, path);
        return handle ? handle.getFile() : null;
    }

    /* Recursive list of file paths in a workspace ("map.tmj", "sheets/a.png"). */
    async function listFiles(name = requireActive()) {
        const out = [];
        async function walk(dir, prefix) {
            for await (const [entry, handle] of dir.entries()) {
                const path = prefix + entry;
                if (handle.kind === 'directory') await walk(handle, path + '/');
                else out.push(path);
            }
        }
        await walk(await workspaceDir(name), '');
        return out.sort();
    }

    /* ---------------------------------------------------------------------
       Locking + change notification
       --------------------------------------------------------------------- */
    function withLock(ws, file, fn) {
        if (!navigator.locks) return fn();
        return navigator.locks.request(`dmk:${ws}/${file}`, fn);
    }

    function announce(ws, file) {
        channel?.postMessage({ workspace: ws, file });
    }

    /* Subscribe to writes made by other pages. cb({ workspace, file }). */
    function onChange(cb) {
        channel?.addEventListener('message', e => cb(e.data || {}));
    }

    /* ---------------------------------------------------------------------
       Public file API (acts on the open workspace)
       --------------------------------------------------------------------- */
    /* Parsed JSON, or `fallback` when the file is missing, empty (some
       prototypes ship 0-byte files) or not valid JSON. */
    async function readJSON(file, fallback = {}) {
        const f = await readFile(requireActive(), file);
        if (!f) return fallback;
        const text = await f.text();
        if (!text.trim()) return fallback;
        try { return JSON.parse(text); }
        catch (e) {
            console.warn(`Workspace ${active}: ${file} is not valid JSON`, e);
            return fallback;
        }
    }

    /* Replace a whole file. Use this only for a file the page owns outright
       (the prototype editor and prototype.json); entry-level edits to shared
       files go through putEntry/removeEntry. */
    async function writeJSON(file, obj) {
        const ws = requireActive();
        await withLock(ws, file, () => writeRaw(ws, file, toWritable(obj)));
        announce(ws, file);
    }

    /* Re-read the file, set one top-level key, write it back — under the file's
       lock, so two tabs editing different entries can't lose each other's work. */
    async function putEntry(file, key, obj) {
        const ws = requireActive();
        await withLock(ws, file, async () => {
            const data = await readJSON(file, {});
            data[key] = obj;
            await writeRaw(ws, file, toWritable(data));
        });
        announce(ws, file);
    }

    async function removeEntry(file, key) {
        const ws = requireActive();
        let changed = false;
        await withLock(ws, file, async () => {
            const data = await readJSON(file, {});
            if (!(key in data)) return;
            delete data[key];
            changed = true;
            await writeRaw(ws, file, toWritable(data));
        });
        if (changed) announce(ws, file);
    }

    /* A File (a Blob with a name), or null if missing. */
    async function readBlob(file) {
        return readFile(requireActive(), file);
    }

    async function writeBlob(file, blob) {
        const ws = requireActive();
        await withLock(ws, file, () => writeRaw(ws, file, blob));
        announce(ws, file);
    }

    /* Delete one file from the open workspace. A missing file is fine. */
    async function removeFile(file) {
        const ws = requireActive();
        const parts = splitPath(file);
        let removed = false;
        await withLock(ws, file, async () => {
            let dir = await workspaceDir(ws);
            try {
                for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
                await dir.removeEntry(parts[parts.length - 1]);
                removed = true;
            } catch (e) {
                if (e.name !== 'NotFoundError') throw e;
            }
        });
        if (removed) announce(ws, file);
    }

    /* Copy every file of workspace `src` into a new workspace `name`. */
    async function duplicate(src, name) {
        checkName(name);
        if (await exists(name)) throw new Error(`A workspace named "${name}" already exists.`);
        const files = {};
        for (const path of await listFiles(src)) {
            files[path] = new Uint8Array(await (await readFile(src, path)).arrayBuffer());
        }
        return create(name, files);
    }

    /* ---------------------------------------------------------------------
       Copy from server
       --------------------------------------------------------------------- */
    /* Fetch prototypes/<proto>/ into a new workspace. A static server can't
       list a folder, so this collects what the engine would read: prototype.json,
       the optional data files, maps found the engine's way (map.tmj, then
       <floor>.tmj, probed up to the floor count), the cutscene flipbook, and the
       animation sheets named in animations.json. Files are copied byte-for-byte
       so an untouched workspace exports identical to the original. */
    async function copyFromServer(proto, name = proto, base = '../prototypes/') {
        checkName(name);
        if (await exists(name)) throw new Error(`A workspace named "${name}" already exists.`);
        const url = path => `${base}${encodeURIComponent(proto)}/${path}`;
        const getBytes = async (path) => {
            try {
                const r = await fetch(url(path), { cache: 'no-store' });
                return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
            } catch { return null; }
        };
        const parse = (bytes) => {
            try { return JSON.parse(new TextDecoder().decode(bytes)); }
            catch { return null; }
        };

        const files = {};
        const protoBytes = await getBytes('prototype.json');
        if (!protoBytes) throw new Error(`Couldn't fetch ${url('prototype.json')}.`);
        files['prototype.json'] = protoBytes;
        const cfg = parse(protoBytes) || {};

        const data = await Promise.all(DATA_FILES.map(getBytes));
        DATA_FILES.forEach((f, i) => { if (data[i]) files[f] = data[i]; });

        // Floor count, as engine floors.js / proto-state.js totalFloors().
        const floors = cfg.floors != null ? Number(cfg.floors)
            : Array.isArray(cfg.levels) ? cfg.levels.length : 1;
        const extras = ['map.tmj'];
        for (let n = 2; n <= floors; n++) extras.push(`${n}.tmj`);
        if (cfg.cutscene?.flipbook) extras.push(cfg.cutscene.flipbook);
        const anims = files['animations.json'] ? parse(files['animations.json']) || {} : {};
        for (const def of Object.values(anims)) {
            const file = typeof def === 'string' ? def : def?.file;
            if (file) extras.push(file);
        }
        // Dialogue files (compiled ink) that personalities and actors name by path,
        // as engine prototype.js loadDialogueFiles. The .ink source goes too if the
        // server has it beside the .json, so the workspace stays editable.
        for (const f of ['personalities.json', 'actors.json']) {
            const defs = files[f] ? parse(files[f]) || {} : {};
            for (const def of Object.values(defs)) {
                const dialogue = def?.dialogue ?? def?.attributes?.dialogue;
                if (typeof dialogue !== 'string' || !dialogue || extras.includes(dialogue)) continue;
                extras.push(dialogue);
                if (dialogue.endsWith('.json')) extras.push(dialogue.replace(/\.json$/, '.ink'));
            }
        }
        const extraBytes = await Promise.all(extras.map(getBytes));
        extras.forEach((f, i) => { if (extraBytes[i]) files[f] = extraBytes[i]; });

        return create(name, files);
    }

    /* ---------------------------------------------------------------------
       Zip export / import
       --------------------------------------------------------------------- */
    function requireFflate() {
        if (typeof fflate === 'undefined') throw new Error('lib/fflate.min.js is not loaded.');
        return fflate;
    }

    /* A zip Blob with one top-level <name>/ folder, so it unpacks straight
       into prototypes/. */
    /* The kit's tileset, which every map uses (tiled/static-tiles.tsj and the
       sprite sheet it names). Zips carry a copy in <name>/tiled/, so a map
       opens in Tiled wherever the zip is unzipped, not only inside the kit. */
    const TILESET_SOURCE = '../tiled/static-tiles.tsj';
    const TILESET_IMAGE_SOURCE = '../assets/sprites/static-tiles.png';
    const ZIP_TILESET = 'tiled/static-tiles.tsj';
    const ZIP_TILESET_IMAGE = 'tiled/static-tiles.png';
    const ZIP_TILESET_FILES = new Set([ZIP_TILESET, ZIP_TILESET_IMAGE]);

    /* { tsj, png } as bytes for the zip, or null if the server doesn't have them. */
    async function tilesetForZip() {
        try {
            const [tsjResponse, pngResponse] = await Promise.all([fetch(TILESET_SOURCE), fetch(TILESET_IMAGE_SOURCE)]);
            if (!tsjResponse.ok || !pngResponse.ok) throw new Error('not found');
            const tileset = await tsjResponse.json();
            tileset.image = 'static-tiles.png';   // beside it in the zip's tiled/ folder
            return {
                tsj: new TextEncoder().encode(JSON.stringify(tileset, null, 1)),
                png: new Uint8Array(await pngResponse.arrayBuffer()),
            };
        } catch (e) {
            console.warn('The zip will have no tileset: couldn\'t fetch it', e);
            return null;
        }
    }

    /* A map's tileset path, rewritten to the zip's copy. Only the text of the
       "source" value changes, so Tiled's own formatting is kept. */
    function pointMapAtZipTileset(bytes) {
        const text = new TextDecoder().decode(bytes);
        const rewritten = text.replace(/("source"\s*:\s*")[^"]*static-tiles\.tsj(")/g, `$1${ZIP_TILESET}$2`);
        return rewritten === text ? bytes : new TextEncoder().encode(rewritten);
    }

    async function exportZip(name = requireActive()) {
        const { zipSync } = requireFflate();
        const tileset = await tilesetForZip();
        const tree = {};
        for (const path of await listFiles(name)) {
            if (tileset && ZIP_TILESET_FILES.has(path)) continue;   // replaced by the current copy below
            const f = await readFile(name, path);
            let bytes = new Uint8Array(await f.arrayBuffer());
            if (tileset && path.endsWith('.tmj')) bytes = pointMapAtZipTileset(bytes);
            // Images are already compressed; store them rather than deflate again.
            const stored = /\.(png|jpe?g|gif|webp)$/i.test(path);
            tree[`${name}/${path}`] = stored ? [bytes, { level: 0 }] : bytes;
        }
        if (tileset) {
            tree[`${name}/${ZIP_TILESET}`] = tileset.tsj;
            tree[`${name}/${ZIP_TILESET_IMAGE}`] = [tileset.png, { level: 0 }];
        }
        return new Blob([zipSync(tree, { level: 6 })], { type: 'application/zip' });
    }

    /* Read a zip (File/Blob) without creating anything. Returns
       { name, files } where name is the zip's single top-level folder (or ''
       if it has none) and files maps workspace-relative paths to bytes. */
    async function readZip(blob) {
        const { unzipSync } = requireFflate();
        const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
        const paths = Object.keys(entries).filter(p => !p.endsWith('/') && !IGNORED.test(p));
        if (!paths.length) throw new Error('The zip has no files in it.');
        const tops = new Set(paths.map(p => p.split('/')[0]));
        const nested = tops.size === 1 && paths.every(p => p.includes('/'));
        const name = nested ? [...tops][0] : '';
        const files = {};
        for (const p of paths) {
            const path = nested ? p.slice(name.length + 1) : p;
            // The tileset copy an export adds isn't part of the prototype; the
            // next export adds the current one.
            if (!ZIP_TILESET_FILES.has(path)) files[path] = entries[p];
        }
        if (!('prototype.json' in files)) throw new Error('The zip has no prototype.json at its top level, so it isn\'t a prototype folder.');
        return { name, files };
    }

    /* Import a zip as a new workspace. `name` defaults to the zip's folder. */
    async function importZip(blob, name) {
        const zip = await readZip(blob);
        return create(name || zip.name, zip.files);
    }

    /* Hand a Blob to the browser as a download. */
    function download(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    return {
        DATA_FILES,
        supported, isValidName, current, setCurrent,
        list, exists, open, close, openName, create, remove, duplicate, copyFromServer,
        listFiles, readJSON, writeJSON, putEntry, removeEntry, readBlob, writeBlob, removeFile,
        exportZip, readZip, importZip, download,
        onChange,
    };
})();
