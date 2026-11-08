/* =========================================================================
   proto-workspace.js — the prototype editor's workspace controls
   -------------------------------------------------------------------------
   Header wiring for workspaces (scripts/workspace.js): pick / New… dialog
   (blank, from a server prototype, or duplicating a workspace) / import zip /
   download zip / delete, plus autosave of prototype.json
   and reacting to other editor tabs' writes. Classic script in the shared
   global scope; loaded after proto-sections.js, before proto-render.js, whose
   init() calls initWorkspaceUI().
   ========================================================================= */
"use strict";

const SAVE_DELAY_MS = 400;
let saveTimer = null;

function setStatus(msg) {
    document.getElementById('load-status').textContent = msg || '';
}

/* ---------------------------------------------------------------------
   Autosave
   --------------------------------------------------------------------- */
function isDirty() {
    return !!(state.proto && state.protoName)
        && JSON.stringify(serialize(), null, 2) !== state.savedText;
}

/* Called from commit() on every model change; saves shortly after the last one. */
function scheduleSave() {
    if (!isDirty()) return;
    clearTimeout(saveTimer);
    setStatus('unsaved changes…');
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

/* Write prototype.json now if it has changed. Safe to call any time; callers
   await it before switching workspaces so a pending save can't land in the
   wrong one. */
async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!isDirty()) return;
    const out = serialize();
    const text = JSON.stringify(out, null, 2);
    try {
        await Workspace.writeJSON('prototype.json', out);
        state.savedText = text;
        setStatus('saved to workspace ' + state.protoName);
    } catch (e) {
        console.error(e);
        setStatus('save failed: ' + e.message);
    }
}

/* ---------------------------------------------------------------------
   Storage meter
   --------------------------------------------------------------------- */
