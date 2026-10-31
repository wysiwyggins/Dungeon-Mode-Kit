# Editor Workspaces (Plan)

This is a planning document. Nothing in it is built yet.

## Goal

Right now the editors build JSON and copy it to the clipboard, and you paste it into files by hand. For a hosted version of Dungeon Mode Kit, someone with only a browser should be able to create a new prototype or open an existing one, edit it across all the editors, playtest it, and download it as a zip that drops straight into `prototypes/`. The proposal is to build the prototype folder in the browser's Origin Private File System (OPFS).

The main difficulty is that the editors are separate HTML pages. A change made in the actor editor has to still be there when you open the prototype editor, and the engine has to be able to run the result.

## How the Editors Work Today

Each editor page has its own copy of a `fetchJSON(url)` helper that returns `{}` on any failure. The copies live in `actor-editor.html`, `item-editor.html`, `entity-editor.html`, `vfx-editor.html`, `personality-editor.html`, `scripts/proto-state.js` and `scripts/biome-state.js`. Shared data comes from `../data/`, and prototype files come from `../prototypes/<name>/`.

The actor, item, personality and prototype editors choose a prototype with a dropdown filled from `data/prototypes.json`, because a static web server can't list a folder. That file has to be kept up to date by hand, and it has already drifted (it lists `infrastructure`, which doesn't exist, and is missing `chase_test`).

Output is clipboard only. The actor, item, personality and entity editors copy a single `"key": {...}` entry to paste into a file. The VFX editor copies a wrapped object. The biome editor copies either all of `data/biomes.json` or one biome. The prototype editor copies the whole `prototype.json`. No editor ever writes a prototype's `actors.json`, `items.json`, `personalities.json`, `vfx.json` or `states.json` as a whole, and none touch `map.tmj` or animation sheets.

The pages share no state. `localStorage` only holds UI preferences such as whether the JSON panel is hidden, and the one link between editors (the prototype editor's "Edit biomes" link) passes nothing along.

The engine reads a prototype with `fetch` from `prototypes/<name>/`. `Prototype.loadJSON` in `engine/prototype.js` loads the data files, `engine/dungeon-engine/floors.js` loads `prototype.json` and the Tiled maps, and `queueAnimationSheets` loads prototype animation sheets through PIXI. Which prototype runs is chosen by `?prototype=` in `main.js`.

## Workspaces

A workspace is a folder in OPFS at `dmk/workspaces/<name>/`, laid out exactly like a prototype folder. It holds the JSON files and also non-JSON files like `map.tmj` and PNG sheets, which the editors don't edit but have to carry through to the zip.

OPFS belongs to the site (the origin), not to a page, so every editor page on the same site sees the same files. That solves the cross-page problem without any extra machinery: the actor editor saves into the workspace's `actors.json`, and the prototype editor reads the same file when it opens.

The active workspace is stored in `localStorage` as `dmk.workspace`, so each editor opens on whatever you were last working on. A `?workspace=<name>` URL parameter overrides it, so links between editors can carry it. Workspaces are listed by reading the OPFS folder, so they don't need an index file like `prototypes.json`.

## Starting a Workspace

There are three ways to start a workspace. New blank starts from the prototype editor's existing `blankPrototype()`. Copy from server fetches a prototype's files from `prototypes/<name>/`: the list `Prototype.loadJSON` already uses, plus the map files named in its `prototype.json`. Import zip unpacks a zip that was exported earlier.

## The Workspace Module

A new `editors/scripts/workspace.js` holds all the OPFS code. It's a classic script like the other editor scripts and defines a global `Workspace`. Functions: `list`, `open`, `create`, `copyFromServer`, `remove`, `readJSON(file, fallback)`, `writeJSON(file, obj)`, `putEntry(file, key, obj)`, `removeEntry(file, key)`, `readBlob`, `writeBlob`, `exportZip` and `importZip`.

Each editor's prototype loading swaps its `fetchJSON('../prototypes/<name>/...')` calls for `Workspace.readJSON`. Shared `data/` files are still fetched from the server and are read-only in a workspace.

## What Each Editor Writes

The prototype editor writes `prototype.json`. In the actor, item and personality editors, "Copy" becomes "Save to workspace", which calls `putEntry` on the matching file. Actor overrides already merge with the base entry, so saving a full actor is still correct. The biome editor gets a workspace target and writes the workspace's `biomes.json`. The VFX editor gets a prototype selector and writes `vfx.json`.

The entity editor stays library-only, because the engine has no per-prototype `entities.json` (see Open Questions). Copy buttons stay as a fallback for editing the shared library in the repo.

## Several Tabs at Once

It's normal to have the actor editor open in one tab and the prototype editor in another, so two pages can write the same file. Saves therefore re-read the file, change one entry and write it back, instead of writing a whole file from a copy loaded earlier. Each save is wrapped in a Web Lock named after the file (`navigator.locks`), so two saves can't interleave. After writing, the page posts to `BroadcastChannel('dmk-workspace')` and the other open editors reload that file. A page with unsaved changes in its form shows a warning instead of being overwritten.

## Playtesting

The recommended approach is a service worker that answers requests for `prototypes/ws~<name>/...` from the workspace in OPFS. A workspace then runs as `?prototype=ws~<name>` with no engine changes, and it covers `loadJSON`, the maps and the PIXI loads alike. The service worker should only answer that one path prefix and cache nothing, so it can't cause another stale-cache problem like the one on iPad.

The fallback, if the service worker doesn't work out, is a small `PrototypeSource` object passed to the engine and used at the three places that read prototype files.

## Zip Files

There's no zip library in `lib/`. The options are to vendor `fflate` (small, no dependencies) or write a minimal store-only zip writer (about 100 lines plus CRC32). `fflate` is the better choice because import also needs to decompress. The zip contains one `<name>/` folder, so it unpacks straight into `prototypes/`.

## Browser Support and Risks

OPFS works in Chrome, Firefox and Safari, but Safari was late to support `createWritable` on the main page. iPad Safari should be tested first. The fallback is to do writes in a worker with `createSyncAccessHandle`.

Service workers need https or localhost. That covers both the local server and a hosted site, but not opening the files directly from disk.

The browser can clear OPFS when storage runs low. The editors should call `navigator.storage.persist()` and make it clear that the downloaded zip is the real save. Private browsing windows have small storage limits and throw everything away when closed.

## Phases

Each phase is usable on its own.

1. `workspace.js` plus the prototype editor: new, copy from server, open, export zip, import zip.
2. The actor, item and personality editors save to the workspace.
3. The biome and VFX editors save to the workspace.
4. Service worker playtesting.
5. Hosted polish, such as a workspace picker on `index.html` and a storage meter.

## Open Questions

Should entities, and other data that's only in the shared library today, become per-prototype? When the editors run locally, should they still be able to edit `data/`, for example as a "library" workspace written through the File System Access API in Chrome? Should a workspace name have to match the folder name it will unpack to? How should a hosted user make or replace `map.tmj`? Upload only, at first?

/data/ will always be read-only by designers working on their own prototypes. I should try to reduce the amount of actors and items in /data/ and make more types instead where possible.
A workspace name will match its folder.
Tmj upload first in order to replace an existing tmj, users can also manually add them to their downloaded prototype folder.
One day users will likely want to be able to host their own standalone games on itch or elsewhere so I'll need to think about that too soon.
