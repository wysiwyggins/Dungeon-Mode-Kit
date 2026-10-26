/**
 * RenderSystem: the PIXI scene: screen effects (submersion, confusion,
 * hallucination), tile highlight and visibility culling, splash and win
 * screens. Overlays, sprite rendering and lighting are installed from the
 * sibling modules in engine/render/.
 */

import { installMethods } from '../../core/mixin.js';
import { EffectRunner } from '../../effects.js';
import { RenderLighting } from './lighting-tints.js';
import { RenderOverlays } from './overlays.js';
import { RenderSprites } from './sprites.js';
import { globalVars } from '../../globals.js';

// ============================================================================
// RENDER SYSTEM
// ============================================================================

export class RenderSystem {
    constructor(app, mapWidth, mapHeight, engine) {
        this.app = app;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.engine = engine;

        // Cache of sub-rectangle textures keyed by "px,py" within the shared tileset
        // base texture. Every sprite previously allocated a fresh PIXI.Texture per
        // creation; on levels that spawn actors at runtime (sewer gas clouds) that
        // per-spawn allocation caused a visible hitch. These textures are immutable
        // (frame never mutated in place) and sprite.destroy() never destroys them,
        // so they are safe to share across any number of sprites.
        this._tileTextureCache = new Map();

        // Create rendering containers
        this.backgroundContainer = new PIXI.Container();
        this.floorContainer = new PIXI.Container();
        this.entityContainer = new PIXI.Container();
        this.overlayContainer = new PIXI.Container();
        this.lightColorContainer = new PIXI.Container();
        this.darknessContainer = new PIXI.Container();
        this.uiContainer = new PIXI.Container();
        this.splashContainer = new PIXI.Container();
        this.winContainer = new PIXI.Container();

        this.backgroundContainer.sortableChildren = true;
        this.floorContainer.sortableChildren = true;
        this.entityContainer.sortableChildren = true;
        this.overlayContainer.sortableChildren = true;
        this.lightColorContainer.sortableChildren = true;
        this.darknessContainer.sortableChildren = true;
        this.uiContainer.sortableChildren = true;
        this.splashContainer.sortableChildren = true;
        this.winContainer.sortableChildren = true;

        // Set explicit zIndex to ensure correct layer order
        this.backgroundContainer.zIndex = 0;
        this.floorContainer.zIndex = 1;
        this.entityContainer.zIndex = 2;
        this.lightColorContainer.zIndex = 4;
        this.darknessContainer.zIndex = 5;
        // Overlay (decorative tiles above entities) renders ABOVE the darkness layer so
        // line-of-sight blocking never hard-clips it to solid black. It carries its own
        // floor-consistent darkness instead — see updateDarkness / getOverlayTint. Kept
        // below the UI (6) so windows/menus still draw over decorative tiles.
        this.overlayContainer.zIndex = 5.5;
        this.uiContainer.zIndex = 6;
        this.splashContainer.zIndex = 7;
        this.winContainer.zIndex = 8;

        app.stage.addChild(this.backgroundContainer);
        app.stage.addChild(this.floorContainer);
        app.stage.addChild(this.entityContainer);
        app.stage.addChild(this.overlayContainer);
        app.stage.addChild(this.lightColorContainer);
        app.stage.addChild(this.darknessContainer);
        app.stage.addChild(this.uiContainer);
        app.stage.addChild(this.splashContainer);
        app.stage.addChild(this.winContainer);

        this.darknessSprites = [];
        this.lightColorSprites = [];
        this.floorSprites = [];
        this.backgroundSprites = [];
        this.overlaySprites = [];

        // Splash screen state
        this.splashActive = false;
        this.splashSprites = [];
        this.splashTextSprites = [];

        // Win screen state (terminal; no dismiss)
        this.winActive = false;
        this.winSprites = [];
        this.winTextSprites = [];
        this.winEffectHandles = [];

        // Tile highlight for hover/aiming
        this.highlightFilter = true;
        this.highlightedSprites = [];
        this.highlightEnabled = true;

        // Line path highlight for throwing/aiming
        this.linePathSprites = [];

        // Infrastructure overlay: machine-id link lines (hidden until revealed)
        this.infrastructureSprites = [];
        this.infrastructureDebugForced = false;

        // Walk path highlight for click-to-walk
        this.walkPathSprites = [];

        // Submersion overlay sprite (referenced by color_overlay primitive)
        this.submersionOverlay = null;

        // Tint cycle animation (shared state for tint_cycle primitives)
        this._tintCycleSprites = [];
        this._tintCycleTickerFn = null;

        // Tint flicker animation (shared state for tint_flicker primitives)
        this._tintFlickerSprites = [];
        this._tintFlickerTickerFn = null;

        // Effect runner - data-driven visual effects system
        this.effectRunner = new EffectRunner(this);

        // Load global effects if already available
        if (engine.globalEffects) {
            this.effectRunner.loadEffects(engine.globalEffects);
        }
    }

