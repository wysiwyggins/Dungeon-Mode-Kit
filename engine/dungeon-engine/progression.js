/**
 * DungeonEngine methods: prototype transitions, win conditions and the game
 * win, stairway and condition locks, portal reveal.
 */

import { TILE_HEIGHT, TILE_WIDTH } from '../../core/util.js';

export const DungeonEngineProgression = {
    async transitionToPrototype(prototypeName, saveState = true, entryDirection = null, fromCutscene = false) {
        if (saveState) {
            this.prototypeStack.push({
                name: this.currentPrototype.name,
                state: this.saveGameState()
            });
        }

        this.cleanup();
        // Reset floor state when transitioning to a new prototype
        this.currentFloor = 1;
        this.floorStates.clear();
        this.pendingFallenActors.clear();
        this.pendingFallenItems.clear();
        this.pendingStairFollowers.clear();
        this.sealedDownFloors.clear();
        this.mappedFloors.clear();
        await this.loadPrototype(prototypeName, entryDirection, fromCutscene);
    },

    async returnToPreviousPrototype() {
        if (this.prototypeStack.length === 0) {
            console.warn('No previous prototype to return to');
            return;
        }

        const previous = this.prototypeStack.pop();
        this.cleanup();
        await this.loadPrototype(previous.name);
        this.restoreGameState(previous.state);
    },

    /**
     * Check if all win conditions for the current prototype are met
     * @returns {boolean} True if all win conditions are satisfied
     */
    checkWinConditions() {
        const config = this.currentPrototype?.config;
        // getFloorConfig returns the root config for a flat prototype, and the
        // resolved floor (override, biome, root) for a levels or floor_plan one.
        const floorConfig = config ? this.getFloorConfig(this.currentFloor) : null;
        const winConditions = floorConfig?.win_conditions || [];

        // No conditions = always unlocked
        if (winConditions.length === 0) return true;

        const player = this.entityManager?.player;
        if (!player) return false;

        for (const condition of winConditions) {
            if (!this.checkWinCondition(condition, player)) {
                return false;
            }
        }

        return true;
    },

    /**
     * Check prototype-level (game-win) conditions, distinct from the per-floor
     * win_conditions that govern stairway unlock. Reuses checkWinCondition().
     * Returns false when no win_state is declared, so prototypes without it never win
     * the game.
     */
    checkPrototypeWinConditions() {
        const conditions = this.currentPrototype?.config?.win_state?.conditions;
        if (!Array.isArray(conditions) || conditions.length === 0) return false;
        const player = this.entityManager?.player;
        if (!player) return false;
        return conditions.every(c => this.checkWinCondition(c, player));
    },

    /**
     * Fire the game-win once, if the prototype's win conditions hold and there's
     * nowhere left to go. A prototype with next_level flows onward (handled by the
     * stairway path), so it never triggers a terminal win here.
     */
    maybeTriggerGameWin() {
        if (this.gameWon) return;
        // A win is only ever achieved through play — never let a condition that happens
        // to be satisfied during the silent load sequence (e.g. equipping default items
        // before the target actor has spawned) fire the win screen.
        if (!this.gameplayStarted) return;
        if (this.currentPrototype?.config?.next_level) return;
        // An escape-style win is triggered deliberately by using the exit (see the
        // locked-stairway bump path), not the instant the condition becomes true —
        // otherwise picking up the amulet would win before the player climbs back out.
        if (this.currentPrototype?.config?.win_state?.via === 'escape') return;
        if (!this.checkPrototypeWinConditions()) return;
        this.triggerGameWin();
    },

    /** Terminal: lock out play and render the win screen. Idempotent via gameWon. */
    triggerGameWin() {
        if (this.gameWon) return;
        this.gameWon = true;
        this.gameOver = true;
        this.turnEngine?.lock();
        this.inputManager?.disable();

        const cfg = this.currentPrototype?.config;
        const displayName = cfg?.name || this.currentPrototype?.name || 'the dungeon';
        const lines = this.buildWinScreenLines(cfg, displayName);
        this.renderer?.showWinScreen(this.viewportWidth, this.viewportHeight, lines);
    },

    buildWinScreenLines(cfg, displayName) {
        const lines = [];
        lines.push(cfg?.win_state?.message || `You have completed ${displayName}`);
        // FUTURE: lines.push(`Kills: ${...}`); lines.push(`Gold: ${...}`);
        return lines;
    },

    /**
     * True if the given floor is the "escape exit" floor of an escape-style win_state
     * (e.g. the dungeon: carry the amulet back up to floor 1 and out). The exit floor
     * defaults to 1. Returns false for any prototype without win_state.via === 'escape'.
     */
    isEscapeExitFloor(floor) {
        const ws = this.currentPrototype?.config?.win_state;
        return ws?.via === 'escape' && floor === (ws.exit_floor ?? 1);
    },

    /** True if `actor` is the up-stairway escape exit on the current escape-exit floor. */
    isEscapeExitActor(actor) {
        return this.isEscapeExitFloor(this.currentFloor) &&
               actor?.getAttribute?.('stairway') === 'up';
    },

    /**
     * Check a single win condition
     * @param {string|object} condition - The condition to check
     * @param {Actor} player - The player actor
     * @param {Actor} [lock] - A condition-locked actor being evaluated (see
     *   refreshConditionLocks). Enables `killed:linked` and the lock's kill latch.
     * @returns {boolean} True if condition is met
     */
    checkWinCondition(condition, player, lock = null) {
        if (typeof condition === 'string') {
            // A lock's `killed:` conditions only count once a living match has been
            // seen, latched on the lock itself (it serializes with the floor). Without
            // it a door whose foe never spawned would pop open, and on a revisited
            // floor — where the dead aren't restored — a satisfied kill would read as
            // "never existed" and re-lock the door.
            if (lock && condition.startsWith('killed:')) {
                const operand = condition.substring(7);
                let alive;
                if (operand === 'linked') {
                    const machineId = lock.getAttribute('machine_id');
                    if (!machineId) {
                        console.warn(`${lock.name}: "killed:linked" needs a machine_id`);
                        return false;
                    }
                    alive = this.entityManager.actors.some(a =>
                        a !== lock && !a.isDead && a.getAttribute('machine_id') === machineId
                    );
                } else {
                    alive = this.entityManager.actors.some(a =>
                        a.type === operand && !a.isDead
                    );
                }
                const seen = lock.getAttribute('unlock_seen') || [];
                if (alive) {
                    if (!seen.includes(condition)) lock.setAttribute('unlock_seen', [...seen, condition]);
                    return false;
                }
                return seen.includes(condition);
            }

            // Format: "wearing:item_type" - player must have item equipped
            if (condition.startsWith('wearing:')) {
                const itemType = condition.substring(8);
                return player.inventory.some(item =>
                    item.type === itemType && player.isItemEquipped(item)
                );
            }
            // Format: "holding:item_type" - player must have item in inventory
            if (condition.startsWith('holding:')) {
                const itemType = condition.substring(8);
                return player.inventory.some(item => item.type === itemType);
            }
            // Format: "killed:actor_type" - all actors of type must be dead
            if (condition.startsWith('killed:')) {
                const actorType = condition.substring(7);
                return !this.entityManager.actors.some(actor =>
                    actor.type === actorType && !actor.isDead
                );
            }
            // Format: "collected:item_type" - no item of that type may remain on the
            // floor. The item mirror of `killed:`: pickup removes the item from
            // entityManager.items, so the last one taken satisfies this.
            //
            // Guarded against the empty case, which `killed:` doesn't need — a floor
            // where the type never spawned would otherwise read as "all collected"
            // and win instantly. Requires at least one to have existed.
            if (condition.startsWith('collected:')) {
                const itemType = condition.substring(10);
                if (!this.entityManager.spawnedItemTypes?.has(itemType)) return false;
                return !this.entityManager.items.some(item => item.type === itemType);
            }
        }

        if (typeof condition === 'object') {
            const { actor: actorTarget, stat, treasure, op, value } = condition;
            if ((stat || treasure) && op !== undefined && value !== undefined) {
                let target;
                if (actorTarget === 'player') {
                    target = player;
                } else if (actorTarget) {
                    target = this.entityManager.actors.find(
                        a => a.type === actorTarget && !a.isDead
                    );
                } else {
                    target = player;
                }
                if (!target) return false;
                let current;
                if (treasure) {
                    // Sum of the named treasure totals: one name or an array of them.
                    const tally = target.getAttribute('treasure_tally') || {};
                    current = [].concat(treasure).reduce((sum, name) => sum + (tally[name] || 0), 0);
                } else {
                    current = target.stats?.[stat]?.current ?? target.getAttribute(stat);
                }
                if (current === undefined || current === null) return false;
                switch (op) {
                    case '>':  return current > value;
                    case '>=': return current >= value;
                    case '<':  return current < value;
                    case '<=': return current <= value;
                    case '==': return current == value;
                    case '!=': return current != value;
                }
            }
        }

        console.warn(`Unknown win condition: ${condition}`);
        return false;
    },

    /**
     * Apply a locked/unlocked state to a single live stairway actor
     * works for both the floor's own down-stairway and a paired up-stairway.
     */
    applyStairwayLockState(stairway, locked) {
        if (locked) {
            stairway.setAttribute('locked', true);
            stairway.setAttribute('open', false);
            stairway.setAttribute('solid', true);
            stairway.setAttribute('collision_description', 'The stairs are sealed. You must fulfill your quest first.');
            stairway.name = 'Sealed Stairs';

            // Update tiles back to locked appearance
            if (stairway.tileIndexBase && stairway.spriteBase) {
                const tileset = PIXI.Loader.shared.resources.tiles;
                const rect = new PIXI.Rectangle(
                    stairway.tileIndexBase.x * TILE_WIDTH,
                    stairway.tileIndexBase.y * TILE_HEIGHT,
                    TILE_WIDTH,
                    TILE_HEIGHT
                );
                stairway.spriteBase.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
            }
        } else {
            stairway.setAttribute('locked', false);
            stairway.setAttribute('collision_description', null);
            stairway.open(); // swaps to *_open sprite; safe now that locked=false
            stairway.name = stairway.getAttribute('stairway') === 'up' ? 'Stairs Up' : 'Stairs Down';
        }
    },

    /**
     * Reconcile the current floor's up-stairway lock state against the seal tracker.
     * The up-stairway leads up to the previous floor, so it must be locked if that floor's
     * down-way is sealed. Called on every floor entry (fresh load and restore) so a cached
     * floor whose paired seal changed while the player was away gets corrected — including
     * the sprite, which a deserialized open stairway would otherwise render as locked.
     */
    reconcileUpStairwayLock() {
        const up = this.entityManager?.findActorByAttribute('stairway', 'up');
        if (!up) return;

        // The escape exit is gated by the prototype win_state, not the floor seal tracker.
        if (up.hasAttribute('escape_exit') || this.isEscapeExitActor(up)) {
            this.makeEscapeExit(up);
            return;
        }

        // A top floor with no previous_level has no floor below to pair with, so the
        // seal tracker isn't authoritative for its up-stairway — leave an authored
        // locked state (a dead-end seal) intact. Mirrors ensureUpStairway()'s guard.
        const isTopFloor = this.getTotalFloors() <= 1 || this.currentFloor === 1;
        if (isTopFloor && !this.currentPrototype?.config?.previous_level) return;

        const shouldLock = this.isFloorDownSealed(this.currentFloor - 1);
        const isLocked = !!up.getAttribute('locked');
        if (shouldLock !== isLocked) {
            this.applyStairwayLockState(up, shouldLock);
        }
    },

    /**
     * Unlock all locked stairways when win conditions are met
     * This is called when a win condition is triggered (e.g., equipping an item)
     */
    unlockWinConditionStairways() {
        const stairways = this.entityManager?.actors.filter(actor =>
            actor.hasAttribute('stairway') && actor.hasAttribute('locked') &&
            !actor.hasAttribute('escape_exit')
        );

        if (stairways && stairways.length > 0) {
            for (const stairway of stairways) {
                this.applyStairwayLockState(stairway, false);
            }

            this.playSound?.('lock');
            this.inputManager?.showMessage('The way forward is now open!', { style: 'discovery' });
        }

        // This floor's down-way is now open; record it and unlock the paired
        // up-stairway on the floor below's destination (floor N+1). N+1 is never the
        // current floor here (the player is on N), so it's reconciled from the tracker
        // the next time N+1 is entered — see reconcileUpStairwayLock().
        this.sealedDownFloors.delete(this.currentFloor);

        this.setPortalsRevealed(true);
    },

    /**
     * Re-evaluate every actor carrying `unlock_conditions` (doors, chests — any
     * openable lock) and lock or unlock it to match. Same vocabulary as
     * win_conditions, plus `killed:linked` (every other actor sharing the lock's
     * machine_id is dead). Unlocking leaves the actor closed for the player to bump
     * open; re-locking closes it, deferred while something stands in the doorway.
     * Called from the same hooks as checkWinConditions, and on floor entry.
     */
    refreshConditionLocks() {
        const actors = this.entityManager?.actors;
        if (!actors) return;
        const player = this.entityManager.player;
        let changed = false;

        for (const lock of actors) {
            const conds = lock.getAttribute('unlock_conditions');
            if (!Array.isArray(conds) || conds.length === 0 || lock.isDead) continue;

            // Evaluate even during load so kill latches are seeded, but only flip
            // state once play has begun (load-time equips mustn't emit feedback).
            // map before every: each condition must run so every kill latch seeds,
            // not just those before the first unmet condition.
            const met = !!player && conds.map(c => this.checkWinCondition(c, player, lock)).every(Boolean);
            if (!this.gameplayStarted) continue;

            const locked = !!lock.getAttribute('locked');
            if (met && locked) {
                lock.setAttribute('locked', false);
                this.pendingConditionRelocks.delete(lock);
                this.playSound?.('lock');
                const visible = this.isTileVisible(lock.x, lock.y);
                const msg = lock.getAttribute('unlock_message') ||
                    (visible ? `${lock.getNameWithArticle(true)} unlocks.` : 'You hear a distant click.');
                this.inputManager?.showMessage(msg, { style: 'discovery' });
                changed = true;
            } else if (!met && !locked) {
                lock.setAttribute('locked', true);
                if (lock.hasAttribute('open')) {
                    if (this.isLockTileClear(lock)) lock.close(true);
                    else this.pendingConditionRelocks.add(lock);
                }
                changed = true;
            }
        }

        if (changed) this.updateLighting();
    },

    /**
     * Close re-locked doors that were held open by an occupant once their tile
     * clears. Called at the top of each player turn.
     */
    closePendingConditionLocks() {
        if (this.pendingConditionRelocks.size === 0) return;
        let closed = false;
        for (const lock of this.pendingConditionRelocks) {
            // Unlocked again, already shut, or left behind on another floor.
            if (lock.isDead || !lock.getAttribute('locked') || !lock.hasAttribute('open') ||
                !this.entityManager.actors.includes(lock)) {
                this.pendingConditionRelocks.delete(lock);
                continue;
            }
            if (this.isLockTileClear(lock)) {
                lock.close(true);
                this.pendingConditionRelocks.delete(lock);
                closed = true;
            }
        }
        if (closed) this.updateLighting();
    },

    /** True if nothing but the lock itself occupies its tile (safe to swing shut). */
    isLockTileClear(lock) {
        const em = this.entityManager;
        if (em.getActorsAt(lock.x, lock.y).some(a => a !== lock && !a.isDead)) return false;
        return !em.items.some(i => i.x === lock.x && i.y === lock.y);
    },

    /**
     * Lock stairways when win conditions are no longer met
     * This is called when a win condition is broken (e.g., unequipping an item)
     */
    lockWinConditionStairways() {
        // Find stairways that were unlocked (have openable attribute and are open)
        const stairways = this.entityManager?.actors.filter(actor =>
            actor.hasAttribute('stairway') &&
            actor.hasAttribute('openable') &&
            actor.hasAttribute('open') &&
            !actor.hasAttribute('escape_exit')
        );

        if (!stairways || stairways.length === 0) {
            // No live unlocked stairway to re-seal (e.g. it was never opened), but the
            // current floor's win condition is broken — still record the seal so the
            // paired up-stairway on N+1 re-locks on next entry.
            this.sealedDownFloors.add(this.currentFloor);
            return;
        }

        for (const stairway of stairways) {
            this.applyStairwayLockState(stairway, true);
        }

        // This floor's down-way is sealed again; record it so the paired up-stairway on
        // floor N+1 re-locks the next time N+1 is entered (see reconcileUpStairwayLock()).
        this.sealedDownFloors.add(this.currentFloor);

        this.setPortalsRevealed(false);

        this.inputManager?.showMessage('The way forward is sealed once more.', { style: 'warning' });
    },

    /**
     * Show or hide this floor's portals. A portal is placed hidden and only
     * appears once the last floor's win conditions hold; breaking a condition
     * hides it again, the same way a stairway re-seals.
     * @param {boolean} revealed
     */
    setPortalsRevealed(revealed) {
        const portals = this.entityManager?.actors.filter(a => a.hasAttribute('portal'));
        if (!portals?.length) return;

        for (const portal of portals) {
            portal.setAttribute('visible', revealed);
            portal.setAttribute('hidden', !revealed);
            if (portal.spriteBase) portal.spriteBase.visible = revealed;
            if (portal.spriteTop) portal.spriteTop.visible = revealed;
        }

        if (!revealed) return;

        this.playSound?.('magic');
        this.inputManager?.showMessage('A portal has appeared!', { style: 'discovery' });
        this.renderer?.effectRunner?.apply('portal_reveal');
    },
};
