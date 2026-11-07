/**
 * Saved games in the browser's file storage (OPFS), one per prototype, at
 * dmk/saves/<prototype>.json. The editors' workspaces live beside them under
 * dmk/workspaces/, so a save never ends up in an exported zip. The key is the
 * prototype the page launched, so a workspace playtest ("ws~<name>") never
 * touches the save of the server prototype it was copied from.
 *
 * These are permadeath games: the engine writes the save as you play
 * (engine/dungeon-engine/saved-games.js) and deletes it on death or a win.
 * Every function fails quietly (null / false) where storage isn't available,
 * so a game without saves still plays.
 */

const SAVES_PATH = ['dmk', 'saves'];

export function savedGamesSupported() {
    return !!(navigator.storage?.getDirectory && window.isSecureContext);
}

function fileName(key) {
    return `${encodeURIComponent(key)}.json`;
}

async function savesDirectory() {
    let dir = await navigator.storage.getDirectory();
    for (const part of SAVES_PATH) dir = await dir.getDirectoryHandle(part, { create: true });
    return dir;
}

/** The saved game for `key`, or null if there isn't a readable one. */
export async function readSavedGame(key) {
    if (!savedGamesSupported()) return null;
    try {
        const handle = await (await savesDirectory()).getFileHandle(fileName(key));
        const text = await (await handle.getFile()).text();
        return text.trim() ? JSON.parse(text) : null;
    } catch (e) {
        if (e.name !== 'NotFoundError') console.warn(`Saved game "${key}" couldn't be read`, e);
        return null;
    }
}

/** Write the saved game for `key`. Returns whether it was written. */
export async function writeSavedGame(key, snapshot) {
    if (!savedGamesSupported()) return false;
    try {
        const handle = await (await savesDirectory()).getFileHandle(fileName(key), { create: true });
        // Older Safari has no createWritable on the main thread; it then plays without saves.
        if (!handle.createWritable) return false;
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(snapshot));
        await writable.close();
        return true;
    } catch (e) {
        console.warn(`Saved game "${key}" couldn't be written`, e);
        return false;
    }
}

export async function removeSavedGame(key) {
    if (!savedGamesSupported()) return;
    try {
        await (await savesDirectory()).removeEntry(fileName(key));
    } catch (e) {
        if (e.name !== 'NotFoundError') console.warn(`Saved game "${key}" couldn't be removed`, e);
    }
}
