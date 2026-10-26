/**
 * Item: an item on the floor or in an inventory.
 */

import { parseTint, resolveEntityEffect, resolveTemplate, rollRandomEffect } from '../core/util.js';
import { Entity } from './entity.js';
import { globalVars } from '../globals.js';

export class Item extends Entity {
    /**
     * Player-facing description fields, all read from attributes. Each is a template
     * resolved against the item (see resolveTemplate), and each answers a different
     * question, so they are deliberately not merged:
     *
     *   description           — what the thing IS. Shown while browsing, so it is
     *                           memoized and withheld until the item is identified.
     *   use_description       — what happens WHEN YOU USE IT. Read once per use, so
     *                           it re-rolls its random words for variety.
     *   effect_description    — what the effect DOES, in the abstract. Reusable
     *                           wherever an effect is named, independent of using it.
     *   collision_description — what happens when you HIT something with it.
     *
     * Authoring either at root level or inside `attributes` works; the constructor
     * bridges root-level ones in. Actors have the same bridge for their own set.
     */
    static DESCRIPTION_FIELDS = [
        'description', 'use_description', 'effect_description', 'collision_description'
    ];

    /** Fallback for the `id_blows` attribute: blows struck (weapons) or taken while worn (armor) before gear auto-identifies. */
    static COMBAT_ID_THRESHOLD = 20;

    /** Blows this weapon or armor needs before it auto-identifies (type attribute `id_blows`). */
    getIdBlows() {
        return this.getAttribute('id_blows') ?? Item.COMBAT_ID_THRESHOLD;
    }

    /**
     * Count one telling blow toward identifying an unidentified weapon: a melee
     * hit, or a shot fired from it as a launcher. Identifies it at the threshold.
     * @param {Actor} user - Who struck the blow; only the player learns from it
     */
    noteCombatUse(user) {
        if (!user?.isPlayerControlled() || this.identified !== false || !this.hasAttribute('enchantable')) return;
        this.combatUseCount = (this.combatUseCount || 0) + 1;
        if (this.combatUseCount >= this.getIdBlows()) {
            this.identify();
            user.engine.inputManager?.showMessage(`You are now confident about your ${this.getDisplayName()}.`);
        }
    }

    /**
     * An authored effect message (e.g. `effect_message`, `fail_message`) resolved
     * as a template, or `fallback` when this item doesn't set one. `[item_name]`
     * is always available; callers add tokens like `[target_name]`.
     * @param {string} key - Attribute holding the message
     * @param {string} fallback - Built-in text
     * @param {Object} [providers] - Extra template tokens: { name: () => string }
     */
    getEffectMessage(key, fallback, providers = {}) {
        const authored = this.getAttribute(key);
        if (!authored) return fallback;
        return resolveTemplate(authored, this, {
            providers: { item_name: () => this.getDisplayName(), ...providers }
        });
    }

    /** Fallback for the `id_turns` attribute: turns a ring must be worn before it auto-identifies (Brogue's RING_DELAY_TO_AUTO_ID). */
    static RING_ID_TURNS = 1500;

    /** Turns this ring must be worn before it auto-identifies (type attribute `id_turns`). */
    getIdTurns() {
        return this.getAttribute('id_turns') ?? Item.RING_ID_TURNS;
    }

