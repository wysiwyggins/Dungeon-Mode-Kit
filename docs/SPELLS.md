# Spells

A spell is an entry in `data/spells.json` that describes a chain of effects an actor can trigger, usually via an item verb. Each spell says how it travels (`delivery`), what it looks and sounds like (`projectile`, `vfx`, `cast_sound`), and what it does when it hits (`effect`). A projectile stops at the first thing in its path, while a bolt passes through everything in a line. Some spells affect an area where they land, set by their `effect`. Fireball uses `radius` to spread fire around the tile it hits, and Obstruction uses `fill_radius` to fill nearby tiles with crystal. Two more deliveries need no aim at all. A `burst` hits every creature within its `radius` of the caster, and a `sight` spell hits every creature the caster can see. `affects` can narrow either one to the caster's enemies or allies. Staffs, wands, scrolls and some monster personalities use a spell by naming it, as in `"spell": "fireball"`, so several items can share one spell without copying its details. The engine turns the spell into regular item attributes such as `spell_effect` and `projectile_tile`. An item's own attributes win over its spell's, so you can change one part of a spell for a single item and leave the rest alone. In this file `effect` means what the spell does in the game. Purely visual effects live in `data/vfx.json`.

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
