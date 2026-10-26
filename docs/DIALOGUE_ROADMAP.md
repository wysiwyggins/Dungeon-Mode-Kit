# Dialogue & Taunts Roadmap — Dungeon Mode Kit

*A path to conversations with non-hostile actors (multiple-choice dialogue trees)
and taunt lines for hostile actors.*

Status: planning · Last updated: 2026-10-25

---

## Context

[IDEAS.md](IDEAS.md) sketches a dialogue feature: bumping a non-hostile actor opens a conversation instead of attacking, with multiple-choice options; could use an existing library like ink

1. **Bump-to-talk.** When the player bumps a non-hostile actor, open a dialogue
   tree (text + multiple-choice) instead of resolving an attack.
2. **Dual display.** Dialogue text shows in the **in-canvas UI textbox** (with a
   character limit + truncation) **and** is mirrored in full (no truncation) to the
   **HTML sidebar description area** — a fallback so long strings are never lost.
3. **Hostile taunts.** Hostile actors say a line from a `taunts` list before their
   first attack and before they die.

---

- Simple custom JSON tree now, ink-compatible later.** A small node/choice schema with no external runtime; the loader is designed so an `inkjs` adapter could be dropped in later as an alternate source.
- Mouse click + keyboard: Reuse the existing inventory/menu click model (`_hitTestBox` → `_handle*Click`) plus letter/number keys.
- Data location: On the personality(`personalities.json`), where `hostile` already lives — with an optional per-actor override in `actors.json` for one-off NPCs.  I'm worried about personality.json getting too big though, which is another argument for ink json exports as the dialogue. Could reuse another parser I made for "textovka"
- I want engine hooks to be able to check for a global (prototype-level) variable or a level specific variable (neither of these exist yet) and to be able to add or remove items from both conversing actors (shop or trade is an early target for convo)

---

## Where this hooks into the engine (verified)

| Concern | Location | Note |
|---|---|---|
| Player bump → attack | `tryMove()` in `engine/actor/movement.js`; attack at `applyCollisionEffects(actorAtTarget)` (`engine/actor/combat.js`) | Insert dialogue check after the solid-actor lookup, before attack resolution. |
| Hostility flag | `Personality` ctor in `behaviors/behaviors.js` `this.hostile = data.hostile \|\| false`; data in `personalities.json` | Non-hostile = `personality.hostile === false`. An informal `friendly` actor attribute also exists (`input.js`). |
| Actor death | `die()` in `engine/actor/actor.js`, near its death message | Fire before-death taunt just before the death message, while still "alive." |
| Hostile first attack | `attack_adjacent` behavior in `behaviors/ai.js` (calls `applyCollisionEffects`) | Fire first-attack taunt once per actor (guard with a flag). |
| Canvas textbox | `showTextBox(id, text, options)`, `wrapText()`, `renderTextLine()`, `createCharSprite()` in `ui/interface-manager.js` | Already word-wraps + stacks (`uiContainer`, zIndex 6). Add a char-limit/truncation option. |
| Sidebar text | `showMessage()`, `displayMessages()` in `input.js` | Writes via `textContent`/`createElement` — **XSS-safe**; no truncation. |
| Modal click router | `handleDialogClick()` → `_hitTestBox()` → `_handle*Click(box, contentLine)` (e.g. `_handleInventoryClick`) in `ui/menus.js` | Central router hit-tests the active box's content lines. Clone for dialogue. |
| Modal key chain | `handleKeyDown()` in `input.js` checks mode flags in precedence order; `disable()/enable()`; `turnEngine.lock/unlock` | Add a `dialogueMode` branch; gate game input while open. |
| Confirm-dialog template | `showConfirmDialog()`, `handleConfirmKey()`, `_handleConfirmClick()` in `ui/menus.js` | Closest existing analog (modal box + options + click + key); the model to follow. |

---

## Data model

### Dialogue tree (simple custom JSON, ink-compatible later)

A dialogue tree is a small object of nodes; each node has text and a list of
choices pointing to other node ids. No external runtime needed.

```json
{
  "start": "greet",
  "nodes": {
    "greet": {
      "text": "Well met, traveler. The deep roads are no place to wander.",
      "choices": [
        { "label": "Who are you?",        "goto": "who" },
        { "label": "What lies below?",     "goto": "below" },
        { "label": "Farewell.",            "goto": null }
      ]
    },
    "who":   { "text": "A keeper of old keys.", "choices": [ { "label": "...", "goto": "greet" } ] },
    "below": { "text": "Only the patient find out.", "choices": [ { "label": "...", "goto": "greet" } ] }
  }
}
```

- `goto: null` (or a choice with no `goto`) **ends** the conversation.
- A node with no `choices` shows text and a single "Continue/Leave" affordance.
- **Ink compatibility seam:** the interface consumes an abstract *conversation
  controller* with two methods — `currentLine()` → `{ text, choices[] }` and
  `choose(index)` → advances. Phase 1 implements this over the JSON tree; an
  `inkjs` adapter can later implement the same interface over compiled ink JSON
  without touching the UI. Keep the UI ignorant of the backing format.

### Attaching dialogue & taunts to a personality

