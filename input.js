
// ============================================================================
// INPUT MANAGER
// ============================================================================

// A deliberate search takes this many turns
const SEARCH_TURNS = 5;

const THOROUGH_SEARCH_STRENGTH = 200;
const THOROUGH_SEARCH_RADIUS = 5;

// The passive glance you get just for standing somewhere new, before awareness.
const PASSIVE_SEARCH_STRENGTH = 30;

/**
 * Is this actor somewhere the player would plausibly want to walk to?
 *
 * @param {Object} actor - The candidate actor
 * @returns {boolean} True if the actor is worth offering as a travel target
 */
/**
 * Is this actor hostile to the player?
 *
 *
 * @param {Object} actor - The candidate actor
 * @returns {boolean} True if the actor should be treated as an enemy
 */
function isHostileActor(actor) {
    if (!actor?.hasAttribute) return false;
    return !!(actor.hasAttribute('collision_effect') ||
              actor.personality?.hostile ||
              actor.hasAttribute('hostile'));
}

/**
 * Category predicates for aim targeting, keyed by the token used in an item's
 * `target_filter`. Each answers "is this actor a valid stop for this token?".
 *
 * Kept separate from isTravelTarget: that asks "would the player walk here", which
 * excludes exactly the things you most want to aim at (traps, fire, lava).
 */
const AIM_TARGET_PREDICATES = {
    // Enemies. The common case, and the default for both throwing and zapping.
    //
    // Solidity is what separates a creature from the diffuse terrain that also reads
    // as hostile: mist and sewer gas carry an (empty) collision_effect, so they pass
    // the hostility test and used to turn up as throw targets. Note this gate can't
    // be applied to the whole target list — every trap is non-solid, and traps are
    // deliberately targetable.
    hostile: (actor) => isHostileActor(actor) && actor.hasAttribute('solid'),

    // Friendlies worth a beneficial effect: has a health stat to affect, isn't an
    // enemy, isn't scenery, and isn't the caster themselves.
    ally: (actor) => !isHostileActor(actor) &&
                     !actor.hasAttribute('trap') &&
                     !actor.hasAttribute('controlled') &&
                     actor.hasAttribute('solid') &&
                     actor.stats?.health !== undefined,

    // Traps, so a thrown object can spring one from a safe distance. An
    // undiscovered trap is skipped — offering it as a target would give away its
    // position.
    trap: (actor) => actor.hasAttribute('trap') && !actor.hasAttribute('hidden')
};

/**
 * Tokens that select map tiles rather than actors. Handled separately because
 * collectAimTargets walks the actor list, and these need a tile scan instead.
 */
const AIM_TILE_TOKENS = new Set(['tile']);

/**
 * Build the list of aim targets for a throw or a zap, nearest first.
 *
 * Unlike collectTargets (used by travel), candidates are NOT probed for a walkable
 * path — you can throw across a chasm or over water, so reachability on foot is the
 * wrong test. Straight-line distance is all that matters.
 *
 * @param {Object} engine - The engine, for FOV and entity lookups
 * @param {string[]} tokens - Category tokens from an item's target_filter
 * @param {Object} [origin] - Actor to measure distance from (defaults to the player)
 * @returns {Array<{x: number, y: number, entity: Object, dist: number}>} Sorted candidates
 */
function collectAimTargets(engine, tokens, origin = null) {
    const em = engine?.entityManager;
    const from = origin || em?.player;
    if (!em || !from) return [];

    const preds = tokens.map(t => AIM_TARGET_PREDICATES[t]).filter(Boolean);
    const wantsTiles = tokens.some(t => AIM_TILE_TOKENS.has(t));
    // Tile tokens have no entry in AIM_TARGET_PREDICATES, so bail out only when
    // neither kind of token matched — otherwise a ["tile"] filter returns nothing.
    if (preds.length === 0 && !wantsTiles) return [];

    const candidates = [];

    // Tile tokens scan the map instead of the actor list. Used by self-teleport
    // effects (staff of blinking), where the useful target is open floor and an
    // enemy-only list would point everywhere except where you want to go.
    if (wantsTiles) {
        for (let y = 0; y < (engine.mapManager?.height || 0); y++) {
            for (let x = 0; x < (engine.mapManager?.width || 0); x++) {
                if (x === from.x && y === from.y) continue;
                if (!engine.isTileVisible(x, y)) continue;
                if (from.isPassableAt && !from.isPassableAt(x, y)) continue;
                candidates.push({
                    x, y,
                    entity: null,
                    dist: Math.max(Math.abs(x - from.x), Math.abs(y - from.y))
                });
            }
        }
    }

    for (const actor of em.actors) {
        if (actor.isDead || actor === from) continue;
        if (!engine.isTileVisible(actor.x, actor.y)) continue;
        // Same invisibility rule the sidebar uses: an invisible actor stays off the
        // list unless it's one of yours.
        if (actor.hasStateProperty?.('invisible') && !actor.hasAttribute('controlled')) continue;
        // Union semantics — matching any one token is enough.
        if (!preds.some(p => p(actor))) continue;

        candidates.push({
            x: actor.x,
            y: actor.y,
            entity: actor,
            dist: Math.max(Math.abs(actor.x - from.x), Math.abs(actor.y - from.y))
        });
    }

    candidates.sort((a, b) => a.dist - b.dist);
    return candidates;
}

/**
 * Which target categories should an item offer?
 *
 * An unidentified staff or wand must not reveal its nature through its target list:
 * if it skipped your allies, you'd know it was offensive before learning anything.
 * So identification is checked FIRST and overrides target_filter entirely, and every
 * unidentified item returns the same uniform list — comparing two unknown items
 * against each other leaks nothing either.
 *
 * @param {Object} item - The item being aimed
 * @param {string[]} defaultTokens - Tokens to use when the item declares none
 * @returns {string[]} Category tokens for collectAimTargets
 */
function getAimTargetTokens(item, defaultTokens) {
    if (item && item.identified === false) return ['hostile', 'ally'];
    const declared = item?.getAttribute?.('target_filter');
    if (Array.isArray(declared) && declared.length > 0) return declared;
    return defaultTokens;
}

function isTravelTarget(actor) {
    if (!actor?.hasAttribute) return false;

    // An undiscovered secret is not a destination. Without this a hidden door or
    // lever would show up as a Tab-stop and point straight at itself, since both
    // qualify as landmarks below.
    if (actor.hasAttribute('hidden')) return false;

    // Never route the player onto a hazard or into scenery.
    if (actor.hasAttribute('trap')) return false;
    if (actor.hasAttribute('liquid')) return false;
    if (actor.hasAttribute('damage_type')) return false;   // lava, fire
    if (actor.hasAttribute('ignites')) return false;
    if (actor.hasAttribute('mass_noun')) return false;      // clouds, mist, gas, spores

    // Structural landmarks and interactables worth crossing a level for.
    if (actor.hasAttribute('openable')) return true;        // doors, gates
    if (actor.hasAttribute('stairway')) return true;
    if (actor.hasAttribute('portal')) return true;
    if (actor.hasAttribute('teleporter')) return true;
    if (actor.hasAttribute('switchable')) return true;      // levers, pressure plates
    if (actor.hasAttribute('container')) return true;       // chests, pedestals

    // Creatures. `sentient` covers most (usually via a type), but not all: a turret
    // is hostile without a mind, and the sentries declare no attributes at all, so
    // fall back to "hostile" and then to "has a health stat" — a thing that can be
    // fought is a thing worth walking to.
    if (actor.hasAttribute('sentient')) return true;
    if (actor.hasAttribute('hostile')) return true;
    return actor.stats?.health !== undefined;
}

class InputManager {
    constructor(engine) {
        this.engine = engine;
        this.enabled = true;

        // Mouse tracking
        this.hoveredTile = { x: -1, y: -1 };
        this.descriptionElement = document.getElementById('description');
        this.currentCanvas = null;
        this.boundMouseMove = null;
        this.boundMouseLeave = null;

        // Touch state
        this.touchStartPos = null;
        this.touchStartTime = null;
        this.longPressTimer = null;
        this.longPressThreshold = 500;
        this.tapMoveThreshold = 15;
        this.longPressTriggered = false;
        this.lastTouchTime = 0;
        this.boundTouchStart = null;
        this.boundTouchMove = null;
        this.boundTouchEnd = null;
        this.boundTouchCancel = null;

        // Message stacking for turn-based events
        this.messageStack = [];

        // Auto-walk state
        this.autoWalkPath = null; 
        this.autoWalkIndex = 0;
        this.autoWalking = false;
        this.autoWalkDelay = 100; // Milliseconds between steps (2 steps per second)

        // Auto-explore state (the (x)plore action). Reuses the auto-walk stepper
        // machinery but computes its own destination each leg (nearest unexplored
        // frontier / loot) instead of walking to a clicked tile.
        this.exploring = false;        // Whether auto-explore is in progress
        this.exploreLegPath = null;    // Current leg's path toward the chosen target
        this.exploreLegIndex = 0;      // Position within the current leg
        this.exploreStepsTaken = 0;    // Steps taken this whole explore session
        this.exploreHpSnapshot = null; // Player HP at the last step (stop-on-damage)
        this.exploreStateSnapshot = null; // Harmful-state set at last step (stop-on-bad-state)
        this.exploreArmed = false;
        this.exploreArmedTarget = null;
        this.searching = false;
        this.searchTurnsLeft = 0;
        this.searchedTiles = new Set();
        // Tab target-cycling: index into the last-built candidate list, so repeated
        // presses walk through reachable points of interest. Reset when the preview
        // is disarmed so the next cycle starts fresh from the nearest target.
        this.targetCycleIndex = -1;

        // Turn history - stores all past turns for future history viewer
        // Each entry is an array of messages from that turn
        this.turnHistory = [];
        // Number of recent turns to display (current + 2 older)
        this.visibleTurnCount = 3;
        // Temporary hover description (doesn't affect turn history)
        this.hoverDescription = null;

        // Movement, action and global keys all loaded from data/keybindings.json
        this.keyMap = {};
        this.loadKeybindings(engine.globalKeybindings || {});

        // Direction vectors for movement actions
        this.directions = {
            'move_up': { dx: 0, dy: -1 },
            'move_down': { dx: 0, dy: 1 },
            'move_left': { dx: -1, dy: 0 },
            'move_right': { dx: 1, dy: 0 },
            'move_up_left': { dx: -1, dy: -1 },
            'move_up_right': { dx: 1, dy: -1 },
            'move_down_left': { dx: -1, dy: 1 },
            'move_down_right': { dx: 1, dy: 1 }
        };

        this.setupListeners();
    }

