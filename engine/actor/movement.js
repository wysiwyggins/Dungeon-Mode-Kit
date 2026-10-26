/**
 * Actor methods: movement (tryMove), pushing, falling, collapsing floors,
 * dropping items, spore release, teleporters and walk-through effects.
 */

import { resolveQuarry } from '../../core/pathfinding.js';
import {
    ALL_DIRS,
    CARDINAL_DIRS,
    isDiagonalBlocked,
    resolveTemplate,
    rollRandomEffect
} from '../../core/util.js';

export const ActorMovement = {
    /**
     * Check if a tile has a floor (is not a void/pit)
     */
    hasFloorAt(x, y) {
        if (x < 0 || x >= this.engine.mapManager.width ||
            y < 0 || y >= this.engine.mapManager.height) {
            return false;
        }
        const tile = this.engine.mapManager.floorMap[y][x];
        return tile && tile.tileId;
    },

    hasPlatformAt(x, y) {
        return this.engine.entityManager.getActorsAt(x, y)
            .some(a => !a.isDead && a.hasAttribute('platform') && a.hasAttribute('visible'));
    },

    /**
     * Check if an actor can be pushed to a position
     * @param {number} x - Target X coordinate
     * @param {number} y - Target Y coordinate
     * @returns {boolean} True if position is valid for pushing
     */
    canPushTo(x, y) {
        // Check bounds
        if (x < 0 || x >= this.engine.mapManager.width ||
            y < 0 || y >= this.engine.mapManager.height) {
            return false;
        }

        // Floor check removed - pushing into voids is allowed (actor will fall)

        // No wall check needed — all walls in play are actors
        // Check for blocking actors
        const actorAt = this.engine.entityManager.getSolidActorAt(x, y);
        if (actorAt) {
            return false;
        }

        // Stairways are non-solid so actors can walk onto them, but a boulder parked
        // on one can hide it or wall off the only route between floors. Treat them as
        // push-blocking: the shove fails and the pushable stays put, same as shoving
        // it against a wall.
        const blocksPush = this.engine.entityManager.getActorsAt(x, y)
            .some(a => !a.isDead && a.hasAttribute('stairway'));
        if (blocksPush) {
            return false;
        }

        return true;
    },

    /**
     * Get valid movement directions for sighted actors
     * Filters out directions that would lead to void tiles or blocking actors
     */
    getValidMoveDirections() {
        return CARDINAL_DIRS.filter(dir => {
            const newX = this.x + dir.dx;
            const newY = this.y + dir.dy;

            // Check bounds
            if (newX < 0 || newX >= this.engine.mapManager.width ||
                newY < 0 || newY >= this.engine.mapManager.height) {
                return false;
            }

            // Check for blocking actors
            const actorAtTarget = this.engine.entityManager.getSolidActorAt(newX, newY);
            if (actorAtTarget) {
                return false;
            }

            // Check for floor tile or platform
            if (!this.hasFloorAt(newX, newY) && !this.hasPlatformAt(newX, newY)) {
                return false;
            }

            // A creature watching its step won't wander into lava or fire
            return !this.isHazardAt(newX, newY);
        });
    },

    /**
     * The launcher that would fire `item`, if any: the wielded weapon, when it
     * declares `launches` and that names the item by id or type. A bow wielded
     * with matching ammo turns a throw into a shot (Moria's rule): longer
     * `launch_range`, `launch_accuracy` added to the hit roll, and damage of
     * (ammo + bow enchantment) × `launch_multiplier`.
     * @param {Item} item - The item about to be thrown
     * @returns {Item|null}
     */
    getLauncherFor(item) {
        const weapon = this.equipment?.weapon;
        const launches = weapon?.getAttribute('launches');
        if (!item || !launches || weapon === item) return null;
        return resolveQuarry(this.engine, launches).itemIds.has(item.type) ? weapon : null;
    },

    /**
     * Is a diagonal step or swing from here to (x, y) cut off by a wall corner?
     * Movement and melee share this, so you can't attack round a corner you
     * couldn't step round. Orthogonal moves are never blocked.
     */
    isCornerBlockedTo(x, y) {
        const em = this.engine.entityManager;
        return isDiagonalBlocked(this.x, this.y, x, y, (cx, cy) => em.blocksDiagonalAt(cx, cy));
    },

    /**
     * Would stepping onto (x, y) hurt this actor? A hazard is any live actor with
     * a `damage_type` (lava, fire). Flying actors pass over it and `hazard_immune`
     * ones shrug it off. Fire spares `fireproof` actors, the attribute burning and
     * lava already check; any other type is resisted by `<type>_immune`.
     *
     * Movement doesn't consult this, only route choice, so a pushed, pulled or
     * confused actor can still end up in the lava.
     */
    isHazardAt(x, y) {
        if (this.hasStateProperty('flying') || this.hasAttribute('hazard_immune')) return false;
        return this.engine.entityManager.getActorsAt(x, y).some(a => {
            if (a === this || a.isDead) return false;
            const type = a.getAttribute('damage_type');
            if (!type) return false;
            if (type === 'fire' && this.hasAttribute('fireproof')) return false;
            return !this.hasAttribute(`${type}_immune`);
        });
    },

    /**
     * Drop through ground an `opens_floor` actor (descent vapor) has opened.
     * Does nothing for a flier, or where there's no floor below — the vapor
     * can't open the bottom floor. The player's fall waits a beat behind a lock,
     * as a collapsing bridge's does, so the turn can't run on mid-transition.
     * @returns {boolean} Whether a fall began
     */
    dropThroughOpenedFloor() {
        if (this._falling || this.isDead || this.hasStateProperty('flying')) return false;
        if (!this.engine.hasFloorBelow()) return false;

        if (!this.isPlayerControlled()) {
            this.fall('descent');
            return true;
        }
        this.engine.turnEngine?.lock();
        this.engine.inputManager?.disable();
        this.engine.inputManager?.showMessage('The ground vanishes beneath you!');
        setTimeout(async () => {
            await this.fall('descent');
            this.engine.turnEngine?.unlock();
            this.engine.inputManager?.enable();
        }, 300);
        return true;
    },

    /**
     * Called when actor falls into a void tile
     */
    async fall(cause = 'void') {
        // A fall can be queued more than once for the same actor: the collapse path
        // below defers via setTimeout, and turnEngine.lock() only gates the AI
        // scheduler's *next* tick, so an actor mid-move can step onto a second
        // collapsible tile and arm a second timer. Without this guard both timers
        // fire and the actor falls twice — logging its death twice and, on a
        // multi-floor prototype, pushing two copies of itself into pendingFallenActors.
        if (this._falling || this.isDead) return;
        this._falling = true;

        console.log(`${this.name} fell into the void!`);

        const totalFloors = this.engine.getTotalFloors();
        const hasFloorBelow = totalFloors > 1 && this.engine.currentFloor < totalFloors;

        if (hasFloorBelow) {
            if (this.isPlayerControlled()) {
                const fallMessage = cause === 'collapse'
                    ? `The floor gives way beneath you!`
                    : `You plunge into the depths!`;
                this.engine.inputManager?.showMessage(fallMessage);
                await this.engine.fallToNextFloor(this, cause);
                return;
            }

            // Queue non-player actor to appear on the next floor
            const targetFloor = this.engine.currentFloor + 1;
            const serialized = this.serialize();
            const fallDamage = Math.floor((this.stats?.health?.max || 30) * 0.3);
            serialized._fallDamage = fallDamage;

            if (!this.engine.pendingFallenActors.has(targetFloor)) {
                this.engine.pendingFallenActors.set(targetFloor, []);
            }
            this.engine.pendingFallenActors.get(targetFloor).push(serialized);

            if (this.hasAttribute('visible')) {
                this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} falls through!`, { x: this.x, y: this.y });
            }
            this.die(false);
            return;
        }

        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(`You plunge into the depths!`);
        } else if (this.hasAttribute('visible')) {
            this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} falls into the void.`, { x: this.x, y: this.y });
        }

        this.dropItems(true);
        this.die(false);
    },

    collapse() {
        if (this.spriteBase) this.spriteBase.visible = false;
        if (this.spriteTop) this.spriteTop.visible = false;
        this.die(false);
    },

    /**
     * Drop all inventory items when actor dies or is removed
     * @param {boolean} destroyItems - If true, items are lost (fell into void)
     */
    dropItems(destroyItems = false) {
        if (this.inventory.length === 0) return;

        // Unequip all items first
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.equipment[slot]) {
                this.unequipFromSlot(slot);
            }
        }

        if (destroyItems) {
            console.log(`${this.name}'s items were lost to the void`);
            this.inventory = [];
            return;
        }

        // Find valid floor tiles around the actor (current tile + 8 neighbors)
        const dropPositions = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const tx = this.x + dx;
                const ty = this.y + dy;
                if (this.hasFloorAt(tx, ty) || this.hasPlatformAt(tx, ty)) {
                    dropPositions.push({ x: tx, y: ty });
                }
            }
        }

        if (dropPositions.length === 0) {
            console.log(`${this.name}'s items were lost - no valid drop location`);
            this.inventory = [];
            return;
        }

        // Drop items to available positions (skip items with drop: false)
        let posIndex = 0;
        for (const item of this.inventory) {
            if (item.getAttribute('drop') === false) {
                console.log(`${item.name} was not dropped (drop: false)`);
                continue;
            }
            const pos = dropPositions[posIndex % dropPositions.length];
            item.x = pos.x;
            item.y = pos.y;
            this.engine.entityManager.addEntity(item);
            console.log(`${item.name} dropped at (${pos.x}, ${pos.y})`);
            posIndex++;
        }

        this.inventory = [];
    },

    /**
     * Puff out a small spore cloud (used when a `spore_release` actor is crushed).
     * The cloud takes a random potion-style effect (see rollRandomEffect), inherits
     * the source's tint, and is applied immediately to `this` (the trampler) — matching
     * the trap gas-release path, since spawnActor's applySpawnDamage runs before the
     * effect is set. Reuses the `spore` (cloud) actor + personality for spread/dissipation.
     * @param {Actor} source - The crushed actor supplying the cloud's color.
     * @param {number} x
     * @param {number} y
     */
    releaseSporeCloud(source, x, y) {
        const roll = rollRandomEffect(this.engine);
        const spore = this.engine.entityManager.spawnActor('spore', x, y);
        if (spore) {
            if (roll.apply_state) spore.setAttribute('apply_state', roll.apply_state);
            if (roll.collision_effect) spore.setAttribute('collision_effect', roll.collision_effect);
            // Match the spore cloud to the source's (randomized) color. cloud_spread
            // copies actor.tint to every puff it spawns, so setting the origin tint
            // colors the whole cloud. The sprites already exist (spawnActor made them
            // with the default tint), so re-tint them directly too.
            spore.tint = source.tint;
            spore.originalTint = source.tint;
            if (spore.spriteBase) spore.spriteBase.tint = source.tint;
            if (spore.spriteTop) spore.spriteTop.tint = source.tint;
            // Mark as the spreading origin so cloud_spread produces a small puff.
            spore.isCloudOrigin = true;
            spore.cloudOriginX = x;
            spore.cloudOriginY = y;
            spore.cloudLifetime = 4;
        }

        // spawnActor's applySpawnDamage ran before we set the effect, so apply the
        // rolled effect to the trampler now (matches the trap victim path).
        if (roll.apply_state) {
            this.applyAuthoredState?.(roll.apply_state);
        } else if (roll.collision_effect && this.stats) {
            for (const [stat, delta] of Object.entries(roll.collision_effect)) {
                const s = this.stats[stat];
                if (typeof s === 'object' && s.current !== undefined) {
                    const capped = Math.max(0, s.current + delta);
                    s.current = s.max !== undefined ? Math.min(s.max, capped) : capped;
                    if (stat === 'health' && s.current <= 0) this.die();
                }
            }
        }

        this.playSound('gas');
    },

    // Movement methods
    /**
     * Attempt to move to a new position
     * @param {number} newX - Target X coordinate
     * @param {number} newY - Target Y coordinate
     * @returns {{moved: boolean, actionTaken: boolean}} moved=position changed, actionTaken=turn should be consumed
     */
    tryMove(newX, newY) {
        // Hide walk path highlight when player moves
        this.engine.renderer?.hideWalkPath();

        // Check bounds
        if (newX < 0 || newX >= this.engine.mapManager.width ||
            newY < 0 || newY >= this.engine.mapManager.height) {
            return { moved: false, actionTaken: false };
        }

        // Ward gas turns back the actor types it repels: no walking or attacking into it.
        if (this.isRepelledAt(newX, newY)) {
            if (this.isPlayerControlled()) {
                this.engine.inputManager?.showMessage('Something in the air drives you back.');
            }
            return { moved: false, actionTaken: false };
        }

        // Stuck (held fast, e.g. engulfed by a jelly): each move attempt rolls to escape.
        // Success breaks free and the move proceeds this turn; failure wastes the turn.
        if (this.hasStateProperty('stuck')) {
            // Held by two things at once (webbed in quicksand): the hardest hold
            // governs, so tearing the web still leaves you in the sand.
            const chance = this.getEscapeChance();
            if (ROT.RNG.getUniform() < chance) {
                for (const [name, s] of Object.entries(this.states)) {
                    if (s.data?.stuck) this.removeState(name); // emits the break-free message
                }
                // Consumable stickers (webs) tear apart as the actor pulls free;
                // permanent hazards (quicksand) lack the flag and remain.
                for (const other of this.engine.entityManager.getActorsAt(this.x, this.y)) {
                    if (other !== this && !other.isDead && other.hasAttribute('consume_on_escape')) {
                        other.die();
                    }
                }
                // fall through to attempt the move this turn
            } else {
                if (this.isPlayerControlled()) {
                    this.engine.inputManager?.showMessage('You struggle but stay stuck.');
                }
                return { moved: false, actionTaken: true }; // failure consumes the turn
            }
        }

        // Block diagonal movement (and bump attacks) past wall corners, Brogue-style.
        // Only `blocks_diagonal` actors block — not creatures, and not open voids
        // (e.g. maze cells with no floor), so actors can cut round a void's corner.
        if (this.isCornerBlockedTo(newX, newY)) {
            return { moved: false, actionTaken: false };
        }

        // Check for blocking actors (use getSolidActorAt so non-solid actors
        // sharing a tile don't shadow the solid one)
        const actorAtTarget = this.engine.entityManager.getSolidActorAt(newX, newY);
        if (actorAtTarget) {
            // Scutigera chain members never collide with each other
            if (this._chainHead && actorAtTarget._chainHead === this._chainHead) {
                return { moved: false, actionTaken: false };
            }
            // Check if actor can be pushed (requires pusher to have strength > 0)
            const pusherStrength = this.getAttribute('strength');
            if (actorAtTarget.hasAttribute('pushable') && pusherStrength && pusherStrength > 0) {
                const dx = newX - this.x;
                const dy = newY - this.y;
                const pushX = newX + dx;
                const pushY = newY + dy;

                // Check if the push destination is valid
                const canPush = this.canPushTo(pushX, pushY);
                if (canPush) {
                    // Push the actor
                    actorAtTarget.x = pushX;
                    actorAtTarget.y = pushY;
                    actorAtTarget.updateSpritePosition();
                    this.engine.playSound(actorAtTarget.getAttribute('push_sound') || 'push1');

                    // Check if pushed into void (platforms prevent falling)
                    if (!this.hasFloorAt(pushX, pushY) && !this.hasPlatformAt(pushX, pushY)) {
                        console.log(`${this.name} pushes ${actorAtTarget.name} into the void`);
                        if (this.isPlayerControlled()) {
                            this.engine.inputManager?.showMessage(`You push ${actorAtTarget.getNameWithArticle()} into the void!`);
                        }
                        // Kill the actor (same as fall() but without duplicate message)
                        actorAtTarget.dropItems(true);
                        actorAtTarget.die(false);
                    } else {
                        console.log(`${this.name} pushes ${actorAtTarget.name}`);
                        // Show push message if player is pushing
                        if (this.isPlayerControlled()) {
                            this.engine.inputManager?.showMessage(`You push ${actorAtTarget.getNameWithArticle()}.`);
                        }

                        // A pushed actor sets off collapsible floors the same way a
                        // walking one does. The mover's own collapse check further down
                        // never sees this tile — the push returns early — so without
                        // this a boulder rolls across a collapsing floor untouched.
                        // Flying pushables (if any) hover over it, matching the walk path.
                        const pushedOnto = actorAtTarget.hasStateProperty('flying')
                            ? []
                            : this.engine.entityManager.getActorsAt(pushX, pushY)
                                .filter(a => a !== actorAtTarget && !a.isDead && a.hasAttribute('collapsible'));
                        if (pushedOnto.length > 0) {
                            this.engine.renderer?.effectRunner.apply('collapse_shake');
                            this.engine.playSound('push1');
                            setTimeout(async () => {
                                for (const platform of pushedOnto) platform.collapse();
                                if (!actorAtTarget.hasFloorAt(pushX, pushY) &&
                                    !actorAtTarget.hasPlatformAt(pushX, pushY) &&
                                    !actorAtTarget.hasStateProperty('flying')) {
                                    await new Promise(r => setTimeout(r, 400));
                                    await actorAtTarget.fall('collapse');
                                }
                            }, 300);
                        }
                    }

                    // Crush breakable items under the pushed actor
                    const crushedItem = this.engine.entityManager.getItemAt(pushX, pushY);
                    if (crushedItem && crushedItem.hasAttribute('breakable')) {
                        const breakSound = crushedItem.getAttribute('break_sound');
                        if (breakSound) this.engine.playSound(breakSound);
                        if (crushedItem.hasAttribute('explosive')) {
                            this.engine.interfaceManager?.createExplosiveCloud(crushedItem, pushX, pushY);
                            const displayName = crushedItem.getDisplayName ? crushedItem.getDisplayName() : crushedItem.name;
                            this.engine.inputManager?.showMessage(`The ${displayName} shatters!`);
                        } else {
                            const displayName = crushedItem.getDisplayName ? crushedItem.getDisplayName() : crushedItem.name;
                            this.engine.inputManager?.showMessage(`The ${displayName} is crushed!`);
                        }
                        crushedItem.die();
                    }

                    // Now move into the vacated space
                    const pushDx = newX - this.x;
                    if (pushDx > 0) this.setFacing('right');
                    else if (pushDx < 0) this.setFacing('left');
                    this.x = newX;
                    this.y = newY;
                    this.updateSpritePosition();

                    // Viewport snap check after push-move
                    if (this.isViewpoint() && this.engine.viewportEnabled) {
                        if (this.engine.snapViewportToTile(this.x, this.y)) {
                            this.engine.onSectionChange();
                        }
                    }

                    // Update lighting if needed
                    if (this.isPlayerControlled() || this.hasAttribute('light_source')) {
                        this.engine.updateLighting();
                    }

                    return { moved: true, actionTaken: true };
                }
                // Can't push - fall through to normal blocking behavior
            }

            // Check for weapon attack style (sweep, penetrate)
            const styleResult = this.resolveAttackStyle(newX, newY, newX - this.x, newY - this.y, actorAtTarget);
            if (styleResult.handled) {
                return { moved: styleResult.moved, actionTaken: styleResult.actionTaken };
            }

            // Face toward the target
            const collisionDx = newX - this.x;
            if (collisionDx > 0) this.setFacing('right');
            else if (collisionDx < 0) this.setFacing('left');

            // Apply collision effects from held items (before door check so keys can unlock doors)
            const collisionResult = this.applyCollisionEffects(actorAtTarget);

            // If collision effects made the actor passable (e.g., key unlocked door), try again
            // But don't move onto a tile where we just killed something - attack is the action
            if (collisionResult.targetPassable && !collisionResult.targetKilled) {
                // Recurse to check if we can now move
                return this.tryMove(newX, newY);
            }

            // A disguised actor must behave exactly like the wall it's pretending to
            // be. Without this, walking into a hidden door would swing it open and
            // a hidden lever would throw itself — either one hands the player the
            // secret for free and makes searching pointless. Hidden things on open
            // floor (traps, pressure plates) are deliberately exempt: they're
            // non-solid, you step *onto* them, and springing one is how they work.
            if (actorAtTarget.isDisguised?.()) {
                return { moved: false, actionTaken: false };
            }

            if (actorAtTarget.hasAttribute('pausable')) {
                actorAtTarget._paused = !actorAtTarget._paused;
                const state = actorAtTarget._paused ? 'stops' : 'resumes';
                this.engine.playSound?.('tap2');
                this.engine.inputManager?.showMessage(`${actorAtTarget.getNameWithArticle(true)} ${state} ticking.`, { x: actorAtTarget.x, y: actorAtTarget.y });
                return { moved: false, actionTaken: true };
            }

            if (actorAtTarget.hasAttribute('switchable')) {
                actorAtTarget.toggle();
                return { moved: false, actionTaken: true };
            }

            // Check if actor can be opened (doors, chests, etc.)
            if (actorAtTarget.hasAttribute('openable') && !actorAtTarget.hasAttribute('open')) {
                // Spiked doors cannot be opened — must be attacked and destroyed
                if (actorAtTarget.hasAttribute('spiked')) {
                    this.engine.playSound?.('tap1');
                    if (this.isPlayerControlled()) {
                        this.engine.inputManager?.showMessage(
                            `${actorAtTarget.getNameWithArticle(true)} is jammed shut with a spike.`
                        );
                    }
                    // feedbackShown: we already played a sound + messaged, so the
                    // input layer must not also emit its generic "bump into a wall".
                    return { moved: false, actionTaken: false, feedbackShown: true };
                }
                // Check if locked - play rejection sound and block
                if (actorAtTarget.hasAttribute('locked')) {
                    // Escape-style win: bumping the floor-1 exit while holding the
                    // amulet (prototype win conditions met) wins the game directly. This
                    // is a deliberate "use the exit" ending, distinct from the auto-fire
                    // path in maybeTriggerGameWin (which bails for via: 'escape').
                    if (this.isPlayerControlled() &&
                        this.engine.isEscapeExitActor(actorAtTarget) &&
                        this.engine.checkPrototypeWinConditions()) {
                        this.engine.triggerGameWin();
                        return { moved: false, actionTaken: true };
                    }
                    console.log(`${actorAtTarget.name} is locked`);
                    this.engine.playSound?.('plunk3');
                    if (this.isPlayerControlled()) {
                        // Prefer a context-specific rejection (e.g. the escape exit's
                        // "you need the amulet" text) over the generic locked message.
                        const lockedMsg = actorAtTarget.getAttribute('collision_description')
                            || `${actorAtTarget.getNameWithArticle(true)} is locked.`;
                        // Resolved against the actor being bumped, not the bumper.
                        this.engine.inputManager?.showMessage(
                            resolveTemplate(lockedMsg, actorAtTarget, {
                                providers: { name: () => actorAtTarget.getNameWithArticle() }
                            })
                        );
                    }
                    // feedbackShown: the plunk3 + "is locked" message above is the
                    // player's feedback; suppress the input layer's "bump into a wall".
                    return { moved: false, actionTaken: false, feedbackShown: true };
                }
                actorAtTarget.open(this);
                this.engine.updateLighting();
                // `opened` lets auto-walk/explore know this "didn't move" was just a
                // door swinging open, so they retry the same step (and pass through)
                // instead of treating it as a hard block and stopping.
                return { moved: false, actionTaken: true, opened: true };
            }

            // Check for collision_description attribute (for non-combat interactions like locked stairways)
            // Only show if no collision_effect - combat descriptions are handled by applyCollisionEffects
            if (this.isPlayerControlled() &&
                actorAtTarget.hasAttribute('collision_description') &&
                !actorAtTarget.hasAttribute('collision_effect')) {
                // Resolved against the actor being bumped, so [actor_name] is the
                // thing you walked into and [attacked_actor_name] is you. Uses the
                // same providers as the combat path: a collision_description is
                // authored once and may be reached either way, so a monkey that
                // hits you and a monkey you bump into must read the same. Supplying
                // only [name] here is what let "The [actor_name] scratches the
                // [attacked_actor_name]!" print raw.
                const bumpText = resolveTemplate(
                    actorAtTarget.getAttribute('collision_description'), actorAtTarget, {
                        providers: {
                            ...actorAtTarget._nameProviders(this),
                            name: () => actorAtTarget.getNameWithArticle()
                        }
                    });
                this.engine.inputManager?.showMessage(
                    actorAtTarget._hideAnonymousArticle(bumpText)
                );
                return { moved: false, actionTaken: true };
            }

            if (!collisionResult.attackAttempted) {
                if (this.isPlayerControlled()) {
                    // Name the thing actually blocking the move (a wall, a boulder, tall
                    // fungus, …) instead of a generic "wall". getNameWithArticle handles
                    // mass_noun / proper_named actors; lowercase it for the inline phrasing.
                    const blockerName = actorAtTarget.getNameWithArticle().toLowerCase();
                    this.engine.playSound?.('tap1');
                    this.engine.inputManager?.showMessage(`You bump into ${blockerName}.`);
                    // feedbackShown: we played the bump sound + a named message here, so the
                    // input layer must not also emit its generic "You bump into a wall".
                    return { moved: false, actionTaken: false, feedbackShown: true };
                }
            }
            // Attack attempted (hit or miss) = action taken, even though we didn't move
            return { moved: false, actionTaken: collisionResult.attackAttempted };
        }

        // Aquatic actors (eels) can't relocate onto a tile without a liquid actor —
        // they may still attack an adjacent target (handled above) but won't beach
        // themselves on dry land or lava. Attacks against the player can come from a
        // shoreline water tile without the eel leaving the water.
        if (this.hasAttribute('aquatic') &&
            !this.engine.entityManager._getLiquidActorAt(newX, newY)) {
            return { moved: false, actionTaken: false };
        }

        // Check for floor tile - if no floor, actor falls (flying actors hover above, platforms prevent falling)
        if (!this.hasFloorAt(newX, newY) && !this.hasPlatformAt(newX, newY) && !this.hasStateProperty('flying')) {
            // Move to the void tile first (so we can see them fall)
            this.x = newX;
            this.y = newY;
            this.updateSpritePosition();
            // Viewport snap check before fall
            if (this.isViewpoint() && this.engine.viewportEnabled) {
                if (this.engine.snapViewportToTile(this.x, this.y)) {
                    this.engine.onSectionChange();
                }
            }
            this.fall();
            return { moved: true, actionTaken: true }; // Move happened, actor just died
        }

        // Check for lunge attack before normal movement
        const lungeResult = this.resolveAttackStyle(newX, newY, newX - this.x, newY - this.y, null);
        if (lungeResult.handled) {
            return { moved: lungeResult.moved, actionTaken: lungeResult.actionTaken };
        }

        // Move successful - track last position for notable event detection
        this._lastPosition = { x: this.x, y: this.y };

        // Check if leaving a liquid tile — pick up its tint for wet tracks
        const liquidAtOld = this.engine.entityManager._getLiquidActorAt(this.x, this.y);
        if (liquidAtOld && liquidAtOld.tint != null) {
            this._liquidTrackTint = liquidAtOld.tint;
            this._liquidTrackSteps = 3;
            this._liquidTrackLastEntity = null;
        }

        const moveDir = this.getMovementDirection(
            { x: this.x, y: this.y }, { x: newX, y: newY }
        );

        const moveDx = newX - this.x;
        if (moveDx > 0) this.setFacing('right');
        else if (moveDx < 0) this.setFacing('left');
        this.x = newX;
        this.y = newY;
        this.updateSpritePosition();

        // Leave liquid tracks on the new tile
        if (this._liquidTrackSteps > 0) {
            const liquidAtNew = this.engine.entityManager._getLiquidActorAt(newX, newY);
            if (!liquidAtNew) {
                const em = this.engine.entityManager;
                // Update previous track segment to connect toward this tile
                if (this._liquidTrackLastEntity) {
                    em.updateLiquidTrackTile(
                        this._liquidTrackLastEntity,
                        this._liquidTrackLastEntity._trackEntryDir,
                        moveDir
                    );
                }
                const track = em.spawnLiquidTrack(
                    newX, newY, this._liquidTrackTint, moveDir, null
                );
                this._liquidTrackLastEntity = track;
                this._liquidTrackSteps--;
            }
        }

        // Viewport snap check after successful move
        if (this.isViewpoint() && this.engine.viewportEnabled) {
            if (this.engine.snapViewportToTile(this.x, this.y)) {
                this.engine.onSectionChange();
            }
        }

        // Process passive effects from inventory items (e.g., thread trail)
        this.processPassiveEffects(this._lastPosition, { x: newX, y: newY });

        // Swing self-closing doors shut behind whoever walked through. Which actors do
        // this is a design decision, so it lives in the data as `swings_shut` rather than
        // being inferred here: a plain door declares it, a door that had to be unlocked
        // (or a gate driven by a lever) simply doesn't, and stays open once opened.
        if (this._lastPosition) {
            const actorsAtOldPos = this.engine.entityManager.getActorsAt(
                this._lastPosition.x, this._lastPosition.y
            );
            let closedAny = false;
            for (const actor of actorsAtOldPos) {
                if (!actor.getAttribute('swings_shut')) continue;
                if (!actor.hasAttribute('openable') || !actor.getAttribute('open')) continue;
                if (actor.hasAttribute('spiked')) continue; // jammed open by a spike
                // Never seal another actor inside the doorway.
                if (this.engine.entityManager.getActorsAt(actor.x, actor.y)
                        .some(a => a !== actor && !a.isDead && a.hasAttribute('solid'))) {
                    continue;
                }
                actor.close(true);
                closedAny = true;
            }
            // A door closing changes what blocks sight. Movement only recomputes lighting
            // for viewpoint actors and light sources, so a monster shutting a door behind
            // itself would otherwise leave the old sightline open until something else
            // refreshed it.
            if (closedAny && !this.isViewpoint() && !this.hasAttribute('light_source')) {
                this.engine.requestLightingUpdate?.(this._lastPosition.x, this._lastPosition.y);
            }
        }

        // Check for items to pick up
        let pickedUp = false;
        const itemAtTarget = this.engine.entityManager.getItemAt(newX, newY);
        if (itemAtTarget && itemAtTarget.hasAttribute('pickupable')) {
            pickedUp = this.pickUpItem(itemAtTarget) || pickedUp;
        }

        // Check for walk descriptions (only for player-controlled actors). Entities and
        // non-solid actors both describe being stepped on: water and mud are actors, while
        // blood and rubble are entities, and either should narrate the same way. Solid
        // actors are skipped because you never end a move on top of one.
        if (this.isPlayerControlled()) {
            // Resolved against the thing being stepped on, so its own [color] or a
            // word list reads correctly. An untemplated string is returned as-is.
            const describeWalk = (entity) => this.engine.inputManager?.showMessage(
                resolveTemplate(entity.getAttribute('walk_description'), entity, {
                    providers: { name: () => entity.getNameWithArticle() }
                })
            );

            const entityAtTarget = this.engine.entityManager.getEntityAt(newX, newY);
            if (entityAtTarget && entityAtTarget.hasAttribute('walk_description')) {
                describeWalk(entityAtTarget);
            }
            for (const other of this.engine.entityManager.getActorsAt(newX, newY)) {
                if (other === this || other.isDead || other.hasAttribute('solid')) continue;
                if (!other.hasAttribute('walk_description')) continue;
                describeWalk(other);
            }
        }

        // Check for stairway and portal actors (only for player-controlled actors)
        if (this.isPlayerControlled()) {
            const actorsAtNewPos = this.engine.entityManager.getActorsAt(newX, newY);
            const stairway = actorsAtNewPos.find(a => a.hasAttribute('stairway'));
            if (stairway) {
                const direction = stairway.getAttribute('stairway');

                // Lock the turn engine to prevent further actions during transition
                if (this.engine.turnEngine) {
                    this.engine.turnEngine.lock();
                }
                this.engine.useStairway(direction);
                return { moved: true, actionTaken: true }; // Exit early, transition handles everything
            }

            // A portal is only steppable once revealed, so reaching one is proof
            // the last floor's win conditions held.
            const portal = actorsAtNewPos.find(a => a.hasAttribute('portal') && a.getAttribute('visible'));
            if (portal) {
                this.engine.turnEngine?.lock();
                this.engine.usePortal();
                return { moved: true, actionTaken: true };
            }
        }

        // Update lighting if this actor affects it. A viewpoint actor (controlled
        // player or a `pov` observer hero) drives the FOV, so its moves must
        // recompute lighting/visibility too.
        if (this.isViewpoint() || this.hasAttribute('light_source')) {
            this.engine.updateLighting();
        }

        // Check for submersion in deep liquids (flying actors hover above)
        if (!this.hasStateProperty('flying')) {
            this.updateSubmersionState();
        }

        // Stepping into a liquid puts out a burning actor — the same rule that
        // already extinguishes carried torches in submerge(), applied to the actor
        // itself. Keyed on the `liquid` attribute, so water and sewage douse but
        // lava doesn't (lava deliberately isn't a liquid — see canMoveTo). Flying
        // actors hover clear of it. removeState() kills the attached fire actor and
        // prints the state's own on_remove_message, so nothing is hardcoded here.
        if (this.states?.burning && !this.hasStateProperty('flying') &&
            this.engine.entityManager._getLiquidActorAt(newX, newY)) {
            this.removeState('burning');
        }

        // Apply walk-through effects (clouds, webs, quicksand) at destination immediately
        this.applyWalkThroughEffects(newX, newY);

        // Notify interface of player move (for dismissOnMove text boxes)
        if (this.isPlayerControlled() && this.engine.interfaceManager) {
            this.engine.interfaceManager.onPlayerMove();
        }

        // Trigger non-solid switchable actors at destination (pressure plates, etc.)
        for (const other of this.engine.entityManager.getActorsAt(newX, newY)) {
            if (other === this || other.hasAttribute('solid')) continue;
            if (other.hasAttribute('switchable') && !other.hasAttribute('toggled')) {
                other.toggle();
            }
        }

        // Walking onto a `crushable` (non-solid) actor destroys it. `crushable` is the
        // general "trampled when stepped on" attribute; `spore_release` is a separate,
        // optional add-on that makes a crushed actor also puff out a small spore cloud
        // with a random, usually-beneficial potion-style effect (see rollRandomEffect).
        for (const other of this.engine.entityManager.getActorsAt(newX, newY)) {
            if (other === this || other.isDead) continue;
            if (!other.hasAttribute('crushable')) continue;

            if (other.hasAttribute('spore_release')) {
                this.releaseSporeCloud(other, newX, newY);
                this.showMessage(`You crush ${other.getNameWithArticle()}, releasing a cloud of spores.`);
            } else {
                this.playSound('tap1');
                this.showMessage(`You crush ${other.getNameWithArticle()}.`);
            }
            this.flash?.();
            other.die();
        }

        // Collapse any collapsible platform actors at destination.
        // Flying actors hover above the floor and don't set it off (same as traps
        // and void-fall, which also skip flying actors).
        const collapsibles = this.hasStateProperty('flying')
            ? []
            : this.engine.entityManager.getActorsAt(newX, newY)
                .filter(a => a !== this && !a.isDead && a.hasAttribute('collapsible'));
        if (collapsibles.length > 0) {
            const actor = this;
            this.engine.renderer?.effectRunner.apply('collapse_shake');
            this.engine.playSound('push1');
            if (this.engine.turnEngine) this.engine.turnEngine.lock();
            // Block player input during the collapse pause so the controlled actor
            // can't move again before falling. turnEngine.lock() only gates the AI
            // scheduler; handleKeyDown is gated by inputManager.enabled. If a fall
            // happens, the floor transition re-enables input via startGameplay();
            // re-enabling below is idempotent and covers the no-fall case.
            if (actor.isPlayerControlled()) this.engine.inputManager?.disable();
            setTimeout(async () => {
                for (const other of collapsibles) {
                    other.collapse();
                }
                if (!actor.hasFloorAt(newX, newY) && !actor.hasPlatformAt(newX, newY) && !actor.hasStateProperty('flying')) {
                    await new Promise(r => setTimeout(r, 400));
                    await actor.fall('collapse');
                }
                if (actor.engine.turnEngine) actor.engine.turnEngine.unlock();
                if (actor.isPlayerControlled()) actor.engine.inputManager?.enable();
            }, 300);
            return { moved: true, actionTaken: true };
        }

        // Check for entry sound from non-solid actors at destination (for controlled actors)
        let entrySound = null;
        if (this.isPlayerControlled()) {
            const actorAtTarget = this.engine.entityManager.getOtherActorAt(newX, newY, this);
            if (actorAtTarget && !actorAtTarget.hasAttribute('solid') && actorAtTarget.hasAttribute('entry_sound')) {
                entrySound = actorAtTarget.getAttribute('entry_sound');
            }
        }

        // Auto-loot inventory from non-solid actors at destination
        const actorsHere = this.engine.entityManager.getActorsAt(newX, newY);
        for (const other of actorsHere) {
            if (other === this || other.hasAttribute('solid')) continue;
            if (other.inventory.length === 0) continue;
            const items = [...other.inventory];
            for (const item of items) {
                if (this.pickUpItem(item)) {
                    other.inventory.splice(other.inventory.indexOf(item), 1);
                    pickedUp = true;
                }
            }
            other.updateInventoryDisplay();
        }

        // Last, so everything about arriving on the pad's own tile has already run.
        this.useTeleporterAt(newX, newY);

        // `pickedUp` lets auto-explore treat grabbing loot as a natural stopping
        // point (walk to the item, pick it up, then stop so the player re-plans).
        return { moved: true, actionTaken: true, entrySound, pickedUp };
    },

    /**
     * Step-on teleport. An actor ending a move on a `teleporter` comes out at its
     * partner: another teleporter sharing its `machine_id`, or with no machine_id,
     * any other teleporter that has none. Several partners → one at random.
     *
     * Arrival is a direct relocation rather than a move, so it doesn't fire the
     * partner straight back; step off and on again to return. If something solid
     * is standing on the partner, the actor lands beside it instead.
     *
     * @returns {boolean} true if the actor was sent somewhere
     */
    useTeleporterAt(x, y) {
        const em = this.engine.entityManager;
        if (this.hasAttribute('mass_noun') || this.hasAttribute('teleporter')) return false;
        const pad = em.getActorsAt(x, y).find(a => a !== this && !a.isDead && a.hasAttribute('teleporter'));
        if (!pad) return false;

        const machineId = pad.getAttribute('machine_id') ?? null;
        const partners = em.actors.filter(a => a !== pad && !a.isDead
            && a.hasAttribute('teleporter') && (a.getAttribute('machine_id') ?? null) === machineId);
        if (partners.length === 0) return false;
        const partner = partners[Math.floor(ROT.RNG.getUniform() * partners.length)];

        const isOpen = (tx, ty) => this.hasFloorAt(tx, ty) && !em.getSolidActorAt(tx, ty);
        let dest = isOpen(partner.x, partner.y) ? { x: partner.x, y: partner.y } : null;
        for (const dir of ALL_DIRS) {
            if (dest) break;
            if (isOpen(partner.x + dir.dx, partner.y + dir.dy)) {
                dest = { x: partner.x + dir.dx, y: partner.y + dir.dy };
            }
        }

        const isPlayer = this.isPlayerControlled();
        if (!dest) {
            if (isPlayer) this.showMessage(`${pad.getNameWithArticle(true)} flickers, but nothing happens.`);
            return false;
        }

        const seenLeaving = !isPlayer && this.engine.isTileVisible?.(x, y);
        this.x = dest.x;
        this.y = dest.y;
        this.updateSpritePosition();
        this.engine.updateLighting();
        const seenArriving = !isPlayer && this.engine.isTileVisible?.(dest.x, dest.y);

        if (isPlayer || seenLeaving || seenArriving) {
            this.engine.playSound(pad.getAttribute('teleport_sound') || 'magic');
        }
        if (isPlayer) {
            this.engine.renderer?.centerViewportOnPlayer?.();
            this.engine.renderer?.effectRunner?.apply('blink');
            this.showMessage(`${pad.getNameWithArticle(true)} whisks you away.`);
        } else if (seenArriving) {
            this.engine.inputManager?.showMessage(
                `${this.getNameWithArticle(true)} appears out of ${partner.getNameWithArticle()}.`, dest);
        } else if (seenLeaving) {
            this.engine.inputManager?.showMessage(
                `${this.getNameWithArticle(true)} vanishes into ${pad.getNameWithArticle()}.`, { x, y });
        }

        this.applyWalkThroughEffects(dest.x, dest.y);
        return true;
    },

    moveBy(dx, dy) {
        return this.tryMove(this.x + dx, this.y + dy);
    },

    /**
     * Apply walk-through effects from any non-solid tile occupant (clouds, mist,
     * webs, quicksand-likes) to this actor. Called when an actor moves into a tile
     * so the occupant's collision_effect / apply_state lands immediately.
     * Solid actors use the bump/melee path (applyCollisionEffects) instead.
     * @param {number} x - X coordinate to check
     * @param {number} y - Y coordinate to check
     */
    applyWalkThroughEffects(x, y) {
        const entityManager = this.engine.entityManager;
        for (const other of entityManager.getActorsAt(x, y)) {
            if (other === this) continue;
            // Any non-solid tile occupant (clouds, mist, webs, quicksand-likes)
            // applies its collision_effect/apply_state on walk-through. Solid actors
            // use the bump/melee path (applyCollisionEffects) instead.
            if (other.hasAttribute('solid')) continue;

            // Web-immune actors (spiders) pass freely through their own webs.
            // The web is the tear-away sticky occupant (consume_on_escape);
            // quicksand and other 'stuck' hazards lack it and still grab them.
            if (this.hasAttribute('web_immune') && other.hasAttribute('consume_on_escape')) continue;

            // Descent vapor: the ground here opens under whoever steps in
            if (other.hasAttribute('opens_floor') && this.stats?.health !== undefined
                && !this.hasStateProperty('flying') && this.engine.hasFloorBelow()
                && this.engine.entityManager.openTemporaryHole(x, y, other.getAttribute('hole_turns') ?? 3)
                && this.dropThroughOpenedFloor()) return;

            // Apply collision effect (stat damage)
            const collisionEffect = other.getAttribute('collision_effect');
            if (collisionEffect && Object.keys(collisionEffect).length > 0) {
                for (const [key, value] of Object.entries(collisionEffect)) {
                    if (this.stats && this.stats[key] !== undefined) {
                        const stat = this.stats[key];
                        if (typeof stat === 'object' && stat.current !== undefined) {
                            stat.current = Math.max(0, stat.current + value);
                            if (key === 'health' && stat.current <= 0) {
                                this.die();
                            }
                        }
                    }
                }
            }

            // Apply state if specified (paralysis, confusion, etc.)
            const applyStateValue = other.getAttribute('apply_state');
            if (applyStateValue && this.applyAuthoredState) {
                this.applyAuthoredState(applyStateValue, { source: other });
            }
        }
    },
};