    /**
     * Apply a color overlay to simulate submersion using multiply blend mode
     * @param {number} tint - The tint color (e.g., 0x9BC964 for green)
     */
    applySubmersionTint(tint) {
        if (this.submersionOverlay) return;
        this._submersionTint = tint;
        this._submersionHandle = this.effectRunner.apply('submersion', null, { tint });
    }

    updateSubmersionOverlay() {
        if (!this.submersionOverlay || !this.engine.viewportEnabled) return;
        const tint = this._submersionTint;
        this.effectRunner.remove(this._submersionHandle);
        this._submersionHandle = this.effectRunner.apply('submersion', null, { tint });
    }

    removeSubmersionTint() {
        if (!this.submersionOverlay) return;
        this.effectRunner.remove(this._submersionHandle);
        this._submersionHandle = null;
    }

    applyConfusionEffect() {
        if (this._confusionHandle) return;
        this._confusionHandle = this.effectRunner.apply('confusion');
    }

    removeConfusionEffect() {
        if (!this._confusionHandle) return;
        this.effectRunner.remove(this._confusionHandle);
        this._confusionHandle = null;
    }

    applyHallucinationEffect() {
        if (this._hallucinationHandle) return;
        this._hallucinationHandle = this.effectRunner.apply('hallucination');
    }

    tickHallucination() {
        if (!this._hallucinationHandle) return;
        this.effectRunner.tick(this._hallucinationHandle);
    }

    removeHallucinationEffect() {
        if (!this._hallucinationHandle) return;
        this.effectRunner.remove(this._hallucinationHandle);
        this._hallucinationHandle = null;
    }

    /**
     * Show a highlight effect on a specific tile using color inversion
     * Applies invert filter directly to the sprites at that tile position
     * @param {number} tileX - Tile X coordinate
     * @param {number} tileY - Tile Y coordinate
     */
    showTileHighlight(tileX, tileY) {
        // First, clear any existing highlight
        this.hideTileHighlight();

        // Create invert filter if it doesn't exist
        if (!this.highlightFilter) {
            this.highlightFilter = new PIXI.filters.ColorMatrixFilter();
            this.highlightFilter.negative();
        }

        // Track which sprites we're highlighting
        this.highlightedSprites = [];

        // Apply filter to background sprite at this tile
        const bgSprite = this.backgroundSprites[tileY]?.[tileX];
        if (bgSprite) {
            bgSprite.filters = bgSprite.filters ? [...bgSprite.filters, this.highlightFilter] : [this.highlightFilter];
            this.highlightedSprites.push(bgSprite);
        }

        // Apply filter to floor sprite at this tile
        const floorSprite = this.floorSprites[tileY]?.[tileX];
        if (floorSprite) {
            floorSprite.filters = floorSprite.filters ? [...floorSprite.filters, this.highlightFilter] : [this.highlightFilter];
            this.highlightedSprites.push(floorSprite);
        }

        // Apply filter to any actors at this tile
        const actor = this.engine.entityManager?.getActorAt(tileX, tileY);
        if (actor && !actor.isDead) {
            if (actor.spriteBase) {
                actor.spriteBase.filters = actor.spriteBase.filters ? [...actor.spriteBase.filters, this.highlightFilter] : [this.highlightFilter];
                this.highlightedSprites.push(actor.spriteBase);
            }
            if (actor.spriteTop) {
                actor.spriteTop.filters = actor.spriteTop.filters ? [...actor.spriteTop.filters, this.highlightFilter] : [this.highlightFilter];
                this.highlightedSprites.push(actor.spriteTop);
            }
        }

        // Apply filter to any items at this tile
        const item = this.engine.entityManager?.getItemAt(tileX, tileY);
        if (item && item.sprite) {
            item.sprite.filters = item.sprite.filters ? [...item.sprite.filters, this.highlightFilter] : [this.highlightFilter];
            this.highlightedSprites.push(item.sprite);
        }

        this.highlightEnabled = true;
    }