    constructor(x, y, type, data, engine) {
        super(x, y, type, engine);
        this.name = data.name || type;
        this.tileIndex = engine.spriteLibrary.resolveTile(data.tileIndex) || {x: 0, y: 0};
        this.height = 1;
        this.flipH = data.flipH || false;
        this.flipV = data.flipV || false;
        this.setAttribute('pickupable', true);
        this.setAttribute('visible', true);

        // Identification system
        this.unidentifiedTemplate = data.unidentified_template || null;
        this.identifiedTemplate = data.identified_template || null;
        // Store template variables for substitution (copy so we can modify per-instance)
        this.templateVars = { ...(data.template_vars || {}) };

        // Handle random color assignment for items with random_color flag
        if (data.random_color && engine.currentPrototype) {
            let assignedColor;

            // Keys use the lock pairing system - each key gets a color matching a door
            if (data.attributes?.key) {
                assignedColor = engine.currentPrototype.getKeyColor();
                if (assignedColor) {
                    // Store the lock_color for matching with doors
                    this.setAttribute('lock_color', assignedColor.color);
                }
            } else {
                // Other items (potions, etc.) use type-based color assignment
                assignedColor = engine.currentPrototype.getColorForItemType(type);
            }

            if (assignedColor) {
                // Set the color name for template substitution
                this.templateVars.color = assignedColor.color;
                // Set the tint from the hex value
                this.tint = parseTint(assignedColor.hex);
            } else {
                this.tint = parseTint(data.tint);
            }
        } else {
            this.tint = parseTint(data.tint);
        }

        // Handle random material assignment for items with random_material flag (rings).
        // Rings are named by material ("iron ring") rather than color; the material is
        // memoized per type so all rings of one kind share a stable unidentified name.
        if (data.random_material && engine.currentPrototype) {
            const material = engine.currentPrototype.getMaterialForItemType(type);
            if (material) {
                this.templateVars.material = material;
            }
        }

        // Handle glyph name assignment for items with random_glyph_name flag (scrolls)
        if (data.random_glyph_name && engine.currentPrototype) {
            const glyphName = engine.currentPrototype.getOrAssignScrollName(type);
            this.templateVars.glyph_name = glyphName;
        }

        // Identification status - check if this type was already identified
        if (data.identified === false) {
            if (data.attributes?.enchantable) {
                this.identified = false;
            } else {
                this.identified = engine.currentPrototype?.isTypeIdentified(type) ?? false;
            }
        } else {
            this.identified = data.identified ?? true;
        }

        // Description fields may be authored at root level or inside `attributes`;
        // attributes is canonical, so root-level ones are bridged in here. Without
        // this the constructor's fixed extraction list silently drops them — which
        // is how 34 potions came to carry an `effect_description` nothing could read.
        // Runs BEFORE the attributes loop so an explicit attribute wins over root.
        for (const key of Item.DESCRIPTION_FIELDS) {
            if (data[key] !== undefined && data[key] !== null) {
                this.setAttribute(key, data[key]);
            }
        }

        // A description at BOTH levels is a deliberate split, not a duplicate: sword's
        // root text is what it looks like, its attribute text is what it does. The loop
        // above would discard the root one, so keep it — only the stats text has to be
        // withheld before identification. See getPanelDescription.
        if (data.description && data.attributes?.description
            && data.description !== data.attributes.description) {
            this.setAttribute('flavor_description', data.description);
        }

        if (data.attributes) {
            Object.entries(data.attributes).forEach(([key, value]) => {
                this.setAttribute(key, value);
            });
        }

        // Handle random effect generation for generic potions
        if (data.random_effect && engine.currentPrototype) {
            this.generateRandomEffect(engine);
        }

        // Handle random value (e.g., gold nuggets worth 1-10)
        if (data.random_value && Array.isArray(data.random_value) && data.random_value.length === 2) {
            const [min, max] = data.random_value;
            this.value = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        }

        // Initialize item stats (similar to Actor stats)
        // Supports per_turn modification for recharging items like staffs
        this.stats = {};
        if (data.stats) {
            for (const [stat, value] of Object.entries(data.stats)) {
                if (typeof value === 'object' && value.max !== undefined) {
                    this.stats[stat] = {
                        ...value, // Preserve all config (per_turn, ready_at, etc.)
                        current: value.current !== undefined ? value.current : (value.start !== undefined ? value.start : value.max),
                        per_turn: value.per_turn || 0
                    };
                } else {
                    // Simple numeric value - store as current/max object
                    this.stats[stat] = { current: value, max: value, per_turn: 0 };
                }
            }
        }

        this.count = 1;
        this.enchantment = data.enchantment ?? 0;
        // A name the player gave this item (see `nameable`). Replaces the item's own
        // name in getDisplayName(); the enchantment still shows.
        this.customName = null;
        // Set by detect magic (see detectMagic); shows the item's polarity to the player.
        this.magicDetected = false;

        // Roll random enchantment on spawn if enchant_range is defined and no explicit enchantment
        if (data.enchantment === undefined && data.attributes?.enchant_range) {
            const [min, max] = data.attributes.enchant_range;
            this.enchantment = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        }

        if (this.enchantment < 0 && this.hasAttribute('enchantable')) {
            this.setAttribute('cursed', true);
        }

        this.effect = resolveEntityEffect(data);
        this.combatUseCount = 0;
        this.wornTurns = 0;
    }

