# Editor Workspaces (Plan)

This is a planning document. Phases 1 and 2 (`workspace.js`, the prototype editor, editor navigation and the New dialog) are built; the rest is not.

## Goal

Right now the editors build JSON and copy it to the clipboard, and you paste it into files by hand. For a hosted version of Dungeon Mode Kit, someone with only a browser should be able to create a new prototype or open an existing one, edit it across all the editors, playtest it, and download it as a zip that drops straight into `prototypes/`. The proposal is to build the prototype folder in the browser's Origin Private File System (OPFS).

The main difficulty is that the editors are separate HTML pages. A change made in the actor editor has to still be there when you open the prototype editor, and the engine has to be able to run the result.

## How the Editors Work Today

Each editor page has its own copy of a `fetchJSON(url)` helper that returns `{}` on any failure. The copies live in `actor-editor.html`, `item-editor.html`, `spell-editor.html`, `entity-editor.html`, `vfx-editor.html`, `personality-editor.html`, `scripts/proto-state.js` and `scripts/biome-state.js`. Shared data comes from `../data/`, and prototype files come from `../prototypes/<name>/`.

The actor, item, spell, personality and prototype editors choose a prototype with a dropdown filled from `data/prototypes.json`, because a static web server can't list a folder. That file has to be kept up to date by hand, and it had already drifted (it listed `infrastructure`, which doesn't exist, and was missing `plate_puzzle`).

Output is clipboard only. The actor, item, spell, personality and entity editors copy a single `"key": {...}` entry to paste into a file. The VFX editor copies a wrapped object. The biome editor copies either all of `data/biomes.json` or one biome. The prototype editor copies the whole `prototype.json`. No editor ever writes a prototype's `actors.json`, `items.json`, `personalities.json`, `vfx.json` or `states.json` as a whole, and none touch `map.tmj` or animation sheets.

