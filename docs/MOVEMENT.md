
## Order of operations: an actor attempting to move into a tile

This is the sequence inside `Actor.tryMove(newX, newY)` (`engine/actor/movement.js`), the single entry point for movement and bump-attacks (`moveBy` → `tryMove`). Steps run top to bottom; the **first** one that returns ends the turn's move attempt. `solid` here means the actor's runtime `solid` attribute (defaults to **true** unless the data sets `solid: false`).

1. **Hide walk-path highlight** (cosmetic).
2. **Bounds check** — target off-map → return `{moved:false, actionTaken:false}` (no turn).
3. **Stuck check** — if the mover `hasStateProperty('stuck')`, roll `getEscapeChance()` (the lowest `escape_chance` among the holding states, default `0.33`): success → `removeState` on every `stuck` state and continue; failure → return `{moved:false, actionTaken:true}` (wastes the turn).
4. **Diagonal-corner block** — Brogue-style: can't cut diagonally past a wall/solid corner → return no-move.
5. **Solid actor at target?** `getSolidActorAt(newX,newY)` (returns only actors with `solid`). **If a solid actor is there**, enter the *solid-actor branch* and do the first that applies:
   a. Same scutigera chain member → ignore (no-move).
   b. **Pushable** + pusher has strength + valid push destination → push it, mover steps in → return `{moved:true}`.
   c. **Weapon attack style** (sweep/penetrate) handles it → return its result.
   d. **`applyCollisionEffects(target)`** — the bump-attack: rolls hit/miss, applies damage/effects. If it makes the target passable (e.g. killed, or a key unlocked a door) and not just-killed → **recurse** `tryMove` to move onto the freed tile.
   e. **Pausable** (clockwork) → toggle paused → return.
   f. **Switchable** → toggle → return.
   g. **Openable & closed** → spiked? jammed; locked? rejected (`plunk3`); else open it → return. A `container` (chest) opens the same way, but because opening sets `solid: false` the *next* step onto its tile is what takes the contents — and if it was trapped, the payload fires on the opener here instead.
   h. **`collision_description`** (and no `collision_effect`) → show flavor text → return.
   i. Otherwise → "blocks your way" → return `{moved:false, actionTaken: attackAttempted}`.
   **The solid branch never falls through to movement** — bumping a solid actor is an action in itself.
   Note this is also why bumping only ever reaches **solid** actors: `getSolidActorAt` is the only
   lookup here. A non-solid `breakable` (a grave you stand on) can't be dug this way; it's dug with a
   mining tool's **Dig** verb, which calls `applyCollisionEffects` directly — the same thing
   `mine_nearby_wall` (`behaviors/ai.js`) does for AI miners, bypassing `tryMove` entirely. That verb
   also accepts solid walls, where it does exactly what one bump would, and it passes its own tool to
   `applyCollisionEffects` so a mattock still in the pack digs as well as an equipped one.
6. **Floor/void check** — no floor/platform under target and not flying → step in and `fall()` to the next level → return `{moved:true}`.
7. **Lunge attack style** (for reach weapons into empty tiles) → may handle and return.
8. **Commit the move** — record last position, liquid-track tint, set facing, **`this.x=newX; this.y=newY`**, update sprite.
9. **Post-move hooks** — viewport snap, passive item effects, auto-close doors behind, item pickup, walk descriptions, stairway transitions, lighting update, **submersion** (`updateSubmersionState` — relevant for `deep` actors), cloud/mist effects, pressure-plate/switch triggers.
