
// ============================================================================
// INPUT MANAGER
// ============================================================================

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

        // Message stacking for turn-based events
        this.messageStack = [];

        // Auto-walk state
        this.autoWalkPath = null; // Current path being walked
        this.autoWalkIndex = 0; // Current position in path
        this.autoWalking = false; // Whether auto-walk is in progress
        this.autoWalkDelay = 100; // Milliseconds between steps (2 steps per second)

        // Turn history - stores all past turns for future history viewer
        // Each entry is an array of messages from that turn
        this.turnHistory = [];
        // Number of recent turns to display (current + 2 older)
        this.visibleTurnCount = 3;
        // Temporary hover description (doesn't affect turn history)
        this.hoverDescription = null;

        // Key mappings (supports multiple keys per action)
        this.keyMap = {
            // Arrow keys and WASD for movement
            'ArrowUp': 'move_up',
            'ArrowDown': 'move_down',
            'ArrowLeft': 'move_left',
            'ArrowRight': 'move_right',
            'w': 'move_up',
            'W': 'move_up',
            's': 'move_down',
            'S': 'move_down',
            'a': 'move_left',
            'A': 'move_left',
            'd': 'move_right',
            'D': 'move_right',
            // Numpad for 8-directional movement
            'Numpad8': 'move_up',
            'Numpad2': 'move_down',
            'Numpad4': 'move_left',
            'Numpad6': 'move_right',
            'Numpad7': 'move_up_left',
            'Numpad9': 'move_up_right',
            'Numpad1': 'move_down_left',
            'Numpad3': 'move_down_right',
            // Vi keys
            'k': 'move_up',
            'j': 'move_down',
            'h': 'move_left',
            'l': 'move_right',
            'y': 'move_up_left',
            'u': 'move_up_right',
            'b': 'move_down_left',
            'n': 'move_down_right',
            // Other actions
            'z': 'wait',
            'Z': 'wait',
            '.': 'wait',
            'Numpad5': 'wait',
            'i': 'player_info',
            'I': 'player_info',
            't': 'throw_item',
            'T': 'throw_item',
            'e': 'equipment_menu',
            'E': 'equipment_menu'
        };

        // Global keys (work regardless of player state)
        this.globalKeyMap = {
            ' ': 'toggle_pause',
            'Escape': 'reload'
        };

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
                }

                // Store bound handlers so we can remove them later
                this.boundMouseMove = (e) => this.handleMouseMove(e);
                this.boundMouseLeave = () => this.handleMouseLeave();

                this.boundMouseClick = (e) => this.handleMouseClick(e);

                canvas.addEventListener('mousemove', this.boundMouseMove);
                canvas.addEventListener('mouseleave', this.boundMouseLeave);
                canvas.addEventListener('click', this.boundMouseClick);
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

            // Update throw path if in aiming mode
            if (this.engine.interfaceManager?.isThrowAiming()) {
                this.engine.interfaceManager.updateThrowPath();
            } else if (this.engine.interfaceManager?.isSpellAiming()) {
                // Update spell path if in spell aiming mode
                this.engine.interfaceManager.updateSpellPath();
            } else if (!this.autoWalking) {
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
        // Hide tile highlight
        this.engine.renderer?.hideTileHighlight();
        // Hide throw path if in aiming mode
        this.engine.renderer?.hideLinePath();
        // Hide walk path
        this.engine.renderer?.hideWalkPath();
    }

    handleMouseClick(event) {
        if (!this.enabled) return;

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

        // Start auto-walk if there's a valid path
        this.startAutoWalk();
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

        // Don't show path if target is player's current position
        if (tileX === player.x && tileY === player.y) {
            renderer.hideWalkPath();
            return;
        }

        // Don't show path if UI is open
        const ui = this.engine.interfaceManager;
        if (ui?.inventoryMode || ui?.confirmDialog || ui?.throwMenuMode || ui?.equipmentMenuMode || ui?.identifyMode) {
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

        const targetX = this.hoveredTile.x;
        const targetY = this.hoveredTile.y;

        // Don't start if target is invalid or same as player position
        if (targetX < 0 || targetY < 0) return;
        if (targetX === player.x && targetY === player.y) return;

        // Check if target tile has a solid actor → click-to-collide
        const solidActor = this.engine.entityManager?.getSolidActorAt(targetX, targetY);
        if (solidActor) {
            const dx = targetX - player.x;
            const dy = targetY - player.y;
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                // Adjacent: immediately collide (same as pressing the arrow key)
                this.clearMessageStack();
                const result = player.moveBy(dx, dy);
                if (result.moved) {
                    this.engine.playSoundVaried(result.entrySound || 'feets', 0.4, 0.1, 1.0, 0.06);
                } else if (!result.actionTaken) {
                    this.engine.playSound('tap1');
                }
                if (result.actionTaken) this.onPlayerAction();
            } else {
                // Non-adjacent: walk to a tile adjacent to the solid actor, then collide
                const adjTile = this.findAdjacentWalkableTile(targetX, targetY);
                if (adjTile) {
                    this.pendingCollisionTarget = { x: targetX, y: targetY };
                    this.executeAutoWalk(adjTile.x, adjTile.y);
                }
            }
            return;
        }

        // Check if target tile has a hazardous actor
        const targetActor = this.engine.entityManager?.getActorAt(targetX, targetY);
        const damageType = targetActor?.getAttribute('damage_type');
        if (damageType && !player.hasAttribute(`${damageType}_immune`)) {
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
        } else {
            // Movement blocked - stop auto-walk
            if (!result.actionTaken) {
                this.engine.playSound('tap1');
            }
            this.stopAutoWalk();
        }
    }

    /**
     * Check for notable events that should interrupt auto-walk
     * @returns {string|null} Description of the notable event, or null if none
     */
    checkNotableEvents() {
        // Flags to enable/disable each condition
        const STOP_ON_HOSTILE_COMES_INTO_VIEW = false;
        const STOP_ON_HOSTILE_APPROACHES = true;
        const STOP_ON_ITEM_COMES_INTO_VIEW = false;

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
     * Cancel auto-walk (called on keyboard input or other interruption)
     */
    cancelAutoWalk() {
        if (this.autoWalking) {
            this.stopAutoWalk();
            return true;
        }
        return false;
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
        if (!actor || actor.isDead) {
            // Check if we're hovering over an actor's top sprite (actor is at y+1)
            const actorBelow = entityManager.getActorAt(tileX, tileY + 1);
            if (actorBelow && !actorBelow.isDead && actorBelow.height === 2) {
                actor = actorBelow;
            }
        }

        // Check if the player is hallucinating (scramble non-player descriptions)
        const player = entityManager.player;
        const isHallucinating = player?.hasStateProperty?.('hallucinating');

        if (actor && !actor.isDead && actor.hasAttribute('visible')) {
            if (isHallucinating && !actor.isPlayerControlled()) {
                entities.push(this._getHallucinatedName());
            } else {
                entities.push(this.getEntityDescription(actor));
            }
        }

        // Check for items at this position
        const item = entityManager.getItemAt(tileX, tileY);
        if (item && item.hasAttribute('visible')) {
            if (isHallucinating) {
                entities.push(this._getHallucinatedName());
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
    showMessage(message) {
        if (!this.descriptionElement) return;

        // Strip trailing periods to get base text for comparison
        const baseNew = message.replace(/\.+$/, '');

        // Check current turn's last message first
        if (this.messageStack.length > 0) {
            const lastMessage = this.messageStack[this.messageStack.length - 1];
            const baseLast = lastMessage.replace(/\.+$/, '');
            if (baseNew === baseLast) {
                this.messageStack[this.messageStack.length - 1] = lastMessage + '.';
                this.displayMessages();
                return;
            }
        }
        // Check last message from the most recent history turn
        else if (this.turnHistory.length > 0) {
            const lastTurn = this.turnHistory[this.turnHistory.length - 1];
            if (lastTurn.length > 0) {
                const lastMessage = lastTurn[lastTurn.length - 1];
                const baseLast = lastMessage.replace(/\.+$/, '');
                if (baseNew === baseLast) {
                    lastTurn[lastTurn.length - 1] = lastMessage + '.';
                    this.displayMessages();
                    return;
                }
            }
        }

        // Add to message stack
        this.messageStack.push(message);

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
                const lines = turn.messages.join('\n').split('\n');
                lines.forEach((line, lineIndex) => {
                    if (lineIndex > 0) {
                        turnSpan.appendChild(document.createElement('br'));
                    }
                    turnSpan.appendChild(document.createTextNode(line));
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
        // Returns the entity name with appropriate article
        // Use getDisplayName() for items (identification-aware), fall back to name
        const displayName = entity.getDisplayName ? entity.getDisplayName() : entity.name;

        // Check for 'mass_noun' attribute (lava, sewage, water, etc.) - no article needed
        if (entity.hasAttribute('mass_noun')) {
            return displayName.toLowerCase();
        }
        const article = this.getIndefiniteArticle(displayName);
        return `${article} ${displayName}`;
    }

    getIndefiniteArticle(name) {
        // Returns 'a' or 'an' based on the first letter of the name
        const firstLetter = name.charAt(0).toLowerCase();
        const vowels = ['a', 'e', 'i', 'o', 'u'];
        return vowels.includes(firstLetter) ? 'an' : 'a';
    }

    /**
     * Generate a fake entity description from a random tile name (for hallucination)
     * @returns {string} A fake description like "a skull" or "an open door"
     */
    _getHallucinatedName() {
        const rawName = this.engine.spriteLibrary?.getRandomTileName() || 'something';
        const displayName = rawName.toLowerCase().replace(/_/g, ' ');
        return `${this.getIndefiniteArticle(displayName)} ${displayName}`;
    }

    handleKeyDown(event) {
        if (!this.enabled) return;

        // Cancel auto-walk on any key press
        if (this.cancelAutoWalk()) {
            event.preventDefault();
            return;
        }

        // Check if throw aiming mode wants to handle this key first
        if (this.engine.interfaceManager?.handleThrowKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if spell aiming mode wants to handle this key
        if (this.engine.interfaceManager?.handleSpellAimingKey(event.key)) {
            event.preventDefault();
            return;
        }

        // Check if throw menu wants to handle this key
        if (this.engine.interfaceManager?.handleThrowMenuKey(event.key)) {
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
        const globalAction = this.globalKeyMap[event.key] || this.globalKeyMap[event.code];
        if (globalAction) {
            event.preventDefault();
            this.executeGlobalAction(globalAction);
            return;
        }

        // Player-specific actions require a living player
        const player = this.engine.entityManager?.player;
        if (!player || player.isDead) return;

        const action = this.keyMap[event.key] || this.keyMap[event.code];
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

        // Handle movement actions
        if (this.directions[action]) {
            let dir = this.directions[action];

            // Confusion: randomize movement direction
            if (player.hasStateProperty('random_movement')) {
                const dirs = Object.values(this.directions);
                dir = dirs[Math.floor(Math.random() * dirs.length)];
            }

            const targetX = player.x + dir.dx;
            const targetY = player.y + dir.dy;

            // Check for hazards that need confirmation
            const isConfused = player.hasStateProperty('random_movement');
            const hazardCheck = this.checkMovementHazard(player, targetX, targetY, isConfused);
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
            } else if (!result.actionTaken) {
                // Bumped into a wall or obstacle with no effect
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
        }
    }

    onPlayerAction() {
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

        // Check for void (no floor)
        if (!player.hasFloorAt(targetX, targetY)) {
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
            if (actor.hasAttribute('trap') && actor.hasAttribute('visible')) {
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
