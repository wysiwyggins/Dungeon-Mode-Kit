/**
 * RenderSystem methods: drawing map layers, tiles, actors, entities,
 * equipment and items, and their z-ordering.
 */

import { DEFAULT_ANIMATION_SPEED, ITEM_Z, SPRITESHEET_COLS, TILE_HEIGHT, TILE_WIDTH, parseTint } from '../../core/util.js';

export const RenderSprites = {
    render() {
        // Render loop would update sprites based on entity positions
        console.log('Rendering frame');
    },
    
    renderTestPattern(mapManager) {
        console.log('Rendering Tiled map...');

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) {
            console.error('Tileset not loaded');
            return;
        }

        // Clear map layers only (not entityContainer - items/actors may already be there)
        this.clearMapLayers();

        // Initialize sprite tracking arrays
        this.backgroundSprites = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => null)
        );
        this.floorSprites = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => null)
        );

        // Render background layer
        this.renderLayer(mapManager.backgroundMap, this.backgroundContainer, tileset, this.backgroundSprites);

        // Render floor layer
        this.renderLayer(mapManager.floorMap, this.floorContainer, tileset, this.floorSprites);

        // Render overlay layer (decorative tiles above entities)
        this.overlaySprites = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => null)
        );
        this.renderLayer(mapManager.overlayMap, this.overlayContainer, tileset, this.overlaySprites);

        console.log(`Rendered tiles:`);
        console.log(`  Background: ${this.backgroundContainer.children.length} tiles`);
        console.log(`  Floor: ${this.floorContainer.children.length} tiles`);
        console.log(`  Overlay: ${this.overlayContainer.children.length} tiles`);
    },

    /**
     * Render raw Tiled tilelayers (from a parsed .tmj) as flipbook cutscene frames.
     * Each entry in `frameLayers` becomes its own hidden PIXI.Container of tile sprites added to
     * the floor container; the cutscene driver toggles which one is visible. Any un-numbered
     * layers (e.g. `background`/`floor`) are drawn once as a static backdrop beneath every frame.
     *
     * @param {Array} frameLayers - Tiled tilelayer objects (have width/height/data), in play order
     * @param {Array} backdropLayers - Tiled tilelayer objects drawn once under every frame
     * @returns {Array<PIXI.Container>} per-frame containers, in order (all start hidden)
     */
    renderCutsceneFrames(frameLayers, backdropLayers = []) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) {
            console.error('Tileset not loaded');
            return [];
        }

        this.clearMapLayers();

        const buildLayerSprites = (layer, container) => {
            for (let y = 0; y < layer.height; y++) {
                for (let x = 0; x < layer.width; x++) {
                    const raw = layer.data[y * layer.width + x];
                    if (!raw) continue;
                    const tile = this.engine.mapManager.parseTileGID(raw);
                    if (tile.tileId > 0) {
                        container.addChild(this.createTileSprite(tile, x, y, tileset));
                    }
                }
            }
        };

        // Static backdrop, drawn once beneath the frames.
        for (const layer of backdropLayers) {
            buildLayerSprites(layer, this.backgroundContainer);
        }

        // One container per frame, all hidden; driver flips visibility.
        const frameContainers = frameLayers.map((layer) => {
            const container = new PIXI.Container();
            container.alpha = layer.opacity ?? 1;
            container.visible = false;
            buildLayerSprites(layer, container);
            this.floorContainer.addChild(container);
            return container;
        });

        console.log(`Cutscene: ${frameContainers.length} frames, ${backdropLayers.length} backdrop layer(s)`);
        return frameContainers;
    },

    /**
     * Render a single map layer to a container
     */
    renderLayer(layerMap, container, tileset, spriteArray = null) {
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                const tile = layerMap[y]?.[x];

                if (tile && tile.tileId > 0) {
                    const sprite = this.createTileSprite(tile, x, y, tileset);
                    container.addChild(sprite);
                    if (spriteArray) {
                        spriteArray[y][x] = sprite;
                    }
                }
            }
        }
    },

    /**
     * Remove the sprite at (x, y) on a map layer, leaving the cell empty. The
     * counterpart of renderTileAt, which only draws and so can't clear a cell
     * whose tile was taken away (a descent hole's floor).
     * @param {string} layerName - 'background', 'floor' or 'overlay'
     */
    clearTileAt(layerName, x, y) {
        const sprites = { background: this.backgroundSprites, floor: this.floorSprites, overlay: this.overlaySprites }[layerName];
        const sprite = sprites?.[y]?.[x];
        if (!sprite) return;
        sprite.destroy();
        sprites[y][x] = null;
    },

    renderTileAt(layerName, x, y, mapManager) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;

        const layers = {
            'background': { map: 'backgroundMap', container: this.backgroundContainer, sprites: this.backgroundSprites },
            'floor': { map: 'floorMap', container: this.floorContainer, sprites: this.floorSprites },
            'overlay': { map: 'overlayMap', container: this.overlayContainer, sprites: this.overlaySprites }
        };

        const layer = layers[layerName];
        if (!layer) return;

        const tile = mapManager[layer.map][y]?.[x];
        if (!tile || tile.tileId <= 0) return;

        if (layer.sprites?.[y]?.[x]) {
            layer.sprites[y][x].destroy();
            layer.sprites[y][x] = null;
        }

        const sprite = this.createTileSprite(tile, x, y, tileset);
        layer.container.addChild(sprite);
        if (layer.sprites?.[y]) {
            layer.sprites[y][x] = sprite;
        }
    },

    /**
     * Create a sprite for a tile ID at a position
     */
    createTileSprite(tile, x, y, tileset) {
        const tileId = typeof tile === 'number' ? tile : tile.tileId;
        // Convert Tiled tile ID (1-indexed) to spritesheet coordinates
        const tileIndex = tileId - 1;
        const tileX = tileIndex % SPRITESHEET_COLS;
        const tileY = Math.floor(tileIndex / SPRITESHEET_COLS);

        const texture = this.getTileTexture(
            tileX * TILE_WIDTH,
            tileY * TILE_HEIGHT
        );
        const sprite = new PIXI.Sprite(texture);

        sprite.x = x * TILE_WIDTH;
        sprite.y = y * TILE_HEIGHT;

        // A tile may carry its own tint (a prototype's default_floor.tint). Only the
        // floor layer uses this: lighting recomputes background and overlay tints
        // every frame, so a static value there would be overwritten — floors are
        // dimmed by a separate overlay layer instead, leaving their tint free.
        if (typeof tile === 'object' && tile.tint) {
            sprite.tint = parseTint(tile.tint);
        }

        // Apply Tiled flip/rotation flags
        if (typeof tile === 'object') {
            if (tile.flipD) {
                // Diagonal flip = 90° rotation + horizontal flip
                sprite.anchor.set(0.5, 0.5);
                sprite.x += TILE_WIDTH / 2;
                sprite.y += TILE_HEIGHT / 2;
                sprite.rotation = Math.PI / 2;
                sprite.scale.x = tile.flipH ? 1 : -1;
                sprite.scale.y = tile.flipV ? -1 : 1;
            } else {
                if (tile.flipH || tile.flipV) {
                    sprite.anchor.set(0.5, 0.5);
                    sprite.x += TILE_WIDTH / 2;
                    sprite.y += TILE_HEIGHT / 2;
                    if (tile.flipH) sprite.scale.x = -1;
                    if (tile.flipV) sprite.scale.y = -1;
                }
            }
        }

        return sprite;
    },
    
    renderActors(entityManager) {
        console.log('Rendering actors...');

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) {
            console.error('Tileset not loaded');
            return;
        }

        let actorsRendered = 0;

        // Render all actors
        for (const actor of entityManager.actors) {
            // Skips invisible actors and hidden-on-floor ones (traps, plates).
            // A hidden actor with disguise tiles still renders — as its disguise.
            if (actor.isUnsprited()) continue;

            // Skip actors that already have sprites (e.g., dynamically spawned
            // by spawnActor before renderActors runs)
            if (actor.spriteBase) {
                actorsRendered++;
                continue;
            }

            // Same layering as createActorSprites — this is the level-load path and
            // that one handles dynamic spawns, but both must honour 'render_layer'.
            // Hardcoding 10/11 here meant the attribute did nothing for anything
            // placed during generation: water (render_layer "top") tied with a
            // skeleton standing in it instead of covering its base tile.
            const baseZ = this._actorLayerBaseZ(actor);
            const topZ = baseZ + 1;

            // Render base sprite (static or animated)
            actor.spriteBase = this.createActorSprite(
                actor,
                actor.getDisplayTileBase(),
                actor.animationBase,
                actor.x * TILE_WIDTH,
                actor.y * TILE_HEIGHT,
                baseZ,
                { flipH: actor.flipBaseH, flipV: actor.flipBaseV }
            );

            // Render top sprite (static or animated) - one tile above
            actor.spriteTop = this.createActorSprite(
                actor,
                actor.getDisplayTileTop(),
                actor.animationTop,
                actor.x * TILE_WIDTH,
                (actor.y - 1) * TILE_HEIGHT,
                topZ,
                { flipH: actor.flipTopH, flipV: actor.flipTopV }
            );

            // Render side sprite if defined
            if (actor.tileIndexSide || actor.animationSide) {
                const sideOffset = actor.getEffectiveSideOffset();
                actor.spriteSide = this.createActorSprite(
                    actor,
                    actor.tileIndexSide,
                    actor.animationSide,
                    (actor.x + sideOffset.dx) * TILE_WIDTH,
                    (actor.y + sideOffset.dy) * TILE_HEIGHT,
                    baseZ,
                    { flipH: actor.flipSideH, flipV: actor.flipSideV }
                );
            }

            // Render equipment sprites for each slot
            for (const slot of ['top', 'middle', 'lower']) {
                const equippedItem = actor.getEquippedItem(slot);
                if (equippedItem) {
                    actor.spriteEquipment[slot] = this.createEquipmentSprite(
                        actor,
                        equippedItem,
                        slot
                    );
                }
            }

            if (actor.facingEnabled) actor.applyFacing();

            actorsRendered++;
        }

        console.log(`Rendered ${actorsRendered} actors`);
    },

    /**
     * Create sprites for a single actor (used when spawning actors dynamically)
     * @param {Actor} actor - The actor to create sprites for
     */
    /**
     * Return a cached PIXI.Texture for the given pixel sub-rectangle of the shared
     * tileset base texture, creating it once on first request. Reused across all
     * sprites that show the same tile, avoiding a per-sprite texture allocation.
     * @param {number} px - left pixel of the tile within the spritesheet
     * @param {number} py - top pixel of the tile within the spritesheet
     * @returns {PIXI.Texture}
     */
    getTileTexture(px, py) {
        const key = px + ',' + py;
        let texture = this._tileTextureCache.get(key);
        if (!texture) {
            const tileset = PIXI.Loader.shared.resources.tiles;
            const rect = new PIXI.Rectangle(px, py, TILE_WIDTH, TILE_HEIGHT);
            texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
            this._tileTextureCache.set(key, texture);
        }
        return texture;
    },

    /**
     * Base zIndex for an actor's sprite stack based on its 'render_layer'
     * attribute: "bottom" sinks below normal actors, "top" rises above them (and
     * above attached fire at 12/13); anything else uses the normal band. The top
     * sprite is always baseZ+1, so a whole stack shifts together.
     * @param {Actor} actor
     * @returns {number} base zIndex (top sprite uses this + 1)
     */
    _actorLayerBaseZ(actor) {
        switch (actor.getAttribute('render_layer')) {
            case 'bottom': return 6;
            case 'top': return 14;
            default: return 10;
        }
    },

    createActorSprites(actor) {
        if (actor.isUnsprited?.() ?? !actor.hasAttribute('visible')) return;

        // Within the entity container, base/top sprites default to zIndex 10/11
        // (attached fire 12/13). The optional 'render_layer' attribute shifts an
        // actor's whole stack so it reliably sits below or above normal actors
        // sharing its tile — e.g. a collapsible floor is "bottom" so a creature
        // (or flying actor) hovering over it renders on top. Absent = normal.
        const isAttachedFire = actor._isAttachedFire;
        const baseZ = isAttachedFire ? 12 : this._actorLayerBaseZ(actor);
        const topZ = baseZ + 1;

        // Render base sprite (static or animated). getDisplayTileBase serves the
        // disguise for a hidden door, so it spawns looking like wall.
        actor.spriteBase = this.createActorSprite(
            actor,
            actor.getDisplayTileBase?.() ?? actor.tileIndexBase,
            actor.animationBase,
            actor.x * TILE_WIDTH,
            actor.y * TILE_HEIGHT,
            baseZ,
            { flipH: actor.flipBaseH, flipV: actor.flipBaseV }
        );

        // Render top sprite (static or animated) - one tile above
        actor.spriteTop = this.createActorSprite(
            actor,
            actor.getDisplayTileTop?.() ?? actor.tileIndexTop,
            actor.animationTop,
            actor.x * TILE_WIDTH,
            (actor.y - 1) * TILE_HEIGHT,
            topZ,
            { flipH: actor.flipTopH, flipV: actor.flipTopV }
        );

        // Render side sprite if defined
        if (actor.tileIndexSide || actor.animationSide) {
            const sideOffset = actor.getEffectiveSideOffset();
            actor.spriteSide = this.createActorSprite(
                actor,
                actor.tileIndexSide,
                actor.animationSide,
                (actor.x + sideOffset.dx) * TILE_WIDTH,
                (actor.y + sideOffset.dy) * TILE_HEIGHT,
                baseZ,
                { flipH: actor.flipSideH, flipV: actor.flipSideV }
            );
        }

        // Render equipment sprites for each slot
        for (const slot of ['top', 'middle', 'lower']) {
            const equippedItem = actor.getEquippedItem(slot);
            if (equippedItem) {
                actor.spriteEquipment[slot] = this.createEquipmentSprite(
                    actor,
                    equippedItem,
                    slot
                );
            }
        }

        if (actor.facingEnabled) actor.applyFacing();

        this._hideIfSpawnedOutOfSight(actor);
    },

    /**
     * New sprites start out visible, and only a full lighting pass hides them —
     * which a spawn that neither lights nor shades (gas, spores) never triggers.
     * So sewer gas bubbling up in a remembered room showed through the fog until
     * the player next moved. Apply the same rule updateEntityLighting would: a
     * mobile actor on a tile out of sight is hidden. Static actors keep showing in
     * remembered areas, and the next lighting pass sorts out their dimming.
     */
    _hideIfSpawnedOutOfSight(actor) {
        const lm = this.engine.lightingManager;
        if (!lm || actor.hasAttribute('controlled')) return;
        // Bottom-layer actors always show, as part of the floor (see updateEntityLighting)
        if (actor.getAttribute('render_layer') === 'bottom') return;
        // Telepathy reveals sentient creatures wherever they are
        if (actor.hasAttribute('sentient') && this.engine.entityManager?.player?.hasStateProperty?.('telepathic')) return;

        const fogOfWar = this.engine.currentPrototype?.config?.mechanics?.fog_of_war;
        const isStatic = !actor.personality;
        if (!lm.getEntityVisibility(actor.x, actor.y, fogOfWar, isStatic).showBase) {
            this._hideEntitySprites(actor);
        }
    },

    /**
     * Create a sprite for an actor tile (base or top)
     * @param {Actor} actor - The actor this sprite belongs to
     * @param {Object|null} tileIndex - Static tile coordinates {x, y} or null
     * @param {string|null} animationName - Animation name (e.g., 'fire') or null
     * @param {number} x - Pixel x position
     * @param {number} y - Pixel y position
     * @param {number} zIndex - Render layer
     * @param {Object} options - Additional options {flipH: boolean, flipV: boolean}
     * @returns {PIXI.Sprite|PIXI.AnimatedSprite|null} The created sprite or null
     */
    createActorSprite(actor, tileIndex, animationName, x, y, zIndex, options = {}) {
        // Check for animated sprite first
        if (animationName && this.engine.animationFrames) {
            const animFrames = this.engine.animationFrames[animationName];
            if (animFrames && animFrames.length > 0) {
                const animSprite = new PIXI.AnimatedSprite(animFrames);
                animSprite.x = x;
                animSprite.y = y;
                // Per-animation `speed` from the manifest, else the long-standing
                // default. A two-frame sheet like pac's chomp wants a different rate
                // from an eight-frame flame, and only the data knows which is which.
                animSprite.animationSpeed =
                    this.engine.animationSpeeds?.[animationName] ?? DEFAULT_ANIMATION_SPEED;
                // Start on a random frame so multiple instances aren't in sync
                const startFrame = Math.floor(Math.random() * animFrames.length);
                animSprite.gotoAndPlay(startFrame);
                animSprite.zIndex = zIndex;
                animSprite.tint = actor.getDisplayTint?.() ?? actor.tint;

                const animEffect = actor.getActiveEffect?.() ?? actor.effect;
                if (animEffect) {
                    this.effectRunner.apply(animEffect, animSprite,
                        { baseTint: this.getEffectiveTint(actor) ?? actor.tint });
                }

                this.entityContainer.addChild(animSprite);
                return animSprite;
            }
        }

        // Fall back to static sprite
        if (tileIndex) {
            const texture = this.getTileTexture(
                tileIndex.x * TILE_WIDTH,
                tileIndex.y * TILE_HEIGHT
            );
            const sprite = new PIXI.Sprite(texture);

            sprite.zIndex = zIndex;
            sprite.tint = actor.getDisplayTint?.() ?? actor.tint;

            // Apply horizontal/vertical flip using anchor and scale
            // Set anchor to center for flipping, then adjust position
            if (options.flipH || options.flipV) {
                sprite.anchor.set(0.5, 0.5);
                sprite.x = x + TILE_WIDTH / 2;
                sprite.y = y + TILE_HEIGHT / 2;
                if (options.flipH) {
                    sprite.scale.x = -1;
                }
                if (options.flipV) {
                    sprite.scale.y = -1;
                }
            } else {
                sprite.x = x;
                sprite.y = y;
            }

            // Asks the actor rather than reading actor.effect directly: a sprite
            // rebuilt while a state with an `effect` is running (floor transition,
            // disguise swap) must come back still running it.
            const spriteEffect = actor.getActiveEffect?.() ?? actor.effect;
            if (spriteEffect) {
                this.effectRunner.apply(spriteEffect, sprite,
                    { baseTint: this.getEffectiveTint(actor) ?? actor.tint });
            }

            this.entityContainer.addChild(sprite);
            return sprite;
        }

        // No sprite to render
        return null;
    },

    /**
     * Create a sprite for a decorative entity
     * @param {Entity} entity - The entity to create a sprite for
     */
    createEntitySprite(entity) {
        const x = entity.x * TILE_WIDTH;
        const y = entity.y * TILE_HEIGHT;

        // Entities that ignore darkness go in uiContainer (above darkness layer)
        const ignoreDarkness = entity.hasAttribute('ignore_darkness');
        const container = ignoreDarkness ? this.uiContainer : this.entityContainer;
        // Use low zIndex in uiContainer so thread appears below UI windows
        const zIndex = ignoreDarkness ? 1 : 5;

        // If entity has a fill color, create a colored rectangle
        if (entity.fillColor !== null && entity.fillColor !== undefined) {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(entity.fillColor);
            graphics.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            graphics.drawRect(0, 0, TILE_WIDTH, TILE_HEIGHT);
            graphics.endFill();
            graphics.x = x;
            graphics.y = y;
            graphics.zIndex = zIndex;

            container.addChild(graphics);
            entity.sprite = graphics;
        }

        // If entity has a tile index, create a sprite on top of any fill
        if (entity.tileIndex) {
            const texture = this.getTileTexture(
                entity.tileIndex.x * TILE_WIDTH,
                entity.tileIndex.y * TILE_HEIGHT
            );
            const sprite = new PIXI.Sprite(texture);

            sprite.x = x;
            sprite.y = y;
            sprite.zIndex = zIndex + 1; // Slightly above fill
            sprite.tint = entity.tint;

            container.addChild(sprite);

            // If we already have a fill sprite, store tile sprite separately
            if (entity.sprite) {
                entity.tileSprite = sprite;
            } else {
                entity.sprite = sprite;
            }
        }
    },

    /**
     * Create a sprite for an equipped item displayed on an actor
     * @param {Actor} actor - The actor wearing the item
     * @param {Item} item - The equipped item
     * @param {string} slot - The equipment slot ('top', 'middle', or 'lower')
     * @returns {PIXI.Sprite|null} The created sprite or null
     */
    createEquipmentSprite(actor, item, slot) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset || !item.tileIndex) return null;

        const texture = this.getTileTexture(
            item.tileIndex.x * TILE_WIDTH,
            item.tileIndex.y * TILE_HEIGHT
        );
        const sprite = new PIXI.Sprite(texture);

        const useCenterAnchor = actor.facingEnabled;
        const hw = TILE_WIDTH / 2;
        const hh = TILE_HEIGHT / 2;

        let x = actor.x * TILE_WIDTH;
        let y, zIndex;

        switch (slot) {
            case 'top':
                y = (actor.y - 2) * TILE_HEIGHT;
                zIndex = 13;
                break;
            case 'middle':
                y = (actor.y - 1) * TILE_HEIGHT;
                zIndex = 12;
                break;
            case 'lower':
                y = actor.y * TILE_HEIGHT;
                zIndex = 12;
                break;
            default:
                y = actor.y * TILE_HEIGHT;
                zIndex = 12;
        }

        if (useCenterAnchor) {
            sprite.anchor.set(0.5, 0.5);
            x += hw;
            y += hh;
            const flipped = actor.isFacingFlipped();
            sprite.scale.x = flipped ? -1 : 1;
        }

        sprite.x = x;
        sprite.y = y;
        sprite.zIndex = zIndex;
        sprite.tint = item.tint;

        this.entityContainer.addChild(sprite);
        return sprite;
    },

    renderItems(entityManager) {
        console.log('Rendering items...');

        let itemsRendered = 0;

        for (const item of entityManager.items) {
            this.createItemSprite(item);
            if (item.sprite) itemsRendered++;
        }

        console.log(`Rendered ${itemsRendered} items`);
    },

    /**
     * Create a sprite for a single item (used when items are added dynamically)
     * @param {Item} item - The item to create a sprite for
     */
    createItemSprite(item) {
        if (!item.hasAttribute('visible')) return;
        if (item.sprite) return; // Already has a sprite

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset || !item.tileIndex) return;

        const texture = this.getTileTexture(
            item.tileIndex.x * TILE_WIDTH,
            item.tileIndex.y * TILE_HEIGHT
        );
        const sprite = new PIXI.Sprite(texture);

        sprite.x = item.x * TILE_WIDTH;
        sprite.y = item.y * TILE_HEIGHT;
        sprite.zIndex = this.getItemZIndex(item);
        sprite.tint = item.tint;

        // Apply horizontal/vertical flip using anchor at center
        if (item.flipH || item.flipV) {
            sprite.anchor.set(0.5, 0.5);
            sprite.x += TILE_WIDTH / 2;
            sprite.y += TILE_HEIGHT / 2;
            sprite.scale.x = item.flipH ? -1 : 1;
            sprite.scale.y = item.flipV ? -1 : 1;
        }

        if (item.effect) {
            this.effectRunner.apply(item.effect, sprite, { baseTint: item.tint });
        }

        this.entityContainer.addChild(sprite);
        item.sprite = sprite;
    },

    /**
     * Get the appropriate z-index for an item based on its position
     * Items in liquid render above actors so they appear to float
     * @param {Item} item - The item to check
     * @returns {number} The z-index for the item sprite
     */
    getItemZIndex(item) {
        const em = this.engine.entityManager;
        if (!em) return ITEM_Z;

        // Check if there's a liquid actor at this position
        const liquidActor = em.getActorsAt(item.x, item.y)
            .find(a => a.hasAttribute('liquid'));

        // Items in liquid float above actors (zIndex 11), otherwise between the floor
        // dressing and the actors standing on it.
        return liquidActor ? 11 : ITEM_Z;
    },

    /**
     * Update an item's z-index based on its current position
     * Call this when items move (e.g., drift in water, dropped)
     * @param {Item} item - The item to update
     */
    updateItemZIndex(item) {
        if (item.sprite) {
            item.sprite.zIndex = this.getItemZIndex(item);
        }
    },
};
