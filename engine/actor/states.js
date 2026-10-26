/**
 * Actor methods: applying, removing and ticking states, state tints and
 * state-derived checks (confused, incapacitated, escape chance).
 */

import { TILE_HEIGHT, TILE_WIDTH, parseTint } from '../../core/util.js';
import { Actor } from './actor.js';

export const ActorStates = {
    /**
     * Resolve an authored `apply_state` value and apply it to this actor.
     * Returns false when the value is malformed or names an unknown state.
     *
     * @param {string|Object} value - Bare state name, or { state, duration }
     * @param {Object} [options] - Extra applyState options (e.g. source)
     * @returns {boolean} True if the state was applied
     */
    applyAuthoredState(value, options = {}) {
        const { name, duration } = Actor.parseApplyState(value);
        if (!name) return false;
        const stateData = this.engine.globalStates?.[name];
        if (!stateData) {
            console.log(`Unknown state: ${name}`);
            return false;
        }
        return this.applyState(name, stateData,
            duration !== undefined ? { ...options, duration } : options);
    },

    /**
     * Find active states that the incoming state is opposed to.
     *
     * `cancels` is a state name or array of them, authored on either side of a
     * pair. This reads it in both directions so `hasted: { cancels: "slowed" }`
     * covers both orders of application without `slowed` naming `hasted` back —
     * one declaration, no chance of the two drifting out of sync.
     *
     * @param {string} stateName - The state being applied
     * @param {Object} stateData - Its definition from states.json
     * @returns {string[]} Names of active states to remove instead of applying
     */
    _findOpposedStates(stateName, stateData) {
        const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
        const cancels = asList(stateData.cancels);
        const opposed = [];

        for (const [activeName, active] of Object.entries(this.states)) {
            if (activeName === stateName) continue;
            // Forward: the incoming state names this one. Reverse: the active
            // state named the incoming one.
            if (cancels.includes(activeName) || asList(active.data?.cancels).includes(stateName)) {
                opposed.push(activeName);
            }
        }
        return opposed;
    },

    /**
     * Apply a temporary state to this actor.
     *
     * Works on ANY actor — walls, trees, doors and fire included. Only states
     * that act on a mind (see isMindState) still require one; use
     * applyCreatureState when the caller specifically means "affect a creature."
     *
     * @param {string} stateName - The state name (e.g., 'burning', 'poisoned')
     * @param {Object} stateData - State configuration from states.json
     * @param {Object} [options] - Additional options
     * @param {number} [options.duration] - Override default duration
     * @param {Actor} [options.source] - The actor that applied this state
     * @returns {boolean} True if state was applied, false if immune or already has state
     */
    applyState(stateName, stateData, options = {}) {
        // Player-perception states (hallucinating) and states written from the
        // player's point of view (player_only) still only make sense on the
        // player-controlled actor.
        if (stateData.hallucinating || stateData.player_only) {
            if (!this.hasAttribute('controlled')) return false;
        } else if (Actor.isMindState(stateData)) {
            // Turn-altering states need something that takes turns.
            if (!this.hasAttribute('sentient') && !this.hasAttribute('controlled')) return false;
        }

        // Check immunity
        if (stateData.immunity && this.hasAttribute(stateData.immunity)) {
            return false;
        }

        // Opposed states annihilate instead of stacking. `cancels` is declared on
        // one side only (hasted cancels slowed) and read symmetrically, so a state
        // never has to know who opposes it — the pairing lives in states.json.
        // Both sides go away: drinking a speed potion while slowed leaves you
        // normal, not hasted, which is what "cancel each other out" means.
        const opposed = this._findOpposedStates(stateName, stateData);
        if (opposed.length > 0) {
            for (const name of opposed) this.removeState(name);
            // True, not false: something did happen. Callers read this return to
            // decide whether the item is consumed and identified and whether to
            // count the target as affected — a speed potion drunk while slowed
            // has done its job, and reporting failure would hand the potion back.
            return true;
        }

        let duration = options.duration ?? stateData.duration ?? 5;
        if (duration === -1) duration = Infinity;

        // Re-applying an active state extends it rather than stacking a second copy.
        if (this.states[stateName]) {
            this.states[stateName].duration = Math.max(this.states[stateName].duration, duration);
            return true;
        }

        // Create state entry
        this.states[stateName] = {
            duration: duration,
            data: stateData,
            source: options.source || null,
            // Granted as part of what this actor IS, rather than something that
            // happened to it. Read by getStateTint — see the note there.
            innate: options.innate || false,
            attachedActor: null
        };

        // Spawn attached actor if defined (e.g., fire for burning).
        // Bypass fire dedupe so the state gets its own dedicated fire that follows
        // the victim, rather than commandeering a ground fire already on the tile.
        if (stateData.attached_actor) {
            const em = this.engine.entityManager;
            const prevMergingFire = em._mergingFire;
            em._mergingFire = true;
            // Suppress spawn damage for the duration of the spawn: spawnActor calls
            // applySpawnDamage internally, so tagging _isAttachedFire on the returned
            // actor happens too late to stop it hitting the very actor whose state
            // just spawned it. The state's per_turn_effect owns this damage now.
            const prevSpawningAttached = em._spawningAttachedActor;
            em._spawningAttachedActor = true;
            const attachedActor = em.spawnActor(
                stateData.attached_actor,
                this.x,
                this.y
            );
            em._spawningAttachedActor = prevSpawningAttached;
            em._mergingFire = prevMergingFire;
            if (attachedActor) {
                // Mark as attached to this actor so it follows and doesn't apply spawn damage
                attachedActor._attachedTo = this;
                attachedActor._isAttachedFire = true; // Skip normal fire damage, state handles it
                this.states[stateName].attachedActor = attachedActor;
            }
        }

        // Show apply message (skip for silent/innate states)
        if (!options.silent && stateData.on_apply_message && this.engine.inputManager) {
            const message = stateData.on_apply_message.replace('[actor_name]', this.name);
            const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };
            this.engine.inputManager.showMessage(message, { position: pos, style: 'warning' });
        }

        // Play apply sound (skip for silent/innate states)
        if (!options.silent && stateData.on_apply_sound) {
            this.engine.playSound?.(stateData.on_apply_sound);
        }

        // Apply on_apply_effect (modifies actor properties while state is active)
        if (stateData.on_apply_effect) {
            const savedValues = {};
            for (const [key, amount] of Object.entries(stateData.on_apply_effect)) {
                if (this[key] !== undefined && typeof this[key] === 'number') {
                    savedValues[key] = this[key];
                    this[key] = Math.max(1, this[key] + amount);
                }
            }
            this.states[stateName]._savedValues = savedValues;
        }

        // A vision cap on the player needs the FOV system to show it; a bright
        // level has none, so stand one up for the duration.
        if (typeof stateData.vision_cap === 'number' && this.isPlayerControlled()) {
            this.engine.enableRuntimeDarkness?.();
            this.engine.updateLighting?.();
        }

        // Flying: emerge from submersion when gaining flight
        if (stateData.flying && this.isSubmerged) {
            this.emerge();
        }

        // Confusion: apply full-canvas visual effect for player
        if (stateData.random_movement && this.isPlayerControlled()) {
            this.engine.renderer?.applyConfusionEffect();
        }

        // Hallucination: apply intense visual scrambling for player
        if (stateData.hallucinating && this.isPlayerControlled()) {
            this.engine.renderer?.applyHallucinationEffect();
        }

        // Invisibility: translucent for player-controlled, fully hidden for others
        if (stateData.invisible) {
            this._updateInvisibilitySprites();
        }

        if (stateData.tint) this._repaintStateTint();
        if (stateData.effect) this._refreshStateEffect();

        return true;
    },

    /**
     * Repaint this actor's sprites now that its set of tinting states has changed.
     *
     * On a dark level the lighting pass would do this anyway, on its own schedule; this
     * just makes it immediate. On a bright level there IS no lighting pass, so without
     * this a state tint never reached the sprite at all — the sidebar showed the state
     * in its color while the actor on the map sat unchanged.
     *
     * Per-actor rather than a full-scene refresh: only this actor's states changed.
     */
    _repaintStateTint() {
        const renderer = this.engine?.renderer;
        if (!renderer) return;

        const tint = renderer.getEffectiveTint(this) ?? 0xFFFFFF;
        if (this.spriteBase) this.spriteBase.tint = tint;
        if (this.spriteTop) this.spriteTop.tint = tint;
        if (this.spriteSide) this.spriteSide.tint = tint;
    },

    /**
     * The visual effect this actor's sprites should be running right now.
     *
     * A state's `effect` outranks the actor's own, so a burning torch reads as
     * burning rather than flickering, and the actor's effect returns when the
     * state lapses. Latest applied state wins if several declare one — same
     * "most recent thing that happened to you" rule the messages follow.
     * @returns {string|null}
     */
    getActiveEffect() {
        const states = Object.values(this.states);
        for (let i = states.length - 1; i >= 0; i--) {
            if (states[i].data?.effect) return states[i].data.effect;
        }
        return this.effect ?? null;
    },

    /**
     * Drive this actor's sprites to whatever getActiveEffect() now names.
     *
     * Handles are tracked per sprite so a re-applied state doesn't stack a
     * second copy of the same primitive on the same sprite — the leak that
     * makes a flicker visibly speed up. Cheap to call: a no-op when the
     * effect hasn't actually changed.
     */
    _refreshStateEffect() {
        const runner = this.engine?.renderer?.effectRunner;
        if (!runner) return;

        const wanted = this.getActiveEffect();
        if (wanted === this._activeEffectName) return;

        // Handles applied at sprite-creation time aren't in this list, so a state
        // effect that started there is torn down by destroying the sprite, not
        // here. Only what this method started is this method's to remove.
        for (const handle of this._effectHandles ?? []) runner.remove(handle);
        this._effectHandles = [];
        this._activeEffectName = wanted;

        if (!wanted) {
            // Nothing running now, so the sprites keep the last tint the
            // departing effect wrote. Put the actor's own colour back.
            this._repaintStateTint();
            return;
        }

        // Flicker around the tint the actor is actually wearing, not its own:
        // a state that sets both `tint` and `effect` means the state colour to
        // be the thing that pulses. tint_flicker rewrites the tint every frame,
        // so passing this.tint here would silently discard the state's.
        const baseTint = this.engine.renderer.getEffectiveTint?.(this) ?? this.tint;
        for (const sprite of [this.spriteBase, this.spriteTop, this.spriteSide]) {
            if (sprite) this._effectHandles.push(runner.apply(wanted, sprite, { baseTint }));
        }
    },

    /**
     * Apply a state, but only to something alive enough to have a mind.
     *
     * Use this where the caller means "affect a creature" rather than "affect
     * whatever is here" — a sleep gas cloud should not put a wall to sleep even
     * though applyState would now happily let it. Callers that deliberately
     * target scenery (fire spreading to a tree, quicksand gripping a pushed
     * boulder) should call applyState directly.
     *
     * @param {string} stateName - The state name
     * @param {Object} stateData - State configuration from states.json
     * @param {Object} [options] - Same options as applyState
     * @returns {boolean} True if the state was applied
     */
    applyCreatureState(stateName, stateData, options = {}) {
        if (!this.hasAttribute('sentient') && !this.hasAttribute('controlled')) return false;
        return this.applyState(stateName, stateData, options);
    },

    /**
     * Remove a state from this actor
     * @param {string} stateName - The state name to remove
     * @param {boolean} [silent=false] - If true, don't show removal message
     */
    removeState(stateName, silent = false) {
        const state = this.states[stateName];
        if (!state) return;

        // Remove attached actor
        if (state.attachedActor && !state.attachedActor.isDead) {
            state.attachedActor.die();
        }

        // Show removal message
        if (!silent && state.data.on_remove_message && this.engine.inputManager) {
            const message = state.data.on_remove_message.replace('[actor_name]', this.name);
            const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };
            this.engine.inputManager.showMessage(message, { position: pos, style: 'discovery' });
        }

        // Play removal sound
        if (!silent && state.data.on_remove_sound) {
            this.engine.playSound?.(state.data.on_remove_sound);
        }

        // Reverse on_apply_effect (restore original values)
        if (state._savedValues) {
            for (const [key, originalValue] of Object.entries(state._savedValues)) {
                this[key] = originalValue;
            }
        }

        // Lifting a vision cap: drop the runtime FOV system unless another cap remains
        if (typeof state.data.vision_cap === 'number' && this.isPlayerControlled()) {
            const hasOtherVisionState = Object.entries(this.states).some(
                ([name, s]) => name !== stateName && typeof s.data.vision_cap === 'number'
            );
            if (!hasOtherVisionState) {
                this.engine.disableRuntimeDarkness?.();
            }
            this.engine.updateLighting?.();
        }

        // Slowed: reset toggle when slow is removed
        if (state.data.skip_every_other_turn) {
            this._slowedToggle = false;
        }

        // Confusion: remove full-canvas visual effect for player
        if (state.data.random_movement && this.isPlayerControlled()) {
            this.engine.renderer?.removeConfusionEffect();
        }

        // Hallucination: remove visual scrambling for player
        if (state.data.hallucinating && this.isPlayerControlled()) {
            this.engine.renderer?.removeHallucinationEffect();
        }

        // Invisibility: restore sprite visibility/alpha
        if (state.data.invisible) {
            this._updateInvisibilitySprites();
        }

        // Flying: handle landing when flight ends
        if (state.data.flying && !this.isDead) {
            // Check if still flying from another source
            const stillFlying = Object.entries(this.states).some(
                ([name, s]) => name !== stateName && s.data.flying
            );
            if (!stillFlying) {
                this.updateSubmersionState();
                if (!this.hasFloorAt(this.x, this.y) && !this.hasPlatformAt(this.x, this.y)) {
                    this.fall();
                }
            }
        }

        delete this.states[stateName];

        // Also after the delete, and for the same reason: getStateTint() has to no
        // longer see this state, or the sprite keeps the color of the state that just
        // ended. Any other tinting state still running is folded back in.
        if (state.data.tint) this._repaintStateTint();

        // Also after the delete: getActiveEffect() must no longer see this state,
        // or the actor keeps running the effect that just ended.
        if (state.data.effect) this._refreshStateEffect();

        // Telepathy ending: refresh the view so enemies revealed through walls/
        // darkness (and ghosted invisible ones) are re-hidden now that the sense is
        // gone. Done after the delete so hasStateProperty('telepathic') reads false.
        if (state.data.telepathic && this.isPlayerControlled()) {
            this.engine.updateLighting?.();
        }
    },

    _updateInvisibilitySprites() {
        const isInvisible = this.isUnseen();
        if (isInvisible && this.isPlayerControlled()) {
            const alpha = 0.35;
            if (this.spriteBase) this.spriteBase.alpha = alpha;
            if (this.spriteTop) this.spriteTop.alpha = alpha;
            if (this.spriteSide) this.spriteSide.alpha = alpha;
            for (const slot of ['top', 'middle', 'lower']) {
                if (this.spriteEquipment[slot]) this.spriteEquipment[slot].alpha = alpha;
            }
        } else if (isInvisible) {
            if (this.spriteBase) this.spriteBase.visible = false;
            if (this.spriteTop) this.spriteTop.visible = false;
            if (this.spriteSide) this.spriteSide.visible = false;
        } else {
            if (this.spriteBase) this.spriteBase.alpha = 1;
            if (this.spriteTop) this.spriteTop.alpha = 1;
            if (this.spriteSide) this.spriteSide.alpha = 1;
            for (const slot of ['top', 'middle', 'lower']) {
                if (this.spriteEquipment[slot]) this.spriteEquipment[slot].alpha = 1;
            }
            if (this.spriteBase) this.spriteBase.visible = true;
            // Under the surface only the body reads through the water, so a
            // revealed-but-still-submerged eel must not sprout head and side again.
            if (this.spriteTop) this.spriteTop.visible = !this.isSubmerged;
            if (this.spriteSide) this.spriteSide.visible = !this.isSubmerged;
        }
    },

    /**
     * Check if actor has a specific state
     * @param {string} stateName - The state name to check
     * @returns {boolean} True if actor has the state
     */
    hasState(stateName) {
        return !!this.states[stateName];
    },

    /**
     * Get remaining duration for a state
     * @param {string} stateName - The state name
     * @returns {number|null} Remaining duration or null if state not present
     */
    getStateDuration(stateName) {
        return this.states[stateName]?.duration ?? null;
    },

    /**
     * The average tint of the states currently worth showing on this actor's sprite,
     * or null if there are none.
     *
     * Innate states are skipped. A tint is a signal that something is *happening* to
     * an actor, and an innate state is the opposite of news — it is what the thing
     * permanently is. `flies` grants a permanent `flying` state, so every gas cloud,
     * bat and vampire was being washed 70% toward flying's cyan (#33eeff) and losing
     * its own color: sewer gas authored #AACC33 rendered #57E4C2.
     *
     * Note the exclusion is innate-ness, not an infinite duration. `stuck` and
     * `starving` have no timer either — they end on an escape roll or on eating —
     * but they are conditions, and they still tint.
     */
    getStateTint() {
        const tints = [];
        for (const state of Object.values(this.states)) {
            if (state.innate) continue;
            if (state.data?.tint) {
                tints.push(parseTint(state.data.tint));
            }
        }
        if (tints.length === 0) return null;
        let r = 0, g = 0, b = 0;
        for (const t of tints) {
            r += (t >> 16) & 0xFF;
            g += (t >> 8) & 0xFF;
            b += t & 0xFF;
        }
        const n = tints.length;
        return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
    },

    /**
     * Process all active states each turn
     * Decrements durations, applies per-turn effects, removes expired states
     * Called at the start of each turn in act()
     */
    processStates() {
        const statesToRemove = [];

        for (const [stateName, state] of Object.entries(this.states)) {
            const stateData = state.data;

            // Update attached actor position to follow this actor
            if (state.attachedActor && !state.attachedActor.isDead) {
                if (state.attachedActor.x !== this.x || state.attachedActor.y !== this.y) {
                    state.attachedActor.x = this.x;
                    state.attachedActor.y = this.y;
                    // Update sprite position
                    if (state.attachedActor.spriteBase) {
                        state.attachedActor.spriteBase.x = this.x * TILE_WIDTH;
                        state.attachedActor.spriteBase.y = this.y * TILE_HEIGHT;
                    }
                    if (state.attachedActor.spriteTop) {
                        state.attachedActor.spriteTop.x = this.x * TILE_WIDTH;
                        state.attachedActor.spriteTop.y = (this.y - 1) * TILE_HEIGHT;
                    }
                }
            }

            // Apply per-turn effect (e.g., poison damage)
            if (stateData.per_turn_effect) {
                const died = this.applyStatEffect(
                    stateData.per_turn_effect, stateData.name || stateName
                );
                if (died) return;
            }

            // Random state application (e.g., starving can cause fainting or nausea)
            if (stateData.random_apply_states) {
                for (const entry of stateData.random_apply_states) {
                    if (ROT.RNG.getUniform() < entry.chance) {
                        const targetStateData = this.engine.globalStates[entry.state];
                        if (targetStateData) {
                            const opts = {};
                            if (entry.duration !== undefined) opts.duration = entry.duration;
                            if (entry.message && this.isPlayerControlled()) {
                                this.engine.inputManager?.showMessage(entry.message);
                            }
                            this.applyState(entry.state, targetStateData, opts);
                        }
                        break; // Only one random state per turn
                    }
                }
            }

            // Hallucination: tick per-turn floor tile changes for player
            if (stateData.hallucinating && this.isPlayerControlled()) {
                this.engine.renderer?.tickHallucination();
            }

            // A state granting `ignites` (superheated) sets fire to flammable
            // neighbors, the way a fire actor does. Solid carriers fill their own
            // tile, so unlike fire this reaches out to the cardinal neighbors.
            const grantsIgnite = stateData.grants_attribute === 'ignites' ||
                (Array.isArray(stateData.grants_attribute) && stateData.grants_attribute.includes('ignites'));
            if (grantsIgnite && !this.isDead) {
                const em = this.engine.entityManager;
                em.consumeFlammableAt(this, this.x, this.y);
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    em.consumeFlammableAt(this, this.x + dx, this.y + dy);
                }
            }

            // Decrement duration
            state.duration--;

            // Check if state expired
            if (state.duration <= 0) {
                statesToRemove.push(stateName);
            }
        }

        // Remove expired states
        for (const stateName of statesToRemove) {
            this.removeState(stateName);
        }
    },

    /**
     * Stunned, asleep or paralyzed — loses its turn and is helpless (easier to hit,
     * open to a backstab).
     * @returns {boolean}
     */
    isIncapacitated() {
        return this.hasStateProperty('skip_turn');
    },

    /**
     * Confused — movement direction is randomized.
     * @returns {boolean}
     */
    isConfused() {
        return this.hasStateProperty('random_movement');
    },

    /**
     * Whether a state has turned this actor against everyone (staff/scroll of
     * discord). See isEnemyOf and Personality.execute.
     * @returns {boolean}
     */
    isDiscordant() {
        return this.hasStateProperty('discordant');
    },

    /**
     * Chance to break free of every `stuck` state this turn. Only the states doing
     * the holding are consulted, and the hardest of them governs, so escaping a web
     * doesn't also lift you out of the quicksand it was strung over.
     * @returns {number} 0–1
     */
    getEscapeChance() {
        let hardest = null;
        for (const s of Object.values(this.states)) {
            if (!s.data.stuck) continue;
            const chance = typeof s.data.escape_chance === 'number' ? s.data.escape_chance : 0.33;
            if (hardest === null || chance < hardest) hardest = chance;
        }
        return hardest ?? 0.33;
    },

    /**
     * Check if any active state has a given property set to truthy
     * @param {string} prop - The state data property to check (e.g. 'random_movement')
     * @returns {boolean} True if any active state has that property
     */
    hasStateProperty(prop) {
        return Object.values(this.states).some(s => s.data[prop]);
    },

    /**
     * Find the active state with the highest (or lowest) value for a numeric
     * property. Returns the state, not just the number, so the caller can read the
     * rest of its data — the message and spawn belonging to the state that won.
     *
     * Distinguishes "no state declares this" (null) from "a state declares 0", which
     * a bare number cannot: an escape_chance of 0 means inescapable.
     *
     * @param {string} prop - The state data property to rank by
     * @param {Object} [options]
     * @param {boolean} [options.lowest=false] - Rank ascending instead of descending
     * @returns {{name: string, data: Object, value: number}|null}
     */
    findStateWithProperty(prop, { lowest = false } = {}) {
        let best = null;
        for (const [name, s] of Object.entries(this.states)) {
            const value = s.data[prop];
            if (typeof value !== 'number') continue;
            if (!best || (lowest ? value < best.value : value > best.value)) {
                best = { name, data: s.data, value };
            }
        }
        return best;
    },

    /**
     * Roll a state's `skip_turn_chance`. On a hit the state's own data says what
     * that looks like: skip_turn_message, _sound, _spawn, _effect. Adding a state
     * that occasionally costs a turn needs no engine change.
     * @returns {boolean} True if the actor loses its turn
     */
    rollStateTurnLoss() {
        const state = this.findStateWithProperty('skip_turn_chance');
        if (!state || ROT.RNG.getUniform() >= state.value) return false;

        const data = state.data;
        const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };

        if (data.skip_turn_message) {
            this.engine.inputManager?.showMessage(
                this.formatEventMessage(data.skip_turn_message), pos
            );
        }
        if (data.skip_turn_sound) this.engine.playSound?.(data.skip_turn_sound);
        if (data.skip_turn_spawn) {
            this.engine.entityManager.spawnEntity(data.skip_turn_spawn, this.x, this.y);
        }
        if (data.skip_turn_effect) {
            this.applyStatEffect(data.skip_turn_effect, data.name || state.name);
        }

        return !this.isDead;
    },
};
