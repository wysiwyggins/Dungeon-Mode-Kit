/**
 * InterfaceManager methods: the inventory and item action menu, the confirm
 * dialog, mouse clicks on dialogs, and the throw-item, equipment and use-item
 * menus.
 */

import { Item } from '../engine/item.js';
import { TILE_HEIGHT, TILE_WIDTH } from '../core/util.js';
import { MODIFIER_KEYS } from './interface-manager.js';

export const UIMenus = {
    /**
     * Show the item action menu for a selected inventory item
     * @param {number} itemIndex - Index of the item in player's inventory
     */
    showItemActionMenu(itemIndex) {
        if (!this.currentPlayer || !this.inventoryMode) return;
        if (itemIndex < 0 || itemIndex >= this.currentPlayer.inventory.length) return;

        this.clearTargetingHighlights();

        const item = this.currentPlayer.inventory[itemIndex];
        this.selectedItemIndex = itemIndex;

        // Remove existing action menu if present
        this.removeBox('item_action_menu');

        // Build menu lines
        const lines = [];
        const displayName = item.getDisplayName ? item.getDisplayName() : item.name;
        lines.push(displayName);
        // Under a player-given name, say what it actually is.
        if (item.customName) {
            lines.push(this.markup(item.getDisplayName({ ignoreCustomName: true }), this.inactiveTintColor));
        }
        lines.push(''); // blank line

        // Description, effect, equip forecast and charges — the same text the standalone
        // info panel shows, so the two can't disagree. Brogue's carried-item panel is
        // itemDetails plus buttons for exactly this reason (IO.c:4734).
        const info = this.buildItemInfoLines(item, this.currentPlayer, 26);
        if (info.length) {
            for (const line of info) lines.push(line);
            lines.push('');
        }

        // Add action options with number keys
        lines.push('Actions:');
        const actionStartLine = lines.length; // Line index of first action option
        let actionNum = 1;

        // Check if item is currently equipped
        const isEquipped = this.currentPlayer.isItemEquipped(item);

        // Drop is always available
        lines.push(`  ${actionNum}) Drop`);
        actionNum++;

        // Wear option if item is wearable armor and not currently worn
        if (item.hasAttribute('wearable') && !isEquipped) {
            lines.push(`  ${actionNum}) Wear`);
            actionNum++;
        }

        // Equip option if item is a weapon and not currently equipped
        if (item.hasAttribute('weapon') && !isEquipped) {
            lines.push(`  ${actionNum}) Equip`);
            actionNum++;
        }

        // Remove option if item is currently worn/equipped
        if (isEquipped) {
            lines.push(`  ${actionNum}) Remove`);
            actionNum++;
        }

        // Use verb if available
        const useVerb = item.getAttribute('use_verb');
        if (useVerb) {
            lines.push(`  ${actionNum}) ${this.capitalize(useVerb)}`);
            actionNum++;
        }

        // Name, for a `nameable` item you've identified
        if (item.canBeNamed?.()) {
            lines.push(`  ${actionNum}) Name`);
            actionNum++;
        }

        // Throw is always available — "Fire" when the wielded launcher takes this ammo
        lines.push(`  ${actionNum}) ${this.currentPlayer?.getLauncherFor(item) ? 'Fire' : 'Throw'}`);
        actionNum++;

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 12);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // This menu belongs to the player_info box, so it prefers sitting flush against
        // it and sharing its top — the pair then reads as one panel. Those are only
        // preferences: the shared placement rule drops them if they'd put the box on the
        // player. (Y here used to be a flat vis.originY + 1, the top of the viewport,
        // which is exactly where the player stands when they're in the upper half.)
        const playerInfoBox = this.boxes.get('player_info');
        const vis = this.getVisibleArea();

        const preferX = [];
        const preferY = [];
        if (playerInfoBox && playerInfoBox._boxX !== undefined) {
            const infoLeft = playerInfoBox._boxX;
            const infoRight = infoLeft + playerInfoBox._boxWidth;
            if (infoLeft - vis.originX > boxWidth) preferX.push(infoLeft - boxWidth);
            if (infoRight + boxWidth < vis.originX + vis.width) preferX.push(infoRight);
            if (playerInfoBox._boxY !== undefined) preferY.push(playerInfoBox._boxY);
        }

        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight, { preferX, preferY });

        // Create the box
        const boxContainer = this.createBox('item_action_menu', x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._actionStartLine = actionStartLine;
        boxContainer._actionCount = actionNum - 1;

        // Add text sprites
        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    },

    /**
     * Close the item action menu
     */
    closeItemActionMenu() {
        this.removeBox('item_action_menu');
        this.selectedItemIndex = null;
        this.updateBoxOverlays();
    },

    /**
     * Handle keyboard input for inventory interaction
     * @param {string} key - The key that was pressed
     * @returns {boolean} True if the key was handled
     */
    handleInventoryKey(key) {
        // Identify mode intercepts key input before the normal inventory flow
        if (this.identifyMode) {
            if (key === 'Escape') {
                this.exitIdentifyMode();
                return true;
            }
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            const idx = letters.indexOf(key);
            if (idx >= 0) {
                const caster = this.identifyCaster;
                const scroll = this.identifyScrollItem;
                const unidentified = (caster?.inventory || []).filter(i => i !== scroll && i.identified === false);
                const target = unidentified[idx];
                if (target) {
                    target.identify();
                    const revealed = target.getDisplayName ? target.getDisplayName() : target.name;
                    this.engine.inputManager?.showMessage(`It's a ${revealed}!`);
                    this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
                    this.engine.playSound?.('tap1');
                    // Remove scroll from inventory (consumable)
                    if (caster && scroll) {
                        caster.inventory = caster.inventory.filter(i => i !== scroll);
                    }
                    this.exitIdentifyMode();
                    this.hidePlayerInfo();
                    this.engine.inputManager?.onPlayerAction?.();
                }
            }
            return true;
        }

        if (this.enchantMode) {
            if (key === 'Escape') {
                this.exitEnchantMode();
                return true;
            }
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            const idx = letters.indexOf(key);
            if (idx >= 0) {
                const caster = this.enchantCaster;
                const scroll = this.enchantScrollItem;
                const enchantable = this._enchantCandidates(caster, scroll, this.enchantKind);
                const target = enchantable[idx];
                if (target) {
                    const chargeStat = target.getAttribute('charge_stat');
                    const cStat = chargeStat ? target.stats?.[chargeStat] : null;
                    const revealed = target.getDisplayName ? target.getDisplayName() : target.name;

                    if (this.enchantKind === 'protect') {
                        target.setAttribute('protected', true);
                        this.engine.inputManager?.showMessage(`A protective sheen coats your ${revealed}.`);
                    } else if (cStat && cStat.per_turn === 0) {
                        const uses = target.getAttribute('uses') || 1;
                        const useCost = cStat.ready_at || Math.floor(cStat.max / uses);
                        cStat.max += useCost;
                        cStat.current += useCost;
                        target.setAttribute('uses', uses + 1);
                        this.engine.inputManager?.showMessage(`Your ${revealed} surges with new energy!`);
                    } else {
                        target.enchantment = (target.enchantment || 0) + 1;
                        this.engine.inputManager?.showMessage(`Your ${revealed} glows brightly!`);
                    }
                    this.engine.inputManager?.showMessage('The scroll dissolves into ashes.');
                    this.engine.playSound?.('tap1');
                    if (caster && scroll) {
                        caster.inventory = caster.inventory.filter(i => i !== scroll);
                    }
                    this.exitEnchantMode();
                    this.hidePlayerInfo();
                    this.engine.inputManager?.onPlayerAction?.();
                }
            }
            return true;
        }

        if (!this.inventoryMode || !this.currentPlayer) return false;

        // If action menu is open, handle number keys for actions
        if (this.selectedItemIndex !== null) {
            if (key === 'Escape') {
                this.closeItemActionMenu();
                return true;
            }

            // Handle action selection (1, 2, 3, etc.)
            const actionNum = parseInt(key, 10);
            if (!isNaN(actionNum) && actionNum >= 1) {
                return this.executeItemAction(actionNum);
            }

            return false;
        }

        // Handle letter keys for item selection (a-z)
        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const itemIndex = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
            if (itemIndex < this.currentPlayer.inventory.length) {
                this.showItemActionMenu(itemIndex);
                return true;
            }
        }

        // Escape closes the player info entirely
        if (key === 'Escape') {
            this.hidePlayerInfo();
            return true;
        }

        return false;
    },

    /**
     * Execute an item action based on the numbered option
     * @param {number} actionNum - The action number (1-based)
     * @returns {boolean} True if action was executed
     */
    executeItemAction(actionNum) {
        if (this.selectedItemIndex === null || !this.currentPlayer) return false;

        const item = this.currentPlayer.inventory[this.selectedItemIndex];
        if (!item) return false;

        // Build the action list to determine which action corresponds to which number
        let currentAction = 1;

        // Check if item is currently equipped
        const isEquipped = this.currentPlayer.isItemEquipped(item);

        // Action 1 is always Drop
        if (actionNum === currentAction) {
            this.executeDropItem(item);
            return true;
        }
        currentAction++;

        // Wear (if wearable armor and not worn)
        if (item.hasAttribute('wearable') && !isEquipped) {
            if (actionNum === currentAction) {
                this.executeWearItem(item);
                return true;
            }
        }
        if (item.hasAttribute('wearable') && !isEquipped) currentAction++;

        // Equip (if weapon and not equipped)
        if (item.hasAttribute('weapon') && !isEquipped) {
            if (actionNum === currentAction) {
                this.executeWearItem(item); // equipItem handles both weapons and armor
                return true;
            }
        }
        if (item.hasAttribute('weapon') && !isEquipped) currentAction++;

        // Remove (if worn/equipped)
        if (isEquipped) {
            if (actionNum === currentAction) {
                this.executeRemoveItem(item);
                return true;
            }
        }
        if (isEquipped) currentAction++;

        // Use verb action
        const useVerb = item.getAttribute('use_verb');
        if (useVerb) {
            if (actionNum === currentAction) {
                this.executeUseItem(item);
                return true;
            }
        }
        if (useVerb) currentAction++;

        // Name action
        if (item.canBeNamed?.()) {
            if (actionNum === currentAction) {
                this.executeNameItem(item);
                return true;
            }
            currentAction++;
        }

        // Throw action (always available)
        if (actionNum === currentAction) {
            this.enterThrowAimingMode(item);
            return true;
        }

        return false;
    },

    /**
     * Ask for a name for an item and apply it. Submitting an empty name restores
     * the item's own. The inventory stays open underneath.
     */
    async executeNameItem(item) {
        const inputManager = this.engine.inputManager;
        if (!inputManager) return;

        const name = await inputManager.openTextInput({
            prompt: `What will you call your ${item.getDisplayName()}?`,
            initial: item.customName || '',
            maxLength: 20,
            allowEmpty: true,
            buttons: ['submit', 'cancel']
        });
        if (name === null) return;

        item.customName = name || null;
        inputManager.showMessage(name
            ? `You name it ${item.getDisplayName()}.`
            : `Your ${item.getDisplayName()} is nameless again.`);

        // Redraw so the pack and the action menu show the new name.
        if (this.inventoryMode && this.currentPlayer) {
            const index = this.selectedItemIndex;
            this.showPlayerInfo(this.currentPlayer);
            if (index !== null && this.currentPlayer.inventory[index] === item) {
                this.showItemActionMenu(index);
            }
        }
    },

    /**
     * Drop an item from inventory
     */
    executeDropItem(item) {
        if (!this.currentPlayer) return;

        // Unequip if this item is currently equipped
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.currentPlayer.equipment[slot] === item) {
                this.currentPlayer.unequipFromSlot(slot);
                break;
            }
        }

        if (item.count > 1) {
            // Drop one from the stack
            item.count--;
            const itemData = this.engine.currentPrototype?.getItemData(item.type);
            if (itemData) {
                const dropped = new Item(
                    this.currentPlayer.x, this.currentPlayer.y,
                    item.type, itemData, this.engine
                );
                dropped.owner = null;
                this.engine.entityManager.addEntity(dropped);
            }
            console.log(`${this.currentPlayer.name} dropped 1 ${item.name} (${item.count} remaining)`);
        } else {
            // Remove from inventory
            const index = this.currentPlayer.inventory.indexOf(item);
            if (index > -1) {
                this.currentPlayer.inventory.splice(index, 1);

                // Place item at player's position
                item.x = this.currentPlayer.x;
                item.y = this.currentPlayer.y;
                item.owner = null;
                this.engine.entityManager.addEntity(item);

                console.log(`${this.currentPlayer.name} dropped ${item.name}`);
            }
        }

        // Close menus and reset inventory mode
        this.hidePlayerInfo();
    },

    /**
     * Wear/equip an item
     */
    executeWearItem(item) {
        if (!this.currentPlayer) return;

        this.currentPlayer.equipItem(item);

        // Close all UI and consume turn
        this.hidePlayerInfo();
        this.engine.inputManager?.onPlayerAction();
    },

    /**
     * Remove/unequip a worn item
     */
    executeRemoveItem(item) {
        if (!this.currentPlayer) return;

        this.currentPlayer.unequipItem(item);

        // Close all UI and consume turn
        this.hidePlayerInfo();
        this.engine.inputManager?.onPlayerAction();
    },

    /**
     * Use an item (execute its use_verb action)
     */
    executeUseItem(item) {
        if (!this.currentPlayer) return;

        // Close menus and reset inventory mode before executing the effect
        const player = this.currentPlayer;

        // Refused outright (reading while blind): say why, keep the menu, spend no turn
        const blocker = player.getItemUseBlocker?.(item);
        if (blocker) {
            this.engine.inputManager?.showMessage(blocker, { style: 'warning' });
            return;
        }

        this.hidePlayerInfo();

        if (player.useItem) {
            player.useItem(item);
        }

        // Don't consume turn if we entered spell aiming or identify mode (handled by follow-up interaction)
        if (this.spellAimingMode || this.identifyMode || this.enchantMode || this.spikeDirectionMode || this.digDirectionMode) {
            return;
        }

        // Scroll ceremony handles its own turn unlock after the delay
        if (player._scrollCeremonyActive) return;

        // If the item was consumed, keep the info box closed; otherwise refresh it
        if (player.inventory.includes(item)) {
            this.showPlayerInfo(player);
        }
        this.engine.inputManager?.onPlayerAction();
    },

    /**
     * Show a confirmation dialog with Yes/No options
     * @param {string} message - The question to display
     * @param {function} onConfirm - Callback when user confirms (Y)
     * @param {function} onCancel - Callback when user cancels (N/Escape)
     */
    showConfirmDialog(message, onConfirm, onCancel, options = {}) {
        // Remove any existing confirm dialog
        this.closeConfirmDialog();

        this.clearTargetingHighlights();

        // Store callbacks
        this.confirmDialog = { message, onConfirm, onCancel };

        // Build dialog lines
        const lines = [];

        // Word wrap the message
        const wrappedMessage = this.wrapText(message, 24);
        for (const line of wrappedMessage) {
            lines.push(line);
        }
        lines.push('');
        lines.push('  (Y)es  /  (N)o');

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed so the dialog never hides the player
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        // Create the box
        const fillColor = options.fillColor ?? this.defaultFillColor;
        const borderTint = options.borderTint ?? this.defaultBorderTint;
        const textTint = options.textTint ?? this.defaultTextTint;
        const boxContainer = this.createBox('confirm_dialog', x, y, boxWidth, boxHeight, {
            fillColor,
            borderTint
        });

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._confirmYNLine = lines.length - 1;

        // Add text sprites
        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY, textTint);
        }

        this.updateBoxOverlays();
    },

    /**
     * Close the confirmation dialog
     */
    closeConfirmDialog() {
        this.removeBox('confirm_dialog');
        this.confirmDialog = null;
        this.updateBoxOverlays();
    },

    /**
     * Handle keyboard input for confirmation dialog
     * @param {string} key - The key that was pressed
     * @returns {boolean} True if the key was handled
     */
    handleConfirmKey(key) {
        if (!this.confirmDialog) return false;

        if (key === 'y' || key === 'Y') {
            const onConfirm = this.confirmDialog.onConfirm;
            this.closeConfirmDialog();
            if (onConfirm) onConfirm();
            return true;
        }

        // Any other key is a "no": only Y confirms, so an accidental or exploratory
        // keypress dismisses rather than leaving the dialog stuck open. Bare modifier
        // presses are ignored — they arrive as their own keydown, so treating them as
        // "no" would cancel the dialog while the user was still reaching for Shift+Y.
        if (MODIFIER_KEYS.has(key)) return true;

        const onCancel = this.confirmDialog.onCancel;
        this.closeConfirmDialog();
        if (onCancel) onCancel();
        return true;
    },

    /**
     * Check if a confirmation dialog is currently showing
     * @returns {boolean}
     */
    hasConfirmDialog() {
        return this.confirmDialog !== null;
    },

    // ========================================================================
    // DIALOG CLICK HANDLING
    // ========================================================================

    /**
     * Handle a mouse click that may target a dialog box.
     * Converts the global tile coordinate to a content line within the
     * topmost active dialog and dispatches the appropriate action.
     * @param {number} tileX - Clicked tile X in global map coordinates
     * @param {number} tileY - Clicked tile Y in global map coordinates
     * @returns {boolean} True if a dialog consumed the click
     */
    handleDialogClick(tileX, tileY) {
        // Priority order matches keyboard handler:

        // 0. Help window — matches updateBoxOverlays' priority. Any click dismisses
        //    (it's a reference panel with nothing to select), and consuming the click
        //    keeps a click behind the panel from starting an auto-walk.
        if (this.helpWindowMode) {
            this.closeHelpWindow();
            return true;
        }

        // 1. Confirm dialog (highest priority)
        if (this.confirmDialog) {
            const box = this.boxes.get('confirm_dialog');
            if (box) {
                const hit = this._hitTestBox(box, tileX, tileY);
                if (hit) {
                    this._handleConfirmClick(box, hit.contentLine, hit.contentCol);
                } else {
                    // Outside click dismisses (triggers cancel)
                    const onCancel = this.confirmDialog.onCancel;
                    this.closeConfirmDialog();
                    if (onCancel) onCancel();
                }
            }
            return true;
        }

        // 2. Identify picker (modal — highest priority after confirm)
        if (this.identifyMode) {
            const identBox = this.boxes.get('identify_picker');
            if (identBox) {
                const hit = this._hitTestBox(identBox, tileX, tileY);
                if (hit) {
                    this._handleIdentifyClick(hit.contentLine);
                } else {
                    this.exitIdentifyMode();
                }
            }
            return true;
        }

        // 2b. Enchant picker
        if (this.enchantMode) {
            const enchantBox = this.boxes.get('enchant_picker');
            if (enchantBox) {
                const hit = this._hitTestBox(enchantBox, tileX, tileY);
                if (hit) {
                    const itemLine = hit.contentLine - 2;
                    if (itemLine >= 0) {
                        const letters = 'abcdefghijklmnopqrstuvwxyz';
                        this.handleInventoryKey(letters[itemLine]);
                    }
                } else {
                    this.exitEnchantMode();
                }
            }
            return true;
        }

        // 3. Item action menu (sub-menu of inventory)
        if (this.inventoryMode && this.selectedItemIndex !== null) {
            const actionBox = this.boxes.get('item_action_menu');
            if (actionBox) {
                const hit = this._hitTestBox(actionBox, tileX, tileY);
                if (hit) {
                    this._handleItemActionClick(actionBox, hit.contentLine);
                } else {
                    // Outside click closes action menu, stays in inventory
                    this.closeItemActionMenu();
                }
            }
            return true;
        }

        // 3. Inventory / Player info
        if (this.inventoryMode && this.currentPlayer) {
            const invBox = this.boxes.get('player_info');
            if (invBox) {
                // The '?' affordance sits in the padding ring, outside the content
                // grid _hitTestBox covers, so check it against its own tile first.
                if (tileX === invBox._helpTileX && tileY === invBox._helpTileY) {
                    this.showHelpWindow();
                    return true;
                }
                const hit = this._hitTestBox(invBox, tileX, tileY);
                if (hit) {
                    this._handleInventoryClick(invBox, hit.contentLine);
                } else {
                    // Outside click closes inventory
                    this.hidePlayerInfo();
                }
            }
            return true;
        }

        // 4. Throw item menu
        if (this.throwMenuMode) {
            const throwBox = this.boxes.get('throw_item_menu');
            if (throwBox) {
                const hit = this._hitTestBox(throwBox, tileX, tileY);
                if (hit) {
                    this._handleThrowMenuClick(throwBox, hit.contentLine);
                } else {
                    this.closeThrowItemMenu();
                }
            }
            return true;
        }

        // 5. Equipment menu
        if (this.equipmentMenuMode) {
            const equipBox = this.boxes.get('equipment_menu');
            if (equipBox) {
                const hit = this._hitTestBox(equipBox, tileX, tileY);
                if (hit) {
                    this._handleEquipmentClick(equipBox, hit.contentLine);
                } else {
                    this.closeEquipmentMenu();
                }
            }
            return true;
        }

        return false;
    },

    /**
     * Test whether a global tile coordinate falls within a box's content area.
     * @param {PIXI.Container} box - Box container with _boxX, _boxY, _boxWidth, _boxHeight, _padding
     * @param {number} tileX - Global tile X
     * @param {number} tileY - Global tile Y
     * @returns {{ contentLine: number, contentCol: number } | null}
     */
    _hitTestBox(box, tileX, tileY) {
        const bx = box._boxX;
        const by = box._boxY;
        const bw = box._boxWidth;
        const bh = box._boxHeight;
        const pad = box._padding ?? 1;

        // Check if click is within the box bounds
        if (tileX < bx || tileX >= bx + bw || tileY < by || tileY >= by + bh) {
            return null;
        }

        // Content area starts at (bx + pad + 1, by + pad + 1), +1 for border
        const contentCol = tileX - (bx + pad + 1);
        const contentLine = tileY - (by + pad + 1);
        const contentWidth = bw - (pad * 2) - 2;
        const contentHeight = bh - (pad * 2) - 2;

        if (contentCol < 0 || contentCol >= contentWidth ||
            contentLine < 0 || contentLine >= contentHeight) {
            return null;
        }

        return { contentLine, contentCol };
    },

    /**
     * Handle click on confirm dialog content
     */
    _handleConfirmClick(box, contentLine, contentCol) {
        if (!this.confirmDialog) return;

        // The Y/N line: "  (Y)es  /  (N)o"
        // "/" separator is at column 9; left = Yes, right = No
        if (contentLine === box._confirmYNLine) {
            if (contentCol <= 8) {
                const onConfirm = this.confirmDialog.onConfirm;
                this.closeConfirmDialog();
                if (onConfirm) onConfirm();
            } else {
                const onCancel = this.confirmDialog.onCancel;
                this.closeConfirmDialog();
                if (onCancel) onCancel();
            }
        }
    },

    /**
     * Handle click on inventory item line
     */
    _handleInventoryClick(invBox, contentLine) {
        if (!invBox._inventoryLineIndices) return;

        for (let i = 0; i < invBox._inventoryLineIndices.length; i++) {
            if (contentLine === invBox._inventoryLineIndices[i].lineIndex) {
                this.showItemActionMenu(i);
                return;
            }
        }
    },

    /**
     * Handle click on item action menu line
     */
    _handleItemActionClick(actionBox, contentLine) {
        const startLine = actionBox._actionStartLine;
        const count = actionBox._actionCount;
        if (startLine === undefined || count === undefined) return;

        if (contentLine >= startLine && contentLine < startLine + count) {
            const actionNum = contentLine - startLine + 1;
            this.executeItemAction(actionNum);
        }
    },

    /**
     * Handle click on throw item menu line
     */
    _handleThrowMenuClick(throwBox, contentLine) {
        const startLine = throwBox._itemStartLine;
        const count = throwBox._itemCount;
        if (startLine === undefined || count === undefined) return;

        if (contentLine >= startLine && contentLine < startLine + count) {
            const itemIndex = contentLine - startLine;
            if (this.currentPlayer && itemIndex < this.currentPlayer.inventory.length) {
                const item = this.currentPlayer.inventory[itemIndex];
                this.closeThrowItemMenu();
                this.enterThrowAimingMode(item);
            }
        }
    },

    /**
     * Handle click on equipment menu line
     */
    _handleEquipmentClick(equipBox, contentLine) {
        const startLine = equipBox._itemStartLine;
        const count = equipBox._itemCount;
        if (startLine === undefined || count === undefined) return;

        if (contentLine >= startLine && contentLine < startLine + count) {
            const itemIndex = contentLine - startLine;
            if (itemIndex < this.equipmentMenuItems.length) {
                const entry = this.equipmentMenuItems[itemIndex];
                const item = entry.item;
                const player = this.equipmentMenuPlayer;

                if (player.isItemEquipped(item)) {
                    player.unequipItem(item);
                    this.engine.playSound?.('tap2');
                } else {
                    player.equipItem(item);
                    this.engine.playSound?.('tap2');
                }

                // Refresh menu to show updated state
                this.showEquipmentMenu(player);
            }
        }
    },

    showThrowItemMenu(player) {
        if (!player || !player.inventory || player.inventory.length === 0) {
            // No items to throw
            this.showTextBox('throw_menu_empty', 'You have nothing to throw.', {
                dismissOnMove: true
            });
            return;
        }

        this.clearTargetingHighlights();

        this.currentPlayer = player;
        this.throwMenuMode = true;

        const menuId = 'throw_item_menu';

        // Remove existing if present
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        // Build menu lines
        const lines = [];
        lines.push('Throw which item?');
        lines.push('');

        // List all inventory items with letter keys
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            const letter = String.fromCharCode(97 + i); // 'a', 'b', 'c', etc.
            let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            displayName = this.colorizeItemName(this.truncateText(displayName, 26));
            let itemText = `${letter})  ${displayName}`;
            // Mark equipped items
            if (player.isItemEquipped(item)) {
                itemText += item.hasAttribute('weapon') ? ' (equipped)' : ' (worn)';
            }
            lines.push('  ' + itemText);
        }

        lines.push('');
        lines.push('Esc to cancel');

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        // Create the box
        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._itemStartLine = 2; // Items start after "Throw which item?" and blank line
        boxContainer._itemCount = player.inventory.length;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: player.inventory.length },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);

        // Add text sprites
        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        // Render item tiles (offset for "  a) " = 5 chars)
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            const lineIndex = i + 2; // Account for header and blank line
            const tileX = textStartX + (5 * TILE_WIDTH);
            const tileY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderItemTile(boxContainer, item, tileX, tileY);
            this.renderMagicPolarityIcon(boxContainer, item, tileX - TILE_WIDTH, tileY);
        }

        this.updateBoxOverlays();
    },

    /**
     * Close the throw item menu
     */
    closeThrowItemMenu() {
        this.removeBox('throw_item_menu');
        this.throwMenuMode = false;
        this.updateBoxOverlays();
    },

    /**
     * Handle keyboard input for throw item menu
     * @param {string} key - The key pressed
     * @returns {boolean} True if key was handled
     */
    handleThrowMenuKey(key) {
        if (!this.throwMenuMode || !this.currentPlayer) return false;

        if (key === 'Escape') {
            this.closeThrowItemMenu();
            return true;
        }

        // Handle letter keys for item selection (a-z)
        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const itemIndex = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
            if (itemIndex < this.currentPlayer.inventory.length) {
                const item = this.currentPlayer.inventory[itemIndex];
                this.closeThrowItemMenu();
                this.enterThrowAimingMode(item);
                return true;
            }
        }

        return true; // Consume all keys while menu is open
    },

    // ========================================================================
    // EQUIPMENT MENU (E key)
    // ========================================================================

    /**
     * Toggle the equipment menu
     * @param {Actor} player - The player actor
     */
    toggleEquipmentMenu(player) {
        if (this.equipmentMenuMode) {
            this.closeEquipmentMenu();
        } else {
            this.showEquipmentMenu(player);
        }
    },

    /**
     * Show the equipment menu listing all wearable and equippable items
     * @param {Actor} player - The player actor
     */
    showEquipmentMenu(player) {
        if (!player || !player.inventory) return;

        // Close other menus
        this.hidePlayerInfo();
        this.closeThrowItemMenu();

        this.equipmentMenuPlayer = player;
        this.equipmentMenuMode = true;

        const menuId = 'equipment_menu';

        // Remove existing if present
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        // Build list of equippable/wearable items
        this.equipmentMenuItems = [];
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            if (item.hasAttribute('wearable') || item.hasAttribute('weapon')) {
                this.equipmentMenuItems.push({
                    item: item,
                    inventoryIndex: i
                });
            }
        }

        // Build menu lines
        const lines = [];
        lines.push('Equipment');
        lines.push('');

        // Show current equipment slots
        lines.push('Equipped:');
        const weapon = player.getEquippedWeapon?.();
        const topItem = player.equipment?.top;
        const middleItem = player.equipment?.middle;
        const lowerItem = player.equipment?.lower;

        lines.push(`  Weapon: ${weapon ? weapon.name : '(none)'}`);
        lines.push(`  Head:   ${topItem ? topItem.name : '(none)'}`);
        lines.push(`  Body:   ${middleItem ? middleItem.name : '(none)'}`);
        lines.push(`  Legs:   ${lowerItem ? lowerItem.name : '(none)'}`);
        lines.push('');

        let itemsStartLine = -1;
        if (this.equipmentMenuItems.length === 0) {
            lines.push('No equippable items');
        } else {
            lines.push('Items:');
            itemsStartLine = lines.length; // Line index of first item option
            for (let i = 0; i < this.equipmentMenuItems.length; i++) {
                const entry = this.equipmentMenuItems[i];
                const item = entry.item;
                const letter = String.fromCharCode(97 + i); // 'a', 'b', 'c', etc.
                let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                displayName = this.colorizeItemName(this.truncateText(displayName, 24));

                const isEquipped = player.isItemEquipped(item);
                let status = '';
                if (isEquipped) {
                    status = item.hasAttribute('weapon') ? ' [E]' : ' [W]';
                }

                lines.push(`  ${letter})  ${displayName}${status}`);
            }
        }

        lines.push('');
        lines.push('Esc to close');

        // Calculate dimensions
        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 20);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        // Create the box
        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._itemStartLine = itemsStartLine;
        boxContainer._itemCount = this.equipmentMenuItems.length;

        // Zebra-stripe the item rows
        if (itemsStartLine !== -1) {
            const stripeRows = Array.from({ length: this.equipmentMenuItems.length },
                (_, i) => ({ lineIndex: itemsStartLine + i }));
            this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);
        }

        // Add text sprites
        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        // Render item tiles next to item names (offset for "  a) " = 5 chars)
        for (let i = 0; i < this.equipmentMenuItems.length; i++) {
            const entry = this.equipmentMenuItems[i];
            const lineIndex = itemsStartLine + i;
            const tileX = textStartX + (5 * TILE_WIDTH);
            const tileY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderItemTile(boxContainer, entry.item, tileX, tileY);
            this.renderMagicPolarityIcon(boxContainer, entry.item, tileX - TILE_WIDTH, tileY);
        }

        this.updateBoxOverlays();
    },

    /**
     * Close the equipment menu
     */
    closeEquipmentMenu() {
        this.removeBox('equipment_menu');
        this.equipmentMenuMode = false;
        this.equipmentMenuPlayer = null;
        this.equipmentMenuItems = [];
        this.updateBoxOverlays();
    },

    /**
     * Handle keyboard input for equipment menu
     * @param {string} key - The key pressed
     * @returns {boolean} True if key was handled
     */
    handleEquipmentKey(key) {
        if (!this.equipmentMenuMode || !this.equipmentMenuPlayer) return false;

        if (key === 'Escape' || key === 'e' || key === 'E') {
            this.closeEquipmentMenu();
            return true;
        }

        // Handle letter keys for item selection (a-z)
        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const itemIndex = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
            if (itemIndex < this.equipmentMenuItems.length) {
                const entry = this.equipmentMenuItems[itemIndex];
                const item = entry.item;
                const player = this.equipmentMenuPlayer;

                // Toggle equip/unequip
                if (player.isItemEquipped(item)) {
                    player.unequipItem(item);
                    this.engine.playSound?.('tap2');
                } else {
                    player.equipItem(item);
                    this.engine.playSound?.('tap2');
                }

                // Refresh the menu to show updated state
                this.showEquipmentMenu(player);
                return true;
            }
        }

        return true; // Consume all keys while menu is open
    },

    // ========================================================================
    // USE ITEM MENU (quaff, read, etc.)
    // ========================================================================

    showUseMenu(player, verb, prompt) {
        if (!player || !player.inventory) return;

        this.hidePlayerInfo();
        this.closeThrowItemMenu();
        this.closeEquipmentMenu();

        this.useMenuPlayer = player;

        this.useMenuItems = [];
        for (let i = 0; i < player.inventory.length; i++) {
            const item = player.inventory[i];
            if (item.getAttribute('use_verb') === verb) {
                this.useMenuItems.push(item);
            }
        }

        if (this.useMenuItems.length === 0) {
            this.engine.inputManager?.showMessage(`You have nothing to ${verb.toLowerCase()}.`);
            return;
        }

        this.useMenuMode = true;

        const menuId = 'use_item_menu';
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        const lines = [];
        lines.push(prompt);
        lines.push('');

        for (let i = 0; i < this.useMenuItems.length; i++) {
            const item = this.useMenuItems[i];
            const letter = String.fromCharCode(97 + i);
            let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
            displayName = this.colorizeItemName(this.truncateText(displayName, 22));
            // Same row shape as the other item menus: polarity icon in the gap
            // before the tile, tile in the gap before the name.
            lines.push(`  ${letter})  ${displayName}`);
        }

        lines.push('');
        lines.push('Esc to cancel');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the item rows
        const stripeRows = Array.from({ length: this.useMenuItems.length },
            (_, i) => ({ lineIndex: 2 + i }));
        this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);

        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        for (let i = 0; i < this.useMenuItems.length; i++) {
            const item = this.useMenuItems[i];
            const lineIndex = i + 2;
            const tileX = textStartX + (5 * TILE_WIDTH);
            const tileY = textStartY + (lineIndex * TILE_HEIGHT);
            this.renderItemTile(boxContainer, item, tileX, tileY);
            this.renderMagicPolarityIcon(boxContainer, item, tileX - TILE_WIDTH, tileY);
        }

        this.updateBoxOverlays();
    },

    closeUseMenu() {
        this.removeBox('use_item_menu');
        this.useMenuMode = false;
        this.useMenuPlayer = null;
        this.useMenuItems = [];
        this.updateBoxOverlays();
    },

    handleUseMenuKey(key) {
        if (!this.useMenuMode || !this.useMenuPlayer) return false;

        if (key === 'Escape') {
            this.closeUseMenu();
            return true;
        }

        if (key.length === 1 && key >= 'a' && key <= 'z') {
            const idx = key.charCodeAt(0) - 97;
            if (idx < this.useMenuItems.length) {
                const item = this.useMenuItems[idx];
                const player = this.useMenuPlayer;
                this.closeUseMenu();
                this.currentPlayer = player;
                this.executeUseItem(item);
                return true;
            }
        }

        return true;
    },
};