    /**
     * Hide the tile highlight by removing invert filter from highlighted sprites
     */
    hideTileHighlight() {
        if (this.highlightedSprites && this.highlightFilter) {
            for (const sprite of this.highlightedSprites) {
                if (sprite.filters) {
                    sprite.filters = sprite.filters.filter(f => f !== this.highlightFilter);
                    if (sprite.filters.length === 0) sprite.filters = null;
                }
            }
        }
        this.highlightedSprites = [];
        this.highlightEnabled = false;
    }

    updateTileVisibility(originX, originY, vpW, vpH) {
        const margin = 1;
        const minX = Math.max(0, originX - margin);
        const minY = Math.max(0, originY - margin);
        const maxX = Math.min(this.mapWidth, originX + vpW + margin);
        const maxY = Math.min(this.mapHeight, originY + vpH + margin);
        // Remembered so updateDarkness can hide/show tiles without undoing this cull.
        this._tileCullBox = { minX, minY, maxX, maxY };

        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                const vis = (x >= minX && x < maxX && y >= minY && y < maxY);
                if (this.backgroundSprites[y]?.[x]) this.backgroundSprites[y][x].visible = vis;
                if (this.floorSprites[y]?.[x]) this.floorSprites[y][x].visible = vis;
                if (this.overlaySprites[y]?.[x]) this.overlaySprites[y][x].visible = vis;
                if (this.darknessSprites[y]?.[x]) this.darknessSprites[y][x].visible = vis;
                if (this.lightColorSprites[y]?.[x]) this.lightColorSprites[y][x].visible = vis;
            }
        }
    }

    /**
     * Hide the sprites of an actor whose tiles fall outside the viewport.
     *
     * Each sprite is tested at its own tile, not the actor's: a top sprite one row
     * up can peek into view while the base is off-screen, and a side sprite lives
     * wherever its offset puts it. Submersion then hides everything that would sit
     * above the waterline — only the base tile reads through the surface, which is
     * why the `lower` equipment slot is exempt.
     *
     * Shared by Actor.updateSpritePositions (one actor, on move) and
     * updateEntityVisibility (every actor, on section change) so the two can't
     * disagree about what a submerged actor shows.
     *
     * @param {Actor} actor
     * @param {number} originX - Viewport origin tile X
     * @param {number} originY - Viewport origin tile Y
     * @param {number} vpW - Viewport width in tiles
     * @param {number} vpH - Viewport height in tiles
     */
    applyViewportCulling(actor, originX, originY, vpW, vpH) {
        const inBox = (x, y) => x >= originX && x < originX + vpW &&
                                y >= originY && y < originY + vpH;
        const submerged = actor.isSubmerged;
        const inView = inBox(actor.x, actor.y);

        if (actor.spriteBase) actor.spriteBase.visible = inView;

        if (actor.spriteTop) {
            actor.spriteTop.visible = (inView || inBox(actor.x, actor.y - 1)) && !submerged;
        }

        if (actor.spriteSide) {
            const { dx, dy } = actor.getEffectiveSideOffset();
            actor.spriteSide.visible = inBox(actor.x + dx, actor.y + dy) && !submerged;
        }

        if (actor.spriteEquipment) {
            // lower rides the base tile, so it stays readable underwater.
            for (const slot of ['top', 'middle']) {
                if (actor.spriteEquipment[slot]) actor.spriteEquipment[slot].visible = inView && !submerged;
            }
            if (actor.spriteEquipment.lower) actor.spriteEquipment.lower.visible = inView;
        }
    }

    updateEntityVisibility(originX, originY, vpW, vpH) {
        if (!this.engine.viewportEnabled) return;
        for (const actor of this.engine.entityManager.actors) {
            if (actor.isDead) continue;
            this.applyViewportCulling(actor, originX, originY, vpW, vpH);
            // Pause the animation of any sprite that just went invisible so PIXI stops
            // ticking it — a hidden AnimatedSprite still advances frames every tick
            // otherwise (the per-frame cost on bright scrolling levels crowded with
            // animated water/gas). Keyed off each sprite's own .visible (set above), so a
            // peeking top sprite whose base is off-screen keeps animating correctly. Runs
            // on section change, not per-frame — a once-per-scroll cost.
            for (const s of [actor.spriteBase, actor.spriteTop, actor.spriteSide]) {
                if (s && !s.visible) this.setAnimationPlaying(s, false);
            }
        }
        for (const item of this.engine.entityManager.items) {
            if (item.sprite) {
                const inView = item.x >= originX && item.x < originX + vpW &&
                               item.y >= originY && item.y < originY + vpH;
                item.sprite.visible = inView;
                if (!inView) this.setAnimationPlaying(item.sprite, false);
            }
        }
    }

    showSplash(viewportWidth, viewportHeight, originX, originY) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;

        this.splashActive = true;
        this.splashOriginX = originX;
        this.splashOriginY = originY;

        const blockCoords = this.engine.spriteLibrary.getTileByName('OPAQUE_FULL_BLOCK');
        const rect = new PIXI.Rectangle(
            blockCoords.x * globalVars.TILE_WIDTH,
            blockCoords.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        const blockTexture = new PIXI.Texture(tileset.texture.baseTexture, rect);

        this.splashSprites = Array.from({ length: viewportHeight }, () =>
            Array.from({ length: viewportWidth }, () => null)
        );

        for (let y = 0; y < viewportHeight; y++) {
            for (let x = 0; x < viewportWidth; x++) {
                const sprite = new PIXI.Sprite(blockTexture);
                sprite.anchor.set(0.5);
                sprite.x = x * globalVars.TILE_WIDTH + globalVars.TILE_WIDTH / 2;
                sprite.y = y * globalVars.TILE_HEIGHT + globalVars.TILE_HEIGHT / 2;
                sprite.scale.x = Math.random() < 0.5 ? -1 : 1;
                sprite.scale.y = Math.random() < 0.5 ? -1 : 1;
                this.splashContainer.addChild(sprite);
                this.splashSprites[y][x] = sprite;
            }
        }

        const text = "Click to Play";
        const textX = Math.floor((viewportWidth - text.length) / 2);
        const textY = Math.floor(viewportHeight / 2);
        this.splashTextSprites = [];

        for (let i = 0; i < text.length; i++) {
            const charSprite = this.engine.interfaceManager.createCharSprite(
                text[i],
                (textX + i) * globalVars.TILE_WIDTH,
                textY * globalVars.TILE_HEIGHT,
                0xFFFFFF,
                true
            );
            if (charSprite) {
                charSprite.zIndex = 1;
                this.splashContainer.addChild(charSprite);
                this.splashTextSprites.push(charSprite);
            }
        }
    }

    dismissSplash(onComplete) {
        if (!this.splashActive) { onComplete?.(); return; }

        for (const sprite of this.splashTextSprites) {
            sprite.destroy();
        }
        this.splashTextSprites = [];

        const originX = this.splashOriginX;
        const originY = this.splashOriginY;
        const vpW = this.splashSprites[0]?.length || 0;
        const vpH = this.splashSprites.length;
        const maxRadius = Math.max(vpW, vpH);

        if (this.splashSprites[originY]?.[originX]) {
            this.splashSprites[originY][originX].destroy();
            this.splashSprites[originY][originX] = null;
        }

        let radius = 1;

        const revealCircle = () => {
            let tilesCleared = false;

            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.sqrt(dx * dx + dy * dy) <= radius) {
                        const x = originX + dx;
                        const y = originY + dy;
                        if (x >= 0 && x < vpW && y >= 0 && y < vpH) {
                            if (this.splashSprites[y][x]) {
                                this.splashSprites[y][x].destroy();
                                this.splashSprites[y][x] = null;
                                tilesCleared = true;
                            }
                        }
                    }
                }
            }

            if (radius < maxRadius && tilesCleared) {
                radius = radius * 2;
                setTimeout(revealCircle, 50);
            } else {
                this.splashContainer.removeChildren();
                this.splashSprites = [];
                this.splashActive = false;
                onComplete?.();
            }
        };

        revealCircle();
    }

    /**
     * Render the terminal game-win screen: fill the visible canvas with white
     * full-block tiles running the aqua-vita (ripple_tint) color cycle, with the
     * completion text(s) centered over them in white letter tiles. Modeled on
     * showSplash() but terminal — there is no dismiss. Sized by viewportWidth/Height,
     * which cover the visible canvas in both viewport and full-map modes; the
     * winContainer is a stage child (zIndex 8) exempt from the scroll offset.
     */
    showWinScreen(viewportWidth, viewportHeight, lines) {
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;

        this.winActive = true;

        // Word-wrap each supplied line to the viewport width so a long custom
        // win_state.message doesn't spill past both edges of the view (a wider
        // message made textX go negative below and rendered as one clipped row).
        // Fall back to a hard character break for any single "word" still wider
        // than the viewport, so no laid-out line can ever exceed the width.
        const im = this.engine.interfaceManager;
        lines = lines.flatMap(line => {
            const wrapped = im ? im.wrapText(line, viewportWidth) : [line];
            return wrapped.flatMap(w => {
                if (w.length <= viewportWidth) return [w];
                const chunks = [];
                for (let c = 0; c < w.length; c += viewportWidth) {
                    chunks.push(w.slice(c, c + viewportWidth));
                }
                return chunks;
            });
        });

        const blockCoords = this.engine.spriteLibrary.getTileByName('WHITE_FULL_BLOCK');
        const rect = new PIXI.Rectangle(
            blockCoords.x * globalVars.TILE_WIDTH,
            blockCoords.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        const blockTexture = new PIXI.Texture(tileset.texture.baseTexture, rect);

        this.winSprites = [];
        this.winEffectHandles = [];
        // Center + max radius for the radial "breathing glow": distance is measured
        // from the middle of the field, normalized by the far-corner distance.
        const cx = (viewportWidth - 1) / 2;
        const cy = (viewportHeight - 1) / 2;
        const radialMax = Math.hypot(cx, cy) || 1;
        for (let y = 0; y < viewportHeight; y++) {
            for (let x = 0; x < viewportWidth; x++) {
                const sprite = new PIXI.Sprite(blockTexture);
                sprite.anchor.set(0.5);
                sprite.x = x * globalVars.TILE_WIDTH + globalVars.TILE_WIDTH / 2;
                sprite.y = y * globalVars.TILE_HEIGHT + globalVars.TILE_HEIGHT / 2;
                sprite.scale.x = Math.random() < 0.5 ? -1 : 1;
                sprite.scale.y = Math.random() < 0.5 ? -1 : 1;
                sprite.tint = 0xFFFFFF;
                this.winContainer.addChild(sprite);
                this.winSprites.push(sprite);
                // Red/gold radial gradient that breathes in and out from the center.
                // (The banded scrolling 'victory_wave' effect is still available.)
                const handle = this.effectRunner?.apply('victory_radial', sprite, {
                    radial_dist: Math.hypot(x - cx, y - cy),
                    radial_max: radialMax
                });
                if (handle) this.winEffectHandles.push(handle);
            }
        }

        // Centered, multi-line completion text as white letter tiles, above the fill.
        this.winTextSprites = [];
        const startY = Math.floor((viewportHeight - lines.length) / 2);
        for (let li = 0; li < lines.length; li++) {
            const text = lines[li];
            const textX = Math.floor((viewportWidth - text.length) / 2);
            const textY = startY + li;
            for (let i = 0; i < text.length; i++) {
                // Black glyphs (standard variant, black tint) read clearly over the
                // color-cycled white field.
                const charSprite = this.engine.interfaceManager.createCharSprite(
                    text[i],
                    (textX + i) * globalVars.TILE_WIDTH,
                    textY * globalVars.TILE_HEIGHT,
                    0x000000,
                    false
                );
                if (charSprite) {
                    charSprite.zIndex = 1;
                    this.winContainer.addChild(charSprite);
                    this.winTextSprites.push(charSprite);
                }
            }
        }
    }

    clear() {
        // Release win-screen ripple_tint handles so the shared tint-cycle list is pruned.
        for (const handle of this.winEffectHandles) {
            this.effectRunner?.remove(handle);
        }
        this.winEffectHandles = [];
        this.winContainer.removeChildren();
        this.winSprites = [];
        this.winTextSprites = [];
        this.winActive = false;

        this.backgroundContainer.removeChildren();
        this.floorContainer.removeChildren();
        this.entityContainer.removeChildren();
        this.overlayContainer.removeChildren();
        this.lightColorContainer.removeChildren();
        this.darknessContainer.removeChildren();
        this.uiContainer.removeChildren();
        this.splashContainer.removeChildren();
        this.splashActive = false;
        this.splashSprites = [];
        this.splashTextSprites = [];
        this.darknessSprites = [];
        this.lightColorSprites = [];
        this.floorSprites = [];
        this.backgroundSprites = [];
        this.overlaySprites = [];
        this.highlightFilter = null;
        this.highlightedSprites = [];
        this.highlightEnabled = false;
        this.linePathSprites = [];
        this.walkPathSprites = [];
        if (this._tintCycleTickerFn) {
            this.app.ticker.remove(this._tintCycleTickerFn);
            this._tintCycleTickerFn = null;
        }
        this._tintCycleSprites = [];
        if (this._tintFlickerTickerFn) {
            this.app.ticker.remove(this._tintFlickerTickerFn);
            this._tintFlickerTickerFn = null;
        }
        this._tintFlickerSprites = [];
        if (this._hueCycleTickerFn) {
            this.app.ticker.remove(this._hueCycleTickerFn);
            this._hueCycleTickerFn = null;
        }
        this._hueCycleSprites = [];
        if (this._gradientWaveTickerFn) {
            this.app.ticker.remove(this._gradientWaveTickerFn);
            this._gradientWaveTickerFn = null;
        }
        this._gradientWaveSprites = [];
        if (this._radialGradientTickerFn) {
            this.app.ticker.remove(this._radialGradientTickerFn);
            this._radialGradientTickerFn = null;
        }
        this._radialGradientSprites = [];

        // Clean up all active effects
        this.effectRunner.removeAll();
        this._confusionHandle = null;
        this._hallucinationHandle = null;
        this._submersionHandle = null;
    }

    /**
     * Clear only map layers (background, floor) without touching entities
     * Use this when re-rendering the map but keeping existing entity sprites
     */
    clearMapLayers() {
        this.backgroundContainer.removeChildren();
        this.floorContainer.removeChildren();
        this.overlayContainer.removeChildren();
        this.floorSprites = [];
        this.backgroundSprites = [];
        this.overlaySprites = [];
    }
}

installMethods(RenderSystem, RenderOverlays, RenderSprites, RenderLighting);
