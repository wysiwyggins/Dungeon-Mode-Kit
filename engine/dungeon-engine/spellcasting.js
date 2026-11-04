/**
 * DungeonEngine methods: casting a spell, by anyone.
 *
 * castSpell takes a caster, a spell (a spells.json entry, or an item's spell via
 * spellFromItem in core/spells.js) and a target tile, then plays the sound, flies
 * the projectile or draws the bolt, and applies the spell's effect. Area spells
 * (`burst`, `sight`, `level`) need no target tile: they apply the effect to
 * every creature getSpellAreaTargets picks, and can also lay an actor on the
 * floor (`fill`), break walls (`shatter`) or call up creatures (`summon`). Nothing here
 * assumes the caster is the player or that an item is involved: the player's
 * aiming and charges live in ui/spells.js, a monster's targeting and cooldown in
 * its behavior (behaviors/special.js cast_spell), and both end up here.
 */

import { getChebyshevDistance, getLinePath, hasLineOfSight, traceSpellPath } from '../../core/pathfinding.js';
import { isAreaSpell } from '../../core/spells.js';
import { ALL_DIRS, shuffleArray } from '../../core/util.js';

// Drawn when neither the spell nor an item names a projectile tile.
const DEFAULT_PROJECTILE_TILE = 'OPAQUE_WHITE_DIAMOND_SUITE';

// Reach of a `burst` spell with no radius, and of a monster's `sight` spell with no range.
const DEFAULT_BURST_RADIUS = 5;
const DEFAULT_SIGHT_RANGE = 10;