    /**
     * Process per-turn stat changes for this item (recharging, decay, etc.)
     * Called by the owner's act() method
     */
    processPerTurnStats() {
        if (!this.stats) return;

        for (const [statName, stat] of Object.entries(this.stats)) {
            if (typeof stat !== 'object' || stat.per_turn === undefined) continue;

            let perTurn = stat.per_turn;
            if (perTurn === 0) continue;

            // A carried staff recharges faster or slower with its owner's
            // recharge_bonus (ring of wisdom). Only recharging counts, not decay.
            if (perTurn > 0 && statName === this.getAttribute('charge_stat')
                && this.owner?.inventory?.includes(this)) {
                perTurn *= this.owner.getRechargeMultiplier?.() ?? 1;
            }

            const oldValue = stat.current;
            stat.current = Math.min(stat.max, Math.max(0, stat.current + perTurn));

            // Check if stat crossed the ready_at threshold (for charged items)
            if (stat.ready_at !== undefined) {
                const wasReady = oldValue >= stat.ready_at;
                const isReady = stat.current >= stat.ready_at;

                // Show message when item becomes ready
                if (!wasReady && isReady && stat.ready_message && this.owner?.isPlayerControlled()) {
                    const message = resolveTemplate(stat.ready_message, this, {
                        providers: { item_name: () => this.getDisplayName() }
                    });
                    this.owner.engine.inputManager?.showMessage(message);
                }
            }

            this.checkStatWarnings(stat, oldValue);
        }
    }

    /**
     * Fire any `warnings` whose threshold this stat just dropped below.
     *
     * Split out of the per-turn loop so stats that change on *use* rather than per turn
     * (e.g. `condition`, spent by degradeItem) get the same warnings — that loop skips
     * anything without a `per_turn`, so those stats would otherwise never warn.
     *
     * @param {Object} stat - The stat object ({current, max, warnings})
     * @param {number} oldValue - Its value before the change
     */
    /**
     * True while this item is consuming fuel (a lit torch or stick of incense).
     * An unlit one stays per_turn 0 and has no buring state.
     */
    isBurning() {
        const burns = this.stats?.burns;
        return !!burns && burns.per_turn < 0;
    }

    checkStatWarnings(stat, oldValue) {
        if (!stat?.warnings || !this.owner?.hasAttribute('controlled')) return;
        for (const warning of stat.warnings) {
            const threshold = warning.threshold * stat.max;
            if (oldValue > threshold && stat.current <= threshold) {
                this.owner.engine.inputManager?.showMessage(warning.message);
            }
        }
    }

    /**
     * Get the current value of an item stat
     * @param {string} statName - Name of the stat
     * @returns {number|null} Current value or null if stat doesn't exist
     */
    getStat(statName) {
        const stat = this.stats?.[statName];
        if (!stat) return null;
        return typeof stat === 'object' ? stat.current : stat;
    }

    /**
     * Check if an item stat is at or above its ready threshold
     * @param {string} statName - Name of the stat to check
     * @returns {boolean} True if stat is ready (at or above ready_at threshold)
     */
    isStatReady(statName) {
        const stat = this.stats?.[statName];
        if (!stat || typeof stat !== 'object') return true; // No stat or simple stat = always ready

        // Calculate threshold: ready_at takes priority, otherwise max / uses
        const uses = this.getAttribute('uses') || 1;
        const readyAt = stat.ready_at ?? Math.floor(stat.max / uses);

        return stat.current >= readyAt;
    }

    /**
     * Can this item share an inventory slot with `other`?
     *
     * Stacking used to require BOTH items to have no stats at all, which quietly
     * excluded anything carrying a consumable stat — so three identical unlit
     * torches (each with a full `burns` stat) sat in three slots while three spikes
     * stacked. The real requirement is that the items be indistinguishable: a
     * half-burnt torch must NOT merge into a fresh one, because merging would throw
     * away the difference (a stack keeps one `count`, not one value per unit).
     *
     * So compare the stats instead of forbidding them: every stat must sit at the
     * same value, which for consumables means "both untouched" in practice.
     */
    canStackWith(other) {
        if (!other || other === this) return false;
        if (other.type !== this.type) return false;
        if (!this.getAttribute('stackable') || !other.getAttribute('stackable')) return false;
        // Identification state is visible to the player, so don't merge across it.
        if ((this.identified !== false) !== (other.identified !== false)) return false;

        const keys = new Set([...Object.keys(this.stats || {}), ...Object.keys(other.stats || {})]);
        for (const key of keys) {
            const a = this.stats?.[key];
            const b = other.stats?.[key];
            const av = (a && typeof a === 'object') ? a.current : a;
            const bv = (b && typeof b === 'object') ? b.current : b;
            if (av !== bv) return false;
        }
        return true;
    }

