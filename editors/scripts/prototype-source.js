/* =========================================================================
   prototype-source.js — where the entry editors read and save a prototype
   -------------------------------------------------------------------------
   The actor, item, spell, personality, biome and VFX editors each edit one
   keyed file (actors.json, …) on top of the shared library in data/. Their Prototype
   dropdown offers base only, your workspaces (scripts/workspace.js), and the
   server's prototypes from data/prototypes.json. Server prototypes are read
   only; a workspace can be saved into, one entry at a time.

   Workspace options have the value 'ws~<name>', the same prefix the game uses
   to playtest one, so they can't collide with a server prototype's folder name.

   Classic script defining one global, `PrototypeSource`. Load it after
   workspace.js and before the page's own script.
   ========================================================================= */
"use strict";

const PrototypeSource = (() => {
    const PREFIX = 'ws~';
    const SAVED_FLASH_MS = 1500;

    const serverCache = new Map();   // url -> Promise of parsed JSON
    const objectURLs = [];           // blob URLs handed out for the open workspace
    const chooseListeners = [];      // fn(workspace name) after the prototype changes
    let selected = '';               // '' (base only), a server name, or 'ws~<name>'

    /* Parsed JSON, or {} when the file is missing, empty or not valid JSON. */
    async function fetchJSON(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) return {};
            const text = await response.text();
            return text.trim() ? JSON.parse(text) : {};
        } catch {
            return {};
        }
    }

    function workspacesAvailable() {
        return typeof Workspace !== 'undefined' && Workspace.supported() && window.isSecureContext;
    }

    /* The open workspace's name, or '' when the page shows base only or a
       server prototype. */
    function workspace() {
        return selected.startsWith(PREFIX) ? selected.slice(PREFIX.length) : '';
    }

    function addGroup(select, label, values, text = v => v) {
        if (!values.length) return;
        const group = document.createElement('optgroup');
        group.label = label;
        for (const value of values) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text(value);
            group.appendChild(option);
        }
        select.appendChild(group);
    }

    /* Fill the dropdown and open the active workspace if it's still there.
       Returns the selected value. */
    async function populate(select) {
        const [workspaces, index] = await Promise.all([
            workspacesAvailable() ? Workspace.list() : [],
            fetchJSON('../data/prototypes.json'),
        ]);
        const servers = Array.isArray(index.prototypes) ? index.prototypes : [];
        select.innerHTML = '<option value="">— base only —</option>';
        addGroup(select, 'Workspaces', workspaces.map(name => PREFIX + name), v => v.slice(PREFIX.length));
        addGroup(select, 'Server prototypes (read only)', servers);
        const last = workspacesAvailable() ? Workspace.current() : '';
        select.value = last && workspaces.includes(last) ? PREFIX + last : '';
        await choose(select.value);
        return select.value;
    }

    /* Make `value` the page's prototype. */
    async function choose(value) {
        while (objectURLs.length) URL.revokeObjectURL(objectURLs.pop());
        selected = value || '';
        const name = workspace();
        if (name) await Workspace.open(name);
        else if (typeof Workspace !== 'undefined') {
            // Forget the remembered workspace too (as the prototype editor does),
            // or the next page load would reopen it over "base only".
            Workspace.close();
            Workspace.setCurrent('');
        }
        EditorNav.setWorkspace(name);
        for (const fn of chooseListeners) fn(name);
    }

    /* Run fn(workspace name or '') whenever the page's prototype changes. */
    function onChoose(fn) {
        chooseListeners.push(fn);
    }

    /* One of the prototype's files, or {} for base only. Server files are
       cached, since they can't change while the page is open; workspace files
       are read fresh, since another tab may have saved into them. */
    async function readJSON(file) {
        if (!selected) return {};
        if (workspace()) return Workspace.readJSON(file, {});
        const url = `../prototypes/${selected}/${file}`;
        if (!serverCache.has(url)) serverCache.set(url, fetchJSON(url));
        return serverCache.get(url);
    }

    /* A URL an <img> can load one of the prototype's files from, or null. */
    async function fileURL(file) {
        if (!selected) return null;
        if (!workspace()) return `../prototypes/${selected}/${file}`;
        const blob = await Workspace.readBlob(file);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        objectURLs.push(url);
        return url;
    }

    /* Wire a Save button (and Ctrl/Cmd+S) to save(), which writes into the open
       workspace and returns the text to flash on the button ('Saved' if it
       returns nothing). The button is disabled unless a workspace is open. */
    function bindSaveButton(button, description, save) {
        const label = button.textContent;
        const update = (name) => {
            button.disabled = !name;
            button.title = name
                ? `${description} in workspace ${name}`
                : 'Pick one of your workspaces under Prototype to save into it';
        };
        onChoose(update);
        update(workspace());

        const flash = (text) => {
            button.textContent = text;
            setTimeout(() => { button.textContent = label; }, SAVED_FLASH_MS);
        };
        const run = async () => {
            if (!workspace()) return;
            try {
                flash(await save() || 'Saved');
            } catch (e) {
                console.error(e);
                flash('Save failed');
            }
        };
        button.addEventListener('click', run);
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                run();
            }
        });
    }

    /* A Save button that writes the form's one entry into `file`. entry()
       returns [key, object]; onSaved(key, object) runs after the write. */
    function bindSave(button, file, entry, onSaved) {
        bindSaveButton(button, `Write this entry into ${file}`, async () => {
            const [key, object] = entry();
            if (!key) return 'Needs a key';
            await Workspace.putEntry(file, key, object);
            await onSaved(key, object);
        });
    }

    /* Run fn(file) when another tab writes one of `files` in the open workspace. */
    function onExternalChange(files, fn) {
        if (typeof Workspace === 'undefined') return;
        Workspace.onChange(({ workspace: name, file }) => {
            if (name && name === workspace() && files.includes(file)) fn(file);
        });
    }

    return { fetchJSON, populate, choose, onChoose, workspace, readJSON, fileURL, bindSaveButton, bindSave, onExternalChange };
})();
