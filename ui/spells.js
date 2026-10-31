/**
 * InterfaceManager methods: spell aiming, the identify and enchant pickers,
 * casting (executeSpell/completeSpell) and spell effects like tunneling and
 * filling open ground.
 */

import { getChebyshevDistance, getLinePath } from '../core/pathfinding.js';
import { ALL_DIRS, TILE_HEIGHT, TILE_WIDTH } from '../core/util.js';
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

        // Get spell effect to check for bolt type
        const spellEffect = this.spellItem?.getAttribute('spell_effect') || { center: 'fire', radius: 0 };
        const isBolt = spellEffect.type === 'bolt';

        // Get the actual landing position (may be blocked by solid actor for line-of-sight spells)
        const pathResult = this.engine.renderer?.showLinePath(
            this.spellCaster.x,
            this.spellCaster.y,
            castX,
            castY,
            undefined,
            null,
            isBolt ? { passThrough: true } : {}
        );

        if (!pathResult || pathResult.path.length === 0) return;

        // Store references before exiting aiming mode
        const item = this.spellItem;
        const caster = this.spellCaster;
        const path = pathResult.path;
        const landingPoint = path[path.length - 1];

        // Exit aiming mode
        this.exitSpellAimingMode();

        // Consume charge from item stat if applicable
        // Cost per use is max / uses (or ready_at if specified)
        const chargeStat = item.getAttribute('charge_stat');
        if (chargeStat && item.stats?.[chargeStat]) {
            const stat = item.stats[chargeStat];
            const uses = item.getAttribute('uses') || 1;
            const useCost = stat.ready_at || Math.floor(stat.max / uses);
            item.modifyStat(chargeStat, -useCost);
        }

        // Play spell cast sound
        const castSound = item.getAttribute('cast_sound') || 'fire';
        this.engine.playSound(castSound);

        if (isBolt) {
            // Bolt spells use tile fill effect instead of projectile animation.
            // A spell's `vfx` (expanded to spell_vfx) names the vfx.json entry;
            // the fallback only serves items that still declare a bolt inline.
            const boltFx = item.getAttribute('spell_vfx') || 'lightning_bolt';
            this.engine.renderer?.effectRunner.apply(boltFx, caster, { path });
            for (const bounce of pathResult.bounces || []) {
                this.engine.inputManager?.showMessage(
                    `The bolt bounces off ${bounce.actor.getNameWithArticle()}!`,
                    { x: bounce.x, y: bounce.y }
                );
            }
            // Delay completion slightly so the visual leads the damage
            const fillDuration = path.length * 25 + 100;
            setTimeout(() => {
                this.completeBoltSpell(item, caster, path, spellEffect);
            }, fillDuration);
        } else {
            // Animate projectile to target, then spawn effects
            this.animateSpellProjectile(item, path, () => {
                this.completeSpell(item, caster, landingPoint, spellEffect, path);
            });
        }
    },

    /**
     * Animate a spell projectile along a path
     * @param {Item} item - The item casting the spell
     * @param {Array} path - Array of {x, y} points
     * @param {Function} onComplete - Callback when animation finishes
     */
    animateSpellProjectile(item, path, onComplete) {
        const renderer = this.engine.renderer;
        if (!renderer || path.length === 0) {
            onComplete();
            return;
        }

        const tileWidth = this.engine.config.tileWidth;
        const tileHeight = this.engine.config.tileHeight;
        const tileset = PIXI.Loader.shared.resources.tiles;

        // Get projectile tile from item, or use a default fireball tile
        let projectileTile = item.getAttribute('projectile_tile') || item.tileIndex;
        // Resolve tile name to coordinates if it's a string
        if (typeof projectileTile === 'string') {
            projectileTile = this.engine.spriteLibrary?.resolveTile(projectileTile);
        }
        const projectileTint = item.getAttribute('projectile_tint') || item.tint || 0xFF6600;

        if (!tileset || !projectileTile) {
            onComplete();
            return;
        }

        // Create projectile sprite
        const rect = new PIXI.Rectangle(
            projectileTile.x * tileWidth,
            projectileTile.y * tileHeight,
            tileWidth,
            tileHeight
        );
        const texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        const projectileSprite = new PIXI.Sprite(texture);

        // Apply tint
        if (projectileTint !== undefined && projectileTint !== null) {
            projectileSprite.tint = typeof projectileTint === 'string' ?
                parseInt(projectileTint.replace('#', ''), 16) : projectileTint;
        }

        projectileSprite.zIndex = 100; // Above everything
        renderer.uiContainer.addChild(projectileSprite);

        // Animate through path
        let currentIndex = 0;
        const frameDelay = 20; // milliseconds per tile (faster than thrown items)

        const animateFrame = () => {
            if (currentIndex >= path.length) {
                // Animation complete - remove sprite and call callback
                renderer.uiContainer.removeChild(projectileSprite);
                projectileSprite.destroy();
                onComplete();
                return;
            }

            const point = path[currentIndex];
            projectileSprite.x = point.x * tileWidth;
            projectileSprite.y = point.y * tileHeight;

            currentIndex++;
            setTimeout(animateFrame, frameDelay);
        };

        // Start animation
        animateFrame();
    },

    /**
     * Complete the spell - spawn effect actors at target
     * @param {Item} item - The spell item
     * @param {Actor} caster - The actor who cast it
     * @param {Object} landingPoint - {x, y} where spell lands
     * @param {Object} spellEffect - Effect configuration {center, radius, outer}
     */
    completeSpell(item, caster, landingPoint, spellEffect, path = [landingPoint]) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        const { center, radius = 0, outer } = spellEffect;
        const x = landingPoint.x;
        const y = landingPoint.y;

        // Spawn center actor
        if (center) {
            entityManager.spawnActor(center, x, y);
        }

        // Spawn actors in radius
        if (radius > 0) {
            const outerType = outer || center;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (dx === 0 && dy === 0) continue; // Skip center
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= radius) {
                        entityManager.spawnActor(outerType, x + dx, y + dy);
                    }
                }
            }
        }

        // Fill the open ground where the bolt stopped with an actor:
        // { "fill": "crystal", "fill_radius": 2 } (staff of obstruction). It
        // floods from the last open tile before whatever stopped the bolt, so
        // walls contain it, and it skips tiles a solid actor already holds.
        if (spellEffect.fill) {
            this.fillOpenGround(spellEffect.fill, spellEffect.fill_radius ?? 1, caster, path);
        }

        // Wand of plenty: { "clone_target": true }
        if (spellEffect.clone_target) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const name = target.getNameWithArticle(true);
                const providers = { target_name: () => name };
                this.engine.inputManager?.showMessage(target.cloneSelf()
                    ? item.getEffectMessage('effect_message', `${name} is beside itself!`, providers)
                    : item.getEffectMessage('fail_message', `${name} shudders, but stays single.`, providers), { x, y });
            }
        }

        // Wand of polymorph: { "polymorph_target": true }, or an actor id/type
        // (or list of them) to draw the new form from: { "polymorph_target": "beast" },
        // or a floor range's spawn pool: { "polymorph_target": { "floors": "current" } }
        if (spellEffect.polymorph_target) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const name = target.getNameWithArticle(true);
                const pool = spellEffect.polymorph_target === true ? undefined : spellEffect.polymorph_target;
                const creature = target.polymorph(pool);
                const newName = creature?.getNameWithArticle(false);
                const providers = { target_name: () => name, new_form_name: () => newName };
                this.engine.inputManager?.showMessage(creature
                    ? item.getEffectMessage('effect_message', `${name} turns into ${newName}!`, providers)
                    : item.getEffectMessage('fail_message', `${name} resists the change.`, providers), { x, y });
            }
        }

        // Staff of tunneling: { "tunnel": 5 } — see tunnelAlong
        if (spellEffect.tunnel) {
            this.tunnelAlong(caster, landingPoint, spellEffect.tunnel, item);
        }

        // Change the target's stats: { "target_effect": { "health": 20 } }
        // (staff of healing). Works on friend and foe alike.
        if (spellEffect.target_effect) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead && target.stats) {
                const healthBefore = target.stats.health?.current;
                for (const [key, value] of Object.entries(spellEffect.target_effect)) {
                    target.modifyStat(key, value);
                }
                const healthAfter = target.stats.health?.current;
                if (healthBefore !== undefined && healthAfter !== healthBefore) {
                    const name = target.getNameWithArticle(true);
                    this.engine.inputManager?.showMessage(healthAfter > healthBefore
                        ? `${name} looks healthier.` : `${name} is hurt.`, { x: target.x, y: target.y });
                    if (healthAfter <= 0) target.die();
                }
            }
        }

        // Apply state to target actor if spell has apply_state
        if (spellEffect.apply_state) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const statesData = this.engine.globalStates;
                if (statesData?.[spellEffect.apply_state]) {
                    target.applyState(spellEffect.apply_state, statesData[spellEffect.apply_state]);
                    this.engine.inputManager?.showMessage(`${target.getNameWithArticle(true)} is affected!`);
                }
            }
        }

        // Remove all states from target
        if (spellEffect.remove_states) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const stateNames = Object.keys(target.states || {});
                for (const sn of stateNames) {
                    target.removeState(sn, true);
                }
                if (stateNames.length > 0) {
                    this.engine.inputManager?.showMessage(`${target.getNameWithArticle(true)}'s enchantments are stripped away!`);
                }
            }
        }

        // Teleport target to random walkable tile
        if (spellEffect.teleport_target) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const walkable = this.engine.mapManager?.walkableTiles;
                if (walkable?.length) {
                    const candidates = walkable.filter(t => !entityManager.getSolidActorAt(t.x, t.y));
                    if (candidates.length > 0) {
                        const dest = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
                        target.x = dest.x;
                        target.y = dest.y;
                        target.updateSpritePosition();
                        this.engine.lightingManager?.computeLighting();
                        this.engine.inputManager?.showMessage(`${target.getNameWithArticle(true)} vanishes!`);
                    }
                }
            }
        }

        // Pull target toward caster
        if (spellEffect.beckon_target) {
            const target = entityManager.getSolidActorAt(x, y);
            if (target && target !== caster && !target.isDead) {
                const dx = Math.sign(caster.x - target.x);
                const dy = Math.sign(caster.y - target.y);
                let moved = false;
                // Pull target tile by tile toward caster
                for (let i = 0; i < 20; i++) {
                    const nx = target.x + dx;
                    const ny = target.y + dy;
                    if (nx === caster.x && ny === caster.y) break;
                    if (!target.isPassableAt(nx, ny)) break;
                    target.x = nx;
                    target.y = ny;
                    moved = true;
                }
                if (moved) {
                    target.updateSpritePosition();
                    this.engine.playSound?.('push1');
                    this.engine.inputManager?.showMessage(`${target.getNameWithArticle(true)} is pulled toward you!`);
                }
            }
        }

        // Blink caster to target tile (fall back to last walkable tile along the path)
        if (spellEffect.blink_self) {
            const blinkPath = getLinePath(caster.x, caster.y, landingPoint.x, landingPoint.y);
            let blinkDest = null;
            for (let i = blinkPath.length - 1; i >= 1; i--) {
                const p = blinkPath[i];
                if (caster.hasFloorAt(p.x, p.y) && !entityManager.getSolidActorAt(p.x, p.y)) {
                    blinkDest = p;
                    break;
                }
            }
            if (blinkDest) {
                caster.x = blinkDest.x;
                caster.y = blinkDest.y;
                caster.updateSpritePosition();
                this.engine.lightingManager?.computeLighting();
                if (caster.isPlayerControlled()) {
                    this.engine.renderer?.centerViewportOnPlayer?.();
                }
                this.engine.renderer?.effectRunner?.apply('blink');
            } else {
                this.engine.inputManager?.showMessage('You cannot blink there.');
            }
        }

        // Identify the item after successful cast
        if (!item.identified) {
            item.identify();
            const identifiedName = item.getDisplayName ? item.getDisplayName() : item.name;
            this.engine.inputManager?.showMessage(`You identified the ${identifiedName}!`);
        }

        // Show cast message
        const spellName = item.getAttribute('spell_name') || (item.getDisplayName ? item.getDisplayName() : item.name);
        this.engine.inputManager?.showMessage(`You cast ${spellName}!`);

        // Update sidebar
        this.updateSidebar();

        // This counts as a player action
        this.engine.inputManager?.onPlayerAction();
    },

    /**
     * Staff of tunneling (Brogue): bore `distance` tiles from the caster toward
     * `toward`, reducing every breakable obstruction on the line to rubble. The
     * bolt passes creatures (anything with health) harmlessly and stops at the
     * first solid thing that can't break, like a metal wall. Cleared cells get
     * floor and new walls round their edges, as the scroll of shattering does.
     * @param {Actor} caster
     * @param {{x: number, y: number}} toward - Where the bolt was aimed
     * @param {number} distance - Reach in tiles
     * @param {Item} [item] - The staff, for its `fail_message`
     */
    tunnelAlong(caster, toward, distance, item) {
        const entityManager = this.engine.entityManager;
        const dx = toward.x - caster.x;
        const dy = toward.y - caster.y;
        const span = Math.max(Math.abs(dx), Math.abs(dy));
        if (span === 0) return;
        const scale = distance / span;
        const line = getLinePath(caster.x, caster.y,
            Math.round(caster.x + dx * scale), Math.round(caster.y + dy * scale)).slice(1);

        const cleared = [];
        for (const cell of line) {
            if (getChebyshevDistance(caster.x, caster.y, cell.x, cell.y) > distance) break;
            const blocker = entityManager.getSolidActorAt(cell.x, cell.y);
            if (!blocker || blocker.isDead || blocker.stats?.health !== undefined) continue;
            if (!blocker.hasAttribute('breakable')) break;
            blocker.die();
            cleared.push(cell);
        }

        if (cleared.length === 0) {
            const failure = 'The bolt splashes harmlessly against the stone.';
            this.engine.inputManager?.showMessage(item?.getEffectMessage('fail_message', failure) ?? failure);
            return;
        }
        entityManager.revealDugArea(cleared);
        this.engine.renderer?.effectRunner?.apply('shatter', caster);
    },

    /**
     * Spawn `actorId` over the open ground where a bolt stopped: a flood from the
     * last tile on the path with no solid actor, out to `radius`, through floor
     * tiles no solid actor holds. Walls and creatures stop the flood rather than
     * being filled over.
     * @param {string} actorId - Actor to spawn on each tile
     * @param {number} radius - Euclidean reach from the center
     * @param {Actor} caster - Never filled over
     * @param {Array<{x: number, y: number}>} path - The bolt's path, caster excluded
     */
    fillOpenGround(actorId, radius, caster, path) {
        const entityManager = this.engine.entityManager;
        const floorMap = this.engine.mapManager?.floorMap;
        const isOpen = (x, y) => {
            if (x === caster.x && y === caster.y) return false;
            const tile = floorMap?.[y]?.[x];
            return !!tile && tile.tileId > 0 && !entityManager.getSolidActorAt(x, y);
        };

        let center = null;
        for (let i = path.length - 1; i >= 0 && !center; i--) {
            if (isOpen(path[i].x, path[i].y)) center = path[i];
        }
        if (!center) return;

        const seen = new Set([`${center.x},${center.y}`]);
        const queue = [center];
        while (queue.length > 0) {
            const { x, y } = queue.shift();
            entityManager.spawnActor(actorId, x, y);
            for (const dir of ALL_DIRS) {
                const nx = x + dir.dx;
                const ny = y + dir.dy;
                const key = `${nx},${ny}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (Math.hypot(nx - center.x, ny - center.y) > radius || !isOpen(nx, ny)) continue;
                queue.push({ x: nx, y: ny });
            }
        }
    },

    /**
     * Complete a bolt spell - damage every creature along the path
     * @param {Item} item - The spell item
     * @param {Actor} caster - The actor who cast it
     * @param {Array} path - Array of {x, y} points the bolt travels through
     * @param {Object} spellEffect - Effect configuration {type, bolt_damage}
     */
    completeBoltSpell(item, caster, path, spellEffect) {
        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        const damage = spellEffect.bolt_damage || -10;

        // A bounced bolt can cross the same tile twice; strike each creature once.
        // The caster is only ever on the path if the bolt came back at them.
        const struck = new Set();
        for (const point of path) {
            const actor = entityManager.getSolidActorAt(point.x, point.y);
            if (actor && !struck.has(actor) && !actor.isDead && actor.stats?.health) {
                struck.add(actor);
                actor.modifyStat('health', damage, { source: item });
                const victimName = actor === caster ? 'you' : actor.getNameWithArticle();
                this.engine.inputManager?.showMessage(
                    `The lightning bolt strikes ${victimName}!`
                );
                if (actor.getStat?.('health') <= 0) actor.die();
            }
        }

        // Identify the item after successful cast
        if (!item.identified) {
            item.identify();
            const identifiedName = item.getDisplayName ? item.getDisplayName() : item.name;
            this.engine.inputManager?.showMessage(`You identified the ${identifiedName}!`);
        }

        // Show cast message
        const spellName = item.getAttribute('spell_name') || (item.getDisplayName ? item.getDisplayName() : item.name);
        this.engine.inputManager?.showMessage(`You cast ${spellName}!`);

        // Update sidebar
        this.updateSidebar();

        // This counts as a player action
        this.engine.inputManager?.onPlayerAction();
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