Dialogue and taunts live on the **personality** (consistent with `hostile`):

```json
"old_keeper": {
  "name": "Old Keeper",
  "hostile": false,
  "behaviors": ["random_walk"],
  "dialogue": { "...inline tree, or an id..." },
  "taunts": { "on_attack": ["You should not have come."], "on_death": ["...the keys..."] }
}
```

- `dialogue` may be an **inline tree** or a **string id** (resolved against an
  optional prototype-level dialogue registry — deferred; inline is enough for
  Phase 1).
- `taunts.on_attack` / `taunts.on_death` are string arrays; one is chosen at random.
- **Per-actor override:** `actors.json` may set `dialogue` / `taunts` on an
  individual actor; the actor-level value wins over the personality's. This costs
  little (just check the actor attribute first) and preserves one-off NPCs.
- Both flow through the existing supplement/override merge, so prototypes can add or
  replace dialogue without touching `/data`.

---

## Dual display behavior

When a dialogue node (or a taunt) is shown:

1. **Canvas textbox (target A):** render via `showTextBox()` with a new
   `charLimit` option. If the node text exceeds the limit, show a truncated form
   (e.g. ellipsis) on the canvas. Choices render as clickable/keyed lines beneath
   the text in the same box (the confirm-dialog/throw-menu layout).
2. **Sidebar (target B):** mirror the **full, untruncated** text via
   `showMessage()` (optionally with a `dialogue` style class), so any long string
   is always fully readable even when the canvas truncates it.

Taunts use the same dual path (canvas short line + sidebar full line) but are
non-interactive — they're just messages, not a modal.

**XSS note:** the sidebar path uses `textContent` (safe). The canvas path renders
char-by-char from the spritesheet (no HTML). Dialogue text is **data, never code** —
no `eval`, consistent with the rest of the engine. This matters once prototypes are
hosted (see [HOSTING_ROADMAP.md](HOSTING_ROADMAP.md)).

---

## Phased roadmap

Each phase is independently shippable. Taunts (Phase A) and bump-to-talk
(Phases B–C) are largely independent and could even land in either order; taunts
are simpler and make a good warm-up.

- [x] Hostile taunts
- Dialogue UI primitive (modal box + choices) `[foundation for talk]`
  - **Goal:** A reusable dialogue window: shows a node's text + a list of selectable
  choices; supports click and keyboard; gates game input while open.
- **Work:**
  - Add `showDialogue(node, controller)` as a new `ui/` group (e.g. `ui/dialogue.js`), modeled on
    `showConfirmDialog()` — a `createBox()` with wrapped text, then one line per
    choice (prefixed `a)`/`b)`… or `1)`/`2)…`), storing a line→choiceIndex map on
    the box (the `_inventoryLineIndices` pattern).
  - **Click:** add a `dialogueMode` branch to the click router (`handleDialogClick`
    in `ui/menus.js`) using `_hitTestBox()` → new `_handleDialogueClick(box, contentLine)`.
  - **Keyboard:** add `handleDialogueKey()` and a `dialogueMode` flag; insert into
    the `handleKeyDown()` precedence chain (`input.js`) above movement.
  - **Gating:** on open, `inputManager.disable()` game actions + `turnEngine.lock()`;
    on close, re-enable + unlock (mirror the confirm-dialog lifecycle).
  - Implement the **conversation controller** over the JSON tree
    (`currentLine()` / `choose(index)`); selecting a choice advances the node or
    ends the conversation; the canvas box re-renders per node (dialogue is modal, so
    re-render is fine — unlike the live editors).
  - Wire the dual display: each node updates canvas (truncated) + sidebar (full).
- **Unlocks:** The conversation surface; no game hookup yet (can be opened from a
  debug trigger to test).
- **Risk/effort:** Medium. The one genuinely new UI; everything reuses existing
  primitives.

### Phase C — Bump-to-talk wiring `[the core feature]`

- **Goal:** Bumping a non-hostile actor opens its dialogue instead of attacking.
- **Work:**
  - In `tryMove()` after the solid-actor lookup (`engine/actor/movement.js`) and **before**
    `applyCollisionEffects`, if the target is non-hostile (`personality.hostile ===
    false`, or has `friendly`) and has a resolvable `dialogue`, open the dialogue
    UI (Phase B), consume the move (no attack, no turn spent — or spend a turn, a
    design toggle), and return without attacking.
  - Resolve `dialogue` actor-override → personality.
  - If a non-hostile actor has **no** dialogue, fall back to current behavior
    (swap/block — unchanged).
- **Unlocks:** The full bump → talk → choose → close loop.
- **Risk/effort:** Low–medium. Small, well-isolated change at a known seam; main
  care is not disturbing existing non-hostile bump behavior (swap/push).

### Phase D — Effects, conditions & shared dialogue registry `[deferred]`

- **Goal:** Choices that give/take items, set prototype variables, or gate branches
  on conditions; dialogue referenced by id from a shared per-prototype registry.
- **Work:** Add optional `effect` / `condition` fields to choices/nodes; depends on
  the **prototype variables** system (also in IDEAS.md) for stateful gating. Add a
  `dialogue.json` registry merged like other prototype files so trees can be reused
  across actors and authored once.
