/**
 * Architect methods: turning queued walls, doors, torches, braziers, liquids,
 * secrets, bridges and collapsing floors into actors, plus switch puzzles and the
 * treasure room.
 */

import { TP_DIRS8 } from './architect.js';

export const ArchitectSpawning = {
    // ========================================================================
    // ENTITY SPAWNING
    // ========================================================================

    spawnPendingWalls(context) {
        if (!this.pendingWallSpawns || this.pendingWallSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn walls without context');
            return;
        }

        const actorDataCache = {};
        const typeCounts = {};

        for (const pos of this.pendingWallSpawns) {
            if (context.getActorAt) {
                const existingActor = context.getActorAt(pos.x, pos.y);
                if (existingActor && existingActor.hasAttribute('stairway')) {
                    continue;
                }
            }

            const wallType = pos.type || 'wall';

            if (!actorDataCache[wallType]) {
                actorDataCache[wallType] = context.getActorData(wallType);
                if (!actorDataCache[wallType]) {
                    console.warn(`No actor data found for wall type: ${wallType}`);
                    continue;
                }
                typeCounts[wallType] = 0;
            }

            const actorData = actorDataCache[wallType];
            if (!actorData) continue;

            context.createActor(pos.x, pos.y, wallType, actorData);
            typeCounts[wallType]++;
        }

        const summary = Object.entries(typeCounts).map(([type, count]) => `${count} ${type}`).join(', ');
        console.log(`Spawned wall actors: ${summary}`);
        this.pendingWallSpawns = [];
    },

    spawnPendingDoors(context) {
        if (!this.pendingDoorSpawns || this.pendingDoorSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn doors without context');
            return;
        }

        const actorData = context.getActorData('door');
        if (!actorData) {
            console.warn('No door actor data found');
            return;
        }

        for (const pos of this.pendingDoorSpawns) {
            context.createActor(pos.x, pos.y, 'door', actorData);
        }

        console.log(`Spawned ${this.pendingDoorSpawns.length} door actors`);
        this.pendingDoorSpawns = [];
    },

    spawnPendingTorches(context) {
        if (!this.pendingTorchSpawns || this.pendingTorchSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn torches without context');
            return;
        }

        // Wall mounts use the `wall_torch` actor (display name "mounted torch"),
        // distinct from the takeable `torch` item. The freestanding centrepiece is
        // a `brazier`, spawned separately.
        const actorData = context.getActorData('wall_torch');
        if (!actorData) {
            console.warn('No wall_torch actor data found');
            return;
        }

        for (const pos of this.pendingTorchSpawns) {
            context.createActor(pos.x, pos.y, 'wall_torch', actorData);
        }

        console.log(`Spawned ${this.pendingTorchSpawns.length} wall torch actors`);
        this.pendingTorchSpawns = [];
    },

    spawnPendingBraziers(context) {
        if (!this.pendingBrazierSpawns || this.pendingBrazierSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn braziers without context');
            return;
        }

        const actorData = context.getActorData('brazier');
        if (!actorData) {
            console.warn('No brazier actor data found');
            return;
        }

        for (const pos of this.pendingBrazierSpawns) {
            context.createActor(pos.x, pos.y, 'brazier', actorData);
        }

        console.log(`Spawned ${this.pendingBrazierSpawns.length} centre brazier actors`);
        this.pendingBrazierSpawns = [];
    },

    /**
     * Drain the liquid blob queue. One function for every liquid because each
     * entry names its own actor — the same shape spawnPendingWalls uses for
     * wall_types, so a blob can be any actor, not just water/sewage/lava.
     */
    spawnPendingLiquids(context) {
        if (!this.pendingLiquidSpawns || this.pendingLiquidSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn liquids without context');
            return;
        }

        const actorDataCache = {};
        const typeCounts = {};

        for (const pos of this.pendingLiquidSpawns) {
            const type = pos.type;
            if (!(type in actorDataCache)) {
                actorDataCache[type] = context.getActorData(type) || null;
                if (!actorDataCache[type]) {
                    console.warn(`No actor data found for liquid type: ${type}`);
                }
                typeCounts[type] = 0;
            }
            const actorData = actorDataCache[type];
            if (!actorData) continue;

            context.createActor(pos.x, pos.y, type, actorData);
            typeCounts[type]++;
        }

        const summary = Object.entries(typeCounts)
            .filter(([, n]) => n > 0)
            .map(([t, n]) => `${n} ${t}`)
            .join(', ');
        if (summary) console.log(`Spawned liquid actors: ${summary}`);
        this.pendingLiquidSpawns = [];
    },

    spawnPendingPushableWalls(context) {
        if (!this.pendingPushableWallSpawns || this.pendingPushableWallSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn pushable walls without context');
            return;
        }

        const actorData = context.getActorData('pushable_wall');
        if (!actorData) {
            console.warn('No pushable_wall actor data found');
            return;
        }

        for (const pos of this.pendingPushableWallSpawns) {
            context.createActor(pos.x, pos.y, 'pushable_wall', actorData);
        }

        console.log(`Spawned ${this.pendingPushableWallSpawns.length} pushable wall actors`);
        this.pendingPushableWallSpawns = [];
    },

    /**
     * Secret doors and the concealed levers that work them.
     *
     * Both spawn as ordinary actors carrying `hidden: true`; the search action
     * (see EPISTEMOLOGY.md) is what turns them up. A lever is linked to its door
     * by machine_id, written here because the pair is only known at generation
     * time — the actor data cannot name a partner it has not been placed beside.
     */
    spawnPendingSecretDoors(context) {
        if (!this.pendingSecretDoorSpawns || this.pendingSecretDoorSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn secret doors without context');
            return;
        }

        // A lever-driven passage uses the barred variant, which is locked: revealing
        // it is not enough, the lever has to be found too. Without a lever the plain
        // variant opens on a bump once discovered.
        const plainData = context.getActorData('hidden_door');
        if (!plainData) {
            console.warn('No hidden_door actor data found');
            return;
        }
        const barredData = context.getActorData('barred_hidden_door');

        for (const pos of this.pendingSecretDoorSpawns) {
            // No barred data means no locked door, and an unlocked door would open
            // on a bump — so drop the lever's machine link rather than ship a
            // passage whose lever does nothing.
            const barred = !!pos.machine_id && !!barredData;
            if (pos.machine_id && !barredData) {
                console.warn('No barred_hidden_door actor data; secret door will not be lever-locked');
            }
            context.createActor(
                pos.x, pos.y,
                barred ? 'barred_hidden_door' : 'hidden_door',
                this._withMachineId(barred ? barredData : plainData, barred ? pos.machine_id : null)
            );
        }

        console.log(`Spawned ${this.pendingSecretDoorSpawns.length} secret door actors`);
        this.pendingSecretDoorSpawns = [];
    },

    spawnPendingHiddenLevers(context) {
        if (!this.pendingHiddenLeverSpawns || this.pendingHiddenLeverSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn hidden levers without context');
            return;
        }

        const actorData = context.getActorData('hidden_lever');
        if (!actorData) {
            console.warn('No hidden_lever actor data found');
            return;
        }

        for (const pos of this.pendingHiddenLeverSpawns) {
            context.createActor(pos.x, pos.y, 'hidden_lever', this._withMachineId(actorData, pos.machine_id));
        }

        console.log(`Spawned ${this.pendingHiddenLeverSpawns.length} hidden lever actors`);
        this.pendingHiddenLeverSpawns = [];
    },

    // Shallow copy of actor data with a machine_id folded into its attributes.
    // Returns the original untouched when there is no id to add, so the common
    // case allocates nothing.
    _withMachineId(actorData, machineId) {
        if (!machineId) return actorData;
        return {
            ...actorData,
            attributes: { ...(actorData.attributes || {}), machine_id: machineId }
        };
    },

    spawnPendingBridges(context) {
        if (!this.pendingBridgeSpawns || this.pendingBridgeSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn bridges without context');
            return;
        }

        const actorData = context.getActorData('rope_bridge');
        if (!actorData) {
            console.warn('No rope_bridge actor data found');
            return;
        }

        // Choose each cell's box-drawing tile from which of its four neighbours are
        // also bridge cells. Straight runs stay straight; where a horizontal and a
        // vertical crossing meet, the shared cell becomes a "+" (or a T at a wall)
        // junction. Endpoints (one connection) fall back to the straight tile for
        // their axis. Every pattern maps to a tile in data/static-tiles.json.
        // Keyed by crossing group, not by bare position, so two unrelated bridges
        // running alongside each other don't read as connected. Cells of one blob's
        // h and v crossings share a group, so a real intersection resolves to "+".
        const cellSet = new Set(
            this.pendingBridgeSpawns.map(p => `${p.crossingGroup}:${p.x},${p.y}`)
        );
        const has = (group, x, y) => cellSet.has(`${group}:${x},${y}`);
        const tileNameFor = (pos) => {
            const n = has(pos.crossingGroup, pos.x, pos.y - 1);
            const s = has(pos.crossingGroup, pos.x, pos.y + 1);
            const e = has(pos.crossingGroup, pos.x + 1, pos.y);
            const w = has(pos.crossingGroup, pos.x - 1, pos.y);
            const count = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);
            if (count >= 3) {
                if (n && s && e && w) return 'WHITE_BOX_VERTICAL_HORIZONTAL'; // +
                if (e && w && s) return 'WHITE_BOX_DOWN_HORIZONTAL';  // T pointing down
                if (e && w && n) return 'WHITE_BOX_UP_HORIZONTAL';    // T pointing up
                if (n && s && e) return 'WHITE_BOX_RIGHT_VERTICAL';   // T pointing right
                return 'WHITE_BOX_LEFT_VERTICAL';                     // n && s && w -> T pointing left
            }
            if (count === 2) {
                if (e && w) return 'WHITE_BOX_HORIZONTAL';
                if (n && s) return 'WHITE_BOX_VERTICAL';
                // Corners — named by where the corner sits; lines extend the two
                // connected directions.
                if (n && e) return 'WHITE_BOX_BOTTOM_LEFT';   // lines up + right
                if (n && w) return 'WHITE_BOX_BOTTOM_RIGHT';  // lines up + left
                if (s && e) return 'WHITE_BOX_TOP_LEFT';      // lines down + right
                return 'WHITE_BOX_TOP_RIGHT';                 // s && w -> lines down + left
            }
            // 0 or 1 connection (endpoint / lone cell): straight tile for the axis.
            return pos.dir === 'v' ? 'WHITE_BOX_VERTICAL' : 'WHITE_BOX_HORIZONTAL';
        };

        // Clone the shared actorData per-tile so we never mutate the catalog entry.
        for (const pos of this.pendingBridgeSpawns) {
            const data = { ...actorData, tileIndexBase: tileNameFor(pos) };
            context.createActor(pos.x, pos.y, 'rope_bridge', data);
        }

        console.log(`Spawned ${this.pendingBridgeSpawns.length} rope bridge actors`);
        this.pendingBridgeSpawns = [];
    },

    spawnPendingCollapsingFloors(context) {
        if (!this.pendingCollapsingFloorSpawns || this.pendingCollapsingFloorSpawns.length === 0) return;
        if (!context || !context.getActorData || !context.createActor) {
            console.warn('Cannot spawn collapsing floors without context');
            return;
        }

        const actorData = context.getActorData('collapsing_floor');
        if (!actorData) {
            console.warn('No collapsing_floor actor data found');
            return;
        }

        for (const pos of this.pendingCollapsingFloorSpawns) {
            context.createActor(pos.x, pos.y, 'collapsing_floor', actorData);
        }

        console.log(`Spawned ${this.pendingCollapsingFloorSpawns.length} collapsing floor actors`);
        this.pendingCollapsingFloorSpawns = [];
    },

    // ========================================================================
    // SWITCH PUZZLES
    // ========================================================================

    spawnSwitchPuzzles(config, context) {
        if (!config || !this.diggerRooms || this.diggerRooms.length === 0) return [];
        if (!context?.createActor || !context?.getActorData) return [];

        const min = config.min ?? 0;
        const max = config.max ?? min;
        const count = min + Math.floor(ROT.RNG.getUniform() * (max - min + 1));
        if (count <= 0 || !config.patterns || config.patterns.length === 0) return [];

        const totalWeight = config.patterns.reduce((sum, p) => sum + (p.weight ?? 1), 0);
        const results = [];

        for (let i = 0; i < count; i++) {
            let roll = ROT.RNG.getUniform() * totalWeight;
            let pattern = config.patterns[0];
            for (const p of config.patterns) {
                roll -= (p.weight ?? 1);
                if (roll <= 0) { pattern = p; break; }
            }

            const machineId = `switch_puzzle_${i}`;
            let result = null;

            switch (pattern.type) {
                case 'gated_room':
                    result = this._placeSwitchPuzzle_gatedRoom(pattern, machineId, context);
                    break;
                case 'gated_corridor':
                    result = this._placeSwitchPuzzle_gatedCorridor(pattern, machineId, context);
                    break;
            }

            if (result) {
                results.push(result);
                console.log(`Switch puzzle "${pattern.type}" placed with machine_id="${machineId}"`);
            }
        }

        return results;
    },

    _placeSwitchPuzzle_gatedRoom(pattern, machineId, context) {
        const eligibleRooms = this.diggerRooms
            .map((room, idx) => ({ room, idx }))
            .filter(({ idx }) => !this.claimedRoomIndices.has(idx))
            .filter(({ room }) => {
                let doorCount = 0;
                room.getDoors(() => doorCount++);
                return doorCount >= 1;
            });

        if (eligibleRooms.length === 0) return null;

        const { room, idx } = eligibleRooms[Math.floor(ROT.RNG.getUniform() * eligibleRooms.length)];
        this.claimedRoomIndices.add(idx);

        const doors = [];
        room.getDoors((x, y) => doors.push({ x, y }));
        const chosenDoor = doors[Math.floor(ROT.RNG.getUniform() * doors.length)];

        this.pendingDoorSpawns = this.pendingDoorSpawns.filter(
            p => !(p.x === chosenDoor.x && p.y === chosenDoor.y)
        );

        const switchActorType = pattern.switch_actor || 'gate_lever';
        const targetActorType = pattern.target_actor || 'gate';

        const targetData = context.getActorData(targetActorType);
        if (!targetData) return null;

        const gateData = {
            ...targetData,
            attributes: {
                ...(targetData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(chosenDoor.x, chosenDoor.y, targetActorType, gateData);

        const switchData = context.getActorData(switchActorType);
        if (!switchData) return null;

        const leverPos = this._findLeverPosition(room, chosenDoor);
        if (!leverPos) return null;

        const leverData = {
            ...switchData,
            switch_effects: pattern.switch_effects || switchData.switch_effects || { locked: false, open: true },
            switch_message: pattern.switch_message || switchData.switch_message || 'You pull [name].',
            attributes: {
                ...(switchData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(leverPos.x, leverPos.y, switchActorType, leverData);

        this.walkableTiles = this.walkableTiles.filter(
            t => !(t.x === leverPos.x && t.y === leverPos.y) && !(t.x === chosenDoor.x && t.y === chosenDoor.y)
        );

        return { machineId, type: 'gated_room', gate: chosenDoor, lever: leverPos };
    },

    _findLeverPosition(room, doorPos) {
        const roomLeft = room.getLeft();
        const roomRight = room.getRight();
        const roomTop = room.getTop();
        const roomBottom = room.getBottom();

        const isInsideRoom = (x, y) =>
            x >= roomLeft && x <= roomRight && y >= roomTop && y <= roomBottom;

        const candidates = [];
        for (const dir of [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 }]) {
            const nx = doorPos.x + dir.dx;
            const ny = doorPos.y + dir.dy;
            if (!isInsideRoom(nx, ny) && this.isWalkable(nx, ny)) {
                for (const step of [
                    { dx: dir.dx, dy: dir.dy },
                    { dx: dir.dy, dy: dir.dx },
                    { dx: -dir.dy, dy: -dir.dx }
                ]) {
                    const lx = nx + step.dx;
                    const ly = ny + step.dy;
                    if (this.isWalkable(lx, ly) && !isInsideRoom(lx, ly)) {
                        const hasWallNeighbor = [
                            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
                            { dx: 0, dy: -1 }, { dx: 0, dy: 1 }
                        ].some(d => !this.isWalkable(lx + d.dx, ly + d.dy));
                        if (hasWallNeighbor) {
                            candidates.push({ x: lx, y: ly });
                        }
                    }
                }
                if (candidates.length === 0) {
                    candidates.push({ x: nx, y: ny });
                }
            }
        }

        if (candidates.length === 0) return null;
        return candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
    },

    _placeSwitchPuzzle_gatedCorridor(pattern, machineId, context) {
        const roomTileSet = new Set();
        for (const room of this.diggerRooms) {
            for (let y = room.getTop(); y <= room.getBottom(); y++) {
                for (let x = room.getLeft(); x <= room.getRight(); x++) {
                    roomTileSet.add(`${x},${y}`);
                }
            }
        }

        const corridorTiles = this.walkableTiles.filter(
            t => !roomTileSet.has(`${t.x},${t.y}`)
        );

        if (corridorTiles.length < 3) return null;

        const gatePos = corridorTiles[Math.floor(ROT.RNG.getUniform() * corridorTiles.length)];

        const plateCandidates = corridorTiles.filter(t => {
            const dist = Math.abs(t.x - gatePos.x) + Math.abs(t.y - gatePos.y);
            return dist >= 2 && dist <= 6;
        });

        if (plateCandidates.length === 0) return null;

        const platePos = plateCandidates[Math.floor(ROT.RNG.getUniform() * plateCandidates.length)];

        const targetActorType = pattern.target_actor || 'gate';
        const switchActorType = pattern.switch_actor || 'trap_plate';

        const targetData = context.getActorData(targetActorType);
        const switchData = context.getActorData(switchActorType);
        if (!targetData || !switchData) return null;

        const gateData = {
            ...targetData,
            attributes: {
                ...(targetData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(gatePos.x, gatePos.y, targetActorType, gateData);

        const plateData = {
            ...switchData,
            switch_effects: pattern.switch_effects || switchData.switch_effects || { locked: true, open: false },
            switch_message: pattern.switch_message || switchData.switch_message || 'A stone depresses.',
            attributes: {
                ...(switchData.attributes || {}),
                machine_id: machineId
            }
        };
        context.createActor(platePos.x, platePos.y, switchActorType, plateData);

        this.walkableTiles = this.walkableTiles.filter(
            t => !(t.x === gatePos.x && t.y === gatePos.y)
        );

        return { machineId, type: 'gated_corridor', gate: gatePos, plate: platePos };
    },

    // ========================================================================
    // TREASURE ROOM
    // ========================================================================

    spawnTreasureRoom() {
        if (!this.diggerRooms || this.diggerRooms.length === 0) {
            return null;
        }

        // Skip rooms another feature has already taken — a switch puzzle's gated
        // room, or a generator-reserved room like a palladian sanctum. Landing on
        // one would wall off its extra entrances and lock the door.
        // (_placeSwitchPuzzle_gatedRoom already honours this set.)
        const eligibleRooms = this.diggerRooms.filter((room, idx) => {
            if (this.claimedRoomIndices.has(idx)) return false;
            let count = 0;
            room.getDoors(() => count++);
            return count > 0;
        });

        if (eligibleRooms.length === 0) {
            return null;
        }

        const treasureRoom = eligibleRooms[Math.floor(ROT.RNG.getUniform() * eligibleRooms.length)];
        const roomIndex = this.diggerRooms.indexOf(treasureRoom);
        if (roomIndex >= 0) this.claimedRoomIndices.add(roomIndex);

        const roomTiles = [];
        for (let y = treasureRoom.getTop(); y <= treasureRoom.getBottom(); y++) {
            for (let x = treasureRoom.getLeft(); x <= treasureRoom.getRight(); x++) {
                if (this.floorMap[y] && this.floorMap[y][x]) {
                    roomTiles.push({ x, y });
                }
            }
        }

        const allEntrances = [];
        treasureRoom.getDoors((x, y) => allEntrances.push({ x, y }));

        if (allEntrances.length === 0) return null;

        const chosenDoor = allEntrances[0];
        const doorSet = new Set(this.pendingDoorSpawns.map(p => `${p.x},${p.y}`));

        for (const entrance of allEntrances) {
            if (doorSet.has(`${entrance.x},${entrance.y}`)) {
                this.pendingDoorSpawns = this.pendingDoorSpawns.filter(
                    p => !(p.x === entrance.x && p.y === entrance.y)
                );
            }
            if (entrance !== chosenDoor) {
                this.pendingWallSpawns.push({ x: entrance.x, y: entrance.y, type: 'metal_wall' });
                this.walkableTiles = this.walkableTiles.filter(
                    t => !(t.x === entrance.x && t.y === entrance.y)
                );
            }
        }

        const left = treasureRoom.getLeft() - 1;
        const right = treasureRoom.getRight() + 1;
        const top = treasureRoom.getTop() - 1;
        const bottom = treasureRoom.getBottom() + 1;
        const inSeal = (p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
        for (const wall of this.pendingWallSpawns) {
            if (inSeal(wall)) {
                wall.type = 'metal_wall';
            }
        }

        // A vault wall is not sealed just because it looks like one. A secret door
        // or a pushable wall in the ring is a way in that this sweep used to miss
        // entirely — it only ever upgraded pendingWallSpawns — so the loot could be
        // reached by searching or shoving instead of by finding the key. Both
        // queues are drained into metal_wall here, which is the whole point of the
        // vault: exactly one way in, through the locked door.
        const breaches = [];
        this.pendingSecretDoorSpawns = this.pendingSecretDoorSpawns.filter(p => {
            if (!inSeal(p)) return true;
            breaches.push(p);
            return false;
        });
        this.pendingPushableWallSpawns = this.pendingPushableWallSpawns.filter(p => {
            if (!inSeal(p)) return true;
            breaches.push(p);
            return false;
        });
        for (const p of breaches) {
            this.pendingWallSpawns.push({ x: p.x, y: p.y, type: 'metal_wall' });
            this.walkableTiles = this.walkableTiles.filter(t => !(t.x === p.x && t.y === p.y));
        }

        // Finally, close any bare gap in the ring *around* the vault's own floor.
        // Everything above can only upgrade a cell some queue already owns; a cell
        // that is simply open floor belongs to nothing and survived every sweep.
        //
        // The ring is derived from the vault's actual tiles, not from the bbox
        // border: for a cavern or cross-shaped room the bbox border cuts straight
        // through the room's own interior, and sealing that walls the vault off
        // from the inside — the door opens onto a plugged room.
        const vaultTiles = new Set(roomTiles.map(t => `${t.x},${t.y}`));
        const sealed = new Set(this.pendingWallSpawns.map(w => `${w.x},${w.y}`));
        let gapsClosed = 0;
        for (const t of roomTiles) {
            for (const [dx, dy] of TP_DIRS8) {
                const x = t.x + dx, y = t.y + dy;
                if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
                if (vaultTiles.has(`${x},${y}`)) continue;              // the room itself
                if (x === chosenDoor.x && y === chosenDoor.y) continue; // the way in
                if (sealed.has(`${x},${y}`)) continue;
                if (!this.floorMap[y] || this.floorMap[y][x] === null) continue;  // void
                this.pendingWallSpawns.push({ x, y, type: 'metal_wall' });
                this.walkableTiles = this.walkableTiles.filter(c => !(c.x === x && c.y === y));
                sealed.add(`${x},${y}`);
                gapsClosed++;
            }
        }

        // Publish the vault as a named region so a spawn entry can target it with
        // `"region": "treasure_room"` — e.g. a guardian inside the locked vault.
        //
        // Filtered against walkableTiles rather than reusing roomTiles: roomTiles comes
        // from floorMap, which has an entry for WALL tiles too (a wall sits on a floor
        // tile), so it spans the room's walls as well as its interior.
        const walkableKeys = new Set(this.walkableTiles.map(t => `${t.x},${t.y}`));
        this.namedRegions.treasure_room = roomTiles
            .filter(t => walkableKeys.has(`${t.x},${t.y}`))
            .map(t => ({ x: t.x, y: t.y }));

        console.log(`Treasure room: ${roomTiles.length} floor tiles, locked door at (${chosenDoor.x}, ${chosenDoor.y}), ${allEntrances.length - 1} extra entrance(s) walled off` +
            (breaches.length > 0 ? `, ${breaches.length} secret/pushable breach(es) sealed` : '') +
            (gapsClosed > 0 ? `, ${gapsClosed} open ring gap(s) closed` : ''));
        return { roomTiles, doorPos: chosenDoor };
    },
};
