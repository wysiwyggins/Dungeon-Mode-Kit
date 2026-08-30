# Generator Roadmap — Untangling Architect

*Evaluating the [2026-08-29 journal entry](../journal/2026-08-29-generator-ideas.md):
WFC from authored maps, modular generators, and a rename/audit of the generator and
biome vocabulary.*

Status: planning · Last updated: 2026-08-29

---

## Context

The journal entry proposes three things, prompted by secret-door churn in the `brogue`
generator:

1. **A new procgen model** — author a large `.tmj` map, derive wave function collapse
   rules from it, let designers ship their own generators as rules maps.
2. **Modular generators** — split the "hairball" generators into separate files that fail
   gracefully to a fallback.
3. **Renaming and semantic remapping** — `brogue` is a bad name for what it now is; audit
   every generator; make biomes able to combine generators; add an `ossuary` biome.

This document checks each against the code, then sequences the work. Numbers below are
measured, not estimated from impression.

### What architect.js actually looks like

5,826 lines, 113 methods, one class, no ES module boundary.

| Subsystem | Methods | Lines | Notes |
| --- | ---: | ---: | --- |
| Generators (dispatch + inline cases) | 9 | 1,295 | `generateProceduralMap` is a single ~660-line `switch` |
| Palladian | 21 | 1,239 | The **largest** generator |
| Brogue | 17 | 927 | |
| Core/util | 28 | 890 | Layers, tile patterns, flood fill, `applyTilePattern` |
| Spawn/queue drain | 16 | 649 | 12 `pending*Spawns` queues |
| Blobs (lakes/lava/sewage) | 9 | 466 | |
| Wildcard | 8 | 205 | |
| TMJ loading | 5 | 118 | |

**The first correction to the journal's premise:** the complexity is not concentrated in
`brogue`. Palladian is 34% larger, and "core/util" plus the spawn queues (1,539 lines) is
bigger than either. `brogue` feels worst because it's where the secret-door work happened,
but extracting only it would leave most of the mass behind.

### Coupling: the real obstacle

Generators are not self-contained functions. They write to shared instance state:

```
this.floorMap        60 refs      this.diggerRooms     15 refs
this.walkableTiles   49 refs      this.overlayMap      10 refs
this.backgroundMap   25 refs      this.wildcardMap     19 refs
```

…and to **twelve** deferred-spawn queues drained later by the engine:

```
pendingWallSpawns (50)  pendingDoorSpawns (22)  pendingSecretDoorSpawns (17)
pendingTorchSpawns (15) pendingPushableWallSpawns (12) pendingBrazierSpawns (12)
pendingSewageSpawns (11) pendingLavaSpawns (11) pendingLakeSpawns (11)
pendingHiddenLeverSpawns (10) pendingBridgeSpawns (10) pendingCollapsingFloorSpawns (8)
```

Any "generator as a separate file" must receive all of this. That surface — not the
generation algorithms — is the actual design problem, and defining it is the prerequisite
for both idea #1 and idea #2.

There is also **cross-generator reuse**, which the journal doesn't account for — though
less of it than an earlier draft of this document claimed. Of the 17 `_brogue*` helpers,
only **three** had callers outside the generator:

- `_brogueFinalizeMap` — called by the **palladian** generator (architect.js:1009, 1024);
  `_palladianFinalizeRegion` is documented as a region-scoped variant of it.
- `_brogueMakeRoomRecord` — called by `_palladianMakeRecords` (5365, 5376).
- `_brogueMakeCavern` — builds the shapes for the **blob/lake** system (1390).

The other 14 are genuinely private. Note `_brogueBFS` is *deliberately* not shared: the
comment at 1278 explains that `_isWorthwhileShortcut` cannot reuse it because it reads the
transient `dungeonGrid` rather than the finished `floorMap`. Resolved in Phase 1 — the
three shared helpers were de-prefixed, the rest took the generator's new name.

### Constraint: no module system

`index.html` loads plain `<script>` tags in dependency order (`rot.js`, `pixi`, `tween`,
`howler`, `globals.js`, `architect.js`, …). There is no bundler, no `import`. "Separate
files that fail gracefully when missing" therefore means either extra `<script>` tags with
a global registry, or a `fetch`-based loader. This is a **hosting-roadmap-adjacent
decision** — see [HOSTING_ROADMAP.md](HOSTING_ROADMAP.md), which describes the same
static-file constraint — and the two should agree rather than each inventing a loader.