The pages share no state. `localStorage` only holds UI preferences such as whether the JSON panel is hidden, and the one link between editors (the prototype editor's "Edit biomes" link) passes nothing along.

The engine reads a prototype with `fetch` from `prototypes/<name>/`. `Prototype.loadJSON` in `engine/prototype.js` loads ten optional data files (`actors`, `items`, `personalities`, `vfx`, `keybindings`, `biomes`, `animations`, `types`, `spells`, `states`), `engine/dungeon-engine/floors.js` loads `prototype.json` and the Tiled maps, and `queueAnimationSheets` loads prototype animation sheets through PIXI. Which prototype runs is chosen by `?prototype=` in `main.js`.

Maps aren't named in `prototype.json`. The engine finds them by convention: it sends a `HEAD` request for `map.tmj` (floor 1) or `<floor>.tmj` (later floors), and generates a map if there isn't one. The only file `prototype.json` names is `cutscene.flipbook`. Prototype animation sheets are the `file` values in `animations.json` (for example `pac-animation.png`). Some prototypes ship 0-byte JSON files, which the engine and editors both treat as empty.

## Workspaces

A workspace is a folder in OPFS at `dmk/workspaces/<name>/`, laid out exactly like a prototype folder. It holds the JSON files and also non-JSON files like `map.tmj` and PNG sheets, which the editors don't edit but have to carry through to the zip.

OPFS belongs to the site (the origin), not to a page, so every editor page on the same site sees the same files. That solves the cross-page problem without any extra machinery: the actor editor saves into the workspace's `actors.json`, and the prototype editor reads the same file when it opens.

The active workspace is stored in `localStorage` as `dmk.workspace`, so each editor opens on whatever you were last working on. A `?workspace=<name>` URL parameter overrides it, so links between editors can carry it. Workspaces are listed by reading the OPFS folder, so they don't need an index file like `prototypes.json`.

## Starting a Workspace

There are three ways to start a workspace. New blank starts from the prototype editor's existing `blankPrototype()`. Copy from server fetches a prototype's files from `prototypes/<name>/`: `prototype.json` and the list `Prototype.loadJSON` already uses, then probes for `map.tmj` and `2.tmj` up to the floor count, and copies the cutscene flipbook and any animation sheets. Import zip unpacks a zip that was exported earlier.

### Starting From a Server Prototype

A designer will often want an existing prototype as the starting point for a new one, under a new name. New and Copy from server are therefore one New dialog with two fields:

- **Start from:** Blank, any server prototype from `data/prototypes.json`, or any existing workspace, which duplicates it.
- **Name:** the folder name. It defaults to the source's name, or is left empty for Blank.

When the new name differs from the source, the copy's display `name` in `prototype.json` is changed to match (`my_pac` becomes "My Pac"), so two copies don't show the same title in game. Every file is still copied byte-for-byte, and only `prototype.json` is rewritten. Duplicating a workspace copies every file in it, which is simpler than probing the server because OPFS can list a folder.

## The Workspace Module

A new `editors/scripts/workspace.js` holds all the OPFS code. It's a classic script like the other editor scripts and defines a global `Workspace`. Functions: `list`, `open`, `create`, `copyFromServer`, `remove`, `readJSON(file, fallback)`, `writeJSON(file, obj)`, `putEntry(file, key, obj)`, `removeEntry(file, key)`, `readBlob`, `writeBlob`, `exportZip` and `importZip`.

Each editor's prototype loading swaps its `fetchJSON('../prototypes/<name>/...')` calls for `Workspace.readJSON`. Shared `data/` files are still fetched from the server and are read-only in a workspace.

## What Each Editor Writes

The prototype editor writes `prototype.json`. In the actor, item, spell and personality editors, "Copy" becomes "Save to workspace", which calls `putEntry` on the matching file. Actor overrides already merge with the base entry, so saving a full actor is still correct. The biome editor gets a workspace target and writes the workspace's `biomes.json`. The VFX editor gets a prototype selector and writes `vfx.json`.

The entity editor stays library-only, because the engine has no per-prototype `entities.json` (see Open Questions). Copy buttons stay as a fallback for editing the shared library in the repo.

## Navigating Between Editors

Every editor page has the same small nav bar from `editors/scripts/editor-nav.js`, included as the first thing in `<body>`. The bar does three things:

- It links to each editor page, with the current page marked and `?workspace=<name>` added to each link.
- It shows the active workspace's name, so you can always see which prototype you're editing. Only pages that load `workspace.js` show it, and they set it with `EditorNav.setWorkspace(name)`.
- It has a Playtest link (next section).

Because the active workspace is also in `localStorage`, a page opened without the parameter still lands on the same workspace. The nav carries it anyway, so a link opened in another tab doesn't depend on that. The bar is the way around the editors, although `index.html` keeps its links. The vfx editor, which `index.html` doesn't link to, is included. Editors that don't use workspaces yet (entity, sound player) get the nav without a workspace name.

## Several Tabs at Once

It's normal to have the actor editor open in one tab and the prototype editor in another, so two pages can write the same file. Saves therefore re-read the file, change one entry and write it back, instead of writing a whole file from a copy loaded earlier. Each save is wrapped in a Web Lock named after the file (`navigator.locks`), so two saves can't interleave. After writing, the page posts to `BroadcastChannel('dmk-workspace')` and the other open editors reload that file. A page with unsaved changes in its form shows a warning instead of being overwritten.

## Playtesting

The recommended approach is a service worker that answers requests for `prototypes/ws~<name>/...` from the workspace in OPFS. A workspace then runs as `?prototype=ws~<name>` with no engine changes, and it covers `loadJSON`, the maps and the PIXI loads alike. It has to answer `HEAD` as well as `GET`, because that's how the engine checks for a map, and return 404 for missing files so the engine's fallbacks still work. The service worker should only answer that one path prefix and cache nothing, so it can't cause another stale-cache problem like the one on iPad.

The fallback, if the service worker doesn't work out, is a small `PrototypeSource` object passed to the engine and used at the three places that read prototype files.

The editors get a Playtest link in the nav bar. It opens `../index.html?prototype=ws~<name>` in a new tab, and before opening it writes any pending autosave so the game sees the latest files. Reopening the link after more edits reloads the game in that same tab (`target="dmk-playtest"`), so a playtest tab doesn't pile up per click. Until the service worker exists, the link is hidden. It might be worth a dedicated `play.html` without `index.html`'s prototype and editor lists; that's an open question.

## Saved Games

The game has no saved games today. `docs/SAVING.md` lists save slots as not implemented. `saveGameState()` covers the player, the entities and the map of the current floor, which is enough for moving between prototypes in memory but not for resuming later. A resumable save also needs:

- the other floors (`floorStates`) and the entities waiting to arrive on another floor (the pending fallen-actor, fallen-item and stair-follower queues)
- `prototypeStack`, `sealedDownFloors` and `mappedFloors`
- the current floor and its explored map
- the RNG state and the seed
- the turn and scheduler state
- anything else `cleanup()` resets

The engine's `saveGameState()`/`restoreGameState()` would grow into a full snapshot, and the snapshot would be written to OPFS.

These are permadeath games, so there's one save per prototype and no save management. The save lives at `dmk/saves/<prototype>.json`, outside the workspace folder, so it never ends up in an exported zip. A workspace playtest saves under its `ws~<name>` key, so playtesting a copy doesn't touch the server prototype's save. The save follows the usual roguelike rules:

- It's written when you change floors and when the page is hidden or closed.
- On load, the game resumes the save if there is one.
- On death or a win, the save is deleted.

A save is a snapshot of a particular version of a prototype's data. After editing, it may refer to actors that are gone or a map that has changed. So the Playtest link starts a fresh run by default, and the game offers to continue only when you open it directly. Because this is engine code, not editor code, it's written as a small module in `core/` or `engine/` that the game page uses directly, not through `workspace.js`. Both use the same `dmk/` root. Storing a save works for any prototype, including server ones and a hosted game, not just workspaces.

## Zip Files

There's no zip library in `lib/`. The options are to vendor `fflate` (small, no dependencies) or write a minimal store-only zip writer (about 100 lines plus CRC32). `fflate` is the better choice because import also needs to decompress. The zip contains one `<name>/` folder, so it unpacks straight into `prototypes/`.

## Browser Support and Risks

OPFS works in Chrome, Firefox and Safari, but Safari was late to support `createWritable` on the main page. iPad Safari should be tested first. The fallback is to do writes in a worker with `createSyncAccessHandle`.

Service workers need https or localhost. That covers both the local server and a hosted site, but not opening the files directly from disk.

The browser can clear OPFS when storage runs low. The editors should call `navigator.storage.persist()` and make it clear that the downloaded zip is the real save. Private browsing windows have small storage limits and throw everything away when closed.

## Phases

Each phase is usable on its own. Playtesting has moved up, because it's what makes editing in a workspace worth doing.

1. **Done.** `workspace.js` plus the prototype editor: new, copy from server, open, export zip, import zip.
2. **Done.** Editor navigation (`editor-nav.js`) and the unified New dialog (start from blank, a server prototype or a workspace).
3. Service worker playtesting and the Playtest link.
4. The actor, item, spell and personality editors save to the workspace.
5. The biome and VFX editors save to the workspace.
6. Saved games in OPFS, one per prototype, with a full engine snapshot.
7. Hosted polish, such as a workspace picker on `index.html` and a storage meter.

## Open Questions

Should entities, and other data that's only in the shared library today, become per-prototype? When the editors run locally, should they still be able to edit `data/`, for example as a "library" workspace written through the File System Access API in Chrome? Should a workspace name have to match the folder name it will unpack to? How should a hosted user make or replace `map.tmj`? Upload only, at first? `next_level`, `previous_level` and `intro_cutscene` name other prototypes; when playtesting `ws~<name>`, should they resolve to other workspaces or to the server's prototypes? Should Playtest use `index.html` or a dedicated `play.html`? When a saved game fails to load, for example because the prototype changed under it, should it be dropped silently or should the player be told?

/data/ will always be read-only by designers working on their own prototypes. I should try to reduce the amount of actors and items in /data/ and make more types instead where possible.
A workspace name will match its folder.
Tmj upload first in order to replace an existing tmj, users can also manually add them to their downloaded prototype folder.
One day users will likely want to be able to host their own standalone games on itch or elsewhere so I'll need to think about that too soon.
