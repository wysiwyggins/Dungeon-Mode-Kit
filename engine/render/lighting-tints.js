/**
 * RenderSystem methods: darkness, entity lighting, telepathy reveal,
 * proximity transparency, tints and sprite animation.
 */

import { getChebyshevDistance, isImportantActor } from '../../core/pathfinding.js';
import { STATE_TINT_MIX, lerpColor } from '../../core/util.js';
import { globalVars } from '../../globals.js';

export const RenderLighting = {
    initializeDarkness(width, height) {
        this.darknessContainer.removeChildren();
        this.lightColorContainer.removeChildren();
        this.darknessSprites = [];
        this.lightColorSprites = [];

        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;

        // The darkness overlay must use OPAQUE_FULL_BLOCK. The translucent FULL_BLOCK
        // has gaps that let unexplored fog-of-war cells show through underneath cast
        // shadows on dark levels, so hidden map is faintly readable.
        const blockCoords = this.engine.spriteLibrary.getTileByName('OPAQUE_FULL_BLOCK')
            || { x: 0, y: 10 };
        const rect = new PIXI.Rectangle(
            blockCoords.x * globalVars.TILE_WIDTH,
            blockCoords.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        this.darkTexture = new PIXI.Texture(tileset.texture.baseTexture, rect);
        this.solidDarkTexture = this.darkTexture;

        const whiteGraphics = new PIXI.Graphics();
        whiteGraphics.beginFill(0xFFFFFF);
        whiteGraphics.drawRect(0, 0, globalVars.TILE_WIDTH, globalVars.TILE_HEIGHT);
        whiteGraphics.endFill();
        this.lightColorTexture = this.app.renderer.generateTexture(whiteGraphics);
        whiteGraphics.destroy();

        for (let y = 0; y < height; y++) {
            this.darknessSprites[y] = [];
            this.lightColorSprites[y] = [];
            for (let x = 0; x < width; x++) {
                // Light color overlay (multiply blend)
                const lightSprite = new PIXI.Sprite(this.lightColorTexture);
                lightSprite.x = x * globalVars.TILE_WIDTH;
                lightSprite.y = y * globalVars.TILE_HEIGHT;
                lightSprite.alpha = 0;
                lightSprite.tint = 0xFFFFFF;
                lightSprite.blendMode = PIXI.BLEND_MODES.MULTIPLY;
                this.lightColorContainer.addChild(lightSprite);
                this.lightColorSprites[y][x] = lightSprite;

                // Darkness overlay
                const sprite = new PIXI.Sprite(this.solidDarkTexture);
                sprite.x = x * globalVars.TILE_WIDTH;
                sprite.y = y * globalVars.TILE_HEIGHT;
                sprite.alpha = 1.0;

                sprite.anchor.set(0.5, 0.5);
                sprite.x += globalVars.TILE_WIDTH / 2;
                sprite.y += globalVars.TILE_HEIGHT / 2;
                if (Math.random() < 0.5) sprite.scale.x = -1;
                if (Math.random() < 0.5) sprite.scale.y = -1;

                this.darknessContainer.addChild(sprite);
                this.darknessSprites[y][x] = sprite;
            }
        }
    },

    updateDarkness(lightingManager, fogOfWar = false) {
        if (!this.darknessSprites.length) return;

        const engine = this.engine;
        const margin = 2;
        const startX = engine.viewportEnabled ? Math.max(0, engine.sectionOriginX - margin) : 0;
        const startY = engine.viewportEnabled ? Math.max(0, engine.sectionOriginY - margin) : 0;
        const endX = engine.viewportEnabled
            ? Math.min(lightingManager.width, engine.sectionOriginX + engine.viewportWidth + margin)
            : lightingManager.width;
        const endY = engine.viewportEnabled
            ? Math.min(lightingManager.height, engine.sectionOriginY + engine.viewportHeight + margin)
            : lightingManager.height;

        // Sprites that draw nothing still cost Pixi a transform every frame, so they're
        // hidden rather than left at alpha 0: empty overlays, and anything below a solid
        // darkness block (floor, background, light color). The decorative overlay layer
        // draws above darkness and is left alone. The viewport cull from
        // updateTileVisibility still wins.
        const cull = engine.viewportEnabled ? this._tileCullBox : null;

        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const darkSprite = this.darknessSprites[y]?.[x];
                const lightColorSprite = this.lightColorSprites[y]?.[x];
                const inView = !cull ||
                    (x >= cull.minX && x < cull.maxX && y >= cull.minY && y < cull.maxY);

                // Update darkness overlay
                let covered = false;
                if (darkSprite) {
                    const darkness = lightingManager.getDarknessAlpha(x, y, fogOfWar);
                    darkSprite.texture = darkness.useSolidTexture ? this.solidDarkTexture : this.darkTexture;
                    darkSprite.alpha = darkness.alpha;
                    darkSprite.visible = inView && darkness.alpha > 0;
                    covered = darkness.useSolidTexture && darkness.alpha >= 1;
                }

                // Apply colored light overlay
                if (lightColorSprite) {
                    const colorOverlay = lightingManager.getLightColorOverlay(x, y);
                    lightColorSprite.tint = colorOverlay.tint;
                    lightColorSprite.alpha = colorOverlay.alpha;
                    lightColorSprite.visible = inView && colorOverlay.alpha > 0 && !covered;
                }

                const floorSprite = this.floorSprites[y]?.[x];
                if (floorSprite) floorSprite.visible = inView && !covered;

                // Decorative overlay tiles render ABOVE the darkness layer, so they carry
                // their own dimming as a sprite tint. getOverlayTint keys off explored (not
                // raw LOS), so an explored overlay tile stays visible/fog-dimmed instead of
                // being clipped to black when the player loses line of sight to it.
                const overlaySprite = this.overlaySprites[y]?.[x];
                if (overlaySprite) {
                    overlaySprite.tint = lightingManager.getOverlayTint(x, y, fogOfWar);
                }

                // Background tiles (void fill and the cliffside shading from
                // addBaseAndShadows) are floorless, so the light-color overlay layer
                // skips them entirely — see getLightColorOverlay's hasFloor gate. They
                // carry the ambient hue as a sprite tint instead, or ambient_light
                // would never reach the background layer at all.
                const backgroundSprite = this.backgroundSprites[y]?.[x];
                if (backgroundSprite) {
                    backgroundSprite.tint = lightingManager.getBackgroundTint(x, y, fogOfWar);
                    backgroundSprite.visible = inView && !covered;
                }
            }
        }

        // Update actor and item tints based on lighting
        this.updateEntityLighting(lightingManager);
    },

    /**
     * True if a tile is far enough outside the current viewport section that its
     * sprite can't be on-screen — so per-actor lighting math for it is wasted work.
     * Only meaningful when a viewport is active (multi-screen scrolling levels); on
     * single-screen levels the whole map is drawn, so nothing is ever off-screen.
     * Margin covers two-tile actors (top sprite at y-2) and the darkness overlay's own
     * 2-tile bleed margin, so an actor whose body is just off-screen but whose top/shadow
     * could reach a rendered tile is still processed.
     */
    _spriteOffscreen(x, y) {
        const engine = this.engine;
        if (!engine.viewportEnabled) return false;
        const margin = 3;
        return x < engine.sectionOriginX - margin ||
               x >= engine.sectionOriginX + engine.viewportWidth + margin ||
               y < engine.sectionOriginY - margin ||
               y >= engine.sectionOriginY + engine.viewportHeight + margin;
    },

    /**
     * Hide an entity's sprites and stop their animations — idempotent and cheap.
     * Used to cull off-screen actors from the per-frame lighting/animation work:
     * a stopped, invisible PIXI.AnimatedSprite costs the ticker nothing, which is the
     * main win on dark levels crowded with animated water/gas actors many screens away.
     */
    _hideEntitySprites(actor) {
        for (const s of [actor.spriteBase, actor.spriteTop, actor.spriteSide]) {
            if (s) { s.visible = false; this.setAnimationPlaying(s, false); }
        }
        if (actor.spriteEquipment) {
            for (const slot of ['top', 'middle', 'lower']) {
                const s = actor.spriteEquipment[slot];
                if (s) { s.visible = false; this.setAnimationPlaying(s, false); }
            }
        }
    },

    updateEntityLighting(lightingManager) {
        const fogOfWar = this.engine.currentPrototype?.config?.mechanics?.fog_of_war;

        for (const actor of this.engine.entityManager.actors) {
            // Skip dead actors - their sprites should stay hidden
            if (actor.isDead) continue;

            // Viewport cull: an actor whose sprite can't be on-screen gets its sprites
            // hidden + animations stopped (so PIXI stops ticking them) and skips all the
            // per-actor lighting math below. Never cull the controlled actor (the player
            // sprite must always render). Off-screen light still reaches visible tiles —
            // computeLighting() shadowcasts the whole map into the light map regardless.
            if (this._spriteOffscreen(actor.x, actor.y) && !actor.hasAttribute('controlled')) {
                this._hideEntitySprites(actor);
                continue;
            }

            // Static actors (walls, doors, terrain) stay visible in remembered areas
            // Mobile actors (with personality or controlled) only visible in line of sight
            const isStatic = !actor.personality && !actor.hasAttribute('controlled');
            const vis = lightingManager.getEntityVisibility(actor.x, actor.y, fogOfWar, isStatic);

            const playerTelepathic = this.engine.entityManager?.player?.hasStateProperty?.('telepathic');
            const revealedByTelepathy = playerTelepathic && actor.hasAttribute('sentient') && !actor.hasAttribute('controlled');

            // Bottom-layer actors (collapsing floors, etc.) sit in the floor plane
            // and must read exactly like the floor tile they cover, not like a
            // terrain actor. The static-actor path tints them with the raw light hue
            // (and a fixed 0x333333 dim in remembered areas), so on dark levels they
            // pop out from the surrounding floor. Instead, bake the floor's composited
            // appearance (intensity dimming + light-color hue) straight onto the
            // sprite's tint via getFloorTint, matching the floor's overlay result.
            if (actor.getAttribute('render_layer') === 'bottom') {
                if (actor.spriteBase) {
                    actor.spriteBase.visible = true;
                    actor.spriteBase.alpha = 1.0;
                    const floorTint = lightingManager.getFloorTint(actor.x, actor.y, fogOfWar);
                    actor.spriteBase.tint = this.blendTints(this.getEffectiveTint(actor), floorTint);
                    this.setAnimationPlaying(actor.spriteBase, true);
                }
                if (actor.spriteTop) actor.spriteTop.visible = false;
                if (actor.spriteSide) actor.spriteSide.visible = false;
                continue;
            }

            // Unseen actors: translucent for player, hidden for others.
            if (actor.isUnseen?.()) {
                if (actor.hasAttribute('controlled')) {
                    const alpha = 0.35;
                    if (actor.spriteBase) { actor.spriteBase.visible = vis.showBase; actor.spriteBase.alpha = alpha; }
                    if (actor.spriteTop) { actor.spriteTop.visible = vis.showTop && !actor.isSubmerged; actor.spriteTop.alpha = alpha; }
                    if (actor.spriteSide) actor.spriteSide.alpha = alpha;
                    for (const slot of ['top', 'middle', 'lower']) {
                        if (actor.spriteEquipment[slot]) actor.spriteEquipment[slot].alpha = alpha;
                    }
                } else if (revealedByTelepathy) {
                    // Telepathy senses concealed sentient creatures (e.g. a submerged
                    // eel) as a ghosted impression. The body texture sits on spriteBase
                    // while submerged; the rest stays hidden underwater.
                    if (actor.spriteBase) { actor.spriteBase.visible = true; actor.spriteBase.alpha = 0.35; }
                    if (actor.spriteTop) actor.spriteTop.visible = false;
                    if (actor.spriteSide) actor.spriteSide.visible = false;
                    for (const slot of ['top', 'middle', 'lower']) {
                        if (actor.spriteEquipment[slot]) actor.spriteEquipment[slot].visible = false;
                    }
                } else {
                    if (actor.spriteBase) { actor.spriteBase.visible = false; actor.spriteBase.alpha = 1.0; }
                    if (actor.spriteTop) actor.spriteTop.visible = false;
                    if (actor.spriteSide) actor.spriteSide.visible = false;
                    for (const slot of ['top', 'middle', 'lower']) {
                        if (actor.spriteEquipment[slot]) actor.spriteEquipment[slot].visible = false;
                    }
                }
                continue;
            }

            if (actor.spriteBase) {
                actor.spriteBase.visible = vis.showBase || revealedByTelepathy;
                // Telepathically-sensed submerged creatures read as a ghosted
                // impression; set alpha every frame so it resets when the actor
                // surfaces or telepathy ends (nothing else restores spriteBase alpha).
                actor.spriteBase.alpha = (revealedByTelepathy && actor.isSubmerged && !vis.showBase) ? 0.35 : 1.0;
            }
            if (actor.spriteTop) actor.spriteTop.visible = (vis.showTop || revealedByTelepathy) && !actor.isSubmerged;

            // Update equipment sprite visibility
            // top: uses showEquipmentTop (at y-2, above actor's head) - lit same as actor
            // middle: uses showTop (on actor's top tile)
            // lower: uses showBase (on actor's base tile)
            if (actor.spriteEquipment.top) actor.spriteEquipment.top.visible = vis.showEquipmentTop && !actor.isSubmerged;
            if (actor.spriteEquipment.middle) actor.spriteEquipment.middle.visible = vis.showTop && !actor.isSubmerged;
            if (actor.spriteEquipment.lower) actor.spriteEquipment.lower.visible = vis.showBase;

            // Side sprite uses its own position for lighting (may be in a different tile)
            if (actor.spriteSide) {
                const sideOffset = actor.getEffectiveSideOffset();
                const sideVis = lightingManager.getEntityVisibility(
                    actor.x + sideOffset.dx, actor.y + sideOffset.dy, fogOfWar, isStatic
                );
                actor.spriteSide.visible = sideVis.showBase && !actor.isSubmerged;
            }

            this.setAnimationPlaying(actor.spriteBase, vis.animateBase);
            this.setAnimationPlaying(actor.spriteTop, vis.animateTop);
            this.setAnimationPlaying(actor.spriteSide, vis.animateBase);

            if (!vis.showBase && !vis.showTop) continue;

            // Light sources keep their own tint
            if (actor.hasAttribute('light_source')) continue;

            const effectiveTint = this.getEffectiveTint(actor);
            if (actor.spriteBase) {
                actor.spriteBase.tint = this.blendTints(effectiveTint, vis.baseTint);
            }
            if (actor.spriteTop) {
                actor.spriteTop.tint = this.blendTints(effectiveTint, vis.topTint);
            }
            if (actor.spriteSide) {
                const sideOffset = actor.getEffectiveSideOffset();
                const sideVis = lightingManager.getEntityVisibility(
                    actor.x + sideOffset.dx, actor.y + sideOffset.dy, fogOfWar, isStatic
                );
                if (sideVis.showBase) {
                    actor.spriteSide.tint = this.blendTints(effectiveTint, sideVis.baseTint);
                }
            }

            // Update equipment sprite tints
            for (const slot of ['top', 'middle', 'lower']) {
                if (actor.spriteEquipment[slot]) {
                    const equippedItem = actor.getEquippedItem(slot);
                    if (equippedItem) {
                        // top uses equipmentTopTint (same as actor), middle uses topTint, lower uses baseTint
                        let tintToUse;
                        if (slot === 'top') {
                            tintToUse = vis.equipmentTopTint;
                        } else if (slot === 'lower') {
                            tintToUse = vis.baseTint;
                        } else {
                            tintToUse = vis.topTint;
                        }
                        actor.spriteEquipment[slot].tint = this.blendTints(equippedItem.tint, tintToUse);
                    }
                }
            }
        }

        this.updateProximityTransparency();

        for (const item of this.engine.entityManager.items) {
            // Viewport cull: off-screen ground items get hidden + paused, skip the rest.
            if (this._spriteOffscreen(item.x, item.y)) {
                if (item.sprite) { item.sprite.visible = false; this.setAnimationPlaying(item.sprite, false); }
                continue;
            }

            const vis = lightingManager.getEntityVisibility(item.x, item.y, fogOfWar);

            if (item.sprite) item.sprite.visible = vis.showBase;
            this.setAnimationPlaying(item.sprite, vis.animateBase);

            if (!vis.showBase) continue;

            if (item.sprite) {
                // Blind: a potion or wand within reach shows no color (see Item.getBlindName)
                const ownTint = item.getBlindName?.() ? 0xFFFFFF : item.tint;
                item.sprite.tint = this.blendTints(ownTint, vis.baseTint);
            }
        }

        // Update decorative entities (thread trails, etc.)
        for (const entity of this.engine.entityManager.entities) {
            if (!entity.sprite) continue;

            // Viewport cull: off-screen decorative entities get hidden + paused.
            // ignore_darkness entities are still culled by viewport — off-screen means
            // off-screen regardless of whether they ignore the darkness overlay.
            if (this._spriteOffscreen(entity.x, entity.y)) {
                entity.sprite.visible = false;
                this.setAnimationPlaying(entity.sprite, false);
                continue;
            }

            if (entity.hasAttribute('light_shadow') && lightingManager._lightSuppressed) {
                // Blind in the dark: no light is drawn, so neither are its shadows
                entity.sprite.visible = false;
            } else if (entity.hasAttribute('ignore_darkness')) {
                // Always visible with original tint
                entity.sprite.visible = true;
                entity.sprite.tint = entity.tint;
            } else {
                // Normal visibility based on lighting
                const vis = lightingManager.getEntityVisibility(entity.x, entity.y, fogOfWar);
                entity.sprite.visible = vis.showBase;
                if (vis.showBase) {
                    entity.sprite.tint = this.blendTints(entity.tint, vis.baseTint);
                }
            }
        }
    },

    /**
     * Reveal sentient enemies to a telepathic player on BRIGHT levels only. Dark
     * levels are handled authoritatively by LightingManager.revealTelepathicSentients
     * (which marks the tiles visible + adds a dim "sensed" glow, flowing through the
     * normal darkness/tint path); running this there too would override that dim glow
     * with full brightness. On a bright level there's no lighting manager, so this is
     * the only path that can expose an invisible creature — shown as a ghosted 0.35
     * impression. No-op unless the player is telepathic. Uses getSentientActors().
     */
    applyTelepathyReveal() {
        const player = this.engine.entityManager.getPrimaryViewpoint();
        if (!player || player.isDead) return;
        // Dark levels: the lighting pass owns telepathy reveal.
        if (this.engine.lightingManager) return;
        const telepathic = player.hasStateProperty?.('telepathic');

        for (const actor of this.engine.entityManager.getSentientActors()) {
            if (actor.hasAttribute('controlled')) continue; // don't reveal the player/allies to themselves

            if (!telepathic) {
                // Not (or no longer) telepathic: resync concealment in both
                // directions. Tested by attribute rather than by current
                // concealment, so the frame the player dives in also *restores* the
                // eel it just revealed.
                if (actor.hasStateProperty?.('invisible') ||
                    actor.hasAttribute?.('conceals_when_submerged')) {
                    actor._updateInvisibilitySprites();
                }
                continue;
            }

            const ghost = actor.hasStateProperty?.('invisible') || actor.isSubmerged;
            const alpha = ghost ? 0.35 : 1.0;

            if (actor.spriteBase) { actor.spriteBase.visible = true; actor.spriteBase.alpha = alpha; }
            // Head/top and side stay hidden while submerged (only the body reads through the surface).
            if (actor.spriteTop) { actor.spriteTop.visible = !actor.isSubmerged; actor.spriteTop.alpha = alpha; }
            if (actor.spriteSide) actor.spriteSide.visible = !actor.isSubmerged;
        }
    },

    updateProximityTransparency() {
        // Anchor proximity fades on the viewpoint actor (controlled player or a
        // `pov` observer hero) so tall-structure fading tracks whatever we see through.
        const player = this.engine.entityManager.getPrimaryViewpoint();
        if (!player || player.isDead) return;

        for (const actor of this.engine.entityManager.actors) {
            if (actor.hasStateProperty?.('invisible')) continue;
            if (actor.spriteTop) actor.spriteTop.alpha = 1.0;
            if (actor.spriteEquipment.middle) actor.spriteEquipment.middle.alpha = 1.0;
        }

        // Reset overlay (static map) tiles to opaque so a fade from a previous
        // actor position doesn't linger. overlaySprites is [] until a map renders
        // and rows are sparse, so guard each access.
        if (this.overlaySprites) {
            for (let y = 0; y < this.overlaySprites.length; y++) {
                const row = this.overlaySprites[y];
                if (!row) continue;
                for (let x = 0; x < row.length; x++) {
                    if (row[x]) row[x].alpha = 1.0;
                }
            }
        }

        for (const actor of this.engine.entityManager.actors) {
            if (actor.isDead) continue;
            if (!isImportantActor(actor)) continue;
            if (getChebyshevDistance(player.x, player.y, actor.x, actor.y) > 4) continue;

            // Fade overlay (map) tiles covering this important actor's two-tile
            // footprint so tall structures don't fully hide it. Runs before the
            // southern-actor early-continue below so it applies to every important
            // actor in range, not just those with an obscuring southern actor.
            const overlayBase = this.overlaySprites?.[actor.y]?.[actor.x];      // tile over the base
            if (overlayBase) overlayBase.alpha = 0.35;
            const overlayTop = this.overlaySprites?.[actor.y - 1]?.[actor.x];   // tile over the height sprite
            if (overlayTop) overlayTop.alpha = 0.35;

            const southernActor = this.engine.entityManager.getActorAt(actor.x, actor.y + 1);
            if (!southernActor || southernActor.isDead || southernActor === actor) continue;
            if (southernActor.hasAttribute('controlled')) continue;

            if (southernActor.spriteTop?.visible) {
                southernActor.spriteTop.alpha = 0.35;
            }
            if (southernActor.spriteEquipment.middle?.visible) {
                southernActor.spriteEquipment.middle.alpha = 0.35;
            }
        }

        // Reveal enemies to a telepathic player (covers bright levels where the
        // lighting-based reveal in updateEntityLighting doesn't run). Runs last so
        // it overrides the invisible-actor hide above.
        this.applyTelepathyReveal();

        // Show/hide the machine-id infrastructure overlay. This runs on both the
        // dark path (updateDarkness calls updateProximityTransparency) and the
        // bright path (updateLighting calls it directly), so it's the single funnel.
        this.updateInfrastructureVisibility();

        // Detect-magic eyes over unseen detected items (after sprite visibility is set)
        this.updateMagicDetectionMarkers();
    },

    /**
     * Update a sprite's texture to a new tile index
     * @param {PIXI.Sprite} sprite - The sprite to update
     * @param {Object} tileIndex - The tile index {x, y}
     */
    updateSpriteTexture(sprite, tileIndex) {
        if (!sprite || !tileIndex) return;
        const tileset = PIXI.Loader.shared.resources.tiles;
        if (!tileset) return;
        const rect = new PIXI.Rectangle(
            tileIndex.x * globalVars.TILE_WIDTH,
            tileIndex.y * globalVars.TILE_HEIGHT,
            globalVars.TILE_WIDTH,
            globalVars.TILE_HEIGHT
        );
        sprite.texture = new PIXI.Texture(tileset.texture.baseTexture, rect);
    },

    blendTints(baseTint, lightTint) {
        const br = (baseTint >> 16) & 0xFF;
        const bg = (baseTint >> 8) & 0xFF;
        const bb = baseTint & 0xFF;

        const lr = (lightTint >> 16) & 0xFF;
        const lg = (lightTint >> 8) & 0xFF;
        const lb = lightTint & 0xFF;

        const r = Math.floor((br * lr) / 255);
        const g = Math.floor((bg * lg) / 255);
        const b = Math.floor((bb * lb) / 255);

        return (r << 16) | (g << 8) | b;
    },

    /**
     * The actor's own tint with any state tint mixed in.
     *
     * Mixed by interpolation, not by blendTints. Multiply is right for *light* — a lamp
     * can only ever subtract from a surface — but a state tint is a signal, and multiply
     * silences it exactly where the actor is most saturated. Pac is yellow (#ffff00) and
     * the impervious state is icy blue (#66ccff); multiplied, the blue channel lands on
     * pac's zero blue and the "you are powered up" read comes out #66cc00, a slightly
     * dingier yellow. Interpolating gets a visible shift on any base color.
     *
     * STATE_TINT_MIX short of 1.0 so the actor still looks like itself: a burning
     * goblin should read as a goblin on fire, not as a generic orange blob.
     */
    getEffectiveTint(actor) {
        const stateTint = actor.getStateTint();
        if (stateTint === null || stateTint === undefined) return actor.tint;

        // A null/undefined own-tint means "untinted", which is white, not black.
        const base = (actor.tint === null || actor.tint === undefined) ? 0xFFFFFF : actor.tint;
        return lerpColor(base, stateTint, STATE_TINT_MIX);
    },

    /**
     * Repaint actor sprites from their own tint plus any state tint.
     *
     * The bright-level counterpart to the tinting inside updateEntityLighting. That
     * runs only when a lightingManager exists, so on a `darkness: false` prototype
     * nothing ever wrote a state tint to a sprite — the sidebar showed the state in its
     * color while the actor on the map stayed unchanged.
     *
     * Deliberately narrow: tint only. Visibility, fog and alpha are either the lighting
     * pass's business or updateProximityTransparency's, and a bright level has no fog to
     * apply. Skips light sources for the same reason updateEntityLighting does — they
     * carry their own color.
     */
    updateEntityStateTints() {
        for (const actor of this.engine.entityManager.actors) {
            if (actor.isDead) continue;
            if (actor.hasAttribute('light_source')) continue;

            const tint = this.getEffectiveTint(actor) ?? 0xFFFFFF;
            if (actor.spriteBase) actor.spriteBase.tint = tint;
            if (actor.spriteTop) actor.spriteTop.tint = tint;
            if (actor.spriteSide) actor.spriteSide.tint = tint;
        }
    },

    setAnimationPlaying(sprite, shouldPlay) {
        if (!sprite) return;
        if (!(sprite instanceof PIXI.AnimatedSprite)) return;

        if (shouldPlay && !sprite.playing) {
            sprite.play();
        } else if (!shouldPlay && sprite.playing) {
            sprite.stop();
        }
    },
};
