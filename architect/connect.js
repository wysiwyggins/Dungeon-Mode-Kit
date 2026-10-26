/**
 * Architect methods: joining wildcard regions to the authored floor around them.
 *
 * Each wildcard region is generated on its own region-sized grid, blind to the
 * map around it, and most generators ring their output with wall. So a region
 * painted beside authored floor only joins it when a corridor happens to end on
 * the seam. connectRegions runs once every region is filled and carves the
 * missing links, the same way repairBlobConnectivity rejoins ground an abyss cut
 * off, but measured the authored-map way.
 */

// Wildcard types that are generator regions, as opposed to painted actors or
// spawn markers. Only cells of these types are ever carved.
const REGION_TYPES = new Set([
    'maze', 'digger_region', 'dungeon', 'uniform', 'rogue', 'divided_maze',
    'icey_maze', 'arena', 'cave', 'infernal', 'room', 'palladian'
]);

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export const ArchitectConnect = {
    /**
     * Carve a passage from every floor area that can't reach the largest one,
     * through wildcard-region cells only. Authored cells are never carved, so an
     * area the designer sealed off on purpose stays sealed: it has no carvable
     * route and is left alone.
     *
     * Runs after processWildcards and before the pending walls spawn, while
     * region walls are still entries in pendingWallSpawns that can be dropped.
     *
     * @param {Object} [options]
     * @param {(x: number, y: number) => boolean} [options.isBlockedByActor] -
     *   True when an already-spawned actor (a painted wall, a solid authored
     *   object) blocks the cell. Openable and pushable actors shouldn't count.
     * @param {number} [options.doorChance=50] - Percent chance each connection
     *   gets a door where it meets the floor it joins, when the spot is a
     *   doorway (walled on both sides).
     * @param {number} [options.minAreaSize=3] - Floor areas smaller than this are
     *   treated as scenery and not connected.
     * @param {number} [options.maxLength=40] - Longest passage to carve. Uniform and
     *   rogue regions can leave bands of solid wall twenty tiles wide.
     * @returns {number} How many passages were carved
     */
    connectRegions(options = {}) {
        const isBlockedByActor = options.isBlockedByActor || (() => false);
        const doorChance = options.doorChance ?? 50;
        const minAreaSize = options.minAreaSize ?? 3;
        const maxLength = options.maxLength ?? 40;

        const inside = (x, y) => x >= 1 && y >= 1 && x < this.width - 1 && y < this.height - 1;
        const isRegionCell = (x, y) => REGION_TYPES.has(this.wildcardMap[y]?.[x]?.type);

        const wallKeys = new Set(this.pendingWallSpawns.map(p => `${p.x},${p.y}`));
        // Cells already promised to something else: carving them would leave a
        // torch or a hidden lever standing in a corridor.
        const reserved = new Set([
            ...this.pendingTorchSpawns, ...this.pendingBrazierSpawns,
            ...this.pendingHiddenLeverSpawns
        ].map(p => `${p.x},${p.y}`));
        // A secret door or pushable wall is a way through, just not an obvious one.
        const passable = new Set([
            ...this.pendingDoorSpawns, ...this.pendingSecretDoorSpawns,
            ...this.pendingPushableWallSpawns
        ].map(p => `${p.x},${p.y}`));

        const isOpen = (x, y) => {
            if (!inside(x, y)) return false;
            const key = `${x},${y}`;
            if (passable.has(key)) return true;
            if (wallKeys.has(key)) return false;
            const floor = this.floorMap[y][x];
            if (!floor || floor.tileId <= 0 || this.isVoidFloorFill(floor.tileId)) return false;
            return !isBlockedByActor(x, y);
        };
        const isCarvable = (x, y) => {
            if (!inside(x, y) || !isRegionCell(x, y)) return false;
            const key = `${x},${y}`;
            if (reserved.has(key) || isOpen(x, y)) return false;
            return !isBlockedByActor(x, y);
        };

        // Label every 4-connected floor area.
        const label = new Map();
        const areas = [];
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const key = `${x},${y}`;
                if (label.has(key) || !isOpen(x, y)) continue;
                const id = areas.length;
                const cells = [];
                const stack = [{ x, y }];
                label.set(key, id);
                while (stack.length > 0) {
                    const cell = stack.pop();
                    cells.push(cell);
                    for (const [dx, dy] of DIRS4) {
                        const nx = cell.x + dx, ny = cell.y + dy;
                        const nk = `${nx},${ny}`;
                        if (label.has(nk) || !isOpen(nx, ny)) continue;
                        label.set(nk, id);
                        stack.push({ x: nx, y: ny });
                    }
                }
                areas.push({ id, cells });
            }
        }

        const candidates = areas.filter(a => a.cells.length >= minAreaSize)
            .sort((a, b) => b.cells.length - a.cells.length);
        if (candidates.length <= 1) return 0;

        // Joining never splits anything, so labels stay valid: a joined area's id
        // just moves into the connected set. Keep passing until nothing new joins,
        // so an area that can only reach another orphan follows it in.
        const connected = new Set([candidates[0].id]);
        let pending = candidates.slice(1);
        let carved = 0;
        let progress = true;
        while (progress && pending.length > 0) {
            progress = false;
            for (const area of [...pending]) {
                const path = this._connectFindPath(area, label, connected, isCarvable, maxLength);
                if (!path) continue;
                this._connectCarve(path, wallKeys);
                for (const c of path.cells) label.set(`${c.x},${c.y}`, area.id);
                this._connectMaybeDoor(path, isOpen, isRegionCell, doorChance);
                connected.add(area.id);
                pending = pending.filter(a => a !== area);
                carved++;
                progress = true;
            }
        }

        if (pending.length > 0) {
            console.log(`Region connect: ${pending.length} floor area(s) have no carvable route and were left as drawn`);
        }
        if (carved > 0) console.log(`Region connect: ${carved} passage(s) carved`);
        return carved;
    },

    /**
     * Shortest run of carvable cells from `area` to any area in `connected`.
     * Breadth-first through carvable cells, seeded from every cell touching the
     * area, so the passage is the narrowest crossing of whatever separates them.
     * @returns {{cells: Array<{x, y}>, from: {x, y}, to: {x, y}}|null} cells run
     *   from the area's side to the connected side
     */
    _connectFindPath(area, label, connected, isCarvable, maxLength) {
        const nodes = new Map();
        const queue = [];
        for (const cell of area.cells) {
            for (const [dx, dy] of DIRS4) {
                const nx = cell.x + dx, ny = cell.y + dy;
                const key = `${nx},${ny}`;
                if (nodes.has(key) || !isCarvable(nx, ny)) continue;
                nodes.set(key, { x: nx, y: ny, from: cell, steps: 1, parent: null });
                queue.push(key);
            }
        }

        for (let head = 0; head < queue.length; head++) {
            const node = nodes.get(queue[head]);
            for (const [dx, dy] of DIRS4) {
                const nx = node.x + dx, ny = node.y + dy;
                const key = `${nx},${ny}`;
                const landing = label.get(key);
                if (landing !== undefined && connected.has(landing)) {
                    const cells = [];
                    for (let step = node; step; step = step.parent) cells.push({ x: step.x, y: step.y });
                    cells.reverse();
                    return { cells, from: node.from, to: { x: nx, y: ny } };
                }
                if (node.steps >= maxLength || nodes.has(key) || !isCarvable(nx, ny)) continue;
                nodes.set(key, { x: nx, y: ny, from: node.from, steps: node.steps + 1, parent: node });
                queue.push(key);
            }
        }
        return null;
    },

    /**
     * Turn the path into floor and wall it in. A carved region wall stops being
     * one; void region cells beside the passage become walls, so it doesn't open
     * onto nothing. Neighbours outside any region are authored and left alone.
     */
    _connectCarve(path, wallKeys) {
        const carvedKeys = new Set(path.cells.map(c => `${c.x},${c.y}`));
        // New walls match the region's own, so a metal-walled region stays metal.
        const wallTypeNear = (x, y) => {
            for (const [dx, dy] of DIRS8) {
                const w = this.pendingWallSpawns.find(p => p.x === x + dx && p.y === y + dy);
                if (w?.type) return w.type;
            }
            return 'wall';
        };

        this.pendingWallSpawns = this.pendingWallSpawns.filter(p => !carvedKeys.has(`${p.x},${p.y}`));
        for (const key of carvedKeys) wallKeys.delete(key);

        for (const { x, y } of path.cells) {
            this.floorMap[y][x] = this._floorTile();
            this.backgroundMap[y][x] = null;
            this.walkableTiles.push({ x, y });
        }

        for (const { x, y } of path.cells) {
            for (const [dx, dy] of DIRS8) {
                const nx = x + dx, ny = y + dy;
                const key = `${nx},${ny}`;
                if (carvedKeys.has(key) || wallKeys.has(key)) continue;
                if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
                if (!REGION_TYPES.has(this.wildcardMap[ny][nx]?.type)) continue;
                if (this.floorMap[ny][nx]) continue;
                this.floorMap[ny][nx] = this._floorTile();
                this.backgroundMap[ny][nx] = null;
                this.pendingWallSpawns.push({ x: nx, y: ny, type: wallTypeNear(nx, ny) });
                wallKeys.add(key);
            }
        }
    },

    /**
     * Roll for a door on the passage cell where it meets the floor it joins:
     * the end beside authored floor if there is one, else the end it landed on.
     * Only placed where the cell is a doorway, open on two opposite sides and
     * closed on the other two, so a door never stands in the middle of a room.
     */
    _connectMaybeDoor(path, isOpen, isRegionCell, doorChance) {
        if (doorChance <= 0 || ROT.RNG.getPercentage() > doorChance) return;

        const first = path.cells[0];
        const last = path.cells[path.cells.length - 1];
        const touchesAuthored = (c, side) => !isRegionCell(side.x, side.y) &&
            Math.abs(c.x - side.x) + Math.abs(c.y - side.y) === 1;
        const spot = touchesAuthored(first, path.from) ? first
            : touchesAuthored(last, path.to) ? last
            : last;

        const open = (dx, dy) => isOpen(spot.x + dx, spot.y + dy);
        const horizontal = open(-1, 0) && open(1, 0) && !open(0, -1) && !open(0, 1);
        const vertical = open(0, -1) && open(0, 1) && !open(-1, 0) && !open(1, 0);
        if (!horizontal && !vertical) return;

        this.pendingDoorSpawns.push({ x: spot.x, y: spot.y });
    },
};
