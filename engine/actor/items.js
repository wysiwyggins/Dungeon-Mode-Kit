/**
 * Actor methods: picking up items, equipment slots and wear effects,
 * equipping/unequipping, degrading, and using items (executeItemEffect).
 */

import { getChebyshevDistance } from '../../core/pathfinding.js';
import { ALL_DIRS, shuffleArray } from '../../core/util.js';
import { Actor } from './actor.js';
import { Item } from '../item.js';

export const ActorItems = {
    pickUpItem(item) {
        // An item whose whole purpose is its pickup_effect (a pellet's score, a gold
        // nugget's wealth) is consumed below and never kept, so it needs no room to
        // land in. Carrying capacity gates what you CARRY — gating these too means a
        // player with no `inventory` attribute can't bank a coin, and a full pack
        // silently stops scoring.
        //
        // Player only, deliberately. The `inventory` attribute is how the data says
        // which creatures pick things up at all — most monsters don't have it, and a
        // scoring pickup is the player's business. Without this restriction a ghost
        // would eat the pellets it walks over.
        // Treasure is banked the same way: it goes onto a running total, not into the pack.
        const isTreasure = this.isPlayerControlled() && !!item.getAttribute('treasure');
        const isConsumedOnPickup = this.isPlayerControlled() &&
            (!!item.getAttribute('pickup_effect') || isTreasure);

        // Check if actor has inventory capacity (inventory attribute)
        const maxInventory = this.getAttribute('inventory');
        if (!isConsumedOnPickup && (maxInventory === undefined || maxInventory <= 0)) {
            // Actor cannot carry items
            return false;
        }

        // Pickups are reported for whoever the player can actually watch doing it:
        // "You pick up a dagger" for the player, "A goblin picks up a dagger" for
        // anyone else standing on a visible tile. Off-screen NPC pickups stay silent
        // so the log doesn't narrate things the player has no way of knowing.
        // trailing text is appended after the sentence period, e.g. " (3 total)".
        const announcePickup = (trailing = '', options) => {
            const input = this.engine.inputManager;
            const named = input?.getEntityNameWithArticle(item)
                || (item.getDisplayName ? item.getDisplayName() : item.name);
            if (this.isPlayerControlled()) {
                input?.showMessage(`You pick up ${named}.${trailing}`, options);
            } else if (this.engine.isTileVisible(this.x, this.y)) {
                const actorNamed = input?.getEntityNameWithArticle(this, { capitalize: true })
                    || this.name;
                input?.showMessage(`${actorNamed} picks up ${named}.${trailing}`, options);
            }
        };

        // Merge into an existing, indistinguishable stack (see Item.canStackWith)
        if (item.getAttribute('stackable')) {
            const existing = this.inventory.find(inv => inv.canStackWith(item));
            if (existing) {
                existing.count = (existing.count || 1) + (item.count || 1);
                // Same type, same polarity: what was sensed on either half holds for the stack
                if (item.magicDetected) existing.magicDetected = true;
                this.engine.entityManager.removeEntity(item);
                if (this.isPlayerControlled()) {
                    this.engine.playSound(item.getAttribute('pickup_sound') || 'tone3');
                    // Only the player's own stack count is meaningful to report.
                    announcePickup(` (${existing.count} total)`);
                } else {
                    announcePickup();
                }
                return true;
            }
        }

        if (!isConsumedOnPickup && this.inventory.length >= maxInventory) {
            console.log(`${this.name}'s inventory is full`);
            if (this.isPlayerControlled()) {
                const named = this.engine.inputManager?.getEntityNameWithArticle(item)
                    || (item.getDisplayName ? item.getDisplayName() : item.name);
                this.engine.inputManager?.showMessage(`Your inventory is full. You can't pick up ${named}.`, { style: 'warning' });
            }
            return false;
        }

        this.inventory.push(item);
        item.owner = this; // Track item owner for per-turn stat messages
        this.engine.entityManager.removeEntity(item);
        console.log(`${this.name} picked up ${item.name}`);

        // Apply pickup_effect (e.g., gold adds to wealth)
        const pickupEffect = item.getAttribute('pickup_effect');
        if (pickupEffect && typeof pickupEffect === 'object') {
            for (const [attr, rawValue] of Object.entries(pickupEffect)) {
                // apply_state names a state, not a number to add — without this the
                // numeric path below would compute 0 + "impervious". Mirrors the
                // same key in executeItemEffect so pickup_effect and use_effect
                // stay consistent.
                if (attr === 'apply_state') {
                    this.applyAuthoredState(rawValue);
                    continue;
                }

                // Resolve {value} references to item's value property
                let value = rawValue;
                if (typeof rawValue === 'string' && rawValue === '{value}') {
                    value = item.value || 0;
                }

                // Add to actor's attribute (create if doesn't exist)
                const currentValue = this.getAttribute(attr) || 0;
                this.setAttribute(attr, currentValue + value);
                console.log(`${this.name}'s ${attr}: ${currentValue} + ${value} = ${currentValue + value}`);
            }

            // Item with pickup_effect is consumed (not kept in inventory)
            this.inventory = this.inventory.filter(i => i !== item);
        }

        if (isTreasure) {
            this.addTreasure(item);
            this.inventory = this.inventory.filter(i => i !== item);
        }

        // The pickup sound is the player's own feedback, so it stays player-only;
        // the message goes to anyone the player can see (announcePickup decides).
        if (this.isPlayerControlled()) {
            this.engine.playSound(item.getAttribute('pickup_sound') || 'tone3');
        }

        if ((pickupEffect || isTreasure) && item.value && this.isPlayerControlled()) {
            // Value only reads as meaningful for the player's own take.
            const named = this.engine.inputManager?.getEntityNameWithArticle(item)
                || (item.getDisplayName ? item.getDisplayName() : item.name);
            this.engine.inputManager?.showMessage(
                `You pick up ${named} worth ${item.value}.`, { style: 'discovery' }
            );
        } else {
            announcePickup('', { style: 'discovery' });
        }

        // Auto-equip wearable items. NPCs always auto-equip; the player only
        // auto-equips items flagged auto_wear (e.g. the crown), otherwise the
        // player equips manually.
        if (!this.isPlayerControlled() || item.getAttribute('auto_wear')) {
            const slot = item.getAttribute('wearable');
            if (slot && ['top', 'middle', 'lower'].includes(slot)) {
                const { canEquip, reason } = this.canEquipItem(item);
                if (canEquip) {
                    this.equipToSlot(item, slot);
                } else if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(`You cannot wear the ${item.name}. ${reason}.`);
                }
            } else if (slot === 'ring') {
                const ringSlot = !this.equipment.ring1 ? 'ring1' :
                                 !this.equipment.ring2 ? 'ring2' : null;
                const { canEquip, reason } = this.canEquipItem(item);
                if (ringSlot && canEquip) {
                    this.equipToSlot(item, ringSlot);
                } else if (this.isPlayerControlled() && !canEquip) {
                    this.engine.inputManager?.showMessage(`You cannot wear the ${item.name}. ${reason}.`);
                }
            }
        }

        // Taking the last of something can satisfy a `collected:` win condition, the
        // pickup counterpart of the check a kill already runs.
        if (this.isPlayerControlled()) {
            if (this.engine.checkWinConditions()) {
                this.engine.unlockWinConditionStairways();
            }
            this.engine.refreshConditionLocks();
            this.engine.maybeTriggerGameWin();
        }

        return true;
    },

    /**
     * Equip a wearable item to its designated slot
     * @param {Item} item - The wearable item to equip
     * @param {string} slot - The equipment slot ('top', 'middle', or 'lower')
     */
    equipToSlot(item, slot) {
        // If slot already has an item, unequip it first
        const currentItem = this.equipment[slot];
        if (currentItem) {
            this.unequipFromSlot(slot);
        }

        // Equip the new item
        this.equipment[slot] = item;

        // Apply wear effects to actor
        this.applyWearEffect(item);

        // Create sprite for the equipped item (skip for weapons/rings - they don't render on actor)
        // Only create sprite if renderer exists and actor sprites have been created
        if (slot !== 'weapon' && slot !== 'ring1' && slot !== 'ring2' && this.engine.renderer && this.spriteBase) {
            this.spriteEquipment[slot] = this.engine.renderer.createEquipmentSprite(
                this,
                item,
                slot
            );
        }

        console.log(`${this.name} equipped ${item.name} (${slot})`);

        if (item.hasAttribute('cursed') && this.isPlayerControlled()) {
            item.identified = true;
            this.engine.inputManager?.showMessage(`You feel a malevolent force bind the ${item.getDisplayName?.()} to you!`, { style: 'danger' });
            this.engine.playSound?.('tone9');
            this.engine.renderer?.effectRunner.apply('curse_reveal');
        }

        if (item.hasAttribute('light_source')) {
            this.engine.updateLighting();
        }

        // Check if this triggers win conditions (for player only)
        if (this.isPlayerControlled() && this.engine.checkWinConditions()) {
            this.engine.unlockWinConditionStairways();
        }
        if (this.isPlayerControlled()) {
            this.engine.refreshConditionLocks();
        }

        // Check if equipping this satisfies the prototype's game-win conditions
        if (this.isPlayerControlled()) {
            this.engine.maybeTriggerGameWin();
        }
    },

    /**
     * Unequip an item from a slot
     * @param {string} slot - The equipment slot to unequip
     */
    unequipFromSlot(slot) {
        const item = this.equipment[slot];
        if (!item) return;

        // Remove wear effects from actor
        this.removeWearEffect(item);

        // Destroy sprite
        if (this.spriteEquipment[slot]) {
            this.spriteEquipment[slot].destroy();
            this.spriteEquipment[slot] = null;
        }

        // Clear the slot
        this.equipment[slot] = null;

        if (item.hasAttribute('light_source')) {
            this.engine.updateLighting();
        }

        console.log(`${this.name} unequipped ${item.name}`);

        // Check if this breaks win conditions (for player only)
        if (this.isPlayerControlled() && !this.engine.checkWinConditions()) {
            this.engine.lockWinConditionStairways();
        }
        if (this.isPlayerControlled()) {
            this.engine.refreshConditionLocks();
        }
    },

    /**
     * Apply wear effects from an item to this actor
     * @param {Item} item - The item being equipped
     */
    applyWearEffect(item) {
        const wearEffect = item.getAttribute('wear_effect');
        if (!wearEffect) return;

        // Store resolved numeric values for proper removal on unequip
        if (!item._resolvedWearValues) item._resolvedWearValues = {};

        for (const [attr, rawValue] of Object.entries(wearEffect)) {
            const currentValue = this.getAttribute(attr);

            // Only apply if actor has this attribute
            if (currentValue === undefined) continue;

            // Handle "toggle" value
            if (rawValue === 'toggle') {
                this.setAttribute(attr, !currentValue);
                console.log(`${item.name}: toggled ${this.name}'s ${attr} to ${!currentValue}`);
            }
            // Handle boolean values (set directly)
            else if (typeof rawValue === 'boolean') {
                // Store original value for restoration on unequip
                if (!item._originalWearValues) item._originalWearValues = {};
                item._originalWearValues[attr] = currentValue;
                this.setAttribute(attr, rawValue);
                console.log(`${item.name}: set ${this.name}'s ${attr} to ${rawValue}`);
            }
            // Handle numeric values or attribute references (add)
            else if (typeof currentValue === 'number') {
                // Resolve attribute references like "{strength}"
                const resolvedValue = this.resolveAttributeValue(rawValue, this);
                if (typeof resolvedValue === 'number' && resolvedValue !== 0) {
                    item._resolvedWearValues[attr] = resolvedValue;
                    this.setAttribute(attr, currentValue + resolvedValue);
                    console.log(`${item.name}: ${this.name}'s ${attr} ${resolvedValue >= 0 ? '+' : ''}${resolvedValue} (now ${currentValue + resolvedValue})`);
                }
            }
        }
    },

    /**
     * Remove wear effects from an item from this actor
     * @param {Item} item - The item being unequipped
     */
    removeWearEffect(item) {
        const wearEffect = item.getAttribute('wear_effect');
        if (!wearEffect) return;

        for (const [attr, rawValue] of Object.entries(wearEffect)) {
            const currentValue = this.getAttribute(attr);

            // Only remove if actor has this attribute
            if (currentValue === undefined) continue;

            // Handle "toggle" value (toggle back)
            if (rawValue === 'toggle') {
                this.setAttribute(attr, !currentValue);
                console.log(`${item.name} removed: toggled ${this.name}'s ${attr} to ${!currentValue}`);
            }
            // Handle boolean values (restore original)
            else if (typeof rawValue === 'boolean') {
                const originalValue = item._originalWearValues?.[attr];
                if (originalValue !== undefined) {
                    this.setAttribute(attr, originalValue);
                    console.log(`${item.name} removed: restored ${this.name}'s ${attr} to ${originalValue}`);
                }
            }
            // Handle numeric values or attribute references (subtract resolved value)
            else if (typeof currentValue === 'number') {
                // Use the resolved value that was stored when equipped
                const resolvedValue = item._resolvedWearValues?.[attr];
                if (typeof resolvedValue === 'number') {
                    this.setAttribute(attr, currentValue - resolvedValue);
                    console.log(`${item.name} removed: ${this.name}'s ${attr} ${resolvedValue >= 0 ? '-' : '+'}${Math.abs(resolvedValue)} (now ${currentValue - resolvedValue})`);
                }
            }
        }

        // Clean up stored values
        delete item._resolvedWearValues;
        delete item._originalWearValues;
    },

    /**
     * Get the item equipped in a specific slot
     * @param {string} slot - The equipment slot ('head', 'body', or 'feet')
     * @returns {Item|null}
     */
    getEquippedItem(slot) {
        return this.equipment[slot] || null;
    },

    /**
     * Check if actor has any equipped items
     * @returns {boolean}
     */
    hasEquippedItems() {
        return this.equipment.top || this.equipment.middle || this.equipment.lower ||
               this.equipment.ring1 || this.equipment.ring2;
    },

    /**
     * Check if actor meets the stat requirements to equip an item
     * @param {Item} item - The item to check
     * @returns {{canEquip: boolean, reason: string|null}} Result with reason if cannot equip
     */
    canEquipItem(item) {
        const requiresStat = item.getAttribute('requires_stat');
        if (!requiresStat || typeof requiresStat !== 'object') {
            return { canEquip: true, reason: null };
        }

        // Check each required stat
        for (const [stat, requiredValue] of Object.entries(requiresStat)) {
            const actorValue = this.getAttribute(stat) || 0;
            if (actorValue < requiredValue) {
                return {
                    canEquip: false,
                    reason: `Requires ${stat} ${requiredValue} (you have ${actorValue})`
                };
            }
        }

        return { canEquip: true, reason: null };
    },

    /**
     * Check if a specific item is currently equipped
     * @param {Item} item - The item to check
     * @returns {boolean} True if the item is equipped in any slot
     */
    isItemEquipped(item) {
        return this.equipment.weapon === item ||
               this.equipment.top === item ||
               this.equipment.middle === item ||
               this.equipment.lower === item ||
               this.equipment.ring1 === item ||
               this.equipment.ring2 === item;
    },

    /**
     * Equip a wearable item or weapon (convenience method)
     * For armor with strength requirements, starts multi-turn equipping process
     * @param {Item} item - The item to equip
     * @returns {boolean} True if successfully equipped or started equipping
     */
    equipItem(item) {
        if (!this.inventory.includes(item)) {
            console.log(`${this.name} doesn't have ${item.name}`);
            return false;
        }

        // Cancel any current equipping if starting a new one
        if (this._equippingItem && this._equippingItem !== item) {
            this._equippingItem = null;
            this._equippingTurnsLeft = 0;
            this._equippingTurnsTotal = 0;
        }

        // Check stat requirements
        const { canEquip, reason } = this.canEquipItem(item);
        if (!canEquip) {
            console.log(`${this.name} cannot equip ${item.name}: ${reason}`);
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You cannot equip the ${item.name}. ${reason}.`);
            }
            return false;
        }

        // Check if it's a weapon (instant equip)
        if (item.hasAttribute('weapon')) {
            this.equipToSlot(item, 'weapon');
            return true;
        }

        // Check if it's wearable
        const slot = item.getAttribute('wearable');
        if (!slot || !['top', 'middle', 'lower', 'ring'].includes(slot)) {
            console.log(`${item.name} is not equippable`);
            return false;
        }

        // Rings use two dedicated slots
        if (slot === 'ring') {
            const ringSlot = !this.equipment.ring1 ? 'ring1' :
                             !this.equipment.ring2 ? 'ring2' : 'ring1';
            this.equipToSlot(item, ringSlot);
            return true;
        }

        // Check for strength requirement - determines equip time
        const requiresStat = item.getAttribute('requires_stat');
        const strengthReq = requiresStat?.strength || 0;

        if (strengthReq > 0) {
            // Start multi-turn equipping process
            this._equippingItem = item;
            this._equippingTurnsLeft = strengthReq;
            this._equippingTurnsTotal = strengthReq;

            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You begin equipping ${item.name}...`);
            }
            return true;
        }

        // No strength requirement - instant equip
        this.equipToSlot(item, slot);
        return true;
    },

    /**
     * Progress the equipping process by one turn
     * Called when player takes an action while equipping
     * @returns {boolean} True if still equipping, false if done or not equipping
     */
    progressEquipping() {
        if (!this._equippingItem || this._equippingTurnsLeft <= 0) {
            return false;
        }

        this._equippingTurnsLeft--;

        if (this._equippingTurnsLeft <= 0) {
            // Finished equipping
            const item = this._equippingItem;
            const slot = item.getAttribute('wearable');

            this._equippingItem = null;
            this._equippingTurnsTotal = 0;

            this.equipToSlot(item, slot);

            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You finish equipping ${item.name}.`);
            }
            return false;
        }

        // Still equipping
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`Equipping ${this._equippingItem.name}... (${this._equippingTurnsLeft} turns left)`);
        }
        return true;
    },

    /**
     * Cancel any in-progress equipping
     */
    cancelEquipping() {
        if (this._equippingItem) {
            const itemName = this._equippingItem.name;
            this._equippingItem = null;
            this._equippingTurnsLeft = 0;
            this._equippingTurnsTotal = 0;

            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`You stop equipping ${itemName}.`);
            }
        }
    },

    /**
     * Check if actor is currently equipping something
     * @returns {boolean} True if in the process of equipping
     */
    isEquipping() {
        return this._equippingItem !== null && this._equippingTurnsLeft > 0;
    },

    /**
     * Unequip a worn item or weapon (convenience method)
     * @param {Item} item - The item to unequip
     * @returns {boolean} True if successfully unequipped
     */
    unequipItem(item) {
        if (item.hasAttribute('cursed')) {
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(`The ${item.getDisplayName?.()} is cursed! You can't remove it.`, { style: 'danger' });
            }
            return false;
        }

        // Check if it's an equipped weapon
        if (item.hasAttribute('weapon')) {
            if (this.equipment.weapon !== item) {
                console.log(`${item.name} is not equipped`);
                return false;
            }
            this.unequipFromSlot('weapon');
            return true;
        }

        // Handle wearable items
        const slot = item.getAttribute('wearable');
        if (!slot) return false;

        if (slot === 'ring') {
            if (this.equipment.ring1 === item) { this.unequipFromSlot('ring1'); return true; }
            if (this.equipment.ring2 === item) { this.unequipFromSlot('ring2'); return true; }
            return false;
        }

        if (this.equipment[slot] !== item) {
            console.log(`${item.name} is not equipped`);
            return false;
        }

        this.unequipFromSlot(slot);
        return true;
    },

    /**
     * Wear down an item's `condition` stat by one use, destroying it when it hits zero.
     *
     * The durability model mirrors torch fuel: `condition` is an ordinary item stat, so
     * it gets the same `display_label` progress bar and `warnings` thresholds for free.
     * How much a use costs is authored per item (`degrade_per_use`), and what's left
     * behind is too (`breaks_into_item`, mirroring `burns_out_item`) — the engine only
     * knows "spend some condition, and if it runs out the item is gone".
     *
     * Items with no `condition` stat never wear out, so this is opt-in per item.
     *
     * @param {Item} item - The item being used
     * @returns {boolean} True if the item broke
     */
    degradeItem(item) {
        const condition = item?.stats?.condition;
        if (!condition) return false;

        const perUse = item.getAttribute('degrade_per_use') ?? 1;
        if (perUse <= 0) return false;

        const before = condition.current;
        condition.current = Math.max(0, condition.current - perUse);
        item.checkStatWarnings?.(condition, before);

        if (condition.current > 0) {
            if (this.isPlayerControlled()) this.engine.interfaceManager?.updatePlayerInfo();
            return false;
        }

        const isPlayer = this.isPlayerControlled();
        if (isPlayer) {
            const msg = item.getAttribute('break_message')
                || `Your ${item.getDisplayName?.() ?? item.name} breaks!`;
            this.engine.inputManager?.showMessage(msg, { style: 'warning' });
            this.engine.playSound?.(item.getAttribute('break_sound') || 'glass');
        }

        // Clear the equipment slot first — a broken item must not keep granting its
        // wear_effect, and unequipFromSlot also tears down the held sprite.
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            if (this.equipment?.[slot] === item) {
                this.unequipFromSlot(slot);
                break;
            }
        }

        // Leave a remnant if the item declares one (a snapped haft, etc.), else it's gone.
        // Built fresh rather than carrying condition across — the broken item's condition
        // is 0 by definition, and a remnant should start at whatever its own JSON says.
        const breaksInto = item.getAttribute('breaks_into_item');
        const itemData = breaksInto
            ? this.engine.currentPrototype?.getItemData(breaksInto)
            : null;
        let replacement = null;
        if (itemData) {
            replacement = new Item(-1, -1, breaksInto, itemData, this.engine);
            replacement.owner = this;
        }
        const idx = this.inventory.indexOf(item);
        if (idx !== -1) {
            if (replacement) this.inventory[idx] = replacement;
            else this.inventory.splice(idx, 1);
        }

        if (isPlayer) this.engine.interfaceManager?.updatePlayerInfo();
        return true;
    },

    /**
     * Build the toggled counterpart of an item (lit torch <-> unlit torch), carrying
     * over the live value of a consumable stat so fuel survives the swap.
     *
     * The replacement's stat config (max, per_turn, display_label, warnings) comes
     * entirely from the target type's JSON — the engine only copies `current` across.
     * That way "how fast does this burn" and "when does it warn" are authored in the
     * data files per item, not hard-coded here. An unlit torch declares per_turn 0,
     * a lit one declares -1, so lighting and extinguishing need no engine knowledge
     * of which direction is which.
     *
     * @param {Item} item - The item being toggled
     * @param {string} targetType - Item type to become
     * @param {string} [carryStat='burns'] - Stat whose `current` carries over
     * @returns {Item|null} The replacement item, or null if targetType is unknown
     */
    buildToggledItem(item, targetType, carryStat = 'burns') {
        const itemData = this.engine.currentPrototype?.getItemData(targetType);
        if (!itemData) return null;

        const newItem = new Item(-1, -1, targetType, itemData, this.engine);
        newItem.owner = this;

        // Carry the consumable's remaining amount into the new item's own stat block.
        const carried = item.stats?.[carryStat]?.current;
        if (carried !== undefined && newItem.stats?.[carryStat]) {
            const target = newItem.stats[carryStat];
            target.current = target.max !== undefined ? Math.min(target.max, carried) : carried;
        }

        return newItem;
    },

    /**
     * Why this actor can't use `item` right now, or null if it can. A state with
     * `cannot_read` (blinded) blocks anything whose use_verb is "Read".
     * @param {Item} item
     * @returns {string|null} Message explaining the refusal
     */
    getItemUseBlocker(item) {
        if (item?.getAttribute('use_verb') === 'Read' && this.hasStateProperty('cannot_read')) {
            return this.isPlayerControlled()
                ? "You can't see to read!"
                : `${this.getNameWithArticle(true)} can't see to read.`;
        }
        return null;
    },

    /**
     * Use an item from inventory
     * @param {Item} item - The item to use
     * @returns {boolean} True if item was used successfully
     */
    useItem(item) {
        // Check if item is in inventory
        if (!this.inventory.includes(item)) {
            console.log(`${this.name} doesn't have ${item.name}`);
            return false;
        }

        // Check if item has a use_verb (is usable)
        const useVerb = item.getAttribute('use_verb');
        if (!useVerb) {
            console.log(`${item.name} cannot be used`);
            return false;
        }

        const blocker = this.getItemUseBlocker(item);
        if (blocker) {
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage(blocker, { style: 'warning' });
            }
            return false;
        }

        const useEffect = item.getAttribute('use_effect');

        // Drink-at-self: some potions have no drinkable effect of their own and
        // only do something when thrown/shattered (e.g. incineration). `use_at_self`
        // lets the player drink one anyway — it triggers that same break/explosion
        // effect on the drinker's own tile. Mirrors the explosive branch of
        // InterfaceManager.completeThrow(), applied at (this.x, this.y).
        if (item.getAttribute('use_at_self')) {
            const im = this.engine.interfaceManager;
            const breakSound = item.getAttribute('break_sound');
            if (breakSound) this.engine.playSound(breakSound);
            const explodeSound = item.getAttribute('explode_sound');
            if (explodeSound) this.engine.playSound(explodeSound);
            if (im && (item.hasAttribute('explosive') || item.hasAttribute('breakable'))) {
                im.createExplosiveCloud(item, this.x, this.y);
            }
            // use_description ("The potion explodes!") is shown by _completeItemUse.
            // The turn is consumed by the caller (InterfaceManager.executeUseItem),
            // same as any other used item — don't double-count it here.
            this._completeItemUse(item, true);
            return true;
        }

        // Use ceremony — data-driven dramatic effect before item activation
        const ceremonySetting = item.getAttribute('use_ceremony');
        if (this.isPlayerControlled() && ceremonySetting) {
            const ceremony = typeof ceremonySetting === 'object' ? ceremonySetting : {};
            this._scrollCeremonyActive = true;
            this.engine.turnEngine?.lock();

            const buildSound = ceremony.build_sound || 'levelout';
            const buildEffect = ceremony.build_effect || 'scroll_ceremony';
            const releaseSound = ceremony.release_sound || 'magic';
            const releaseEffect = ceremony.release_effect || 'scroll_ceremony_flash';
            const duration = ceremony.duration || 1000;

            const soundId = this.engine.playSound(buildSound);
            const darkenId = this.engine.renderer?.effectRunner.apply(buildEffect, this);

            setTimeout(() => {
                this.engine.stopSound(soundId);
                if (darkenId) this.engine.renderer?.effectRunner.remove(darkenId);

                this.engine.playSound(releaseSound);
                this.engine.renderer?.effectRunner.apply(releaseEffect, this);

                const success = useEffect ? this.executeItemEffect(item, useEffect) : true;

                if (!item.hasAttribute('deferred')) {
                    this._completeItemUse(item, success);
                    this.engine.inputManager?.onPlayerAction();
                }

                this._scrollCeremonyActive = false;
            }, duration);

            return true;
        }

        // Play use sound if this is the player
        if (this.isPlayerControlled()) {
            const useSound = item.getAttribute('use_sound') || 'tone1';
            this.engine.playSound(useSound);
        }

        // Get the use effect to determine what happens
        let success;

        if (useEffect) {
            success = this.executeItemEffect(item, useEffect);
        } else {
            // Item has a verb but no effect - just mark as used
            console.log(`${this.name} used ${item.name}`);
            success = true;
        }

        // For deferred items, consumption happens in the follow-up UI interaction, not immediately here.
        if (item.hasAttribute('deferred')) {
            return success; // Early return - handling continues in interface
        }

        this._completeItemUse(item, success);
        return success;
    },

    _completeItemUse(item, success) {
        if (success && item.hasAttribute('consumable')) {
            if (item.count > 1) {
                item.count--;
            } else {
                this.inventory = this.inventory.filter(i => i !== item);
            }
            console.log(`${item.name} was consumed`);
        }

        if (success && this.isPlayerControlled() && this.engine.inputManager) {
            const useDescription = item.getUseDescription();
            if (useDescription) {
                this.engine.inputManager.showMessage(useDescription);
            }
        }

        if (success && !item.identified) {
            item.identify();
            const identifiedName = item.getDisplayName();
            console.log(`${this.name} identified the ${identifiedName}!`);

            if (this.isPlayerControlled() && this.engine.inputManager) {
                this.engine.inputManager.showMessage(`You identified the ${identifiedName}!`);
            }
        }
    },


    /**
     * Execute an item's use effect
     * @param {Item} item - The item being used
     * @param {string|object} effect - The effect identifier (string) or stat modifiers (object)
     * @returns {boolean} True if effect executed successfully
     */
    executeItemEffect(item, effect) {
        console.log('executeItemEffect called with effect:', effect, 'typeof:', typeof effect);
        // Handle object format: { "health": 20, "strength": 2, "defense": 5, "apply_state": "poisoned" }
        // Supports stats (health, nutrition), attributes (strength, defense), and state application
        if (typeof effect === 'object') {
            console.log('Effect is an object, processing as stat modifiers');
            let anyModified = false;
            let shouldDie = false;
            // `<stat>_max` keys go first, so { "health_max": 10, "health": "max" }
            // heals to the raised maximum whatever order the keys are written in.
            const entries = Object.entries(effect).sort(
                ([a], [b]) => Number(b.endsWith('_max')) - Number(a.endsWith('_max')));
            for (let [key, amount] of entries) {
                // Raise (or lower) a stat's maximum, moving the current value with it:
                // { "health_max": 10 } (Brogue's potion of life)
                if (key.endsWith('_max')) {
                    const stat = this.stats?.[key.slice(0, -4)];
                    if (stat && typeof stat === 'object' && stat.max !== undefined && typeof amount === 'number') {
                        stat.max = Math.max(1, stat.max + amount);
                        stat.current = Math.max(0, Math.min(stat.max, stat.current + amount));
                        anyModified = true;
                        if (this.isPlayerControlled()) this.engine.interfaceManager?.updatePlayerInfo();
                        continue;
                    }
                }

                // "max" fills a stat to its maximum: { "health": "max" }
                if (amount === 'max') {
                    const stat = this.stats?.[key];
                    if (!stat || typeof stat !== 'object' || stat.max === undefined) continue;
                    amount = stat.max - stat.current;
                }

                // Clear every state on the user: { "remove_all_states": true }
                if (key === 'remove_all_states') {
                    if (amount) {
                        for (const name of Object.keys(this.states)) {
                            this.removeState(name);
                            anyModified = true;
                        }
                    }
                    continue;
                }

                // Handle state application (to self)
                if (key === 'apply_state') {
                    if (this.applyAuthoredState(amount)) {
                        anyModified = true;
                        console.log(`Applied state ${Actor.parseApplyState(amount).name} to ${this.name}`);
                    }
                    continue;
                }

                // Apply state to actors in radius: { "apply_state_radius": { "state": "confused", "radius": 5, "filter": "hostile" } }
                // An optional `duration` overrides the state's default for this source.
                if (key === 'apply_state_radius') {
                    const { state: stateName, radius = 5, filter, message, empty_message, duration } = amount;
                    const statesData = this.engine.globalStates;
                    if (!statesData?.[stateName]) continue;
                    const stateOpts = typeof duration === 'number' ? { duration } : {};
                    let affected = 0;
                    for (const actor of this.engine.entityManager?.actors || []) {
                        if (actor.isDead || actor === this) continue;
                        if (filter === 'hostile' && !actor.hasAttribute('hostile')) continue;
                        if (filter === 'friendly' && actor.hasAttribute('hostile')) continue;
                        const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                        if (dist <= radius) {
                            // Creature-only: this sweeps every actor in range and
                            // reports a count of "creatures affected", so scenery
                            // must not be swept up in it.
                            if (actor.applyCreatureState(stateName, statesData[stateName], stateOpts)) {
                                affected++;
                            }
                        }
                    }
                    if (this.isPlayerControlled() && this.engine.inputManager) {
                        this.engine.inputManager.showMessage(affected > 0
                            ? (message || `${affected} creatures are affected!`)
                            : (empty_message || 'Nothing happens.'));
                    }
                    anyModified = affected > 0;
                    continue;
                }

                // Remove all states from actors in radius: { "remove_states_radius": { "radius": 5, "filter": "hostile", ... } }
                if (key === 'remove_states_radius') {
                    const { radius = 5, filter, message, empty_message } = amount;
                    let affected = 0;
                    for (const actor of this.engine.entityManager?.actors || []) {
                        if (actor.isDead || actor === this) continue;
                        if (filter === 'hostile' && !actor.hasAttribute('hostile')) continue;
                        if (filter === 'friendly' && actor.hasAttribute('hostile')) continue;
                        const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                        if (dist <= radius) {
                            const stateNames = Object.keys(actor.states);
                            for (const sn of stateNames) {
                                actor.removeState(sn, true);
                                affected++;
                            }
                        }
                    }
                    if (this.isPlayerControlled() && this.engine.inputManager) {
                        this.engine.inputManager.showMessage(affected > 0
                            ? (message || 'Magical effects are stripped away!')
                            : (empty_message || 'Nothing happens.'));
                    }
                    anyModified = affected > 0;
                    continue;
                }

                // Try stat modification first (for health, nutrition, etc.)
                const statResult = this.modifyStat(key, amount, { source: item });
                if (statResult !== null) {
                    anyModified = true;
                    // Check if health dropped to 0 (for poison effects)
                    if (key === 'health' && statResult <= 0) {
                        shouldDie = true;
                    }
                    continue;
                }

                // Fall back to attribute modification (for strength, defense, accuracy, armor)
                const currentAttr = this.getAttribute(key);
                if (currentAttr !== undefined && typeof currentAttr === 'number') {
                    const newValue = currentAttr + amount;
                    this.setAttribute(key, newValue);
                    console.log(`${this.name}'s ${key}: ${currentAttr} -> ${newValue} (${amount >= 0 ? '+' : ''}${amount})`);
                    anyModified = true;

                    // Update UI if player
                    if (this.isPlayerControlled()) {
                        this.engine.interfaceManager?.updatePlayerInfo();
                    }
                } else {
                    console.log(`${this.name} has no ${key} stat or attribute to modify`);
                }
            }
            // Trigger death after all effects are applied
            if (shouldDie) {
                this.die();
            }
            return anyModified;
        }

        // Handle string format: method name for complex effects
        switch (effect) {
            case 'identify_item':
                // Handled by interface — opens item picker
                this.engine.interfaceManager?.enterIdentifyMode(item, this);
                return true;

            case 'enchant_item':
                this.engine.interfaceManager?.enterEnchantMode(item, this);
                return true;

            case 'protect_item':
                this.engine.interfaceManager?.enterEnchantMode(item, this, 'protect');
                return true;

            case 'remove_curse': {
                let uncursed = 0;
                for (const slot of Object.keys(this.equipment)) {
                    const equipped = this.equipment[slot];
                    if (equipped?.hasAttribute('cursed')) {
                        equipped.setAttribute('cursed', false);
                        uncursed++;
                    }
                }
                if (this.isPlayerControlled()) {
                    if (uncursed > 0) {
                        this.engine.inputManager?.showMessage('A cleansing light lifts the curse from your equipment!', { style: 'discovery' });
                    } else {
                        this.engine.inputManager?.showMessage('You feel a momentary warmth, but nothing happens.');
                    }
                }
                return true;
            }

            case 'teleport': {
                const walkable = this.engine.mapManager?.walkableTiles;
                if (!walkable || walkable.length === 0) return false;
                // Pick a random walkable tile that isn't occupied by a solid actor
                const candidates = walkable.filter(t => !this.engine.entityManager?.getSolidActorAt(t.x, t.y));
                if (candidates.length === 0) return false;
                const dest = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
                this.x = dest.x;
                this.y = dest.y;
                this.updateSpritePosition();
                this.engine.updateLighting();
                if (this.isPlayerControlled()) {
                    this.engine.renderer?.centerViewportOnPlayer?.();
                    this.engine.inputManager?.showMessage('You are whisked away in a flash of light.');
                }
                return true;
            }

            case 'detect_magic': {
                // Brogue's potion of detect magic: sense the polarity of every item on
                // this level (lying on the floor or carried by a creature) and in the
                // pack. Detected items show a red/blue eye in the pack and on the map.
                const em = this.engine.entityManager;
                let onLevel = false;
                let inPack = false;
                for (const floorItem of em?.items || []) {
                    if (floorItem.detectMagic()) onLevel = true;
                }
                for (const actor of em?.actors || []) {
                    if (actor === this || actor.isDead) continue;
                    for (const carried of actor.inventory || []) {
                        if (carried.detectMagic()) onLevel = true;
                    }
                }
                for (const packItem of this.inventory) {
                    const polarity = packItem.detectMagic();
                    // The last potion of the stack is being drunk; it isn't "in the pack"
                    if (polarity && !(packItem === item && (item.count || 1) <= 1)) inPack = true;
                }

                if (this.isPlayerControlled()) {
                    let message;
                    if (onLevel && inPack) message = 'You can somehow feel the presence of magic on the level and in your pack.';
                    else if (onLevel) message = 'You can somehow feel the presence of magic on the level.';
                    else if (inPack) message = 'You can somehow feel the presence of magic in your pack.';
                    else message = 'You can somehow feel the absence of magic on the level and in your pack.';
                    this.engine.inputManager?.showMessage(message, { style: 'discovery' });
                    this.engine.interfaceManager?.updatePlayerInfo();
                    this.engine.renderer?.updateMagicDetectionMarkers?.();
                }
                return true;
            }

            case 'reveal_map': {
                // Mark the floor mapped: this is a lasting reveal of this level, not a
                // timed sense, so it persists across leaving and returning (see
                // saveFloorState/restoreFloor) and drives the machine-link overlay.
                // Done unconditionally — a fully-lit level has no fog to clear, but its
                // hidden machinery is still worth revealing, so the scroll must do
                // something there rather than reporting no effect.
                this.engine.mappedFloors.add(this.engine.currentFloor);

                const lm = this.engine.lightingManager;
                const clearedFog = !!(lm && lm.exploredMap);
                if (clearedFog) {
                    for (let y = 0; y < lm.exploredMap.length; y++) {
                        for (let x = 0; x < lm.exploredMap[y].length; x++) {
                            lm.exploredMap[y][x] = true;
                        }
                    }
                    lm.computeLighting();
                    const fogOfWar = this.engine.currentPrototype?.config?.mechanics?.fog_of_war || false;
                    this.engine.renderer?.updateDarkness(lm, fogOfWar);
                }
                this.engine.renderer?.updateInfrastructureVisibility?.();
                let secretsFound = 0;
                for (const actor of [...(this.engine.entityManager?.actors || [])]) {
                    if (actor.isDead || !actor.hasAttribute('hidden')) continue;
                    if (actor.reveal({ silent: true })) secretsFound++;
                }

                if (this.isPlayerControlled()) {
                    // Only claim to reveal the layout when there was fog hiding it.
                    const hasMachines = this.engine.renderer?.hasInfrastructureLinks?.() ?? true;
                    let message;
                    if (clearedFog) {
                        message = hasMachines
                            ? 'The layout of this place becomes clear in your mind, and hidden connections glimmer into view.'
                            : 'The layout of this place becomes clear in your mind.';
                    } else {
                        message = hasMachines
                            ? 'Hidden connections glimmer into view.'
                            : 'You already know this place well.';
                    }
                    this.engine.inputManager?.showMessage(message);

                    // Separate line, because it's a different kind of news — and the
                    // one that changes how the player walks the level.
                    if (secretsFound > 0) {
                        this.engine.inputManager?.showMessage(
                            secretsFound === 1
                                ? 'Something concealed here reveals itself.'
                                : `${secretsFound} concealed things reveal themselves.`
                        );
                    }
                }
                return true;
            }

            case 'aggravate_monsters': {
                const player = this.engine.entityManager?.player;
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead || actor === this) continue;
                    if (actor.hasAttribute('hostile')) {
                        actor._alertTarget = player;
                        actor._alerted = true;
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('Every creature stirs with sudden rage.');
                }
                return true;
            }

            case 'discord': {
                const radius = item?.getAttribute('effect_radius') ?? 5;
                const statesData = this.engine.globalStates;
                let affected = 0;
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead || actor === this) continue;
                    if (!actor.hasAttribute('hostile')) continue;
                    const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                    if (dist <= radius && statesData?.confused) {
                        actor.applyState('confused', statesData.confused);
                        affected++;
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(affected > 0
                        ? 'A wave of discord washes over nearby creatures!'
                        : 'The scroll crumbles, but nothing happens.');
                }
                return true;
            }

            case 'negate_nearby': {
                const radius = item?.getAttribute('effect_radius') ?? 5;
                let affected = 0;
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead || actor === this) continue;
                    const dist = getChebyshevDistance(this.x, this.y, actor.x, actor.y);
                    if (dist <= radius) {
                        const stateNames = Object.keys(actor.states);
                        for (const stateName of stateNames) {
                            actor.removeState(stateName, true);
                            affected++;
                        }
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(affected > 0
                        ? 'A nullifying wave strips away all magical effects!'
                        : 'The scroll crumbles, but nothing happens.');
                }
                return true;
            }

            case 'toggle_torch': {
                const isLit = item.hasAttribute('light_source');
                const targetType = item.getAttribute('toggle_to') || (isLit ? 'torch_unlit' : 'torch');
                const targetData = this.engine.currentPrototype?.getItemData(targetType);
                if (!targetData) return false;
                // Name messages after the lit form ("torch", "incense"), not "unlit torch".
                const litName = isLit ? item.name : targetData.name;

                // An item with no fuel stat at all is treated as always-fuelled, so a
                // designer can make a permanent lamp by simply omitting the stat.
                const hasBurnsStat = item.stats?.burns !== undefined;
                const remainingFuel = hasBurnsStat ? (item.stats.burns.current ?? 0) : Infinity;

                if (!isLit && remainingFuel <= 0) {
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage(`The ${litName} has no fuel left.`, { style: 'warning' });
                    }
                    return false;
                }

                // Lighting from a stack requires a free inventory slot
                if (!isLit && item.count > 1) {
                    const maxInventory = this.getAttribute('inventory');
                    if (maxInventory && this.inventory.length >= maxInventory) {
                        if (this.isPlayerControlled()) {
                            this.engine.inputManager?.showMessage('Your inventory is too full to light one from the stack.');
                        }
                        return false;
                    }
                }

                const newItem = this.buildToggledItem(item, targetType);
                if (!newItem) return false;

                if (!isLit && item.count > 1) {
                    item.count--;
                    this.inventory.push(newItem);
                } else {
                    const idx = this.inventory.indexOf(item);
                    if (idx !== -1) this.inventory[idx] = newItem;
                }

                this.engine.updateLighting();
                if (this.isPlayerControlled()) {
                    const msg = isLit ? `You extinguish the ${litName}.` : `You light the ${litName}.`;
                    this.engine.inputManager?.showMessage(msg);
                    this.engine.interfaceManager?.updatePlayerInfo();
                    this.engine.playSound(isLit ? 'extinguish' : 'torch');
                }
                return true;
            }

            case 'sanctuary': {
                // Lay a glyph actor on every floor tile within effect_radius steps,
                // flooding outward so the glyphs don't leak through walls.
                const radius = item?.getAttribute('effect_radius') ?? 2;
                const glyphType = item?.getAttribute('glyph_actor') ?? 'sacred_glyph';
                const em = this.engine.entityManager;
                const seen = new Set([this.x * 10000 + this.y]);
                let frontier = [{ x: this.x, y: this.y }];
                let placed = 0;
                for (let step = 0; step <= radius && frontier.length; step++) {
                    const next = [];
                    for (const p of frontier) {
                        if (!this.hasFloorAt(p.x, p.y)) continue;
                        const solid = em.getSolidActorAt(p.x, p.y);
                        if (solid && !solid.hasAttribute('sentient')) continue;
                        if (!em.getActorsAt(p.x, p.y).some(a => a.type === glyphType && !a.isDead)) {
                            if (em.spawnActor(glyphType, p.x, p.y)) placed++;
                        }
                        for (const d of ALL_DIRS) {
                            const key = (p.x + d.dx) * 10000 + (p.y + d.dy);
                            if (seen.has(key)) continue;
                            seen.add(key);
                            next.push({ x: p.x + d.dx, y: p.y + d.dy });
                        }
                    }
                    frontier = next;
                }
                if (placed > 0) this.flash();
                if (this.isPlayerControlled()) {
                    const success = 'Sacred glyphs spread across the floor around you.';
                    const failure = 'The words fade, but nothing happens.';
                    this.engine.inputManager?.showMessage(placed > 0
                        ? (item?.getEffectMessage('effect_message', success) ?? success)
                        : (item?.getEffectMessage('fail_message', failure) ?? failure));
                }
                return placed > 0;
            }

            case 'summon_monsters': {
                const floorConfig = this.engine.getFloorConfig(this.engine.currentFloor);
                const randomActors = floorConfig?.random_actors || this.engine.currentPrototype?.config?.random_actors;
                if (!randomActors || Object.keys(randomActors).length === 0) {
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('Nothing answers the call.');
                    }
                    return true;
                }
                const actorTypes = Object.keys(randomActors);
                const summonMin = item?.getAttribute('summon_min') ?? 2;
                const summonMax = item?.getAttribute('summon_max') ?? 4;
                const count = summonMin + Math.floor(ROT.RNG.getUniform() * (summonMax - summonMin + 1));
                let spawned = 0;
                for (const dir of shuffleArray([...ALL_DIRS])) {
                    if (spawned >= count) break;
                    const tx = this.x + dir.dx, ty = this.y + dir.dy;
                    if (!this.engine.mapManager?.floorMap[ty]?.[tx]?.tileId) continue;
                    if (this.engine.entityManager?.getSolidActorAt(tx, ty)) continue;
                    const actorType = actorTypes[Math.floor(ROT.RNG.getUniform() * actorTypes.length)];
                    const actor = this.engine.entityManager.spawnActor(actorType, tx, ty);
                    if (!actor) continue;
                    actor.flash();
                    spawned++;
                }
                if (spawned > 0) {
                    this.flash();
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('Something answers the call.');
                    }
                } else if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('Nothing answers the call.');
                }
                return true;
            }

            case 'recharge_items': {
                let recharged = false;
                for (const invItem of this.inventory || []) {
                    const chargeStat = invItem.getAttribute('charge_stat');
                    if (!chargeStat || !invItem.stats?.[chargeStat]) continue;
                    const stat = invItem.stats[chargeStat];
                    if (stat.per_turn === 0) continue;
                    if (stat.current < stat.max) {
                        stat.current = stat.max;
                        recharged = true;
                    }
                }
                if (this.isPlayerControlled()) {
                    this.engine.interfaceManager?.updatePlayerInfo();
                    this.engine.inputManager?.showMessage(recharged
                        ? 'A surge of energy recharges the items in your pack.'
                        : 'There is a surge of energy but nothing else happens.');
                }
                return true;
            }

            case 'remove_all_states': {
                const stateNames = Object.keys(this.states);
                if (stateNames.length === 0) {
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage('You feel a brief surge of warmth but nothing else happens.');
                    }
                    return true;
                }
                for (const name of stateNames) {
                    this.removeState(name);
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('A warm light floods through you, purging all conditions.');
                }
                return true;
            }

            case 'shatter_walls': {
                const radius = item?.getAttribute('effect_radius') ?? 3;
                let shattered = false;
                const toRemove = [];
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead) continue;
                    if (!actor.hasAttribute('solid') || !actor.hasAttribute('breakable')) continue;
                    const dist = Math.abs(actor.x - this.x) + Math.abs(actor.y - this.y);
                    if (dist <= radius) toRemove.push(actor);
                }
                for (const actor of toRemove) {
                    actor.die?.();
                    shattered = true;
                }
                if (shattered) {
                    const clearedPositions = [];
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            if (Math.abs(dx) + Math.abs(dy) <= radius) {
                                clearedPositions.push({ x: this.x + dx, y: this.y + dy });
                            }
                        }
                    }
                    this.engine.entityManager.revealDugArea(clearedPositions);
                    this.engine.renderer?.effectRunner.apply('shatter', this);
                }
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage(shattered
                        ? 'The walls crack and crumble.'
                        : 'Nothing breaks.');
                }
                return shattered;
            }

            case 'spike_door': {
                this.engine.interfaceManager?.enterSpikeDirectionMode(item, this);
                return true;
            }

            case 'dig': {
                this.engine.interfaceManager?.enterDigDirectionMode(item, this);
                return true;
            }

            case 'darkness_field': {
                const radius = item?.getAttribute('effect_radius') ?? 5;
                let extinguished = false;
                // Extinguish light source items carried by actors in radius
                for (const actor of this.engine.entityManager?.actors || []) {
                    if (actor.isDead) continue;
                    const dist = Math.abs(actor.x - this.x) + Math.abs(actor.y - this.y);
                    if (dist > radius) continue;
                    for (const invItem of actor.inventory || []) {
                        if (!invItem.hasAttribute('light_source')) continue;
                        const burns = invItem.stats?.burns;
                        if (burns && burns.current > 0) {
                            burns.current = 0;
                            extinguished = true;
                            if (actor.isPlayerControlled()) {
                                this.engine.inputManager?.showMessage(`Your ${invItem.name} goes dark.`);
                            }
                        }
                    }
                }
                // Extinguish ground light source items in radius
                for (const groundItem of this.engine.entityManager?.items || []) {
                    if (!groundItem.hasAttribute('light_source')) continue;
                    const dist = Math.abs(groundItem.x - this.x) + Math.abs(groundItem.y - this.y);
                    if (dist > radius) continue;
                    const burns = groundItem.stats?.burns;
                    if (burns && burns.current > 0) {
                        burns.current = 0;
                        extinguished = true;
                    }
                }
                if (extinguished) this.engine.updateLighting();
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('All light fades around you.');
                }
                return true;
            }

            case 'targeted_spell': {
                // Targeted spell enters aiming mode - handled by interface
                // Check if item stat is ready (for charged items like staffs)
                const chargeStat = item.getAttribute('charge_stat');
                if (chargeStat && !item.isStatReady(chargeStat)) {
                    const stat = item.stats?.[chargeStat];
                    const current = stat?.current ?? 0;
                    const uses = item.getAttribute('uses') || 1;
                    const readyAt = stat?.ready_at ?? Math.floor((stat?.max ?? 100) / uses);
                    if (this.isPlayerControlled()) {
                        const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                        const msg = stat?.per_turn === 0
                            ? `The ${displayName} is empty.`
                            : `The ${displayName} is not charged yet (${Math.floor(current)}/${readyAt}).`;
                        this.engine.inputManager?.showMessage(msg);
                    }
                    return false;
                }
                // Enter spell aiming mode via interface manager
                this.engine.interfaceManager?.enterSpellAimingMode(item, this);
                return true; // Returns true but turn is consumed in executeSpell
            }
            default:
                console.log(`Unknown item effect: ${effect}`);
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage("You don't understand a word of it!");
                }
                return true;
        }
    },

    /**
     * Get all usable items in inventory (items with use_verb attribute)
     * @returns {Array<{item: Item, verb: string}>}
     */
    getUsableItems() {
        return this.inventory
            .filter(item => item.getAttribute('use_verb'))
            .map(item => ({
                item: item,
                verb: item.getAttribute('use_verb')
            }));
    },
};
