# Item System

Items are defined in `data/items.json` or prototype-specific `items.json` files.
Level-specific files are merged with global data at load — only define what's new or different.

## Basic Item Structure

```json
"item_id": {
  "name": "Display Name",
  "tileIndex": "TILE_NAME",
  "tint": "#FFFFFF",
  "attributes": {
    "pickupable": true,
    "visible": true
  }
}
```

---

## Root-Level Properties vs Attributes

Item JSON has two layers, and knowing which layer a property belongs to matters.

**Root-level properties** are a fixed set extracted by name in the `Item` constructor. They control rendering, identification, and stats. You cannot add new root-level properties without modifying engine code — unknown root-level keys are silently ignored.

**Attributes** (inside `"attributes": {}`) are an open-ended key-value store. The engine iterates all of them generically via `setAttribute()`. Designers can add any new gameplay attribute here without engine changes — the rest of the codebase reads them with `getAttribute()` and `hasAttribute()`.

**Rule of thumb:** if the property affects how the item *looks* or *identifies*, it's root-level. If it affects what the item *does*, it's an attribute.

### All root-level properties

| Property | Type | Purpose |
|----------|------|---------|
| `name` | string | Display name |
| `tileIndex` | string | Sprite tile name from the tileset |
| `tint` | string | Hex color tint (`"#FF0000"`) |
| `flipH` | boolean | Flip sprite horizontally |
| `flipV` | boolean | Flip sprite vertically |
| `ignore_darkness` | boolean | Render even in unlit tiles |
| `flickerTint` | boolean | Tint flickers (visual effect) |
| `identified` | boolean | `false` = starts unidentified |
| `unidentified_template` | string | Display name before identification |
| `identified_template` | string | Display name after identification |
| `use_description` | string | Message template shown when item is used |
| `effect_description` | string | Template variable for `[effect_description]` token |
| `template_vars` | object | Additional template substitution variables |
| `random_color` | boolean | Assign a random color per item type |
| `random_glyph_name` | boolean | Assign a random runic name per item type |
| `random_effect` | boolean | Generate a random potion effect |
| `random_value` | `[min, max]` | Random numeric value on spawn (e.g. gold nuggets) |
| `stats` | object | Item stat definitions (charges, fuel, etc.) |

Everything else goes in `attributes`. If you're not sure, put it in `attributes` — that's always safe.

> **Note for actors:** The `Actor` constructor has a bridge that copies `collision_sound`, `collision_effect`, `collision_description`, and `death_sound` from root-level into attributes. Items have no such bridge. For items, these properties must be inside `attributes`.

---

## Core Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `pickupable` | boolean | Item can be picked up by actors |
| `visible` | boolean | Item is rendered on the map |
| `stackable` | boolean | Multiple instances combine in inventory |
| `consumable` | boolean | Removed from inventory after successful use |
| `flammable` | boolean | Can be destroyed by fire |
| `pickup_sound` | string | Sound on pickup (default `"tone3"`) |
| `use_sound` | string | Sound on use (default `"tone1"`) |
| `description` | string | Shown in inventory action menu |

---

## Equipment (Wearable Items)

### Wearable Slots

| Slot | Position | Use Case |
|------|----------|----------|
| `"top"` | Above actor's head | Crowns, horns |
| `"middle"` | Actor's top tile | Helmets, masks |
| `"lower"` | Actor's base tile | Armor, cloaks |

### Wear Effects

`wear_effect` modifies the wearer's attributes while the item is equipped.

```json
"attributes": {
  "wearable": "lower",
  "wear_effect": { "defense": 3, "strength": 1 }
}
```

| Value type | On equip | On unequip |
|------------|----------|------------|
| Number | Add to attribute | Subtract from attribute |
| Boolean | Set attribute (stores original) | Restore original |
| `"toggle"` | Toggle attribute | Toggle back |

Effects only apply if the actor already has the target attribute.

---

## Collision Effects

`collision_effect` applies to actors the holder bumps into (melee weapons, keys, etc.).

```json
"attributes": {
  "collision_effect": { "health": -10 }
}
```

| Value type | Effect |
|------------|--------|
| Number | Add to target's stat/attribute (negative = damage) |
| Boolean | Set target's attribute |
| `"toggle"` | Toggle target's attribute |

If `health` drops to 0 or below, the target dies. See [COMBAT.md](/docs/COMBAT.md) Effects only apply if the target has the attribute.

