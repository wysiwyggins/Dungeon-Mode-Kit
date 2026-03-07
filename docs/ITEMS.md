# Item System

Items are defined in `data/items.json` or prototype-specific `items.json` files. All item behavior is driven by attributes.

## Basic Item Structure

```json
"item_id": {
  "name": "Display Name",
  "tileIndex": "TILE_NAME",
  "tint": "#HEXCOLOR",
  "attributes": {
    "pickupable": true,
    "visible": true,
    ...
  }
}
```

## Core Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `pickupable` | boolean | Item can be picked up by actors |
| `visible` | boolean | Item is rendered on the map |
| `stackable` | boolean | Multiple items combine in inventory |
| `consumable` | boolean | Item is removed from inventory after use |
| `flammable` | boolean | Item can be destroyed by fire |

## Sound Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `pickup_sound` | string | `"tone3"` | Sound played when player picks up item |
| `use_sound` | string | `"tone1"` | Sound played when player uses item |

## Equipment (Wearable Items)

Items with a `wearable` attribute are automatically equipped when picked up (until we add UI).

### Wearable Slots

| Slot | Position | Use Case |
|------|----------|----------|
| `"top"` | Above actor's head (y-2) | Crowns, horns, halos |
| `"middle"` | Actor's top tile (y-1) | Helmets, masks |
| `"lower"` | Actor's base tile (y) | Armor, cloaks |

### Wear Effects

The `wear_effect` attribute modifies the wearer's attributes while equipped.

```json
"attributes": {
  "wearable": "top",
  "wear_effect": { "strength": 2 }
}
```

| Value Type | On Equip | On Unequip |
|------------|----------|------------|
| Number | Add to attribute | Subtract from attribute |
| Boolean | Set attribute (stores original) | Restore original value |
| `"toggle"` | Toggle attribute | Toggle back |

Effects only apply if the actor has the target attribute.

## Collision Effects

The `collision_effect` attribute modifies attributes on actors the holder walks into.

```json
"attributes": {
  "collision_effect": { "health": -10 }
}
```

| Value Type | Effect |
|------------|--------|
| Number | Add to target's attribute (use negative for damage) |
| Boolean | Set target's attribute to value |
| `"toggle"` | Toggle target's attribute |

Effects only apply if the target has the attribute. If `health` drops to 0, the target dies.

### Examples

```json
// Sword - deals 10 damage on collision
"collision_effect": { "health": -10 }

// Key - unlocks locked doors
"collision_effect": { "locked": false }

// Switch item - toggles a boolean
"collision_effect": { "active": "toggle" }
```

## Use Effects (UI-Triggered)

Items with `use_verb` can be used through the UI (not yet implemented).

| Attribute | Type | Description |
|-----------|------|-------------|
| `use_verb` | string | UI button text ("Drink", "Use", "Fire") |
| `use_effect` | string | Effect identifier |
| `use_sound` | string | Sound to play on use |

### Built-in Use Effects

| Effect | Description | Related Attributes |
|--------|-------------|-------------------|
| `restore_health` | Heals the user | `restore_amount` |
| `restore_strength` | Restores strength | `restore_amount` |
| `mine_wall` | Digs walls | `durability`, `break_chance` |
| `ranged_attack` | Fires projectile | `attack_range`, `requires` |

## Explosive Items

Items can detonate when thrown or when ignited by fire. Two attributes control this behavior:

| Attribute | Type | Description |
|-----------|------|-------------|
| `explosive` | boolean | Item can explode (required for any explosion behavior) |
| `breakable` | boolean | Item shatters on impact when thrown |
| `fire_explosion` | boolean | Explosion spawns fire instead of a gas cloud |
| `explosion_radius` | number | Radius of fire burst (default: 2). Used with `fire_explosion` |
| `cloud_lifetime` | number | Lifetime of the resulting gas cloud in turns (default: 10) |

### Detonation Rules

- `explosive` + `breakable` → detonates when thrown **and** when ignited by fire (e.g. potions — fragile glass shatters on impact)
- `explosive` without `breakable` → detonates **only** when ignited by fire (e.g. powder kegs — sturdy enough to survive a throw)

### Explosion Types

**Gas cloud** (default): spawns a spreading cloud that applies the item's `use_effect` to actors standing in it. Useful for potions with state effects (poison, confusion, paralysis).

**Fire burst** (`fire_explosion: true`): spawns `intense_fire` at the center and adjacent tiles, regular `fire` at the outer radius. Breakable solid actors within range have a 60% chance to be destroyed.

```json
// Potion — explodes on throw or fire, spreads confusion gas
"potion_of_confusion": {
  "attributes": {
    "explosive": true,
    "breakable": true,
    "flammable": true,
    "use_effect": { "apply_state": "confused" }
  }
}

// Powder keg — only explodes from fire, creates fire burst
"powder_keg": {
  "attributes": {
    "explosive": true,
    "flammable": true,
    "fire_explosion": true,
    "explosion_radius": 2
  }
}
```

## Item Examples

```json
// Melee weapon
"sword": {
  "name": "Sword",
  "tileIndex": "LATIN_CAPITAL_LETTER_T",
  "attributes": {
    "pickupable": true,
    "visible": true,
    "collision_effect": { "health": -10 }
  }
}

// Consumable potion
"health_potion": {
  "name": "Health Potion",
  "tileIndex": "EXCLAMATION_MARK",
  "attributes": {
    "pickupable": true,
    "visible": true,
    "consumable": true,
    "use_verb": "Drink",
    "use_effect": "restore_health",
    "use_sound": "heal",
    "restore_amount": 50
  }
}

// Wearable with stat bonus
"crown": {
  "name": "Crown",
  "tileIndex": "CROWN",
  "tint": "#FFD700",
  "attributes": {
    "pickupable": true,
    "visible": true,
    "wearable": "top",
    "wear_effect": { "strength": 2 }
  }
}
```
