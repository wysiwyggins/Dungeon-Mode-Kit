/**
 * Actor: anything that occupies a tile and can act: creatures, the player,
 * doors, switches, traps, liquids, gas. This file holds the constructor,
 * description and display, doors and switches, the turn (act), death and drops,
 * sight and wards, and serialization. Its other method groups are installed
 * from the sibling modules in engine/actor/.
 */

import { Personality, springTrapPayload } from '../../behaviors/behaviors.js';
import { installMethods } from '../../core/mixin.js';
import {
    findAdjacentWalkable,
    getEuclideanDistance,
    getNextPathStep,
    hasLineOfSight
} from '../../core/pathfinding.js';
import {
    ALL_DIRS,
    TILE_HEIGHT,
    TILE_WIDTH,
    isDiagonalBlocked,
    parseTint,
    randomElement,
    resolveEntityEffect,
    resolveTemplate
} from '../../core/util.js';
import { ActorCombat } from './combat.js';
import { ActorIdentity } from './identity.js';
import { ActorItems } from './items.js';
import { ActorMovement } from './movement.js';
import { ActorPassives } from './passives.js';
import { ActorStates } from './states.js';
import { Entity } from '../entity.js';
import { Item } from '../item.js';

export class Actor extends Entity {
    /**
     * State properties that act on a mind: they change how their holder takes turns,
     * or are player-perception effects. A state declaring any of these needs
     * `sentient` or `controlled` — see isMindState().
     */
    static MIND_STATE_PROPERTIES = [
        'skip_turn', 'skip_turn_chance', 'skip_every_other_turn', 'extra_turn',
        'random_movement', 'discordant', 'hallucinating', 'player_only'
    ];

    constructor(x, y, type, data, engine) {
        super(x, y, type, engine);
        this.name = data.name || type;
        // Per-instance template variables, the same seam Item has. Lets an actor's
        // name or message read "[color] lever" and take the paired color from data,
        // instead of the engine gluing a color word onto the front of the name.
        this.templateVars = { ...(data.template_vars || {}) };
        this.height = 2;
        this.tint = parseTint(data.tint);
        this.originalTint = this.tint;
        this.effect = resolveEntityEffect(data);
        this.visionRange = data.vision_range ?? 8;

        this.tileIndexBase = engine.spriteLibrary.resolveTile(data.tileIndexBase) || null;
        this.animationBase = data.animationBase || null;

        this.tileIndexTop = engine.spriteLibrary.resolveTile(data.tileIndexTop) || null;
        this.animationTop = data.animationTop || null;

        // Legacy support: if 'animated' is true with 'animation_frames', treat as animationBase
        if (data.animated && data.animation_frames) {
            this.animationBase = data.animation_frames;
        }

        this.flipBaseH = data.flipBaseH || false;
        this.flipBaseV = data.flipBaseV || false;
        this.flipTopH = data.flipTopH || false;
        this.flipTopV = data.flipTopV || false;

        this.tileIndexSide = engine.spriteLibrary.resolveTile(data.tileIndexSide) || null;
        this.animationSide = data.animationSide || null;
        this.flipSideH = data.flipSideH || false;
        this.flipSideV = data.flipSideV || false;
        this.sideOffset = data.sideOffset || { dx: 1, dy: 0 };

        this.facing = data.defaultFacing || 'left';
        this.defaultFacing = data.defaultFacing || 'left';
        this.facingEnabled = data.facingEnabled || false;

        this.spriteBase = null;
        this.spriteTop = null;
        this.spriteSide = null;

        this.equipment = {
            weapon: null,
            top: null,
            middle: null,
            lower: null,
            ring1: null,
            ring2: null
        };
        this.spriteEquipment = {
            weapon: null,
            top: null,
            middle: null,
            lower: null
        };
        

        this.stats = {};

        if (data.stats) {
            Object.entries(data.stats).forEach(([stat, value]) => {
                // Normalize to { max, current, per_turn, ... } format
                // Preserves additional config: fatal, death_message, warnings
                if (typeof value === 'object' && value.max !== undefined) {
                    this.stats[stat] = {
                        ...value, // Preserve all config (fatal, death_message, warnings, etc.)
                        current: value.current !== undefined ? value.current : value.max,
                        per_turn: value.per_turn || 0
                    };
                } else {
                    this.stats[stat] = { max: value, current: value, per_turn: 0 };
                }
            });
        }
        
        this.inventory = [];

        // Temporary states with durations (burning, poisoned, stunned, etc.)
        // Format: { stateName: { duration: N, attachedActor: ref, data: {...} } }
        this.states = {};

        this.personality = null;
        if (data.personality) {
            this.loadPersonality(data.personality);
        }
        
        // Default actor attributes
        this.setAttribute('solid', true);
        this.setAttribute('visible', true);
        this.setAttribute('hostile', false);
        this.setAttribute('sentient', false);
        
        // Apply data attributes
        if (data.attributes) {
            Object.entries(data.attributes).forEach(([key, value]) => {
                this.setAttribute(key, value);
            });
        }

        // Load top-level behavior properties as attributes
        if (data.collision_effect) {
            this.setAttribute('collision_effect', data.collision_effect);
        }
        if (data.collision_sound) {
            this.setAttribute('collision_sound', data.collision_sound);
        }
        if (data.collision_description) {
            this.setAttribute('collision_description', data.collision_description);
        }
        if (data.death_sound) {
            this.setAttribute('death_sound', data.death_sound);
        }
        // What the actor IS, for info panels. Bridged like the fields above because
        // 23 actors already author it at root level, where nothing could read it.
        if (data.description) {
            this.setAttribute('description', data.description);
        }
        if (data.death_description) {
            this.setAttribute('death_description', data.death_description);
        }

        // Copy lifetime for actors that expire (clouds, fire, etc.)
        this.lifetime = data.lifetime || null;

        // Copy light radius for actors with custom light range
        if (data.lightRadius !== undefined) {
            this.lightRadius = data.lightRadius;
        }

        // Store original data for behaviors that need custom properties (traps, fire, etc.)
        this.data = data;

        // Legacy support: load state properties as attributes (open, locked, etc.)
        // New format: define these directly in attributes instead of state
        if (data.state) {
            Object.entries(data.state).forEach(([key, value]) => {
                this.setAttribute(key, value);
            });
        }

        // Store alternate tile indices for state changes
        this.tileIndexBase_open = engine.spriteLibrary.resolveTile(data.tileIndexBase_open) || null;
        this.tileIndexTop_open = engine.spriteLibrary.resolveTile(data.tileIndexTop_open) || null;

        this.tileIndexBase_toggled = engine.spriteLibrary.resolveTile(data.tileIndexBase_toggled) || null;
        this.tileIndexTop_toggled = engine.spriteLibrary.resolveTile(data.tileIndexTop_toggled) || null;
        this.flipBaseV_toggled = data.flipBaseV_toggled || false;
        this.flipTopV_toggled = data.flipTopV_toggled || false;

        // Disguise tiles for `hidden` actors that stand where a wall would be: a
        // hidden door renders as ordinary wall until found, so it leaves no gap.
        // Anything hidden on open floor (traps, pressure plates) omits these and
        // simply goes unsprited instead — see RenderSystem.renderActors.
        this.tileIndexBase_hidden = engine.spriteLibrary.resolveTile(data.tileIndexBase_hidden) || null;
        this.tileIndexTop_hidden = engine.spriteLibrary.resolveTile(data.tileIndexTop_hidden) || null;

        // Handle random color assignment for color-locked doors
        if (data.random_color && this.hasAttribute('color_locked') && engine.currentPrototype) {
            const assignedColor = engine.currentPrototype.assignLockColor();
            if (assignedColor) {
                this.setAttribute('lock_color', assignedColor.color);
                this.templateVars.color = assignedColor.color;
                this.tint = parseTint(assignedColor.hex);
            }
        } else if (data.random_color && engine.globalColors?.length) {
            // Plain variety: an actor that just wants to differ from its siblings
            // (a pack of ghosts, a patch of fungus) rather than pair with a key.
            // Deliberately does NOT touch assignLockColor — that pool is the
            // door/key pairing and a monster drawing from it would break matching.
            const randomColor = randomElement(engine.globalColors);
            this.templateVars.color = randomColor.color;
            this.tint = parseTint(randomColor.hex);
            // originalTint is what effects blend against (see getEffectiveTint), so
            // a per-instance color has to move it too or `flicker_tint` and friends
            // would animate around the authored tint instead.
            this.originalTint = this.tint;
        }

        // Apply innate states (permanent states defined in actor data)
        if (data.innate_states && engine.globalStates) {
            for (const stateName of data.innate_states) {
                const stateData = engine.globalStates[stateName];
                if (stateData) {
                    this.applyState(stateName, stateData, { duration: Infinity, silent: true, innate: true });
                }
            }
        }

        // The 'flies' attribute grants the permanent flying state
        if (this.hasAttribute('flies') && engine.globalStates?.flying && !this.hasState('flying')) {
            this.applyState('flying', engine.globalStates.flying, { duration: Infinity, silent: true, innate: true });
        }

        this.isDead = false;

        // Equipping state for multi-turn armor equipping
        this._equippingItem = null;      // Item currently being equipped
        this._equippingTurnsLeft = 0;    // Turns remaining to finish equipping
        this._equippingTurnsTotal = 0;   // Total turns needed (for progress display)

        this._slowedToggle = false;      // Toggle for skip-every-other-turn (slowed state)
        this._extraActions = 0;          // Extra actions granted by haste
        this._knockedBack = false;       // Whether actor is staggered from knockback

        this.defaultItems = data.default_items || [];
    }

