# Combat System

Combat occurs when actors collide (move into the same tile). Actors and items have collision effects, which have a chance to change a stat in the target. Hit rolls are exponential. We've picked three stats- strength, defence, and accuracy to modify chance to hit and effect, and generally affect a stat called health in the target, but our system should remain flexible to allow per-prototype experimentation in the actors and item json files.

As with a lot of these systems, "Can I make something like Brogue" was the first target (a boiled-down, simplified roguelike) keeping as much of those design decisions as possible located in data files. Modular reusable chunks in the scripts, handy defaults in data, design variations in prototype data. Recently I added `type` templates for items and actors and I can see a future where /data is mostly types and specifics are in /prototypes

## Hit Calculation

When an actor with an `accuracy` attribute attacks a target, the hit probability uses an exponential formula:

```
hit_chance = accuracy × 0.987^defense
```

This is clamped to 5-95% (always some chance to hit or miss).

**Key properties:**

- Each point of defense reduces hit chance by ~1.3% (multiplicatively)
- High defense has diminishing returns - stacking becomes less effective
- Roll uses `ROT.RNG.getPercentage()` (1-100)
- If roll ≤ hit_chance, the attack hits
- Actors without `accuracy` always hit (deterministic combat)
- Incapacitated targets (sleeping, paralyzed) are always hit

**Example hit chances:**

| Accuracy | Defense | Hit Chance |
| ---------- | --------- | ------------ |
| 50 | 0 | 50% |
| 50 | 10 | 44% |
| 50 | 20 | 38% |
| 80 | 0 | 80% |
| 80 | 15 | 66% |
| 80 | 30 | 53% |

## Damage Calculation

Damage flows through modifiers in order:

### 1. Base Damage

Comes from the weapon's `collision_effect` or actor's unarmed `collision_effect`.

```json
"collision_effect": { "health": -10 }
```

Damage values can reference attributes using `"{stat}"` syntax:

```json
"collision_effect": { "health": "-{strength}" }
```

### 2. Critical Hits (Weapon Proc)

Weapons with `"weapon_proc": "critical"` have a 15% chance to deal double damage.

### 3. Strength Multiplier

Weapon damage is multiplied by the attacker's effective strength:

```
final_damage = base_damage × (strength / 10)
```

- Default strength is 10 (1x multiplier)
- Strength 15 = 1.5x damage
- Strength 5 = 0.5x damage

Effective strength includes:

- Base `strength` attribute
- Bonuses from equipped item `wear_effect`
- Passive bonuses from inventory items

### 4. Enchantment Bonus

If the weapon has a non-zero `enchantment`, it is added as flat bonus damage after strength scaling:

```
damage = strength_scaled_damage + enchantment
```

A Sword +2 deals 2 extra damage per hit. A Sword -1 deals 1 less.

Armor enchantment adds to defense: a Chainmail +1 with `wear_effect.defense: 8` provides 9 total defense.

## Damage Sources

The system determines damage from sources in priority order:

1. **Equipped Weapon**: If attacker has a weapon in `equipment.weapon`, its `collision_effect` is used
2. **Actor's Collision Effect**: Falls back to the attacker's own `collision_effect`

## Weapon Types and Proc Effects

The `weapon_proc` attribute (or legacy `weapon` string) specifies a post-hit effect:

| Type | Effect |
| ------ | -------- |
| `"normal"` (default) | No special effect |
| `"knockback"` | Pushes target away on hit, target loses next turn (stagger) |
| `"lifesteal"` | Heals attacker for a percentage of damage dealt |
| `"critical"` | Chance for double damage |

| Proc attribute | Default | Description |
| ---------------- | --------- | ------------- |
| `knockback_distance` | `1` | Tiles to push target |
| `lifesteal_percent` | `25` | Percent of damage healed |
| `critical_chance` | `15` | Percent chance for double damage |

---

## Attack Styles

The `attack_style` attribute modifies how a weapon targets enemies. Unlike `weapon_proc` (which fires after a hit), attack styles change who or where gets attacked. A weapon can have both an `attack_style` and a `weapon_proc`.

| Style | Effect |
| ------- | -------- |
| `"lunge"` | Attack an enemy 2 tiles away by moving through the gap |
| `"sweep"` | Hit all adjacent enemies simultaneously |
| `"penetrate"` | Pierce through the primary target to hit the enemy behind |

### Lunge

When the player moves toward an empty tile with an enemy further along the same direction, the weapon attacks the distant enemy and the player moves into the gap tile. This is a combined move + attack.

- Triggered when moving into an **empty** tile with a valid target at `lunge_range` tiles away (default `2`)
- The attacker physically moves to the gap tile, ending up adjacent to the target
- If no valid lunge target exists, the player walks forward normally — no wasted turn
- Works in all 8 directions (cardinal and diagonal)
- All normal combat mechanics apply (hit roll, strength scaling, enchantment, weapon proc)

