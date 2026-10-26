/**
 * Entity: the base class of Item and Actor (position, attributes, tile).
 * Imports only leaf modules: item.js and actor.js extend it, so it must never
 * sit on an import cycle that leads back to them.
 */

import { resolveTemplate } from '../core/util.js';

// ============================================================================
// ENTITY SYSTEM
// ============================================================================

export class Entity {
    constructor(x, y, type, engine) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.engine = engine;
        this.attributes = new Map();
        this.sprite = null;
        this.tint = 0xFFFFFF;
        this.zIndex = 1;
        this.setAttribute('flammable', false);
    }

    // Position is an accessor pair so every move — tryMove, knockback, blink,
    // teleport, or any direct `actor.x = ...` — keeps EntityManager's position
    // map current without a full rebuild. _posKey is set only while the actor is
    // indexed in that map, so items and removed actors skip the bookkeeping.
    get x() { return this._x; }
    set x(value) {
        if (value === this._x) return;
        this._x = value;
        if (this._posKey !== undefined) this.engine.entityManager?._repositionActor(this);
    }

    get y() { return this._y; }
    set y(value) {
        if (value === this._y) return;
        this._y = value;
        if (this._posKey !== undefined) this.engine.entityManager?._repositionActor(this);
    }

    setAttribute(key, value) {
        this.attributes.set(key, value);
    }
    
    getAttribute(key) {
        if (!this.attributes.has(key)) return undefined;
        return this.attributes.get(key);
    }
    
    hasAttribute(key) {
        return this.attributes.has(key) && this.attributes.get(key);
    }

    die() {
        // Capture lighting relevance before removal — a light_source (e.g. a burnt-out
        // ground torch) or solid blocker stops affecting the scene the moment it dies.
        const affectedLighting = this.hasAttribute('light_source') || this.hasAttribute('solid');
        this.isDead = true;
        this.engine.entityManager?.removeEntity(this);
        // Coalesced + position-gated recompute so its light/shadow clears this turn.
        if (affectedLighting) this.engine.requestLightingUpdate?.(this.x, this.y);
    }

    /**
     * The name to show the player. Base implementation prefixes the entity's paired
     * color when it has one, so a color-locked door reads "fire brick door" rather
     * than a generic "Door" — the color is how the player actually identifies which
     * door goes with which key, so it belongs in the text, not just the sprite tint.
     *
     * Keeps the name's own capitalization — this is the label form, used in sidebars
     * and headings. getNameWithArticle() handles lowercasing for mid-sentence use.
     * Item overrides this with its own identification-aware template logic.
     *
     * @returns {string} Display name, color-prefixed when applicable
     */
    getDisplayName() {
        const color = this.getColorName?.();

        // A name may be a template ("[color] lever"), which lets the data decide
        // where the color word goes instead of the engine gluing it on the front.
        // Feed the paired color in directly: an Entity has no templateVars bag,
        // and this is the one variable the base class knows how to supply.
        const declaresColor = typeof this.name === 'string' && this.name.includes('[color]');
        const resolved = resolveTemplate(this.name, this, {
            memoize: true,
            providers: color ? { color: () => color } : {}
        });
        if (declaresColor) {
            // The name said where the color goes, so don't also prefix it. An
            // unpaired switch never gets a color (initializeSwitchTints skips
            // groups with no targets), so drop the token rather than show it.
            return color ? resolved : resolved.replace(/\[color\]\s*/g, '');
        }
        if (resolved !== this.name) return resolved;

        // Fallback for entities that carry a color but don't say where it goes —
        // doors, gates and pedestals. Keeps their names reading as they always have.
        if (!color) return resolved;

        // Don't double up if the name already carries the color (e.g. authored that way).
        if (resolved.toLowerCase().includes(color.toLowerCase())) return resolved;
        return `${color} ${resolved}`;
    }

    /**
     * The color name paired to this entity, if any. Doors/keys carry `lock_color`
     * (set when a key/door pair is assigned a color from colors.json). Returns null
     * for entities with no color pairing, which is most of them.
     * @returns {string|null}
     */
    getColorName() {
        return this.getAttribute?.('lock_color') || null;
    }

    /**
     * Whether this entity goes unnamed in messages. False on the base class: an item
     * lying on the floor is named.
     *
     * @returns {boolean}
     */
    isAnonymous() {
        return false;
    }

    /**
     * Get the entity's name with appropriate article ("the", or none for proper nouns/mass nouns)
     *
     * Generic names are authored lowercase in the data files so they read as prose
     * mid-sentence ("the fire brick door"); proper names keep their capitals.
     * anonymity gate lives here for masking names
     *
     * @param {boolean} capitalize - Whether to capitalize "The" (default false)
     * @returns {string} Name with article if appropriate
     */
    getNameWithArticle(capitalize = false) {
        if (this.isAnonymous()) return capitalize ? 'Something' : 'something';

        const name = this.getDisplayName();
        if (this.hasAttribute('proper_named') || this.hasAttribute('mass_noun')) {
            return name;
        }
        const article = capitalize ? 'The' : 'the';
        return `${article} ${name}`;
    }

    /**
     * Check if this entity is player-controlled
     * @returns {boolean}
     */
    isPlayerControlled() {
        return this.hasAttribute('controlled');
    }

    /**
     * Whether this actor is a viewpoint — the FOV/camera origin. True for the
     * controlled player, or any actor tagged `pov` (e.g. an AI hero in an
     * observer prototype). Distinct from isPlayerControlled(), which governs
     * input/turn-locking and must stay controlled-only.
     */
    isViewpoint() {
        return this.hasAttribute('controlled') || this.hasAttribute('pov');
    }

    /**
     * Show a message to the player (only if this entity is player-controlled)
     * @param {string} message - The message to display
     */
    showMessage(message) {
        if (this.isPlayerControlled()) {
            this.engine.inputManager?.showMessage(message);
        }
    }

    /**
     * Play a sound effect
     * @param {string} soundName - The sound to play
     */
    playSound(soundName) {
        if (soundName) {
            this.engine.playSound?.(soundName);
        }
    }

    updatePosition(newX, newY) {
        this.x = newX;
        this.y = newY;
        if (this.sprite) {
            this.updateSpritePosition();
        }
    }
    
    updateSpritePosition() {
        // Override in subclasses
    }
    
    serialize() {
        return {
            x: this.x,
            y: this.y,
            type: this.type,
            name: this.name,
            attributes: Array.from(this.attributes.entries()),
            tint: this.tint,
            // Tells deserializeEntities to rebuild this as a plain Entity. Actor and
            // Item records carry it too, but add their own flag, which is checked first.
            isEntity: true
        };
    }

    deserialize(data) {
        this.x = data.x;
        this.y = data.y;
        this.type = data.type;
        if (data.name !== undefined) this.name = data.name;
        this.attributes = new Map(data.attributes);
        this.tint = data.tint;
    }
}