    /**
     * Modify an item stat
     * @param {string} statName - Name of the stat
     * @param {number} amount - Amount to add (negative to subtract)
     * @returns {number|null} New value or null if stat doesn't exist
     */
    modifyStat(statName, amount) {
        const stat = this.stats?.[statName];
        if (!stat) return null;

        if (typeof stat === 'object') {
            stat.current = Math.min(stat.max, Math.max(0, stat.current + amount));
            return stat.current;
        } else {
            this.stats[statName] += amount;
            return this.stats[statName];
        }
    }

    /**
     * Generate a random stat effect for this item based on available player stats
     * Sets use_effect attribute and generates an appropriate description
     * @param {DungeonEngine} engine - The game engine
     */
    generateRandomEffect(engine) {
        // Shared potion-style roll (also used by fungus spores). Map the normalized
        // result back onto this item's use_effect: a state → { apply_state }, a stat
        // change → { [stat]: delta } (identical to the prior inline behavior).
        const roll = rollRandomEffect(engine);
        this.templateVars.effect_description = roll.effect_description;
        if (roll.apply_state) {
            this.setAttribute('use_effect', { apply_state: roll.apply_state });
            // A harmful state declares itself bad; anything else keeps the type's default
            if (engine.globalStates?.[roll.apply_state]?.magic_polarity === 'bad') {
                this.setAttribute('magic_polarity', 'bad');
            }
        } else if (roll.collision_effect) {
            this.setAttribute('use_effect', roll.collision_effect);
            const delta = Object.values(roll.collision_effect)[0];
            this.setAttribute('magic_polarity', delta < 0 ? 'bad' : 'good');
        }
    }

    /**
     * Whether a message should decline to name this item.
     *
     * Note this gates prose only — `getDisplayName()` stays true, so the pack and
     * the sidebar still read correctly.
     *
     * @returns {boolean}
     */
    isAnonymous() {
        const viewer = this.engine?.entityManager?.getPrimaryViewpoint?.();
        if (!viewer?.hasStateProperty?.('hallucinating')) return false;
        return !viewer.inventory?.includes(this);
    }

    /**
     * The name shown to the player.
     *
     * An item's name is a template: the identified/unidentified template if it has
     * one, otherwise its plain `name`, which may itself carry tokens. Memoized, so
     * a random word picked for the name stays put across renders instead of the
     * item appearing to rename itself on every hover.
     *
     * @param {Object} [options]
     * @param {boolean} [options.ignoreCustomName] - Show what the item really is,
     *        not what the player named it
     * @returns {string} The name to display
     */
    getDisplayName({ ignoreCustomName = false } = {}) {
        const blindName = this.getBlindName();
        if (blindName) return blindName;

        const template = this.identified ? this.identifiedTemplate : this.unidentifiedTemplate;

        let name = (!ignoreCustomName && this.customName) || resolveTemplate(template || this.name, this, {
            memoize: true,
            // The raw noun, so "[item_name] of [reagents.reagents]" can build on it
            // without recursing back into this method.
            providers: { item_name: () => this.name }
        });

        // Decoration sits outside the template: it applies whether or not the item
        // has one (an identified staff still shows its +2), and it stays out of the
        // resolver so the UI (ui/interface-manager.js colorizeItemName) can spot the "Cursed" prefix for coloring.
        if (this.identified !== false) {
            if (this.enchantment < 0 && this.hasAttribute('cursed')) {
                name = `Cursed ${name}`;
            }
            if (this.enchantment && this.enchantment !== 0) {
                const sign = this.enchantment > 0 ? '+' : '';
                name += ` ${sign}${this.enchantment}`;
            }
        }
        return name;
    }

    /**
     * What a blind viewer (a `vision_cap` state) calls this item, or null when they
     * can see. Kinds told apart by sight — anything with an unidentified template:
     * potions, scrolls, rings, wands, staffs — shrink to their type's noun, so color,
     * material, glyph and identified name all drop away. A sword is still a sword.
     * @returns {string|null}
     */
    getBlindName() {
        if (!this.unidentifiedTemplate) return null;
        const viewer = this.engine?.entityManager?.getPrimaryViewpoint?.();
        if (!viewer?.findStateWithProperty?.('vision_cap')) return null;
        const category = this.getCategory();
        return this.engine.currentPrototype?.types?.[category]?.name || category || null;
    }