    hasAttribute(key) {
        // Suppression wins over both the base attribute and any grant: a state that
        // takes an attribute away should do so no matter where the attribute came from.
        for (const state of Object.values(this.states)) {
            const off = state.data?.suppresses_attribute;
            if (off === key || (Array.isArray(off) && off.includes(key))) return false;
        }
        if (super.hasAttribute(key)) return true;
        for (const state of Object.values(this.states)) {
            const granted = state.data?.grants_immunity;
            if (granted === key || (Array.isArray(granted) && granted.includes(key))) return true;
            const attr = state.data?.grants_attribute;
            if (attr === key || (Array.isArray(attr) && attr.includes(key))) return true;
        }
        return false;
    }

    /**
     * What this actor IS, for info panels — the actor-side counterpart of
     * Item.getDescription, and memoized for the same reason: the panel is re-read
     * while the player looks at it, so a word that changed each time would read as
     * a rendering glitch.
     *
     * Deliberately says nothing about whether the player has seen this actor or
     * knows it; gating on visibility or identification belongs to the caller.
     * @returns {string|null}
     */
    getDescription() {
        const raw = this.getAttribute('description');
        if (!raw) return null;
        return resolveTemplate(raw, this, { memoize: true });
    }

    /**
     * Whether this actor is worth opening an info panel for.
     *
     * A door, a stairway or a wall has nothing to say that the hover line in the
     * sidebar doesn't already say — and worse, the trait sentence would answer
     * questions nobody asked ("It does not burn and acts on instinct alone."), since
     * `flammable` and `sentient` both speak for their falsy case. So a panel is
     * earned, two ways:
     *
     *   - an authored `description`, which is the designer saying "this is worth
     *     reading about" — that's what gives `turret`, `fungus` and `grave` panels
     *     while their inanimate neighbours stay silent; or
     *   - `sentient`, so a creature always offers its traits and combat forecast
     *     even before anyone has written its flavour text.
     *
     * Fire, gas and liquid are deliberately left out: they carry no description, and
     * they shouldn't get one. Dozens are in play at once, so a panel per tile would
     * fight the map for space while saying the same thing each time — their hover name
     * plus the obvious fact that they're dangerous is the whole message.
     *
     * Deliberately says nothing about visibility — whether the player can SEE this
     * actor is the caller's business (see InputManager.actorAtPointer).
     * @returns {boolean}
     */
    hasInfoPanel() {
        return !!this.getDescription() || this.hasAttribute('sentient');
    }

    /**
     * Observable traits, as phrases ready to join into a sentence.
     *
     * Driven entirely by data/attribute-info.json: an attribute is described only if
     * it has an entry there, so engine plumbing stays invisible and a designer adding
     * an attribute decides for themselves whether the player ever hears about it.
     * Order follows the JSON, so related traits can be grouped by the author.
     *
     * @returns {string[]} Phrases with no subject and no trailing period
     */
    getTraitPhrases() {
        const info = this.engine?.globalAttributeInfo;
        if (!info) return [];

        const phrases = [];
        for (const [attr, entry] of Object.entries(info)) {
            if (attr.startsWith('_')) continue;   // _comment and friends
            const on = !!this.getAttribute(attr);
            // A bare string describes the truthy case only; an object may also speak
            // for the falsy one, which is how "does not burn" gets said at all.
            const phrase = typeof entry === 'string'
                ? (on ? entry : null)
                : (entry && typeof entry === 'object' ? entry[on ? 'true' : 'false'] : null);
            if (phrase) phrases.push(phrase);
        }
        return phrases;
    }

    /**
     * Load default items into actor's inventory
     * Called after actor is spawned and prototype is available
     */
    loadDefaultItems() {
        if (!this.defaultItems.length) {
            // A container with no authored loadout still rolls its `drops` table —
            // folded in here because every spawn path already calls this, so a new
            // one can't forget to fill a chest.
            this.rollContainerContents();
            return;
        }

        for (const itemType of this.defaultItems) {
            const itemData = this.engine.currentPrototype?.getItemData(itemType);
            if (!itemData) {
                console.warn(`Default item '${itemType}' not found for ${this.name}`);
                continue;
            }


            // `itemType` may name a category ("potion"); getItemData rolled a
            // member and reports it as .id, which must be the instance's id.
            const item = new Item(-1, -1, itemData.id || itemType, itemData, this.engine);
            item.owner = this; // Track item owner for per-turn stat messages

            this.inventory.push(item);
            console.log(`${this.name} starts with ${item.name}`);

            // Containers (chests, pedestals) hold their items, never wear them: an
            // equipped crown would draw on top of the chest. A pedestal shows its
            // item through display_inventory instead.
            if (this.hasAttribute('container')) continue;

            // Check stat requirements before auto-equipping
            const { canEquip } = this.canEquipItem(item);
            if (!canEquip) continue;

            // Auto-equip weapons
            if (item.hasAttribute('weapon') && !this.equipment.weapon) {
                this.equipToSlot(item, 'weapon');
            }

            // Auto-equip wearable items
            const slot = item.getAttribute('wearable');
            if (slot && ['top', 'middle', 'lower'].includes(slot)) {
                this.equipToSlot(item, slot);
            }
            if (slot === 'ring') {
                const ringSlot = !this.equipment.ring1 ? 'ring1' :
                                 !this.equipment.ring2 ? 'ring2' : null;
                if (ringSlot) this.equipToSlot(item, ringSlot);
            }
        }

        // Merge stackable items (loadDefaultItems pushes directly, skipping pickUpItem merge)
        for (let i = this.inventory.length - 1; i >= 0; i--) {
            const item = this.inventory[i];
            if (!item.getAttribute('stackable')) continue;
            for (let j = 0; j < i; j++) {
                const existing = this.inventory[j];
                if (existing.canStackWith(item)) {
                    existing.count = (existing.count || 1) + (item.count || 1);
                    if (item.magicDetected) existing.magicDetected = true;
                    this.inventory.splice(i, 1);
                    break;
                }
            }
        }
    }

