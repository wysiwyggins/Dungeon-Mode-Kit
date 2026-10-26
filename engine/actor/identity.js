/**
 * Actor methods: names and event messages, what the viewer can perceive
 * (unseen, hallucinating, blind, submerged), faction and rank.
 */

import { resolveTemplate } from '../../core/util.js';

export const ActorIdentity = {
    /**
     * Get the collision description with template substitution
     * Checks equipped weapon's collision_description first, then actor's
     * @param {Actor} target - The actor being attacked
     * @returns {string|null} The processed description or null if none
     */
    getCollisionDescription(target) {
        // Check equipped weapon for collision description first
        const weapon = this.getEquippedWeapon?.();
        let template = weapon?.getAttribute('collision_description');

        // Fall back to actor's collision description
        if (!template) {
            template = this.getAttribute('collision_description');
        }

        if (!template) return null;

        // Re-rolls: this fires on every swing, which is where [attacks.melee_verbs]
        // earns its keep.
        const result = resolveTemplate(template, this, { providers: this._nameProviders(target) });
        return this._hideAnonymousArticle(result);
    },

    /**
     * Template providers for the names a combat line quotes.
     *
     * Actor names go through getDisplayName(), so an actor whose name is itself a
     * template ("[color] lever") reads correctly in a message. Weapon names stay
     * raw: getDisplayName() would fold in the cursed prefix and enchantment suffix,
     * turning "with a sword" into "with a Cursed sword +2" — and [a-an] would then
     * take its article from "Cursed".
     *
     * @param {Actor} [target] - The actor being acted upon, if any
     * @returns {Object<string, function>} Provider map for resolveTemplate
     */
    _nameProviders(target) {
        return {
            actor_name: () => this.isAnonymous() ? 'something' : this.getDisplayName(),
            // The victim gets the same gate as the attacker. Without it a hallucinating
            // player watching two monsters fight reads "Something eats the goblin!" —
            // the one true name in the sentence. isAnonymous() exempts the player, so
            // being the one bitten still reads correctly.
            attacked_actor_name: () => target?.isAnonymous?.()
                ? 'something'
                : (target?.getDisplayName?.() ?? target?.name),
            // undefined keeps the placeholder, matching the old "no weapon" behavior.
            weapon_name: () => this.getEquippedWeapon()?.name
        };
    },

    /**
     * Resolve an event message template, adding grammatical person on top of the
     * usual [token]s: `"[You|The [actor_name]] [retch|retches]!"` picks the left
     * branch for the player, the right for anyone else.
     * @param {string} template
     * @returns {string}
     */
    formatEventMessage(template) {
        if (typeof template !== 'string') return template;

        const second = this.isPlayerControlled();
        // Split branches before resolving, so a nested [actor_name] is only
        // resolved on the branch that survives.
        const chosen = template.replace(/\[([^[\]|]*(?:\[[^\]]*\][^[\]|]*)*)\|([^[\]|]*(?:\[[^\]]*\][^[\]|]*)*)\]/g,
            (_, you, it) => second ? you : it);

        const result = resolveTemplate(chosen, this, { providers: this._nameProviders() });
        return this._hideAnonymousArticle(result);
    },

    /**
     * Apply a map of stat deltas, announcing health loss and handling death.
     * Shared by per-turn effects and one-off state events so neither path can
     * skip the death check.
     * @param {Object<string, number>} effect - stat key -> delta
     * @param {string} sourceName - Named in the damage message
     * @returns {boolean} True if this killed the actor
     */
    applyStatEffect(effect, sourceName) {
        if (!this.stats) return false;

        for (const [statKey, value] of Object.entries(effect)) {
            if (this.stats[statKey] === undefined) continue;

            this.stats[statKey].current = Math.max(0, this.stats[statKey].current + value);

            if (statKey === 'health' && value < 0 && this.hasAttribute('visible')) {
                const pos = this.isPlayerControlled() ? null : { x: this.x, y: this.y };
                this.engine.inputManager?.showMessage(
                    `${this.getNameWithArticle(true)} takes ${Math.abs(value)} damage from ${sourceName}!`, pos
                );
                this.flash?.();
            }

            if (statKey === 'health' && this.stats[statKey].current <= 0) {
                this.die();
                return true;
            }
        }
        return false;
    },

    /**
     * Whether sight alone fails to find this actor: the `invisible` state
     * (temporary, from a potion) or deep water hiding an ambusher. Shared by the
     * sprite passes and the sidebar so they can't drift apart.
     * @returns {boolean}
     */
    isUnseen() {
        return this.hasStateProperty('invisible') || this.isConcealedBySubmersion();
    },

    /**
     * Whether this actor is hidden from the player and so goes unnamed in messages.
     *
     * Anything sight can't find, plus the `visible: false` attribute (permanent —
     * ghasts, portals, gas traps). Checking only the state let a ghast announce
     * itself by name as it attacked.
     *
     * Hallucination counts too, and it's the one condition here that belongs to the
     * *viewer* rather than to this actor — everything else on the map is scrambled and
     * misnamed, so a combat line naming the attacker outright would be the one honest
     * reading in a poisoned frame. Same word the invisible and hidden cases get, which
     * also means `_hideAnonymousArticle` fixes the grammar for free.
     *
     * @returns {boolean}
     */
    isAnonymous() {
        if (this.isPlayerControlled()) return false;
        if (this.isViewerHallucinating() || this.isViewerBlind()) return true;
        return this.isUnseen() || !this.hasAttribute('visible') || this.hasAttribute('hidden');
    },

    /**
     * Is whoever is reading these messages currently hallucinating?
     *
     * Asked of the viewpoint actor, not of this one — the trip is the reader's, and
     * the attacker has no idea it's being misperceived. Mirrors how
     * `isConcealedBySubmersion` reaches for the viewpoint.
     *
     * @returns {boolean}
     */
    isViewerHallucinating() {
        const viewer = this.engine?.entityManager?.getPrimaryViewpoint?.();
        if (!viewer || viewer === this) return false;
        return viewer.hasStateProperty?.('hallucinating') === true;
    },

    /**
     * Is whoever is reading these messages blind (a `vision_cap` state)? Like
     * hallucination this belongs to the viewer: a creature brushing past a blind
     * player is felt, not identified, so it goes unnamed.
     *
     * @returns {boolean}
     */
    isViewerBlind() {
        const viewer = this.engine?.entityManager?.getPrimaryViewpoint?.();
        if (!viewer || viewer === this) return false;
        return !!viewer.findStateWithProperty?.('vision_cap');
    },

    /**
     * Is the deep liquid hiding this actor from the viewer right now?
     *
     * An eel hides at the waterline: from above the surface breaks up any sight of
     * it, but a viewer who has gone under is in the same medium and meets it face
     * to face. Derived live from `isSubmerged` on both sides rather than applied as
     * a state, so it can never go stale, and so it stays distinct from real
     * invisibility.
     *
     * Opt-in with `conceals_when_submerged`: the designer picks which creatures the
     * water hides (an eel, not a wading ogre).
     *
     * @returns {boolean}
     */
    isConcealedBySubmersion() {
        if (!this.isSubmerged) return false;
        if (!this.hasAttribute('conceals_when_submerged')) return false;
        if (this.hasAttribute('controlled')) return false;

        const viewer = this.engine?.entityManager?.getPrimaryViewpoint?.();
        if (!viewer || viewer === this) return false;
        if (!viewer.isSubmerged) return true;

        // Both under: only the same body of water puts them face to face.
        const em = this.engine.entityManager;
        const mine = em.getLiquidBodyIdAt(this.x, this.y);
        const theirs = em.getLiquidBodyIdAt(viewer.x, viewer.y);
        return mine === null || theirs === null || mine !== theirs;
    },

    /**
     * Drop the article in front of an unnamed combatant: "The something" -> "Something".
     * A grammar fix on the finished sentence, so it runs after substitution.
     *
     * Keyed off the text, not off `this`. Either end of a line can be the unnamed one —
     * a visible attacker can strike an invisible target — and gating on the attacker
     * left "The goblin bites the something!" unfixed in that direction. Matching the
     * literal word is safe because it only ever appears here by substitution; an
     * authored name is not going to be "something".
     *
     * @param {string} text
     * @returns {string}
     */
    _hideAnonymousArticle(text) {
        if (typeof text !== 'string') return text;
        return text.replace(/^The something\b/, 'Something').replace(/\bthe something\b/g, 'something');
    },

    /**
     * Resolve attribute or stat references in a value string or number
     * Supports patterns like "{strength}" or "-{strength}" which get replaced with actor attribute/stat values
     * Checks stats first (including current value for object stats), then attributes
     * @param {any} value - The value to resolve (string like "-{strength}" or a number)
     * @param {Actor} sourceActor - The actor whose attributes/stats to use for resolution
     * @returns {any} - The resolved value (number if pattern matched, original value otherwise)
     */
    resolveAttributeValue(value, sourceActor) {
        if (typeof value === 'string') {
            // Match patterns like "{attr}", "-{attr}", or "+{attr}"
            const match = value.match(/^([+-]?)?\{(\w+)\}$/);
            if (match) {
                const sign = match[1] || '+';
                const name = match[2];

                // Check stats first
                if (sourceActor.stats && sourceActor.stats[name] !== undefined) {
                    const stat = sourceActor.stats[name];
                    let statValue;
                    if (typeof stat === 'object' && stat.current !== undefined) {
                        statValue = stat.current;
                    } else if (typeof stat === 'number') {
                        statValue = stat;
                    }
                    if (typeof statValue === 'number') {
                        return sign === '-' ? -statValue : statValue;
                    }
                }

                // Fall back to attributes
                const attrValue = sourceActor.getAttribute(name);
                if (typeof attrValue === 'number') {
                    return sign === '-' ? -attrValue : attrValue;
                }

                console.warn(`Stat/Attribute '${name}' not found or not a number on ${sourceActor.name}`);
                return 0;
            }
        }
        return value;
    },

    /**
     * This actor's faction tag, or null if it has none.
     * @returns {string|null}
     */
    getFaction() {
        return this.personality?.faction ?? null;
    },

    /**
     * Decide whether `other` is an enemy this actor would attack.
     *
     * Faction model:
     *  - If this actor HAS a faction, every actor that does not share it is an
     *    enemy — including the player (who has no faction) and unfactioned NPCs.
     *    Same-faction actors are allies.
     *  - If this actor has NO faction (the default for every existing monster),
     *    the only enemy is the player. This collapses to the engine's original
     *    `controlled`-means-enemy rule, so unfactioned actors behave exactly as
     *    before.
     *  - Discord overrides both: if either side is discordant (Brogue's
     *    STATUS_DISCORDANT), they are enemies regardless of faction, so the
     *    victim turns on its allies and they turn on it.
     *
     * @param {Actor} other - The candidate target
     * @returns {boolean}
     */
    isEnemyOf(other) {
        if (!other || other === this || other.isDead) return false;

        if (this.isDiscordant() || other.isDiscordant?.()) return true;

        const myFaction = this.getFaction();
        if (myFaction) {
            // Enemy = anyone not in my faction.
            return other.getFaction?.() !== myFaction;
        }

        // No faction: only the player is an enemy (legacy behavior).
        return other.isPlayerControlled();
    },

    /**
     * This actor's position in the prototype's capture hierarchy, or null if it
     * has none.
     *
     * Rank is authored as membership in `rank_order` — an array of actor ids from
     * weakest to strongest — rather than as a number on each actor. Ordering is
     * the kind of thing a list states better than scattered integers: inserting a
     * piece mid-hierarchy is an edit to one line instead of a renumbering, and the
     * ends of the span are derived rather than hardcoded, which is what lets the
     * wrap-around rule below be general.
     *
     * An explicit numeric `rank` attribute wins if present, for an actor that needs
     * to sit at a rank without being listed (a disguise, a promoted piece).
     *
     * @returns {number|null} 0-based rank, or null if this actor is unranked
     */
    getRank() {
        const explicit = this.getAttribute('rank');
        if (typeof explicit === 'number') return explicit;

        const order = this.engine?.currentPrototype?.config?.rank_order;
        if (!Array.isArray(order)) return null;

        const index = order.indexOf(this.type);
        return index === -1 ? null : index;
    },

    /**
     * Whether this actor may capture `target` under the rank hierarchy.
     *
     * Higher rank takes lower and equal rank trades, with one exception: the
     * weakest rank takes the strongest, and not the reverse. That wrap-around is
     * the whole point of the mechanic — without it the top piece is an
     * unanswerable win condition. It is expressed against the ends of the declared
     * span rather than as a named special case, so a prototype gets it wherever it
     * puts the boundaries.
     *
     * Unranked actors are unaffected: if either side has no rank the hierarchy has
     * nothing to say and capture is allowed, so every existing prototype — none of
     * which declare `rank_order` — behaves exactly as before.
     *
     * @param {Actor} target - The actor being attacked
     * @returns {boolean}
     */
    outranksForCapture(target) {
        const mine = this.getRank();
        const theirs = target?.getRank?.();
        if (mine === null || mine === undefined) return true;
        if (theirs === null || theirs === undefined) return true;

        const order = this.engine?.currentPrototype?.config?.rank_order;
        if (Array.isArray(order) && order.length > 1) {
            const min = 0;
            const max = order.length - 1;
            if (mine === min && theirs === max) return true;   // the rat takes the elephant
            if (mine === max && theirs === min) return false;  // ...and never the reverse
        }

        return mine >= theirs;
    },
};
