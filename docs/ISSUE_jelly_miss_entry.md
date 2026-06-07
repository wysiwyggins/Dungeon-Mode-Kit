# Open Issue: missing a non-solid jelly doesn't move the player into its tile

**Status:** Unresolved / paused. Splitting + `stuck` state work; the **miss-into-tile** behavior does not.
**Last touched:** 2026-06-07
**Related:** `docs/IDEAS.md` line ~54 (Splitting creatures); the `stuck` state and `pink_jelly`/splitting features (CHANGELOG 1.10b).

## Intended behavior

The `pink_jelly` is **non-solid**. When the player presses into the jelly's tile it should count as an attack:

- **Hit** → normal combat: jelly takes damage / may split; player stays on the original tile.
- **Miss** → the jelly "catches" the player: the player **moves onto the jelly's tile**, takes the jelly's `collision_effect` (slime damage), and gains the **`stuck`** state & shows a deep attribute visual effect. While stuck, each move attempt rolls `escape_chance` (~0.33); failure wastes the turn.

## Symptom (still reproducing)

Attacking the jelly and **missing** does nothing visible: the player stays put, takes no slime damage, and does not become `stuck`. Hits behave correctly. Observed console:

```
Hit roll: 57 vs 50% (50 * 0.987^0) = MISS   (engine.js:6236)
Miss: Player -> Pink Jelly                  (engine.js:6603, _showMissMessage)
Hit roll: 79 vs 50% = MISS
Miss: Pink Jelly -> Player
```

So the player and jelly trade missed attacks across turns while adjacent, but the player never enters the jelly's tile on a miss.

## What is implemented (current code)

### `engine.js` — `Actor.tryMove(newX, newY)`

1. **Stuck interceptor** at the top (after the bounds check, ~`engine.js:6835`): if `hasStateProperty('stuck')`, roll `escape_chance`; success → `removeState` and fall through to move; failure → `return { moved:false, actionTaken:true }` (wastes the turn).
2. **Non-solid attack-on-bump branch** (~`engine.js:7029-7062`), placed *after* the solid-actor branch (`getSolidActorAt`, ~`6866`) and *before* the floor/fall check:
   - `const nonSolid = getOtherActorAt(newX,newY,this)`; gated on `!isDead && !solid && collision_effect && stats.health !== undefined` and `isPlayerControlled()`.
   - `const result = this.applyCollisionEffects(nonSolid)` (player attacks jelly).
   - If `result.wasCombat && !result.targetKilled`: **hit** (`result.hitLanded`) → `return` stay-put; **miss** → apply the jelly's `collision_effect` to the player via `nonSolid._applyEffectSource(...)`, show `getCollisionDescription`, `flash()`, apply `grab_state` (`stuck`), then **fall through** to the normal-movement code (`this.x = newX; this.y = newY`, ~`7097`).

### `engine.js` — `Actor.applyCollisionEffects` (~`6290`)

Returns (added during debugging): `{ effectApplied, targetPassable, targetKilled, attackAttempted, wasCombat, hitLanded }`. `hitLanded = isCombatTarget && damageSource !== null && damageHits` is the authoritative hit flag (`damageHits` from the roll at `~6220-6233`).

### Data

- `data/states.json` → `stuck`: `{ duration:-1, stuck:true, escape_chance:0.33, ... }`.
- `data/actors.json` → `pink_jelly`: `personality:"aggressive_melee"`, `collision_effect:{health:-2}`, `collision_sound:"hit"`, `collision_description`, `split_sound:"step_mud"`, `grab_state:"stuck"`, attributes incl. `deep:true`, `accuracy:50`, `splits:true`, `split_min_health:4`, `stats.health` (currently 40).

## Debugging history (what's been tried)

1. **First version** branched on `result.effectApplied` to detect a hit. Hypothesis: `effectApplied` is an unreliable hit/miss proxy — utility sources (e.g. a carried **key**, `collision_effect:{locked:false}`) apply on a miss and set `effectApplied=true`, wrongly taking the stay-put path. **Fix applied:** added `hitLanded`/`wasCombat` to the return and branched on `hitLanded`. **Result: bug persists** — so this was (at most) not the whole story.

## The core contradiction (key to the next session)

`_showMissMessage` (which logs `Miss: <attacker> -> <target>`, `engine.js:6603`) is **only** reached from inside `applyCollisionEffects`, and only when `isCombatTarget && !damageHits`. The log shows `Miss: Player -> Pink Jelly`, so:

