
## Order of operations: an actor attempting to move into a tile

This is the sequence inside `Actor.tryMove(newX, newY)` (`engine.js:~6832`), the single entry point for movement and bump-attacks (`moveBy` → `tryMove`). Steps run top to bottom; the **first** one that returns ends the turn's move attempt. `solid` here means the actor's runtime `solid` attribute (defaults to **true** unless the data sets `solid: false`).

1. **Hide walk-path highlight** (cosmetic).
2. **Bounds check** — target off-map → return `{moved:false, actionTaken:false}` (no turn).
3. **Stuck check** — if the mover `hasStateProperty('stuck')`, roll `escape_chance`: success → `removeState` and continue; failure → return `{moved:false, actionTaken:true}` (wastes the turn).
4. **Diagonal-corner block** — Brogue-style: can't cut diagonally past a wall/solid corner → return no-move.
5. **Solid actor at target?** `getSolidActorAt(newX,newY)` (returns only actors with `solid`). **If a solid actor is there**, enter the *solid-actor branch* and do the first that applies:
   a. Same scutigera chain member → ignore (no-move).
   b. **Pushable** + pusher has strength + valid push destination → push it, mover steps in → return `{moved:true}`.
   c. **Weapon attack style** (sweep/penetrate) handles it → return its result.
   d. **`applyCollisionEffects(target)`** — the bump-attack: rolls hit/miss, applies damage/effects. If it makes the target passable (e.g. killed, or a key unlocked a door) and not just-killed → **recurse** `tryMove` to move onto the freed tile.
   e. **Pausable** (clockwork) → toggle paused → return.
   f. **Switchable** → toggle → return.
   g. **Openable & closed** → spiked? jammed; locked? rejected (`plunk3`); else open it → return.
   h. **`collision_description`** (and no `collision_effect`) → show flavor text → return.
   i. Otherwise → "blocks your way" → return `{moved:false, actionTaken: attackAttempted}`.
   **The solid branch never falls through to movement** — bumping a solid actor is an action in itself.
6. **Non-solid combat actor at target?** (only reached when **no solid actor** is at the tile.) For a player moving into a non-solid actor that has a `collision_effect` and `stats.health` (e.g. the pink jelly): `applyCollisionEffects(target)`.
   - **Hit** (`hitLanded`) → return `{moved:false, actionTaken:true}` (combat is the action; player stays put).
   - **Miss** → apply the creature's `collision_effect` (slime) + `grab_state` (`stuck`) to the player, then **fall through** to movement so the player enters the tile.
   - **Killed by the hit** → fall through (tile is now free).
7. **Floor/void check** — no floor/platform under target and not flying → step in and `fall()` to the next level → return `{moved:true}`.
8. **Lunge attack style** (for reach weapons into empty tiles) → may handle and return.
9. **Commit the move** — record last position, liquid-track tint, set facing, **`this.x=newX; this.y=newY`**, update sprite.
10. **Post-move hooks** — viewport snap, passive item effects, auto-close doors behind, item pickup, walk descriptions, stairway/gateway transitions, lighting update, **submersion** (`updateSubmersionState` — relevant for `deep` actors), cloud/mist effects, pressure-plate/switch triggers.
