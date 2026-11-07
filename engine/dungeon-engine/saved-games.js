/**
 * DungeonEngine methods: the saved game. One per prototype, written to the
 * browser's file storage by core/saved-games.js; see docs/SAVING.md.
 *
 * A snapshot is every floor's saved state (the same one a floor transition
 * keeps, with the current floor added), the player, the entities in transit
 * between floors, the run's per-floor flags, the prototype stack, and the
 * prototype's own per-run choices (identification, item looks, lock colors).
 * Resuming loads the prototype, puts that back and restores the current floor
 * the way a revisited floor is restored, with the player where they stood.
 */

import { Prototype } from '../prototype.js';
import { writeSavedGame, removeSavedGame } from '../../core/saved-games.js';

const SNAPSHOT_VERSION = 1;

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
        };
    },

    /**
     * Write the saved game, if there's a game to save. Called on floor and
     * prototype changes and when the page is hidden. The snapshot is taken now;
     * only the write happens later.
     */
    autosave() {
        if (!this.canSave()) return Promise.resolve(false);
        let snapshot;
        try {
            snapshot = this.buildSnapshot();
        } catch (e) {
            console.warn('Saved game: snapshot failed', e);
            return Promise.resolve(false);
        }
        return writeSavedGame(this.saveKey, snapshot);
    },

    /** Death or a win: the run is over, so its save goes. */
    endRun() {
        if (this.runEnded) return;
        this.runEnded = true;
        if (this.saveKey) removeSavedGame(this.saveKey);
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
        if (!this.floorStates.has(this.currentFloor)) {
            throw new Error(`saved game has no state for floor ${this.currentFloor}`);
        }

        await this.restoreFloor(this.currentFloor, snapshot.player, 'resume');
    },
};