    /**
     * Whether the player may give this item a name: it has `nameable` and is
     * identified, so you know what you're naming.
     * @returns {boolean}
     */
    canBeNamed() {
        return !!this.getAttribute('nameable') && this.identified !== false;
    }

    /**
     * Identify this item and all items of the same type in this prototype
     */
    identify() {
        this.identified = true;
        if (!this.hasAttribute('enchantable') && this.engine.currentPrototype) {
            this.engine.currentPrototype.identifyType(this.type);
        }
    }

    /**
     * Whether this item carries good or bad magic, or none — what detect magic
     * senses. Mirrors Brogue's itemMagicChar (Items.c): a curse or negative
     * enchantment is always bad; otherwise an authored `magic_polarity` ("good" /
     * "bad", set per type and overridden per item) decides; failing that, enchanted
     * gear is good and plain gear has no magic at all.
     * @returns {'good'|'bad'|null}
     */
    getMagicPolarity() {
        if (this.hasAttribute('cursed') || this.enchantment < 0) return 'bad';
        const declared = this.getAttribute('magic_polarity');
        if (declared === 'good' || declared === 'bad') return declared;
        if (this.hasAttribute('enchantable') && this.enchantment > 0) return 'good';
        return null;
    }

    /**
     * Detect magic on this item (Brogue's detectMagicOnItem). Once detected, its
     * polarity shows beside it in the pack and as a marker on the map. Plain
     * weapons and armor have nothing left to learn, so they identify outright.
     * @returns {'good'|'bad'|null} The polarity sensed, or null for a mundane item
     */
    detectMagic() {
        this.magicDetected = true;
        const wearable = this.getAttribute('wearable');
        if (this.identified === false && this.hasAttribute('enchantable') && this.enchantment === 0
            && (this.hasAttribute('weapon') || (wearable && wearable !== 'ring'))) {
            this.identify();
        }
        return this.getMagicPolarity();
    }

    /**
     * The polarity the player knows about — null until magic has been detected on
     * this item. Read live, so enchanting or uncursing a detected item updates it.
     * @returns {'good'|'bad'|null}
     */
    getDetectedMagicPolarity() {
        if (!this.magicDetected) return null;
        return this.getMagicPolarity();
    }

    /**
     * Template providers for the numbers a description quotes — [damage], [defense]
     * and friends. These aren't generic: `damage` means "collision_effect.health,
     * absolute, plus enchantment", which is weapon domain knowledge and belongs here
     * rather than in the shared resolver.
     *
     * Thunks, so a description that doesn't mention a stat never computes it.
     *
     * @returns {Object<string, function>} Provider map for resolveTemplate
     */
    _statProviders() {
        // Any key of wear_effect/passive_effect is quotable — this is what makes
        // [awareness] work on ring_of_awareness. Spread first so the explicit,
        // enchantment-aware entries below win where they overlap.
        const effectKeys = {};
        for (const slot of ['wear_effect', 'passive_effect']) {
            const effect = this.getAttribute(slot);
            if (!effect || typeof effect !== 'object') continue;
            for (const [key, value] of Object.entries(effect)) {
                effectKeys[key] = () => value;
            }
        }

        return {
            ...effectKeys,
            damage: () => Math.abs(this.getAttribute('collision_effect')?.health || 0)
                + (this.enchantment || 0),
            defense: () => (this.getAttribute('wear_effect')?.defense
                || this.getAttribute('passive_effect')?.defense || 0) + (this.enchantment || 0),
            strength: () => this.getAttribute('wear_effect')?.strength
                || this.getAttribute('passive_effect')?.strength || 0,
            knockback: () => this.getAttribute('knockback_distance') || 1,
            critical_chance: () => this.getAttribute('critical_chance') || 0,
            lifesteal: () => this.getAttribute('lifesteal_percent') || 0,
            mining_power: () => this.getAttribute('mining_power') || 0
        };
    }