    /**
     * @param {Actor|null} opener - who opened it. Only used by a trapped container, so
     *   the trap's `trap_apply_state` lands on whoever lifted the lid.
     */
    open(opener = null) {
        if (!this.hasAttribute('openable')) return;
        if (this.hasAttribute('locked')) {
            console.log(`${this.name} is locked`);
            this.engine.playSound?.('plunk3');
            return;
        }

        this.setAttribute('open', true);
        this.setAttribute('solid', false);

        this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase_open);
        this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop_open);

        this.playSound('plunk3');
        console.log(`${this.name} opened`);
        this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} opens.`, { x: this.x, y: this.y });

        // A trapped container spends its trap on the opener instead of yielding loot.
        // `_trapArmed` is set at spawn (see rollContainerContents), so an untrapped
        // chest — or any door — never reaches this path.
        if (this._trapArmed) {
            this._trapArmed = false;
            springTrapPayload(this, opener);
            return;
        }

        // Tell the player what's inside as the lid comes up, rather than making
        // them step in to find out. Names go through the same identification-aware
        // path as pickup messages, so an unidentified potion stays "a murky potion".
        if (this.hasAttribute('container') && opener?.isPlayerControlled?.()) {
            const input = this.engine.inputManager;
            const names = this.inventory.map(item => {
                const named = input?.getEntityNameWithArticle(item) ?? item.name;
                return item.count > 1 ? `${named} (${item.count})` : named;
            });
            if (names.length === 0) {
                input?.showMessage('It is empty.');
            } else {
                const list = names.length === 1 ? names[0]
                    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
                input?.showMessage(`Inside you find ${list}.`, { style: 'discovery' });
            }
        }
    }

    close(silent = false) {
        if (!this.hasAttribute('openable')) return;

        this.setAttribute('open', false);
        this.setAttribute('solid', true);

        this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase);
        this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop);

        console.log(`${this.name} closed`);
        if (!silent) {
            this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} closes.`, { x: this.x, y: this.y });
        }
    }

    /**
     * Is this actor concealed and disguised as something else (a hidden door
     * wearing wall tiles)? Such an actor is sprited and rendered — it just isn't
     * rendered as itself. Hidden actors *without* disguise tiles go unsprited
     * instead, which is the `isUnsprited` case below.
     * @returns {boolean}
     */
    isDisguised() {
        return this.hasAttribute('hidden') && !!this.tileIndexBase_hidden;
    }

    /**
     * Should this actor have no sprites at all right now? True for hidden things
     * lying on open floor (traps, pressure plates), which reveal the floor tile
     * beneath them rather than a disguise.
     * @returns {boolean}
     */
    isUnsprited() {
        return !this.hasAttribute('visible')
            || (this.hasAttribute('hidden') && !this.tileIndexBase_hidden);
    }

    /**
     * The base tile to draw for this actor right now — its disguise while hidden,
     * otherwise its true tile. Sprite creation and reveal both route through this
     * so a disguised actor never flashes its real appearance.
     * @returns {number|null}
     */
    getDisplayTileBase() {
        return this.isDisguised() ? this.tileIndexBase_hidden : this.tileIndexBase;
    }

    /**
     * Top-tile counterpart to getDisplayTileBase.
     * @returns {number|null}
     */
    getDisplayTileTop() {
        return this.isDisguised() ? this.tileIndexTop_hidden : this.tileIndexTop;
    }

    /**
     * The tint to draw with. A disguised actor renders untinted so it matches the
     * plain wall beside it — machine coloring (initializeSwitchTints) would
     * otherwise paint a hidden lever's wall disguise in its machine's hue and
     * announce it. The color is still *assigned*, since it names the lever; it
     * just isn't shown until the thing is found.
     * @returns {number|null}
     */
    getDisplayTint() {
        // 0xFFFFFF, not null: PIXI coerces a null tint to 0 and would paint the
        // disguise solid black, which is even louder than the wrong color.
        return this.isDisguised() ? 0xFFFFFF : this.tint;
    }

    /**
     * Discover this actor: drop the disguise and become what it really is.
     * Mirrors open()/toggle() — flip the attribute, swap the sprites, announce it.
     * A disguised actor already has sprites to retexture; an unsprited one (trap,
     * pressure plate) needs them built now that it has something to show.
     * @returns {boolean} True if it was hidden and is now revealed
     */
    reveal({ silent = false } = {}) {
        if (!this.hasAttribute('hidden')) return false;

        const wasUnsprited = this.isUnsprited();
        this.setAttribute('hidden', false);

        // A lever mounted in a wall is opaque while disguised so it doesn't cut a
        // lever-shaped hole in the fog of war. Data can restore see-through-ness on
        // discovery via `opaque_revealed: false`.
        // (computeLighting rebuilds its solid-actor cache each pass, so the change
        // takes effect on the next lighting update with no invalidation needed.)
        if (this.data?.opaque_revealed !== undefined) {
            this.setAttribute('opaque', this.data.opaque_revealed);
        }

        if (wasUnsprited) {
            this.setAttribute('visible', true);
            this.engine.renderer?.createActorSprites(this);
        } else {
            this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase);
            this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop);
            // The disguise suppressed any machine tint; now that it's dropped, the
            // real color has to be put on the sprites that were already built.
            if (this.tint !== null && this.tint !== undefined) {
                if (this.spriteBase) this.spriteBase.tint = this.tint;
                if (this.spriteTop) this.spriteTop.tint = this.tint;
            }
        }

        // A trap springing under your feet announces itself with its own message,
        // and a lever you just pulled is self-evident — those callers pass silent.
        if (!silent) {
            this.playSound(this.data?.reveal_sound || 'lock');
            const template = this.data?.reveal_message
                || `You discover ${this.getNameWithArticle()}!`;
            const message = resolveTemplate(template, this, {
                providers: { name: () => this.getNameWithArticle() }
            });
            this.engine.inputManager?.showMessage(message, { x: this.x, y: this.y });
        }
        return true;
    }

    toggle() {
        if (!this.hasAttribute('switchable')) return;
        if (this.hasAttribute('one_shot') && this.hasAttribute('toggled')) return;

        // A hidden pressure plate can be trodden on before it's found; discovering
        // it as it fires beats an effect erupting from an invisible source. Silent
        // because switch_message is about to narrate the same moment.
        this.reveal({ silent: true });

        const nowToggled = !this.hasAttribute('toggled');
        this.setAttribute('toggled', nowToggled);

        if (nowToggled && this.tileIndexBase_toggled) {
            this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase_toggled);
            this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop_toggled);
            this._applyToggleFlip(this.spriteBase, this.flipBaseV_toggled, this.x, this.y);
            this._applyToggleFlip(this.spriteTop, this.flipTopV_toggled, this.x, this.y - 1);
        } else {
            this.engine.renderer?.updateSpriteTexture(this.spriteBase, this.tileIndexBase);
            this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop);
            this._applyToggleFlip(this.spriteBase, this.flipBaseV, this.x, this.y);
            this._applyToggleFlip(this.spriteTop, this.flipTopV, this.x, this.y - 1);
        }

        const sound = this.data?.switch_sound || this.getAttribute('collision_sound') || 'tap2';
        this.engine.playSound?.(sound);
        // `[name]` in an authored switch_message resolves to the full display name with
        // its article, so a lever reads "You pull the fire brick lever." Anything else
        // the shared resolver knows — [color], a word list — works here too.
        const template = this.data?.switch_message || `${this.getNameWithArticle(true)} clicks.`;
        const message = resolveTemplate(template, this, {
            providers: { name: () => this.getNameWithArticle() }
        });
        this.engine.inputManager?.showMessage(message, { x: this.x, y: this.y });

        this._propagateSwitchEffects(nowToggled);
    }

    _applyToggleFlip(sprite, flipV, tileX, tileY) {
        if (!sprite) return;
        if (flipV) {
            sprite.anchor.set(0.5, 0.5);
            sprite.x = tileX * TILE_WIDTH + TILE_WIDTH / 2;
            sprite.y = tileY * TILE_HEIGHT + TILE_HEIGHT / 2;
            sprite.scale.y = -1;
        } else {
            sprite.anchor.set(0, 0);
            sprite.x = tileX * TILE_WIDTH;
            sprite.y = tileY * TILE_HEIGHT;
            sprite.scale.y = 1;
        }
    }

    _propagateSwitchEffects(activated) {
        const effects = this.data?.switch_effects;
        if (!effects) return;

        const machineId = this.getAttribute('machine_id');
        let targets;

        if (machineId) {
            targets = this.engine.entityManager.actors.filter(
                a => a !== this && !a.isDead && a.getAttribute('machine_id') === machineId
            );
        } else {
            const radius = this.data?.switch_radius || 10;
            targets = this.engine.entityManager.actors.filter(a => {
                if (a === this || a.isDead) return false;
                if (!a.hasAttribute('gate') && !a.hasAttribute('container') && !a.hasAttribute('switchable')) return false;
                const dist = Math.abs(a.x - this.x) + Math.abs(a.y - this.y);
                return dist <= radius;
            });
        }

        for (const target of targets) {
            // A condition lock may share a machine_id with its guardian (for
            // `killed:linked`); a switch on the same id must not bypass it.
            if (target.getAttribute('unlock_conditions')) continue;
            for (const [key, value] of Object.entries(effects)) {
                if (key === 'open') continue;
                if (activated) {
                    target.setAttribute(key, value);
                } else {
                    if (typeof value === 'boolean') {
                        target.setAttribute(key, !value);
                    }
                }
            }

            if (effects.visible !== undefined) {
                const nowVisible = activated ? effects.visible : !effects.visible;
                if (nowVisible) {
                    if (!target.spriteBase) {
                        this.engine.renderer.createActorSprites(target);
                    }
                    if (target.spriteBase) target.spriteBase.visible = true;
                    if (target.spriteTop) target.spriteTop.visible = true;
                } else {
                    if (target.spriteBase) target.spriteBase.visible = false;
                    if (target.spriteTop) target.spriteTop.visible = false;
                }
            }

            if (target.hasAttribute('openable') && effects.open !== undefined) {
                const shouldOpen = activated ? effects.open : !effects.open;
                if (shouldOpen) {
                    if (target.hasAttribute('locked')) {
                        target.setAttribute('locked', false);
                    }
                    target.open();
                } else {
                    target.close(true);
                }
            }

            target.flash?.();
        }

        this.engine.updateLighting();
    }

    updateInventoryDisplay() {
        if (!this.hasAttribute('display_inventory')) return;
        const item = this.inventory[0];
        if (item && item.tileIndex) {
            if (!this.spriteTop) {
                this.spriteTop = this.engine.renderer?.createActorSprite(
                    this, item.tileIndex, null,
                    this.x * TILE_WIDTH,
                    (this.y - 1) * TILE_HEIGHT,
                    11, {}
                );
            } else {
                this.engine.renderer?.updateSpriteTexture(this.spriteTop, item.tileIndex);
                this.spriteTop.visible = true;
            }
            if (this.spriteTop) this.spriteTop.tint = item.tint ?? 0xFFFFFF;
        } else if (this.spriteTop) {
            if (this.tileIndexTop) {
                this.engine.renderer?.updateSpriteTexture(this.spriteTop, this.tileIndexTop);
                this.spriteTop.tint = this.tint ?? 0xFFFFFF;
            } else {
                this.spriteTop.visible = false;
            }
        }
    }

    spike() {
        if (!this.hasAttribute('openable')) return false;
        if (this.hasAttribute('open')) return false;
        if (this.hasAttribute('locked')) return false;
        if (this.hasAttribute('spiked')) return false;

        this.setAttribute('spiked', true);
        if (!this.stats) this.stats = {};
        this.stats.health = { current: 30, max: 30 };

        this.engine.playSound?.('tap2');
        this.engine.inputManager?.showMessage(
            `You jam a spike into the ${this.name}.`, { x: this.x, y: this.y }
        );
        return true;
    }

    /**
     * Update the tile index for base or top sprite
     * @param {string|Object} tileRef - Tile name string or {x, y} coordinates
     * @param {string} layer - 'base' or 'top'
     */
    updateTileIndex(tileRef, layer = 'base') {
        const tileIndex = this.engine.spriteLibrary.resolveTile(tileRef);
        if (!tileIndex) return;

        if (layer === 'base' && this.spriteBase) {
            this.tileIndexBase = tileIndex;
            this.engine.renderer?.updateSpriteTexture(this.spriteBase, tileIndex);
        } else if (layer === 'top' && this.spriteTop) {
            this.tileIndexTop = tileIndex;
            this.engine.renderer?.updateSpriteTexture(this.spriteTop, tileIndex);
        }
    }

    loadPersonality(personalityName) {
        const personalityData = this.engine.currentPrototype.getPersonality(personalityName);
        if (personalityData) {
            this.personality = new Personality(personalityData, this);
        }
    }
    
    /**
     * Execute turn-based action (called by ROT.Engine)
     * @returns {Promise} Resolves when action is complete
     */
    act() {
        // Monotonic "my turn number", used to cap fire damage at once per turn
        // regardless of how many overlapping fires hit this actor.
        this._turnCount = (this._turnCount || 0) + 1;

        if (this.isPlayerControlled()) this.engine.closePendingConditionLocks();

        // Viewport AI margin: skip entire turn for off-screen actors
        if (this.engine.viewportEnabled && !this.isPlayerControlled()) {
            const ox = this.engine.sectionOriginX;
            const oy = this.engine.sectionOriginY;
            const vw = this.engine.viewportWidth;
            const vh = this.engine.viewportHeight;
            const m = this.engine.aiMargin;
            if (this.x < ox - m || this.x >= ox + vw + m ||
                this.y < oy - m || this.y >= oy + vh + m) {
                return Promise.resolve();
            }
        }

        // Process per-turn stat changes (regeneration, hunger, poison, etc.)
        this.processPerTurnStats();
        if (this.isDead) return Promise.resolve(); // Died from stat depletion

        // Process per-turn stats for items in inventory (recharging staffs, etc.)
        this.processInventoryItemStats();
        this.processRingIdentification();

        // Process active states (burning, poisoned, stunned, etc.)
        this.processStates();
        if (this.isDead) return Promise.resolve(); // Died from state effect

        // Tick states on actors that never take a turn of their own. Only actors
        // with a personality (or the player) are scheduled, so a state applied to
        // inert terrain — a pushable wall left superheated by lava — would otherwise
        // never decrement and never expire. Piggyback on the controlled actor's turn
        // so the sweep happens exactly once per round.
        if (this.isPlayerControlled()) {
            this.engine.entityManager.processUnscheduledStates();
            // Same once-per-round sweep for burning items on the floor (a dropped
            // lit torch or incense), which have no owner to tick them.
            this.engine.entityManager.processGroundItems();
        }

        // Check if incapacitated by a state (stunned, sleeping, etc.)
        if (this.isIncapacitated()) {
            if (this.isPlayerControlled()) {
                this.engine.interfaceManager?.updateSidebar();
                return new Promise(resolve => setTimeout(resolve, 200));
            }
            return Promise.resolve();
        }

        // Check if slowed — skip every other turn
        if (this.hasStateProperty('skip_every_other_turn')) {
            this._slowedToggle = !this._slowedToggle;
            if (this._slowedToggle) {
                return Promise.resolve();
            }
        }

        if (this.rollStateTurnLoss()) return Promise.resolve();

        // Player-controlled actors lock the engine and wait for input
        if (this.isPlayerControlled()) {
            // Grant extra actions from haste (set once per act() call)
            if (this.hasStateProperty('extra_turn')) {
                this._extraActions = 1;
            } else {
                this._extraActions = 0;
            }

            this.engine.turnEngine.lock();

            // Update player info box if visible (reflects stat changes from previous turn)
            this.engine.interfaceManager?.updatePlayerInfo();

            return Promise.resolve();
        }

        // Skip turn if staggered from knockback
        if (this._knockedBack) {
            this._knockedBack = false;
            return Promise.resolve();
        }

        // AI actors execute their personality behaviors
        // Caught in a ward gas that repels it: getting out is the whole turn.
        if (this.personality && !this.escapeWard()) {
            this.personality.execute(this);

            // Hasted actors get a bonus action (no extra state processing)
            if (this.hasStateProperty('extra_turn') && !this.isDead) {
                this.personality.execute(this);
            }
        }

        // In observer mode, lock after each AI turn to allow paced playback
        if (!this.engine.hasControlledActor) {
            this.engine.turnEngine.lock();
        }

        return Promise.resolve();
    }
    
    modify(stat, amount) {
        if (this.stats[stat]) {
            this.stats[stat].current -= amount;
            if (this.stats[stat].current <= 0) {
                this.die();
            }
        }
    }

    /**
     * Centralized stat modification with immediate UI update
     * Use this method for all stat changes to ensure UI stays in sync
     * @param {string} statName - Name of stat to modify (e.g., 'health', 'nutrition')
     * @param {number} amount - Amount to add (negative for damage/reduction)
     * @param {Object} options - { skipUIUpdate: false, source: null }
     * @returns {number|null} New stat value, or null if stat doesn't exist
     */
    modifyStat(statName, amount, options = {}) {
        if (!this.stats || this.stats[statName] === undefined) {
            return null;
        }

        const stat = this.stats[statName];
        let oldValue, newValue;

        if (typeof stat === 'object' && stat.current !== undefined) {
            // Object format: { max, current }
            oldValue = stat.current;
            stat.current = Math.max(0, Math.min(stat.max, stat.current + amount));
            newValue = stat.current;
        } else if (typeof stat === 'number') {
            // Simple number format
            oldValue = stat;
            this.stats[statName] += amount;
            newValue = this.stats[statName];
        } else {
            return null;
        }

        console.log(`${this.name}'s ${statName}: ${oldValue} -> ${newValue} (${amount >= 0 ? '+' : ''}${amount})`);

        // Trigger immediate UI updates
        if (!options.skipUIUpdate) {
            // Update player info box if this is the player
            if (this.isPlayerControlled()) {
                this.engine.interfaceManager?.updatePlayerInfo();
            }
            // Update sidebar actor list (shows all actors' health thermometers)
            this.engine.interfaceManager?.updateSidebar();
        }

        // Note: Death is handled by applyCollisionEffects AFTER showing the attack message
        // Don't call die() here to avoid double death and wrong message order

        return newValue;
    }

    /**
     * Speak a taunt line. Hostile actors say one of these before their first
     * attack ('on_attack') and just before dying ('on_death'). Lines are read
     * from the actor's own `taunts` attribute (a per-actor override) first, then
     * from the personality's `taunts`. Each is an object keyed by occasion:
     *   { "on_attack": ["..."], "on_death": ["..."] }
     *
     * Shown in two places (the dual-display the dialogue feature uses): a short,
     * truncated bubble on the canvas next to the actor, and the full untruncated
     * line in the HTML sidebar. Only fires for actors visible to the player.
     *
     * @param {string} occasion - 'on_attack' or 'on_death'
     * @returns {boolean} true if a taunt was shown
     */
    sayTaunt(occasion) {
        // Only taunt where the player can see it happen.
        if (this.engine.isTileVisible && !this.engine.isTileVisible(this.x, this.y)) {
            return false;
        }

        // Actor-level override wins over the personality's shared lines.
        const taunts = this.getAttribute('taunts') || this.personality?.data?.taunts;
        const lines = taunts && taunts[occasion];
        if (!Array.isArray(lines) || lines.length === 0) return false;

        const line = ROT.RNG.getItem(lines);
        if (!line) return false;

        // Canvas bubble: truncated, dismissed on the next move, and grown out of the
        // speaker — the box is centered in the stack, so the intro is what identifies
        // who spoke when several actors are on screen.
        const iface = this.engine.interfaceManager;
        if (iface?.showTextBox) {
            const CANVAS_TAUNT_LIMIT = 32;
            const short = iface.truncateText ? iface.truncateText(line, CANVAS_TAUNT_LIMIT) : line;
            iface.showTextBox(`taunt_${this.x}_${this.y}`, short, {
                dismissOnMove: true,
                // A tall actor speaks from its head, not its feet.
                growFrom: { x: this.x, y: this.height === 2 ? this.y - 1 : this.y },
            });
        }

        // Sidebar: the full line, visibility-gated by showMessage's {x,y}.
        this.engine.inputManager?.showMessage(line, { x: this.x, y: this.y });

        return true;
    }

    /**
     * Roll this actor's `drops` table: a weighted list of alternatives, exactly one
     * of which wins. An entry with no `item` is the "nothing" outcome, so a drop
     * chance needs no second attribute. `item` resolves as an item id, an item TYPE
     * ("weapon" -> a random weapon, via getItemData), or an entity id ("skull") —
     * which is what lets one table mix buried treasure with a bare skull.
     *
     * Independent of `lode`, which stays the single-item percentage drop it was.
     * @returns {boolean} True if something was spawned
     */
    /**
     * Pick one row from this actor's `drops` table by weight, or null for the
     * "nothing" outcome (a row with no `item`) / no usable table.
     *
     * Split out of `_rollDrops` so a container can roll the same authored table at
     * spawn and keep the result in its inventory, rather than spawning it on the floor.
     */
    _pickDropsRow() {
        const table = this.getAttribute('drops');
        if (!Array.isArray(table) || table.length === 0) return null;

        const weightOf = (row) => (typeof row?.weight === 'number' ? row.weight : 1);
        const total = table.reduce((sum, row) => sum + Math.max(0, weightOf(row)), 0);
        if (total <= 0) return null;

        let roll = ROT.RNG.getUniform() * total;
        for (const row of table) {
            roll -= Math.max(0, weightOf(row));
            if (roll < 0) return row?.item ? row : null;
        }
        return null;
    }

    /**
     * Fill a `container` at spawn. Called once, after `loadDefaultItems`, so an
     * authored `default_items` (including a Tiled per-placement override) always wins
     * and `drops` is only the fallback — a designer's chest holds exactly what they
     * said, a generated one rolls.
     *
     * Authored contents win outright — they suppress both the `drops` roll and the
     * trap, so a chest someone deliberately filled always yields what they put in it.
     * That matters for the generated vault, whose prize is placed this way: a trap
     * there would make the room's guaranteed reward unreachable.
     *
     * Otherwise `trap_chance` rolls first and short-circuits the loot: a trapped chest
     * holds nothing and spends its payload on whoever opens it (see `open`).
     */
    rollContainerContents() {
        if (!this.hasAttribute('container')) return;
        if (this.inventory.length > 0) return;  // authored contents win

        const trapChance = this.getAttribute('trap_chance') || 0;
        if (trapChance > 0 && ROT.RNG.getPercentage() <= trapChance) {
            this._trapArmed = true;
            return;
        }

        const row = this._pickDropsRow();
        if (!row) return;

        const itemData = this.engine.currentPrototype?.getItemData(row.item);
        if (!itemData) return;  // an entity id (e.g. "skull") isn't holdable — skip

        const item = new Item(-1, -1, itemData.id || row.item, itemData, this.engine);
        item.owner = this;
        this.inventory.push(item);
    }

    _rollDrops() {
        const table = this.getAttribute('drops');
        if (!Array.isArray(table) || table.length === 0) return false;

        const weightOf = (row) => (typeof row?.weight === 'number' ? row.weight : 1);
        const total = table.reduce((sum, row) => sum + Math.max(0, weightOf(row)), 0);
        if (total <= 0) return false;

        let roll = ROT.RNG.getUniform() * total;
        let chosen = null;
        for (const row of table) {
            roll -= Math.max(0, weightOf(row));
            if (roll < 0) { chosen = row; break; }
        }
        if (!chosen?.item) return false; // the "nothing" outcome

        // Items first (ids and TYPE names both resolve through getItemData), then
        // entities. getItemData is checked before spawnItem because spawnItem warns
        // on a miss, which would be noise for a legitimate entity name.
        const em = this.engine.entityManager;
        const prototype = this.engine.currentPrototype;
        const isItem = !!prototype?.getItemData?.(chosen.item);
        // An item type with nothing to roll here (treasure in a prototype that
        // defines none) is the "nothing" outcome, not a bad entry.
        if (!isItem && prototype?.types?.[chosen.item]?.domain === 'item') return false;
        const spawned = isItem
            ? em.spawnItem(chosen.item, this.x, this.y)
            : em.spawnEntity(chosen.item, this.x, this.y);

        if (!spawned) {
            console.warn(`${this.name}: drops entry '${chosen.item}' is neither an item nor an entity`);
            return false;
        }

        // Items get an identification-aware article; entities just use their name.
        const template = this.getAttribute('drop_message');
        if (template && this.engine.inputManager) {
            const named = isItem
                ? this.engine.inputManager.getEntityNameWithArticle(spawned, { capitalize: true })
                : spawned.name;
            this.engine.inputManager.showMessage(
                resolveTemplate(template, this, { providers: { name: () => named } }),
                { x: this.x, y: this.y }
            );
        }
        return true;
    }

    /**
     * Kill the actor
     * @param {boolean} spawnRemains - Whether to spawn remains entity (default: true)
     */
    die(spawnRemains = true) {
        // Capture whether this actor affected lighting BEFORE clearing `solid` below —
        // a solid actor casts shadows and blocks light, so its death must trigger a
        // lighting recompute (see the guarded updateLighting() at the end of die()).
        const affectedLighting = this.hasAttribute('solid') || this.hasAttribute('light_source');

        this.isDead = true;
        this.setAttribute('solid', false);
        // Dead actors linger in entityManager.actors; drop this one from the
        // position map now so getActorsAt stops returning it.
        this.engine.entityManager?._posCacheRemove(this);

        // Release this cloud's slot in its emitter's spawn counter. Counted clouds
        // (e.g. sewage's sewer_gas) have multiple death paths — cloud_lifetime,
        // cloud_disperse into mist, etc. — so the decrement must live here in the
        // single death chokepoint, not in one behavior. Clearing the key makes it
        // idempotent if die() is ever called twice. Without this the counter only
        // went down on the cloud_lifetime path; clouds that dispersed leaked their
        // slot until the cap was hit and emission stopped permanently.
        if (this._emitCounterKey) {
            const em = this.engine.entityManager;
            if (em[this._emitCounterKey] > 0) em[this._emitCounterKey]--;
            this._emitCounterKey = null;
        }

        // Hostile actors get a last word before the death message (visibility and
        // taunt-data checks live in sayTaunt). Players don't taunt themselves.
        if (this.personality?.hostile && !this.isPlayerControlled()) {
            this.sayTaunt('on_death');
        }

        // Show death message for visible actors (skip for mass nouns like clouds)
        if (this.hasAttribute('visible') && !this.hasAttribute('mass_noun')) {
            if (this.hasAttribute('spiked') && this.hasAttribute('openable')) {
                this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} splinters open!`, { x: this.x, y: this.y });
            } else if (this.isPlayerControlled()) {
                const restartKey = Object.entries(this.engine.inputManager?.globalKeyMap || {})
                    .find(([, action]) => action === 'reload')?.[0] || 'R';
                this.engine.inputManager?.showMessage(`You die... \n Press ${restartKey} to restart`, { style: 'danger' });
            } else if (this.getAttribute('death_description')) {
                this.engine.inputManager?.showMessage(this.getAttribute('death_description'), { x: this.x, y: this.y });
            } else if (!this.stats || this.stats.health === undefined) {
                // Actors without health (breakable objects like walls)
                this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} crumbles.`, { x: this.x, y: this.y });
            } else {
                this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} dies.`, { x: this.x, y: this.y });
            }
        }

        // Play death sound if specified
        const deathSound = this.getAttribute('death_sound');
        if (deathSound) {
            this.engine.playSound?.(deathSound);
        }

        // Smashing a container costs it some of what it held: each item rolls
        // `smash_loss` independently, so a big haul usually loses part of itself and a
        // small one sometimes survives whole. Breaking in is a real alternative to the
        // key, not a free one — and a locked chest with a lost key is never a dead end.
        if (this.hasAttribute('container') && this.inventory.length > 0) {
            const lossChance = this.getAttribute('smash_loss') || 0;
            if (lossChance > 0) {
                const held = this.inventory.length;
                this.inventory = this.inventory.filter(
                    () => ROT.RNG.getPercentage() > lossChance
                );
                if (this.inventory.length === 0) {
                    this.engine.inputManager?.showMessage(
                        'Whatever was within was destroyed!', { x: this.x, y: this.y }
                    );
                } else if (this.inventory.length < held) {
                    this.engine.inputManager?.showMessage(
                        'Some of the contents are ruined.', { x: this.x, y: this.y }
                    );
                }
            }
        }

        // Drop items (if not already dropped by fall())
        if (this.inventory.length > 0) {
            this.dropItems(false);
        }

        // Spawn remains entity if specified (not when falling into void)
        if (spawnRemains) {
            const remains = this.getAttribute('remains');
            if (remains) {
                this.engine.entityManager.spawnEntity(remains, this.x, this.y);
            }

            // Weighted alternatives table (see _rollDrops), independent of `lode`.
            this._rollDrops();

            // Check for lode drop (e.g., rock_wall drops gold_nugget)
            const lode = this.getAttribute('lode');
            const lodeChance = this.getAttribute('lode_chance') || 0;
            if (lode && lodeChance > 0) {
                const roll = ROT.RNG.getPercentage();
                if (roll <= lodeChance) {
                    const droppedItem = this.engine.entityManager.spawnItem(lode, this.x, this.y);
                    if (droppedItem) {
                        console.log(`${this.name} dropped ${droppedItem.name}!`);
                        if (this.engine.inputManager) {
                            const named = this.engine.inputManager.getEntityNameWithArticle(droppedItem, { capitalize: true });
                            // Shares `drop_message` with the drops table, so an actor
                            // narrates its own loot once. Default keeps the rubble line.
                            const template = this.getAttribute('drop_message') || '[name] falls from the rubble!';
                            this.engine.inputManager.showMessage(
                                resolveTemplate(template, this, { providers: { name: () => named } }),
                                { x: this.x, y: this.y }
                            );
                        }
                    }
                }
            }
        }

        if (this.spriteBase) {
            this.spriteBase.visible = false;
        }
        if (this.spriteTop) {
            this.spriteTop.visible = false;
        }
        if (this.spriteSide) {
            this.spriteSide.visible = false;
        }

        // Hide equipment sprites
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.spriteEquipment[slot]) {
                this.spriteEquipment[slot].visible = false;
            }
        }

        if (this.engine.scheduler) {
            this.engine.scheduler.remove(this);
        }

        // If this was the controlled actor, transition to observer mode
        if (this.isPlayerControlled()) {
            this.engine.onControlledActorDied();
        }

        // Check if this death triggers win conditions
        if (!this.isPlayerControlled() && this.engine.checkWinConditions()) {
            this.engine.unlockWinConditionStairways();
        }
        if (!this.isPlayerControlled()) {
            this.engine.refreshConditionLocks();
        }

        // Check if this death satisfies the prototype's game-win conditions
        if (!this.isPlayerControlled()) {
            this.engine.maybeTriggerGameWin();
        }

        // Update sidebar to reflect death
        this.engine.interfaceManager?.updateSidebar();

        // Recompute lighting this turn if this actor affected it. A solid actor casts
        // shadows (via updateShadows) and blocks light/vision; a light_source emits
        // light. Without this, a dead actor's shadow — or the light it was emitting —
        // lingers until the next incidental updateLighting() (i.e. one turn late).
        // Coalesced so a burst of deaths (e.g. an explosion) triggers one recompute,
        // and position-gated so an off-screen death on a scrolling level is skipped.
        if (affectedLighting) {
            this.engine.requestLightingUpdate(this.x, this.y);
        }
    }

    /**
     * Splitting creatures (e.g. pink jelly): on a non-fatal hit, shrink to half health and
     * spawn a same-type child at half health on a free adjacent tile. Splitting stops once
     * health drops below `split_min_health` (a natural cap), or when there's no free tile.
     * Called from the combat damage path after a non-fatal health hit.
     * @param {Actor} attacker - the actor that dealt the hit (for context/messaging)
     * @returns {boolean} true if a child was produced
     */
    trySplit(attacker) {
        if (this.isDead || !this.hasAttribute('splits')) return false;
        const health = this.stats?.health;
        if (!health || typeof health.current !== 'number') return false;

        const min = this.getAttribute('split_min_health') ?? 2;
        // Use post-hit current health; need enough to halve into two viable (>=1) halves.
        if (health.current < min || health.current < 2) return false;

        // Require a free adjacent tile first — don't shrink the parent without a child.
        const pos = findAdjacentWalkable(this, this.engine.entityManager);
        if (!pos) return false;

        const half = Math.floor(health.current / 2);
        health.current = half;
        health.max = half;

        // Spawn the child: a different type if `split_into` is set (e.g. a large jelly breaks
        // off smaller jellies), otherwise the same type (recursively halving).
        const childType = this.data?.split_into || this.type;
        const child = this.engine.entityManager.spawnActor(childType, pos.x, pos.y);
        if (!child) return false;
        if (child.stats?.health) {
            child.stats.health.max = half;
            child.stats.health.current = half;
        }

        const splitSound = this.getAttribute('split_sound') || this.data?.split_sound;
        if (splitSound) this.engine.playSound?.(splitSound);

        // Message, matching die()'s visibility/position convention (skip mass nouns).
        if (this.hasAttribute('visible') && !this.hasAttribute('mass_noun')) {
            this.engine.inputManager?.showMessage(`${this.getNameWithArticle(true)} splits!`, { x: this.x, y: this.y });
        }

        this.engine.interfaceManager?.updateSidebar?.();
        return true;
    }

    /**
     * Bank a treasure item's value on this actor's running total for it. The total
     * is named by the item's `tally_as`, or its own name, so several treasures can
     * share one ("gold") or each keep their own. Each item adds its `value`
     * (from random_value), or 1 if it has none.
     */
    addTreasure(item) {
        const label = item.getAttribute('tally_as') || item.name;
        const amount = (Number.isFinite(item.value) ? item.value : 1) * (item.count || 1);
        const tally = { ...(this.getAttribute('treasure_tally') || {}) };
        tally[label] = (tally[label] || 0) + amount;
        this.setAttribute('treasure_tally', tally);
    }

    // ========================================================================
    // STATE MANAGEMENT (burning, poisoned, stunned, etc.)
    // ========================================================================

    /**
     * Normalize an authored `apply_state` value into a name and optional duration.
     *
     * The duration in states.json is that state's *default*, not a fact about every
     * source of it — a potion of confusion can reasonably last longer or shorter than
     * confusion from a trap or a monster's attack. So any `apply_state` may be written
     * either as a bare state name (use the state's default duration):
     *
     *     "apply_state": "confused"
     *
     * or as an object that overrides the duration for this source only:
     *
     *     "apply_state": { "state": "confused", "duration": 20 }
     *
     * Duration is in turns; -1 means indefinite (as in states.json).
     *
     * @param {string|Object} value - The authored apply_state value
     * @returns {{name: string|null, duration: number|undefined}}
     */
    static parseApplyState(value) {
        if (typeof value === 'string') return { name: value, duration: undefined };
        if (value && typeof value === 'object' && value.state) {
            return {
                name: value.state,
                duration: typeof value.duration === 'number' ? value.duration : undefined
            };
        }
        return { name: null, duration: undefined };
    }

    /**
     * Does this state act on a mind, rather than on a body or a thing?
     *
     * Derived from the properties a state already declares (see
     * MIND_STATE_PROPERTIES) rather than a separate field in states.json — a wall
     * has no turn to skip and no view to scramble. Everything else (burning,
     * poisoned, stuck) can attach to any actor.
     *
     * @param {Object} stateData - State configuration from states.json
     * @returns {boolean} True if the state requires a mind
     */
    static isMindState(stateData) {
        if (!stateData) return false;
        return Actor.MIND_STATE_PROPERTIES.some(prop => stateData[prop]);
    }

    canSeeTarget(target) {
        if (!target) return false;

        if (target.hasStateProperty?.('invisible')) return false;

        const distance = getEuclideanDistance(this.x, this.y, target.x, target.y);
        let effectiveRange = this.getEffectiveVisionRange();

        const lm = this.engine.lightingManager;
        if (lm && !this.isPlayerControlled() && !this.hasAttribute('dark_vision')) {
            const targetLight = lm.getLightLevel(target.x, target.y)?.intensity ?? 1;
            if (targetLight < 0.1) {
                effectiveRange = Math.min(effectiveRange, 1.5);
            } else if (targetLight < 1.0) {
                effectiveRange = Math.max(1.5, effectiveRange * targetLight);
            }
        }

        if (distance > effectiveRange) return false;

        const isBlocked = (x, y) => {
            if (!this.hasFloorAt(x, y) && !this.hasPlatformAt(x, y)) return true;
            const actorAt = this.engine.entityManager.getSolidActorAt(x, y);
            if (actorAt && actorAt !== this && actorAt !== target) {
                return true;
            }
            // Non-solid cover: tall mushrooms are walkable but head-high, so they
            // conceal from AI the same way they block the player's own vision.
            // Deliberately additive rather than switching this test to opacity
            // outright — most creatures are `opaque: false` so they don't cast
            // shadows, and honoring that here would let archers fire through a
            // whole crowd of their own kind.
            const opaqueAt = this.engine.entityManager.getSightBlockerAt(x, y);
            if (opaqueAt && opaqueAt !== this && opaqueAt !== target) {
                return true;
            }
            return false;
        };

        return hasLineOfSight(this.x, this.y, target.x, target.y, isBlocked);
    }

    /**
     * True if this actor's id or its actor type (e.g. 'skeleton' or 'undead') is
     * listed in `types`. Ward gases use this to pick out who they affect.
     * @param {string[]} types
     */
    matchesActorType(types) {
        if (!Array.isArray(types) || types.length === 0) return false;
        return types.includes(this.type) || types.includes(this.data?.type);
    }

    /**
     * True if a `ward` affects this actor: its id or type is listed in `types`,
     * or the ward is `hostile` (sacred glyphs) and this is a hostile creature.
     * @param {Object} ward
     */
    isWardedBy(ward) {
        if (this.matchesActorType(ward.types)) return true;
        if (!ward.hostile || this.isPlayerControlled()) return false;
        return !!this.personality?.hostile || this.hasAttribute('hostile');
    }

    /**
     * True if an actor on (x, y) carries a `ward` that repels this actor — incense
     * smoke against the undead. Repelled actors won't path, step, or attack into
     * the tile, and step out of it if the gas drifts over them.
     */
    isRepelledAt(x, y) {
        for (const other of this.engine.entityManager.getActorsAt(x, y)) {
            if (other === this || other.isDead) continue;
            const ward = other.getAttribute('ward');
            if (ward?.repel && this.isWardedBy(ward)) return true;
        }
        return false;
    }

    /**
     * Step out of a repelling ward gas this actor is standing in, onto any
     * adjacent tile that's clear of it. Returns true if it moved (its turn).
     */
    escapeWard() {
        if (!this.isRepelledAt(this.x, this.y)) return false;
        const exits = ALL_DIRS
            .map(d => ({ x: this.x + d.dx, y: this.y + d.dy }))
            .filter(p => this.isPassableAt(p.x, p.y) && !this.isHazardAt(p.x, p.y));
        if (exits.length === 0) return false;
        const exit = randomElement(exits);
        return this.tryMove(exit.x, exit.y).moved;
    }

    /**
     * Check if a tile is passable for pathfinding purposes
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {boolean} True if the tile can be walked through
     */
    isPassableAt(x, y) {
        // Check bounds
        if (x < 0 || x >= this.engine.mapManager.width ||
            y < 0 || y >= this.engine.mapManager.height) {
            return false;
        }

        // Pathfinding routes around ward gas that repels this actor.
        if (this.isRepelledAt(x, y)) return false;

        // Aquatic actors (eels) may only enter tiles that contain a liquid actor;
        // dry land and lava (no 'liquid' attribute) are impassable to them.
        if (this.hasAttribute('aquatic') && !this.engine.entityManager._getLiquidActorAt(x, y)) {
            return false;
        }

        // Check for floor or platform
        if (!this.hasFloorAt(x, y) && !this.hasPlatformAt(x, y)) return false;

        // Check for solid actors (but allow the actor's own position)
        const actorAt = this.engine.entityManager.getSolidActorAt(x, y);
        if (actorAt && actorAt !== this) {
            return false;
        }

        return true;
    }

    /**
     * Move toward a target position using A* pathfinding
     * Falls back to simple directional movement if no path found
     * @param {number} targetX - Target X coordinate
     * @param {number} targetY - Target Y coordinate
     * @returns {boolean} True if movement was attempted
     */
    moveToward(targetX, targetY) {
        if (this.x === targetX && this.y === targetY) return false;

        const hasFloor = (x, y) => this.hasFloorAt(x, y) || this.hasPlatformAt(x, y);
        // Only blocks_diagonal actors block diagonal corner moves; creatures and voids don't.
        const isCornerWall = (x, y) => this.engine.entityManager.blocksDiagonalAt(x, y);

        // Route around lava, fire and other hazards this actor isn't immune to,
        // on the A* path and the directional fallback alike.
        const isSafe = (x, y) => hasFloor(x, y) && !this.isHazardAt(x, y);

        const isPassable = (x, y) => {
            if (x === targetX && y === targetY) return true;
            return this.isPassableAt(x, y) && !this.isHazardAt(x, y);
        };

        const nextStep = getNextPathStep(this.x, this.y, targetX, targetY, isPassable, { hasFloor, isCornerBlocker: isCornerWall });

        if (nextStep) {
            const result = this.tryMove(nextStep.x, nextStep.y);
            if (result.moved || result.actionTaken) return true;
        }

        // No path or path step failed — fall back to simple directional movement
        const dx = Math.sign(targetX - this.x);
        const dy = Math.sign(targetY - this.y);

        if (Math.abs(targetX - this.x) > Math.abs(targetY - this.y)) {
            if (dx !== 0 && isSafe(this.x + dx, this.y)) {
                const result = this.tryMove(this.x + dx, this.y);
                if (result.moved || result.actionTaken) return true;
            }
            if (dy !== 0 && isSafe(this.x, this.y + dy)) {
                const result = this.tryMove(this.x, this.y + dy);
                if (result.moved || result.actionTaken) return true;
            }
        } else {
            if (dy !== 0 && isSafe(this.x, this.y + dy)) {
                const result = this.tryMove(this.x, this.y + dy);
                if (result.moved || result.actionTaken) return true;
            }
            if (dx !== 0 && isSafe(this.x + dx, this.y)) {
                const result = this.tryMove(this.x + dx, this.y);
                if (result.moved || result.actionTaken) return true;
            }
        }

        // Diagonal only if the destination is safe floor and no wall corner is being
        // cut (voids don't block — see isDiagonalBlocked). Reuses isCornerWall
        // defined above.
        if (dx !== 0 && dy !== 0 && isSafe(this.x + dx, this.y + dy) &&
            !isDiagonalBlocked(this.x, this.y, this.x + dx, this.y + dy, isCornerWall)) {
            const result = this.tryMove(this.x + dx, this.y + dy);
            if (result.moved || result.actionTaken) return true;
        }

        return false;
    }

    serialize() {
        return {
            ...super.serialize(),
            stats: JSON.parse(JSON.stringify(this.stats)),
            templateVars: { ...this.templateVars },
            inventory: this.inventory.map(item => item.serialize()),
            personality: this.personality?.name,
            isDead: this.isDead,
            facing: this.facing,
            equipment: {
                weapon: this.equipment.weapon?.type || null,
                top: this.equipment.top?.type || null,
                middle: this.equipment.middle?.type || null,
                lower: this.equipment.lower?.type || null,
                ring1: this.equipment.ring1?.type || null,
                ring2: this.equipment.ring2?.type || null
            },
            states: JSON.parse(JSON.stringify(
                Object.fromEntries(
                    Object.entries(this.states || {}).map(([k, v]) => [k, { duration: v.duration, data: v.data }])
                )
            )),
            isActor: true
        };
    }

    deserialize(data) {
        super.deserialize(data);
        if (data.stats) this.stats = JSON.parse(JSON.stringify(data.stats));
        if (data.templateVars) this.templateVars = { ...data.templateVars };
        if (data.isDead !== undefined) this.isDead = data.isDead;
        if (data.facing !== undefined) this.facing = data.facing;
        if (data.states) this.states = JSON.parse(JSON.stringify(data.states));
        // Reconstruct inventory items
        if (data.inventory) {
            this.inventory = data.inventory.map(itemData => {
                const itemDef = this.engine.currentPrototype.getItemData(itemData.type);
                if (!itemDef) return null;
                const item = new Item(itemData.x, itemData.y, itemData.type, itemDef, this.engine);
                item.deserialize(itemData);
                item.owner = this;
                return item;
            }).filter(Boolean);
            // Re-link equipment slots
            if (data.equipment) {
                const linked = new Set();
                for (const [slot, itemType] of Object.entries(data.equipment)) {
                    if (itemType) {
                        const item = this.inventory.find(i => i.type === itemType && !linked.has(i));
                        if (item) {
                            this.equipment[slot] = item;
                            linked.add(item);
                        }
                    }
                }
            }
        }
        if (data.personality) {
            this.loadPersonality(data.personality);
        }
    }
}

installMethods(Actor, ActorItems, ActorStates, ActorCombat, ActorIdentity, ActorMovement, ActorPassives);
