/* =========================================================================
   proto-workspace.js — the prototype editor's workspace controls
   -------------------------------------------------------------------------
   Header wiring for workspaces (scripts/workspace.js): pick / new / copy from
   server / import zip / download zip / delete, plus autosave of prototype.json
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
   Picker
   --------------------------------------------------------------------- */
async function refreshWorkspaceSelect() {
    const sel = document.getElementById('workspace-select');
    const names = await Workspace.list();
    for (const opt of [...sel.options]) if (opt.value !== '') opt.remove();
    for (const name of names) sel.appendChild(el('option', { value: name }, name));
    sel.value = state.protoName && names.includes(state.protoName) ? state.protoName : '';
    updateWorkspaceButtons();
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
async function newWorkspace() {
    const name = await askWorkspaceName('Folder name for the new prototype (lowercase letters, digits, _):');
    if (!name) return;
    await saveNow();
    try {
        await Workspace.create(name, { 'prototype.json': blankPrototype() });
    } catch (e) { setStatus(e.message); return; }
    await switchWorkspace(name);
    setStatus('created ' + name);
}

async function copyServerPrototype(proto) {
    let name = proto;
    if (!Workspace.isValidName(name) || await Workspace.exists(name)) {
        name = await askWorkspaceName(
            `You already have a workspace named "${proto}". Name for the copy:`, suggestName(proto + '_copy'));
        if (!name) return;
    }
    await saveNow();
    setStatus('copying ' + proto + '…');
    try {
        await Workspace.copyFromServer(proto, name);
    } catch (e) { console.error(e); setStatus(e.message); return; }
    await switchWorkspace(name);
    setStatus('copied ' + proto + (name !== proto ? ' as ' + name : '') + ' from the server');
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

    populatePrototypeSelect('server-select');
    document.getElementById('workspace-select')
        .addEventListener('change', e => switchWorkspace(e.target.value));
    document.getElementById('btn-new-ws').addEventListener('click', newWorkspace);
    document.getElementById('server-select').addEventListener('change', async (e) => {
        const proto = e.target.value;
        e.target.value = '';
        if (proto) await copyServerPrototype(proto);
    });
    const zipInput = document.getElementById('zip-input');
    document.getElementById('btn-import-zip').addEventListener('click', () => zipInput.click());
    zipInput.addEventListener('change', async () => {
        const file = zipInput.files[0];
        zipInput.value = '';
        if (file) await importZipFile(file);
    });
    document.getElementById('btn-export-zip').addEventListener('click', exportWorkspaceZip);
    document.getElementById('btn-delete-ws').addEventListener('click', deleteWorkspace);

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
