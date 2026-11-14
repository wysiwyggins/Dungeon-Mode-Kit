/**
 * Engine functions an ink story can call during a conversation, and the
 * templates its text can use. Declare each function in the .ink with EXTERNAL,
 * plus a same-named ink function as a fallback so the story still previews in
 * Inky:
 *
 *   EXTERNAL give(slot)
 *   === function give(slot) ===
 *   ~ return true
 *
 * "speaker" is the actor being talked to; "listener" is the one who opened the
 * conversation (the player). InkDialogueController binds these once per story,
 * and each call reads the current conversation's actors from getContext().
 *
 * Dialogue talks about items through slots and wants, so it never has to name
 * an item and keeps working when the actor's data changes:
 *
 * - A slot is a position in the speaker's `default_items` (1 = first). It's
 *   fixed: giving away slot 1 leaves slot 1 empty and slot 2 where it was. Items
 *   the speaker gets later (from a trade) have no slot.
 * - `wants` (an actor attribute, else its personality's) is the item id or type
 *   the speaker trades for, e.g. "torch_unlit" or "food".
 *
 * Equipped items are never counted or handed over, so nobody gives away what
 * they're wearing.
 */

import { resolveQuarry } from '../../core/pathfinding.js';
import { resolveTemplate } from '../../core/util.js';
import { Item } from '../item.js';

/** Display name with an article, for messages ("a bread", "Pohře"). */
function named(engine, entity, capitalize = false) {
    return engine.inputManager?.getEntityNameWithArticle(entity, { capitalize })
        || entity.getDisplayName?.() || entity.name;
}

/** An item's name as the player knows it (unidentified items stay unidentified). */
function itemName(item) {
    return item.getDisplayName?.() ?? item.name;
}

/** What `actor` trades for: its `wants` attribute, else its personality's. */
function wantsOf(actor) {
    return actor?.getAttribute?.('wants') || actor?.personality?.data?.wants || null;
}

/** The actor's item in a slot, if it's still there (and not equipped). */
function slotItem(actor, slot) {
    const n = Number(slot);
    return actor.inventory.find(i => i.inventorySlot === n && !actor.isItemEquipped?.(i)) || null;
}

/** `actor`'s unequipped items matching an item id or type. */
function heldMatching(actor, itemType) {
    if (!itemType) return [];
    const ids = resolveQuarry(actor.engine, itemType).itemIds;
    return actor.inventory.filter(i => ids.has(i.type) && !actor.isItemEquipped?.(i));
}

/** Count of a list of items, stacks included. */
function countOf(items) {
    return items.reduce((n, i) => n + (i.count || 1), 0);
}

/**
 * Take one of `held` (an item in `actor`'s inventory) out: one off a stack, or
 * the whole item.
 * @returns {{ item: Item, restore: Function }} restore() puts it back if the
 *   hand-over fails.
 */
function takeOne(actor, held) {
    if ((held.count || 1) > 1) {
        const data = actor.engine.currentPrototype?.getItemData(held.type);
        if (data) {
            held.count -= 1;
            const one = new Item(-1, -1, held.type, data, actor.engine);
            return { item: one, restore: () => { held.count += 1; } };
        }
    }
    actor.inventory = actor.inventory.filter(i => i !== held);
    // The slot belongs to the giver's default_items; it means nothing to the new owner.
    const slot = held.inventorySlot;
    delete held.inventorySlot;
    actor.updateInventoryDisplay?.();
    return {
        item: held,
        restore: () => {
            if (slot != null) held.inventorySlot = slot;
            actor.inventory.push(held);
            held.owner = actor;
            actor.updateInventoryDisplay?.();
        },
    };
}

/**
 * Put `item` into an NPC's inventory, merging into a matching stack. Skips
 * pickUpItem on purpose: an item handed over in conversation isn't announced as
 * a pickup, and the NPC keeps it whatever its `inventory` capacity, so a trade
 * never destroys what the player gave (it drops when the NPC dies).
 * @returns {Function} Undo: takes the item back out again
 */
