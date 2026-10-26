/**
 * Lets one class's methods live in several files. A group module exports a
 * plain object of methods; the class's own module installs them:
 *
 *     installMethods(Actor, ActorCombat, ActorMovement);
 *
 * Copies property descriptors (so getters would survive, though groups keep
 * those in the class body anyway) and makes the methods non-enumerable, exactly
 * as if they had been written inside the class. Methods that call `super` must
 * stay in the class body, where it is bound.
 */
export function installMethods(Class, ...groups) {
    for (const group of groups) {
        const descriptors = Object.getOwnPropertyDescriptors(group);
        for (const d of Object.values(descriptors)) d.enumerable = false;
        Object.defineProperties(Class.prototype, descriptors);
    }
}
