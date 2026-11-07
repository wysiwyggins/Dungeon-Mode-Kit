/**
 * workspace-sw.js: serves editor workspaces to the game, for playtesting.
 *
 * A request for prototypes/ws~<name>/<file> is answered from the workspace in
 * the Origin Private File System (dmk/workspaces/<name>/<file>, written by
 * editors/scripts/workspace.js), so ?prototype=ws~<name> runs a workspace with
 * no engine changes. Every other request goes to the network untouched.
 *
 * It caches nothing: each request reads the file as it is now, so a playtest
 * reload always sees the latest edits. Missing files get a 404, which is what
 * the engine's fallbacks expect (no map.tmj means a generated map, no
 * actors.json means the shared library alone). HEAD is answered as well as
 * GET, since that's how the engine checks for an authored map.
 *
 * Registered only when a page asks for a ws~ prototype (core/workspace-playtest.js),
 * so normal play never installs it. It lives at the kit root because a
 * service worker can only control pages at or below its own folder.
 */

const WORKSPACE_ROOT = ['dmk', 'workspaces'];
const NAME_RE = /^[a-z0-9_]+$/;   // same rule as Workspace.isValidName

const TYPES = {
    json: 'application/json',
    tmj: 'application/json',
    tsj: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    txt: 'text/plain; charset=utf-8',
};

// Take over at once, including pages already open, so a playtest tab doesn't
// need a second reload before the workspace is served.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A page that was hard-reloaded isn't controlled even though this worker is
// active; it asks to be claimed (see ensureWorkspaceServer).
self.addEventListener('message', (event) => {
    if (event.data === 'claim') event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    const prefix = new URL('prototypes/ws~', self.registration.scope).pathname;
    if (!url.pathname.startsWith(prefix)) return;

    event.respondWith(serve(url.pathname.slice(prefix.length), request.method === 'HEAD'));
});

/** rest is "<name>/<path…>", still percent-encoded. */
async function serve(rest, headOnly) {
    let parts;
    try {
        parts = rest.split('/').map(decodeURIComponent);
    } catch {
        return notFound();
    }
    const [name, ...path] = parts;
    if (!NAME_RE.test(name) || !path.length || path.some(p => !p || p === '.' || p === '..')) {
        return notFound();
    }

    let file;
    try {
        let dir = await navigator.storage.getDirectory();
        for (const part of [...WORKSPACE_ROOT, name, ...path.slice(0, -1)]) {
            dir = await dir.getDirectoryHandle(part);
        }
        file = await (await dir.getFileHandle(path[path.length - 1])).getFile();
    } catch (e) {
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return notFound();
        console.error('[workspace-sw]', e);
        return new Response(String(e.message || e), { status: 500 });
    }

    const ext = path[path.length - 1].split('.').pop().toLowerCase();
    return new Response(headOnly ? null : file, {
        status: 200,
        headers: {
            'Content-Type': TYPES[ext] || 'application/octet-stream',
            'Content-Length': String(file.size),
            'Cache-Control': 'no-store',
        },
    });
}

function notFound() {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
