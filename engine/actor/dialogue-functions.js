/**
 * Engine functions an ink story can call during a conversation. Declare them in
 * the .ink with EXTERNAL, plus a same-named ink function as a fallback so the
 * story still previews in Inky:
 *
 *   EXTERNAL give(item)
 *   === function give(item) ===
 *   ~ return true
 *
 * "speaker" is the actor being talked to; "listener" is the one who opened the
 * conversation (the player). InkDialogueController binds these once per story,
 * and each call reads the current conversation's actors from getContext().
 */

import { Item } from '../item.js';

/** Display name with an article, for messages ("a bread", "Pohře"). */
function named(engine, entity, capitalize = false) {
    return engine.inputManager?.getEntityNameWithArticle(entity, { capitalize })
        || entity.getDisplayName?.() || entity.name;
}

/**
 * Take one `itemType` out of `actor`'s inventory: one off a stack, or the whole
 * item. Equipped items are skipped, so an NPC never hands over what it's wearing.
 * @returns {{ item: Item, restore: Function }|null} restore() puts it back if
 *   the hand-over fails.
 */
function takeOneFrom(actor, itemType) {
    const held = actor.inventory.find(i => i.type === itemType && !actor.isItemEquipped?.(i));
    if (!held) return null;

    if ((held.count || 1) > 1) {
        const data = actor.engine.currentPrototype?.getItemData(held.type);
        if (data) {
            held.count -= 1;
            const one = new Item(-1, -1, held.type, data, actor.engine);
            return { item: one, restore: () => { held.count += 1; } };
        }
    }

    actor.inventory = actor.inventory.filter(i => i !== held);
    actor.updateInventoryDisplay?.();
    return {
        item: held,
        restore: () => {
            actor.inventory.push(held);
            held.owner = actor;
            actor.updateInventoryDisplay?.();
        },
    };
}

/**
 * @param {() => { speaker: Actor, listener: Actor }} getContext
 * @returns {Object<string, Function>} name → function, for BindExternalFunction
 */
export function dialogueFunctions(getContext) {
    return {
        /**
         * give(item): the speaker hands one `item` (an items.json id, or a type
         * such as "potion" for a random one) to the listener. It comes from the
         * speaker's inventory if they carry one, otherwise it's made fresh, so an
         * NPC doesn't need stock to give a gift.
         * Returns true if the listener took it, false if not (pack full, or the
         * item id is unknown), so the story can branch: { give("bread"): ... }
         */
        give(itemType) {
            const { speaker, listener } = getContext();
            if (!speaker || !listener || typeof itemType !== 'string') return false;
            const engine = speaker.engine;

            let handed = takeOneFrom(speaker, itemType);
            if (!handed) {
                const data = engine.currentPrototype?.getItemData(itemType);
                if (!data) {
                    console.warn(`Dialogue give("${itemType}"): no such item`);
                    return false;
                }
                const item = new Item(-1, -1, data.id || itemType, data, engine);
                // A type ("potion") is a request for a random one, like defaultItems.
                if (data.id && data.id !== itemType) item.rollEnchantment();
                handed = { item, restore: () => {} };
            }

            if (listener.isPlayerControlled()) {
                engine.inputManager?.showMessage(
                    `${named(engine, speaker, true)} offers you ${named(engine, handed.item)}.`
                );
            }
            // pickUpItem handles stacking, the full-pack message, sound and pickup text.
            if (!listener.pickUpItem(handed.item)) {
                handed.restore();
                return false;
            }
            return true;
        },
    };
}