export const DungeonEngineSpellcasting = {
    /**
     * Cast `spell` from `caster` at `target`.
     * @param {Object} options
     * @param {Actor} options.caster
     * @param {Object} options.spell - { name, delivery, cast_sound, vfx, projectile, effect, ... }
     * @param {{x: number, y: number}} [options.target] - Aimed tile (range is the caller's job); unused by area spells
     * @param {Item} [options.item] - The item cast with, if any: damage source, messages, projectile fallback
     * @param {Function} [options.onComplete] - Called once the effect has landed
     * @returns {Object|null} The traced path ({ path, blockedAt, bounces }), or for an
     *   area spell { targets, affected }; null if there was nowhere to go
     */
    castSpell({ caster, spell, target, item = null, onComplete }) {
        if (isAreaSpell(spell)) return this.castAreaSpell({ caster, spell, item, onComplete });
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
     * Cast a `burst`, `sight` or `level` spell: apply its effect to every
     * creature in the area at once, with one summary message instead of one
     * per creature.
     * @param {Object} options - As castSpell, minus target
     * @returns {{targets: Actor[], affected: number, filled: number, shattered: number, summoned: number}}
     */
    castAreaSpell({ caster, spell, item = null, onComplete }) {
        const targets = this.getSpellAreaTargets(caster, spell);
        // No default sound: a scroll's reading ceremony has already played one.
        if (spell.cast_sound) this.playSound(spell.cast_sound);
        if (spell.vfx) this.renderer?.effectRunner.apply(spell.vfx, caster);

        const effect = spell.effect || {};
        // { "fill": "sacred_glyph" } lays an actor on the floor around the caster
        // (scroll of sanctuary). It reaches `fill_radius` steps, else the burst radius.
        const filled = effect.fill
            ? this.fillAroundCaster(effect.fill, effect.fill_radius ?? spell.radius ?? DEFAULT_BURST_RADIUS, caster)
            : 0;
        // { "shatter": true } breaks every breakable wall in the area (scroll of shattering).
        const shattered = effect.shatter ? this.shatterInArea(caster, spell) : 0;
        if (filled > 0) caster.flash?.();
        let affected = 0;
        for (const target of targets) {
            if (this.applyEffectToTarget(caster, effect, target, item, { quiet: true })) affected++;
        }
        // Summoned after the effect, so the newcomers aren't caught in it.
        const summoned = effect.summon ? this.summonAroundCaster(caster, effect, spell) : 0;

        // The player hears how it went; a monster's cast is only news if it's seen.
        if (caster.isPlayerControlled?.()) {
            const plural = affected === 1 ? 'creature is' : 'creatures are';
            const fallback = affected > 0 ? `${affected} ${plural} affected!`
                : shattered > 0 ? 'The walls crack and crumble.'
                : summoned > 0 ? 'Something answers the call.'
                : 'Something spreads across the floor.';
            this.inputManager?.showMessage(affected + filled + shattered + summoned > 0
                ? this._spellMessage(item, 'effect_message', spell.message || fallback)
                : this._spellMessage(item, 'fail_message', spell.empty_message || 'Nothing seems to happen.'));
        } else if (this.isTileVisible?.(caster.x, caster.y)) {
            this.inputManager?.showMessage(`${caster.getNameWithArticle(true)} casts ${spell.name || 'a spell'}!`,
                { x: caster.x, y: caster.y });
        }

        const result = { targets, affected, filled, shattered, summoned };
        onComplete?.(result);
        this.interfaceManager?.updateSidebar();
        return result;
    },

    /**
     * Break every breakable solid thing in an area spell's reach that isn't a
     * creature. A burst then digs out its whole square, as the old scroll of
     * shattering dug its diamond; `sight` and `level` only clear what broke.
     * New walls ring the cleared ground (revealDugArea).
     * @param {Actor} caster
     * @param {Object} spell
     * @returns {number} How many things broke
     */
    shatterInArea(caster, spell) {
        const entityManager = this.entityManager;
        if (!entityManager) return 0;
        const broken = entityManager.actors.filter(actor =>
            !actor.isDead && actor.hasAttribute('solid') && actor.hasAttribute('breakable')
            && !actor.hasAttribute('sentient') && !actor.hasAttribute('controlled')
            && this.isInSpellArea(caster, spell, actor.x, actor.y, actor));
        if (broken.length === 0) return 0;
        const cleared = broken.map(actor => ({ x: actor.x, y: actor.y }));
        for (const actor of broken) actor.die?.();
        if (spell.delivery === 'burst') {
            const radius = spell.radius ?? DEFAULT_BURST_RADIUS;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) cleared.push({ x: caster.x + dx, y: caster.y + dy });
            }
        }
        entityManager.revealDugArea(cleared);
        this.renderer?.effectRunner?.apply('shatter', caster);
        return broken.length;
    },

    /**
     * Call up creatures on open tiles around the caster.
     * `effect.summon`: true for the floor's random_actors, or an actor id or
     * list of ids. `summon_min` / `summon_max` set how many (default 2-4).
     * `summon_radius` is how many steps out they can appear (default: the
     * burst radius, else 1). `summon_allied` makes them fight for the caster
     * (getLeader in engine/actor/identity.js).
     * @param {Actor} caster
     * @param {Object} effect
     * @param {Object} spell
     * @returns {number} How many appeared
     */
    summonAroundCaster(caster, effect, spell) {
        const entityManager = this.entityManager;
        let pool;
        if (effect.summon === true) {
            const floorConfig = this.getFloorConfig(this.currentFloor);
            const randomActors = floorConfig?.random_actors || this.currentPrototype?.config?.random_actors;
            pool = Object.keys(randomActors || {});
        } else {
            pool = [].concat(effect.summon);
        }
        if (!entityManager || pool.length === 0) return 0;

        const min = effect.summon_min ?? 2;
        const max = Math.max(min, effect.summon_max ?? 4);
        const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        const radius = effect.summon_radius ?? (spell.delivery === 'burst' ? spell.radius ?? DEFAULT_BURST_RADIUS : 1);
        const open = this.floodAroundCaster(caster, radius)
            .filter(({ x, y }) => !entityManager.getSolidActorAt(x, y));
        let spawned = 0;
        for (const { x, y } of shuffleArray(open)) {
            if (spawned >= count) break;
            const actor = entityManager.spawnActor(pool[Math.floor(ROT.RNG.getUniform() * pool.length)], x, y);
            if (!actor) continue;
            if (effect.summon_allied) actor._summoner = caster;
            actor.flash?.();
            spawned++;
        }
        if (spawned > 0) caster.flash?.();
        return spawned;
    },

    /**
     * Lay `actorId` on every floor tile within `radius` steps of the caster
     * (floodAroundCaster). A non-solid actor (glyphs) also goes under
     * creatures, the caster included; a solid one only fills empty tiles.
     * Tiles that already hold a live `actorId` are skipped.
     * @param {string} actorId
     * @param {number} radius - Steps from the caster, diagonals included
     * @param {Actor} caster
     * @returns {number} How many actors were placed
     */
    fillAroundCaster(actorId, radius, caster) {
        const entityManager = this.entityManager;
        const actorData = this.currentPrototype?.getActorData(actorId);
        if (!entityManager || !actorData) return 0;
        const underCreatures = actorData.attributes?.solid === false;
        let placed = 0;
        for (const { x, y } of this.floodAroundCaster(caster, radius)) {
            if (entityManager.getSolidActorAt(x, y) && !underCreatures) continue;
            if (entityManager.getActorsAt(x, y).some(a => a.type === actorId && !a.isDead)) continue;
            if (entityManager.spawnActor(actorId, x, y)) placed++;
        }
        return placed;
    },

    /**
     * The floor tiles within `radius` steps of the caster, diagonals included,
     * flooding outward so the reach doesn't pass through walls. Solid things
     * that aren't creatures stop the flood; creatures (the caster too) don't.
     * @param {Actor} caster
     * @param {number} radius
     * @returns {Array<{x: number, y: number}>} Nearest first, the caster's tile included
     */
    floodAroundCaster(caster, radius) {
        const entityManager = this.entityManager;
        const key = (x, y) => x * 10000 + y;
        const seen = new Set([key(caster.x, caster.y)]);
        let frontier = [{ x: caster.x, y: caster.y }];
        const tiles = [];
        for (let step = 0; step <= radius && frontier.length; step++) {
            const next = [];
            for (const p of frontier) {
                if (!caster.hasFloorAt(p.x, p.y)) continue;
                const solid = entityManager.getSolidActorAt(p.x, p.y);
                if (solid && !solid.hasAttribute('sentient') && !solid.hasAttribute('controlled')) continue;
                tiles.push(p);
                for (const d of ALL_DIRS) {
                    const k = key(p.x + d.dx, p.y + d.dy);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    next.push({ x: p.x + d.dx, y: p.y + d.dy });
                }
            }
            frontier = next;
        }
        return tiles;
    },

    /**
     * The creatures an area spell reaches, never the caster. `affects` narrows
     * them to "hostile" (enmity either way round, isAtOddsWith) or "allies"
     * (everyone else); default "all". See isInSpellArea for each delivery's reach.
     * @param {Actor} caster
     * @param {Object} spell
     * @returns {Actor[]}
     */
    getSpellAreaTargets(caster, spell) {
        const entityManager = this.entityManager;
        if (!entityManager) return [];
        return entityManager.actors.filter(other => {
            if (other === caster || other.isDead) return false;
            if (!other.hasAttribute('sentient') && !other.hasAttribute('controlled')) return false;
            if (spell.affects === 'hostile' && !caster.isAtOddsWith(other)) return false;
            if (spell.affects === 'allies' && caster.isAtOddsWith(other)) return false;
            return this.isInSpellArea(caster, spell, other.x, other.y, other);
        });
    },

    /**
     * Does an area spell reach tile (x, y)?
     * `burst`: within `radius` tiles (Chebyshev, through walls, as the old radius
     * scrolls worked). `sight`: what the player can see right now (lit and in
     * view), or for anyone else a clear line within `range`. `level`: anywhere.
     * @param {Actor} caster
     * @param {Object} spell
     * @param {number} x
     * @param {number} y
     * @param {Actor} [occupant] - What's being reached there; it doesn't block its own line of sight
     */
    isInSpellArea(caster, spell, x, y, occupant = null) {
        if (spell.delivery === 'level') return true;
        if (spell.delivery === 'burst') {
            return getChebyshevDistance(caster.x, caster.y, x, y) <= (spell.radius ?? DEFAULT_BURST_RADIUS);
        }
        const playerSight = caster.isPlayerControlled?.();
        const range = spell.range ?? (playerSight ? Infinity : DEFAULT_SIGHT_RANGE);
        if (Math.hypot(x - caster.x, y - caster.y) > range) return false;
        if (playerSight) return this.isTileVisible(x, y);
        return hasLineOfSight(caster.x, caster.y, x, y, (bx, by) => {
            const blocker = this.entityManager.getSolidActorAt(bx, by);
            return blocker && blocker !== caster && blocker !== occupant;
        });
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
        if (target) this.applyEffectToTarget(caster, effect, target, item);

        if (effect.tunnel) this.tunnelAlong(caster, landingPoint, effect.tunnel, item);

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
     * Apply a spell's per-creature effects to one target: the creature a
     * projectile hit, or each creature an area spell reaches.
     * @param {Actor} caster
     * @param {Object} effect - clone_target, polymorph_target, target_effect, apply_state,
     *   remove_states, teleport_target, alert_target, beckon_target
     * @param {Actor} target
     * @param {Item|null} item
     * @param {{quiet?: boolean}} [options] - quiet: no per-creature messages (area casts summarize instead)
     * @returns {boolean} True if anything happened to the target
     */
    applyEffectToTarget(caster, effect, target, item, { quiet = false } = {}) {
        const entityManager = this.entityManager;
        const at = { x: target.x, y: target.y };
        const say = (message, pos) => { if (!quiet) this.inputManager?.showMessage(message, pos); };
        let affected = false;

        if (effect.clone_target) {
            const name = target.getNameWithArticle(true);
            const providers = { target_name: () => name };
            const cloned = target.cloneSelf();
            affected ||= !!cloned;
            say(cloned
                ? this._spellMessage(item, 'effect_message', `${name} is beside itself!`, providers)
                : this._spellMessage(item, 'fail_message', `${name} shudders, but stays single.`, providers), at);
        }

        // { "polymorph_target": true }, or an actor id/type (or list of them) to
        // draw the new form from, or { "floors": "current" } for a floor's spawn pool.
        if (effect.polymorph_target) {
            const name = target.getNameWithArticle(true);
            const pool = effect.polymorph_target === true ? undefined : effect.polymorph_target;
            const creature = target.polymorph(pool);
            affected ||= !!creature;
            const newName = creature?.getNameWithArticle(false);
            const providers = { target_name: () => name, new_form_name: () => newName };
            say(creature
                ? this._spellMessage(item, 'effect_message', `${name} turns into ${newName}!`, providers)
                : this._spellMessage(item, 'fail_message', `${name} resists the change.`, providers), at);
            // The old body is gone; nothing below should act on it.
            if (creature) return true;
        }

        // Change the target's stats: { "target_effect": { "health": 20 } }. Friend or foe alike.
        if (effect.target_effect && target.stats) {
            const before = target.stats.health?.current;
            for (const [key, value] of Object.entries(effect.target_effect)) {
                if (target.modifyStat(key, value) !== null) affected = true;
            }
            const after = target.stats.health?.current;
            if (before !== undefined && after !== before) {
                const name = this._spellName(target, true);
                say(after > before ? `${name} looks healthier.` : `${name} is hurt.`, at);
                if (after <= 0) target.die();
            }
        }

        // A state name, or { "state": "discordant", "duration": 30 }.
        if (effect.apply_state && !target.isDead) {
            if (target.applyAuthoredState(effect.apply_state, { source: caster })) {
                affected = true;
                say(`${this._spellName(target, true)} ${target.isPlayerControlled?.() ? 'are' : 'is'} affected!`, at);
            }
        }

        if (effect.remove_states) {
            const stateNames = Object.keys(target.states || {});
            for (const name of stateNames) target.removeState(name, true);
            if (stateNames.length > 0) {
                affected = true;
                const owner = target.isPlayerControlled?.() ? 'Your' : `${target.getNameWithArticle(true)}'s`;
                say(`${owner} enchantments are stripped away!`, at);
            }
        }

        if (effect.teleport_target && !target.isDead) {
            const candidates = (this.mapManager?.walkableTiles || [])
                .filter(t => !entityManager.getSolidActorAt(t.x, t.y));
            if (candidates.length > 0) {
                const dest = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
                target.x = dest.x;
                target.y = dest.y;
                target.updateSpritePosition();
                this.lightingManager?.computeLighting();
                affected = true;
                say(`${this._spellName(target, true)} ${target.isPlayerControlled?.() ? 'vanish' : 'vanishes'}!`);
            }
        }

        // Make a hostile target hunt the caster (scroll of aggravate monsters).
        // Peaceful creatures ignore it, as they did when this was a scroll effect.
        if (effect.alert_target && !target.isDead && !target.isPlayerControlled?.() && target.isHostile?.()) {
            target._alertTarget = caster;
            target._alerted = true;
            affected = true;
        }

        // Pull the target toward the caster, tile by tile.
        if (effect.beckon_target && !target.isDead) {
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
                affected = true;
                const pulled = target.isPlayerControlled?.() ? 'You are' : `${target.getNameWithArticle(true)} is`;
                say(`${pulled} pulled toward ${this._spellName(caster)}!`);
            }
        }

        return affected;
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
