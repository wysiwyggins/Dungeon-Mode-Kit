/**
 * Actor methods: combat math and prediction, per-turn stats, weapon procs and
 * attack styles, clone/polymorph, and collision effects (bumping into things).
 */

import { findAdjacentWalkable } from '../../core/pathfinding.js';
import { resolveTemplate } from '../../core/util.js';
import { Actor } from './actor.js';
import { Item } from '../item.js';

// Backstab: damage multiplier when attacking an unaware target (Brogue parity)
const BACKSTAB_MULTIPLIER = 3;

export const ActorCombat = {
    /**
     * Get the equipped weapon, if any
     * @returns {Item|null} The equipped weapon or null
     */
    getEquippedWeapon() {
        return this.equipment.weapon || null;
    },

    /**
     * Get the actor's effective accuracy (base + equipment bonuses)
     * @returns {number|null} Accuracy value, or null if actor has no accuracy attribute
     */
    getEffectiveAccuracy() {
        let base = this.getAttribute('accuracy');
        if (base === undefined) return null;

        // Add bonuses from equipped items' wear_effects
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.accuracy === 'number') {
                    base += wearEffect.accuracy;
                }
            }
        }
        return base;
    },

    /**
     * Get the actor's effective defense (base + equipment bonuses)
     * @returns {number} Defense value (0 if no defense attribute)
     */
    getEffectiveDefense() {
        // Aquatic actors flop helplessly on dry land — no defense at all.
        if (this.isOutOfLiquid()) return 0;

        let base = this.getAttribute('defense') || 0;

        // Add bonuses from equipped items' wear_effects and enchantments
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.defense === 'number') {
                    base += wearEffect.defense;
                }
                if (item.enchantment && wearEffect?.defense !== undefined) {
                    base += item.enchantment;
                }
            }
        }

        // Add passive bonuses from inventory items
        base += this.getPassiveStatBonus('defense');

        return base;
    },

    /**
     * Calculate hit probability 
     * This provides diminishing returns on defense stacking
     * @param {Actor} defender - The target being attacked
     * @returns {number} Hit probability as percentage (5-95)
     */
    calculateHitProbability(defender) {
        const accuracy = this.getEffectiveAccuracy();
        if (accuracy === null) return 100; // No accuracy = deterministic hit

        const defense = defender.getEffectiveDefense?.() || 0;

        // Brogue formula: accuracy * 0.987^defense
        // Each point of defense reduces hit chance by ~1.3% (multiplicatively)
        const rawProbability = accuracy * Math.pow(0.987, defense);

        // Clamp to 5-95% - always some chance to hit/miss
        return Math.max(5, Math.min(95, Math.round(rawProbability)));
    },

    /**
     * Scale a base damage magnitude by this actor's strength, optionally adding a
     * weapon's enchantment — the deterministic tail of the damage pipeline.
     *
     * Extracted so applyCollisionEffects and predictCombat cannot drift: the live
     * path and the number the info panel promises run the same arithmetic, and a
     * change to the formula moves both at once. The random multipliers (critical,
     * backstab) stay with the caller — one rolls them, the other reports them as a
     * best case.
     *
     * Works in positive magnitudes; the live path carries damage as a negative delta
     * and re-signs around this call. `enchanted` is opt-in because the live path adds
     * enchantment separately (it also applies to non-`weapon` items), while the
     * predictor wants the whole figure in one place.
     *
     * @param {number} baseDamage - Positive magnitude before scaling
     * @param {Item|null} enchanted - Item whose enchantment to add, if any
     * @returns {number} Damage after strength scaling and enchantment
     */
    scaleDamage(baseDamage, enchanted = null) {
        // Rounds as if the value were still negative, which is how the live path has
        // always scaled it. Math.round breaks halves toward +Infinity, so rounding a
        // positive magnitude would turn 0.5 into 1 where the old code produced 0 —
        // a real off-by-one on odd damage at low strength, not a cosmetic difference.
        const scaled = -Math.round(-baseDamage * (this.getEffectiveStrength() / 10));
        return scaled + (enchanted?.enchantment || 0);
    },

    /**
     * Would a state named by an authored `apply_state` actually land on `target`?
     *
     * Mirrors the three refusals in applyState — player-only/perception states,
     * mind states needing something that takes turns, and a declared `immunity`
     * attribute — so the info panel never promises a bite that "makes you bleed"
     * when the victim is `bloodless` and the state would be dropped on contact.
     * A separate predictor rather than a dry-run of applyState, which mutates.
     *
     * @param {string|Object} value - Authored apply_state: a name or { state, duration }
     * @param {Actor} target - Who the state would be applied to
     * @returns {{name: string, label: string}|null} The state, or null if it can't land
     */
    predictAppliedState(value, target) {
        const { name } = Actor.parseApplyState(value);
        if (!name || !target) return null;

        const stateData = this.engine?.globalStates?.[name];
        if (!stateData) return null;

        // The same order applyState uses, and for the same reasons.
        if (stateData.hallucinating || stateData.player_only) {
            if (!target.hasAttribute('controlled')) return null;
        } else if (Actor.isMindState(stateData)) {
            if (!target.hasAttribute('sentient') && !target.hasAttribute('controlled')) return null;
        }
        if (stateData.immunity && target.hasAttribute(stateData.immunity)) return null;

        // states.json authors a display `name` ("Bleeding"); lowercased here because
        // the panel drops it mid-sentence. Falls back to the key, which reads fine.
        return { name, label: String(stateData.name || name).toLowerCase() };
    },

    /**
     * What would happen if this actor attacked `defender`, computed without rolling
     * anything or touching game state — the data behind the info panel's combat lines.
     *
     * Mirrors the live pipeline in applyCollisionEffects: base damage → critical →
     * backstab → strength → enchantment, sharing scaleDamage so the two agree. The
     * two random multipliers are reported rather than rolled, so the panel can say
     * "typically N, up to M" instead of quoting one sampled outcome.
     *
     * Reads the CURRENT world: a sleeping target really is a backstab, so the numbers
     * move as it wakes. That is deliberate — a static figure would be wrong more often.
     *
     * @param {Actor} defender - The actor being attacked
     * @returns {Object|null} Prediction, or null if defender is missing
     */
    predictCombat(defender) {
        if (!defender) return null;

        const weapon = this.equipment?.weapon || null;
        const result = {
            hitChance: this.calculateHitProbability(defender),
            damage: 0,          // typical damage per landed hit
            maxDamage: 0,       // with every favourable multiplier
            hitsToKill: null,   // at typical damage
            bestHitsToKill: null,
            noDamage: false,    // this attacker cannot hurt that defender
            immune: false,      // defender has no health stat to reduce
            backstab: false,    // a hit right now would be a backstab
            canCrit: false,
            appliedState: null  // {name, label} if a landed hit would also inflict a state
        };

        // Where the damage number comes from: the wielded weapon if it has one,
        // otherwise the actor's own unarmed collision_effect.
        const effect = weapon?.getAttribute('collision_effect')
            ?? this.getAttribute('collision_effect');
        const rawHealth = effect && typeof effect === 'object' ? effect.health : undefined;

        // Read before the early returns below: an attack that deals no damage can
        // still inflict a state, and that is exactly the case worth warning about.
        if (effect && typeof effect === 'object' && effect.apply_state) {
            result.appliedState = this.predictAppliedState(effect.apply_state, defender);
        }

        // Damage may be authored as "-{strength}" rather than a number; the live path
        // resolves it the same way, so reuse that resolver instead of re-parsing.
        const resolved = this.resolveAttributeValue?.(rawHealth, this) ?? rawHealth;
        const base = typeof resolved === 'number' ? Math.abs(Math.min(0, resolved)) : 0;

        const targetHealth = defender.stats?.health;
        const currentHP = typeof targetHealth === 'object'
            ? targetHealth.current
            : (typeof targetHealth === 'number' ? targetHealth : null);

        if (currentHP === null || currentHP === undefined) {
            result.immune = true;
            return result;
        }
        // The melee gate in applyCollisionEffects nullifies the blow before damage is
        // read, so a forecast that ignored it would quote a number the attack can
        // never deal. Mirrored here for the same reason the damage maths is.
        if (defender.hasAttribute('melee_immune') || this.hasAttribute('melee_harmless')
            || !this.outranksForCapture(defender)) {
            result.noDamage = true;
            return result;
        }
        if (base <= 0) {
            result.noDamage = true;
            return result;
        }

        result.backstab = !!(defender.isIncapacitated?.()
            || (defender.personality && !defender._alerted));
        result.canCrit = !!(weapon && this.getWeaponType?.(weapon) === 'critical');

        // Typical: the multipliers that are certain right now (backstab is a fact
        // about the target's current state, not a roll). Best: also lands the crit.
        const typicalBase = base * (result.backstab ? BACKSTAB_MULTIPLIER : 1);
        const bestBase = typicalBase * (result.canCrit ? 2 : 1);

        result.damage = Math.max(0, this.scaleDamage(typicalBase, weapon));
        result.maxDamage = Math.max(0, this.scaleDamage(bestBase, weapon));

        if (result.damage <= 0) {
            result.noDamage = true;
            return result;
        }

        result.hitsToKill = Math.max(1, Math.ceil(currentHP / result.damage));
        result.bestHitsToKill = result.maxDamage > 0
            ? Math.max(1, Math.ceil(currentHP / result.maxDamage))
            : null;

        return result;
    },

    /**
     * Get the actor's effective strength (base + equipment bonuses)
     * Strength multiplies weapon damage: damage = base * (strength / 10)
     * Default strength of 10 = 1x multiplier (no change)
     * @returns {number} Strength value (10 if no strength attribute - baseline)
     */
    getEffectiveStrength() {
        let base = this.getAttribute('strength');
        if (base === undefined) base = 10; // Default strength is 10 (1x multiplier)

        // Add bonuses from equipped items' wear_effects
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.strength === 'number') {
                    base += wearEffect.strength;
                }
            }
        }

        // Add passive bonuses from inventory items
        base += this.getPassiveStatBonus('strength');

        return base;
    },

    /**
     * Get the effective per-turn change for a stat (base + equipment bonuses)
     * Equipment can modify per_turn values via wear_effect (e.g., ring that slows hunger)
     * @param {string} statName - The stat to get per-turn value for
     * @returns {number} Per-turn change amount (positive = gain, negative = loss)
     */
    getEffectivePerTurn(statName) {
        const stat = this.stats[statName];
        if (!stat) return 0;

        let perTurn = stat.per_turn || 0;

        // Add modifiers from equipped items' wear_effects
        // Format: wear_effect: { "health_per_turn": 2 } or { "nutrition_per_turn": -0.5 }
        const perTurnKey = `${statName}_per_turn`;
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect[perTurnKey] === 'number') {
                    perTurn += wearEffect[perTurnKey];
                }
            }
        }

        // Add passive bonuses from inventory items
        for (const item of this.inventory) {
            const passiveEffect = item.getAttribute('passive_effect');
            if (passiveEffect && passiveEffect.type === 'stat_bonus' && typeof passiveEffect[perTurnKey] === 'number') {
                perTurn += passiveEffect[perTurnKey];
            }
        }

        // Scale rate by an attribute (e.g., nutrition drain scales with strength)
        // Multiplier is attribute / 10, so strength 10 = 1x (baseline), 15 = 1.5x
        if (stat.rate_scaled_by) {
            let attrValue;
            const attrName = stat.rate_scaled_by;
            if (attrName === 'strength') {
                attrValue = this.getEffectiveStrength();
            } else if (attrName === 'accuracy') {
                attrValue = this.getEffectiveAccuracy() ?? 10;
            } else if (attrName === 'defense') {
                attrValue = this.getEffectiveDefense() ?? 10;
            } else {
                attrValue = this.getAttribute(attrName) ?? 10;
            }
            perTurn = perTurn * (attrValue / 10);
        }

        return perTurn;
    },

    /**
     * Quantize a possibly-fractional per-turn rate into a whole-number change,
     * banking the leftover fraction so the long-run average matches the rate.
     *
     * Stats are only ever displayed and compared as integers, so we never write a
     * fraction into stat.current. A rate of -0.8/turn spends -1 on four of every
     * five turns and 0 on the fifth, averaging -0.8 exactly.
     *
     * @param {string} statName - Stat the rate belongs to
     * @param {number} rate - Effective per-turn rate, possibly fractional
     * @returns {number} Whole-number amount to apply this turn (may be 0)
     */
    takeWholePerTurn(statName, rate) {
        if (Number.isInteger(rate)) return rate;

        if (!this._perTurnRemainders) this._perTurnRemainders = {};
        const banked = this._perTurnRemainders[statName] || 0;
        const total = banked + rate;

        // Truncate toward zero so the whole part never overshoots the banked total;
        // the leftover keeps the total's sign and carries into the next turn.
        const whole = Math.trunc(total);
        // Round the carry to kill float dust (0.5999999999999999 -> 0.6) so the
        // bank can't drift over thousands of turns.
        this._perTurnRemainders[statName] = Math.round((total - whole) * 1e6) / 1e6;

        return whole;
    },

    /**
     * Process per-turn stat changes for this actor
     * Called at the start of each turn
     *
     * Stat config options (set in actor JSON stats block):
     *   per_turn: number - Amount to change each turn (positive or negative)
     *   fatal: boolean - If true, reaching 0 kills the actor (default: false, except health)
     *   death_message: string - Message shown when stat causes death (player only)
     *   warnings: array - Threshold warnings [{threshold: 0.5, message: "Getting low"}]
     *
     * Example:
     *   "nutrition": {
     *     "max": 100,
     *     "per_turn": -1,
     *     "fatal": true,
     *     "death_message": "You starve to death!",
     *     "warnings": [
     *       {"threshold": 0.5, "message": "You are getting hungry."},
     *       {"threshold": 0.25, "message": "You are very hungry."},
     *       {"threshold": 0.1, "message": "You are starving!"}
     *     ]
     *   }
     */
    processPerTurnStats() {
        if (!this.stats || this.isDead) return;

        for (const [statName, stat] of Object.entries(this.stats)) {
            const rawPerTurn = this.getEffectivePerTurn(statName);
            if (rawPerTurn === 0) continue;

            // Stat values must stay whole numbers — the UI never shows decimals, and
            // fractional carryover through restore_from used to leave permanent
            // fractions in health (e.g. 21.6). Fractional rates (from rate_scaled_by
            // or wear_effect) are banked in a remainder and spent as whole points, so
            // a -0.8/turn drain still averages -0.8 without ever writing a fraction.
            const perTurn = this.takeWholePerTurn(statName, rawPerTurn);
            if (perTurn === 0) continue;

            const oldValue = stat.current;

            // Split into base per-turn (subject to restore_from) and passive bonus (always
            // applies). The split is taken from the quantized total so neither part
            // reintroduces a fraction. The base claims its share first, capped at the total
            // so it can't overshoot and flip the sign of the passive remainder; a fractional
            // authored per_turn rounds up to a whole point so it still goes through the
            // restore_from gate rather than leaking past it as a passive bonus.
            const rawBase = stat.per_turn || 0;
            const sign = Math.sign(perTurn);
            const basePerTurn = Math.sign(rawBase) === sign
                ? Math.ceil(Math.min(Math.abs(rawBase), Math.abs(perTurn))) * sign
                : 0;
            const passivePerTurn = perTurn - basePerTurn;

            // Apply base per-turn with restore_from gate
            let baseGain = 0;
            if (basePerTurn !== 0) {
                const afterBase = Math.max(0, Math.min(stat.max, stat.current + basePerTurn));
                baseGain = afterBase - stat.current;

                if (stat.restore_from && baseGain > 0) {
                    const sourceStat = this.stats[stat.restore_from];
                    if (sourceStat) {
                        // Only whole points can be drawn from the source, so a partial
                        // point left in the source can't bleed a fraction into this stat.
                        const available = Math.floor(sourceStat.current);
                        if (available <= 0) {
                            baseGain = 0;
                        } else if (available < baseGain) {
                            baseGain = available;
                            sourceStat.current -= available;
                        } else {
                            sourceStat.current -= baseGain;
                        }
                    }
                }
                stat.current += baseGain;
            }

            // Apply passive bonus (bypasses restore_from)
            if (passivePerTurn !== 0) {
                stat.current = Math.max(0, Math.min(stat.max, stat.current + passivePerTurn));
            }

            let newValue = stat.current;

            // Only process if value actually changed
            if (oldValue === newValue) continue;

            //console.log(`${this.name}'s ${statName} per-turn: ${oldValue} -> ${newValue} (${perTurn >= 0 ? '+' : ''}${perTurn})`);

            // Check for death - health is always fatal, other stats need fatal: true
            const isFatal = statName === 'health' || stat.fatal === true;
            if (newValue <= 0 && isFatal) {
                if (this.isPlayerControlled() && stat.death_message) {
                    this.engine.inputManager?.showMessage(stat.death_message, { style: 'danger' });
                }
                this.die();
                return; // Stop processing if dead
            }

            // Show warning messages for player when crossing thresholds
            if (this.isPlayerControlled() && stat.warnings && this.engine.inputManager) {
                const oldPercentage = oldValue / stat.max;
                const newPercentage = newValue / stat.max;

                // Check warnings in order (they should be sorted highest to lowest threshold)
                for (const warning of stat.warnings) {
                    // Trigger when crossing below threshold
                    if (newPercentage <= warning.threshold && oldPercentage > warning.threshold) {
                        this.engine.inputManager.showMessage(warning.message, { style: 'warning' });
                        break; // Only show one warning per turn
                    }
                }
            }

            // Apply or remove condition-driven states (e.g., starving when nutrition is low)
            if (stat.condition_state && this.engine.globalStates) {
                const { state: condStateName, threshold } = stat.condition_state;
                const percentage = newValue / stat.max;

                if (percentage <= threshold && !this.states[condStateName]) {
                    const stateData = this.engine.globalStates[condStateName];
                    if (stateData) {
                        this.applyState(condStateName, stateData, { duration: Infinity });
                    }
                } else if (percentage > threshold && this.states[condStateName]) {
                    this.removeState(condStateName);
                }
            }
        }

        // Update UI after all per-turn changes
        if (this.isPlayerControlled()) {
            this.engine.interfaceManager?.updatePlayerInfo();
        }
        this.engine.interfaceManager?.updateSidebar();
    },

    /**
     * Unidentified rings identify themselves after their `id_turns` turns worn.
     * The count lives on the ring (wornTurns), so it survives taking it off.
     */
    processRingIdentification() {
        if (!this.isPlayerControlled()) return;
        for (const slot of ['ring1', 'ring2']) {
            const ring = this.equipment?.[slot];
            if (!ring || ring.identified !== false) continue;
            ring.wornTurns = (ring.wornTurns || 0) + 1;
            if (ring.wornTurns >= ring.getIdTurns()) {
                ring.identify();
                this.engine.inputManager?.showMessage(
                    `You are now familiar enough with your ${ring.getDisplayName()} to identify it.`
                );
            }
        }
    },

    /**
     * Process per-turn stat changes for items in inventory
     * Handles recharging staffs, decaying items, etc.
     */
    processInventoryItemStats() {
        if (!this.inventory || this.inventory.length === 0) return;

        const toRemove = [];

        for (const item of this.inventory) {
            if (item.processPerTurnStats) {
                item.processPerTurnStats();
            }

            // Handle items that burn out (burns stat hits 0). Only something actively
            // consuming fuel can burn out — an item holding a dormant fuel reserve (an
            // unlit torch, which declares per_turn 0) is just empty, not burning out,
            // and must not be destroyed or announced every turn.
            const burns = item.stats?.burns;
            if (burns && burns.current <= 0 && burns.per_turn < 0) {
                const isPlayer = this.hasAttribute('controlled');
                const msg = item.getAttribute('burnout_message') || `Your ${item.name} burns out.`;
                if (isPlayer) {
                    this.engine.inputManager?.showMessage(msg, { style: 'warning' });
                    this.engine.playSound('extinguish');
                    if (this.engine.lightingManager) {
                        const hasOtherLight = this.inventory.some(other =>
                            other !== item &&
                            other.hasAttribute('light_source') &&
                            !(other.stats?.burns && other.stats.burns.current <= 0)
                        );
                        if (!hasOtherLight) {
                            this.engine.inputManager?.showMessage('Darkness closes in around you.', { style: 'danger' });
                        }
                    }
                }

                const burnsOutItem = item.getAttribute('burns_out_item');
                if (burnsOutItem) {
                    const itemData = this.engine.currentPrototype?.getItemData(burnsOutItem);
                    if (itemData) {
                        const newItem = new Item(-1, -1, burnsOutItem, itemData, this.engine);
                        newItem.owner = this;
                        const idx = this.inventory.indexOf(item);
                        if (idx !== -1) this.inventory[idx] = newItem;
                    } else {
                        toRemove.push(item);
                    }
                } else {
                    toRemove.push(item);
                }

                this.engine.updateLighting();
            } else if (item.isBurning?.()) {
                // Carried incense trails its smoke around whoever holds it.
                this.engine.entityManager.emitFromItem(item, this.x, this.y);
            }
        }

        for (const item of toRemove) {
            this.inventory = this.inventory.filter(i => i !== item);
        }
    },

    /**
     * Get weapon type from weapon attribute
     * Supports boolean (true = 'normal') or string type names
     * @param {Item} weapon - The weapon item
     * @returns {string} Weapon type ('normal', 'knockback', 'lifesteal', 'critical')
     */
    getWeaponType(weapon) {
        if (!weapon) return 'normal';
        // New format: weapon_proc attribute
        const proc = weapon.getAttribute('weapon_proc');
        if (proc) return proc;
        // Backward compat: old weapon: "knockback" string format
        const attr = weapon.getAttribute('weapon');
        if (attr === true) return 'normal';
        if (typeof attr === 'string') return attr;
        return 'normal';
    },

    /**
     * Acid damage to gear (Brogue's degrade-weapon / degrade-armor). One point of
     * enchantment off an `enchantable` item this actor carries, unless it is
     * `protected`. Never curses: `cursed` is decided at spawn, so a corroded -1
     * blade can still be unwielded.
     * @param {Item|null} item - The weapon or armor piece to corrode
     * @returns {boolean} Whether the item was corroded
     */
    corrodeItem(item) {
        if (!item || item.hasAttribute('protected') || !item.hasAttribute('enchantable')) return false;
        item.enchantment = (item.enchantment || 0) - 1;
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`Your ${item.getDisplayName()} corrodes!`);
            this.engine.playSound?.('extinguish');
        }
        return true;
    },

    /**
     * The armor an acidic hit eats into: one random equipped piece that gives defense.
     * @returns {Item|null}
     */
    getCorrodibleArmor() {
        const pieces = ['top', 'middle', 'lower']
            .map(slot => this.equipment?.[slot])
            .filter(item => item?.getAttribute('wear_effect')?.defense !== undefined);
        if (!pieces.length) return null;
        return pieces[Math.floor(ROT.RNG.getUniform() * pieces.length)];
    },

    /**
     * Apply weapon proc effects after a successful hit
     * @param {Actor} target - The target that was hit
     * @param {Item|null} weapon - The weapon used (null for unarmed)
     * @param {number} damageDealt - Actual damage dealt (negative number)
     */
    applyWeaponProc(target, weapon, damageDealt) {
        if (!weapon) return; // No procs for unarmed attacks

        const weaponType = this.getWeaponType(weapon);

        switch (weaponType) {
            case 'knockback':
                this._procKnockback(target, weapon);
                break;
            case 'lifesteal':
                this._procLifesteal(damageDealt, weapon);
                break;
            case 'critical':
                // Critical is handled during damage calculation, not as a post-hit proc
                break;
            case 'normal':
            default:
                // No special proc effect
                break;
        }
    },

    resolveAttackStyle(newX, newY, dx, dy, actorAtTarget) {
        const weapon = this.getEquippedWeapon();
        const style = weapon?.getAttribute('attack_style');
        if (!style) return { handled: false };

        switch (style) {
            case 'lunge':
                if (!actorAtTarget) return this._styleLunge(newX, newY, dx, dy, weapon);
                return { handled: false };
            case 'sweep':
                if (actorAtTarget) return this._styleSweep(newX, newY, weapon);
                return { handled: false };
            case 'penetrate':
                if (actorAtTarget) return this._stylePenetrate(newX, newY, dx, dy, actorAtTarget, weapon);
                return { handled: false };
            case 'lash':
                if (!actorAtTarget) return this._styleLash(dx, dy, weapon);
                return { handled: false };
            default:
                return { handled: false };
        }
    },

    _styleLunge(newX, newY, dx, dy, weapon) {
        const range = weapon.getAttribute('lunge_range') ?? 2;
        const lungeX = this.x + dx * range;
        const lungeY = this.y + dy * range;

        if (!this.hasFloorAt(lungeX, lungeY) && !this.hasPlatformAt(lungeX, lungeY)) return { handled: false };

        const target = this.engine.entityManager.getSolidActorAt(lungeX, lungeY);
        if (!target || target.isDead || target.stats?.health === undefined) return { handled: false };

        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage('You lunge forward!');
        }

        // Attack the distant target before the move happens
        this.applyCollisionEffects(target);

        // Return unhandled so tryMove proceeds with normal movement to the gap tile
        // (which handles viewport, lighting, item pickup, doors, etc.)
        return { handled: false };
    },

    /**
     * Whip (Brogue): moving toward a hostile creature in a straight, clear line
     * within `lash_range` tiles (default 5) lashes it instead of moving. Anything
     * solid in between blocks the lash; a chasm doesn't. Only hostile creatures
     * count, so walking toward a deer still walks.
     */
    _styleLash(dx, dy, weapon) {
        const range = weapon.getAttribute('lash_range') ?? 5;
        const entityManager = this.engine.entityManager;
        for (let step = 2; step <= range; step++) {
            const x = this.x + dx * step;
            const y = this.y + dy * step;
            const target = entityManager.getSolidActorAt(x, y);
            if (!target || target.isDead) {
                if (entityManager.getSightBlockerAt(x, y)) return { handled: false };
                continue;
            }
            const hostile = target.personality?.hostile || target.hasAttribute('hostile') || target.isDiscordant?.();
            if (target.stats?.health === undefined || !hostile) return { handled: false };
            if (this.isPlayerControlled() && !this.engine.isTileVisible(x, y)) return { handled: false };

            if (dx > 0) this.setFacing('right');
            else if (dx < 0) this.setFacing('left');
            this.applyCollisionEffects(target);
            return { handled: true, moved: false, actionTaken: true };
        }
        return { handled: false };
    },

    /**
     * Wand of plenty (Brogue): a copy of this creature appears beside it, and the
     * two split its current health. The copy carries nothing, so plenty can't
     * duplicate loot. Fails on the player, chain creatures, anything without
     * health, or when no adjacent tile is free.
     * @returns {Actor|null} The copy
     */
    cloneSelf() {
        const health = this.stats?.health;
        if (this.isPlayerControlled() || this._chainHead || !health || typeof health.current !== 'number') return null;
        const pos = findAdjacentWalkable(this, this.engine.entityManager);
        if (!pos) return null;

        const copy = this.engine.entityManager.spawnActor(this.type, pos.x, pos.y);
        if (!copy) return null;
        copy.inventory = [];
        health.current = Math.ceil(health.current / 2);
        if (copy.stats?.health) {
            copy.stats.health.max = health.max;
            copy.stats.health.current = health.current;
        }
        this.flash?.();
        copy.flash?.();
        this.engine.interfaceManager?.updateSidebar?.();
        return copy;
    },

    /**
     * Wand of polymorph (Brogue): become a random other creature in place — any
     * `sentient` actor with health and a personality that isn't the player or
     * `no_polymorph`. Keeps whichever leaves more health: the same fraction of the
     * new maximum, or the new maximum less the damage already taken. Carried
     * items come along.
     * @param {string|string[]} [pool] - Draw only from these actor ids or actor
     *   types (e.g. "beast"); omitted, any eligible creature will do
     * @returns {Actor|null} The new creature
     */
    polymorph(pool) {
        if (this.isPlayerControlled() || this._chainHead || this.hasAttribute('no_polymorph')) return null;
        const health = this.stats?.health;
        if (!health || typeof health.current !== 'number') return null;

        const proto = this.engine.currentPrototype;
        // { floors: "current" | "3-6" | [3,6] } draws from that depth's spawn pool.
        const poolNames = pool?.floors !== undefined ? [...this.engine.getFloorActorPool(pool.floors)]
            : typeof pool === 'string' ? [pool] : Array.isArray(pool) ? pool : null;
        const candidates = Object.keys(proto.actors).filter(id => {
            if (id === this.type) return false;
            const def = proto.getActorData(id);
            if (poolNames && !poolNames.includes(id) && !poolNames.includes(def?.type)) return false;
            const attrs = def?.attributes || {};
            return def?.personality && def.stats?.health !== undefined && attrs.sentient
                && !attrs.controlled && !attrs.no_polymorph;
        });
        if (candidates.length === 0) return null;

        const newType = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
        const fraction = health.current / health.max;
        const damageTaken = health.max - health.current;
        const { x, y } = this;
        const inventory = this.inventory;
        this.isDead = true;
        this.engine.entityManager.removeEntity(this);

        const creature = this.engine.entityManager.spawnActor(newType, x, y);
        if (!creature) return null;
        const newHealth = creature.stats?.health;
        if (newHealth) {
            newHealth.current = Math.max(1, Math.round(fraction * newHealth.max), newHealth.max - damageTaken);
        }
        if (inventory?.length) creature.inventory = inventory;
        creature.flash?.();
        this.engine.interfaceManager?.updateSidebar?.();
        return creature;
    },

    _styleSweep(newX, newY, weapon) {
        const collisionDx = newX - this.x;
        if (collisionDx > 0) this.setFacing('right');
        else if (collisionDx < 0) this.setFacing('left');

        const targets = [];
        for (let ddx = -1; ddx <= 1; ddx++) {
            for (let ddy = -1; ddy <= 1; ddy++) {
                if (ddx === 0 && ddy === 0) continue;
                const tx = this.x + ddx;
                const ty = this.y + ddy;
                const actor = this.engine.entityManager.getSolidActorAt(tx, ty);
                if (actor && actor !== this && !actor.isDead && actor.stats?.health !== undefined
                    && !this.isCornerBlockedTo(tx, ty)) {
                    targets.push(actor);
                }
            }
        }

        if (targets.length === 0) return { handled: false };

        if (this.isPlayerControlled() && targets.length > 1) {
            this.engine.inputManager?.showMessage('You swing in a wide arc!');
        }

        for (const target of targets) {
            this.applyCollisionEffects(target);
        }

        return { handled: true, moved: false, actionTaken: true };
    },

    _stylePenetrate(newX, newY, dx, dy, actorAtTarget, weapon) {
        const collisionDx = newX - this.x;
        if (collisionDx > 0) this.setFacing('right');
        else if (collisionDx < 0) this.setFacing('left');

        const primaryResult = this.applyCollisionEffects(actorAtTarget);

        const depth = weapon.getAttribute('penetrate_depth') ?? 1;
        for (let i = 1; i <= depth; i++) {
            const behindX = newX + dx * i;
            const behindY = newY + dy * i;
            const behindActor = this.engine.entityManager.getSolidActorAt(behindX, behindY);
            if (behindActor && !behindActor.isDead && behindActor.stats?.health !== undefined) {
                this.applyCollisionEffects(behindActor);
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(
                        `Your ${weapon.getDisplayName?.()} pierces through!`
                    );
                }
            } else {
                break;
            }
        }

        return { handled: true, moved: false, actionTaken: primaryResult.attackAttempted };
    },

    /**
     * Knockback proc: Push target away from attacker
     * @param {Actor} target - The target to knock back
     * @param {Item} weapon - The weapon used
     */
    _procKnockback(target, weapon) {
        if (!target || target.isDead) return;

        const distance = weapon?.getAttribute('knockback_distance') ?? 1;

        // Calculate direction from attacker to target
        const dx = Math.sign(target.x - this.x);
        const dy = Math.sign(target.y - this.y);

        // Push target tile by tile up to distance
        let pushed = false;
        for (let i = 0; i < distance; i++) {
            const newX = target.x + dx;
            const newY = target.y + dy;
            if (!target.isPassableAt(newX, newY)) break;
            target.x = newX;
            target.y = newY;
            pushed = true;
        }

        if (pushed) {
            target.updateSpritePosition();
            target._lastAttacker = null; // Prevent immediate pursuit via defend_self
            target._knockedBack = true; // Skip next turn due to knockback stagger
            this.engine.playSound('push1');
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`${target.getNameWithArticle(true)} is knocked back!`);
            }
        }
    },

    /**
     * Lifesteal proc: Heal attacker for a percentage of damage dealt
     * @param {number} damageDealt - Damage dealt (negative number)
     * @param {Item} weapon - The weapon used
     */
    _procLifesteal(damageDealt, weapon) {
        const percent = (weapon?.getAttribute('lifesteal_percent') ?? 25) / 100;
        const healAmount = Math.max(1, Math.floor(Math.abs(damageDealt) * percent));
        this.modifyStat('health', healAmount);
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`You drain ${healAmount} health!`);
        }
        console.log(`Lifesteal: ${this.name} healed ${healAmount} HP`);
    },

    /**
     * Check if critical hit should proc (15% chance)
     * @param {Item|null} weapon - The weapon being used
     * @returns {boolean} True if critical hit
     */
    checkCriticalHit(weapon) {
        if (!weapon) return false;
        const weaponType = this.getWeaponType(weapon);
        if (weaponType !== 'critical') return false;

        const critChance = weapon.getAttribute('critical_chance') ?? 15;
        const roll = ROT.RNG.getPercentage();
        return roll <= critChance;
    },

    /**
     * Apply collision effects from actor or held items to a target actor
     * Damage comes from equipped weapon OR actor's collision_effect (not both)
     * Utility effects (like keys unlocking doors) always apply
     * @param {Actor} target - The actor being collided with
     * @param {Item} [withItem] - Use this item as the damage source instead of whatever
     *   is equipped. For a tool wielded straight from the pack — the Dig verb — so its
     *   `mining_power`, `dig_chance` and `condition` are the ones that count. Equipping
     *   stays the requirement for bumping and attacking; this is the deliberate,
     *   single-target use of an item you're only holding.
     * @returns {{effectApplied: boolean, targetPassable: boolean, targetKilled: boolean, attackAttempted: boolean}}
     */
    applyCollisionEffects(target, withItem = null) {
        // Skip if target is already dead
        if (target.isDead) {
            return { effectApplied: false, targetPassable: true, targetKilled: false, attackAttempted: false };
        }

        let effectApplied = false;
        let targetPassable = false;
        let targetShouldDie = false;

        // Determine the damage source: an explicitly-wielded item wins, then the
        // equipped weapon, then the actor's own effect.
        const equippedWeapon = withItem || this.getEquippedWeapon();

        // Skip combat interaction with breakable objects (walls) unless we have a mining tool
        // These objects have no health stat and can only be damaged by mining
        const targetIsMineable = target.hasAttribute('breakable') &&
            (!target.stats || target.stats.health === undefined);
        const hasMiningTool = equippedWeapon?.hasAttribute('mining');

        if (targetIsMineable && !hasMiningTool) {
            // Just bump sound, no combat
            return { effectApplied: false, targetPassable: false, targetKilled: false, attackAttempted: false };
        }
        let damageSource = null;

        if (equippedWeapon) {
            const weaponEffect = equippedWeapon.getAttribute('collision_effect');
            if (weaponEffect) {
                damageSource = {
                    name: equippedWeapon.name,
                    effect: weaponEffect,
                    sound: equippedWeapon.getAttribute('collision_sound'),
                    item: equippedWeapon,
                    lockColor: equippedWeapon.getAttribute('lock_color'),
                    sourceActor: this
                };
            }
        }

        // Fall back to actor's own collision_effect if no weapon equipped
        if (!damageSource) {
            const actorEffect = this.getAttribute('collision_effect');
            if (actorEffect) {
                damageSource = {
                    name: this.name,
                    effect: actorEffect,
                    sound: this.getAttribute('collision_sound'),
                    item: null,
                    lockColor: null,
                    sourceActor: this
                };
            }
        }

        // Gather utility effect sources (non-weapon items like keys)
        const utilitySources = [];
        for (const item of this.inventory) {
            // Skip the equipped weapon (already handled above)
            if (item === equippedWeapon) continue;

            const itemEffect = item.getAttribute('collision_effect');
            if (itemEffect) {
                // Check if this item has any utility effects (non-stat modifying effects like "locked": false)
                const hasUtilityEffect = Object.values(itemEffect).some(val => {
                    // Utility effects are boolean values or toggle
                    return typeof val === 'boolean' || val === 'toggle';
                });

                if (hasUtilityEffect) {
                    utilitySources.push({
                        name: item.name,
                        effect: itemEffect,
                        sound: item.getAttribute('collision_sound'),
                        item: item,
                        lockColor: item.getAttribute('lock_color'),
                        sourceActor: this
                    });
                }
            }
        }

        // Determine if target is a valid combat target:
        // - Has health stats (enemy/creature), or
        // - Is breakable (mineable wall — non-mining-tool case already returned early above)
        const targetHasHealth = target.stats?.health !== undefined;
        const isCombatTarget = damageSource && (targetHasHealth || target.hasAttribute('breakable'));

        // A hostile actor's first strike at the player gets a taunt, once per actor.
        if (isCombatTarget && !this._hasTaunted && this.personality?.hostile && target.isPlayerControlled()) {
            this._hasTaunted = true;
            this.sayTaunt('on_attack');
        }

        // Show weapon swing visual only when combat is actually attempted
        if (isCombatTarget && equippedWeapon?.tileIndex && this.engine.renderer) {
            this.engine.interfaceManager?.showWeaponSwing(equippedWeapon, target.x, target.y, 100, this.x, this.y);
        }

        // Play attack/swing sound on every combat attempt (hit or miss)
        if (isCombatTarget && damageSource) {
            const attackSound = damageSource.item?.getAttribute('attack_sound') ||
                                damageSource.sourceActor?.getAttribute('attack_sound');
            if (attackSound) {
                this.engine.playSound(attackSound);
            }
        }

        // Perform hit roll for damage source
        let damageHits = true;
        if (damageSource && isCombatTarget) {
            const attackerAccuracy = this.getEffectiveAccuracy();

            // Only roll if attacker has accuracy attribute AND target is not incapacitated
            // Skip hit roll for stationary objects (breakable actors without health) - always hit
            const targetIncapacitated = target.isIncapacitated?.();
            const targetIsStationary = target.hasAttribute('breakable') && (!target.stats || target.stats.health === undefined);

            if (attackerAccuracy !== null && !targetIncapacitated && !targetIsStationary) {
                const hitChance = this.calculateHitProbability(target);
                // Use ROT.RNG for deterministic/seedable combat
                const roll = ROT.RNG.getPercentage(); // Returns 1-100
                damageHits = roll <= hitChance;

                const targetDefense = target.getEffectiveDefense?.() || 0;
                console.log(`Hit roll: ${roll} vs ${hitChance}% (${attackerAccuracy} * 0.987^${targetDefense}) = ${damageHits ? 'HIT' : 'MISS'}`);
            }
            // If no accuracy attribute or target incapacitated, damageHits remains true (deterministic combat)
        }

        // A blow can fail to matter for three reasons: the target absorbs it
        // (melee_immune), the attacker cannot land a telling one (melee_harmless),
        // or the attacker is outranked (see outranksForCapture). All are checked
        // here rather than in isCombatTarget so the swing still animates and the
        // attack still reads as an attack — it just does nothing.
        const outranked = isCombatTarget && !this.outranksForCapture(target);
        const meleeNullified = isCombatTarget && damageHits &&
            (target.hasAttribute('melee_immune') || this.hasAttribute('melee_harmless') || outranked);
        if (meleeNullified) this._showMeleeImmuneMessage(target, { outranked });

        // Apply damage effects if hit succeeded
        if (isCombatTarget && damageHits && !meleeNullified) {
            const result = this._applyEffectSource(damageSource, target, true);
            if (result.applied) effectApplied = true;
            if (result.targetPassable) targetPassable = true;
            if (result.targetShouldDie) targetShouldDie = true;
        } else if (isCombatTarget && !damageHits) {
            // Miss - show miss feedback
            this._showMissMessage(target);
        }

        // Apply utility effects (always, regardless of hit roll)
        for (const source of utilitySources) {
            const result = this._applyEffectSource(source, target, false);
            if (result.applied) effectApplied = true;
            if (result.targetPassable) targetPassable = true;
            if (result.targetShouldDie) targetShouldDie = true;
        }

        // Flash the target for visual feedback if any effect was applied
        if (effectApplied && target.flash) {
            target.flash();
            if (target.isPlayerControlled?.()) {
                this.engine.renderer?.effectRunner.apply('damage_shake');
            }
        }

        // Show collision description if damage hit
        if (damageHits && damageSource && effectApplied) {
            const description = this.getCollisionDescription(target);
            if (description) {
                const pos = (this.isPlayerControlled() || target.isPlayerControlled?.()) ? null : { x: target.x, y: target.y };
                this.engine.inputManager?.showMessage(description, pos);
            }
        }

        // Now trigger death after collision description is shown
        if (targetShouldDie) {
            const wasBreakableWall = target.hasAttribute('breakable') && target.hasAttribute('solid');
            const targetPos = { x: target.x, y: target.y };
            target.die();
            if (wasBreakableWall) {
                this.engine.entityManager.revealDugArea([targetPos]);
            }
        }

        // attackAttempted is true if we had a damage source (even on miss)
        // This is used to consume the turn regardless of hit/miss
        const attackAttempted = damageSource !== null;
        // wasCombat / hitLanded are the authoritative combat signals (effectApplied is not
        // a reliable hit/miss proxy — utility sources apply on a miss, and damage can round
        // to zero on a hit). Callers deciding hit-vs-miss should use hitLanded.
        return {
            effectApplied, targetPassable, targetKilled: targetShouldDie, attackAttempted,
            wasCombat: isCombatTarget && damageSource !== null,
            hitLanded: isCombatTarget && damageSource !== null && damageHits,
        };
    },

    /**
     * Apply effects from a single source to a target
     * @param {Object} source - The effect source
     * @param {Actor} target - The target actor
     * @param {boolean} isDamageSource - Whether this is the damage source (applies stat changes)
     * @returns {Object} { applied, targetPassable, targetShouldDie }
     */
    _applyEffectSource(source, target, isDamageSource) {
        let sourceApplied = false;
        let targetPassable = false;
        let targetShouldDie = false;

        for (const [key, rawValue] of Object.entries(source.effect)) {
            const value = this.resolveAttributeValue(rawValue, source.sourceActor);

            // For damage sources, apply stat changes
            // For utility sources, skip stat changes (only apply utility effects)
            if (target.stats && target.stats[key] !== undefined) {
                if (!isDamageSource) continue; // Skip stat effects for utility sources

                // Track attacker for defend_self behavior (when health is reduced)
                if (key === 'health' && value < 0 && source.sourceActor) {
                    target._lastAttacker = source.sourceActor;
                }

                let finalValue = value;

                // For health damage from weapons, apply critical hits and strength multiplier
                if (key === 'health' && value < 0) {
                    const isWeaponDamage = source.item?.hasAttribute('weapon') ||
                                           (source.sourceActor && !source.item); // Unarmed counts as weapon damage

                    if (isWeaponDamage && source.sourceActor) {
                        // Check for critical hit (before strength scaling)
                        if (source.item && source.sourceActor.checkCriticalHit(source.item)) {
                            finalValue = value * 2; // Double damage
                            if (source.sourceActor.isPlayerControlled()) {
                                source.sourceActor.engine.inputManager?.showMessage('Critical hit!');
                            }
                            console.log(`Critical hit! ${value} -> ${finalValue}`);
                        }

                        // Backstab: bonus damage vs. unaware targets (stacks with crit, before strength scaling)
                        const targetUnaware = target.isIncapacitated?.() ||
                                              (target.personality && !target._alerted);
                        if (targetUnaware) {
                            finalValue = Math.round(finalValue * BACKSTAB_MULTIPLIER);
                            if (source.sourceActor.isPlayerControlled()) {
                                source.sourceActor.engine.inputManager?.showMessage('Backstab!');
                            }
                            console.log(`Backstab! ${value} -> ${finalValue}`);
                            // Mark AI target as now alerted so follow-up hits aren't also backstabs
                            if (target.personality) {
                                target._alerted = true;
                                target._alertTarget = source.sourceActor;
                                target._alertTurns = target.personality.data?.memory_duration || 10;
                            }
                        }

                        // Strength scaling, shared with predictCombat via scaleDamage so
                        // the info panel's promise and the damage actually dealt can't
                        // drift apart. Damage is carried as a negative delta here, so
                        // scale the magnitude and re-sign. Enchantment is applied below,
                        // outside this branch, because it also applies to damage from a
                        // non-`weapon` item (a thrown enchanted flask, say).
                        const strength = source.sourceActor.getEffectiveStrength();
                        const scaled = source.sourceActor.scaleDamage(-finalValue);

                        if (strength !== 10) {
                            console.log(`Strength scaling: ${-finalValue} -> ${scaled} (str ${strength})`);
                        }
                        finalValue = -scaled;
                    }

                    // Apply weapon enchantment bonus
                    if (source.item?.enchantment) {
                        finalValue -= source.item.enchantment;
                    }
                }

                // Use centralized modifyStat for immediate UI updates
                const newValue = target.modifyStat(key, finalValue, { source: source });
                if (newValue !== null) {
                    console.log(`${source.name}: applied ${finalValue >= 0 ? '+' : ''}${finalValue} to ${target.name}'s ${key}`);
                    sourceApplied = true;

                    // Acid: striking an `acidic` target eats the weapon that landed
                    // the blow; an `acidic` attacker eats a piece of the target's armor.
                    if (key === 'health' && finalValue < 0 && source.sourceActor) {
                        if (target.hasAttribute('acidic') && source.item?.hasAttribute('weapon')) {
                            source.sourceActor.corrodeItem(source.item);
                        }
                        if (source.sourceActor.hasAttribute('acidic') && target.getCorrodibleArmor) {
                            target.corrodeItem(target.getCorrodibleArmor());
                        }
                    }

                    // Apply weapon proc effects after successful damage
                    if (key === 'health' && finalValue < 0 && source.sourceActor && source.item) {
                        source.sourceActor.applyWeaponProc(target, source.item, finalValue);

                        // Auto-identify weapon after enough combat use
                        source.item.noteCombatUse(source.sourceActor);
                    }

                    // Auto-identify armor after enough hits received (rings go by turns worn instead)
                    if (key === 'health' && finalValue < 0 && target.isPlayerControlled?.()) {
                        for (const slot of ['top', 'middle', 'lower']) {
                            const armor = target.equipment?.[slot];
                            if (armor?.identified === false && armor.hasAttribute('enchantable')) {
                                armor.combatUseCount = (armor.combatUseCount || 0) + 1;
                                if (armor.combatUseCount >= armor.getIdBlows()) {
                                    armor.identify();
                                    target.engine.inputManager?.showMessage(
                                        `You are now confident about your ${armor.getDisplayName()}.`
                                    );
                                }
                            }
                        }
                    }

                    if (key === 'health' && newValue <= 0) {
                        targetShouldDie = true;
                        targetPassable = true;
                    } else if (key === 'health' && finalValue < 0 && newValue > 0) {
                        // Non-fatal damaging hit: splitting creatures (pink jelly) split here.
                        // Never fires on a kill (handled above) or on healing (finalValue >= 0).
                        target.trySplit(this);
                    }
                }
                continue;
            }

            // Handle mining: health damage to breakable actors without health stat
            if (key === 'health' && isDamageSource && target.hasAttribute('breakable')) {
                const isMiningWeapon = source.item?.hasAttribute('mining');
                if (isMiningWeapon) {
                    // A swing can glance off. `dig_chance` is authored per item (default 1
                    // = always bites, preserving the old deterministic behaviour for tools
                    // that don't opt in), so designers can make a crude tool unreliable
                    // without the engine knowing anything about mattocks specifically.
                    //
                    // The target may override it: how reliably a swing bites is as much
                    // about what you're digging as what you're digging with. Rock turns a
                    // blade aside; loose earth doesn't. Target-authored `dig_chance` wins,
                    // so soft ground can be dependable even with a crude tool — the same
                    // target-over-tool precedence `dig_fail_message` uses just below.
                    const digChance = target.getAttribute('dig_chance')
                        ?? source.item.getAttribute('dig_chance')
                        ?? 1;
                    if (digChance < 1 && ROT.RNG.getUniform() >= digChance) {
                        sourceApplied = true;
                        if (source.sound) this.engine.playSound(source.sound);
                        if (this.isPlayerControlled()) {
                            // Target first, then tool: "glances off the stone" reads
                            // wrong when the target is soil, and only the target knows
                            // what it's made of. Mirrors how collision_description
                            // resolves against the target.
                            const miss = target.getAttribute('dig_fail_message')
                                || source.item.getAttribute('dig_fail_message')
                                || `Your ${source.item.getDisplayName?.() ?? source.item.name} glances off ${target.getNameWithArticle()}.`;
                            this.engine.inputManager?.showMessage(miss);
                        }
                        continue; // costs the turn, but no progress and no wear
                    }

                    // Use mining_power from the weapon, default to 25
                    const miningPower = source.item.getAttribute('mining_power') || 25;
                    // Initialize mining damage tracker on target
                    if (target._miningDamage === undefined) {
                        target._miningDamage = 0;
                    }
                    target._miningDamage += miningPower;

                    // Threshold to break (default 100)
                    const breakThreshold = target.getAttribute('break_threshold') || 100;

                    console.log(`Mining ${target.name}: ${target._miningDamage}/${breakThreshold}`);
                    sourceApplied = true;

                    // Play mining sound
                    if (source.sound) {
                        this.engine.playSound(source.sound);
                    }

                    // Show mining progress message. `mine_messages` lets a target
                    // narrate its own excavation — a grave turns over soil where a wall
                    // cracks and crumbles — keyed by the progress band just reached
                    // (0/25/50/75/100, string keys since it comes from JSON). Any band
                    // the data omits falls back to the stone wording, so a target that
                    // declares nothing reads exactly as it always did.
                    if (this.isPlayerControlled() && this.engine.inputManager) {
                        const broke = target._miningDamage >= breakThreshold;
                        const progress = broke
                            ? 100
                            : Math.min(100, Math.floor((target._miningDamage / breakThreshold) * 100));
                        const band = broke ? 100
                            : progress >= 75 ? 75
                            : progress >= 50 ? 50
                            : progress >= 25 ? 25
                            : 0;
                        const fallbacks = {
                            100: `The ${target.name} crumbles!`,
                            75: `The ${target.name} is nearly broken.`,
                            50: `Cracks spread through the ${target.name}.`,
                            25: `The ${target.name} chips away.`,
                            0: `You strike the ${target.name}.`
                        };
                        const authored = target.getAttribute('mine_messages');
                        const template = authored?.[band] ?? authored?.[String(band)] ?? fallbacks[band];
                        this.engine.inputManager.showMessage(
                            resolveTemplate(template, target, {
                                providers: {
                                    name: () => target.getNameWithArticle(),
                                    tool_name: () => source.item.getDisplayName?.() ?? source.item.name
                                }
                            })
                        );
                    }

                    if (target._miningDamage >= breakThreshold) {
                        targetShouldDie = true;
                        // Don't set targetPassable - miner shouldn't move into the space on the same turn
                    }

                    // A productive swing wears the tool. Only successful digs count, so a
                    // glancing blow costs a turn but not durability (it returned above).
                    this.degradeItem(source.item);
                    continue;
                }
            }

            // Handle apply_state: apply a state to the target. Accepts a bare state name
            // or { state, duration } so a trap/attack can set its own duration.
            if (key === 'apply_state' && isDamageSource) {
                if (target.applyAuthoredState(value, { source: this })) {
                    sourceApplied = true;
                }
                continue;
            }

            // Fall back to attributes
            const currentValue = target.getAttribute(key);

            if (value === 'toggle') {
                if (currentValue !== undefined) {
                    target.setAttribute(key, !currentValue);
                    console.log(`${source.name}: toggled ${target.name}'s ${key} to ${!currentValue}`);
                    sourceApplied = true;
                }
            }
            else if (typeof value === 'number' && typeof currentValue === 'number') {
                if (!isDamageSource) continue; // Skip numeric attribute changes for utility
                const newValue = currentValue + value;
                target.setAttribute(key, newValue);
                console.log(`${source.name}: ${target.name}'s ${key} ${value >= 0 ? '+' : ''}${value} (now ${newValue})`);
                sourceApplied = true;

                if (key === 'health' && newValue <= 0) {
                    targetShouldDie = true;
                    targetPassable = true;
                }
            }
            else if (typeof value === 'boolean') {
                // An unlock only applies to a door that is actually locked. A plain
                // door is `lockable` with locked:false, so without that check a key
                // was spent just walking through an open doorway.
                const isUnlock = key === 'locked' && value === false && target.hasAttribute('locked');

                if (isUnlock && target.hasAttribute('color_locked')) {
                    const targetLockColor = target.getAttribute('lock_color');
                    const sourceLockColor = source.lockColor;

                    if (targetLockColor && sourceLockColor && targetLockColor === sourceLockColor) {
                        console.log(`${source.name} (${sourceLockColor}) unlocks ${target.name} (${targetLockColor})!`);
                        targetPassable = this._unlockTarget(target, key, value, source);
                        sourceApplied = true;
                    } else {
                        console.log(`${source.name} (${sourceLockColor || 'no color'}) doesn't match ${target.name} (${targetLockColor})`);
                        if (this.isPlayerControlled() && targetLockColor) {
                            this.engine.inputManager?.showMessage(`${target.getNameWithArticle(true)} requires a ${targetLockColor} key.`);
                        }
                    }
                }
                else if (currentValue !== undefined) {
                    // Any key opens any GENERIC locked door (lockable, no color_locked),
                    // but never a stairway (owned by the win-condition system), a gate
                    // (switch/machine-driven), or an unlock_conditions lock. Color-locked doors took the branch above.
                    // All other boolean effects set freely.
                    const isKeyUnlock = isUnlock && source.item?.hasAttribute('key');
                    if (isKeyUnlock) {
                        const isGenericLockableDoor = target.hasAttribute('lockable') &&
                            !target.hasAttribute('color_locked') &&
                            !target.hasAttribute('stairway') &&
                            !target.hasAttribute('gate') &&
                            !target.getAttribute('unlock_conditions');
                        if (isGenericLockableDoor) {
                            console.log(`${source.name} unlocks ${target.name} (generic lock)`);
                            targetPassable = this._unlockTarget(target, key, value, source);
                            sourceApplied = true;
                        }
                        // else: not a key-openable lock (stairway/gate/non-lockable) — inert,
                        // key not consumed, player gets the standard locked-rejection feedback.
                    } else {
                        target.setAttribute(key, value);
                        console.log(`${source.name}: set ${target.name}'s ${key} to ${value}`);
                        sourceApplied = true;
                    }
                }
            }
        }

        if (sourceApplied && source.sound) {
            this.engine.playSound(source.sound);
        }

        return { applied: sourceApplied, targetPassable, targetShouldDie };
    },

    /**
     * Open a lock the source just matched, and spend the key if it's consumable.
     * Shared by the color-locked and generic-lock paths so the two can't drift.
     *
     * @param {Actor} target - The door/lock being opened
     * @param {string} key - Attribute being cleared (always 'locked')
     * @param {boolean} value - Value being set (always false)
     * @param {Object} source - The effect source, carrying the item that unlocked it
     * @returns {boolean} Whether the target is now passable
     */
    _unlockTarget(target, key, value, source) {
        target.setAttribute(key, value);
        this.engine.playSound?.('lock');
        target.open(this);
        this.engine.updateLighting();

        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`The ${source.name} unlocks ${target.getNameWithArticle()}!`);
        }

        if (source.item?.hasAttribute('consumable')) {
            this.inventory = this.inventory.filter(i => i !== source.item);
            console.log(`${source.name} was consumed`);
        }

        return !target.hasAttribute('solid');
    },

    /**
     * Feedback for a blow that lands but cannot hurt the target — either the target
     * is melee_immune or the attacker is melee_harmless. Mirrors _showMissMessage's
     * player/observer split, but says "no effect" rather than "miss": the attack
     * connected, it just didn't matter.
     *
     * The player-facing wording splits on which side nullified the blow, because
     * "glances off" reads as the target being tough, which is the wrong story when
     * the weakness is the attacker's or when the target simply outranks it.
     *
     * @param {Actor} target - The actor that shrugged the blow off
     * @param {Object} [opts]
     * @param {boolean} [opts.outranked] - The blow failed on rank, not immunity
     */
    _showMeleeImmuneMessage(target, { outranked = false } = {}) {
        if (this.isPlayerControlled()) {
            const harmless = this.hasAttribute('melee_harmless') && !target.hasAttribute('melee_immune');
            let message;
            if (outranked) message = `${target.getNameWithArticle(true)} is too strong to take!`;
            else if (harmless) message = `You cannot harm ${target.getNameWithArticle()}!`;
            else message = `Your blow glances off ${target.getNameWithArticle()} harmlessly!`;
            this.engine.inputManager?.showMessage(message);
        } else {
            const template = "The [actor_name] strikes the [attacked_actor_name] to no effect!";
            const message = this._processMessageTemplate(template, target);
            const pos = target.isPlayerControlled?.() ? null : { x: this.x, y: this.y };
            this.engine.inputManager?.showMessage(message, pos);
        }

        console.log(`Melee immune: ${this.name} -> ${target.name}`);
    },

    /**
     * Show a miss message for failed attacks using template system
     * @param {Actor} target - The target that was missed
     */
    _showMissMessage(target) {
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`You miss ${target.getNameWithArticle()}!`);
        } else {
            // Use template: "The [actor_name] [attacks.miss_verbs] the [attacked_actor_name]!"
            const template = "The [actor_name] [attacks.miss_verbs] the [attacked_actor_name]!";
            const message = this._processMessageTemplate(template, target);
            const pos = target.isPlayerControlled?.() ? null : { x: this.x, y: this.y };
            this.engine.inputManager?.showMessage(message, pos);
        }

        console.log(`Miss: ${this.name} -> ${target.name}`);
    },

    /**
     * Process a message template with substitution (shared by hit/miss messages)
     * @param {string} template - Template string with [key] placeholders
     * @param {Actor} target - The target actor
     * @returns {string} Processed message
     */
    _processMessageTemplate(template, target) {
        const result = resolveTemplate(template, this, { providers: this._nameProviders(target) });
        return this._hideAnonymousArticle(result);
    },
};
