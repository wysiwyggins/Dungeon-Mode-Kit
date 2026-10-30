/**
 * Behaviors: the Personality class (an actor's behavior list, run in order each
 * turn) and BehaviorLibrary, the registry it draws from. The behaviors
 * themselves live in the sibling modules in behaviors/; this file also keeps the
 * shared trap payload and patrol/gas helpers.
 */

import { BehaviorsAI } from './ai.js';
import { BehaviorsEnvironment } from './environment.js';
import { BehaviorsRanged } from './ranged.js';
import { BehaviorsSpecial } from './special.js';

// ============================================================================
// PERSONALITY SYSTEM
// ============================================================================

/**
 * Spring a trap's payload: message, sound, and the spawned effect.
 *
 * Two callers: a vent fired by its linked pressure plate (Actor.activate, no
 * victim — the gas finds whoever is near), and a trapped container whose lid
 * comes up (Actor.open, where the opener is the victim). That's why `victim` is
 * optional and `entityManager` is derived rather than passed.
 *
 * Reads the authored keys `trap_message`, `trap_effect`, `trap_spawn`,
 * `trap_spawn_tint`, `trap_collision_effect`, `trap_apply_state`, `trap_sound`
 * and `trap_cloud_lifetime` off the actor's data.
 *
 * @param {Actor} actor - the vent, or the container that was trapped
 * @param {Actor|null} victim - who sprang it; receives `trap_apply_state` if present
 * @param {Object} opts - overrides for `trap_sound` / `trap_cloud_lifetime`
 */
export function springTrapPayload(actor, victim = null, opts = {}) {
    const entityManager = actor.engine.entityManager;

    // Show trap message
    const trapMessage = actor.data?.trap_message || `A trap is sprung!`;
    actor.engine.inputManager?.showMessage(trapMessage, { x: actor.x, y: actor.y });

    // Play trap sound
    actor.engine.playSound?.(opts.trap_sound ?? actor.data?.trap_sound ?? 'tap2');

    // Spawn the trap effect - supports two formats:
    // 1. trap_effect: { center, radius, outer } - spell-like area effect (like fireball)
    // 2. trap_spawn: "actor_type" - simple single actor spawn
    const trapEffect = actor.data?.trap_effect;
    if (trapEffect) {
        // Spell-like area effect
        const { center, radius = 0, outer } = trapEffect;
        const x = actor.x;
        const y = actor.y;

        // Spawn center actor
        if (center) {
            entityManager.spawnActor(center, x, y);
        }

        // Spawn actors in radius
        if (radius > 0) {
            const outerType = outer || center;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (dx === 0 && dy === 0) continue; // Skip center
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= radius) {
                        entityManager.spawnActor(outerType, x + dx, y + dy);
                    }
                }
            }
        }
    } else {
        // Simple single actor spawn
        const spawnType = actor.data?.trap_spawn;
        if (spawnType) {
            const spawnedActor = entityManager.spawnActor(spawnType, actor.x, actor.y);
            if (spawnedActor) {
                // Apply custom tint if specified
                const trapTint = actor.data?.trap_spawn_tint;
                if (trapTint) {
                    spawnedActor.tint = trapTint;
                    if (spawnedActor.spriteBase) spawnedActor.spriteBase.tint = PIXI.utils.string2hex(trapTint);
                    if (spawnedActor.spriteTop) spawnedActor.spriteTop.tint = PIXI.utils.string2hex(trapTint);
                }

                // Apply custom collision effect if specified (for clouds)
                const trapCollisionEffect = actor.data?.trap_collision_effect;
                if (trapCollisionEffect) {
                    spawnedActor.setAttribute('collision_effect', trapCollisionEffect);
                }

                // Apply state to apply if specified (for paralysis/confusion gas)
                const trapApplyState = actor.data?.trap_apply_state;
                if (trapApplyState) {
                    spawnedActor.setAttribute('apply_state', trapApplyState);

                    // Apply state immediately to the victim standing on the trap
                    const statesData = actor.engine.globalStates;
                    if (statesData?.[trapApplyState] && victim?.applyState) {
                        victim.applyState(trapApplyState, statesData[trapApplyState]);
                    }
                }

                if (actor.data?.trap_spawn_flammable) spawnedActor.setAttribute('flammable', true);

                // Mark as origin cloud so it spreads
                spawnedActor.isCloudOrigin = true;
                spawnedActor.cloudOriginX = actor.x;
                spawnedActor.cloudOriginY = actor.y;
                spawnedActor.cloudLifetime = opts.trap_cloud_lifetime ?? actor.data?.trap_cloud_lifetime ?? 8;
            }
        }
    }
}

export class Personality {
    constructor(data, actor) {
        this.name = data.name || 'default';
        this.controlled = data.controlled || false;
        this.hostile = data.hostile || false;
        // Faction tag (e.g. "goblin"). Actors sharing a faction are allies; an
        // actor with a faction treats everyone else — including the player, who
        // has none — as an enemy. null = no faction = legacy "attack only the
        // player" behavior. See Actor.isEnemyOf in engine/actor/identity.js.
        this.faction = data.faction || null;
        this.behaviors = data.behaviors || [];
        this.data = data;
        this.actor = actor;
    }

    execute(actor) {
        // Confusion overrides normal AI — move randomly instead
        if (actor.isConfused()) {
            BehaviorLibrary.random_walk(actor);
            return;
        }

        // Discord overrides targeting — go after the nearest creature, ally or
        // not. Falls through to the normal chain when nobody is in sight.
        if (actor.isDiscordant() && BehaviorLibrary.discord_attack(actor)) return;

        // Execute behaviors in order
        for (const behaviorName of this.behaviors) {
            const behavior = BehaviorLibrary[behaviorName];
            if (behavior && behavior(actor, this.data)) {
                break; // Behavior succeeded, stop processing
            }
        }
    }
}

// Behavior Library - Common AI routines, merged from the group modules
export const BehaviorLibrary = {
    ...BehaviorsAI,
    ...BehaviorsEnvironment,
    ...BehaviorsRanged,
    ...BehaviorsSpecial,

    // Backward-compat aliases
    scutigera_head_ai: (...args) => BehaviorLibrary.chain_head_ai(...args),
    scutigera_body_follow: (...args) => BehaviorLibrary.chain_body_follow(...args),
    scutigera_scatter: (...args) => BehaviorLibrary.chain_scatter(...args),
    game_of_life_step: (...args) => BehaviorLibrary.cellular_automaton_step(...args),
    emit_sewer_gas: (...args) => BehaviorLibrary.emit_cloud(...args),
    deep_water_currents: (...args) => {
        BehaviorLibrary.strip_inventory(...args);
        return BehaviorLibrary.drift_ground_items(...args);
    },
    clock_tick: (actor, data) => {
        BehaviorLibrary.countdown(actor, data);
        BehaviorLibrary.countdown_display(actor, { ...data, countdown_display: 'digit' });
        return true;
    }
};