- `Player.applyCollisionEffects(jelly)` **definitely runs**, and
- `isCombatTarget` is **true** (so a `damageSource` exists), which means `wasCombat` is **true**.

The **only** call site that runs `Player.applyCollisionEffects(jelly)` for a *non-solid* jelly is the new branch at `engine.js:7033` (the solid-actor branch at `6866` is gated on `getSolidActorAt`, which returns null for the non-solid jelly). Therefore the new branch **is executing**, `wasCombat` is true, and on a miss `hitLanded` is false → the miss path *should* run and fall through to movement.

**Yet the player does not move.** This contradicts the code as written. Resolving this contradiction is the crux. Candidate explanations not yet ruled out:

1. **The fall-through movement is blocked downstream.** After the miss path, `tryMove` continues to the floor-check (`~7065`), lunge (`~7081`), then the position assignment (`~7097`). Something between the miss path and `this.x = newX` may `return` early for the jelly's tile. *Action: read `engine.js:7064`–`7110` line by line; confirm the assignment is reached when standing-target is a non-solid actor.*
2. **The "Miss" log comes from a different call site than assumed.** Re-verify by adding a unique `console.log('NONSOLID BRANCH reached', nonSolid?.name, result.wasCombat, result.hitLanded)` immediately after line `7033`, and a log right before `this.x = newX` (~`7097`). Run, miss the jelly, and see which logs fire. This will definitively show whether the branch runs and whether the move assignment is reached.
3. **The player attacks via a path that ISN'T `tryMove`'s non-solid branch.** Although analysis says only `7033` calls it, instrument `applyCollisionEffects` entry (`console.trace()` or log `this.name, target.name` at the top) to capture the actual call stack for the `Player -> Pink Jelly` miss. If the stack is NOT `tryMove`→non-solid-branch, find the real caller (re-examine `input.js` movement handlers ~`1240-1290`, auto-walk ~`600-666`, and any adjacency-attack helper).
4. **The move happens but is invisible / immediately reversed.** Check whether `updateSubmersionState` (`deep` jelly!) or `checkCloudEffects` after the move snaps the player back, or whether the player IS on the tile but the sprite/camera doesn't reflect it. The jelly has `deep:true` — entering a `deep` actor's tile triggers `submerge()`; verify submersion doesn't interfere with position. *Action: after a miss, log `this.x,this.y` and inspect whether the player actually relocated.*

## Recommended next steps (cheap, decisive)

1. Add the three temporary logs from candidate #2/#3 above (branch-reached, pre-move-assignment, `applyCollisionEffects` entry with `console.trace`). One playtest miss will collapse the hypothesis space.
2. Based on which logs fire:
   - Branch reached + pre-move log fires but no visible move → candidate #4 (movement/submersion/render); inspect post-move position and `submerge`.
   - Branch reached but pre-move log does NOT fire → an early `return` in `7064`–`7096`; read that span.
   - Branch NOT reached → candidate #3; the `Miss` log's real caller is elsewhere; follow the `console.trace`.

## Scope / cost note

This interaction touches movement, combat resolution, the effect/state pipeline, and the `deep`/submersion system simultaneously, which is why it's been expensive to pin down. Consider, when resuming, whether a **simpler model** is acceptable: e.g. handle the entire "bump a non-solid creature" interaction explicitly at the input/movement layer (decide hit/miss once, then either attack-in-place or move-and-grab) rather than threading it through `applyCollisionEffects`'s shared combat return. A dedicated, self-contained code path may be cheaper to reason about than reusing the combat pipeline for both the attack and the grab.

## Files involved

- `engine.js` — `Actor.tryMove` (stuck interceptor ~`6835`; non-solid branch ~`7029-7062`; movement tail ~`7064-7110`), `Actor.applyCollisionEffects` (~`6118-6296`, return at `~6290`), `_applyEffectSource` (~`6300`), `_showMissMessage` (~`6603`), `getOtherActorAt` (~`9028`), `updateSubmersionState`/`submerge` (~`7753`/`7621`).
- `input.js` — movement handlers (~`1240-1290`), auto-walk (~`600-666`), `checkMovementHazard` (~`1394`).
- `data/states.json` — `stuck`.
- `data/actors.json` — `pink_jelly` (note `deep:true` + `grab_state:"stuck"`).
