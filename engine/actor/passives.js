/**
 * Actor methods: passive item effects and trails, sprite position, facing,
 * submersion in liquids, and vision/awareness ranges.
 */

import { Entity } from '../entity.js';
import { TILE_HEIGHT, TILE_WIDTH } from '../../core/util.js';

export const ActorPassives = {
    // ========================================================================
    // PASSIVE ITEM EFFECTS
    // ========================================================================

    /**
     * Get the total passive stat bonus for a given stat from inventory items
     * @param {string} stat - The stat to get bonuses for (e.g., 'defense', 'accuracy')
     * @returns {number} Total bonus from all inventory items with stat_bonus passive effects
     */
    getPassiveStatBonus(stat) {
        let total = 0;
        for (const item of this.inventory) {
            const passiveEffect = item.getAttribute('passive_effect');
            if (passiveEffect?.type === 'stat_bonus' && typeof passiveEffect[stat] === 'number') {
                total += passiveEffect[stat];
            }
        }
        return total;
    },

    /**
     * Process passive effects from items in inventory after movement
     * @param {Object} fromPos - Previous position {x, y}
     * @param {Object} toPos - New position {x, y}
     */
    processPassiveEffects(fromPos, toPos) {
        for (const item of this.inventory) {
            const passiveEffect = item.getAttribute('passive_effect');
            if (!passiveEffect) continue;

            switch (passiveEffect.type) {
                case 'leave_trail':
                    this.processTrailEffect(item, passiveEffect, fromPos, toPos);
                    break;
                // Future passive effect types can be added here
            }
        }
    },

    /**
     * Process a trail-leaving passive effect
     * @param {Item} item - The item with the passive effect
     * @param {Object} effect - The passive effect configuration
     * @param {Object} fromPos - Previous position {x, y}
     * @param {Object} toPos - New position {x, y}
     */
    processTrailEffect(item, effect, fromPos, toPos) {
        // Initialize trail tracking on the item
        if (!item._trailData) {
            item._trailData = {
                positions: [],
                // A direct actor reference, not an id: Entity has no id field, so the
                // old `this.id` was always undefined and every comparison against it
                // passed for every actor. Safe to hold the object because _trailData
                // is never serialized — it lives and dies with the floor's entities.
                owner: this
            };
        }

        const trailData = item._trailData;

        // Show previously hidden trail segment (was hidden to avoid covering actor's spriteTop)
        if (trailData.hiddenSegment) {
            const hiddenEntity = trailData.hiddenSegment.entity;
            if (hiddenEntity?.sprite) hiddenEntity.sprite.alpha = 1;
            if (hiddenEntity?.tileSprite) hiddenEntity.tileSprite.alpha = 1;
            trailData.hiddenSegment = null;
        }

        // Check for backtracking (only owner can remove trail, only the last tile)
        if (effect.backtrack_removes && trailData.owner === this && trailData.positions.length > 0) {
            const lastSegment = trailData.positions[trailData.positions.length - 1];

            // Only remove if stepping onto the last tile in the trail (rewinding)
            if (lastSegment.x === toPos.x && lastSegment.y === toPos.y) {
                // Remove the last trail segment
                const removed = trailData.positions.pop();
                if (removed.entity) {
                    this.engine.entityManager.removeEntity(removed.entity);
                }
                // Update the now-endpoint tile
                if (trailData.positions.length > 0) {
                    this.updateTrailTile(trailData, trailData.positions.length - 1);
                }
                this._hideTrailAtSpriteTop(trailData, toPos);
                return;
            }
        }

        // Create new trail segment at previous position
        const direction = this.getMovementDirection(fromPos, toPos);
        const prevSegment = trailData.positions[trailData.positions.length - 1];
        const prevDirection = prevSegment ? prevSegment.exitDirection : null;

        // Create the trail entity
        const entity = this.createTrailEntity(item, effect, fromPos, prevDirection, direction);

        if (entity) {
            const newSegment = {
                x: fromPos.x,
                y: fromPos.y,
                entity: entity,
                entryDirection: prevDirection,
                exitDirection: direction
            };
            trailData.positions.push(newSegment);
        }

        this._hideTrailAtSpriteTop(trailData, toPos);
    },

    /**
     * Hide any trail segment that overlaps the actor's spriteTop position.
     * Thread trails render in uiContainer (above entityContainer), so they
     * cover actor top sprites. This hides the segment at (toPos.x, toPos.y - 1).
     */
    _hideTrailAtSpriteTop(trailData, toPos) {
        const topTileX = toPos.x;
        const topTileY = toPos.y - 1;
        for (const seg of trailData.positions) {
            if (seg.x === topTileX && seg.y === topTileY) {
                if (seg.entity?.sprite) seg.entity.sprite.alpha = 0;
                if (seg.entity?.tileSprite) seg.entity.tileSprite.alpha = 0;
                trailData.hiddenSegment = seg;
                return;
            }
        }
    },

    /**
     * Create a trail entity at the specified position
     * @param {Item} item - The source item
     * @param {Object} effect - The passive effect configuration
     * @param {Object} pos - Position to place the entity
     * @param {string|null} entryDir - Direction we entered from
     * @param {string} exitDir - Direction we're exiting to
     * @returns {Entity|null} The created entity
     */
    createTrailEntity(item, effect, pos, entryDir, exitDir) {
        const tileName = this.getTrailTileName(entryDir, exitDir);
        const tileIndex = this.engine.spriteLibrary.resolveTile(tileName);

        //console.log(`[Thread] Creating trail at (${pos.x}, ${pos.y}) - entry: ${entryDir}, exit: ${exitDir} -> tile: ${tileName}`);

        if (!tileIndex) {
            console.warn(`[Thread] Failed to resolve tile: ${tileName}`);
            return null;
        }

        const entity = new Entity(pos.x, pos.y, effect.trail_type || 'thread_trail', this.engine);
        entity.name = 'Thread';
        entity.tileIndex = tileIndex;
        entity.setAttribute('visible', true);
        entity.setAttribute('ignore_darkness', true);
        // Inherit flammability from the source item (e.g. ball of thread) so a trail
        // laid through or under fire catches and burns; a fireproof cord would not.
        if (item?.hasAttribute('flammable')) entity.setAttribute('flammable', true);

        // Apply item tint
        if (effect.use_item_tint && item.tint) {
            entity.tint = item.tint;
        }

        // Create sprite and add to entity manager
        this.engine.renderer?.createEntitySprite(entity);
        this.engine.entityManager.entities.push(entity);

        return entity;
    },

    /**
     * Get the direction of movement between two positions
     * @param {Object} from - Start position {x, y}
     * @param {Object} to - End position {x, y}
     * @returns {string|null} Direction: 'up', 'down', 'left', 'right', or null
     */
    getMovementDirection(from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        if (dy < 0) return 'up';
        if (dy > 0) return 'down';
        if (dx < 0) return 'left';
        if (dx > 0) return 'right';
        return null;
    },

    /**
     * Get the appropriate box drawing tile name for a trail segment
     * @param {string|null} entryDir - Direction we came FROM to reach this tile
     * @param {string|null} exitDir - Direction we're going TO from this tile
     * @returns {string} The tile name to use
     */
    getTrailTileName(entryDir, exitDir) {
        // If no entry (first segment) or no exit (endpoint), show based on the available direction
        if (!entryDir && !exitDir) {
            return 'WHITE_BOX_HORIZONTAL';
        }
        if (!entryDir) {
            return (exitDir === 'up' || exitDir === 'down')
                ? 'WHITE_BOX_VERTICAL'
                : 'WHITE_BOX_HORIZONTAL';
        }
        if (!exitDir) {
            return (entryDir === 'up' || entryDir === 'down')
                ? 'WHITE_BOX_VERTICAL'
                : 'WHITE_BOX_HORIZONTAL';
        }

        // Convert movement directions to connection directions
        // entryDir is the direction we MOVED to get here, so connection is opposite
        // exitDir is the direction we MOVE to leave, so connection is same
        const reverseDir = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
        const connectFrom = reverseDir[entryDir]; // where we came FROM
        const connectTo = exitDir;                 // where we're going TO

        // Sort for consistent lookup
        const connections = [connectFrom, connectTo].sort().join('-');

        // Tile names indicate where the corner is positioned
        // BOTTOM_RIGHT corner = lines extend UP and LEFT
        // TOP_RIGHT corner = lines extend DOWN and LEFT
        // BOTTOM_LEFT corner = lines extend UP and RIGHT
        // TOP_LEFT corner = lines extend DOWN and RIGHT
        const tileMap = {
            // Straight lines
            'down-up': 'WHITE_BOX_VERTICAL',
            'left-right': 'WHITE_BOX_HORIZONTAL',
            // Corners - named by corner position, connects the two OTHER directions
            'left-up': 'WHITE_BOX_BOTTOM_RIGHT',    // corner at bottom-right, lines go up and left
            'right-up': 'WHITE_BOX_BOTTOM_LEFT',    // corner at bottom-left, lines go up and right
            'down-left': 'WHITE_BOX_TOP_RIGHT',     // corner at top-right, lines go down and left
            'down-right': 'WHITE_BOX_TOP_LEFT'      // corner at top-left, lines go down and right
        };

        return tileMap[connections] || 'WHITE_BOX_HORIZONTAL';
    },

    /**
     * Update a trail segment's tile when connections change
     * @param {Object} trailData - The trail tracking data
     * @param {number} index - Index of the segment to update
     */
    updateTrailTile(trailData, index) {
        if (index < 0 || index >= trailData.positions.length) return;

        const segment = trailData.positions[index];
        if (!segment.entity) return;

        // Recalculate tile - this segment is now an endpoint (no exit)
        const tileName = this.getTrailTileName(segment.entryDirection, null);
        const tileIndex = this.engine.spriteLibrary.resolveTile(tileName);

        console.log(`[Thread] Updating endpoint at (${segment.x}, ${segment.y}) - entry: ${segment.entryDirection}, exit: null -> tile: ${tileName}`);

        if (tileIndex && segment.entity.sprite) {
            segment.entity.tileIndex = tileIndex;
            // Update sprite texture
            const tileset = PIXI.Loader.shared.resources.tiles;
            const rect = new PIXI.Rectangle(
                tileIndex.x * TILE_WIDTH,
                tileIndex.y * TILE_HEIGHT,
                TILE_WIDTH,
                TILE_HEIGHT
            );
            segment.entity.sprite.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        }
    },

    updateSpritePosition() {
        const useCenterAnchor = this.facingEnabled;
        const hw = TILE_WIDTH / 2;
        const hh = TILE_HEIGHT / 2;

        if (this.spriteBase) {
            let bx = this.x * TILE_WIDTH;
            let by = this.y * TILE_HEIGHT;
            if (useCenterAnchor || this.flipBaseH || this.flipBaseV) {
                bx += hw;
                by += hh;
            }
            this.spriteBase.x = bx;
            this.spriteBase.y = by;
        }
        if (this.spriteTop) {
            let tx = this.x * TILE_WIDTH;
            let ty = (this.y - 1) * TILE_HEIGHT;
            if (useCenterAnchor || this.flipTopH || this.flipTopV) {
                tx += hw;
                ty += hh;
            }
            this.spriteTop.x = tx;
            this.spriteTop.y = ty;
        }
        if (this.spriteSide) {
            const sideOffset = this.getEffectiveSideOffset();
            let sx = (this.x + sideOffset.dx) * TILE_WIDTH;
            let sy = (this.y + sideOffset.dy) * TILE_HEIGHT;
            if (useCenterAnchor || this.flipSideH || this.flipSideV) {
                sx += hw;
                sy += hh;
            }
            this.spriteSide.x = sx;
            this.spriteSide.y = sy;
        }
        // Update equipment sprite positions
        // top: above actor's top tile (y - 2)
        if (this.spriteEquipment.top) {
            let ex = this.x * TILE_WIDTH;
            let ey = (this.y - 2) * TILE_HEIGHT;
            if (useCenterAnchor) { ex += hw; ey += hh; }
            this.spriteEquipment.top.x = ex;
            this.spriteEquipment.top.y = ey;
        }
        // middle: on actor's top tile (y - 1)
        if (this.spriteEquipment.middle) {
            let ex = this.x * TILE_WIDTH;
            let ey = (this.y - 1) * TILE_HEIGHT;
            if (useCenterAnchor) { ex += hw; ey += hh; }
            this.spriteEquipment.middle.x = ex;
            this.spriteEquipment.middle.y = ey;
        }
        // lower: on actor's base tile (y)
        if (this.spriteEquipment.lower) {
            let ex = this.x * TILE_WIDTH;
            let ey = this.y * TILE_HEIGHT;
            if (useCenterAnchor) { ex += hw; ey += hh; }
            this.spriteEquipment.lower.x = ex;
            this.spriteEquipment.lower.y = ey;
        }

        // Update viewport visibility when actors move
        if (this.engine.viewportEnabled) {
            this.engine.renderer?.applyViewportCulling(
                this,
                this.engine.sectionOriginX,
                this.engine.sectionOriginY,
                this.engine.viewportWidth,
                this.engine.viewportHeight
            );
        }
    },

    /**
     * Apply fire damage to this actor at most once per its own turn. Overlapping,
     * spawning, and adjacent fires all funnel through here, so a tile piled with
     * fire (e.g. a fire trap's center + ring) can't stack into an instant kill —
     * the victim takes one hit per turn and the window resets when it next acts().
     * @param {number} amount - Damage to apply (typically the fire's damage_per_turn)
     * @returns {boolean} True if damage was applied this call, false if already burned this turn
     */
    takeFireDamageOncePerTurn(amount) {
        const turn = this._turnCount || 0;
        if (this._lastBurnedTurn === turn) return false; // already burned this turn
        this._lastBurnedTurn = turn;
        if (!(amount > 0) || !this.stats?.health) return false;
        this.stats.health.current = Math.max(0, this.stats.health.current - amount);
        this.flash?.();
        if (this.stats.health.current <= 0) this.die();
        return true;
    },

    /**
     * Flash the actor's sprites with color inversion for visual feedback
     * @param {number} duration - Duration of flash in milliseconds (default 100)
     */
    flash(duration = 100) {
        this.engine.renderer?.effectRunner.apply('flash', this, { duration_ms: duration });
    },

    isFacingFlipped() {
        return this.facingEnabled && this.facing !== this.defaultFacing;
    },

    getEffectiveSideOffset() {
        if (!this.sideOffset) return { dx: 1, dy: 0 };
        if (this.isFacingFlipped()) {
            return { dx: -this.sideOffset.dx, dy: this.sideOffset.dy };
        }
        return this.sideOffset;
    },

    setFacing(newFacing) {
        if (!this.facingEnabled) return;
        if (newFacing === this.facing) return;
        this.facing = newFacing;
        this.applyFacing();
    },

    applyFacing() {
        if (!this.facingEnabled) return;
        const flipped = this.isFacingFlipped();

        const applyFlip = (sprite, staticFlipH) => {
            if (!sprite) return;
            const effectiveFlipH = staticFlipH !== flipped;
            sprite.anchor.set(0.5, 0.5);
            sprite.scale.x = effectiveFlipH ? -1 : 1;
        };

        applyFlip(this.spriteBase, this.flipBaseH);
        applyFlip(this.spriteTop, this.flipTopH);
        applyFlip(this.spriteSide, this.flipSideH);

        for (const slot of ['top', 'middle', 'lower']) {
            applyFlip(this.spriteEquipment[slot], false);
        }

        this.updateSpritePosition();
    },

    /**
     * Check if there's a deep actor at the given position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Actor|null} The deep actor at position, or null
     */
    getDeepActorAt(x, y) {
        return this.engine.entityManager.getActorsAt(x, y)
            .find(a => a !== this && !a.hasAttribute('solid') && a.hasAttribute('deep')) || null;
    },

    /**
     * Aquatic actors (eels) are helpless when not standing in a liquid.
     * Shared by the turn gate in act() and the defense penalty in getEffectiveDefense().
     * @returns {boolean} True if this is an aquatic actor currently out of any liquid
     */
    isOutOfLiquid() {
        return this.hasAttribute('aquatic') &&
            !this.engine.entityManager._getLiquidActorAt(this.x, this.y);
    },

    /**
     * Submerge this actor (when entering a deep tile)
     *
     * A two-tile actor sinks: its head texture drops to the base position and the
     * top tile goes away, so only the head reads at the waterline. That draws a
     * body that is mostly underwater — it isn't what hides an ambusher. A
     * single-tile actor (an eel: base LEO, top BLANK -> null) has no head to
     * lower, so concealment is left to isConcealedBySubmersion().
     *
     * @param {Actor} deepActor - The deep actor we're submerging in
     */
    submerge(deepActor) {
        if (this.isSubmerged) return;

        this.isSubmerged = true;
        this.submergedIn = deepActor;
        this._submergedByTextureSwap = !!(this.spriteTop && this.spriteBase);

        // Store original textures for restoration
        if (this.spriteBase) {
            this._originalBaseTexture = this.spriteBase.texture;
        }
        if (this.spriteTop) {
            this._originalTopTexture = this.spriteTop.texture;
            this._originalTopVisible = this.spriteTop.visible;
        }

        if (this._submergedByTextureSwap) {
            this.spriteBase.texture = this.spriteTop.texture;
            this.spriteTop.visible = false;
        }

        // Hide side sprite (underwater)
        if (this.spriteSide) {
            this._originalSideVisible = this.spriteSide.visible;
            this.spriteSide.visible = false;
        }

        // Hide equipment sprites (they're underwater)
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.spriteEquipment[slot]) {
                this[`_originalEquipment${slot}Visible`] = this.spriteEquipment[slot].visible;
                this.spriteEquipment[slot].visible = false;
            }
        }

        // Extinguish carried light sources (torches go out in deep liquids)
        if (this.inventory) {
            const toExtinguish = this.inventory.filter(
                item => item.hasAttribute('light_source') && item.stats?.burns?.current > 0
            );
            for (const item of toExtinguish) {
               
                if (this.isPlayerControlled()) {
                    this.engine.playSound('extinguish');
                    this.engine.inputManager?.showMessage(`Your ${item.name} is extinguished.`);
                }
                // Same data-driven swap as the Extinguish verb: the unlit type and its
                // fuel config come from the item's own JSON, not from literals here.
                const unlitType = item.getAttribute('toggle_to') || 'torch_unlit';
                const newItem = this.buildToggledItem(item, unlitType);
                if (newItem) {
                    const idx = this.inventory.indexOf(item);
                    if (idx !== -1) this.inventory[idx] = newItem;
                } else {
                    this.inventory = this.inventory.filter(i => i !== item);
                }
            }
            if (toExtinguish.length > 0) {
                this.engine.updateLighting();
            }
        }

        // If this is the player, apply canvas tinting and show message
        if (this.isPlayerControlled() && deepActor) {
            this.engine.renderer?.applySubmersionTint(deepActor.tint);
            this.engine.inputManager?.showMessage(`You are submerged in ${deepActor.getNameWithArticle()}!`);
        }

        console.log(`${this.name} submerges in ${deepActor?.name || 'deep liquid'}`);
    },

    /**
     * Emerge from submersion (when exiting a deep tile)
     */
    emerge() {
        if (!this.isSubmerged) return;

        // Restore original base texture
        if (this.spriteBase && this._originalBaseTexture) {
            this.spriteBase.texture = this._originalBaseTexture;
        }

        // Restore and show top sprite
        if (this.spriteTop) {
            if (this._originalTopTexture) {
                this.spriteTop.texture = this._originalTopTexture;
            }
            this.spriteTop.visible = this._originalTopVisible !== false;
        }

        // Restore side sprite visibility
        if (this.spriteSide && this._originalSideVisible !== undefined) {
            this.spriteSide.visible = this._originalSideVisible;
        }

        // Restore equipment sprite visibility
        for (const slot of ['top', 'middle', 'lower']) {
            if (this.spriteEquipment[slot] && this[`_originalEquipment${slot}Visible`] !== undefined) {
                this.spriteEquipment[slot].visible = this[`_originalEquipment${slot}Visible`];
            }
        }

        // If this is the player, remove canvas tinting
        if (this.isPlayerControlled()) {
            this.engine.renderer?.removeSubmersionTint();
        }

        console.log(`${this.name} emerges from ${this.submergedIn?.name || 'deep liquid'}`);

        this.isSubmerged = false;
        this.submergedIn = null;
        this._submergedByTextureSwap = false;
        this._originalBaseTexture = null;
        this._originalTopTexture = null;
        this._originalTopVisible = null;
        this._originalSideVisible = null;
    },

    /**
     * Check and update submersion state based on current position
     */
    updateSubmersionState() {
        const deepActor = this.getDeepActorAt(this.x, this.y);

        if (deepActor && !this.isSubmerged) {
            this.submerge(deepActor);
        } else if (!deepActor && this.isSubmerged) {
            this.emerge();
        }
    },

    /**
     * Check if this actor can see the target (distance + line-of-sight check)
     * @param {Entity} target - The target to check visibility for
     * @returns {boolean} True if target is within vision range and has clear line of sight
     */
    getEffectiveVisionRange() {
        let range = this.visionRange + this.getPassiveStatBonus('visionRange');
        for (const slot of ['ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.visionRange === 'number') {
                    range += wearEffect.visionRange;
                }
            }
        }
        // A state's vision_cap (blinded) is a hard ceiling, applied after every bonus
        const cap = this.findStateWithProperty('vision_cap', { lowest: true });
        if (cap) range = Math.min(range, cap.value);
        return range;
    },

    /**
     * Awareness: how good this actor is at noticing concealed things. Feeds the
     * search strength in Engine.searchFrom — Brogue's rogue.awarenessBonus, where
     * a Ring of Awareness contributes 20 per point of enchantment (Items.c:7259).
     * @returns {number} Awareness bonus (0 for an actor with no sources)
     */
    getEffectiveAwareness() {
        let base = this.getAttribute('awareness') || 0;

        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment[slot];
            if (item) {
                const wearEffect = item.getAttribute('wear_effect');
                if (wearEffect && typeof wearEffect.awareness === 'number') {
                    // Enchantment scales the ring the way it scales defense
                    // (see getEffectiveDefense): each point is another full ring.
                    base += wearEffect.awareness * (1 + (item.enchantment || 0));
                }
            }
        }

        base += this.getPassiveStatBonus('awareness');
        return base;
    },

    /**
     * How fast this actor's staffs recharge: each worn item's `recharge_multiplier`
     * raised to (1 + enchantment), all multiplied together — Brogue's ring of
     * wisdom (ringWisdomMultiplier) at 1.3. A cursed item inverts the effect, so
     * it slows recharging.
     * @returns {number} Multiplier on a staff's per-turn recharge
     */
    getRechargeMultiplier() {
        let multiplier = 1;
        for (const slot of ['weapon', 'top', 'middle', 'lower', 'ring1', 'ring2']) {
            const item = this.equipment?.[slot];
            const wearEffect = item?.getAttribute('wear_effect');
            if (wearEffect && typeof wearEffect.recharge_multiplier === 'number') {
                multiplier *= Math.pow(wearEffect.recharge_multiplier, 1 + (item.enchantment || 0));
            }
        }
        return multiplier;
    },
};