```
Before:          After lunge:
. . E            . @ E     ← player moved to gap, attacked E
. @ .            . . .
```

| Attribute | Default | Description |
|-----------|---------|-------------|
| `lunge_range` | `2` | Distance to the lunge target in tiles |

### Sweep

When attacking any enemy, all adjacent enemies are hit simultaneously. Each target gets an independent hit roll, damage calculation, and weapon proc.

```
Before:          On attack:
. E .            . E .     ← all 3 enemies hit
E @ E            E @ E
. . .            . . .
```

### Penetrate

When attacking an enemy, the attack also strikes the enemy directly behind the target (in the same direction of movement). The chain stops at the first empty tile or non-enemy actor.

```
Before:          On attack:
. . .            . . .
@ E E            @ E E     ← both enemies hit
. . .            . . .
```

| Attribute | Default | Description |
|-----------|---------|-------------|
| `penetrate_depth` | `1` | How many extra enemies to hit behind the primary target |

### Example: Rapier (lunge + critical)

```json
"rapier": {
  "attributes": {
    "weapon": true,
    "attack_style": "lunge",
    "lunge_range": 2,
    "weapon_proc": "critical",
    "critical_chance": 20,
    "collision_effect": { "health": -7 }
  }
}
```

The rapier lunges through gaps to strike distant enemies, and each hit has a 20% chance to deal double damage.

## Combat Attributes

### Actor Attributes

Remember, all actor attributes are optional, so combat still works without these

| Attribute | Description | Default |
| ----------- | ------------- | --------- |
| `accuracy` | Base hit chance percentage | None (always hit) |
| `defense` | Reduces attacker's hit chance (exponential) | 0 |
| `strength` | Multiplies weapon damage (÷10) | 10 |
| `collision_effect` | Unarmed damage/effects | None |
| `collision_sound` | Sound played when hitting | None |
| `collision_description` | Template for attack messages | None |

### Item Attributes (Weapons)

| Attribute | Description |
| ----------- | ------------- |
| `weapon` | `true` — marks item as a weapon |
| `attack_style` | Targeting style: `"lunge"`, `"sweep"`, or `"penetrate"` |
| `weapon_proc` | Proc type: `"knockback"`, `"lifesteal"`, or `"critical"` |
| `lunge_range` | Lunge target distance (default `2`) |
| `penetrate_depth` | Extra enemies hit behind target (default `1`) |
| `collision_effect` | Damage dealt when weapon hits |
| `attack_sound` | Sound played on every swing (hit or miss) |
| `collision_sound` | Sound played on successful hit |
| `collision_description` | Template for weapon attack messages |
| `wear_effect` | Stat bonuses when equipped (e.g., `{ "accuracy": 5 }`) |
| `enchantable` | `true` — item can be enchanted |
| `enchant_range` | `[min, max]` — random enchantment on spawn |

### Item Attributes (Armor)

| Attribute | Description |
| ----------- | ------------- |
| `wearable` | Equipment slot: `"top"`, `"middle"`, or `"lower"` |
| `requires_stat` | Stat requirements to equip; strength value also determines equip time in turns (e.g., `{ "strength": 8 }` = 8 turns to equip) |
| `wear_effect` | Stat bonuses when equipped (e.g., `{ "defense": 8 }`) |

## Equipment Slots

Actors have four equipment slots:

| Slot | Items |
| ------ | ------- |
| `weapon` | Items with `"weapon": true` or weapon type string |
| `top` | tile above head, like crown or horns (`"wearable": "top"`) |
| `middle` | face tile (`"wearable": "middle"`) |
| `lower` | Legs/feet armor (`"wearable": "lower"`) |

Equipped items provide `wear_effect` bonuses to combat stats.

## Turn Costs

Actions that consume a turn (allow enemies to act):

| Action | Turn Cost |
| -------- | ----------- |
| Move | 1 turn |
| Attack | 1 turn |
| Equip weapon | 1 turn |
| Equip armor | Strength requirement turns (e.g., `requires_stat: { strength: 8 }` = 8 turns) |
| Unequip item | 1 turn |
| Use item (drink potion, etc.) | 1 turn |

### Multi-Turn Armor Equipping

Heavy armor takes multiple turns to put on, based on its strength requirement:

1. Player selects "Wear" on armor with `requires_stat: { strength: X }`
2. Equipping begins, shown in actor list as `"PlayerName (equipping)"`
3. Each turn taken adds a dot: `(equipping.)` → `(equipping..)` → etc.
4. After X turns, armor is fully equipped and provides its `wear_effect` bonuses
5. Starting to equip a different item cancels the current equipping process

