# Spells

A spell is an entry in `data/spells.json` that describes a chain of effects an actor can trigger, usually via an item verb. Each spell says how it travels (`delivery`), what it looks and sounds like (`projectile`, `vfx`, `cast_sound`), and what it does when it hits (`effect`). A projectile stops at the first thing in its path, while a bolt passes through everything in a line. A projectile shows its `projectile` tile in flight. A bolt draws its `vfx` along the line, and an area spell plays its `vfx` once on the caster. Some spells affect an area where they land, set by their `effect`. Fireball uses `radius` to spread fire around the tile it hits, and Obstruction uses `fill_radius` to fill nearby tiles with crystal. Three more deliveries need no aim at all. A `burst` hits every creature within its `radius` of the caster, a `sight` spell hits every creature the caster can see, and a `level` spell hits every creature on the level. `affects` can narrow any of them to the caster's enemies or allies. Area spells can also lay actors on the floor, break walls or summon creatures. Staffs, wands, scrolls and some monster personalities use a spell by naming it, as in `"spell": "fireball"`, so several items can share one spell without copying its details. The engine turns the spell into regular item attributes such as `spell_effect` and `projectile_tile`. An item's own attributes win over its spell's, so you can change one part of a spell for a single item and leave the rest alone. In this file `effect` means what the spell does in the game. Purely visual effects live in `data/vfx.json`.

```json
"fireball": {
    "name": "Fireball",
    "delivery": "projectile",
    "projectile": {
      "tile": "WHITE_FLORETTE",
      "tint": "#FF6600"
    },
    "cast_sound": "fireball",
    "effect": {
      "center": "intense_fire",
      "outer": "fire",
      "radius": 1
    }
  }
```

```json
"lightning": {
    "name": "Lightning",
    "delivery": "bolt",
    "vfx": "lightning_bolt",
    "cast_sound": "squarewave",
    "effect": {
      "bolt_damage": -15
    }
  }
```

```json
"discord_wave": {
    "name": "Discord",
    "delivery": "burst",
    "radius": 5,
    "effect": {
      "apply_state": {
        "state": "discordant",
        "duration": 30
      }
    }
  }
```

## Spell fields

| Field | What it does |
| --- | --- |
| `name` | Shown in cast messages ("You cast Fireball!") |
| `delivery` | `projectile`, `bolt`, `burst`, `sight` or `level` |
| `range` | How far it can be aimed. Left out, it uses the item type's `spell_range`. For `sight`, how far the caster sees |
| `radius` | How far a `burst` reaches from the caster (default 5). Diagonals count as one step, and it reaches through walls |
| `affects` | Area spells only. `"hostile"` for the caster's enemies or `"allies"` for everyone else. Left out, it hits every creature. The caster is never hit |
| `message` / `empty_message` | Area spells only. What the player sees when the cast affected something, or nothing |
| `target_filter` | What aiming cycles through (see [Aiming in ITEMS.md](ITEMS.md#aiming)) |
| `projectile` | The tile and tint a projectile flies as |
| `vfx` | Drawn along a bolt, or played once on the caster of an area spell |
| `cast_sound` | Played when cast. Area spells play none unless it's set, since reading a scroll already makes a sound |
| `effect` | What the spell does (below) |

## Effects

A spell's `effect` combines any of these.

**Where a projectile lands:**
- `center`, `outer` and `radius` spawn actors around the landing tile, like fireball's flames.
- `fill` and `fill_radius` flood an actor over the open ground there, like obstruction's crystal.
- `tunnel` bores through breakable walls toward the aim point.
- `blink_self` moves the caster to the landing tile.

**On each creature hit:**
- `target_effect` changes its stats: `{ "health": -10 }`.
- `apply_state` gives it a state, by name or as `{ "state": "slowed", "duration": 20 }`.
- `remove_states`, `teleport_target`, `beckon_target`, `clone_target` and `polymorph_target` do what they say.
- `dominate_target` makes it the caster's ally. The more hurt it is, the better the odds, and it always works below a fifth of its health. Creatures with `no_dominate` can't be tamed.
- `alert_target` makes a hostile creature hunt the caster.

A projectile applies these to the creature it hits. An area spell applies them to every creature it reaches.

**Around the caster (area spells):**
- `fill` lays an actor on the floor nearby, like sanctuary's glyphs. A non-solid actor can go under creatures.
- `shatter` breaks every breakable wall in the area.
- `summon` calls up creatures. Set it to `true` for the floor's random monsters, or name actors. `summon_min`, `summon_max` and `summon_radius` set how many and how far. `summon_allied` makes them fight for the caster, as the scroll of swarming's insects do.

**Along a bolt:** `bolt_damage` hurts every creature on the line.

Items that cast a spell can replace its result text with `effect_message` and `fail_message`. Both take `[item_name]` and `[target_name]`.

## Allies

A summoned or dominated creature fights for whoever brought it over. It attacks that leader's enemies, and they attack it. It runs the `serve_summoner` behavior in place of its own: it fights nearby enemies, or else it stays close to its leader. The player swaps places with their own allies instead of attacking them. A player's allies are saved with the floor. Allies within 5 tiles that can see the player follow them through stairways. Allies fight by walking into enemies, so a tamed archer won't shoot.

## Who casts

- **Items.** A staff or wand casts its spell with `"use_effect": "targeted_spell"`, aiming unless the spell is an area spell. A scroll casts an area spell with `"use_effect": "cast_spell"`. When items are loaded, the spell is turned into flat attributes on the item (`spell_effect`, `spell_name`, `projectile_tile` and so on). That's why an item can override any one part.
- **Monsters.** The `cast_spell` behavior casts the personality's `spell` at the nearest enemy in sight, every `spell_cooldown` turns. An area spell goes off when an enemy is in reach. A spell that summons, fills or shatters goes off when an enemy is in sight. `bolt_attack` is a bolt-only version with its own overrides.

Both use the same casting code (`castSpell` in `engine/dungeon-engine/spellcasting.js`), so a spell works the same whoever casts it.