function receiveInto(actor, item) {
    const stack = item.getAttribute('stackable') && actor.inventory.find(i => i.canStackWith?.(item));
    if (stack) {
        stack.count = (stack.count || 1) + (item.count || 1);
    } else {
        actor.inventory.push(item);
        item.owner = actor;
    }
    actor.updateInventoryDisplay?.();
    return () => {
        if (stack) stack.count -= (item.count || 1);
        else actor.inventory = actor.inventory.filter(i => i !== item);
        actor.updateInventoryDisplay?.();
    };
}

/** The speaker's item for give(): a slot number, or an item id/type string. */
function speakerItemFor(speaker, which) {
    if (typeof which === 'number') return slotItem(speaker, which);
    if (typeof which === 'string') return heldMatching(speaker, which)[0] || null;
    return null;
}

/** Speaker → listener, one of `held`. Returns true if the listener took it. */
function handOver(context, held) {
    const { speaker, listener } = context;
    const engine = speaker.engine;
    const handed = takeOne(speaker, held);
    if (listener.isPlayerControlled()) {
        engine.inputManager?.showMessage(`${named(engine, speaker, true)} offers you ${named(engine, handed.item)}.`);
    }
    // pickUpItem handles stacking, the full-pack message, sound and pickup text.
    if (!listener.pickUpItem(handed.item)) {
        handed.restore();
        return false;
    }
    context.given = handed.item;
    return true;
}

/**
 * Listener → speaker, one of `held`. Returns an undo function. No messages or
 * side effects yet: announceReceived does those once the exchange stands, so a
 * trade that's undone leaves no trace in the log.
 */
function receiveFrom(context, held) {
    const { speaker, listener } = context;
    const handed = takeOne(listener, held);
    const undoReceive = receiveInto(speaker, handed.item);
    context.taken = handed.item;
    return () => {
        undoReceive();
        handed.restore();
        context.taken = null;
    };
}

/** Tell the player what they handed over, and update what depends on it. */
function announceReceived(context) {
    const { speaker, listener, taken } = context;
    if (!taken || !listener.isPlayerControlled()) return;
    const engine = speaker.engine;
    engine.inputManager?.showMessage(`You give ${named(engine, taken)} to ${named(engine, speaker)}.`);
    engine.playSound?.(taken.getAttribute('pickup_sound') || 'tone3');
    // Losing an item can re-lock a `holding:` condition lock.
    engine.refreshConditionLocks?.();
    engine.interfaceManager?.updateSidebar?.();
}

/**
 * @param {() => { speaker: Actor, listener: Actor, given?: Item, taken?: Item }} getContext
 *   The conversation's actors. Items moved are recorded on it as `given` /
 *   `taken`, for the [given] and [taken] templates.
 * @returns {Object<string, Function|{fn: Function, lookaheadSafe: boolean}>}
 *   name → function, for InkDialogueController
 */
