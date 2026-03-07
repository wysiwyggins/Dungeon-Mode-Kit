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
