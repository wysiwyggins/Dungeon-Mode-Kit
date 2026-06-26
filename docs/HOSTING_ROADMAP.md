# Hosting Roadmap — Dungeon Mode Kit Online

*A path from the local static-file kit to a hosted, Bitsy-style web app where
anyone can make and share a roguelike prototype.*

Status: planning · Last updated: 2026-06-26

---

## Context

Today the Dungeon Mode Kit is a 100% client-side, static-file project: plain HTML
pages with global `<script>` tags (`rot.js`, `pixi.js`, `tween.js`, `howler.js`),
a single un-minified `engine.js`, served locally with `python3 -m http.server` and
"deployed" by [`deploy.sh`](../deploy.sh) copying files into a separate Jekyll
site for iframe embedding. There is no backend, database, or auth.

The long-term goal is a **hosted web application** — including the editors — where
people make their own *prototype* (a self-contained game/level variant) that
**supplements and overrides the shared `/data` baseline without being able to
change `/data`**. The model is [Bitsy](https://bitsy.org): a free, account-light
creation tool where anyone makes a little game and shares it, but oriented toward
roguelikes. We want to be **surprised by what designers make rather than be
proscriptive** (see [IDEAS.md](IDEAS.md) → Editor Tools).

**The good news: the hardest part already exists.** The supplement/override model
the whole vision rests on is already enforced at runtime. Hosting is fundamentally
a *storage, identity, and tooling* problem layered on an engine that already does
the data-isolation work. This document lays out an incremental path where each
phase is independently shippable and the early phases need **no backend at all**.

### Decisions taken (drive the phasing below)

| Decision | Choice |
|---|---|
| Identity model | **Anonymous-first, accounts soon** — launch with no accounts (shareable bundles), then add named-creator accounts as a near-term phase, not a deferred "someday." |
| First shippable share | **No backend — URL/file bundle.** Encode a whole prototype into a shareable URL hash and/or downloadable file (Bitsy's "the game *is* the data" model). Validates the create→play→share loop at zero hosting cost. |
| Custom per-prototype tiles | **Out of scope.** All prototypes keep sharing the single `static-tiles.png` spritesheet. Per-prototype/pixel-art tiles are explicitly deferred to a separate future effort (see Appendix A). |

---

## Why this is mostly tooling, not engine work

The runtime invariant — *"a prototype adds to or overrides `/data`, but can never
mutate it"* — is already true:

- **Baseline load:** [`engine.js`](../engine.js) `loadGlobalData()` (≈651–725)
  `fetch()`es the 13 `/data/*.json` files once into `engine.globalActors`,
  `engine.globalItems`, etc.
- **The merge:** `Prototype.loadAssets()` (≈2692–2725) does a shallow per-key
  spread — `this.actors = { ...engine.globalActors, ...prototypeActors }`. A
  prototype key that matches a base key **replaces** it; new keys are **added**;
  the base objects are never mutated (the spread builds a fresh object). This is
  exactly the "supplement and override, can't change `/data`" rule, already
  holding for actors, items, personalities, effects, and (nested) keybindings.
- **A prototype is already a portable bundle:** a folder of small JSON files
  (`prototype.json` + optional `actors.json` / `items.json` / `personalities.json`
  / `effects.json` / `keybindings.json`) plus Tiled maps (`map.tmj`, `2.tmj`, …).
  This single fact is what makes a no-backend Phase 1 possible.
- **The editors already emit exactly those files.** `prototype-editor.html` and
  the four entity editors mutate an in-memory copy and export the correct
  per-prototype JSON (today via clipboard / a textarea). They need a *save
  target*, not a rewrite.

So the foundations are reusable; the net-new work is persistence, share/transport,
a discovery manifest, an in-browser map editor, and (later) a gallery + accounts.

---

## Target architecture

**One line:** *Keep the no-build static client. Make a prototype a self-contained,
shareable bundle. Add persistence in a deliberately thin, swappable layer — start
with URL/file (no backend), graduate to a managed backend only when a public
gallery demands it. Never run a bespoke server; never accept user code.*

### The keystone: a `PrototypeBundle` abstraction

Define a single in-memory object that holds everything a prototype needs:

```
PrototypeBundle = {
  config:        prototype.json (object),
  actors:        actors.json overrides (object, optional),
  items:         items.json overrides (object, optional),
  personalities: personalities.json overrides (object, optional),
  effects:       effects.json overrides (object, optional),
  keybindings:   keybindings.json overrides (object, optional),
  maps:          { "1": <parsed .tmj>, "2": <parsed .tmj>, ... },
}
```

The engine currently fetches these as separate files under
`BASE_PATH/prototypes/<name>/`. The **one engine refactor the whole roadmap
depends on** is teaching `loadPrototype()` / `Prototype.loadAssets()` to accept a
bundle object as an alternative source to fetching files. After that, *where the
bundle comes from* — a folder, a URL hash, a downloaded file, or a backend — is
just a swappable source/sink. This is the highest-leverage change in the plan and
is the backbone of Phase 0.

### Persistence layers, chosen per phase

| Layer | When | Why |
|---|---|---|
| **localStorage / IndexedDB** | Phase 0 | Editors stop the copy-paste-into-files workflow; work survives a reload. No infra. |
| **URL hash + downloadable file** | Phase 1 | The Bitsy model: the prototype *is* a (compressed) data string. Zero cost, instant sharing, validates the concept. |
| **Managed backend (recommended: [Supabase](https://supabase.com))** | Phase 3 | Postgres row = prototype metadata/index; Storage bucket = bundle blob; built-in Auth (incl. anonymous) maps onto "anonymous-first → accounts soon"; Row-Level Security enforces per-user write isolation declaratively. Generous free tier; swappable behind the bundle source/sink. |

**Why a managed backend and not a Node server:** a bespoke server is a 24/7
operational liability (uptime, patching, scaling, a cost floor) and a discipline
this solo, client-side project doesn't otherwise need. A BaaS gives auth, storage,
and per-user isolation declaratively. We keep the client no-build throughout.

### How `/data` isolation survives untrusted content

The in-memory merge already prevents a prototype from mutating `/data`. Once
content is *hosted and untrusted*, the threats shift, and each is addressed:

1. **Self-breakage / shadowing.** A prototype can replace a base key with garbage —
   but only breaks *its own* session. That's acceptable and on-brand. Add a
   lightweight shape validator at load that rejects non-objects and clamps
   obviously dangerous values, surfacing errors in the editor rather than
   corrupting a run.
2. **`/data` write path.** Server-side, `/data` is read-only static files; user
   prototypes live in a separate Storage bucket where a user can only write their
   own path (RLS / storage policy). There is structurally no write path to `/data`.
3. **XSS — the real risk.** The engine renders user-supplied strings (names,
   descriptions). Before any public phase, audit every render path that touches
   prototype strings for `innerHTML` sinks and enforce text-only / sanitized
   rendering. **Prototype content is data, never code** — no `eval`, no
   user-supplied scripts; behaviors stay data-driven (the existing
   `behaviors.js` / personalities model already supports this).
4. **Resource abuse.** Enforce a bundle-size cap from Phase 1 onward.

### Host-agnostic paths (a concrete blocker to fix)

[`globals.js`](../globals.js):15 hardcodes `BASE_PATH = isLocal ? '.' : '/dungeonkit'`,
baking the deploy subpath and a local/prod hostname check into the client. For a
real host this must become configurable (relative paths + a `<base>` tag, or a
small runtime config). Relatedly, **there is no prototype-discovery manifest** —
the prototype list is hardcoded in `deploy.sh` and in `prototype-editor.html`. A
generated `prototypes.json` index (later, a backend query) must replace those
hardcoded lists.

---

## Phased roadmap

Phases 0–2 deliver a complete create→play→share loop with **no backend**. The
dependency spine is **Phase 0 (bundle abstraction) → everything else**.

### Phase 0 — Saveable editors + the `PrototypeBundle` abstraction `[foundation]`

- **Goal:** End the copy-paste-into-files workflow; let the engine load a prototype
  from a bundle, not just from fetched files.
- **Key work:**
  - Introduce `PrototypeBundle`; teach `loadPrototype()` / `Prototype.loadAssets()`
    to accept a bundle as an alternative to `fetch()`. *(engine.js)*
  - Add localStorage/IndexedDB persistence to the five editors (they already emit
    correct JSON — redirect the output, don't rewrite). *(prototype-editor.html + 4
    entity editors)*
  - Add "Export bundle" (download a single `.json`) and "Import bundle".
  - Add a generated prototype-discovery manifest to replace hardcoded lists.
- **Unlocks:** Everything — this is the spine.
- **Risk/effort:** Low risk, medium effort. No new infra. Riskiest piece is the
  loader refactor; it's contained and testable locally.

### Phase 1 — Bitsy-style shareable bundles `[no backend]`

- **Goal:** Anyone makes a prototype and shares it via URL or file — no account, no
  server.
- **Key work:**
  - Compress a bundle (e.g. LZ-string) into a URL hash (`#proto=…`) and/or a
    downloadable `.dmk`/`.json`.
  - Add "Open from URL / file" to the player; extend the existing prototype
    selector (`?prototype=` / data-attr / `DUNGEON_CONFIG`, engine.js ≈11751–11771)
    to also accept `#proto=<bundle>`.
  - Make `BASE_PATH` host-agnostic; host the static app on GitHub Pages / Netlify /
    Cloudflare Pages (free).
  - Enforce a bundle-size cap.
- **Unlocks:** The full create→play→share loop at zero operational cost.
  Realizes the IDEAS.md "hosted like Bitsy" goal at minimum cost and surfaces real
  designer behavior before any backend spend.
- **Risk/effort:** Low–medium. URL-length limits for large bundles — mitigate with
  file-based sharing as the fallback.

### Phase 2 — Web map editor with tinted entity painting

- **Goal:** Author maps in-browser, painting entities with their actual tile **and
  color tint** visible — the explicit [IDEAS.md](IDEAS.md) gap (Tiled can't show
  tint).
- **Key work:**
  - A canvas/PIXI editor that reads the shared spritesheet + the prototype's merged
    actor/item defs; paints floor/wall/overlay tile layers; places entity objects
    with live tile+tint preview.
  - Reuse [`architect.js`](../architect.js)'s GID/layer parsing as the import/export
    contract; export `.tmj`-compatible JSON into the bundle.
- **Unlocks:** Removes the external-Tiled dependency — the biggest barrier to
  non-technical creators, and the thing that makes it *feel* like Bitsy.
- **Risk/effort:** Medium–high effort (a real editor), low architectural risk
  (read-only against the engine; writes only into the bundle).

### Phase 3 — Hosted gallery + persistence (anonymous) `[introduce the backend]`

- **Goal:** A browsable gallery of shared prototypes that persist server-side; play
  any by URL. Saving works without an account (anonymous identity).
- **Key work:**
  - Stand up Supabase: Storage bucket for bundles, Postgres table for
    metadata/index, RLS/storage policies enforcing per-path write isolation.
  - Swap the Phase-1 bundle source/sink for "save to / load from backend" (behind
    the same abstraction — keep it swappable).
  - Build the prototype browser/picker/gallery UI (the IDEAS.md "prototype picker"
    gap), using Supabase **anonymous auth**.
  - **Default new prototypes to unlisted/share-by-link** to keep the moderation
    burden low at launch.
- **Unlocks:** Discovery and persistence without passing links around — the actual
  "Bitsy gallery" product.
- **Risk/effort:** Medium. First real infra; first point where moderation and cost
  become live (see Risks). Complete the XSS-sanitization audit before this goes
  public.

### Phase 4 — Accounts, profiles & remixing `[near-term, per decision]`

- **Goal:** Named creators with profiles; fork/remix; basic moderation tooling.
- **Key work:**
  - Upgrade Supabase anonymous identity → optional full sign-in; attach ownership
    and a storage quota.
  - "Remix this prototype" (trivial — bundles are forkable by construction).
  - A minimal moderation path (report + takedown) and optional curated/featured
    collections.
- **Unlocks:** Community and attribution.
- **Risk/effort:** Medium; much of the cost is *non-engineering* (moderation
  policy/labor, storage cost). Scope moderation to match how public the gallery is.

---

## Reuse vs. build

**Reuse as-is (foundations — do not rebuild):**

- The supplement/override **merge** — `Prototype.loadAssets()` (engine.js ≈2692–2725).
  The "can't change `/data`" invariant is already true at runtime.
- The `/data` **baseline loader** — `loadGlobalData()` (engine.js ≈651–725).
- The **editors' JSON output** — they already emit the exact per-prototype override
  files a bundle needs; they need a save target, not a rewrite.
- [`architect.js`](../architect.js) **GID/layer parsing** — the import/export
  contract for the new map editor.
- **Prototype-selection plumbing** (engine.js ≈11751–11771) — extends naturally to
  `#proto=<bundle>`.
- **Seed URLs / serialization** ([SAVING.md](SAVING.md)) — already share *runs*
  deterministically; complementary to bundle sharing.

**Must build:**

- `PrototypeBundle` + engine loader accepting a bundle *(Phase 0 — keystone)*.
- Editor persistence + export/import *(Phase 0)*.
- A prototype-discovery manifest to replace hardcoded lists *(Phase 0)*.
- URL/file bundle encoding + host-agnostic `BASE_PATH` *(Phase 1)*.
- Web map editor with tinted entity painting *(Phase 2)*.
- Backend storage/index + gallery/picker + isolation policies *(Phase 3)*.
- Accounts, profiles, remix, moderation *(Phase 4)*.

---

## Risks & open questions

1. **Moderation posture.** A public gallery of arbitrary user text/art *will*
   attract abuse. Recommend launching **unlisted/share-by-link** (Phase 3) and
   adding curation/featured + report/takedown only as needed (Phase 4).
2. **Cost ceiling.** Storage and bandwidth are the cost drivers once a backend
   exists. Decide a budget and enforce a per-bundle size cap from **Phase 1**.
3. **XSS surface.** Commit to "prototype content is data, never code," and finish
   sanitizing every user-string render path **before Phase 3 ships publicly**.
4. **URL vs. file vs. backend as the share unit.** Support both: URL hash for small
   prototypes, file/backend for large. (Custom-spritesheet sharing would force the
   file/backend path — but that's out of scope, see Appendix A.)
5. **Keep the no-build static client?** Yes, through Phase 4. The only "backend" is
   a managed BaaS, never a bespoke server. Revisit *minification only* (not a
   framework) if `engine.js` load time becomes a real problem.

---

## Appendix A — Custom per-prototype tiles (out of scope, recorded for later)

Per the decision above, all prototypes keep sharing the single `static-tiles.png`
spritesheet for now. This is recorded because it's the one requirement that fights
the current architecture, so a future effort can pick it up with eyes open.

**Why it's hard:** the spritesheet is a *single global PIXI resource* loaded once
(engine.js, `PIXI.Loader … .add('tiles', globalVars.SPRITESHEET_PATH)`), on a fixed
23×12 / 40×30 grid (`globals.js`), with a name→coordinate map in
`data/static-tiles.json`. Maps reference tiles by GID into this one sheet. There is
no per-prototype texture hook.

**If revived, sequence it as:**
- **(a) Per-prototype tile *aliasing*** over the existing sheet — JSON only, no new
  art. Cheap; could even ride along with the Phase 2 map editor.
- **(b) Per-prototype *atlas*** — a second BaseTexture loaded per prototype, a
  GID-namespacing scheme so prototype tile ids don't collide with base ids, and the
  renderer choosing the right texture per tile. Moderate engine work in the renderer.
- **(c) In-browser pixel-art / upload tool** producing that atlas (PNG + tile-name
  map). UI-heavy, architecturally isolated; needs object storage for the PNG.

**Decide before reviving:** keep the fixed 40×30 cell (strongly recommended — a
variable cell size ripples through `globals.js` constants and every renderer
offset).

---

## Critical files

- [`engine.js`](../engine.js) — `loadGlobalData()` (≈651–725), `loadPrototype()` /
  map fetch (≈1673–1690), `Prototype.loadAssets()` merge (≈2692–2725), prototype
  selection (≈11751–11771). The bundle refactor and the isolation invariant live
  here.
- [`globals.js`](../globals.js) — `BASE_PATH`, spritesheet path, fixed tile-grid
  constants. The host-agnostic-path fix touches this.
- [`architect.js`](../architect.js) — `.tmj` GID/layer parsing; the import/export
  contract for the web map editor.
- [`prototype-editor.html`](../prototype-editor.html) — already understands the
  override model and exports correct JSON; template for adding persistence/export,
  and home of the hardcoded-prototype-list problem.
- [`deploy.sh`](../deploy.sh) — current Jekyll copy-deploy; superseded by static
  hosting + a manifest in Phase 1.
