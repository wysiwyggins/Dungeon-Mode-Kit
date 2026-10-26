# Sound System

Dungeon Mode Kit uses [Howler.js](https://howlerjs.com/) to play sound effects from an audio sprite — a single audio file containing all sounds concatenated together, indexed by a JSON sprite map.

---

## Architecture

| File | Role |
| ------ | ------ |
| `sound.js` | `AudioManager` class — wraps Howler.js |
| `data/sounds.json` | Sprite map — maps sound IDs to `[startMs, durationMs]` |
| `assets/audio/sounds.mp3` | Audio sprite (MP3 format) |
| `assets/audio/sounds.ac3` | Audio sprite (AC3 format) |
| `assets/audio/sounds.m4a` | Audio sprite (M4A format) |
| `assets/audio/source/` | Per-sound source files, one per sprite ID |
| `tools/build-sound-sprite.js` | Compiles `source/` into the sprite + `data/sounds.json` |

### Playback API

```javascript
engine.playSound('hit');                                       // Play at default volume/pitch
engine.playSoundVaried('feets', 0.4, 0.1, 1.0, 0.06);       // Randomized volume & pitch
```

`playSoundVaried(soundName, volumeBase, volumeVariance, rateBase, rateVariance)` adds slight random variation to volume and pitch each time a sound plays, so repetitive actions like footsteps don't sound identical.

### Sound Player

`editors/sound-player.html` lists every sound in the sprite as a clickable chip, with a filter box and volume/rate sliders. It reads `data/sounds.json` directly, so anything added to the sprite appears there without a code change — handy for picking a sound before wiring it into a data file.

### Future: Sound Manager

Planned, not built yet. It's waiting until the project is hosted with server-side storage or Node features. The goal is to grow the Sound Player into a manager that can add sounds without the manual steps below.

- **Pipeline:** done. Source files are in `assets/audio/source/` and `tools/build-sound-sprite.js` exports `buildSoundSprite()`. An upload/rename endpoint only has to write to `source/` and call it.
- **Nice-to-haves:** a usage cross-reference that scans data files and code for each sound ID and flags unused or missing IDs (replacing the hand-kept table below), trim/normalize on import, and a waveform preview.

### Debug Console

Open the browser console to test sounds at runtime:

```javascript
audioDebug.list()           // List all available sound IDs
audioDebug.play('fireball') // Play a sound
audioDebug.volume(0.5)      // Set master volume (0-1)
audioDebug.mute()           // Mute all audio
audioDebug.unmute()         // Unmute
audioDebug.test()           // Play a test sequence
```

---

## Adding New Sounds

Source audio and the sprite compiler both live in this repo. `tools/build-sound-sprite.js` is a Node port of [audiosprite](https://github.com/tonistiigi/audiosprite) (MIT) with no npm dependencies.

### Step 1: Add source audio

Put the file in the source directory:

```
assets/audio/source/glass_break.mp3
```

The filename (without extension) becomes the sound's sprite ID. Use `snake_case` to match existing conventions. MP3, WAV, OGG, M4A, AIFF, and FLAC are accepted. To rename a sound, rename its source file and update any data files that reference the old ID.

### Step 2: Compile the sprite

Requires [FFmpeg](https://ffmpeg.org/) on your PATH.

```bash
node tools/build-sound-sprite.js            # rebuild everything
node tools/build-sound-sprite.js --dry-run  # list the sounds that would be packed
```

This writes the game files directly:

- `assets/audio/sounds.mp3`, `sounds.ac3`, `sounds.m4a` — the concatenated sprite
- `data/sounds.json` — sprite map (`urls` + `sprite: { id: [startMs, durationMs] }`)

Each sound starts on a whole second with at least 1s of silence after it, the same layout the old `audiosprite --format howler2` command produced. Use `--source`, `--out`, and `--json` to build somewhere else (e.g. into `/tmp` to compare). The script also exports `buildSoundSprite(options)` so a future server-side sound manager can call it directly.

### Step 4: Wire it up

Most sounds are data-driven — add the appropriate attribute to a JSON data file (see next section). No code changes needed for data-driven sounds. For sounds triggered by game logic, call `engine.playSound('your_sound_id')` at the appropriate point in the code.

### Step 5: Test

```javascript
audioDebug.play('glass_break')  // Verify it plays
audioDebug.list()                // Confirm it appears in the sprite list
```

---

## Sound Attributes Reference

Sounds are primarily wired through JSON data files. The engine reads these attributes and plays the corresponding sound automatically at the right moment.

### Items (`data/items.json`)

| Attribute | When It Plays | Default | Example |
| ----------- | -------------- | --------- | --------- |
| `collision_sound` | Item hits a target (melee weapon strike or thrown projectile impact) | `"arrow_hit"` for projectiles | `"bow"`, `"tap2"`, `"plunk3"` |
| `break_sound` | Breakable item shatters on throw impact | none | `"glass"` |
| `explode_sound` | Explosive+breakable item detonates into a cloud on throw (non-fire) | none | `"gas"` |
| `use_sound` | Player uses/consumes the item | `"tone1"` | `"heal"`, `"swallow"`, `"magic"` |
| `cast_sound` | Spell item is cast (targeted spells) | `"fireball"` | `"fireball"` |
| `pickup_sound` | Item is picked up from the ground | none | `"pickup"` |

```json
"health_potion": {
  "name": "Health Potion",
  "attributes": {
    "use_sound": "heal",
    "use_verb": "Quaff",
    "consumable": true
  }
}
```

### Actors (`data/actors.json`)

| Attribute | When It Plays | Default | Example |
| ----------- | -------------- | --------- | --------- |
| `collision_sound` | Actor is hit by an attack or collides with player | none | `"hit"` |
| `death_sound` | Actor dies | none | `"ouch"` |
| `entry_sound` | Player steps onto this actor's tile (terrain, liquid) | none | `"step_mud"` |

```json
"skeleton": {
  "name": "Skeleton",
  "collision_sound": "hit",
  "death_sound": "ouch",
  "attributes": { "hostile": true }
}
```

### States (`data/states.json`)

| Attribute | When It Plays | Default | Example |
| ----------- | -------------- | --------- | --------- |
| `on_apply_sound` | Status effect is applied to an actor | none | `"fireball"` (burning) |
| `on_remove_sound` | Status effect wears off | none | — |

```json
"burning": {
  "name": "Burning",
  "duration": 5,
  "on_apply_sound": "fireball",
  "on_apply_message": "[actor_name] catches fire!"
}
```

### Prototypes (`prototypes/*/prototype.json`)

| Attribute | When It Plays | Example |
|-----------|--------------|---------|
| `loaded_sound` | Level finishes loading | `"tone3"`, `"levelout"` |

```json
{
  "name": "Dungeon",
  "loaded_sound": "levelout"
}
```

---

## Current Sound Library

All 37 sounds currently in the audio sprite:

| Sound ID | Status | Where Used |
| ---------- | -------- | ------------ |
| `arrow_hit` | **Active** | Default projectile impact sound |
| `arrow_miss` | **Active** | Projectile misses target |
| `bow` | **Active** | Bowstring/weapon swipe sound (items.json) |
| `extinguish` | **Active** | Torch doused by hand, or burning out on its own |
| `feets` | **Active** | Default footstep, varied pitch/volume |
| `fireball` | **Active** | Spell cast, burning state applied, fire spread |
| `gas` | **Active** | Explosive potion cloud detonation (`explode_sound` in items.json) |
| `glass` | **Active** | Breakable potion shatter on throw (`break_sound` in items.json) |
| `heal` | **Active** | Health potion use sound |
| `hit` | **Active** | Melee collision sound for most actors |
| `levelout` | **Active** | `loaded_sound` in prototypes, default ceremony build sound |
| `lock` | **Active** | Unlock/reveal *success* — stairway unlocked, hidden thing revealed (default `reveal_sound`), `_unlockTarget`. Not the rejection sound: a locked door you can't open plays `plunk3`. |
| `magic` | **Active** | Scroll use sound |
| `ouch` | **Active** | Player/actor death sound |
| `pickup` | **Active** | Item pickup |
| `plunk1` | **Unused** | Only in debug test sequence |
| `plunk2` | **Unused** | — |
| `plunk3` | **Active** | Actor knockdown, war hammer collision |
| `push1` | **Active** | Pushing objects |
| `scrub2` | **Unused** | — |
| `scrub3` | **Unused** | — |
| `squarewave` | **Unused** | — |
| `step_mud` | **Active** | Stepping on muddy terrain (entry_sound) |
| `swallow` | **Active** | Drinking potions (use_sound) |
| `tap1` | **Active** | Blocked movement, UI interaction, identify item |
| `tap2` | **Active** | Menu selection, arrow collision, equipment menu |
| `tap3` | **Unused** | — |
| `tone1` | **Active** | Default item use sound |
| `tone2` | **Unused** | — |
| `tone3` | **Active** | Default pickup sound, `loaded_sound` in some prototypes, shaman summon |
| `tone4` | **Unused** | — |
| `tone5` | **Active** | Default heal_ally sound |
| `tone6` | **Unused** | — |
| `tone7` | **Unused** | — |
| `tone8` | **Unused** | — |
| `tone9` | **Unused** | — |
| `torch` | **Active** | Lighting a torch (its counterpart is `extinguish`) |

---

---

## Missing Sounds

Game actions that currently produce no sound. Organized by category with suggested sound descriptions and how to wire each one in.

### Thrown Items & Explosions

| Sound Needed | Description | How to Wire In |
|-------------|-------------|---------------|
| **Generic thrown item thud** | Dull thud when a non-breakable thrown item lands on the ground | The throw system plays `collision_sound` on impact — items without one are silent. Add a default fallback or set `collision_sound` on throwable items. |

### Equipment & Inventory

| Sound Needed | Description | How to Wire In |
| ------------- | ------------- | --------------- |
| **Equip weapon** | Metallic slide or click — blade drawn from sheath | Add `playSound` call in `executeWearItem()` in `ui/menus.js` when the item has `weapon` attribute |
| **Wear armor** | Heavy cloth settling or plate clinking | Add `playSound` call in `executeWearItem()` in `ui/menus.js` when the item has `wearable` attribute |
| **Unequip item** | Lighter version of equip — buckle unfasten, cloth shift | Add `playSound` call in `executeRemoveItem()` in `ui/menus.js` |
| **Drop item** | Soft thud on stone floor | Add `playSound` call in `executeDropItem()` in `ui/menus.js` |

### Status Effects

These all go in `data/states.json` as the `on_apply_sound` attribute. The engine already reads and plays this field — just needs values.

| State | Suggested Sound | `on_apply_sound` Value |
| ------- | ---------------- | ---------------------- |
| **Poisoned** | Wet bubbling or hissing | `"poison_apply"` (new) |
| **Stunned** | Sharp electric zap or bell ring | `"stun_apply"` (new) |
| **Sleeping** | Gentle lullaby note or soft chime | `"sleep_apply"` (new) |
| **Confused** | Wobbly/warped tone, like a detuned note | `"confuse_apply"` (new) |
| **Hasted** | Quick ascending whoosh | `"haste_apply"` (new) |
| **Slowed** | Heavy descending tone, like slowing down | `"slow_apply"` (new) |
| **Regenerating** | Warm shimmer, sparkling heal | `"regen_apply"` (new) |
| **Paralyzed** | Stiffening crackle, electric lock-up | `"paralyze_apply"` (new) |

Optional: Add `on_remove_sound` values as well (reversal of the apply sound).

### Environment & Doors

| Sound Needed | Description | How to Wire In |
| ------------- | ------------- | --------------- |
| **Door locked** | Rattle/jiggle of a locked handle | Locked doors currently play `plunk3` in `tryMove()` (`engine/actor/movement.js`); a dedicated rattle would replace it there. (`lock` is the unlock/success sound, so don't reuse it for rejection.) |
| **Stairway use** | Stone scraping or portal whoosh when transitioning levels | Add `playSound` call in `useStairway()` in `engine/dungeon-engine/stairways.js` |
| **Fire spread** | Quick crackle when fire spreads to an adjacent tile | Add `playSound` call in the `fire_spread` behavior in `behaviors/environment.js` (use `playSoundVaried` to avoid machine-gun repetition) |
| **Gas/cloud spread** | Hissing puff as poison cloud expands | Add `playSound` call in the `cloud_spread` behavior in `behaviors/environment.js` |

### Combat

| Sound Needed | Description | How to Wire In |
| ------------- | ------------- | --------------- |
| **Critical hit** | Heavier impact — crunch or metallic slam on top of normal hit sound | Add a `playSound` call in the critical hit branch of damage calculation (`checkCriticalHit` in `engine/actor/combat.js`) |
| **Knockback impact** | Body-hitting-wall thud when knockback weapon shoves a target | `_procKnockback()` (`engine/actor/combat.js`) plays the generic `push1`; swap in a dedicated thud there. |

### UI

| Sound Needed | Description | How to Wire In |
| ------------- | ------------- | --------------- |
| **Inventory open** | Paper rustle or bag opening | Add `playSound` call in `showPlayerInfo()` in `ui/panels.js` |
| **Menu close** | Soft click or paper fold | Add `playSound` call in `hidePlayerInfo()` in `ui/panels.js` |

### Victory & Events

| Sound Needed | Description | How to Wire In |
| ------------- | ------------- | --------------- |
| **Win condition met** | Short fanfare or triumphant chime | Add `playSound` call in `checkWinConditions()` in `engine/dungeon-engine/progression.js` when win triggers |
| **Exit unlocked** | Heavy stone door grinding open | `unlockWinConditionStairways()` (`engine/dungeon-engine/progression.js`) plays the generic `lock`; swap in a dedicated grind there. |
| **Map revealed** | Magical shimmer / page unfurl | Add `playSound` call in the `reveal_map` use effect handler (`executeItemEffect` in `engine/actor/items.js`) |

---

## Quick Wins

Things that can be done right now with existing sounds and no new audio:

1. **Wire up `lock`** — The sound already exists in the sprite. Play it when a player tries to open a locked door.
2. **Add `death_sound` to all actors** — Most actors in `actors.json` have no `death_sound`. Adding `"death_sound": "ouch"` (or a new per-creature sound) is a one-line JSON change per actor.
3. **~~Add `collision_sound` to potions~~** — Done. Potions now use `break_sound: "glass"` for shatter and `explode_sound: "gas"` for cloud detonation.
4. **Create `trap1` and `match` source audio** — These are already called in code and just need the actual audio files added to the sprite.
