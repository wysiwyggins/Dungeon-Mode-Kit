/**
 * DungeonEngine methods: the saved game. One per prototype, written to the
 * browser's file storage by core/saved-games.js; see docs/SAVING.md.
 *
 * A snapshot is every floor's saved state (the same one a floor transition
 * keeps, with the current floor added), the player, the entities in transit
 * between floors, the run's per-floor flags, the prototype and level variables,
 * the prototype stack, and the prototype's own per-run choices (identification,
 * item looks, lock colors).
 * Resuming loads the prototype, puts that back and restores the current floor
 * the way a revisited floor is restored, with the player where they stood.
 */

import { Prototype } from '../prototype.js';
import { writeSavedGame, removeSavedGame } from '../../core/saved-games.js';

const SNAPSHOT_VERSION = 1;

// How long after the player's last turn to save. Saving at a pause, not every
// turn, keeps a held-down move key from writing the whole run over and over.
const TURN_SAVE_DELAY_MS = 1000;

export const DungeonEngineSavedGames = {
    /** Whether the game is in a state worth saving: mid-play, player alive. */
    canSave() {
        const player = this.entityManager?.player;
        return !!(this.saveKey && this.gameplayStarted && !this.gameOver && !this.runEnded
            && this.currentPrototype && this.mapManager && player && !player.isDead);
    },

    buildSnapshot() {
        const floors = new Map(this.floorStates);
        floors.set(this.currentFloor, this.snapshotFloor());
        return {
            version: SNAPSHOT_VERSION,
            savedAt: new Date().toISOString(),
            prototype: this.currentPrototype.name,
            prototypeName: this.currentPrototype.config?.name || this.currentPrototype.name,
            seed: this.currentSeed,
            currentFloor: this.currentFloor,
            player: this.entityManager.player.serialize(),
            floors: [...floors],
            pendingFallenActors: [...this.pendingFallenActors],
            pendingFallenItems: [...this.pendingFallenItems],
            pendingStairFollowers: [...this.pendingStairFollowers],
            sealedDownFloors: [...this.sealedDownFloors],
            mappedFloors: [...this.mappedFloors],
            prototypeStack: this.prototypeStack,
            prototypeRun: this.currentPrototype.serializeRunState(),
            variables: this.serializeVariables(),
        };
    },

    /**
     * Save shortly after the player's turn (Actor.act). Each turn pushes the
     * save back, so it lands once the player pauses. Closing a tab can't be
     * relied on to finish a write, so this is what keeps the save current.
     */
    scheduleAutosave() {
        clearTimeout(this._autosaveTimer);
        this._autosaveTimer = setTimeout(() => this.autosave(), TURN_SAVE_DELAY_MS);
    },

    /**
     * Write the saved game now, if there's a game to save. Called on floor and
     * prototype changes, after the player's turns, and when the page is hidden.
     * Writes are queued: two at once on the same file would fail, so a save
     * asked for during a write runs after it, with the state as it is then.
     */
    async autosave() {
        clearTimeout(this._autosaveTimer);
        if (this._saveInFlight) {
            this._saveQueued = true;
            return this._saveInFlight;
        }
        if (!this.canSave()) return false;
        let snapshot;
        try {
            snapshot = this.buildSnapshot();
        } catch (e) {
            console.warn('Saved game: snapshot failed', e);
            return false;
        }
        this._saveInFlight = writeSavedGame(this.saveKey, snapshot);
        const written = await this._saveInFlight;
        this._saveInFlight = null;
        if (written && !this._loggedFirstSave) {
            this._loggedFirstSave = true;
            console.log(`Saved game "${this.saveKey}" written (floor ${snapshot.currentFloor}); it updates as you play.`);
        }
        if (this._saveQueued) {
            this._saveQueued = false;
            return this.autosave();
        }
        return written;
    },

    /**
     * After resuming, ask (in the game's own dialog, over the resumed floor)
     * whether to continue. Continue is the primary choice: C or Enter keeps the
     * saved game, and only N or Escape starts a new one.
     * @param {string} prototypeName - the prototype to start a new run of
     * @param {string} [savedAt] - ISO time the save was written
     */
    offerNewRun(prototypeName, savedAt) {
        const when = new Date(savedAt);
        const date = isNaN(when) ? '' : when.toLocaleString(undefined,
            { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ';
        this.interfaceManager?.showConfirmDialog(
            `Continue ${date}save or New game?`,
            null,
            () => this.startNewRun(prototypeName),
            { primary: 'yes', labels: { yes: '(C)ontinue', no: '(N)ew' } }
        );
    },

    /** Drop the current run and start the prototype afresh; its first save replaces the old one. */
    async startNewRun(prototypeName) {
        clearTimeout(this._autosaveTimer);
        this.cleanup();
        await this.loadPrototype(prototypeName);
    },

    /** Death or a win: the run is over, so its save goes. */
    endRun() {
        if (this.runEnded) return;
        this.runEnded = true;
        clearTimeout(this._autosaveTimer);
        if (this.saveKey) {
            console.log(`Run over: saved game "${this.saveKey}" deleted.`);
            removeSavedGame(this.saveKey);
        }
    },

    /**
     * Continue a saved game instead of starting the prototype. Throws if the
     * snapshot can't be used; the caller then starts a new game.
     * @param {Object} snapshot - from buildSnapshot()
     */
    async resumeGame(snapshot) {
        if (snapshot?.version !== SNAPSHOT_VERSION) {
            throw new Error(`saved game version ${snapshot?.version} isn't supported`);
        }
        const config = await this.loadPrototypeConfig(snapshot.prototype);
        if (!config) throw new Error(`prototype "${snapshot.prototype}" no longer exists`);

        this.currentPrototype = new Prototype(snapshot.prototype, config, this);
        await this.currentPrototype.loadAssets();
        this.currentPrototype.restoreRunState(snapshot.prototypeRun);

        this.currentSeed = snapshot.seed;
        this.currentFloor = snapshot.currentFloor;
        this.floorStates = new Map(snapshot.floors);
        this.pendingFallenActors = new Map(snapshot.pendingFallenActors);
        this.pendingFallenItems = new Map(snapshot.pendingFallenItems);
        this.pendingStairFollowers = new Map(snapshot.pendingStairFollowers);
        this.sealedDownFloors = new Set(snapshot.sealedDownFloors);
        this.mappedFloors = new Set(snapshot.mappedFloors);
        this.prototypeStack = snapshot.prototypeStack || [];
        this.restoreVariables(snapshot.variables);
        if (!this.floorStates.has(this.currentFloor)) {
            throw new Error(`saved game has no state for floor ${this.currentFloor}`);
        }

        await this.restoreFloor(this.currentFloor, snapshot.player, 'resume');
    },
};