### Weapon Attributes

| Attribute | Effect |
|-----------|--------|
| `weapon: true` | Marks item as a weapon (affects combat calculations) |
| `knockback: true` | Pushes target back on hit |
| `lifesteal: true` | Attacker heals for damage dealt |
| `critical: N` | Percentage chance to deal double damage |

---

## Use Effects (UI-Triggered)

Items with `use_verb` appear with an action button in the inventory UI.

| Attribute | Type | Description |
|-----------|------|-------------|
| `use_verb` | string | Inventory button label (`"Drink"`, `"Read"`, `"Zap"`) |
| `use_effect` | string or object | What happens on use |
| `use_sound` | string | Sound played on use |
| `use_description` | string | Message shown after use (supports `[item_name]`, `[effect_description]`, `[adjectives.yucky]` etc.) |

### Object format — stat and state effects

Pass an object to modify stats, attributes, or apply states directly:

```json
"use_effect": { "health": 20 }
"use_effect": { "apply_state": "poisoned" }
"use_effect": { "health": 15, "apply_state": "regenerating" }
```

### String format — named effects

| Effect string | Description |
|---------------|-------------|
| `"targeted_spell"` | Enters aiming mode; fires `spell_effect` at target tile (staffs) |
| `"identify_item"` | Opens item picker; player selects one unidentified item to reveal |
| `"teleport"` | Moves player to a random walkable tile |
| `"reveal_map"` | Marks all tiles as explored (fog of war) |
| `"aggravate_monsters"` | All hostile actors on the level become aware of the player |
| `"summon_monsters"` | Spawns 2–4 random monsters adjacent to the player |
| `"recharge_items"` | Restores all `charge_stat` items in inventory to full |
| `"shatter_walls"` | Destroys breakable solid actors within radius 3; triggers a screen shake, amber flash, and radiating tile fill effect |
| `"targeted_spell"` (bolt) | Bolt spells display a white-blue tile fill along the bolt path with screen shake, instead of a projectile sprite |
| `"darkness_field"` | Extinguishes all light-source items within radius 5 |

---

## Light Sources

An item with `light_source: true` emits light when carried in an actor's inventory, or when lying on the ground.

| Attribute | Type | Description |
|-----------|------|-------------|
| `light_source` | boolean | Emits light; uses item `tint` as light color |
| `lightRadius` | number | Light radius in tiles (default `5`) |
| `lightIntensity` | number | Light strength 0–1 (default `1.0`) |
| `burns_out_item` | string | Item type to replace this one when its `burns` stat hits 0 |
| `burnout_message` | string | Message shown to player when the item burns out |

```json
"torch": {
  "name": "Torch",
  "tileIndex": "BOX_VERTICAL_INVERSE_TOP",
  "tint": "#EC7505",
  "attributes": {
    "pickupable": true,
    "light_source": true,
    "lightRadius": 6,
    "burns_out_item": "torch_unlit",
    "burnout_message": "Your torch burns out."
  },
  "stats": {
    "burns": {
      "max": 500,
      "per_turn": -1,
      "display_label": "Fuel",
      "warnings": [{ "threshold": 0.1, "message": "Your torch is almost out!" }]
    }
  }
}
```

---

## Item Stats

Items support the same stat format as actors. Stats are defined at the top level alongside `attributes`.

Simple form (expands to `{ max: N, current: N }`):

```json
"stats": { "charges": 3 }
```

Extended form:

```json
"stats": {
  "burns": {
    "max": 500,
    "per_turn": -1,
    "display_label": "Fuel",
    "warnings": [{ "threshold": 0.1, "message": "Your torch is almost out!" }]
  }
}
```

| Stat field | Description |
|------------|-------------|
| `max` | Maximum value |
| `per_turn` | Change each turn (negative depletes, positive recharges) |
| `display_label` | Shows `"Label: current/max"` with a progress bar in the inventory UI |
| `warnings` | Array of `{ threshold, message }` — message fires when stat drops below `threshold × max` |
| `ready_at` | Used with `charge_stat` — minimum value needed to fire |
| `ready_message` | Message shown when a recharging item reaches `ready_at` (supports `[item_name]`) |

A stat with `display_label` is shown automatically in inventory. Items without `charge_stat` or `display_label` show no stat bar.

### Charged Items (Staffs)

