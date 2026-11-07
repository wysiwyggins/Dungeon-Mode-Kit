/**
 * Playtesting editor workspaces: a prototype named "ws~<name>" is served from
 * the browser's file storage by the service worker in workspace-sw.js, instead
 * of from the prototypes/ folder. The engine loads it like any other prototype;
 * the page only has to make sure the worker controls it first.
 */

import { BASE_PATH } from './util.js';

export const WORKSPACE_PREFIX = 'ws~';

export function isWorkspacePrototype(name) {
    return typeof name === 'string' && name.startsWith(WORKSPACE_PREFIX);
}

/**
 * Register workspace-sw.js and wait until it controls this page, so the
 * prototype's requests reach it. Throws with a readable message if it can't.
 */
export async function ensureWorkspaceServer() {
    const sw = navigator.serviceWorker;
    if (!sw || !window.isSecureContext) {
        throw new Error('Playtesting a workspace needs a service worker, which only runs over https or localhost.');
    }

    await sw.register(`${BASE_PATH}/workspace-sw.js`, { scope: `${BASE_PATH}/` });
    if (sw.controller) return;

    // A first visit is controlled once the new worker activates and claims it.
    // A hard reload (shift-reload) bypasses an already-active worker, so ask it
    // to claim this page.
    const controlled = new Promise(resolve => sw.addEventListener('controllerchange', resolve, { once: true }));
    const ready = await sw.ready;
    if (sw.controller) return;
    ready.active.postMessage('claim');

    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The workspace service worker did not take control of the page. Try reloading.')), 5000);
    });
    try {
        await Promise.race([controlled, timeout]);
    } finally {
        clearTimeout(timer);
    }
}
