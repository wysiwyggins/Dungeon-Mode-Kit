/**
 * Runs a compiled ink story (the .json that Inky or `npm run ink` writes) as a
 * conversation. Implements the same currentLine() / choose() / isFinished()
 * interface as DialogueController, so the dialogue window doesn't know which
 * format it's showing.
 *
 * One controller is kept per actor, so ink variables and visit counts last
 * between conversations with that actor (a second visit can greet you
 * differently, and `*` choices stay used up). Each conversation still starts
 * from the top of the story: restart() resets the position and carries the
 * remembered state over.
 *
 * Game variables: an ink global VAR whose name matches a variable the
 * `variables` adapter has (in the engine, a declared prototype or level
 * variable) mirrors it. The engine's value is copied in when a conversation
 * starts, and changes the story makes are written back as it runs.
 */

import { Story } from '../lib/ink.mjs';

// The parts of ink's save format that are memory rather than position.
const REMEMBERED_STATE = ['variablesState', 'visitCounts', 'turnIndices', 'turnIdx', 'storySeed', 'previousRandom'];

/** True if `source` looks like compiled ink JSON rather than a node tree. */
export function isInkJson(source) {
    return !!source && typeof source === 'object' && 'inkVersion' in source;
}

export class InkDialogueController {
    /**
     * @param {object} inkJson - Compiled ink, already parsed
     * @param {string} [name] - For warnings (usually the file path)
     * @param {object} [options]
     * @param {Object<string, Function>} [options.functions] - name → function, bound
     *   as ink EXTERNAL functions. They can read the conversation's `context`
     *   (passed to restart) through the controller.
     * @param {{ names(): string[], get(name): *, set(name, value): * }} [options.variables]
     *   Game variables to mirror into same-named ink VARs
     */
    constructor(inkJson, name = 'ink story', { functions = {}, variables = null } = {}) {
        this.name = name;
        this.story = new Story(inkJson);
        this.story.onError = (message) => console.warn(`Ink (${this.name}): ${message}`);
        // Side effects (giving items), so not lookahead-safe: ink stops before
        // calling one rather than running it speculatively.
        for (const [fnName, fn] of Object.entries(functions)) {
            this.story.BindExternalFunction(fnName, fn, false);
        }
        this.variables = variables;
        this.context = null;
        this.started = false;
        this.line = null;
    }

    /**
     * Begin a conversation from the top, keeping variables and visit counts.
     * @param {object} [context] - Who's talking (e.g. { speaker, listener }), for
     *   the bound functions
     */
    restart(context = this.context) {
        this.context = context;
        if (this.started) {
            try {
                const saved = JSON.parse(this.story.state.toJson());
                this.story.ResetState();
                const fresh = JSON.parse(this.story.state.toJson());
                for (const key of REMEMBERED_STATE) {
                    if (key in saved) fresh[key] = saved[key];
                }
                this.story.state.LoadJson(JSON.stringify(fresh));
            } catch (e) {
                console.warn(`Ink (${this.name}): couldn't carry state over, starting fresh`, e);
                this.story.ResetState();
            }
        }
        this.started = true;
        this._pullVariables();
        this._advance();
    }

    /** Names that are both an ink global VAR in this story and a game variable. */
    _mirroredNames() {
        if (!this.variables) return [];
        const ink = this.story.variablesState;
        return this.variables.names().filter(n => ink.GlobalVariableExistsWithName(n));
    }

    /** Game → ink, at the start of a conversation. */
    _pullVariables() {
        for (const name of this._mirroredNames()) {
            const value = this.variables.get(name);
            if (value !== undefined && value !== null) this.story.variablesState[name] = value;
        }
    }

    /** Ink → game, for any mirrored VAR the story changed. */
    _pushVariables() {
        for (const name of this._mirroredNames()) {
            const value = this.story.variablesState[name];
            if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') continue;
            if (value !== this.variables.get(name)) this.variables.set(name, value);
        }
    }

    /** Run the story up to its next set of choices (or its end). */
    _advance() {
        const text = [];
        try {
            while (this.story.canContinue) {
                const out = this.story.Continue().trim();
                if (out) text.push(out);
            }
        } catch (e) {
            console.warn(`Ink (${this.name}):`, e);
            this.line = null;
            return;
        }
        this._pushVariables();
        const choices = this.story.currentChoices.map(c => c.text);
        // Text with no choices left: show it with a Leave option, like a tree
        // node without choices. No text and no choices: the conversation is over.
        if (!text.length && !choices.length) {
            this.line = null;
            return;
        }
        this.line = { text: text.join(' '), choices: choices.length ? choices : ['Leave'], ended: !choices.length };
    }

    currentLine() {
        if (!this.started) this.restart();
        return this.line ? { text: this.line.text, choices: this.line.choices } : null;
    }

    choose(index) {
        if (!this.line) return;
        if (this.line.ended) {
            this.line = null;
            return;
        }
        try {
            this.story.ChooseChoiceIndex(index);
        } catch (e) {
            console.warn(`Ink (${this.name}):`, e);
            this.line = null;
            return;
        }
        this._advance();
    }

    isFinished() {
        return this.started && this.line === null;
    }
}