- **Unlocks:** Branching, stateful conversations and reuse.
- **Risk/effort:** Medium; gated on the variables feature. Explicitly out of Phase 1.

### Phase E (future) — Authoring `[tooling]`

- an `inkjs` adapter implementing the conversation-controller interface over compiled ink JSON. The Phase B abstraction is what makes this a drop-in.

---

## Reuse vs. build

**Reuse as-is:**

- Hostility flag (`Personality` in `behaviors/behaviors.js` / `personalities.json`).
- Collision seam `tryMove()` / `applyCollisionEffects` (`engine/actor/movement.js`, `engine/actor/combat.js`).
- `die()` taunt point (`engine/actor/actor.js`).
- Canvas textbox `showTextBox()` + `wrapText()` + `renderTextLine()` (`ui/interface-manager.js`).
- Sidebar `showMessage()` / `displayMessages()` (`input.js`) — XSS-safe.
- Modal click model `_hitTestBox()` + `_handle*Click` and the confirm-dialog
  lifecycle (`ui/menus.js`); key precedence chain + input gating (`input.js`).
- The supplement/override merge, so dialogue/taunts are per-prototype overridable.

**Must build:**

- `charLimit`/truncation option on `showTextBox()` + a small dual-display helper.
- Taunt firing in `attack_adjacent` and `die()` (Phase A).
- `showDialogue()` + `dialogueMode` + `_handleDialogueClick` + `handleDialogueKey`
  - the JSON-tree conversation controller (Phase B).
- The bump→dialogue branch in `tryMove()` (Phase C).
- (Later) effects/conditions, dialogue registry, authoring/ink adapter (D–E).

---

## Risks & open questions

1. **Does talking cost a turn?** Decide whether opening/advancing dialogue advances
   the scheduler or is "free." Recommend **free** (modal pauses the turn engine) for
   a clean conversational feel; revisit if it enables cheesing hostile-but-talkable
   actors.
2. **Non-hostile actors that should still block/swap.** Some non-hostile actors
   (water, fire, lava — all `hostile:false`) must **not** open dialogue. Gate
   strictly on *presence of a `dialogue` field*, not merely on `hostile === false`.
3. **Visibility for taunts.** Only fire taunts when the actor is visible to the
   player (avoid talking from offscreen). Reuse the visibility check `die()` already
   does for death messages.
4. **Re-triggering.** Decide whether a conversation can be reopened (recommend yes,
   resets to `start`) and whether the first-attack taunt fires only once
   (recommend once per actor via a flag).
5. **Character limit value.** Pick the canvas `charLimit` against the visible-area
   width (`showTextBox` uses `vis.width - 4`); the sidebar always carries the full
   text as the safety net the user asked for.

---

## Critical files

- [`behaviors/behaviors.js`](../behaviors/behaviors.js) — hostility flag (`Personality` ctor);
  [`behaviors/ai.js`](../behaviors/ai.js) `attack_adjacent` for the first-attack taunt.
- [`engine/actor/movement.js`](../engine/actor/movement.js) — `tryMove()` collision seam;
  [`engine/actor/combat.js`](../engine/actor/combat.js) `applyCollisionEffects`;
  [`engine/actor/actor.js`](../engine/actor/actor.js) `die()` (taunt point) and the
  attribute accessors (on `Entity`, `engine/entity.js`).
- [`ui/interface-manager.js`](../ui/interface-manager.js) — `showTextBox()` and
  char/line rendering; [`ui/menus.js`](../ui/menus.js) — `showConfirmDialog()` template,
  click router + `_hitTestBox()`. The new `showDialogue()` would be its own `ui/` group.
- [`input.js`](../input.js) — `handleKeyDown()` precedence, `showMessage()`, input
  gating. Home of `dialogueMode` + `handleDialogueKey`.
- [`data/personalities.json`](../data/personalities.json) — where `dialogue` /
  `taunts` attach; optional per-actor override in `data/actors.json`.
- [`index.html`](../index.html) — `<details id="description">` sidebar target.

## Verification

1. Serve locally (`python3 -m http.server`); load a prototype.
2. **Taunts (A):** give a hostile actor `taunts.on_attack`/`on_death`; confirm a
   line appears (canvas + sidebar) on its first attack and just before death, only
   when visible, once for the first-attack line.
3. **Dialogue UI (B):** trigger `showDialogue()` on a test node; confirm text wraps,
   choices render, both **click** and **keys** select, Escape/leave closes, and
   game input + the turn engine are paused while open and resume after.
4. **Bump-to-talk (C):** give a non-hostile actor a `dialogue` tree; bump it →
   conversation opens (no attack); walk the tree via choices; ending closes back to
   game. Confirm a non-hostile actor **without** dialogue (e.g. water) still
   blocks/swaps as before.
5. **Dual display:** author a node whose text exceeds `charLimit`; confirm the
   canvas truncates and the sidebar shows the full string.
6. **Override:** add `dialogue`/`taunts` in a prototype's `personalities.json`
   (or `actors.json`) and confirm it overrides the base without changing `/data`.