function formatBytes(bytes) {
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${i ? bytes.toFixed(1) : bytes} ${units[i]}`;
}

/* How much browser storage this site uses (workspaces and saved games), and
   whether the browser has agreed to keep it. Unless it has, it may clear
   everything when space runs low, so the downloaded zip is the real copy. */
async function updateStorageMeter() {
    const meter = document.getElementById('storage-meter');
    const keep = document.getElementById('btn-keep-storage');
    if (!navigator.storage?.estimate) return;
    const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
        navigator.storage.estimate(),
        navigator.storage.persisted ? navigator.storage.persisted() : false,
    ]);
    meter.textContent = `storage: ${formatBytes(usage)} of ${formatBytes(quota)}, `
        + (persisted ? 'kept' : 'may be cleared');
    meter.title = persisted
        ? 'The browser has agreed to keep this storage until you clear it. A downloaded zip is still the safest copy.'
        : 'The browser may clear this storage when space runs low. Download a zip to keep your work.';
    keep.hidden = persisted || !navigator.storage.persist;
}

async function keepStorage() {
    const granted = await navigator.storage.persist().catch(() => false);
    if (!granted) setStatus('the browser declined to keep storage — download a zip to keep your work');
    await updateStorageMeter();
}

/* ---------------------------------------------------------------------
   Picker
   --------------------------------------------------------------------- */
async function refreshWorkspaceSelect() {
    const sel = document.getElementById('workspace-select');
    const names = await Workspace.list();
    for (const opt of [...sel.options]) if (opt.value !== '') opt.remove();
    for (const name of names) sel.appendChild(el('option', { value: name }, name));
    sel.value = state.protoName && names.includes(state.protoName) ? state.protoName : '';
    updateWorkspaceButtons();
    EditorNav.setWorkspace(state.protoName);
    updateStorageMeter();
    return names;
}

function updateWorkspaceButtons() {
    const open = !!state.protoName;
    for (const id of ['btn-export-zip', 'btn-delete-ws', 'btn-copy']) {
        document.getElementById(id).disabled = !open;
    }
}

async function switchWorkspace(name) {
    await saveNow();
    try {
        await loadWorkspace(name);
        setStatus(name ? 'opened ' + name : '');
    } catch (e) {
        console.error(e);
        await loadWorkspace('');
        setStatus(e.message);
    }
    await refreshWorkspaceSelect();
}

/* Ask for a workspace (folder) name until it's valid and unused. Returns null
   on cancel. */
async function askWorkspaceName(message, suggestion = '') {
    let name = suggestion;
    for (;;) {
        name = window.prompt(message, name);
        if (name == null) return null;
        name = name.trim();
        if (!Workspace.isValidName(name)) {
            message = 'Use only lowercase letters, digits and _ (this becomes the prototype\'s folder name):';
        } else if (await Workspace.exists(name)) {
            message = `A workspace named "${name}" already exists. Choose another name:`;
        } else {
            return name;
        }
    }
}

/* Turn arbitrary text (a zip file name) into a valid name suggestion. */
function suggestName(text) {
    return String(text || '').toLowerCase().replace(/\.zip$/, '')
        .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'prototype';
}

/* ---------------------------------------------------------------------
   Actions
   --------------------------------------------------------------------- */
/* "my_pac" -> "My Pac": a display name for prototype.json from a folder name. */
function titleFromName(name) {
    return name.split('_').filter(Boolean)
        .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/* New… dialog. Source values: 'blank', 'server:<proto>', 'ws:<workspace>'. */
let newNameEdited = false; // stop following the source once the user types a name

function sourceName(source) {
    return source === 'blank' ? '' : source.slice(source.indexOf(':') + 1);
}

async function openNewDialog() {
    const sel = document.getElementById('new-ws-source');
    sel.replaceChildren(el('option', { value: 'blank' }, 'Blank prototype'));
    const group = (label, prefix, names) => {
        if (!names.length) return;
        const g = el('optgroup', { label });
        for (const n of names) g.appendChild(el('option', { value: prefix + n }, n));
        sel.appendChild(g);
    };
    group('Server prototypes', 'server:', state.prototypeNames);
    group('Your workspaces (duplicate)', 'ws:', await Workspace.list());
    sel.value = 'blank';
    newNameEdited = false;
    document.getElementById('new-ws-name').value = '';
    await validateNewDialog();
    document.getElementById('new-ws-dialog').showModal();
    document.getElementById('new-ws-source').focus();
}

/* Check the name and say where it will end up; enables Create only when valid.
   Returns the name, or null. Guarded against out-of-order async checks. */
let validateSeq = 0;
async function validateNewDialog() {
    const seq = ++validateSeq;
    const name = document.getElementById('new-ws-name').value.trim();
    const hint = document.getElementById('new-ws-hint');
    const create = document.getElementById('new-ws-create');
    let msg, ok = false;
    if (!name) msg = 'Choose a folder name.';
    else if (!Workspace.isValidName(name)) msg = 'Use only lowercase letters, digits and _.';
    else if (await Workspace.exists(name)) msg = `You already have a workspace named "${name}".`;
    else { ok = true; msg = `Unzips to prototypes/${name}/`; }
    if (seq !== validateSeq) return null;
    hint.textContent = msg;
    hint.classList.toggle('error', !ok && !!name);
    create.disabled = !ok;
    return ok ? name : null;
}

async function createFromDialog() {
    const name = await validateNewDialog();
    if (!name) return;
    const source = document.getElementById('new-ws-source').value;
    const from = sourceName(source);
    const create = document.getElementById('new-ws-create');
    create.disabled = true;
    document.getElementById('new-ws-hint').textContent = 'creating…';
    await saveNow();
    try {
        if (source === 'blank') {
            await Workspace.create(name, { 'prototype.json': { ...blankPrototype(), name: titleFromName(name) } });
        } else if (source.startsWith('server:')) {
            await Workspace.copyFromServer(from, name);
        } else {
            await Workspace.duplicate(from, name);
        }
    } catch (e) {
        console.error(e);
        document.getElementById('new-ws-hint').textContent = e.message;
        create.disabled = false;
        return;
    }
    document.getElementById('new-ws-dialog').close();
    await switchWorkspace(name);
    // A copy under a new folder name gets its own title, so two copies don't
    // show the same name in game. Goes through the normal autosave.
    if (from && name !== from && state.proto) {
        state.proto.name = titleFromName(name);
        render();
        commit();
    }
    setStatus(source === 'blank' ? 'created ' + name
        : `created ${name} from ${source.startsWith('ws:') ? 'workspace' : 'server prototype'} ${from}`);
}

async function importZipFile(file) {
    let zip;
    try { zip = await Workspace.readZip(file); }
    catch (e) { console.error(e); setStatus('import failed: ' + e.message); return; }
    let name = zip.name;
    if (!Workspace.isValidName(name) || await Workspace.exists(name)) {
        const why = !name ? 'The zip has no top-level folder.'
            : !Workspace.isValidName(name) ? `"${name}" isn't a valid folder name.`
                : `You already have a workspace named "${name}".`;
        name = await askWorkspaceName(why + ' Name for the imported workspace:', suggestName(name || file.name));
        if (!name) return;
    }
    await saveNow();
    try { await Workspace.create(name, zip.files); }
    catch (e) { console.error(e); setStatus('import failed: ' + e.message); return; }
    await switchWorkspace(name);
    setStatus('imported ' + name);
}