Weapons and armor without strength requirements equip instantly (1 turn).

## Effective Stats

Combat stats are calculated from multiple sources:

### Effective Accuracy

```
base accuracy attribute
+ wear_effect bonuses from all equipped items
```

### Effective Defense

```
base defense attribute (or 0)
+ wear_effect bonuses from all equipped items
+ enchantment bonus from equipped armor
+ passive_effect bonuses from inventory items
```

### Effective Strength

```
base strength attribute (or 10)
+ wear_effect bonuses from all equipped items
+ passive_effect bonuses from inventory items
```

## Attack Messages

Attack descriptions use template substitution:

```json
"collision_description": "[actor_name] [attacks.melee_verbs] the [attacked_actor_name] with [a-an] [weapon_name]!"
```

**Template variables:**

- `[actor_name]`: The attacker's name
- `[attacked_actor_name]`: The target's name
- `[weapon_name]`: Equipped weapon's name (if any)
- `[attacks.melee_verbs]`: Random verb from the `attacks.melee_verbs` list in `words.json`
- `[attacks.miss_verbs]`: Random verb from miss_verbs array
- `[a-an]`: Automatically selects "a" or "an" based on following word

Miss messages are shown when attacks fail the hit roll.

## Example Configurations

### Player with Combat Stats

```json
"player": {
  "collision_effect": { "health": "-{strength}" },
  "collision_description": "You [attacks.melee_verbs] the [attacked_actor_name]!",
  "attributes": {
    "strength": 10,
    "accuracy": 70,
    "defense": 5
  },
  "stats": {
    "health": 100
  },
  "default_items": ["sword"]
}
```

### Enemy with High Defense

```json
"minotaur": {
  "collision_effect": { "health": "-{strength}" },
  "attributes": {
    "strength": 12,
    "accuracy": 80,
    "defense": 15
  },
  "stats": {
    "health": 80
  }
}
```

### Weapon with Wear Effect

```json
"sword": {
  "name": "Sword",
  "attributes": {
    "weapon": true,
    "collision_effect": { "health": -10 },
    "wear_effect": { "accuracy": "{strength}" }
  }
}
```

### Armor with Defense Bonus

```json
"chainmail": {
  "name": "Chainmail",
  "attributes": {
    "wearable": "lower",
    "wear_effect": { "defense": 8 }
  }
}
```

### Armor with Stat Requirement

```json
"plate": {
  "name": "Plate Armor",
  "attributes": {
    "wearable": "lower",
    "requires_stat": { "strength": 8 },
    "wear_effect": { "defense": 10 },
    "description": "Heavy armor. Requires strength 8 to wear."
  }
}
```

## Combat Flow Summary

```
1. Actor moves into target's tile
   ├─> tryMove() checks for attack style
   │   ├─> sweep: attack all adjacent enemies
   │   ├─> penetrate: attack target + enemy behind
   │   └─> (no style): proceed to step 2
   └─> tryMove() triggers applyCollisionEffects()
   
   OR: Actor moves into empty tile
   └─> lunge: if enemy at lunge_range, attack it and move to gap

2. Determine damage source
   ├─> Equipped weapon collision_effect (priority)
   └─> Actor's own collision_effect (fallback)

3. Weapon swing visual + attack sound
   ├─> Show weapon swing sprite at target position
   └─> Play attack_sound (on every swing, hit or miss)

4. Hit roll (if attacker has accuracy)
   ├─> Calculate: accuracy × 0.987^defense (clamped 5-95%)
   ├─> Roll 1-100
   └─> Hit if roll ≤ hit_chance

5. Calculate damage (if hit)
   ├─> Check critical hit (weapon_proc "critical")
   ├─> Apply strength multiplier: damage × (strength / 10)
   └─> Apply weapon enchantment bonus

6. Apply damage
   ├─> Modify target's health stat
   ├─> Play collision_sound (hit sound)
   ├─> Trigger weapon proc (knockback, lifesteal)
   │   └─> Knockback: push target 1 tile, set stagger flag
   ├─> Update UI immediately
   └─> Check for death (attacker stays on current tile)

7. On miss
   └─> Show miss message (no collision_sound)

8. Show combat message
   └─> Template substitution for hit/miss message
```

## Testing Combat

The `arena` prototype provides a test environment for combat mechanics:

- Procedurally generated open arena
- Player with balanced stats (str 10, acc 70, def 5)
- Minotaur boss (str 10, acc 40, def 15)
- Training dummies for damage testing
- Various proc weapons (warhammer, vampiric blade, assassin's dagger)
- Stat-modifying potions (strength, defense, accuracy)
- Chainmail armor (+8 defense)

Load with `?prototype=arena` in the URL.

Combat calculations are logged to the browser console for verification.