### Determinism

All randomness in architect.js is `ROT.RNG.*` (71 calls; zero `Math.random`). Seeded
reproducibility per [SAVING.md](SAVING.md) is intact, and **any WFC library must be
driven by `ROT.RNG`**, not its own generator, or `?seed=` silently stops working. This
disqualifies drop-in use of most libraries without a patch point.

---

## Evaluation of each idea

### 1. WFC from authored maps — promising, but not a replacement

**What's already in place.** More than the journal assumes:

- `generateWildcardContent` (architect.js:2267) is a clean `switch` on region type. A
  `wfc` case slots in beside `maze`/`dungeon`/`cave` with no restructuring.
- Region discovery (`findWildcardRegion`) already hands a generator a bounded rect.
- **`paint_tile` already exists.** `getActorWildcardType` (architect.js:577) builds a
  tile-id → actor-type map from any actor declaring a `paint_tile` attribute. The
  journal's "add a wildcard tile selector to the actor editor" is *mostly already built* —
  what's missing is only the editor UI for a field the engine reads today.
- Prototype-local overrides are an established pattern (`prototypes/<name>/biomes.json`),
  so a prototype-local rules map fits the existing loader model.

**What's genuinely hard.**

- **Constraints WFC doesn't express.** The current generators guarantee connectivity
  (`_floodFillRegion`, `_dungeonMakeLoops`, `repairBlobConnectivity`), place doors on valid
  wall sites, and avoid the diagonal-movement trap the journal's own secret-door complaint
  describes. WFC is a *local* constraint solver — it cannot guarantee the level is
  traversable. Every serious roguelike WFC use pairs it with a connectivity repair pass.
  The good news: **that pass already exists** and is generator-agnostic
  (`repairBlobConnectivity`, architect.js:1619).
- **Failure/contradiction handling.** WFC fails; it needs retry-with-backtrack and a
  fallback, on a 100×100 map (the size every current biome uses).
