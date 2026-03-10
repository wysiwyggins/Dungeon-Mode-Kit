# Sound System

Dungeon Mode Kit uses [Howler.js](https://howlerjs.com/) to play sound effects from an audio sprite — a single audio file containing all sounds concatenated together, indexed by a JSON sprite map.

---

## Architecture

| File | Role |
|------|------|
| `sound.js` | `AudioManager` class — wraps Howler.js |
| `data/sounds.json` | Sprite map — maps sound IDs to `[startMs, durationMs]` |
| `assets/audio/sounds.mp3` | Audio sprite (MP3 format) |
| `assets/audio/sounds.ogg` | Audio sprite (OGG format) |
| `assets/audio/sounds.m4a` | Audio sprite (M4A format) |

### Playback API

```javascript
engine.playSound('hit');                                       // Play at default volume/pitch
engine.playSoundVaried('feets', 0.4, 0.1, 1.0, 0.06);       // Randomized volume & pitch
```

`playSoundVaried(soundName, volumeBase, volumeVariance, rateBase, rateVariance)` adds slight random variation to volume and pitch each time a sound plays, so repetitive actions like footsteps don't sound identical.

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

Source audio files and the audiosprite compiler live in the sibling directory `../audiosprite-master/`.

### Step 1: Add source audio

Place your MP3 file in the source directory:

```
../audiosprite-master/Sansula sounds/glass_break.mp3
```

The filename (without extension) becomes the sound's sprite ID. Use `snake_case` to match existing conventions.

### Step 2: Compile the sprite

Requires [FFmpeg](https://ffmpeg.org/) installed on your system.

```bash
cd ../audiosprite-master
node ./cli.js --output sounds --format howler2 "Sansula sounds"/*.mp3
```

This generates:

- `sounds.mp3`, `sounds.ogg`, `sounds.m4a`, `sounds.ac3` — audio files in multiple formats
- `sounds.json` — Howler.js v2 sprite map with timing data

### Step 3: Copy output into the game

```bash
cp sounds.mp3 sounds.ogg sounds.m4a ../Dungeon-Mode-Kit/assets/audio/
cp sounds.json ../Dungeon-Mode-Kit/data/sounds.json
```

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
|-----------|--------------|---------|---------|
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
    "use_verb": "Drink",
    "consumable": true
  }
}
```

### Actors (`data/actors.json`)

| Attribute | When It Plays | Default | Example |
|-----------|--------------|---------|---------|
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
|-----------|--------------|---------|---------|
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

All 35 sounds currently in the audio sprite:

| Sound ID | Status | Where Used |
|----------|--------|------------|
| `arrow_hit` | **Active** | Default projectile impact sound |
| `arrow_miss` | **Active** | Projectile misses target |
| `bow` | **Active** | Bowstring/weapon swipe sound (items.json) |
| `feets` | **Active** | Default footstep, varied pitch/volume |
| `fireball` | **Active** | Spell cast, burning state applied, fire spread |
| `gas` | **Active** | Explosive potion cloud detonation (`explode_sound` in items.json) |
| `glass` | **Active** | Breakable potion shatter on throw (`break_sound` in items.json) |
| `heal` | **Active** | Health potion use sound |
| `hit` | **Active** | Melee collision sound for most actors |
| `levelout` | **Data only** | `loaded_sound` in several prototype.json files |
| `lock` | **Unused** | Defined in sprite but never played |
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
| `tone3` | **Data only** | `loaded_sound` in some prototypes |
| `tone4` | **Unused** | — |
| `tone5` | **Unused** | — |
| `tone6` | **Unused** | — |
| `tone7` | **Unused** | — |
| `tone8` | **Unused** | — |
| `tone9` | **Unused** | — |

---

## Broken Sound References

These sounds are called in code but **do not exist in the audio sprite**. They fail silently (AudioManager checks before playing). These need source audio files added to the sprite.

| Sound ID | Called From | Context |
|----------|-----------|---------|
| `trap1` | `interface.js:2320` | Trap is triggered |
| `match` | `engine.js:5889`, `engine.js:5968` | Fire actors merge (cellular automata) |

---

## Missing Sounds

Game actions that currently produce no sound. Organized by category with suggested sound descriptions and how to wire each one in.

### Thrown Items & Explosions

| Sound Needed | Description | How to Wire In |
|-------------|-------------|---------------|
| **Generic thrown item thud** | Dull thud when a non-breakable thrown item lands on the ground | The throw system plays `collision_sound` on impact — items without one are silent. Add a default fallback or set `collision_sound` on throwable items. |

### Equipment & Inventory

| Sound Needed | Description | How to Wire In |
|-------------|-------------|---------------|
| **Equip weapon** | Metallic slide or click — blade drawn from sheath | Add `playSound` call in `executeWearItem()` in `interface.js` when the item has `weapon` attribute |
| **Wear armor** | Heavy cloth settling or plate clinking | Add `playSound` call in `executeWearItem()` in `interface.js` when the item has `wearable` attribute |
| **Unequip item** | Lighter version of equip — buckle unfasten, cloth shift | Add `playSound` call in `executeRemoveItem()` in `interface.js` |
| **Drop item** | Soft thud on stone floor | Add `playSound` call in `executeDropItem()` in `interface.js` |

### Status Effects

These all go in `data/states.json` as the `on_apply_sound` attribute. The engine already reads and plays this field — just needs values.

| State | Suggested Sound | `on_apply_sound` Value |
|-------|----------------|----------------------|
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
|-------------|-------------|---------------|
| **Door locked** | Rattle/jiggle of a locked handle | Use the existing `lock` sound (already in sprite, never called). Add `playSound('lock')` when a locked door rejects the player in `engine.js` collision handling. |
| **Stairway use** | Stone scraping or portal whoosh when transitioning levels | Add `playSound` call in the stairway interaction code in `engine.js` |
| **Fire spread** | Quick crackle when fire spreads to an adjacent tile | Add `playSound` call in the `_spreadFire` behavior in `engine.js` (use `playSoundVaried` to avoid machine-gun repetition) |
| **Gas/cloud spread** | Hissing puff as poison cloud expands | Add `playSound` call in `_spreadCloud` behavior in `engine.js` |

### Combat

| Sound Needed | Description | How to Wire In |
|-------------|-------------|---------------|
| **Critical hit** | Heavier impact — crunch or metallic slam on top of normal hit sound | Add a `playSound` call in the critical hit branch of damage calculation in `engine.js` |
| **Knockback impact** | Body-hitting-wall thud when knockback weapon shoves a target | Add `playSound` call in the knockback handling code in `engine.js` |

### UI

| Sound Needed | Description | How to Wire In |
|-------------|-------------|---------------|
| **Inventory open** | Paper rustle or bag opening | Add `playSound` call in `showPlayerInfo()` in `interface.js` |
| **Menu close** | Soft click or paper fold | Add `playSound` call in `hidePlayerInfo()` in `interface.js` |

### Victory & Events

| Sound Needed | Description | How to Wire In |
|-------------|-------------|---------------|
| **Win condition met** | Short fanfare or triumphant chime | Add `playSound` call in `checkWinConditions()` in `engine.js` when win triggers |
| **Exit unlocked** | Heavy stone door grinding open | Add `playSound` call in `unlockWinConditionStairways()` in `engine.js` |
| **Map revealed** | Magical shimmer / page unfurl | Add `playSound` call in the `reveal_map` use effect handler in `engine.js` |

---

## Quick Wins

Things that can be done right now with existing sounds and no new audio:

1. **Wire up `lock`** — The sound already exists in the sprite. Play it when a player tries to open a locked door.
2. **Add `death_sound` to all actors** — Most actors in `actors.json` have no `death_sound`. Adding `"death_sound": "ouch"` (or a new per-creature sound) is a one-line JSON change per actor.
3. **~~Add `collision_sound` to potions~~** — Done. Potions now use `break_sound: "glass"` for shatter and `explode_sound: "gas"` for cloud detonation.
4. **Create `trap1` and `match` source audio** — These are already called in code and just need the actual audio files added to the sprite.
