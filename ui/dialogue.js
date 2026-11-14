/**
 * InterfaceManager methods: the dialogue window. A modal box showing one node
 * of a conversation (speaker, text, lettered choices), driven by a
 * conversation controller: DialogueController (node trees) or
 * InkDialogueController (compiled ink). Only currentLine() / choose() /
 * isFinished() are used, so the window doesn't care which format it shows.
 *
 * Dual display: the canvas box carries a size-capped copy of each node's text;
 * the full untruncated text always goes to the sidebar via showMessage.
 */

import { DialogueController } from '../core/dialogue.js';
import { TILE_HEIGHT, TILE_WIDTH } from '../core/util.js';
import { MODIFIER_KEYS } from './interface-manager.js';

const DIALOGUE_BOX_ID = 'dialogue';
const DIALOGUE_TEXT_WIDTH = 28;      // characters per wrapped line
const DIALOGUE_MAX_TEXT_LINES = 6;   // canvas cap; the sidebar carries the rest
const CHOICE_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const UNTINTED = 0xFFFFFF;           // an actor's tint when it has none

/** True if white text reads better than black on this color (perceived luminance). */
function isDarkColor(color) {
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
}

export const UIDialogue = {
    /**
     * Open a conversation.
     * @param {object} source - A controller (anything with currentLine/choose/isFinished,
     *   e.g. from Actor.getDialogueController), or a node tree
     *   { start, nodes: { id: { text, choices: [{label, goto}] } } }
     * @param {object} [options]
     * @param {string} [options.speaker] - Name shown above the text and in the sidebar
     * @param {number} [options.speakerTint] - The speaker's tint, used behind the name row.
     *   Untinted (white) speakers get the border color instead.
     */
    showDialogue(source, options = {}) {
        if (!source) return;
        this.closeDialogue();
        this.closeConfirmDialog?.();
        this.clearTargetingHighlights?.();

        this.dialogue = {
            controller: typeof source.currentLine === 'function' ? source : new DialogueController(source),
            speaker: options.speaker || null,
            speakerTint: options.speakerTint ?? null,
        };
        this._renderDialogue();
    },

    /** Draw the controller's current node, or close if the conversation is over. */
    _renderDialogue() {
        this.removeBox(DIALOGUE_BOX_ID);
        const dialogue = this.dialogue;
        if (!dialogue) return;

        const line = dialogue.controller.isFinished() ? null : dialogue.controller.currentLine();
        if (!line) {
            this.closeDialogue();
            return;
        }

        const { speaker } = dialogue;

        // Sidebar: always the full text.
        if (line.text) {
            this.engine.inputManager?.showMessage(speaker ? `${speaker}: ${line.text}` : line.text);
        }

        const width = Math.max(16, Math.min(DIALOGUE_TEXT_WIDTH, this.getVisibleArea().width - 6));
        const lines = [];
        if (speaker) {
            lines.push(this.truncateText(speaker, width));
            lines.push('');
        }

        // Canvas text, capped at DIALOGUE_MAX_TEXT_LINES; the last kept line is
        // marked with '~' (truncateText's marker) so it's clear there's more in
        // the sidebar.
        const wrapped = line.text ? this.wrapText(line.text, width) : [];
        if (wrapped.length > DIALOGUE_MAX_TEXT_LINES) {
            const kept = wrapped.slice(0, DIALOGUE_MAX_TEXT_LINES);
            const last = kept[kept.length - 1];
            kept[kept.length - 1] = (last.length >= width ? last.slice(0, width - 1) : last) + '~';
            lines.push(...kept);
        } else {
            lines.push(...wrapped);
        }
        if (wrapped.length) lines.push('');

        const choiceLines = [];
        line.choices.slice(0, CHOICE_LETTERS.length).forEach((label, i) => {
            choiceLines.push(lines.length);
            lines.push(this.truncateText(`${CHOICE_LETTERS[i]}) ${label}`, width));
        });

        const padding = 1;
        const contentWidth = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const boxWidth = contentWidth + padding * 2 + 2;
        const boxHeight = lines.length + padding * 2 + 2;
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const box = this.createBox(DIALOGUE_BOX_ID, x, y, boxWidth, boxHeight, {
            fillColor: this.defaultFillColor,
            borderTint: this.defaultBorderTint,
        });
        if (!box) return;

        box._padding = padding;
        box._dialogueChoiceLines = choiceLines;

        const textStartX = (padding + 1) * TILE_WIDTH;
        const textStartY = (padding + 1) * TILE_HEIGHT;

        // Speaker name row: a band in the speaker's tint across the box interior,
        // with white letters when the tint is dark.
        let nameTint = this.defaultTextTint;
        if (speaker) {
            const tint = dialogue.speakerTint;
            const bandColor = (typeof tint === 'number' && tint !== UNTINTED) ? tint : this.defaultBorderTint;
            const band = new PIXI.Graphics();
            band.beginFill(bandColor);
            band.drawRect(TILE_WIDTH, textStartY, (boxWidth - 2) * TILE_WIDTH, TILE_HEIGHT);
            band.endFill();
            box.addChild(band);
            if (isDarkColor(bandColor)) nameTint = 0xFFFFFF;
        }

        for (let i = 0; i < lines.length; i++) {
            const isName = speaker && i === 0;
            const tint = isName ? nameTint : this.defaultTextTint;
            this.renderTextLine(box, lines[i], textStartX, textStartY + i * TILE_HEIGHT, tint, isName && tint !== this.defaultTextTint);
        }

        this.updateBoxOverlays();
    },

    /** Pick a choice by index; advances to the next node or ends the conversation. */
    chooseDialogueOption(index) {
        const dialogue = this.dialogue;
        if (!dialogue) return;
        const line = dialogue.controller.currentLine();
        if (!line || index < 0 || index >= line.choices.length) return;

        dialogue.controller.choose(index);
        if (dialogue.controller.isFinished()) {
            this.closeDialogue();
        } else {
            this._renderDialogue();
        }
    },

    closeDialogue() {
        if (!this.dialogue && !this.boxes?.has(DIALOGUE_BOX_ID)) return;
        this.removeBox(DIALOGUE_BOX_ID);
        this.dialogue = null;
        this.updateBoxOverlays();
    },

    hasDialogue() {
        return !!this.dialogue;
    },

    /**
     * Keyboard for an open dialogue. Letters/digits pick a choice, Enter/Space
     * picks the only choice, Escape leaves. Every other key is swallowed so the
     * game can't act while the window is open.
     * @param {string} key
     * @returns {boolean} True if the key was handled
     */
    handleDialogueKey(key) {
        if (!this.dialogue) return false;
        if (MODIFIER_KEYS.has(key)) return true;

        if (key === 'Escape') {
            this.closeDialogue();
            return true;
        }

        const line = this.dialogue.controller.currentLine();
        const count = line?.choices.length ?? 0;

        if ((key === 'Enter' || key === ' ') && count === 1) {
            this.chooseDialogueOption(0);
            return true;
        }

        const lower = key.toLowerCase();
        let index = -1;
        if (lower.length === 1 && CHOICE_LETTERS.includes(lower)) {
            index = CHOICE_LETTERS.indexOf(lower);
        } else if (/^[1-9]$/.test(key)) {
            index = Number(key) - 1;
        }
        if (index >= 0 && index < count) this.chooseDialogueOption(index);
        return true;
    },

    /** Click inside the dialogue box: a choice line picks that choice. */
    _handleDialogueClick(box, contentLine) {
        const index = box._dialogueChoiceLines?.indexOf(contentLine) ?? -1;
        if (index >= 0) this.chooseDialogueOption(index);
    },
};
