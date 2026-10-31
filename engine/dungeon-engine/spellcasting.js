/**
 * DungeonEngine methods: casting a spell, by anyone.
 *
 * castSpell takes a caster, a spell (a spells.json entry, or an item's spell via
 * spellFromItem in core/spells.js) and a target tile, then plays the sound, flies
 * the projectile or draws the bolt, and applies the spell's effect. Nothing here
 * assumes the caster is the player or that an item is involved: the player's
 * aiming and charges live in ui/spells.js, a monster's targeting and cooldown in
 * its behavior (behaviors/special.js cast_spell), and both end up here.
 */

import { getChebyshevDistance, getLinePath, traceSpellPath } from '../../core/pathfinding.js';
import { ALL_DIRS } from '../../core/util.js';

// Drawn when neither the spell nor an item names a projectile tile.
const DEFAULT_PROJECTILE_TILE = 'OPAQUE_WHITE_DIAMOND_SUITE';

export const DungeonEngineSpellcasting = {
    /**
     * Cast `spell` from `caster` at `target`.
     * @param {Object} options
     * @param {Actor} options.caster
     * @param {Object} options.spell - { name, delivery, cast_sound, vfx, projectile, effect, ... }
     * @param {{x: number, y: number}} options.target - Aimed tile (range is the caller's job)
     * @param {Item} [options.item] - The item cast with, if any: damage source, messages, projectile fallback
     * @param {Function} [options.onComplete] - Called once the effect has landed
     * @returns {Object|null} The traced path ({ path, blockedAt, bounces }), or null if there was nowhere to go
     */
    castSpell({ caster, spell, target, item = null, onComplete }) {
        const bolt = spell.delivery === 'bolt';
        const trace = traceSpellPath(caster.x, caster.y, target.x, target.y,
            (x, y) => this.entityManager?.getSolidActorAt(x, y), { passThrough: bolt });
        const path = trace.path;
        if (path.length === 0) return null;

        this.playSound(spell.cast_sound || 'fire');
        const effect = spell.effect || {};
        // onComplete first: the player's item is identified there, and the
        // sidebar should show its new name.
        const finish = () => {
            onComplete?.(trace);
            this.interfaceManager?.updateSidebar();
        };

        if (bolt) {
            // A spell's `vfx` names the vfx.json entry drawn along the path.
            this.renderer?.effectRunner.apply(spell.vfx || 'lightning_bolt', caster, { path });
            for (const bounce of trace.bounces) {
                this.inputManager?.showMessage(`The bolt bounces off ${bounce.actor.getNameWithArticle()}!`,
                    { x: bounce.x, y: bounce.y });
            }
            // Delay the damage slightly so the visual leads it.
            setTimeout(() => {
                this.strikeAlongBolt(caster, spell, path, item);
                finish();
            }, path.length * 25 + 100);
        } else {
            this.animateSpellProjectile(caster, spell, path, item, () => {
                this.applySpellEffect(caster, effect, path[path.length - 1], path, item);
                finish();
            });
        }
        return trace;
    },

    /**
     * How a message names an actor: "you" for the player, else "the goblin".
     * @param {Actor} actor
     * @param {boolean} [capitalize]
     */
    _spellName(actor, capitalize = false) {
        if (actor.isPlayerControlled?.()) return capitalize ? 'You' : 'you';
        return actor.getNameWithArticle(capitalize);
    },

    /** An item's effect_message / fail_message override, or the fallback when there's no item. */
    _spellMessage(item, key, fallback, providers) {
        return item ? item.getEffectMessage(key, fallback, providers) : fallback;
    },

    /**
     * Fly a spell's projectile along a path.
     * @param {Actor} caster
     * @param {Object} spell
     * @param {Array} path - Array of {x, y} points
     * @param {Item|null} item
     * @param {Function} onComplete - Called when the projectile arrives
     */
    animateSpellProjectile(caster, spell, path, item, onComplete) {
        const renderer = this.renderer;
        const tileset = PIXI.Loader.shared.resources.tiles;
        let tile = spell.projectile?.tile || item?.tileIndex || DEFAULT_PROJECTILE_TILE;
        if (typeof tile === 'string') tile = this.spriteLibrary?.resolveTile(tile);
        if (!renderer || !tileset || !tile || path.length === 0) {
            onComplete();
            return;
        }

        const tileWidth = this.config.tileWidth;
        const tileHeight = this.config.tileHeight;
        const rect = new PIXI.Rectangle(tile.x * tileWidth, tile.y * tileHeight, tileWidth, tileHeight);
        const sprite = new PIXI.Sprite(new PIXI.Texture(tileset.texture.baseTexture, rect));
        const tint = spell.projectile?.tint || item?.tint || caster.tint || 0xFF6600;
        sprite.tint = typeof tint === 'string' ? parseInt(tint.replace('#', ''), 16) : tint;
        sprite.zIndex = 100; // Above everything
        renderer.uiContainer.addChild(sprite);

        let index = 0;
        const frameDelay = 20; // ms per tile, faster than thrown items
        const step = () => {
            if (index >= path.length) {
                renderer.uiContainer.removeChild(sprite);
                sprite.destroy();
                onComplete();
                return;
            }
            sprite.x = path[index].x * tileWidth;
            sprite.y = path[index].y * tileHeight;
            index++;
            setTimeout(step, frameDelay);
        };
        step();
    },

    /**
     * Damage every creature along a bolt's path, once each.
     * @param {Actor} caster
     * @param {Object} spell - Reads effect.bolt_damage and name
     * @param {Array} path
     * @param {Item|null} item - Damage source when present, else the caster
     */
    strikeAlongBolt(caster, spell, path, item) {
        const entityManager = this.entityManager;
        if (!entityManager) return;
        const damage = spell.effect?.bolt_damage || -10;
        const boltName = `${(spell.name || 'lightning').toLowerCase()} bolt`;
        // The player's own bolt is "the lightning bolt"; anyone else's is theirs.
        const boltPhrase = caster.isPlayerControlled?.() ? `The ${boltName}` : `${caster.getNameWithArticle(true)}'s ${boltName}`;

        // A bounced bolt can cross the same tile twice; strike each creature once.
        // The caster is only ever on the path if the bolt came back at them.
        const struck = new Set();
        for (const point of path) {
            const victim = entityManager.getSolidActorAt(point.x, point.y);
            if (!victim || struck.has(victim) || victim.isDead || !victim.stats?.health) continue;
            struck.add(victim);
            victim.modifyStat('health', damage, { source: item ?? caster });
            const pos = victim.isPlayerControlled?.() ? null : { x: victim.x, y: victim.y };
            this.inputManager?.showMessage(`${boltPhrase} strikes ${this._spellName(victim)}!`, pos);
            victim.flash?.();
            if (victim.getStat?.('health') <= 0) victim.die();
        }
    },

    /**
     * Apply a projectile spell's effect where it landed.
     * @param {Actor} caster
     * @param {Object} effect - The spell's effect: center/radius/outer, fill, tunnel, apply_state, ...
     * @param {{x: number, y: number}} landingPoint
     * @param {Array} path - The projectile's path, caster excluded
     * @param {Item|null} item
     */
    applySpellEffect(caster, effect, landingPoint, path, item) {
        const entityManager = this.entityManager;
        if (!entityManager) return;

        const { center, radius = 0, outer } = effect;
        const { x, y } = landingPoint;
        const at = { x, y };

        if (center) entityManager.spawnActor(center, x, y);
        if (radius > 0) {
            const outerType = outer || center;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    if (Math.sqrt(dx * dx + dy * dy) <= radius) entityManager.spawnActor(outerType, x + dx, y + dy);
                }
            }
        }

        // Fill the open ground where the projectile stopped with an actor:
        // { "fill": "crystal", "fill_radius": 2 } (staff of obstruction).
        if (effect.fill) this.fillOpenGround(effect.fill, effect.fill_radius ?? 1, caster, path);

        // The creature on the landing tile, for the single-target effects.
        const struck = entityManager.getSolidActorAt(x, y);
        const target = struck && struck !== caster && !struck.isDead ? struck : null;

        if (effect.clone_target && target) {
            const name = target.getNameWithArticle(true);
            const providers = { target_name: () => name };
            this.inputManager?.showMessage(target.cloneSelf()
                ? this._spellMessage(item, 'effect_message', `${name} is beside itself!`, providers)
                : this._spellMessage(item, 'fail_message', `${name} shudders, but stays single.`, providers), at);
        }

        // { "polymorph_target": true }, or an actor id/type (or list of them) to
        // draw the new form from, or { "floors": "current" } for a floor's spawn pool.
        if (effect.polymorph_target && target) {
            const name = target.getNameWithArticle(true);
            const pool = effect.polymorph_target === true ? undefined : effect.polymorph_target;
            const creature = target.polymorph(pool);
            const newName = creature?.getNameWithArticle(false);
            const providers = { target_name: () => name, new_form_name: () => newName };
            this.inputManager?.showMessage(creature
                ? this._spellMessage(item, 'effect_message', `${name} turns into ${newName}!`, providers)
                : this._spellMessage(item, 'fail_message', `${name} resists the change.`, providers), at);
        }

        if (effect.tunnel) this.tunnelAlong(caster, landingPoint, effect.tunnel, item);

        // Change the target's stats: { "target_effect": { "health": 20 } }. Friend or foe alike.
        if (effect.target_effect && target?.stats) {
            const before = target.stats.health?.current;
            for (const [key, value] of Object.entries(effect.target_effect)) target.modifyStat(key, value);
            const after = target.stats.health?.current;
            if (before !== undefined && after !== before) {
                const name = this._spellName(target, true);
                this.inputManager?.showMessage(after > before ? `${name} looks healthier.` : `${name} is hurt.`, at);
                if (after <= 0) target.die();
            }
        }

        if (effect.apply_state && target) {
            const stateData = this.globalStates?.[effect.apply_state];
            if (stateData) {
                target.applyState(effect.apply_state, stateData);
                this.inputManager?.showMessage(`${this._spellName(target, true)} ${target.isPlayerControlled?.() ? 'are' : 'is'} affected!`, at);
            }
        }

        if (effect.remove_states && target) {
            const stateNames = Object.keys(target.states || {});
            for (const name of stateNames) target.removeState(name, true);
            if (stateNames.length > 0) {
                const owner = target.isPlayerControlled?.() ? 'Your' : `${target.getNameWithArticle(true)}'s`;
                this.inputManager?.showMessage(`${owner} enchantments are stripped away!`, at);
            }
        }

        if (effect.teleport_target && target) {
            const candidates = (this.mapManager?.walkableTiles || [])
                .filter(t => !entityManager.getSolidActorAt(t.x, t.y));
            if (candidates.length > 0) {
                const dest = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
                target.x = dest.x;
                target.y = dest.y;
                target.updateSpritePosition();
                this.lightingManager?.computeLighting();
                this.inputManager?.showMessage(`${this._spellName(target, true)} ${target.isPlayerControlled?.() ? 'vanish' : 'vanishes'}!`);
            }
        }

        // Pull the target toward the caster, tile by tile.
        if (effect.beckon_target && target) {
            const dx = Math.sign(caster.x - target.x);
            const dy = Math.sign(caster.y - target.y);
            let moved = false;
            for (let i = 0; i < 20; i++) {
                const nx = target.x + dx;
                const ny = target.y + dy;
                if ((nx === caster.x && ny === caster.y) || !target.isPassableAt(nx, ny)) break;
                target.x = nx;
                target.y = ny;
                moved = true;
            }
            if (moved) {
                target.updateSpritePosition();
                this.playSound?.('push1');
                const pulled = target.isPlayerControlled?.() ? 'You are' : `${target.getNameWithArticle(true)} is`;
                this.inputManager?.showMessage(`${pulled} pulled toward ${this._spellName(caster)}!`);
            }
        }

        // Blink the caster to the landing tile, or the last open tile before it.
        if (effect.blink_self) {
            const blinkPath = getLinePath(caster.x, caster.y, landingPoint.x, landingPoint.y);
            let dest = null;
            for (let i = blinkPath.length - 1; i >= 1; i--) {
                const p = blinkPath[i];
                if (caster.hasFloorAt(p.x, p.y) && !entityManager.getSolidActorAt(p.x, p.y)) {
                    dest = p;
                    break;
                }
            }
            if (dest) {
                caster.x = dest.x;
                caster.y = dest.y;
                caster.updateSpritePosition();
                this.lightingManager?.computeLighting();
                if (caster.isPlayerControlled?.()) this.renderer?.centerViewportOnPlayer?.();
                this.renderer?.effectRunner?.apply('blink');
            } else if (caster.isPlayerControlled?.()) {
                this.inputManager?.showMessage('You cannot blink there.');
            }
        }
    },

    /**
     * Staff of tunneling (Brogue): bore `distance` tiles from the caster toward
     * `toward`, reducing every breakable obstruction on the line to rubble. The
     * bolt passes creatures (anything with health) harmlessly and stops at the
     * first solid thing that can't break, like a metal wall. Cleared cells get
     * floor and new walls round their edges, as the scroll of shattering does.
     * @param {Actor} caster
     * @param {{x: number, y: number}} toward - Where the bolt was aimed
     * @param {number} distance - Reach in tiles
     * @param {Item|null} [item] - For its `fail_message`
     */
    tunnelAlong(caster, toward, distance, item) {
        const entityManager = this.entityManager;
        const dx = toward.x - caster.x;
        const dy = toward.y - caster.y;
        const span = Math.max(Math.abs(dx), Math.abs(dy));
        if (span === 0) return;
        const scale = distance / span;
        const line = getLinePath(caster.x, caster.y,
            Math.round(caster.x + dx * scale), Math.round(caster.y + dy * scale)).slice(1);

        const cleared = [];
        for (const cell of line) {
            if (getChebyshevDistance(caster.x, caster.y, cell.x, cell.y) > distance) break;
            const blocker = entityManager.getSolidActorAt(cell.x, cell.y);
            if (!blocker || blocker.isDead || blocker.stats?.health !== undefined) continue;
            if (!blocker.hasAttribute('breakable')) break;
            blocker.die();
            cleared.push(cell);
        }

        if (cleared.length === 0) {
            this.inputManager?.showMessage(this._spellMessage(item, 'fail_message',
                'The bolt splashes harmlessly against the stone.'));
            return;
        }
        entityManager.revealDugArea(cleared);
        this.renderer?.effectRunner?.apply('shatter', caster);
    },

    /**
     * Spawn `actorId` over the open ground where a projectile stopped: a flood
     * from the last tile on the path with no solid actor, out to `radius`,
     * through floor tiles no solid actor holds. Walls and creatures stop the
     * flood rather than being filled over.
     * @param {string} actorId - Actor to spawn on each tile
     * @param {number} radius - Euclidean reach from the center
     * @param {Actor} caster - Never filled over
     * @param {Array<{x: number, y: number}>} path - The projectile's path, caster excluded
     */
    fillOpenGround(actorId, radius, caster, path) {
        const entityManager = this.entityManager;
        const floorMap = this.mapManager?.floorMap;
        const isOpen = (x, y) => {
            if (x === caster.x && y === caster.y) return false;
            const tile = floorMap?.[y]?.[x];
            return !!tile && tile.tileId > 0 && !entityManager.getSolidActorAt(x, y);
        };

        let center = null;
        for (let i = path.length - 1; i >= 0 && !center; i--) {
            if (isOpen(path[i].x, path[i].y)) center = path[i];
        }
        if (!center) return;

        const seen = new Set([`${center.x},${center.y}`]);
        const queue = [center];
        while (queue.length > 0) {
            const { x, y } = queue.shift();
            entityManager.spawnActor(actorId, x, y);
            for (const dir of ALL_DIRS) {
                const nx = x + dir.dx;
                const ny = y + dir.dy;
                const key = `${nx},${ny}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (Math.hypot(nx - center.x, ny - center.y) > radius || !isOpen(nx, ny)) continue;
                queue.push({ x: nx, y: ny });
            }
        }
    },
};