Items that recharge and fire spells use `charge_stat` and `uses`:

| Attribute | Description |
|-----------|-------------|
| `charge_stat` | Name of the stat that tracks charge |
| `uses` | Number of casts per full charge (determines `ready_at` if not set explicitly) |
| `spell_effect` | Object describing the AoE: `{ "center": "actor_type", "radius": N, "outer": "actor_type" }` |
| `projectile_tile` | Tile name for the projectile animation |
| `projectile_tint` | Hex tint for the projectile |
| `cast_sound` | Sound played on cast |

```json
"staff_of_fireball": {
  "name": "Staff of Fireball",
  "tileIndex": "SOLIDUS",
  "identified": false,
  "unidentified_template": "[substances.substances] staff",
  "identified_template": "Staff of Fireball",
  "attributes": {
    "pickupable": true,
    "use_verb": "Zap",
    "use_effect": "targeted_spell",
    "charge_stat": "pow",
    "uses": 1,
    "spell_effect": { "center": "intense_fire", "radius": 1, "outer": "fire" },
    "projectile_tile": "OPAQUE_INVERSE_DIAMOND_SUITE",
    "projectile_tint": "#FF6600"
  },
  "stats": {
    "pow": {
      "max": 800,
      "per_turn": 1,
      "ready_message": "Your [item_name] is fully charged!"
    }
  }
}
```

---

## Identification System

Items with `"identified": false` have two display names — an unidentified placeholder and a revealed true name. All instances of the same item type share the same placeholder within a run.

| Field | Description |
|-------|-------------|
| `identified` | `false` = item starts unidentified |
| `unidentified_template` | Display name before identification |
| `identified_template` | Display name after identification |
| `random_color` | Assigns a random consistent color per item type; use `[color]` in templates |
| `random_glyph_name` | Assigns a random runic two-word name per item type; use `[glyph_name]` in templates |

Templates support substitution tokens in `[brackets]`:

| Token | Resolves to |
|-------|-------------|
| `[color]` | Random color name assigned to this item type (requires `random_color: true`) |
| `[glyph_name]` | Random runic name assigned to this item type (requires `random_glyph_name: true`) |
| `[reagents.reagents]` | Random entry from `data/reagents.json` |
| `[substances.substances]` | Random entry from `data/substances.json` |
| `[adjectives.yucky]` | Random entry from the `yucky` list in `data/adjectives.json` |
| `[item_name]` | The item's current display name (identified or not) |

### Potions

```json
"health_potion": {
  "name": "Potion",
  "tileIndex": "FEMALE_SYMBOL",
  "random_color": true,
  "identified": false,
  "unidentified_template": "[color] potion",
  "identified_template": "Potion of Healing",
  "use_description": "The [item_name] tastes [adjectives.wine_descriptions].",
  "attributes": {
    "pickupable": true,
    "stackable": true,
    "consumable": true,
    "use_verb": "Drink",
    "use_effect": { "health": 20 }
  }
}
```

### Scrolls

```json
"scroll_of_identify": {
  "name": "Scroll",
  "tileIndex": "LATIN_SMALL_LETTER_S",
  "random_glyph_name": true,
  "identified": false,
  "unidentified_template": "[glyph_name] scroll",
  "identified_template": "Scroll of Identify",
  "attributes": {
    "pickupable": true,
    "stackable": true,
    "consumable": true,
    "use_verb": "Read",
    "use_effect": "identify_item"
  }
}
```

---

## Explosive Items

| Attribute | Type | Description |
|-----------|------|-------------|
| `explosive` | boolean | Item can explode |
| `breakable` | boolean | Item shatters on impact when thrown |
| `fire_explosion` | boolean | Explosion spawns fire instead of a gas cloud |
| `explosion_radius` | number | Radius of fire burst (default `2`) |
| `cloud_lifetime` | number | Lifetime of a gas cloud in turns (default `10`) |

### Detonation rules

- `explosive` + `breakable` → detonates on throw **and** when ignited by fire (potions)
- `explosive` without `breakable` → detonates **only** when ignited by fire (powder kegs)

**Fire burst** (`fire_explosion: true`): spawns `intense_fire` at center and adjacent tiles, `fire` at the outer radius. Breakable solid actors in range have a 60% chance to be destroyed.

**Gas cloud** (default): spawns a spreading cloud that applies the item's `use_effect` to actors standing in it.