- **Library fit.** [kchapelier/wavefunctioncollapse](https://github.com/kchapelier/wavefunctioncollapse)
  (the journal's link) is the realistic candidate — small, dependency-free, overlapping +
  tiled models. It takes its own RNG function as a parameter, so `ROT.RNG.getUniform` can
  be injected. DeBroglie's richer features (path constraints, edged tiles) are exactly
  what's missing here and would have to be reimplemented.

**Verdict: worth prototyping, scoped as an *additional* generator, not a replacement.**
The journal's framing ("what if there was an option") is right; the risk is the follow-on
sentence about replacing the hairball. WFC will not reproduce palladian's secret passages
or the dungeon generator's door logic — those are semantic, not tile-adjacency,
constraints. Ship it as
`wfc` alongside the others and let it earn territory.

### 2. Modular generators — right instinct, do it after the interface exists

Extraction is only meaningful once the 12 queues + 6 shared maps are a named interface. In
the current shape you'd be moving code that reaches into `this` from a different file —
strictly worse than today, because the coupling becomes invisible.

The "fails gracefully when missing" goal is real and cheap **once there's a registry**:
`generateProceduralMap`'s `default:` already falls through to `digger`, so an unknown type
degrades rather than crashing. That's the fallback behavior the journal wants, already
implemented for the switch; a registry preserves it.

**Verdict: valuable, but strictly second.** Sequence it after the interface extraction, and
note that the biggest single win (splitting palladian's 1,239 lines out) is available
without any WFC work.

### 3. Rename and audit — do this first; it's the cheapest and unblocks the rest

Confirmed by the data:

**`caves` and `depths` are less alike than the journal suspects, but not distinct enough.**
Both run the same generator at 100×100, and an earlier draft of this document called them
"near-identical" — that was wrong. `caves` weights cavern-shaped rooms (30) with
water/sewage lakes and a high `secretDoorChance` (35); `depths` shifts to geometric rooms
(cross 25, circular 20), swaps in lava, and adds `abyss` blobs and `collapsing_floors`,
dropping `secretDoorChance` to 6. Those are real architectural differences, not just
catalog differences. The restratification is still worth doing — they read as two tunings
of one idea rather than two strata — but it's a design pass, not a cleanup. Only three
biomes exist (`caves`, `depths`, `infernal`), all in the `dungeon` prototype's 26-floor
plan; no prototype ships its own `biomes.json` yet.

**The generator list was out of sync.** `editors/scripts/editor-constants.js` declared
`GEN_TYPES = ['brogue','digger','arena','infernal','palladian']`, but
`generateProceduralMap` handles **eleven** types — `cellular`, `uniform`, `rogue`,
`divided_maze`, `icey_maze` and `eller_maze` were unpickable in the biome editor despite
working. `cellular` is used by `prototypes/mine`, so a designer could load a biome the
editor could not represent. Fixed in Phase 1.

**Six of eleven generators are near-identical thin wrappers.** `uniform`, `rogue`,
`divided_maze`, `icey_maze`, `eller_maze`, and `arena` are each ~12 lines: construct a
`ROT.Map.*`, call `create`, set floor tiles. They share a byte-identical callback body.
They produce **no walls, no rooms, no regions, and touch none of the 12 spawn queues** —
unlike `digger`, `dungeon`, `palladian`, and `infernal`. That is a meaningful capability
tier, and it should be visible to designers rather than discovered by trying one.

#### Generator audit

| Type | Impl | Lines | Walls | Rooms/regions | Spawn queues | Notes |
| --- | --- | ---: | :-: | :-: | :-: | --- |
| `dungeon` | custom | ~927 | yes | yes | many | Rooms+corridors+loops+secrets. Was `brogue`; the old name is still accepted as an alias |
| `palladian` | custom | ~1,239 | yes | yes | many | Symmetric villa; secret passages, columns, windows |
| `infernal` | cellular + blobs | ~130 | yes | — | lava/lakes | Cellular cave themed with lava |
| `digger` | ROT + walls | ~70 | yes | yes | walls | The `default` fallback |
| `cellular` | ROT + post | ~60 | yes | — | walls | Open cave |
| `uniform` | ROT wrapper | ~12 | **no** | no | none | Thin |
| `rogue` | ROT wrapper | ~12 | **no** | no | none | Thin |
| `divided_maze` | ROT wrapper | ~12 | **no** | no | none | Thin |
| `icey_maze` | ROT wrapper | ~12 | **no** | no | none | Thin |
| `eller_maze` | ROT wrapper | ~12 | **no** | no | none | Thin |
| `arena` | ROT wrapper | ~12 | **no** | no | none | Thin; used by test prototypes |

Wildcard region generators (`generateWildcardContent`) are a parallel set: `maze`,
`digger_region`, `cave`, `infernal`, `room`, `palladian`, `abyss`, plus `item_spawn` /
`actor_spawn` markers and actor-paint fallthrough. (`digger_region` was called `dungeon`
until Phase 1 renamed it to free that word for the main generator; its tile IDs are
unchanged.)

**Naming — settled in Phase 1.** `brogue` → **`dungeon`**, matching the journal's "generic
dungeon generator". The word was already taken by a wildcard region type that wraps
`ROT.Map.Digger`, so that one became `digger_region` — which is what it actually is. The
old generator name survives as a silent alias in the dispatch.

**Ossuary biome.** Needs skull-wall actors plus a wall-actor selector in the biome editor.
Note that `wall_types` **already exists** as a weighted list in generator options
(`_pickWeightedWallType`, architect.js:160) and is honored by **every wall-producing
generator** — `cellular` (677), `infernal` (792), `dungeon` (834), `palladian` (990, which
defaults to `brick_wall`), and `digger` (1068) — plus the region-scoped cave and palladian
wildcard paths (2552, 2670). So this is an editor-surface task over a fully implemented
engine feature, the same shape as the `paint_tile` finding above. The six thin wrappers
produce no walls at all and so can't support it.

---

## Roadmap

Ordered so each phase is independently shippable and earlier phases de-risk later ones.

### Phase 1 — Audit, rename, biome semantics · **Low–Medium** · ✅ **Done (2026-08-29)**

No new systems; highest ratio of clarity to risk.

1. ✅ Generator audit — the capability table now lives in [PROTOTYPE.md](PROTOTYPE.md),
   with walls/rooms columns so the floor-only tier is visible to designers.
2. ✅ `GEN_TYPES` synced to all eleven, ordered by capability.
3. ✅ `brogue` → `dungeon`, old name kept as a silent alias. The `dungeon` wildcard region
   became `digger_region`; its tile IDs (9/16/152) are unchanged, so no `.tmj` was touched.
4. ✅ All 17 `_brogue*` helpers renamed — 14 private ones to `_dungeon*`, the 3 shared ones
   de-prefixed to `_finalizeMap`, `_makeRoomRecord`, `_makeCavernShape`.
5. ⏭ Re-cutting the strata and adding `ossuary` was deliberately deferred: it's a design
   pass, not a refactor. See the `caves`/`depths` note above.
6. ✅ Docs updated: PROTOTYPE, MAP, TILED_KEY, EPISTEMOLOGY, BRIDGES, IDEAS, CHANGELOG.

*Outcome: no behaviour change, verified mechanically. `tools/generator-golden.js` digests a
seeded map per generator; before/after output is byte-identical except `dungeon`, which
moved from the digger fallback to matching `brogue`'s digests exactly — the intended change
and nothing else.*

### Phase 2 — Generator interface · **Medium**

The keystone. No behavior change; pure refactor.

1. Define the context object a generator receives — the 6 maps, the 12 spawn queues,
   `config`, RNG, and region-publishing (`publishRoomRegions`, `queueRoomLights`).
2. Convert the `switch` to a registry (`Architect.registerGenerator(name, fn)`), keeping
   `digger` as the missing-generator fallback that already exists.
3. Fold the six thin ROT wrappers into **one** parameterized adapter — removes ~5 duplicate
   bodies immediately and proves the interface on the easy cases first.

*Risk: medium. Verify with seeded golden-map comparison: same seed + same generator must
produce a byte-identical `serializeMap()` before and after. `tools/palladian-dump.js` is a
precedent for this kind of harness.*

### Phase 3 — Extract generators to files · **Medium**

1. Move palladian out first — largest win, most self-contained, already has a dump tool.
2. Then the renamed dungeon generator + its shared helpers.
3. Add `<script>` tags; registry absence → fallback. Coordinate the loading story with
   [HOSTING_ROADMAP.md](HOSTING_ROADMAP.md) rather than inventing a second one.

*Risk: medium, mostly mechanical after Phase 2. Load-order bugs are the likely failure and
they're loud.*

### Phase 4 — WFC prototype · **High**

Spike first, behind a wildcard type; do not commit to the designer-facing story until the
spike answers the connectivity question.

1. Evaluate `kchapelier/wavefunctioncollapse`; confirm RNG injection accepts
   `ROT.RNG.getUniform`. **Reject any library that can't be seeded.**
2. Rules extraction: read a `.tmj` → tile adjacency (overlapping model, N=2 or 3).
3. Register a `wfc` generator; add a `wfc` case to `generateWildcardContent` so it works
   region-scoped inside an authored map — the journal's "still use wildcard tiles" goal.
4. **Connectivity pass is mandatory**, not optional polish. Reuse
   `repairBlobConnectivity`.
5. Contradiction handling: retry with backoff, then fall back to `digger` and log.
6. Measure generation time on 100×100 before designing any UI around it.

*Risk: high — the only phase that can fail on its merits. Time-box the spike. Success
criterion: a hand-authored rules map yields a connected, playable 100×100 level in
acceptable time, seeded reproducibly.*

### Phase 5 — Designer-facing authoring · **Medium**, gated on Phase 4

1. Wildcard-tile selector in the actor editor — **surfacing the existing `paint_tile`
   attribute**, not new engine work.
2. Wall-actor selector in the biome editor over the existing `wall_types`.
3. Prototype-local rules maps (`prototypes/<name>/rules/*.tmj`) + generator registration,
   following the `biomes.json` override pattern.
4. Document the whole authoring path.

---

## Recommendation

**Phases 1 and 2 are worth doing regardless of whether WFC ever ships**, and they're what
actually addresses the journal's opening complaint — that architect is hard to read and
working in it feels like churn. The rename and the audit cost little and pay off
immediately; the interface work is what makes every later change cheaper.

Two framing corrections worth carrying forward:

- **WFC is an addition, not a cure.** It won't absorb palladian's secret passages or
  the dungeon generator's door placement, because those encode semantics WFC has no
  vocabulary for. The
  hairball shrinks through Phases 2–3, not Phase 4.
- **Two of the journal's asks are already half-built.** `paint_tile` (actor → wildcard
  tile) and `wall_types` (weighted wall actor selection) exist in the engine and lack only
  editor surface. Those are the cheapest designer-visible wins available and don't depend
  on anything else in this document.

The secret-door churn that prompted all this is most directly addressed by Phase 1's
helper split plus the existing IDEAS.md note about diagonal-adjacent door placement —
neither of which requires a new procgen model.
