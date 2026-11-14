/**
 * DungeonEngine methods: prototype and level variables. Named values a
 * prototype declares in prototype.json and that the game, actors and dialogue
 * can read and change (see docs/PROTOTYPE.md, "Variables"):
 *
 *   "variables": {
 *     "prototype": { "met_hermit": false },        // one value for the whole run
 *     "levels": { "1": { "desecrated": false } }   // one value per floor
 *   }
 *
 * Only declared names exist: getVariable returns undefined for anything else
 * and setVariable warns and does nothing, so a typo shows up in the console
 * instead of quietly making a new variable. A level variable shadows a
 * prototype variable of the same name on its floor.
 *
 * Both kinds are saved with the game. Level values are kept per floor number,
 * so leaving a floor and coming back finds them as they were.
 */

/** Variable values are what ink can hold too: booleans, numbers and strings. */
function isVariableValue(value) {
    return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

export const DungeonEngineVariables = {
    /** Start a run's variables from the current prototype's declarations. */
    resetVariables() {
        const declared = this.currentPrototype?.config?.variables || {};
        this.prototypeVariables = { ...(declared.prototype || {}) };
        this.levelVariables = new Map();

        const levels = declared.levels || {};
        for (const [floor, vars] of Object.entries(levels)) {
            for (const name of Object.keys(vars || {})) {
                if (name in this.prototypeVariables) {
                    console.warn(`Variable "${name}" is declared for the prototype and for level ${floor}; the level's value is used on that floor.`);
                }
            }
        }
    },

    /** The declared level variables for a floor (defaults filled in on first use). */
    _levelVariablesFor(floor = this.currentFloor) {
        if (!this.levelVariables) this.resetVariables();
        let vars = this.levelVariables.get(floor);
        if (!vars) {
            const defaults = this.currentPrototype?.config?.variables?.levels?.[floor];
            vars = { ...(defaults || {}) };
            this.levelVariables.set(floor, vars);
        }
        return vars;
    },

    /** The object holding `name` on the current floor (level first), or null. */
    _variableScope(name) {
        const level = this._levelVariablesFor();
        if (Object.hasOwn(level, name)) return level;
        if (this.prototypeVariables && Object.hasOwn(this.prototypeVariables, name)) return this.prototypeVariables;
        return null;
    },

    /** Whether `name` is a declared variable on the current floor. */
    hasVariable(name) {
        return !!this._variableScope(name);
    },

    /** Every variable name visible on the current floor. */
    variableNames() {
        return [...new Set([...Object.keys(this.prototypeVariables || {}), ...Object.keys(this._levelVariablesFor())])];
    },

    /** A variable's value on the current floor, or undefined if it isn't declared. */
    getVariable(name) {
        return this._variableScope(name)?.[name];
    },

    /**
     * Change a declared variable. Actors on the floor are told, so one tied to
     * it (an NPC's provoked_variable) can react at once.
     * @returns {boolean} False if `name` isn't declared or the value isn't a
     *   boolean, number or string
     */
    setVariable(name, value) {
        const scope = this._variableScope(name);
        if (!scope) {
            console.warn(`Variable "${name}" isn't declared in prototype.json "variables" for this prototype or level ${this.currentFloor}`);
            return false;
        }
        if (!isVariableValue(value)) {
            console.warn(`Variable "${name}" can't be set to ${value}: use a boolean, number or string`);
            return false;
        }
        if (scope[name] === value) return true;
        scope[name] = value;
        for (const actor of this.entityManager?.actors || []) {
            actor.onVariableChanged?.(name, value);
        }
        return true;
    },

    /** Variables for the saved game. */
    serializeVariables() {
        return {
            prototype: { ...(this.prototypeVariables || {}) },
            levels: [...(this.levelVariables || new Map())].map(([floor, vars]) => [floor, { ...vars }]),
        };
    },

    /**
     * Put back serializeVariables' output. Anything missing starts from the
     * declarations, and saved names that are no longer declared are dropped.
     */
    restoreVariables(data) {
        this.resetVariables();
        if (!data) return;
        const copyDeclared = (into, from) => {
            for (const [name, value] of Object.entries(from || {})) {
                if (Object.hasOwn(into, name)) into[name] = value;
            }
        };
        copyDeclared(this.prototypeVariables, data.prototype);
        for (const [floor, vars] of data.levels || []) {
            copyDeclared(this._levelVariablesFor(floor), vars);
        }
    },
};