async function exportWorkspaceZip() {
    if (!state.protoName) return;
    await saveNow();
    try {
        Workspace.download(await Workspace.exportZip(state.protoName), state.protoName + '.zip');
        setStatus('downloaded ' + state.protoName + '.zip — unzip it into prototypes/');
    } catch (e) { console.error(e); setStatus('export failed: ' + e.message); }
}

async function deleteWorkspace() {
    const name = state.protoName;
    if (!name) return;
    if (!window.confirm(`Delete workspace "${name}"? This can't be undone. Download a zip first if you want to keep it.`)) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try { await Workspace.remove(name); }
    catch (e) { console.error(e); setStatus('delete failed: ' + e.message); return; }
    await loadWorkspace('');
    await refreshWorkspaceSelect();
    setStatus('deleted ' + name);
}

/* ---------------------------------------------------------------------
   Other tabs
   --------------------------------------------------------------------- */
async function onWorkspaceChange({ workspace, file }) {
    if (!workspace || workspace !== state.protoName) return;
    if (file === 'prototype.json') {
        // Another prototype editor tab saved. Don't clobber local edits.
        if (isDirty()) {
            setStatus('prototype.json was changed in another tab; saving here will overwrite it');
            return;
        }
        const floor = state.activeFloor;
        await loadWorkspace(workspace);
        if (floor !== 'proto' && floor <= totalFloors()) { state.activeFloor = floor; render(); }
        setStatus('reloaded — prototype.json changed in another tab');
    } else if (['actors.json', 'items.json', 'biomes.json'].includes(file)) {
        await reloadWorkspaceData();
        setStatus('reloaded ' + file + ' — changed in another tab');
    } else if (file?.endsWith('.tmj')) {
        await refreshMapFiles();
        render();
    }
}

/* ---------------------------------------------------------------------
   Wiring
   --------------------------------------------------------------------- */
async function initWorkspaceUI() {
    const controls = document.getElementById('workspace-controls');
    if (!Workspace.supported() || !window.isSecureContext) {
        for (const c of controls.querySelectorAll('select, button')) c.disabled = true;
        document.getElementById('empty-hint').textContent =
            'Workspaces need browser file storage (OPFS), which is only available over https or localhost in a current browser.';
        return;
    }

    document.getElementById('workspace-select')
        .addEventListener('change', e => switchWorkspace(e.target.value));
    // The game reads the files, so a pending autosave has to land first.
    EditorNav.onBeforePlaytest(saveNow);

    document.getElementById('btn-new-ws').addEventListener('click', openNewDialog);
    const dialog = document.getElementById('new-ws-dialog');
    const nameInput = document.getElementById('new-ws-name');
    document.getElementById('new-ws-source').addEventListener('change', (e) => {
        if (!newNameEdited) nameInput.value = sourceName(e.target.value);
        validateNewDialog();
    });
    nameInput.addEventListener('input', () => {
        newNameEdited = nameInput.value.trim() !== '';
        validateNewDialog();
    });
    document.getElementById('new-ws-form').addEventListener('submit', (e) => {
        e.preventDefault();
        createFromDialog();
    });
    document.getElementById('new-ws-cancel').addEventListener('click', () => dialog.close());
    const zipInput = document.getElementById('zip-input');
    document.getElementById('btn-import-zip').addEventListener('click', () => zipInput.click());
    zipInput.addEventListener('change', async () => {
        const file = zipInput.files[0];
        zipInput.value = '';
        if (file) await importZipFile(file);
    });
    document.getElementById('btn-export-zip').addEventListener('click', exportWorkspaceZip);
    document.getElementById('btn-delete-ws').addEventListener('click', deleteWorkspace);
    document.getElementById('btn-keep-storage').addEventListener('click', keepStorage);

    Workspace.onChange(onWorkspaceChange);
    // Flush the debounce when the tab is hidden or closed.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveNow();
    });
    window.addEventListener('beforeunload', (e) => {
        if (saveTimer) { saveNow(); e.preventDefault(); }
    });

    // Reopen whatever this browser was last working on (or ?workspace=).
    const names = await refreshWorkspaceSelect();
    const last = Workspace.current();
    if (last && names.includes(last)) await switchWorkspace(last);
}