    /**
     * The message shown when this item is used. Re-rolls its random words on every
     * call — it's read once per use, so variety is the point.
     * @returns {string|null} The processed use description or null if none
     */
    getUseDescription() {
        const raw = this.getAttribute('use_description');
        if (!raw) return null;
        return resolveTemplate(raw, this, {
            providers: {
                item_name: () => this.getDisplayName(),
                // Lets a use_description quote the effect without repeating its text.
                // Falls back to templateVars for a rolled random effect, which is the
                // path mystery_potion already used before the field was readable.
                effect_description: () => this.getEffectDescription()
                    ?? this.templateVars?.effect_description
            }
        });
    }

    /**
     * The item's description, with the numbers it quotes filled in. Memoized: this
     * panel is re-read as the player browses, so a word that changed each time
     * would read as a rendering glitch.
     * @returns {string|null}
     */
    getDescription() {
        const raw = this.getAttribute('description');
        if (!raw) return null;
        return resolveTemplate(raw, this, { memoize: true, providers: this._statProviders() });
    }

    /**
     * What this item's effect does, stated independently of using it — so a UI can
     * name the effect without claiming the player just drank it. Memoized like
     * getDescription, since it is display text rather than a one-shot message.
     *
     * An item with `random_effect` has its rolled description in templateVars
     * instead (generateRandomEffect), so that is the fallback.
     * @returns {string|null}
     */
    getEffectDescription() {
        const raw = this.getAttribute('effect_description')
            ?? this.templateVars?.effect_description;
        if (!raw) return null;
        return resolveTemplate(raw, this, { memoize: true, providers: this._statProviders() });
    }

    /**
     * Whether this item is worth a full info panel.
     *
     * More permissive than Actor.hasInfoPanel — items are never on screen in gas-cloud
     * numbers, and anything you can pick up has something to say. `pickupable` excludes
     * scenery items.
     *
     * @returns {boolean}
     */
    hasInfoPanel() {
        return this.hasAttribute('pickupable');
    }

    /**
     * Does this text quote a number the player hasn't earned yet? Derived from
     * _statProviders rather than a hardcoded list, so it covers the wear_effect keys
     * that map dynamically and can't fall behind as providers are added.
     * @returns {boolean}
     */
    quotesAStat(text) {
        if (!text) return false;
        return Object.keys(this._statProviders()).some(key => text.includes(`[${key}]`));
    }

    /**
     * The description the player is allowed to read right now. Gated here rather than at
     * the call site so every panel inherits it: `description` quotes real numbers
     * ("[damage] damage" folds in the rolled enchantment), so an unidentified item gets
     * category text instead. Mirrors Brogue's itemDetails (Items.c:1794).
     *
     * @returns {string|null}
     */
    getPanelDescription() {
        if (this.identified !== false) return this.getDescription();

        const resolve = (text) => resolveTemplate(text, this,
            { memoize: true, providers: this._statProviders() });

        // Authored flavor wins — it was written for this item, unlike a category blurb.
        const flavor = this.getAttribute('flavor_description');
        if (flavor && !this.quotesAStat(flavor)) return resolve(flavor);

        // Items declaring no `type` fall back to what they do: the mattock and the
        // butter knife are weapons by attribute only.
        const types = this.engine?.currentPrototype?.types;
        const blurbFor = (cat) => types?.[cat]?.unidentified_description;
        const blurb = blurbFor(this.getCategory())
            ?? (this.hasAttribute('weapon') ? blurbFor('weapon') : null)
            ?? (this.getAttribute('wearable') ? blurbFor('armor') : null);
        if (blurb) return resolve(blurb);

        // No blurb, so the authored text is safe only if it quotes no stats — which is
        // how the staff/wand/scroll type defaults pass.
        const authored = this.getAttribute('description');
        if (!authored || this.quotesAStat(authored)) return null;
        return resolve(authored);
    }

    /**
     * This item's category — 'potion', 'ring', 'weapon' — or null if it declares none.
     *
     * `type` means two things here: on a DEFINITION it's the category, on an INSTANCE
     * `this.type` is the item id ('health_potion'). The category doesn't survive onto the
     * instance, so read it back from the definition — memoized, so this is a map hit.
     *
     * @returns {string|null}
     */
    getCategory() {
        return this.engine?.currentPrototype?.getItemData(this.type)?.type || null;
    }