    /**
     * Build the key → action lookup from a keybindings definition.
     *
     * Movement lives in its own `movement` block (rather than being hardcoded) so a
     * designer can rebind or remove it — freeing letter keys for command hotkeys.
     * Movement is loaded first so `actions` wins on any collision, letting a prototype
     * claim a key that movement holds by default.
     *
     * @param {Object} bindings - { movement, actions, global } key→action maps
     */
    loadKeybindings(bindings) {
        this.keyMap = {};

        if (bindings.movement) {
            for (const [key, action] of Object.entries(bindings.movement)) {
                this.bindKey(this.keyMap, key, action);
            }
        }

        if (bindings.actions) {
            for (const [key, action] of Object.entries(bindings.actions)) {
                this.bindKey(this.keyMap, key, action);
            }
        }

        this.globalKeyMap = {};
        if (bindings.global) {
            for (const [key, action] of Object.entries(bindings.global)) {
                this.bindKey(this.globalKeyMap, key, action);
            }
        }
    }

    /**
     * Register one binding, also aliasing a bare lowercase letter to its uppercase form
     * so the action still fires with caps lock on or shift held.
     *
     * Skipped for modifier-prefixed bindings ("Shift+ArrowLeft"): those are matched by
     * an explicitly-built lookup name, and a shifted letter already arrives as its own
     * uppercase character (which is how "R" for reload works).
     */
    bindKey(map, key, action) {
        map[key] = action;
        if (!key.includes('+') && key.length === 1 && key >= 'a' && key <= 'z') {
            map[key.toUpperCase()] = action;
        }
    }

    /**
     * The key currently bound to an action, formatted for display in a message.
     *
     * Player-facing text should never name a key literally — a prototype can rebind
     * anything, so "press x" goes stale the moment someone does.
     *
     * Prefers the lowercase form of a letter binding, since bindKey aliases letters to
     * their uppercase form and Object.keys order would otherwise sometimes surface "X".
     *
     * @param {string} action - The bound action name (e.g. 'explore')
     * @param {string} [fallback] - Returned when the action isn't bound at all
     * @returns {string} A display-ready key name (e.g. 'x', 'Space', 'Esc')
     */
    getKeyForAction(action, fallback = '?') {
        const matches = Object.keys(this.keyMap).filter(k => this.keyMap[k] === action)
            .concat(Object.keys(this.globalKeyMap || {}).filter(k => this.globalKeyMap[k] === action));
        if (matches.length === 0) return fallback;

        // A single lowercase letter reads best; otherwise take the first binding.
        const preferred = matches.find(k => k.length === 1 && k >= 'a' && k <= 'z') || matches[0];
        return InputManager.formatKeyName(preferred);
    }

    /**
     * Shorten a raw key name for display ("ArrowUp" -> "Up", " " -> "Space").
     * Keeps a modifier prefix, splitting on the LAST '+' so a literal '+' survives.
     */
    static formatKeyName(key) {
        const plus = key.lastIndexOf('+');
        if (plus > 0) {
            return key.slice(0, plus + 1) + InputManager.formatKeyName(key.slice(plus + 1));
        }
        if (key === ' ') return 'Space';
        if (key === 'Escape') return 'Esc';
        if (key.startsWith('Arrow')) return key.slice(5);
        if (key.startsWith('Numpad')) return 'Num' + key.slice(6);
        return key;
    }

    /**
     * Resolve a keydown event to a bound action.
     *
     * Modifier-prefixed bindings are checked first and most-specific-first, so
     * "Shift+ArrowLeft" beats a plain "ArrowLeft" when shift is down. This matters for
     * non-printing keys: Shift+ArrowLeft reports the same `key`/`code` as an unshifted
     * press, so without the prefix there'd be no way to tell them apart. A shifted
     * *letter* needs no prefix — it arrives as its own uppercase character.
     *
     * @param {Object} map - key → action lookup
     * @param {KeyboardEvent} event
     * @returns {string|undefined} The bound action, if any
     */
    /**
     * Resolve a raw keydown event to its bound action name, checking both maps.
     *
     * The inverse of getKeyForAction, and the one to use when deciding whether a key
     * press means a given action: modal handlers (throw/spell aiming) receive raw
     * events before the normal dispatch runs, so comparing event.key to a literal
     * like 'Tab' would ignore the player's keybindings. Ask for the action instead.
     *
     * @param {KeyboardEvent} event - The raw keydown event
     * @returns {string|undefined} The bound action name, or undefined if unbound
     */
    getActionForKey(event) {
        if (!event) return undefined;
        return this.lookupBinding(this.keyMap, event) ??
               this.lookupBinding(this.globalKeyMap || {}, event);
    }

    lookupBinding(map, event) {
        let prefix = '';
        if (event.ctrlKey) prefix += 'Ctrl+';
        if (event.altKey) prefix += 'Alt+';
        if (event.shiftKey) prefix += 'Shift+';

        if (prefix) {
            const modified = map[prefix + event.key] ?? map[prefix + event.code];
            if (modified) return modified;
        }

        return map[event.key] ?? map[event.code];
    }

