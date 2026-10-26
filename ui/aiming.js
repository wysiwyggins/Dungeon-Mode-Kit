/**
 * InterfaceManager methods: aim targets (seeding and cycling), the spike and
 * dig direction pickers, and firing a launcher.
 */

import { ALL_DIRS } from '../core/util.js';
import { collectAimTargets, getAimTargetTokens } from '../input.js';
import { SPELL_DEFAULT_TARGETS, THROW_DEFAULT_TARGETS } from './interface-manager.js';

export const UIAiming = {
    /**
     * Clear targeting highlights (walk path, line path, tile highlight)
     * Called when opening UI boxes to avoid visual clutter
     */
    clearTargetingHighlights() {
        this.engine.renderer?.hideWalkPath();
        this.engine.renderer?.hideLinePath();
        this.engine.renderer?.hideTileHighlight();
    },

    // ========================================================================
    // AIM TARGETING (shared by throw and spell aiming)
    // ========================================================================

    /**
     * Which item is currently being aimed, and what it targets by default.
     * Throwing offers traps as well as enemies so a thrown object can spring one
     * from a safe distance; a zap is enemies-only unless the item says otherwise.
     * @returns {{item: Object, defaults: string[], origin: Object}|null}
     */
    getAimContext() {
        if (this.throwAimingMode) {
            return {
                item: this.throwItem,
                defaults: THROW_DEFAULT_TARGETS,
                origin: this.engine.entityManager?.player
            };
        }
        if (this.spellAimingMode) {
            return {
                item: this.spellItem,
                defaults: SPELL_DEFAULT_TARGETS,
                origin: this.spellCaster
            };
        }
        return null;
    },

    /**
     * Aim at a target by writing its position into hoveredTile.
     *
     * Both aiming modes read their target solely from inputManager.hoveredTile, so
     * pointing them somewhere is just a matter of setting it. A later mouse move
     * overwrites this, which is intended — the mouse always wins.
     *
     * @param {{x: number, y: number}} target - The chosen target
     */
    applyAimTarget(target) {
        const inputManager = this.engine.inputManager;
        if (!inputManager || !target) return;
        inputManager.hoveredTile.x = target.x;
        inputManager.hoveredTile.y = target.y;
    },

    /**
     * Point at the nearest valid target when an aiming mode opens.
     * @param {string[]} defaults - Fallback tokens when the item declares no target_filter
     * @returns {Object|null} The seeded target, or null if there was nothing to aim at
     */
    seedAimTarget(defaults) {
        const ctx = this.getAimContext();
        if (!ctx) return null;

        const tokens = getAimTargetTokens(ctx.item, defaults);
        const targets = collectAimTargets(this.engine, tokens, ctx.origin);
        if (targets.length === 0) return null;

        this.aimTargets = targets;
        this.aimTargetIndex = 0;
        this.applyAimTarget(targets[0]);
        return targets[0];
    },

    /**
     * Advance to the next target, wrapping around. Rebuilds the candidate list each
     * press so a target that died or walked out of sight since the last press drops
     * out, matching how cycleTarget handles travel targets.
     *
     * @returns {boolean} True if a target was selected
     */
    cycleAimTarget() {
        const ctx = this.getAimContext();
        if (!ctx) return false;

        const tokens = getAimTargetTokens(ctx.item, ctx.defaults);
        const targets = collectAimTargets(this.engine, tokens, ctx.origin);
        if (targets.length === 0) {
            this.engine.inputManager?.showMessage('No targets in view.');
            return false;
        }

        // Keep the cycle anchored to the actor we were last pointing at, so a list
        // that reordered (something moved closer) doesn't jump us back to the start.
        const current = this.aimTargets?.[this.aimTargetIndex]?.entity;
        const resumeAt = current ? targets.findIndex(t => t.entity === current) : -1;
        const index = (resumeAt >= 0 ? resumeAt + 1 : 0) % targets.length;

        this.aimTargets = targets;
        this.aimTargetIndex = index;
        this.applyAimTarget(targets[index]);

        // Redraw through the mode's own path renderer.
        if (this.throwAimingMode) this.updateThrowPath();
        else if (this.spellAimingMode) this.updateSpellPath();

        this.announceAimTarget(targets[index]);
        return true;
    },

    /**
     * Report the current aim target and its position in the cycle.
     * @param {Object} target - The selected target
     */
    announceAimTarget(target) {
        const total = this.aimTargets?.length || 1;
        // Tile targets carry no entity — name the spot instead of saying "target".
        const label = target.entity?.name || `spot (${target.x}, ${target.y})`;
        this.engine.inputManager?.showMessage(`Target: ${label} (${this.aimTargetIndex + 1}/${total})`);
    },

    /**
     * Was this key press the "cycle target" action?
     *
     * Resolved through the keymap rather than compared to a literal, so a player who
     * rebinds target cycling off Tab still gets it inside the aiming modes.
     *
     * @param {KeyboardEvent} [event] - The raw keydown event
     * @returns {boolean}
     */
    isCycleTargetKey(event) {
        if (!event) return false;
        return this.engine.inputManager?.getActionForKey(event) === 'cycle_target';
    },

    /**
     * Was this key press the "confirm target" action? (Enter by default.)
     *
     * The keyboard equivalent of clicking the aimed tile, so a throw or a zap can be
     * completed without reaching for the mouse. Resolved through the keymap for the
     * same reason as isCycleTargetKey — the binding is the player's to change.
     *
     * @param {KeyboardEvent} [event] - The raw keydown event
     * @returns {boolean}
     */
    isConfirmTargetKey(event) {
        if (!event) return false;
        return this.engine.inputManager?.getActionForKey(event) === 'confirm_target';
    },

    // ========================================================================
    // SPIKE DIRECTION PICKER (J key / Jam use_verb)
    // ========================================================================

    enterSpikeDirectionMode(item, caster) {
        const dirs = [
            { dx: 0, dy: -1, name: 'north' },
            { dx: 0, dy: 1, name: 'south' },
            { dx: -1, dy: 0, name: 'west' },
            { dx: 1, dy: 0, name: 'east' }
        ];

        const adjacentDoors = [];
        for (const dir of dirs) {
            const tx = caster.x + dir.dx;
            const ty = caster.y + dir.dy;
            const actors = this.engine.entityManager.getActorsAt(tx, ty);
            for (const actor of actors) {
                // `hidden` first: an undiscovered secret door satisfies every other
                // condition here, so without it the picker offers a door the player
                // has no reason to know exists — and with only one neighbour it
                // silently auto-spikes it, spending a spike on an invisible door.
                if (actor.hasAttribute('openable') &&
                    !actor.hasAttribute('hidden') &&
                    !actor.hasAttribute('open') &&
                    !actor.hasAttribute('locked') &&
                    !actor.hasAttribute('spiked')) {
                    adjacentDoors.push({ actor, dir });
                }
            }
        }

        if (adjacentDoors.length === 0) {
            this.engine.inputManager?.showMessage('There is nothing here to spike.');
            return;
        }

        if (adjacentDoors.length === 1) {
            this.applySpikeToDirection(item, caster, adjacentDoors[0]);
            return;
        }

        this.spikeDirectionMode = true;
        this.spikeItem = item;
        this.spikeCaster = caster;
        this.spikeAdjacentDoors = adjacentDoors;

        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        this.showTextBox('spike_instructions',
            'Spike which door? (movement keys, Esc to cancel)',
            { dismissOnMove: false }
        );
    },

    applySpikeToDirection(item, caster, doorInfo) {
        this.exitSpikeDirectionMode();

        const success = doorInfo.actor.spike();
        if (success) {
            if (item.count > 1) {
                item.count--;
            } else {
                caster.inventory = caster.inventory.filter(i => i !== item);
            }
            this.engine.inputManager?.onPlayerAction();
        }
    },

    exitSpikeDirectionMode() {
        this.spikeDirectionMode = false;
        this.spikeItem = null;
        this.spikeCaster = null;
        this.spikeAdjacentDoors = null;
        this.removeTextBox('spike_instructions');
    },

    handleSpikeDirectionKey(key) {
        if (!this.spikeDirectionMode) return false;

        if (key === 'Escape') {
            this.exitSpikeDirectionMode();
            return true;
        }

        // Resolve through the player's actual movement bindings rather than a private
        // copy, so rebinding movement in keybindings.json steers this prompt too.
        const inputMgr = this.engine.inputManager;
        const action = inputMgr?.keyMap?.[key];
        const dir = action ? inputMgr.directions?.[action] : null;
        if (!dir) return true;

        const match = this.spikeAdjacentDoors?.find(
            d => d.dir.dx === dir.dx && d.dir.dy === dir.dy
        );

        if (match) {
            this.applySpikeToDirection(this.spikeItem, this.spikeCaster, match);
        } else {
            this.engine.inputManager?.showMessage("There's no door in that direction.");
        }

        return true;
    },

    handleSpikeDirectionClick() {
        if (!this.spikeDirectionMode || !this.spikeCaster) return false;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return false;

        const tx = inputManager.hoveredTile.x;
        const ty = inputManager.hoveredTile.y;

        const match = this.spikeAdjacentDoors?.find(
            d => d.actor.x === tx && d.actor.y === ty
        );

        if (match) {
            this.applySpikeToDirection(this.spikeItem, this.spikeCaster, match);
        }

        return true;
    },

    // ========================================================================
    // DIG DIRECTION PICKER (Dig use_verb)
    // ========================================================================

    /**
     * Pick a target for the Dig verb: any `breakable` within one tile, including the
     * tile the digger is standing on (a grave is walkable, so standing on it is the
     * common case) and including solid walls, which the verb digs exactly as bumping
     * them while equipped would.
     *
     * The tool comes from the inventory, not the equipment slot — you can dig with a
     * mattock you're only carrying. Equipping it is still what lets you bump walls and
     * swing it at enemies; this is the deliberate, one-target use.
     *
     * The dig itself is just applyCollisionEffects, the same call behaviors/ai.js
     * `mine_nearby_wall` uses, so the whole mining pipeline (glance roll, progress,
     * tool wear, loot on break) comes along unchanged.
     */
    enterDigDirectionMode(item, caster) {
        if (!caster) return;

        const candidates = [];
        // The digger's own tile first, so a lone diggable underfoot needs no prompt.
        const cells = [{ dx: 0, dy: 0 }, ...ALL_DIRS];
        for (const dir of cells) {
            const tx = caster.x + dir.dx;
            const ty = caster.y + dir.dy;
            const actors = this.engine.entityManager.getActorsAt(tx, ty);
            for (const actor of actors) {
                if (actor === caster || actor.isDead) continue;
                if (!actor.hasAttribute('breakable')) continue;
                candidates.push({ actor, dir });
            }
        }

        if (candidates.length === 0) {
            this.engine.inputManager?.showMessage('There is nothing here to dig.');
            return;
        }

        if (candidates.length === 1) {
            this.applyDigToDirection(item, caster, candidates[0]);
            return;
        }

        this.digDirectionMode = true;
        this.digItem = item;
        this.digCaster = caster;
        this.digCandidates = candidates;

        this.closeItemActionMenu();
        this.removeBox('player_info');
        this.inventoryMode = false;

        const here = candidates.some(c => c.dir.dx === 0 && c.dir.dy === 0);
        this.showTextBox('dig_instructions',
            here
                ? 'Dig where? (movement keys, wait key for here, Esc to cancel)'
                : 'Dig where? (movement keys, Esc to cancel)',
            { dismissOnMove: false }
        );
    },

    applyDigToDirection(item, caster, target) {
        this.exitDigDirectionMode();

        // Pass the tool explicitly: it may be sitting in the pack rather than the
        // equipment slot, and its own mining_power/dig_chance/condition are the ones
        // that should count. The tool isn't consumed — digging wears `condition` via
        // degradeItem inside the mining path, so there's nothing to decrement here.
        const result = caster.applyCollisionEffects(target.actor, item);
        if (result?.attackAttempted) {
            this.engine.inputManager?.onPlayerAction();
        }
    },

    exitDigDirectionMode() {
        this.digDirectionMode = false;
        this.digItem = null;
        this.digCaster = null;
        this.digCandidates = null;
        this.removeTextBox('dig_instructions');
    },

    handleDigDirectionKey(key) {
        if (!this.digDirectionMode) return false;

        if (key === 'Escape') {
            this.exitDigDirectionMode();
            return true;
        }

        // Resolve through the player's actual bindings so rebinding movement (or wait)
        // in keybindings.json steers this prompt too.
        const inputMgr = this.engine.inputManager;
        const action = inputMgr?.keyMap?.[key];
        if (!action) return true;

        // The digger's own tile has no direction key, so the wait binding selects it.
        const dir = action === 'wait'
            ? { dx: 0, dy: 0 }
            : inputMgr.directions?.[action];
        if (!dir) return true;

        const match = this.digCandidates?.find(
            c => c.dir.dx === dir.dx && c.dir.dy === dir.dy
        );

        if (match) {
            this.applyDigToDirection(this.digItem, this.digCaster, match);
        } else {
            this.engine.inputManager?.showMessage("There's nothing to dig that way.");
        }

        return true;
    },

    handleDigDirectionClick() {
        if (!this.digDirectionMode || !this.digCaster) return false;

        const inputManager = this.engine.inputManager;
        if (!inputManager) return false;

        const tx = inputManager.hoveredTile.x;
        const ty = inputManager.hoveredTile.y;

        const match = this.digCandidates?.find(
            c => c.actor.x === tx && c.actor.y === ty
        );

        if (match) {
            this.applyDigToDirection(this.digItem, this.digCaster, match);
        }

        return true;
    },

    // ========================================================================
    // THROW ITEM MENU (T key)
    // ========================================================================

    /**
     * Show a menu to select an item to throw
     * @param {Actor} player - The player actor
     */
    /**
     * Fire the wielded launcher: skip the item menu and aim the first ammo in the
     * pack that it takes. Refusals are free actions — nothing was attempted.
     * @param {Actor} player
     */
    fireLauncher(player) {
        if (!player) return;
        const launches = player.equipment?.weapon?.getAttribute('launches');
        if (!launches) {
            this.showTextBox('fire_refused', 'You have nothing to fire with.', { dismissOnMove: true });
            return;
        }
        const ammo = player.inventory.find(item => player.getLauncherFor(item));
        if (!ammo) {
            const weaponName = player.equipment.weapon.getDisplayName?.() ?? player.equipment.weapon.name;
            this.showTextBox('fire_refused', `You have no ammunition for your ${weaponName}.`, { dismissOnMove: true });
            return;
        }
        this.clearTargetingHighlights();
        this.currentPlayer = player;
        this.enterThrowAimingMode(ammo);
    },
};
