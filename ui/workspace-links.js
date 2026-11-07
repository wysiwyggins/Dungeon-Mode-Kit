/**
 * "Your workspaces" on index.html: the prototypes made in the editors, which
 * live in browser storage (OPFS dmk/workspaces/, see editors/scripts/workspace.js),
 * each with a link to play it and one to edit it, and a note when it has a
 * saved game (dmk/saves/, see core/saved-games.js). Fills #workspace-links and
 * shows it only when there's at least one workspace.
 *
 * Reads only: nothing is created in storage just by opening the page.
 */

import { WORKSPACE_PREFIX } from '../core/workspace-playtest.js';

/** A folder under the storage root, or null if it doesn't exist yet. */
async function existingDirectory(path) {
    let dir = await navigator.storage.getDirectory();
    try {
        for (const part of path) dir = await dir.getDirectoryHandle(part);
        return dir;
    } catch {
        return null;
    }
}

async function entryNames(dir, kind) {
    const names = [];
    if (!dir) return names;
    for await (const [name, handle] of dir.entries()) {
        if (handle.kind === kind) names.push(name);
    }
    return names.sort();
}

/** The workspace's display name from its prototype.json, or null. */
async function displayName(workspaces, name) {
    try {
        const dir = await workspaces.getDirectoryHandle(name);
        const file = await (await dir.getFileHandle('prototype.json')).getFile();
        return JSON.parse(await file.text()).name || null;
    } catch {
        return null;
    }
}

function link(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    return a;
}

async function showWorkspaceLinks() {
    const section = document.getElementById('workspace-links');
    if (!section || !navigator.storage?.getDirectory || !window.isSecureContext) return;

    const workspaces = await existingDirectory(['dmk', 'workspaces']);
    const names = await entryNames(workspaces, 'directory');
    if (!names.length) return;
    const saves = new Set(await entryNames(await existingDirectory(['dmk', 'saves']), 'file'));

    const list = section.querySelector('ul');
    for (const name of names) {
        const key = WORKSPACE_PREFIX + name;
        const title = await displayName(workspaces, name);
        const item = document.createElement('li');
        item.appendChild(link(`index.html?prototype=${encodeURIComponent(key)}`, title || name));
        if (title && title !== name) item.append(` (${name})`);
        if (saves.has(`${encodeURIComponent(key)}.json`)) item.append(' — game in progress');
        item.append(' — ');
        item.appendChild(link(`editors/prototype-editor.html?workspace=${encodeURIComponent(name)}`, 'edit'));
        list.appendChild(item);
    }
    section.hidden = false;
}

showWorkspaceLinks().catch(e => console.warn('Workspace list unavailable:', e));