    setupListeners() {
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));

        // Setup mouse listeners once the canvas is available
        this.setupMouseListeners();
    }

    setupMouseListeners() {
        // Wait for the canvas to be available
        const checkCanvas = () => {
            const canvas = this.engine.app?.view;
            if (canvas && canvas !== this.currentCanvas) {
                // Remove listeners from old canvas if exists
                if (this.currentCanvas) {
                    this.currentCanvas.removeEventListener('mousemove', this.boundMouseMove);
                    this.currentCanvas.removeEventListener('mouseleave', this.boundMouseLeave);
                    this.currentCanvas.removeEventListener('click', this.boundMouseClick);
                    this.currentCanvas.removeEventListener('touchstart', this.boundTouchStart);
                    this.currentCanvas.removeEventListener('touchmove', this.boundTouchMove);
                    this.currentCanvas.removeEventListener('touchend', this.boundTouchEnd);
                    this.currentCanvas.removeEventListener('touchcancel', this.boundTouchCancel);
                }

                // Store bound handlers so we can remove them later
                this.boundMouseMove = (e) => this.handleMouseMove(e);
                this.boundMouseLeave = () => this.handleMouseLeave();
                this.boundMouseClick = (e) => this.handleMouseClick(e);
                this.boundTouchStart = (e) => this.handleTouchStart(e);
                this.boundTouchMove = (e) => this.handleTouchMove(e);
                this.boundTouchEnd = (e) => this.handleTouchEnd(e);
                this.boundTouchCancel = (e) => this.handleTouchCancel(e);

                canvas.addEventListener('mousemove', this.boundMouseMove);
                canvas.addEventListener('mouseleave', this.boundMouseLeave);
                canvas.addEventListener('click', this.boundMouseClick);
                canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
                canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
                canvas.addEventListener('touchend', this.boundTouchEnd, { passive: false });
                canvas.addEventListener('touchcancel', this.boundTouchCancel);
                this.currentCanvas = canvas;
            }

            // Keep checking periodically in case canvas changes (prototype reload)
            setTimeout(checkCanvas, 500);
        };
        checkCanvas();
    }

    handleMouseMove(event) {
        if (!this.enabled) return;

        const canvas = this.engine.app?.view;
        if (!canvas) return;

        // Get mouse position relative to canvas
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Account for canvas scaling (canvas is displayed at half size)
        const scaleX = this.engine.canvasWidth / rect.width;
        const scaleY = this.engine.canvasHeight / rect.height;

        // Convert to tile coordinates (add viewport offset for scrolled maps)
        const mapPixelX = (mouseX * scaleX) - (this.engine.viewportOffsetX || 0);
        const mapPixelY = (mouseY * scaleY) - (this.engine.viewportOffsetY || 0);
        const tileX = Math.floor(mapPixelX / this.engine.config.tileWidth);
        const tileY = Math.floor(mapPixelY / this.engine.config.tileHeight);

        // Only update if tile changed
        if (tileX !== this.hoveredTile.x || tileY !== this.hoveredTile.y) {
            this.hoveredTile.x = tileX;
            this.hoveredTile.y = tileY;

            this.updateDescription(tileX, tileY);
            this.updateTileHighlight(tileX, tileY);
            this.updateHoverInfo(tileX, tileY);

            // Update throw path if in aiming mode
            if (this.engine.interfaceManager?.isThrowAiming()) {
                this.engine.interfaceManager.updateThrowPath();
            } else if (this.engine.interfaceManager?.isSpellAiming()) {
                // Update spell path if in spell aiming mode
                this.engine.interfaceManager.updateSpellPath();
            } else if (!this.autoWalking) {
                // Mousing over the map replaces any armed explore preview with the
                // hover path, so disarm the pending (x)plore travel to keep the
                // on-screen path and the armed target in sync.
                this.cancelExplorePreview();
                // Show walk path when not in special modes
                this.updateWalkPath(tileX, tileY);
            }
        }
    }

    handleMouseLeave() {
        this.hoveredTile.x = -1;
        this.hoveredTile.y = -1;
        // Clear hover description and redisplay turn history
        this.hoverDescription = null;
        this.displayMessages();
        // A hover panel belongs to the pointer, so it leaves with it. A sticky one was
        // asked for deliberately and stays until an action or Esc dismisses it — but a
        // pending open dies either way, since the pointer that requested it is gone.
        const iface = this.engine.interfaceManager;
        if (iface?.actorInfoMode) {
            iface.cancelPendingHoverInfo();
        } else {
            iface?.closeActorInfo();
        }
        // Hide tile highlight
        this.engine.renderer?.hideTileHighlight();
        // Hide throw path if in aiming mode
        this.engine.renderer?.hideLinePath();
        // Disarm any pending (x)plore preview so its state doesn't outlive the
        // path we're about to hide.
        this.cancelExplorePreview();
        // Hide walk path
        this.engine.renderer?.hideWalkPath();
    }

    handleMouseClick(event) {
        if (!this.enabled) return;

        // Suppress synthetic mouse events fired after touch
        if (Date.now() - this.lastTouchTime < 500) return;

        // Check if in throw aiming mode
        if (this.engine.interfaceManager?.handleThrowClick()) {
            event.preventDefault();
            return;
        }

        // Check if in spell aiming mode
        if (this.engine.interfaceManager?.handleSpellAimingClick()) {
            event.preventDefault();
            return;
        }

        // Check if in spike direction mode
        if (this.engine.interfaceManager?.handleSpikeDirectionClick()) {
            event.preventDefault();
            return;
        }

        // Check if in dig direction mode
        if (this.engine.interfaceManager?.handleDigDirectionClick()) {
            event.preventDefault();
            return;
        }

        // Check if any dialog wants to handle this click
        if (this.engine.interfaceManager?.handleDialogClick(this.hoveredTile.x, this.hoveredTile.y)) {
            return;
        }

        // Check if clicking on the player - open player info
        const player = this.engine.entityManager?.player;
        if (player && !player.isDead) {
            const clickedOnPlayer = (this.hoveredTile.x === player.x && this.hoveredTile.y === player.y) ||
                                    (player.height === 2 && this.hoveredTile.x === player.x && this.hoveredTile.y === player.y - 1);
            if (clickedOnPlayer) {
                this.engine.interfaceManager?.togglePlayerInfo(player);
                return;
            }
        }

        // Clicking an actor travels to it (and so attacks it, if it's in the way):
        // reading it is what HOVER does, so the click is free to mean "go there".
        // Any open panel is dismissed on the way, since play is resuming.
        this.engine.interfaceManager?.closeActorInfo();

        // Clicking to travel supersedes any pending (x)plore preview.
        this.cancelExplorePreview();

        // Start auto-walk if there's a valid path
        this.startAutoWalk();
    }

    /**
     * The actor the pointer at (x, y) is looking at, or null.
     *
     * Resolves a tall actor's head tile the same way the hover-describe pass does
     * (base at y, top sprite at y-1), and only returns actors the player could
     * legitimately name: visible, not hidden, on a currently-lit tile. A remembered
     * actor on an explored-but-unseen tile is deliberately excluded — the map may
     * remember where it was standing, but you cannot look at what you cannot see.
     *
     * @returns {Actor|null}
     */
    actorAtPointer(x, y) {
        const em = this.engine.entityManager;
        if (!em) return null;

        let actor = em.getActorAt(x, y);
        if (!actor || actor.isDead) {
            const below = em.getActorAt(x, y + 1);
            actor = (below && !below.isDead && below.height === 2) ? below : null;
        }
        if (!actor || actor.isDead) return null;
        if (!actor.hasAttribute('visible') || actor.hasAttribute('hidden')) return null;
        if (!this.engine.isTileVisible(actor.x, actor.y)) return null;

        return actor;
    }

    /**
     * What the pointer at (x, y) is looking at — an actor if one is there, else an item
     * on the floor. Actors win: standing on a sword, the monster is what you care about.
     *
     * Same visibility rule as actorAtPointer, and the same one the hover-name line uses
     * for items, so the panel and the sidebar never disagree about what is under the
     * cursor.
     *
     * @returns {Actor|Item|null}
     */
    pointerTarget(x, y) {
        const actor = this.actorAtPointer(x, y);
        if (actor) return actor;

        const item = this.engine.entityManager?.getItemAt(x, y);
        if (!item || item.isDead) return null;
        if (!item.hasAttribute('visible')) return null;
        if (!this.engine.isTileVisible(item.x, item.y)) return null;

        return item;
    }

    /**
     * Open, swap or close the hover info panel for whatever the pointer is over.
     *
     * Called on every tile change, so it must be cheap when nothing changed: the
     * common case is the pointer moving over floor with no panel up, which exits on
     * the first branch. Re-requesting the SAME target is a no-op too, since the text
     * would be identical and re-creating the box makes it flicker.
     *
     * The panel does not open here — it is scheduled, and opens only if the pointer is
     * still resting on the target when the delay elapses (see scheduleHoverInfo), so
     * sweeping across a crowded room opens nothing.
     *
     * Targets that aren't worth a panel (a door, a stairway — see hasInfoPanel) cancel
     * any pending open and close any open panel rather than showing a bare name the
     * sidebar hover line already gives.
     */
    updateHoverInfo(tileX, tileY) {
        const iface = this.engine.interfaceManager;
        if (!iface) return;

        // The sticky panel was asked for by keyboard; hover must not yank it away.
        if (iface.actorInfoMode) return;

        // While aiming, the pointer is choosing a target, not reading one — a panel
        // would cover the very tiles being aimed at. Same for any open modal.
        if (iface.isThrowAiming?.() || iface.isSpellAiming?.()
            || iface.inventoryMode || iface.confirmDialog || iface.helpWindowMode) {
            iface.closeActorInfo();
            return;
        }

        const player = this.engine.entityManager?.player;
        const target = this.pointerTarget(tileX, tileY);
        const worth = target && target !== player && target.hasInfoPanel?.();

        if (!worth) {
            iface.closeActorInfo();
            return;
        }
        // Already showing this target, or already counting down to it — leave both the
        // open panel and any running timer alone. Checked before the close below, or
        // drifting within one large actor would restart its delay on every tile.
        if (iface.actorInfoActor === target || iface.actorInfoHoverPending === target) return;

        // Moving from one target straight to another closes the first at once rather
        // than leaving it up through the new one's delay. Also cancels its timer.
        iface.closeActorInfo();

        iface.scheduleHoverInfo(target, player);
    }

    // ---- Touch input handlers ----

    handleTouchStart(event) {
        if (!this.enabled) return;
        event.preventDefault();

        const touch = event.touches[0];
        this.touchStartPos = { x: touch.clientX, y: touch.clientY };
        this.touchStartTime = Date.now();
        this.longPressTriggered = false;

        // Start long-press timer
        this.longPressTimer = setTimeout(() => {
            this.longPressTriggered = true;
            this.handleLongPress(touch);
        }, this.longPressThreshold);
    }

    handleTouchMove(event) {
        if (!this.enabled) return;
        event.preventDefault();

        const touch = event.touches[0];
        if (this.touchStartPos) {
            const dx = touch.clientX - this.touchStartPos.x;
            const dy = touch.clientY - this.touchStartPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > this.tapMoveThreshold) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
        }
    }

    handleTouchEnd(event) {
        if (!this.enabled) return;
        event.preventDefault();

        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;

        // If long-press already fired, don't also tap
        if (this.longPressTriggered) {
            this.longPressTriggered = false;
            this.handleMouseLeave();
            this.touchStartPos = null;
            this.lastTouchTime = Date.now();
            return;
        }

        const touch = event.changedTouches[0];
        if (!touch || !this.touchStartPos) return;

        // Check if it's a tap (finger didn't move much)
        const dx = touch.clientX - this.touchStartPos.x;
        const dy = touch.clientY - this.touchStartPos.y;
        if (Math.sqrt(dx * dx + dy * dy) <= this.tapMoveThreshold) {
            this.updateTileFromTouch(touch);
            this.handleMouseClick(event);
        } else {
            // Swipe gesture — single-step directional move
            const player = this.engine.player;
            if (player) {
                if (this.autoWalking) {
                    this.cancelAutoWalk();
                } else {
                    const action = this.getSwipeDirection(dx, dy);
                    this.executeAction(action, player);
                }
            }
        }

        this.touchStartPos = null;
        // Set after handleMouseClick so the dedup guard doesn't block our own call
        this.lastTouchTime = Date.now();
    }

    handleTouchCancel(event) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
        this.touchStartPos = null;
        this.longPressTriggered = false;
    }

    getSwipeDirection(dx, dy) {
        const angle = Math.atan2(dy, dx);
        const normalized = angle < 0 ? angle + 2 * Math.PI : angle;
        const sector = Math.floor((normalized + Math.PI / 8) / (Math.PI / 4)) % 8;
        const actions = [
            'move_right', 'move_down_right', 'move_down', 'move_down_left',
            'move_left', 'move_up_left', 'move_up', 'move_up_right',
        ];
        return actions[sector];
    }

    handleLongPress(touch) {
        this.updateTileFromTouch(touch);
        this.updateDescription(this.hoveredTile.x, this.hoveredTile.y);
        this.updateTileHighlight(this.hoveredTile.x, this.hoveredTile.y);
    }

    updateTileFromTouch(touch) {
        const canvas = this.engine.app?.view;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = touch.clientX - rect.left;
        const mouseY = touch.clientY - rect.top;

        const scaleX = this.engine.canvasWidth / rect.width;
        const scaleY = this.engine.canvasHeight / rect.height;

        const mapPixelX = (mouseX * scaleX) - (this.engine.viewportOffsetX || 0);
        const mapPixelY = (mouseY * scaleY) - (this.engine.viewportOffsetY || 0);
        const tileX = Math.floor(mapPixelX / this.engine.config.tileWidth);
        const tileY = Math.floor(mapPixelY / this.engine.config.tileHeight);

        this.hoveredTile.x = tileX;
        this.hoveredTile.y = tileY;
    }

    /**
     * Update tile highlight based on visibility
     * @param {number} tileX - Tile X coordinate
     * @param {number} tileY - Tile Y coordinate
     */
    updateTileHighlight(tileX, tileY) {
        const renderer = this.engine.renderer;
        if (!renderer) return;

        // Only highlight visible tiles (or all tiles if darkness is disabled)
        if (this.engine.isTileVisible(tileX, tileY)) {
            renderer.showTileHighlight(tileX, tileY);
        } else {
            renderer.hideTileHighlight();
        }
    }

    /**
     * Update walk path preview based on mouse position
     * @param {number} tileX - Target tile X
     * @param {number} tileY - Target tile Y
     */
    updateWalkPath(tileX, tileY) {
        const renderer = this.engine.renderer;
        const player = this.engine.entityManager?.player;

        if (!renderer || !player || player.isDead) {
            renderer?.hideWalkPath();
            return;
        }

        // Don't show path when confused — player can't navigate reliably
        if (player.isConfused()) {
            renderer.hideWalkPath();
            return;
        }

        // Don't show path if target is player's current position
        if (tileX === player.x && tileY === player.y) {
            renderer.hideWalkPath();
            return;
        }

        // Don't show path if UI is open
        const ui = this.engine.interfaceManager;
        if (ui?.inventoryMode || ui?.confirmDialog || ui?.throwMenuMode || ui?.equipmentMenuMode || ui?.identifyMode || ui?.spikeDirectionMode || ui?.digDirectionMode) {
            renderer.hideWalkPath();
            return;
        }

        // Don't show path to dark/unexplored tiles
        if (!this.engine.isTileVisible(tileX, tileY) && !this.engine.isTileExplored(tileX, tileY)) {
            renderer.hideWalkPath();
            return;
        }

        // If target is a solid actor, route path preview to the nearest adjacent tile
        const solidActor = this.engine.entityManager?.getSolidActorAt(tileX, tileY);
        if (solidActor) {
            const adj = this.findAdjacentWalkableTile(tileX, tileY);
            if (adj) renderer.showWalkPath(player.x, player.y, adj.x, adj.y);
            else renderer.hideWalkPath();
            return;
        }

        // Show walk path (returns null if no valid path)
        renderer.showWalkPath(player.x, player.y, tileX, tileY);
    }

    /**
     * Find the walkable tile adjacent to (targetX, targetY) closest to the player.
     * Used when clicking a solid actor to find a tile to walk toward before colliding.
     * @returns {{x, y}|null}
     */
    findAdjacentWalkableTile(targetX, targetY) {
        const player = this.engine.entityManager?.player;
        if (!player) return null;
        const candidates = [
            { x: targetX,     y: targetY - 1 },
            { x: targetX,     y: targetY + 1 },
            { x: targetX - 1, y: targetY },
            { x: targetX + 1, y: targetY },
        ];
        let best = null, bestDist = Infinity;
        for (const c of candidates) {
            const floor = this.engine.mapManager?.floorMap[c.y]?.[c.x];
            if (!floor || !floor.tileId) continue;
            if (this.engine.entityManager?.getSolidActorAt(c.x, c.y)) continue;
            const dist = Math.abs(c.x - player.x) + Math.abs(c.y - player.y);
            if (dist < bestDist) { best = c; bestDist = dist; }
        }
        return best;
    }

    /**
     * Start auto-walking along the currently displayed path
     */
    startAutoWalk() {
        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) return;

        // Don't auto-walk when confused
        if (player.isConfused()) return;

        const targetX = this.hoveredTile.x;
        const targetY = this.hoveredTile.y;

        // Don't start if target is invalid or same as player position
        if (targetX < 0 || targetY < 0) return;
        if (targetX === player.x && targetY === player.y) return;

        // Check if target tile has a solid actor → click-to-collide. A two-tile actor
        // is clicked as often on the head as the body, and hover describes it either
        // way, so resolve the head to the base rather than trying to walk through it.
        let solidActor = this.engine.entityManager?.getSolidActorAt(targetX, targetY);
        let collideX = targetX, collideY = targetY;
        if (!solidActor) {
            const below = this.engine.entityManager?.getSolidActorAt(targetX, targetY + 1);
            if (below && below.height === 2) {
                solidActor = below;
                collideY = targetY + 1;
            }
        }
        if (solidActor) {
            const dx = collideX - player.x;
            const dy = collideY - player.y;
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                // Adjacent: immediately collide (same as pressing the arrow key)
                this.clearMessageStack();
                const result = player.moveBy(dx, dy);
                if (result.moved) {
                    this.engine.playSoundVaried(result.entrySound || 'feets', 0.4, 0.1, 1.0, 0.06);
                } else if (!result.actionTaken && !result.feedbackShown) {
                    // tryMove already played its own rejection sound when feedbackShown.
                    this.engine.playSound('tap1');
                }
                if (result.actionTaken) this.onPlayerAction();
            } else {
                // Non-adjacent: walk to a tile adjacent to the solid actor, then collide
                const adjTile = this.findAdjacentWalkableTile(collideX, collideY);
                if (adjTile) {
                    this.pendingCollisionTarget = { x: collideX, y: collideY };
                    this.executeAutoWalk(adjTile.x, adjTile.y);
                }
            }
            return;
        }

        // Check if target tile has a hazardous actor (skip if hallucinating — player doesn't know)
        const isHallucinating = player.hasStateProperty?.('hallucinating');
        const targetActor = this.engine.entityManager?.getActorAt(targetX, targetY);
        const damageType = targetActor?.getAttribute('damage_type');
        if (!isHallucinating && damageType && !player.hasAttribute(`${damageType}_immune`)) {
            // Show confirmation dialog for hazardous destination
            const hazardName = targetActor.name || 'danger';
            this.engine.interfaceManager?.showConfirmDialog(
                `Walk into the ${hazardName}?`,
                () => this.executeAutoWalk(targetX, targetY),
                () => {}, // Do nothing on cancel
                { fillColor: this.engine.interfaceManager?.warningFillColor }
            );
            return;
        }

        this.executeAutoWalk(targetX, targetY);
    }

    /**
     * Execute the auto-walk after any confirmations
     * @param {number} targetX - Target tile X
     * @param {number} targetY - Target tile Y
     */
    executeAutoWalk(targetX, targetY) {
        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) return;

        // Get the path
        const renderer = this.engine.renderer;
        const path = renderer?.showWalkPath(player.x, player.y, targetX, targetY);

        if (!path || path.length <= 1) return;

        // Start auto-walk
        this.autoWalkPath = path;
        this.autoWalkIndex = 1; // Skip first point (player's current position)
        this.autoWalking = true;

        // Reset notable event tracking for fresh detection
        this.resetNotableEventTracking();

        // Initialize tracking with currently visible entities
        this.checkNotableEvents();

        // Hide the walk path preview during auto-walk
        renderer?.hideWalkPath();

        // Take the first step
        this.autoWalkStep();
    }

    /**
     * Take one step along the auto-walk path
     */
    autoWalkStep() {
        if (!this.autoWalking || !this.autoWalkPath) {
            this.stopAutoWalk();
            return;
        }

        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) {
            this.stopAutoWalk();
            return;
        }

        // Stop auto-walk if player became confused mid-walk
        if (player.isConfused()) {
            this.stopAutoWalk();
            return;
        }

        // Check if we've reached the end of the path
        if (this.autoWalkIndex >= this.autoWalkPath.length) {
            this.stopAutoWalk();
            return;
        }

        // Check for notable events before taking the step (but allow at least one step)
        const hasMovedAtLeastOnce = this.autoWalkIndex > 1;
        if (hasMovedAtLeastOnce) {
            const notableEvent = this.checkNotableEvents();
            if (notableEvent) {
                this.showMessage(notableEvent);
                this.stopAutoWalk();
                return;
            }
        }

        const nextPoint = this.autoWalkPath[this.autoWalkIndex];

        // Calculate direction
        const dx = nextPoint.x - player.x;
        const dy = nextPoint.y - player.y;

        // Clear message stack at the start of each player action
        this.clearMessageStack();

        // Try to move
        const result = player.moveBy(dx, dy);

        if (result.moved) {
            const sound = result.entrySound || 'feets';
            this.engine.playSoundVaried(sound, 0.4, 0.1, 1.0, 0.06);
            this.autoWalkIndex++;

            // Trigger player action (lets AI act)
            this.onPlayerAction();

            // Check for notable events after the step (and AI turns)
            const postMoveEvent = this.checkNotableEvents();
            if (postMoveEvent) {
                this.showMessage(postMoveEvent);
                this.stopAutoWalk();
                return;
            }

            // Schedule next step if not at destination
            if (this.autoWalkIndex < this.autoWalkPath.length) {
                setTimeout(() => this.autoWalkStep(), this.autoWalkDelay);
            } else {
                // Execute pending collision (arrived adjacent to a solid actor)
                const collisionTarget = this.pendingCollisionTarget;
                this.stopAutoWalk(); // clears pendingCollisionTarget
                if (collisionTarget) {
                    const { x: tx, y: ty } = collisionTarget;
                    this.pendingCollisionTarget = null;
                    const cdx = tx - player.x;
                    const cdy = ty - player.y;
                    if (Math.abs(cdx) <= 1 && Math.abs(cdy) <= 1 && (cdx !== 0 || cdy !== 0)) {
                        this.clearMessageStack();
                        const cResult = player.moveBy(cdx, cdy);
                        if (cResult.moved) {
                            this.engine.playSoundVaried(cResult.entrySound || 'feets', 0.4, 0.1, 1.0, 0.06);
                        }
                        if (cResult.actionTaken) this.onPlayerAction();
                    }
                }
            }
        } else if (result.opened) {
            // We just bumped a closed door open (it cost a turn but we didn't move).
            // Don't advance the path index — retry the same tile next tick to step
            // through the now-open doorway. Let AI act first, then re-check events.
            this.onPlayerAction();
            const postOpenEvent = this.checkNotableEvents();
            if (postOpenEvent) {
                this.showMessage(postOpenEvent);
                this.stopAutoWalk();
                return;
            }
            setTimeout(() => this.autoWalkStep(), this.autoWalkDelay);
        } else {
            // Movement blocked - stop auto-walk
            if (!result.actionTaken && !result.feedbackShown) {
                // tryMove already played its own rejection sound when feedbackShown.
                this.engine.playSound('tap1');
            }
            this.stopAutoWalk();
        }
    }

    // ------------------------------------------------------------------
    // Auto-explore ( (x)plore ) — player-facing auto-exploration.
    // Reuses the auto-walk stepper's shape but chooses its own destination
    // each leg via the shared computeExploreTarget core (nearest unexplored
    // frontier / reachable loot). Stops on: a hostile approaching, taking
    // damage / gaining a new state, or a new item coming into view.
    // ------------------------------------------------------------------

    /**
     * Build the sense options passed to computeExploreTarget for the PLAYER.
     * Unlike a personality-driven "hero" actor (which keeps its own visited
     * memory), the player explores against the real fog-of-war: a tile counts
     * as explored once it's been revealed, and a ground item is perceivable
     * only when its tile is currently visible. These match computeExploreTarget's
     * built-in defaults, but we pass them explicitly so the player's notion of
     * "explored"/"seen" is unambiguous and independent of any future default change.
     * @param {Actor} player
     * @returns {object} opts for computeExploreTarget
     */
    _exploreOpts(player) {
        return {
            isExplored: (x, y) => this.engine.isTileExplored(x, y),
            canSeeItem: (item) => this.engine.isTileVisible(item.x, item.y),
        };
    }

    /**
     * The (x)plore action
     *   1st press → compute the next explore target and preview the path to it
     *               (like a mouseover), arming it but NOT moving.
     *   2nd press → commit: begin auto-exploring along that path.
     *   while walking → cancel.
     * Any other input (a movement key, a menu, etc.) disarms the preview via
     * cancelExplorePreview() so a stale path never lingers.
     */
    startExplore() {
        if (this.exploring) {   // pressing explore while walking cancels it
            this.stopExplore();
            return;
        }
        // Second press: a target is already previewed → commit and walk.
        if (this.exploreArmed) {
            this.commitExplore();
            return;
        }

        // First press: compute & preview the next target, then arm it.
        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) return;
        if (player.isConfused()) {
            this.showMessage("You're too confused to explore.");
            return;
        }

        // Nothing to head toward → report and bail.
        const target = computeExploreTarget(this.engine, player, this._exploreOpts(player));
        if (!target) {
            this.showMessage('Nothing left to explore.');
            return;
        }

        const path = this.engine.renderer?.showWalkPath(player.x, player.y, target.x, target.y);
        if (!path || path.length <= 1) {
            this.showMessage('Nothing left to reach.');
            this.engine.renderer?.hideWalkPath();
            return;
        }

        this.exploreArmed = true;
        this.exploreArmedTarget = target;
        this.showMessage(`Explore: press [${this.getKeyForAction('explore', 'x')}] again to travel.`);
    }

    /**
     * Commit an armed explore preview: start auto-exploring for real.
     * A Tab-selected target (marked `travel`) instead walks straight to that fixed
     * destination via the auto-walk machinery, which already handles solid
     * doors/stairways/monsters (collide when adjacent, route to an adjacent tile
     * otherwise) and hazard confirmations.
     */
    commitExplore() {
        const player = this.engine.entityManager?.player;
        const armed = this.exploreArmedTarget;
        this.exploreArmed = false;
        this.exploreArmedTarget = null;
        this.targetCycleIndex = -1;
        if (!player || player.isDead) return;
        if (player.isConfused()) {
            this.showMessage("You're too confused to explore.");
            this.engine.renderer?.hideWalkPath();
            return;
        }

        // Fixed-destination travel (a Tab pick) → reuse click-to-walk.
        if (armed && armed.travel) {
            this.hoveredTile.x = armed.x;
            this.hoveredTile.y = armed.y;
            this.startAutoWalk();
            return;
        }

        this.exploring = true;
        this.exploreLegPath = null;
        this.exploreLegIndex = 0;
        this.exploreStepsTaken = 0;
        this.exploreHpSnapshot = player.stats?.health?.current ?? null;
        this.exploreStateSnapshot = new Set(Object.keys(player.states || {}));

        // Enable item-in-view stopping for explore only; seed encounter tracking.
        this._exploreStopOnItem = true;
        this.resetNotableEventTracking();
        this.checkNotableEvents();

        this.exploreStep();
    }

    /**
     * Disarm a pending explore preview (first-press state) without walking.
     * Called when the player does anything other than press (x)plore again.
     * @returns {boolean} true if a preview was actually pending (and cleared)
     */
    cancelExplorePreview() {
        if (!this.exploreArmed) return false;
        this.exploreArmed = false;
        this.exploreArmedTarget = null;
        this.targetCycleIndex = -1;
        this.engine.renderer?.hideWalkPath();
        return true;
    }

    /**
     * Gather the reachable points of interest the player can travel to, nearest
     * first. Candidates are:
     *   - ground items the player can currently perceive, and
     *   - travel-worthy actors (creatures, doors/openables, stairways, portals),
     *     excluding the player and controlled allies.
     * @returns {Array<{x:number, y:number, kind:string, entity:object, path:Array, dist:number}>}
     */
    collectTargets() {
        const engine = this.engine;
        const player = engine.entityManager?.player;
        if (!player || player.isDead) return [];
        const em = engine.entityManager;

        const seen = new Set();          // dedupe by tile so overlapping entities don't double up
        const candidates = [];
        const consider = (entity, kind, canPerceive) => {
            if (!entity || entity.isDead) return;
            if (!canPerceive) return;
            const key = `${entity.x},${entity.y}`;
            if (seen.has(key)) return;
            const path = engine.renderer?.computeWalkPath(player.x, player.y, entity.x, entity.y);
            if (!path || path.length <= 1) return;
            seen.add(key);
            candidates.push({ x: entity.x, y: entity.y, kind, entity, path, dist: path.length });
        };

        // Ground items the player can perceive (visible tile).
        for (const item of (em.items || [])) {
            consider(item, 'item', engine.isTileVisible(item.x, item.y));
        }

        // Travel-worthy actors on tiles the player has seen (visible or remembered),
        // excluding the player and any controlled ally.
        for (const actor of (em.actors || [])) {
            if (actor === player) continue;
            if (actor.hasAttribute?.('controlled')) continue;
            if (!isTravelTarget(actor)) continue;
            const known = engine.isTileVisible(actor.x, actor.y) || engine.isTileExplored(actor.x, actor.y);
            consider(actor, 'actor', known);
        }

        candidates.sort((a, b) => a.dist - b.dist);
        return candidates;
    }

    /**
     * Tab: cycle through reachable targets, previewing the path to each and arming
     * it so a subsequent (x)plore/confirm press travels there. Repeated Tab presses
     * advance to the next-farther candidate, wrapping around. With no candidates,
     * falls through to a plain explore preview so Tab is never a dead key.
     */
    cycleTarget() {
        if (this.exploring) return; // don't retarget mid-travel

        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) return;
        if (player.isConfused()) {
            this.showMessage("You're too confused to explore.");
            return;
        }

        const targets = this.collectTargets();
        if (targets.length === 0) {
            // Nothing specific to target — behave like a first (x)plore press so Tab
            // still previews the explore frontier.
            this.targetCycleIndex = -1;
            this.startExplore();
            return;
        }

        // Advance the cycle (wrapping). A disarmed preview resets the index to -1,
        // so the first Tab lands on index 0 (nearest).
        this.targetCycleIndex = (this.targetCycleIndex + 1) % targets.length;
        const target = targets[this.targetCycleIndex];

        // Preview the path and arm it (reuse the two-step commit machinery).
        // `travel: true` marks this as a fixed-destination target (a Tab pick) so
        // commitExplore walks straight to it rather than recomputing an explore leg.
        this.engine.renderer?.showWalkPath(player.x, player.y, target.x, target.y);
        this.exploreArmed = true;
        this.exploreArmedTarget = { ...target, travel: true };

        const label = target.entity?.name || (target.kind === 'item' ? 'item' : 'target');
        // Fall back to the default binding rather than the action name — an unbound
        // explore would otherwise render as the useless "press [explore] to go".
        const goKey = this.getKeyForAction('explore', 'x');
        const position = `${this.targetCycleIndex + 1}/${targets.length}`;
        // On anything with a panel the confirm key looks instead of travelling, so say
        // so — the two keys do different things here and the hint is the only place
        // that shows it.
        if (target.entity?.hasInfoPanel?.()) {
            const lookKey = this.getKeyForAction('confirm_target', 'Enter');
            this.showMessage(`Target: ${label} (${position}) — [${lookKey}] to look, [${goKey}] to go.`);
        } else {
            this.showMessage(`Target: ${label} (${position}) — press [${goKey}] to go.`);
        }
    }

    /**
     * Take one step of auto-explore. Modeled on autoWalkStep, but recomputes the
     * destination whenever the current leg is finished or missing.
     */
    exploreStep() {
        if (!this.exploring) return;

        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) { this.stopExplore(); return; }
        if (player.isConfused()) {
            this.showMessage('You lose your focus.');
            this.stopExplore();
            return;
        }

        // (Re)compute a leg toward the next explore target if needed.
        if (!this.exploreLegPath || this.exploreLegIndex >= this.exploreLegPath.length) {
            const target = computeExploreTarget(this.engine, player, this._exploreOpts(player));
            if (!target) {
                this.showMessage('Done exploring.');
                this.stopExplore();
                return;
            }
            const path = this.engine.renderer?.showWalkPath(player.x, player.y, target.x, target.y);
            if (!path || path.length <= 1) {
                // Target unreachable from here — give up rather than spin.
                this.showMessage('Nothing left to reach.');
                this.stopExplore();
                return;
            }
            this.exploreLegPath = path;
            this.exploreLegIndex = 1; // skip the actor's current tile
        }

        // Stop-on-encounter check before stepping. Skip only the very first move
        // of the whole session (seeded by startExplore's checkNotableEvents) so we
        // don't instantly abort on an already-visible monster; every later step —
        // including the first step of a freshly-recomputed leg — is checked.
        if (this.exploreStepsTaken > 0) {
            const event = this.checkNotableEvents();
            if (event) { this.showMessage(event); this.stopExplore(); return; }
        }

        const nextPoint = this.exploreLegPath[this.exploreLegIndex];
        const dx = nextPoint.x - player.x;
        const dy = nextPoint.y - player.y;

        this.clearMessageStack();
        const result = player.moveBy(dx, dy);

        if (!result.moved && result.opened) {
            // Opening a door is a natural stopping point: the door swings open (a
            // turn passes) and we stop so the player can survey the newly revealed
            // space and press explore again to plan a fresh path through it. The
            // door's own open() already showed "The <door> opens." — don't overwrite it.
            this.onPlayerAction();
            this.stopExplore();
            return;
        }

        if (!result.moved) {
            // Blocked (e.g. a door closed, a monster stepped in). Drop this leg and
            // recompute next tick rather than hammering the same tile.
            this.exploreLegPath = null;
            if (result.actionTaken) {
                // A bump-attack or other turn-consuming action happened; let AI act
                // and stop — combat means "something interesting."
                this.onPlayerAction();
                this.stopExplore();
            } else {
                this.stopExplore();
            }
            return;
        }

        const sound = result.entrySound || 'feets';
        this.engine.playSoundVaried(sound, 0.4, 0.1, 1.0, 0.06);
        this.exploreLegIndex++;
        this.exploreStepsTaken++;

        // Advance AI turns.
        this.onPlayerAction();

        // Picking up an item is a natural stopping point: we've walked onto the loot
        // and grabbed it, so stop (pickUpItem already showed its own message) and let
        // the player press explore again to head for the next thing.
        if (result.pickedUp) { this.stopExplore(); return; }

        // Stop-on-damage / stop-on-new-state, evaluated after AI has acted.
        const hpNow = player.stats?.health?.current ?? null;
        if (this.exploreHpSnapshot !== null && hpNow !== null && hpNow < this.exploreHpSnapshot) {
            this.showMessage('You take damage — stopping.');
            this.stopExplore();
            return;
        }
        const statesNow = new Set(Object.keys(player.states || {}));
        for (const s of statesNow) {
            if (!this.exploreStateSnapshot.has(s)) {
                this.showMessage('Something affects you — stopping.');
                this.stopExplore();
                return;
            }
        }
        this.exploreHpSnapshot = hpNow;
        this.exploreStateSnapshot = statesNow;

        // Post-move encounter check (a monster may have moved into view/range).
        const postEvent = this.checkNotableEvents();
        if (postEvent) { this.showMessage(postEvent); this.stopExplore(); return; }

        if (player.isDead) { this.stopExplore(); return; }

        setTimeout(() => this.exploreStep(), this.autoWalkDelay);
    }

    /**
     * The low-grade search you do just by being somewhere — Brogue's
     * playerTurnEnded pass (Time.mm:2244). Runs once per tile, so wandering back
     * and forth over the same ground is not a way to grind out secrets; covering
     * new ground is. Awareness widens both the radius and the odds.
     * @param {Actor} player - The player actor
     */
    passiveSearch(player) {
        if (!player || player.isDead) return;

        const key = `${player.x},${player.y}`;
        if (this.searchedTiles.has(key)) return;
        this.searchedTiles.add(key);

        const mechanics = this.engine.getMechanics?.() || {};
        const base = mechanics.passive_search_strength ?? PASSIVE_SEARCH_STRENGTH;
        // 0 means "off" outright, not "off unless you found a ring" — a designer
        // switching passive search off wants the search action to be the only way
        // in, and awareness shouldn't quietly reopen it.
        if (base <= 0) return;

        // Passive search keeps Brogue's strength-derived radius (no cap): it's weak
        // enough that its own falloff limits it, and awareness widening the radius
        // is the whole point of the Ring of Awareness.
        this.engine.searchFrom?.(player, base + (player.getEffectiveAwareness?.() || 0));
    }

    /**
     * Begin a deliberate search: five turns of standing still, with everything
     * nearby found on the fifth. Interrupting it wastes the turns already spent,
     * which is what makes it a real decision rather than a free action to spam.
     */
    startSearch() {
        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) return;
        if (this.searching) return;

        this.searching = true;
        this.searchTurnsLeft = SEARCH_TURNS;
        this.resetNotableEventTracking();
        this.showMessage('You begin searching…');
        this.searchStep();
    }

    /**
     * One turn of an in-progress search. Turns 1-4 only pass time; the payoff all
     * lands on the last one.
     */
    searchStep() {
        if (!this.searching) return;

        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) { this.stopSearch(); return; }

        this.searchTurnsLeft--;
        const isFinalTurn = this.searchTurnsLeft <= 0;

        // Spend the turn.
        this.onPlayerAction();

        if (isFinalTurn) {
            const mechanics = this.engine.getMechanics?.() || {};
            const strength = mechanics.thorough_search_strength ?? THOROUGH_SEARCH_STRENGTH;
            const radius = mechanics.search_radius ?? THOROUGH_SEARCH_RADIUS;
            const found = this.engine.searchFrom?.(player, strength, radius);
            // reveal() already announced each individual find, so only report the
            // blank result — otherwise a good search ends in a wall of text.
            if (!found) {
                this.showMessage('You finish searching the area, but find nothing.');
            }
            this.stopSearch();
            return;
        }

        if (player.isDead) { this.stopSearch(); return; }
        const event = this.checkNotableEvents();
        if (event) {
            this.showMessage(event);
            this.showMessage('You abandon your search.');
            this.stopSearch();
            return;
        }

        setTimeout(() => this.searchStep(), this.autoWalkDelay);
    }

    /**
     * Stop an in-progress search.
     */
    stopSearch() {
        this.searching = false;
        this.searchTurnsLeft = 0;
    }

    /**
     * Stop auto-explore and clean up its overlay/state.
     */
    stopExplore() {
        this.exploring = false;
        this.exploreLegPath = null;
        this.exploreLegIndex = 0;
        this.exploreStepsTaken = 0;
        this.exploreHpSnapshot = null;
        this.exploreStateSnapshot = null;
        this.exploreArmed = false;
        this.exploreArmedTarget = null;
        this._exploreStopOnItem = false;
        this.engine.renderer?.hideWalkPath();
    }

    /**
     * Check for notable events that should interrupt auto-walk
     * @returns {string|null} Description of the notable event, or null if none
     */
    checkNotableEvents() {
        // Flags to enable/disable each condition. Item-in-view stopping is on only
        // during auto-explore (the (x)plore action), off for click-to-walk.
        const STOP_ON_HOSTILE_COMES_INTO_VIEW = false;
        const STOP_ON_HOSTILE_APPROACHES = true;
        const STOP_ON_ITEM_COMES_INTO_VIEW = !!this._exploreStopOnItem;

        const player = this.engine.entityManager?.player;
        if (!player) return null;

        const entityManager = this.engine.entityManager;

        // Track previously visible entities if not already tracking
        if (!this.previouslyVisibleActors) {
            this.previouslyVisibleActors = new Set();
        }
        if (!this.previouslyVisibleItems) {
            this.previouslyVisibleItems = new Set();
        }

        // Get currently visible hostile actors and items
        const currentlyVisibleActors = new Set();
        const currentlyVisibleItems = new Set();

        for (const actor of entityManager.actors) {
            if (actor === player || actor.isDead) continue;

            // Check if actor is visible (or darkness is disabled)
            if (this.engine.isTileVisible(actor.x, actor.y)) {
                currentlyVisibleActors.add(actor);

                // Check if this is a newly visible hostile actor
                if (STOP_ON_HOSTILE_COMES_INTO_VIEW && !this.previouslyVisibleActors.has(actor)) {
                    // Check if actor is hostile (has personality that targets player, or has collision_effect)
                    const isHostile = actor.hasAttribute('collision_effect') ||
                                     (actor.personality && !actor.hasAttribute('friendly'));
                    if (isHostile) {
                        this.previouslyVisibleActors = currentlyVisibleActors;
                        this.previouslyVisibleItems = currentlyVisibleItems;
                        return `${actor.name} comes into view`;
                    }
                }

                // Check if a visible hostile actor moved towards the player
                if (STOP_ON_HOSTILE_APPROACHES && actor._lastPosition) {
                    const wasCloser = getChebyshevDistance(actor._lastPosition.x, actor._lastPosition.y, player.x, player.y);
                    const isCloser = getChebyshevDistance(actor.x, actor.y, player.x, player.y);
                    if (isCloser < wasCloser && isCloser <= 6) {
                        const isHostile = actor.hasAttribute('collision_effect') ||
                                         (actor.personality && !actor.hasAttribute('friendly'));
                        if (isHostile) {
                            this.previouslyVisibleActors = currentlyVisibleActors;
                            this.previouslyVisibleItems = currentlyVisibleItems;
                            return `${actor.name} approaches`;
                        }
                    }
                }
            }
        }

        // Check for newly visible items (only when darkness is enabled)
        if (STOP_ON_ITEM_COMES_INTO_VIEW && this.engine.lightingManager) {
            for (const item of entityManager.items) {
                if (this.engine.isTileVisible(item.x, item.y)) {
                    currentlyVisibleItems.add(item);

                    if (!this.previouslyVisibleItems.has(item)) {
                        this.previouslyVisibleActors = currentlyVisibleActors;
                        this.previouslyVisibleItems = currentlyVisibleItems;
                        return `${item.name} comes into view`;
                    }
                }
            }
        }

        // Update tracking sets
        this.previouslyVisibleActors = currentlyVisibleActors;
        this.previouslyVisibleItems = currentlyVisibleItems;

        return null;
    }

    /**
     * Reset notable event tracking (call when starting a new auto-walk)
     */
    resetNotableEventTracking() {
        this.previouslyVisibleActors = null;
        this.previouslyVisibleItems = null;
    }

    /**
     * Stop auto-walking
     */
    stopAutoWalk() {
        this.autoWalking = false;
        this.autoWalkPath = null;
        this.autoWalkIndex = 0;
        this.pendingCollisionTarget = null;

        // Re-show walk path preview if mouse is still over a tile
        if (this.hoveredTile.x >= 0 && this.hoveredTile.y >= 0) {
            this.updateWalkPath(this.hoveredTile.x, this.hoveredTile.y);
        }
    }

    /**
     * Cancel auto-walk OR auto-explore (called on keyboard input or other
     * interruption). Returns true if either was in progress so the caller can
     * swallow the key that stopped it.
     */
    cancelAutoWalk() {
        let cancelled = false;
        if (this.autoWalking) {
            this.stopAutoWalk();
            cancelled = true;
        }
        if (this.exploring) {
            this.stopExplore();
            cancelled = true;
        }
        if (this.searching) {
            this.stopSearch();
            this.showMessage('You abandon your search.');
            cancelled = true;
        }
        return cancelled;
    }

    updateDescription(tileX, tileY) {
        if (!this.descriptionElement) return;

        const entityManager = this.engine.entityManager;
        if (!entityManager) return;

        // Determine visibility state
        const isVisible = this.engine.isTileVisible(tileX, tileY);
        const isExplored = this.engine.isTileExplored(tileX, tileY);
        const fogOfWar = this.engine.currentPrototype?.config?.mechanics?.fog_of_war || false;

        // Determine if this is a "remembered" tile (explored but not currently visible, with fog of war on)
        const isRemembered = !isVisible && fogOfWar && isExplored;

        // If not visible and not remembered, clear hover and keep turn history
        if (!isVisible && !isRemembered) {
            this.hoverDescription = null;
            this.displayMessages();
            return;
        }

        const entities = [];

        // Check for actors at this position (excluding dead ones)
        // Actor's base is at (x, y), top sprite is at (x, y-1)
        // So if hovering over y, check for actor at y (base) or y+1 (whose top is here)
        let actor = entityManager.getActorAt(tileX, tileY);
        let hoveredTopHalf = false;
        if (!actor || actor.isDead) {
            // Check if we're hovering over an actor's top sprite (actor is at y+1)
            const actorBelow = entityManager.getActorAt(tileX, tileY + 1);
            if (actorBelow && !actorBelow.isDead && actorBelow.height === 2) {
                actor = actorBelow;
                hoveredTopHalf = true;
            }
        }

        // Check if the player is hallucinating (scramble non-player descriptions)
        const player = entityManager.player;
        const isHallucinating = player?.hasStateProperty?.('hallucinating');

        // A hidden actor keeps its name to itself — including a disguised one,
        // which is `visible` because it renders wall tiles.
        if (actor && !actor.isDead && actor.hasAttribute('visible') && !actor.hasAttribute('hidden')) {
            if (isHallucinating && !actor.isPlayerControlled()) {
                // Determine which sprite is visually on top at this tile.
                // spriteTop (zIndex 11) renders above spriteBase (zIndex 10),
                // so if another actor's spriteTop occupies this tile, it covers
                // the base actor's spriteBase.
                let hallucinatedName;
                const actorBelow = !hoveredTopHalf ? entityManager.getActorAt(tileX, tileY + 1) : null;
                if (actorBelow && !actorBelow.isDead && actorBelow.height === 2
                    && actorBelow._hallucinatedTileNameTop && !actorBelow.isPlayerControlled()) {
                    // Another actor's spriteTop (zIndex 11) covers this actor's spriteBase (zIndex 10)
                    hallucinatedName = this._getHallucinatedName(actorBelow, true);
                } else {
                    hallucinatedName = this._getHallucinatedName(actor, hoveredTopHalf);
                }
                entities.push(hallucinatedName);
            } else {
                entities.push(this.getEntityDescription(actor));
            }
        }

        // Check for items at this position
        const item = entityManager.getItemAt(tileX, tileY);
        if (item && item.hasAttribute('visible')) {
            if (isHallucinating) {
                entities.push(this._getHallucinatedName(item));
            } else {
                entities.push(this.getEntityDescription(item));
            }
        }

        // Set hover description (or clear if nothing found)
        if (entities.length > 0) {
            this.hoverDescription = this.formatEntityList(entities, isRemembered);
        } else {
            this.hoverDescription = null;
        }

        // Redisplay with hover description included
        this.displayMessages();
    }

    formatEntityList(entities, isRemembered = false) {
        // Format a list of entities into a natural sentence
        // Currently visible: "You see a Skeleton."
        // Remembered (fog of war): "You remember seeing a Skeleton."
        const prefix = isRemembered ? 'You remember seeing' : 'You see';

        if (entities.length === 1) {
            return `${prefix} ${entities[0]}.`;
        } else if (entities.length === 2) {
            return `${prefix} ${entities[0]} and ${entities[1]}.`;
        } else {
            const allButLast = entities.slice(0, -1).join(', ');
            const last = entities[entities.length - 1];
            return `${prefix} ${allButLast}, and ${last}.`;
        }
    }

    clearDescription() {
        if (!this.descriptionElement) return;

        const summary = this.descriptionElement.querySelector('summary');
        if (summary) {
            // Remove existing description text (everything after summary)
            const existingText = Array.from(this.descriptionElement.childNodes)
                .filter(node => node !== summary);
            existingText.forEach(node => node.remove());
        }
        // Close the details element when nothing to show
        this.descriptionElement.open = false;
    }

    /**
     * Add a message to the stack (will be displayed together with other messages from the same turn)
     * @param {string} message - The message to display
     */
    showMessage(message, options = null) {
        if (!this.descriptionElement) return;
        // Suppress messages until the player begins play, so load-time state changes
        // don't leak feedback before gameplay starts (set true in startGameplay).
        if (this.engine && !this.engine.gameplayStarted) return;

        let position = null;
        let style = null;
        if (options) {
            if (options.x !== undefined && options.y !== undefined) {
                position = options;
            } else {
                position = options.position || null;
                style = options.style || null;
            }
        }

        if (position && this.engine?.isTileVisible) {
            if (!this.engine.isTileVisible(position.x, position.y)) return;
        }

        // Strip trailing periods to get base text for comparison
        const baseNew = message.replace(/\.+$/, '');

        // Check current turn's last message first
        if (this.messageStack.length > 0) {
            const last = this.messageStack[this.messageStack.length - 1];
            const lastText = typeof last === 'string' ? last : last.text;
            const baseLast = lastText.replace(/\.+$/, '');
            if (baseNew === baseLast) {
                if (typeof last === 'string') {
                    this.messageStack[this.messageStack.length - 1] = lastText + '.';
                } else {
                    last.text = lastText + '.';
                }
                this.displayMessages();
                return;
            }
        }
        // Check last message from the most recent history turn
        else if (this.turnHistory.length > 0) {
            const lastTurn = this.turnHistory[this.turnHistory.length - 1];
            if (lastTurn.length > 0) {
                const last = lastTurn[lastTurn.length - 1];
                const lastText = typeof last === 'string' ? last : last.text;
                const baseLast = lastText.replace(/\.+$/, '');
                if (baseNew === baseLast) {
                    if (typeof last === 'string') {
                        lastTurn[lastTurn.length - 1] = lastText + '.';
                    } else {
                        last.text = lastText + '.';
                    }
                    this.displayMessages();
                    return;
                }
            }
        }

        // Add to message stack
        this.messageStack.push(style ? { text: message, style } : message);

        // Display all stacked messages
        this.displayMessages();
    }

    /**
     * Commit current turn messages to history and start a new turn
     * Called at the start of each new player action
     */
    clearMessageStack() {
        // Only commit to history if there were messages this turn
        if (this.messageStack.length > 0) {
            this.turnHistory.push([...this.messageStack]);
        }
        this.messageStack = [];
    }

    /**
     * Display recent turn messages (current turn + previous turns from history)
     * Older turns are styled with CSS class for visual hierarchy
     */
    displayMessages() {
        if (!this.descriptionElement) return;

        const summary = this.descriptionElement.querySelector('summary');
        if (summary) {
            // Remove existing description text (everything after summary)
            const existingText = Array.from(this.descriptionElement.childNodes)
                .filter(node => node !== summary);
            existingText.forEach(node => node.remove());

            // Gather turns to display: recent history + current
            // Calculate how many history turns to show (visibleTurnCount - 1 for current)
            const historyToShow = Math.min(this.turnHistory.length, this.visibleTurnCount - 1);
            const recentHistory = this.turnHistory.slice(-historyToShow);

            // Build display: older turns first, then current turn
            // Age 0 = oldest shown, age increases toward current
            const turnsToDisplay = [];
            recentHistory.forEach((turn, index) => {
                // Age relative to current: historyToShow - index (older = higher number from current)
                const ageFromCurrent = historyToShow - index;
                turnsToDisplay.push({ messages: turn, age: ageFromCurrent });
            });
            // Current turn is age 0 (newest)
            if (this.messageStack.length > 0) {
                turnsToDisplay.push({ messages: this.messageStack, age: 0 });
            }

            // Render each turn
            turnsToDisplay.forEach((turn, turnIndex) => {
                // Add separator between turns (not before first)
                if (turnIndex > 0) {
                    this.descriptionElement.appendChild(document.createElement('br'));
                }

                // Create span for this turn's messages with age-based styling
                const turnSpan = document.createElement('span');
                if (turn.age > 0) {
                    turnSpan.className = `message-age-${Math.min(turn.age, 2)}`;
                }

                // Add messages for this turn
                turn.messages.forEach((msg, msgIndex) => {
                    const text = typeof msg === 'string' ? msg : msg.text;
                    const msgStyle = typeof msg === 'string' ? null : msg.style;
                    const lines = text.split('\n');
                    lines.forEach((line, lineIndex) => {
                        if (msgIndex > 0 || lineIndex > 0) {
                            turnSpan.appendChild(document.createElement('br'));
                        }
                        if (msgStyle) {
                            const styledSpan = document.createElement('span');
                            styledSpan.className = `message-${msgStyle}`;
                            styledSpan.textContent = line;
                            turnSpan.appendChild(styledSpan);
                        } else {
                            turnSpan.appendChild(document.createTextNode(line));
                        }
                    });
                });

                this.descriptionElement.appendChild(turnSpan);
            });

            // Add hover description at the bottom (if present)
            if (this.hoverDescription) {
                // Add separator if there was turn content
                if (turnsToDisplay.length > 0) {
                    this.descriptionElement.appendChild(document.createElement('br'));
                }

                // Hover descriptions are styled distinctly
                const hoverSpan = document.createElement('span');
                hoverSpan.className = 'message-hover';
                hoverSpan.appendChild(document.createTextNode(this.hoverDescription));
                this.descriptionElement.appendChild(hoverSpan);
            }
        }

        // Open if there's anything to show (history, current, or hover)
        const hasContent = this.messageStack.length > 0 ||
            this.turnHistory.slice(-(this.visibleTurnCount - 1)).length > 0 ||
            this.hoverDescription;
        this.descriptionElement.open = hasContent;
    }

    getEntityDescription(entity) {
        // Returns the entity name with appropriate article, lowercased for
        // inline "you see …" style descriptions.
        return this.getEntityNameWithArticle(entity, { lowercase: true });
    }

    /**
     * Entity name prefixed with the correct indefinite article ("a"/"an"), or
     * no article at all for mass nouns ("meat", not "a meat"). Uses the item's
     * identification-aware getDisplayName() when present. Single source of truth
     * for the mass-noun rule so pickup/throw/inventory messages stay consistent.
     * @param {object} entity
     * @param {{lowercase?: boolean, capitalize?: boolean}} [opts] - lowercase the
     *   name; or capitalize the leading article/name for sentence-initial use
     *   ("A meat"/"Meat" vs "a meat"/"meat"). capitalize wins over lowercase.
     * @returns {string}
     */
    getEntityNameWithArticle(entity, { lowercase = false, capitalize = false } = {}) {
        let displayName = entity.getDisplayName ? entity.getDisplayName() : entity.name;
        if (lowercase && !capitalize) displayName = displayName.toLowerCase();

        // Mass nouns (meat, water, sewage, gold dust…) take no article.
        if (entity.hasAttribute && entity.hasAttribute('mass_noun')) {
            if (capitalize) {
                return displayName.charAt(0).toUpperCase() + displayName.slice(1);
            }
            return displayName;
        }
        const article = this.getIndefiniteArticle(displayName);
        return `${capitalize ? article.charAt(0).toUpperCase() + article.slice(1) : article} ${displayName}`;
    }

    getIndefiniteArticle(name) {
        // Returns 'a' or 'an' based on the first letter of the name
        const firstLetter = name.charAt(0).toLowerCase();
        const vowels = ['a', 'e', 'i', 'o', 'u'];
        return vowels.includes(firstLetter) ? 'an' : 'a';
    }

    /**
     * The fake name a hallucinating player sees for `entity`, without an article.
     * texture_scramble writes the name of the tile it actually painted, for floor items as well as
     * actors, so the sprite and the name always agree. re-rolls each turn
     *
     * @returns {string} e.g. "skull", "open door"
     */
    hallucinatedNameFor(entity, hoveredTopHalf = false) {
        let raw = (hoveredTopHalf ? entity?._hallucinatedTileNameTop : null)
            || entity?._hallucinatedTileNameBase;

        if (!raw && entity) {
            raw = entity._hallucinatedTileNameBase =
                this.engine.spriteLibrary?.getRandomTileName() || 'something';
        }

        return (raw || 'something').toLowerCase().replace(/_/g, ' ');
    }

    /**
     * Generate a fake entity description from a random tile name (for hallucination)
     * @returns {string} A fake description like "a skull" or "an open door"
     */
    _getHallucinatedName(actor, hoveredTopHalf) {
        const displayName = this.hallucinatedNameFor(actor, hoveredTopHalf);
        return `${this.getIndefiniteArticle(displayName)} ${displayName}`;
    }

    handleKeyDown(event) {
        if (!this.enabled) return;

        // Cancel auto-walk on any key press
        if (this.cancelAutoWalk()) {
            event.preventDefault();
            return;
        }

        // Check if throw aiming mode wants to handle this key first. The full event
        // goes along with the key so the handler can resolve keybindings (target
        // cycling) rather than matching literal key names.
        if (this.engine.interfaceManager?.handleThrowKey(event.key, event)) {
            event.preventDefault();
            return;
        }

        // Check if spell aiming mode wants to handle this key
        if (this.engine.interfaceManager?.handleSpellAimingKey(event.key, event)) {
            event.preventDefault();
            return;
        }

        // Check if spike direction mode wants to handle this key
        if (this.engine.interfaceManager?.handleSpikeDirectionKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if dig direction mode wants to handle this key
        if (this.engine.interfaceManager?.handleDigDirectionKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if discovery panel wants to handle this key
        if (this.engine.interfaceManager?.handleDiscoveryKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if help window wants to handle this key
        if (this.engine.interfaceManager?.handleHelpKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Any key dismisses the actor info panel. Only Esc is consumed here; every
        // other key closes the panel and carries on to its normal action, so this must
        // sit after the truly modal handlers above and before ordinary dispatch.
        if (this.engine.interfaceManager?.handleActorInfoKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if throw menu wants to handle this key
        if (this.engine.interfaceManager?.handleThrowMenuKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if use item menu wants to handle this key
        if (this.engine.interfaceManager?.handleUseMenuKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if equipment menu wants to handle this key
        if (this.engine.interfaceManager?.handleEquipmentKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if confirmation dialog wants to handle this key first
        if (this.engine.interfaceManager?.handleConfirmKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if interface manager wants to handle this key (inventory interaction)
        if (this.engine.interfaceManager?.handleInventoryKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check global keys first (work regardless of player state)
        const globalAction = this.lookupBinding(this.globalKeyMap, event);
        if (globalAction) {
            event.preventDefault();
            this.executeGlobalAction(globalAction);
            return;
        }

        // Player-specific actions require a living player
        const player = this.engine.entityManager?.player;

        // With no player to act for, `wait` has no meaning, so its key reverts to
        // play/pause — the only thing there is to control in an observer prototype.
        // This is why the two share a key rather than each holding one: a given
        // prototype only ever wants one of them. Bind them separately to split them.
        if (!player || player.isDead) {
            if (this.lookupBinding(this.keyMap, event) === 'wait') {
                event.preventDefault();
                this.engine.toggleObserverPause();
            }
            return;
        }

        // Block input while incapacitated (paralyzed, stunned, etc.)
        if (player.isIncapacitated()) return;

        const action = this.lookupBinding(this.keyMap, event);
        if (!action) return;

        // Prevent default for game keys (don't scroll page with arrows, etc.)
        event.preventDefault();

        // Ignore key repeat events to prevent stacking inputs when holding keys
        //if (event.repeat) return;

        this.executeAction(action, player);
    }

    executeGlobalAction(action) {
        switch (action) {
            case 'toggle_pause':
                this.engine.toggleObserverPause();
                break;

            case 'reload':
                this.engine.reloadPrototype();
                break;
        }
    }

    executeAction(action, player) {
        // Clear message stack at the start of each player action
        this.clearMessageStack();

        // Any input other than (x)plore or Tab-cycling disarms a pending explore
        // preview (the first-press "press again to travel" state), so a stale path
        // never lingers behind the next thing the player does. (x)plore commits it
        // and Tab advances it, so neither should cancel it here.
        if (action !== 'explore' && action !== 'cycle_target' && action !== 'confirm_target') {
            this.cancelExplorePreview();
        }

        // Handle movement actions
        if (this.directions[action]) {
            let dir = this.directions[action];

            // Confusion: randomize movement direction
            if (player.isConfused()) {
                const dirs = Object.values(this.directions);
                dir = dirs[Math.floor(Math.random() * dirs.length)];
            }

            const targetX = player.x + dir.dx;
            const targetY = player.y + dir.dy;

            // Check for hazards that need confirmation (skip if hallucinating — player doesn't know)
            const isConfused = player.isConfused();
            const isHallucinating = player.hasStateProperty('hallucinating');
            let hazardCheck = null;
            if (!isHallucinating) {
                if (isConfused) {
                    // Confused: check all 8 neighbors — player doesn't know which way they'll go
                    for (const d of Object.values(this.directions)) {
                        hazardCheck = this.checkMovementHazard(player, player.x + d.dx, player.y + d.dy, true);
                        if (hazardCheck) break;
                    }
                } else {
                    hazardCheck = this.checkMovementHazard(player, targetX, targetY, false);
                }
            }
            if (hazardCheck) {
                // Show confirmation dialog
                this.engine.interfaceManager?.showConfirmDialog(
                    hazardCheck.message,
                    () => {
                        // On confirm - execute the move
                        const result = player.moveBy(dir.dx, dir.dy);
                        if (result.moved) {
                            const sound = result.entrySound || 'feets';
                            this.engine.playSoundVaried(sound, 0.4, 0.1, 1.0, 0.06);
                        }
                        if (result.actionTaken) {
                            this.onPlayerAction();
                        }
                    },
                    () => {
                        // On cancel - do nothing
                    },
                    { fillColor: this.engine.interfaceManager?.warningFillColor }
                );
                return;
            }

            const result = player.moveBy(dir.dx, dir.dy);
            if (result.moved) {
                const sound = result.entrySound || 'feets';
                this.engine.playSoundVaried(sound, 0.4, 0.1, 1.0, 0.06);
            } else if (!result.actionTaken && !result.feedbackShown) {
                // Bumped into a wall or obstacle with no effect. If tryMove already
                // played a sound + showed a message (e.g. locked/spiked door), it sets
                // feedbackShown so we don't double up with a generic wall-bump.
                this.engine.playSound('tap1');
                this.showMessage("You bump into a wall.");
            }
            if (result.actionTaken) {
                this.onPlayerAction();
            }
            return;
        }

        // Handle other actions
        switch (action) {
            // Commit whatever is currently targeted. The aiming modes intercept this
            // key before it reaches here (throwing / zapping at the aimed tile); out
            // here it confirms a travel target armed by cycle_target, so the same key
            // means "go with that" in all three contexts. With nothing armed it does
            // nothing rather than falling through to a stray action.
            case 'confirm_target':
                // A target worth reading about is looked at rather than travelled to —
                // this is the keyboard route to the panel hover gives. Walking to it is
                // still reachable: step toward it, or (x)plore.
                if (this.exploreArmed) {
                    const armed = this.exploreArmedTarget;
                    const readable = armed?.entity && !armed.entity.isDead
                        && armed.entity.hasInfoPanel?.();
                    if (readable) {
                        this.cancelExplorePreview();
                        this.engine.interfaceManager?.showEntityInfo(armed.entity, player);
                    } else {
                        this.commitExplore();
                    }
                }
                break;

            case 'wait':
                console.log(`${player.name} waits.`);
                this.showMessage("You wait.");
                this.onPlayerAction();
                break;

            case 'pickup':
                const item = this.engine.entityManager.getItemAt(player.x, player.y);
                if (item) {
                    const pickedUp = player.pickUpItem(item);
                    if (pickedUp) {
                        this.engine.playSound('pickup');
                        this.onPlayerAction();
                    } else {
                        // Inventory full - show message
                        this.engine.interfaceManager?.showTextBox(
                            'inventory_full',
                            "You can't carry any more things!",
                            { dismissOnMove: true }
                        );
                    }
                } else {
                    console.log('Nothing to pick up here.');
                }
                break;

            case 'player_info':
                if (this.engine.interfaceManager) {
                    this.engine.interfaceManager.togglePlayerInfo(player);
                }
                break;

            case 'throw_item':
                if (this.engine.interfaceManager) {
                    this.engine.interfaceManager.showThrowItemMenu(player);
                }
                break;

            case 'equipment_menu':
                if (this.engine.interfaceManager) {
                    this.engine.interfaceManager.toggleEquipmentMenu(player);
                }
                break;

            // Picks the item; the staff/wand's own `targeted_spell` use_effect takes
            // it from there into aiming mode, so this needs no zap logic of its own.
            // Skips the menu for a lone staff, matching 'dig' below — carrying one
            // is the common case, and aiming is a second prompt regardless.
            case 'zap':
                if (this.engine.interfaceManager) {
                    const zappable = player.inventory.filter(
                        item => item.getAttribute('use_verb') === 'Zap'
                    );
                    if (zappable.length === 1) {
                        player.useItem(zappable[0]);
                    } else {
                        this.engine.interfaceManager.showUseMenu(player, 'Zap', 'Zap which?');
                    }
                }
                break;

            case 'quaff':
                if (this.engine.interfaceManager) {
                    this.engine.interfaceManager.showUseMenu(player, 'Drink', 'Quaff which?');
                }
                break;

            case 'read_scroll':
                if (this.engine.interfaceManager) {
                    this.engine.interfaceManager.showUseMenu(player, 'Read', 'Read which?');
                }
                break;

            case 'jam_spike':
                if (this.engine.interfaceManager) {
                    this.engine.interfaceManager.showUseMenu(player, 'Jam', 'Spike which door?');
                }
                break;

            case 'dig':
                // Straight to the direction picker when only one tool qualifies —
                // a hotkey that still asked "dig with which?" would save nothing.
                // Safe to read the pack directly: menu handlers all get first refusal
                // in handleKeyDown, so no item menu is up and no letter selection is
                // competing for this key.
                if (this.engine.interfaceManager) {
                    const diggers = player.inventory.filter(
                        item => item.getAttribute('use_verb') === 'Dig'
                    );
                    if (diggers.length === 1) {
                        player.useItem(diggers[0]);
                    } else {
                        this.engine.interfaceManager.showUseMenu(player, 'Dig', 'Dig with which?');
                    }
                }
                break;

            case 'discovery':
                if (this.engine.interfaceManager) {
                    this.engine.interfaceManager.toggleDiscoveryPanel();
                }
                break;

            case 'explore':
                // Auto-explore drives its own turns via the stepper; don't consume
                // a manual turn just for pressing the key.
                this.startExplore();
                break;

            case 'search':
                // Like explore, the stepper spends the turns itself.
                this.startSearch();
                break;

            case 'cycle_target':
                // Tab: preview/advance through reachable targets (arms one for the
                // (x)plore/confirm press). No turn consumed — it's just targeting.
                this.cycleTarget();
                break;
        }
    }

    onPlayerAction() {
        // The info panel is large enough to cover much of the map, so anything that
        // spends a turn closes it — you cannot usefully play behind it, and having to
        // reach for Esc first would make reading a monster cost tempo.
        this.engine.interfaceManager?.closeActorInfo();

        // Progress any equipping in progress
        const player = this.engine.entityManager?.player;
        if (player?.isEquipping()) {
            player.progressEquipping();
            this.engine.interfaceManager?.updateSidebar();
        }

        // Check for extra actions (haste) — keep engine locked for bonus action
        if (player?._extraActions > 0) {
            player._extraActions--;
            this.engine.interfaceManager?.updatePlayerInfo();
            return;
        }

        this.passiveSearch(player);

        // Called after player takes an action - defer AI turns to next animation frame
        // so PIXI renders the player's move (with updated FOV) before enemies respond
        if (this.engine.turnEngine && this.engine.turnEngine._lock) {
            requestAnimationFrame(() => {
                if (this.engine.turnEngine?._lock) {
                    this.engine.turnEngine.unlock();
                }
            });
        }
    }

    /**
     * Check if moving to a position would trigger a hazard warning
     * @param {Actor} player - The player actor
     * @param {number} targetX - Target X coordinate
     * @param {number} targetY - Target Y coordinate
     * @param {boolean} [confused=false] Whether the player is confused (uncertain direction)
     * @returns {{message: string}|null} Hazard info or null if safe
     */
    checkMovementHazard(player, targetX, targetY, confused = false) {
        const entityManager = this.engine.entityManager;

        // Check for solid actors at target (walls, closed doors, etc.)
        // If blocked by a solid actor, no hazard warning needed - the move will just fail
        for (const actor of entityManager.actors) {
            if (actor.x === targetX && actor.y === targetY && !actor.isDead && actor.hasAttribute('solid')) {
                return null; // Blocked by solid actor, no warning needed
            }
        }

        // Check for void (no floor and no platform)
        if (!player.hasFloorAt(targetX, targetY) && !player.hasPlatformAt(targetX, targetY)) {
            return { message: confused ? "Risk diving into the depths?" : "Dive into the depths?" };
        }

        // Check for lava_behavior actors at target position
        if (!player.hasAttribute('fireproof')) {
            for (const actor of entityManager.actors) {
                if (actor.x !== targetX || actor.y !== targetY) continue;
                if (actor.isDead) continue;

                // Check if actor has lava_behavior personality
                if (actor.personality?.name === 'Lava') {
                    return { message: confused ? `Risk stepping into ${actor.name}?` : `Really step into ${actor.name}?` };
                }
            }
        }

        // Check for visible traps at target position
        for (const actor of entityManager.actors) {
            if (actor.x !== targetX || actor.y !== targetY) continue;
            if (actor.isDead) continue;

            // Warn about visible traps (traps that have been revealed)
            // Don't warn if there's an item on the trap - it won't trigger until item is moved
            if (actor.hasAttribute('trap') && actor.hasAttribute('visible') && !actor.hasAttribute('hidden')) {
                const itemOnTrap = entityManager.items.find(
                    i => i.x === targetX && i.y === targetY && !i.isDead
                );
                if (!itemOnTrap) {
                    return { message: confused ? `Risk stepping on the ${actor.name}?` : `Really step on the ${actor.name}?` };
                }
            }
        }

        return null; // No hazard
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
    }
}