    /**
     * What equipping this item would do to the wearer's stats, without equipping it —
     * Brogue reports the rating you'd end up with, not the item's raw number
     * (Items.c:1953-2008).
     *
     * Swaps the item into its slot and re-reads the same getEffective* getters the engine
     * uses, rather than re-deriving the totals here, which would drift from their subtler
     * rules. Restored in a finally, so nothing observes the intermediate state.
     *
     * @param {Actor} wearer - The actor considering the item
     * @returns {Object|null} { slot, displaced, changes: [{stat, from, to}], canEquip,
     *                          reason } or null if the item is not equippable
     */
    previewEquipDelta(wearer) {
        if (!wearer?.equipment) return null;
        if (wearer.isItemEquipped?.(this)) return null;

        // Which slot this would occupy, by the same rules the equip paths use.
        let slot = null;
        if (this.hasAttribute('weapon')) {
            slot = 'weapon';
        } else {
            const wearable = this.getAttribute('wearable');
            if (wearable === 'ring') {
                // First free ring slot, else ring1 — matches Actor.equipItem, and is why
                // the displaced ring has to be named rather than left implicit.
                slot = !wearer.equipment.ring1 ? 'ring1'
                    : !wearer.equipment.ring2 ? 'ring2' : 'ring1';
            } else if (['top', 'middle', 'lower'].includes(wearable)) {
                slot = wearable;
            }
        }
        if (!slot) return null;

        const displaced = wearer.equipment[slot] || null;
        const { canEquip, reason } = wearer.canEquipItem?.(this) ?? { canEquip: true, reason: null };

        // accuracy is null for actors with no accuracy attribute, which isn't zero.
        const read = () => ({
            accuracy: wearer.getEffectiveAccuracy?.() ?? null,
            defense: wearer.getEffectiveDefense?.() ?? null,
            strength: wearer.getEffectiveStrength?.() ?? null,
        });

        const before = read();
        let after;

        // Zero enchantment when unidentified: getEffectiveDefense folds it in, so a +2
        // chainmail would forecast 10 against a listed 8 and the player could subtract to
        // read off the enchantment we are hiding.
        const hideEnchantment = this.identified === false && this.enchantment;
        const trueEnchantment = this.enchantment;

        try {
            if (hideEnchantment) this.enchantment = 0;
            wearer.equipment[slot] = this;
            after = read();
        } finally {
            wearer.equipment[slot] = displaced;
            if (hideEnchantment) this.enchantment = trueEnchantment;
        }

        const changes = [];
        for (const stat of ['accuracy', 'defense', 'strength']) {
            const from = before[stat];
            const to = after[stat];
            if (from === null || to === null || from === to) continue;
            changes.push({ stat, from, to });
        }

        return { slot, displaced, changes, canEquip, reason };
    }

    /**
     * Update sprite position accounting for flip anchor offset
     */
    updateSpritePosition() {
        if (!this.sprite) return;

        let x = this.x * globalVars.TILE_WIDTH;
        let y = this.y * globalVars.TILE_HEIGHT;

        // Account for center anchor when item has flip
        if (this.flipH || this.flipV) {
            x += globalVars.TILE_WIDTH / 2;
            y += globalVars.TILE_HEIGHT / 2;
        }

        this.sprite.x = x;
        this.sprite.y = y;
    }

    use(actor) {
        console.log(`${actor.name} used ${this.name}`);
    }

    serialize() {
        return {
            ...super.serialize(),
            identified: this.identified,
            templateVars: { ...this.templateVars },
            stats: this.stats ? JSON.parse(JSON.stringify(this.stats)) : {},
            count: this.count,
            enchantment: this.enchantment,
            customName: this.customName,
            magicDetected: this.magicDetected,
            combatUseCount: this.combatUseCount || 0,
            wornTurns: this.wornTurns || 0,
            isItem: true
        };
    }

    deserialize(data) {
        super.deserialize(data);
        if (data.identified !== undefined) this.identified = data.identified;
        if (data.templateVars) this.templateVars = { ...data.templateVars };
        if (data.stats) this.stats = JSON.parse(JSON.stringify(data.stats));
        if (data.count !== undefined) this.count = data.count;
        if (data.combatUseCount !== undefined) this.combatUseCount = data.combatUseCount;
        if (data.wornTurns !== undefined) this.wornTurns = data.wornTurns;
        if (data.enchantment !== undefined) this.enchantment = data.enchantment;
        if (data.customName) this.customName = data.customName;
        if (data.magicDetected) this.magicDetected = true;
    }
}
