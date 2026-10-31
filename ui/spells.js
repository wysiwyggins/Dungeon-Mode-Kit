/**
 * InterfaceManager methods: spell aiming, the identify and enchant pickers, and
 * the player's side of casting from an item (executeSpell: range, charges,
 * identification). The cast itself is DungeonEngine.castSpell.
 */

import { getLinePath } from '../core/pathfinding.js';
import { spellFromItem } from '../core/spells.js';
import { TILE_HEIGHT, TILE_WIDTH } from '../core/util.js';
import { MODIFIER_KEYS, SPELL_DEFAULT_TARGETS } from './interface-manager.js';

export const UISpells = {
    // ========================================================================
    // SPELL AIMING MODE (for targeted spells like fireball)
    // ========================================================================

    /**
     * Enter spell aiming mode for a targeted spell item
     * @param {Item} item - The item casting the spell
     * @param {Actor} caster - The actor using the item
     */
    enterSpellAimingMode(item, caster) {
        this.spellAimingMode = true;
        this.spellItem = item;
        this.spellCaster = caster;
        this.currentPlayer = caster;

        this.aimTargets = null;
        this.aimTargetIndex = -1;

        // Close any open menus
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        // Start aimed at the nearest valid target, so zapping works without a mouse.
        const seeded = this.seedAimTarget(SPELL_DEFAULT_TARGETS);

        const im = this.engine.inputManager;
        const cycleKey = im?.getKeyForAction('cycle_target', 'Tab') || 'Tab';
        const confirmKey = im?.getKeyForAction('confirm_target', 'Enter') || 'Enter';
        this.showTextBox('spell_instructions',
            `[${cycleKey}] to target, [${confirmKey}] or click to cast. Esc to cancel.`, {
            dismissOnMove: false
        });

        // Update the spell path based on current mouse position
        this.updateSpellPath();
        if (seeded) this.announceAimTarget(seeded);
    },

    /**
     * Open the identify item picker — player selects one unidentified item to identify.
     * The scroll item and caster are stored; actual identification happens on item selection.
     */
    enterIdentifyMode(scrollItem, caster) {
        const unidentified = (caster.inventory || []).filter(i => i !== scrollItem && i.identified === false);
        if (unidentified.length === 0) {
            if (scrollItem && !scrollItem.identified) {
                scrollItem.identify();
                const identifiedName = scrollItem.getDisplayName ? scrollItem.getDisplayName() : scrollItem.name;
                this.engine.inputManager?.showMessage(`It's a ${identifiedName}!`);
            }
            this.engine.inputManager?.showMessage('You have nothing to identify.');
            this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
            this.engine.playSound?.('tone1');
            if (caster && scrollItem) {
                caster.inventory = caster.inventory.filter(i => i !== scrollItem);
            }
            return;
        }

        this.identifyMode = true;
        this.identifyScrollItem = scrollItem;
        this.identifyCaster = caster;
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this._showIdentifyPicker(unidentified);
    },

    /**
     * Render the identify item picker box.
     */
    _showIdentifyPicker(unidentified) {
        this.removeBox('identify_picker');

        const lines = ['Identify which item?', ''];
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        for (let i = 0; i < unidentified.length && i < letters.length; i++) {
            const displayName = unidentified[i].getDisplayName ? unidentified[i].getDisplayName() : unidentified[i].name;
            lines.push(`  ${letters[i]}) ${displayName}`);
        }
        lines.push('');
        lines.push('  Esc) Cancel');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 14);
        const boxWidth = maxLineLength + padding * 2 + 2;
        const boxHeight = lines.length + padding * 2 + 2;
        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox('identify_picker', x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: Math.min(unidentified.length, letters.length) },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, maxLineLength, padding);

        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + lineIndex * TILE_HEIGHT;
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    },

    /**
     * Handle a click inside the identify picker box.
     * contentLine 0 = title, 1 = blank, 2+ = item entries (a, b, c…).
     */
    _handleIdentifyClick(contentLine) {
        const itemLine = contentLine - 2; // first two lines are header + blank
        if (itemLine < 0) return;
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        this.handleInventoryKey(letters[itemLine]);
    },

    /**
     * Exit identify mode without identifying anything.
     */
    exitIdentifyMode() {
        this.identifyMode = false;
        this.identifyScrollItem = null;
        this.identifyCaster = null;
        this.removeBox('identify_picker');
        this.updateBoxOverlays();
    },

    /**
     * Items the enchant picker offers. `kind` is 'enchant' (scroll of enchantment:
     * anything enchantable) or 'protect' (scroll of protection: weapons and
     * wearables not yet `protected`).
     */
    _enchantCandidates(caster, scrollItem, kind = 'enchant') {
        return (caster?.inventory || []).filter(i => {
            if (i === scrollItem) return false;
            if (kind === 'protect') {
                return (i.getAttribute('weapon') || i.getAttribute('wearable')) && !i.getAttribute('protected');
            }
            return i.getAttribute('enchantable');
        });
    },

    enterEnchantMode(scrollItem, caster, kind = 'enchant') {
        const enchantable = this._enchantCandidates(caster, scrollItem, kind);
        if (enchantable.length === 0) {
            this.engine.inputManager?.showMessage(`You have nothing to ${kind}.`);
            this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
            this.engine.playSound?.('tone1');
            if (caster && scrollItem) {
                caster.inventory = caster.inventory.filter(i => i !== scrollItem);
            }
            return;
        }

        this.enchantMode = true;
        this.enchantKind = kind;
        this.enchantScrollItem = scrollItem;
        this.enchantCaster = caster;
        this.closeItemActionMenu();
        this.removeBox('player_info');
        this._showEnchantPicker(enchantable);
    },

    _showEnchantPicker(enchantable) {
        this.removeBox('enchant_picker');

        const lines = [this.enchantKind === 'protect' ? 'Protect which item?' : 'Enchant which item?', ''];
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        for (let i = 0; i < enchantable.length && i < letters.length; i++) {
            const item = enchantable[i];
            const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            lines.push(`  ${letters[i]}) ${displayName}`);
        }
        lines.push('');
        lines.push('  Esc) Cancel');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 14);
        const boxWidth = maxLineLength + padding * 2 + 2;
        const boxHeight = lines.length + padding * 2 + 2;
        // Centered horizontally; vertically placed away from the player.
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox('enchant_picker', x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: Math.min(enchantable.length, letters.length) },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, maxLineLength, padding);

        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + lineIndex * TILE_HEIGHT;
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    },

    exitEnchantMode() {
        this.enchantMode = false;
        this.enchantKind = null;
        this.enchantScrollItem = null;
        this.enchantCaster = null;
        this.removeBox('enchant_picker');
        this.updateBoxOverlays();
    },

    /**
     * Exit spell aiming mode without casting
     */
    exitSpellAimingMode() {
        this.spellAimingMode = false;
        this.spellItem = null;
        this.spellCaster = null;

        // Hide the line path
        this.engine.renderer?.hideLinePath();

        // Remove instruction message
        this.removeTextBox('spell_instructions');

        // Re-enable normal tile highlight
        this.engine.renderer?.hideTileHighlight();

        // Restore walk path display for current hovered tile
        const inputManager = this.engine.inputManager;
        if (inputManager && inputManager.hoveredTile.x >= 0) {
            inputManager.updateWalkPath(inputManager.hoveredTile.x, inputManager.hoveredTile.y);
        }
    },

    /**
     * Update the spell path line based on current mouse position
     */
    updateSpellPath() {
        if (!this.spellAimingMode || !this.spellCaster) return;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return;

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't draw path if mouse is off-screen or on caster
        if (targetX < 0 || targetY < 0) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        if (targetX === this.spellCaster.x && targetY === this.spellCaster.y) {
            this.engine.renderer?.hideLinePath();
            return;
        }

        // Check spell range (only if defined). Don't reveal the range boundary for an
        // unidentified item — the gray out-of-range flip would let the player read off
        // the exact range (and thus narrow down the item) before identifying it.
        const range = this.spellItem?.getAttribute('spell_range');
        let pathColor = 0xFF6600; // Default orange for spells

        if (range && this.spellItem?.identified) {
            const dx = targetX - this.spellCaster.x;
            const dy = targetY - this.spellCaster.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            pathColor = distance <= range ? 0xFF6600 : 0x666666; // Orange if in range, gray if out
        }

        // Detect bolt spells for pass-through targeting
        const spellEffect = this.spellItem?.getAttribute('spell_effect');
        const isBolt = spellEffect?.type === 'bolt';

        // Show the line path from caster to target
        this.engine.renderer?.showLinePath(
            this.spellCaster.x,
            this.spellCaster.y,
            targetX,
            targetY,
            isBolt ? 0xFFFF44 : pathColor,
            null,
            isBolt ? { passThrough: true } : {}
        );
    },

    /**
     * Execute the spell at the current target position
     */
    executeSpell() {
        if (!this.spellAimingMode || !this.spellCaster || !this.spellItem) {
            return;
        }

        const inputManager = this.engine.inputManager;
        if (!inputManager) {
            return;
        }

        const targetX = inputManager.hoveredTile.x;
        const targetY = inputManager.hoveredTile.y;

        // Don't cast if mouse is off-screen or on caster
        if (targetX < 0 || targetY < 0) {
            return;
        }
        if (targetX === this.spellCaster.x && targetY === this.spellCaster.y) {
            return;
        }

        // Check spell range (only if spell_range is defined). Tiles actually cast to.
        let castX = targetX;
        let castY = targetY;
        const range = this.spellItem.getAttribute('spell_range');
        if (range) {
            const dx = targetX - this.spellCaster.x;
            const dy = targetY - this.spellCaster.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > range) {
                if (this.spellItem.identified) {
                    // Identified item: enforce the known range with a clear message.
                    const displayName = this.spellItem.getDisplayName ? this.spellItem.getDisplayName() : this.spellItem.name;
                    this.engine.inputManager?.showMessage(`Target is out of range for ${displayName}.`);
                    return;
                }
                // Unidentified item: don't reveal the range by rejecting the cast (that
                // would let the player fish for the exact range). Silently clamp the
                // target to the last in-range tile along the aim line so the effect can't
                // reach farther than the true range either.
                const clamped = getLinePath(this.spellCaster.x, this.spellCaster.y, targetX, targetY)
                    .filter(p => {
                        const pdx = p.x - this.spellCaster.x;
                        const pdy = p.y - this.spellCaster.y;
                        return Math.sqrt(pdx * pdx + pdy * pdy) <= range;
                    });
                const endpoint = clamped[clamped.length - 1];
                if (endpoint) {
                    castX = endpoint.x;
                    castY = endpoint.y;
                }
            }
        }

        const item = this.spellItem;
        const caster = this.spellCaster;
        this.exitSpellAimingMode();

        // The cast itself is the engine's (engine/dungeon-engine/spellcasting.js),
        // shared with monsters; what's left here is what only an item does.
        const cast = this.engine.castSpell({
            caster,
            spell: spellFromItem(item),
            target: { x: castX, y: castY },
            item,
            onComplete: () => {
                if (!item.identified) {
                    item.identify();
                    const identifiedName = item.getDisplayName ? item.getDisplayName() : item.name;
                    this.engine.inputManager?.showMessage(`You identified the ${identifiedName}!`);
                }
                const spellName = item.getAttribute('spell_name') || (item.getDisplayName ? item.getDisplayName() : item.name);
                this.engine.inputManager?.showMessage(`You cast ${spellName}!`);
                // This counts as a player action
                this.engine.inputManager?.onPlayerAction();
            }
        });
        if (!cast) return;

        // Consume charge from item stat if applicable
        // Cost per use is max / uses (or ready_at if specified)
        const chargeStat = item.getAttribute('charge_stat');
        if (chargeStat && item.stats?.[chargeStat]) {
            const stat = item.stats[chargeStat];
            const uses = item.getAttribute('uses') || 1;
            const useCost = stat.ready_at || Math.floor(stat.max / uses);
            item.modifyStat(chargeStat, -useCost);
        }
    },

    /**
     * Handle keyboard input during spell aiming mode
     *
     * Consumes every key while aiming, matching handleThrowKey. It used to fall
     * through on unrecognized keys, which let target-cycling reach the global
     * handler and start an explore preview in the middle of a cast.
     *
     * @param {string} key - The key pressed
     * @param {KeyboardEvent} [event] - The raw event, for resolving keybindings
     * @returns {boolean} True if key was handled
     */
    handleSpellAimingKey(key, event) {
        if (!this.spellAimingMode) return false;
        if (key === 'Escape') {
            this.exitSpellAimingMode();
            return true;
        }
        if (this.isCycleTargetKey(event)) {
            this.cycleAimTarget();
            return true;
        }
        if (this.isConfirmTargetKey(event)) {
            this.executeSpell();
            return true;
        }
        if (MODIFIER_KEYS.has(key)) return false;
        return true;
    },

    /**
     * Handle mouse click during spell aiming mode
     * @returns {boolean} True if click was handled
     */
    handleSpellAimingClick() {
        if (!this.spellAimingMode) return false;
        this.executeSpell();
        return true;
    },

    /**
     * Check if in spell aiming mode
     * @returns {boolean}
     */
    isSpellAiming() {
        return this.spellAimingMode;
    },
};