export function dialogueFunctions(getContext) {
    const ready = () => {
        const context = getContext();
        return context?.speaker && context?.listener ? context : null;
    };
    return {
        /**
         * give(slot): the speaker hands one item from that slot to the listener.
         * A string gives the first item of that id or type instead. Returns false
         * if there's nothing there or the listener can't take it (pack full).
         */
        give(which) {
            const context = ready();
            const held = context && speakerItemFor(context.speaker, which);
            return !!(held && handOver(context, held));
        },

        /**
         * trade(slot): one of what the speaker `wants` from the listener, for one
         * item from the slot. All or nothing: if either half can't happen (empty
         * slot, nothing wanted to give, no room for what comes back), no items
         * move and it returns false.
         */
        trade(slot) {
            const context = ready();
            if (!context) return false;
            const offered = slotItem(context.speaker, slot);
            const wanted = heldMatching(context.listener, wantsOf(context.speaker))[0];
            if (!offered || !wanted) return false;
            const undoPayment = receiveFrom(context, wanted);
            if (!handOver(context, offered)) {
                undoPayment();
                return false;
            }
            announceReceived(context);
            return true;
        },

        /**
         * take(): the listener hands one of what the speaker `wants` to the
         * speaker (a gift or a quest item). take("id") takes that item id or type
         * instead. Returns false if the listener has none to spare.
         */
        take(itemType) {
            const context = ready();
            if (!context) return false;
            const held = heldMatching(context.listener, itemType || wantsOf(context.speaker))[0];
            if (!held) return false;
            receiveFrom(context, held);
            announceReceived(context);
            return true;
        },

        /** speaker_slot(slot): how many items are left in that slot (0 = empty). */
        speaker_slot: {
            lookaheadSafe: true,
            fn(slot) {
                const context = ready();
                const item = context && slotItem(context.speaker, slot);
                return item ? (item.count || 1) : 0;
            },
        },

        /** has_wanted(): how many of what the speaker `wants` the listener has. */
        has_wanted: {
            lookaheadSafe: true,
            fn() {
                const context = ready();
                return context ? countOf(heldMatching(context.listener, wantsOf(context.speaker))) : 0;
            },
        },

        /** can_trade(slot): the slot has an item and the listener has something wanted. */
        can_trade: {
            lookaheadSafe: true,
            fn(slot) {
                const context = ready();
                return !!(context && slotItem(context.speaker, slot)
                    && heldMatching(context.listener, wantsOf(context.speaker)).length);
            },
        },
    };
}

// [speaker_slot:2]
const SLOT_TOKEN_RE = /\[speaker_slot:(\d+)\]/g;

/**
 * Template resolution for dialogue text and choice labels: the engine's
 * [token] templates (resolveTemplate, with the speaker as subject, so [a-an]
 * and the speaker's own attributes work), plus:
 *
 *   [speaker_slot:2]   the item in the speaker's slot 2
 *   [wanted]           what the speaker wants: the listener's matching item if
 *                      they have one, else the item or type name
 *   [given] / [taken]  the last item moved to / from the listener this conversation
 *   [speaker_name] / [player_name]
 *
 * Item names are as the player knows them, so an unidentified potion reads as
 * its color. An empty slot falls back to the name of what default_items put
 * there. Text is resolved when it's shown, after that step's give/trade calls
 * have run, which is why [given] exists: by then the item has left the slot.
 * In an ink choice the brackets must be escaped: + [Ask for \[speaker_slot:1\]]
 *
 * @param {() => object} getContext - As for dialogueFunctions
 * @returns {(text: string) => string}
 */
export function dialogueTemplate(getContext) {
    return (text) => {
        if (typeof text !== 'string' || !text.includes('[')) return text;
        const { speaker, listener, given, taken } = getContext() || {};
        if (!speaker) return text;
        const library = speaker.engine.currentPrototype?.items || {};
        const libraryName = (id) => library[id]?.name || String(id).replace(/_/g, ' ');

        const providers = {
            speaker_name: () => speaker.getDisplayName?.() ?? speaker.name,
            player_name: () => listener ? (listener.getDisplayName?.() ?? listener.name) : null,
            given: () => given ? itemName(given) : null,
            taken: () => taken ? itemName(taken) : null,
            wanted: () => {
                const wants = wantsOf(speaker);
                if (!wants) return null;
                const held = listener && heldMatching(listener, wants)[0];
                return held ? itemName(held) : libraryName(wants);
            },
        };
        for (const [token, slot] of text.matchAll(SLOT_TOKEN_RE)) {
            providers[token.slice(1, -1)] = () => {
                const item = slotItem(speaker, slot);
                if (item) return itemName(item);
                const original = speaker.defaultItems?.[Number(slot) - 1];
                return original ? libraryName(original) : null;
            };
        }
        return resolveTemplate(text, speaker, { providers });
    };
}
