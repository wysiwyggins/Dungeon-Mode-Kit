# Tile Patterns

This is a document for me (the developer) rather than designers. The method is
still ahead of its uses, in preparation for future things like a visual editor.

`MapManager.applyTilePattern(layerName, rules, options)` lives in `architect/architect.js`. It walks every cell of a layer (or a sub-rectangle of it), tries your rules in order, and paints the first one that matches. `addBaseAndShadows` (the diagonal cliff shading on abyss edges) is the worked example at the bottom of this doc.

### Who calls this

| Caller | Layer | Mode |
| -------- | ------- | ------ |
| `addBaseAndShadows` | `background` | paint — the 45° cliff shading |
| `generateCollapsingFloors` | `floor` | collect — floor tiles on an abyss lip |
| `generateAbyssAt` | `wildcards` | collect (`'set'`) — the region mask for blob placement |
| `generatePalladianAt` | `wildcards` | collect (`'set'`) — same, for a villa footprint |

### What this is *not*

Tile patterns write **tiles**. Placing entities — the biome `decorations` feature —
is not a tile pattern and deliberately does not go through this method: decorations
place Entities rather than tiles, their placement rules read *actor* positions
(walls, liquids) which are not a tile layer, they need a global count budget, and
they need a per-cell RNG roll (which would make rule *order* silently change map
output for a given seed). That lives in `EntityManager.placeBiomeDecorations`
(`engine/entity-manager/spawning.js`) as a candidate-set → filter → sample pass. See [BIOMES.md](BIOMES.md).

This doc explains what a rule is, when it fires, what it can read, what it can write, and in what order cells are visited.

---

## What a tile pattern is

A pattern is an **ordered list of rules**. Each rule is a pair: a test (`when`) and something to paint (`paint`).

Because the whole grid is swept with the same rule list, a rule that looks at its neighbours can make a pattern *propagate*: a cell painted early in the sweep becomes input for a cell visited later.

---

## `applyTilePattern(layerName, rules, options)`

```js
const written = mapManager.applyTilePattern('background', rules, { passes: 1 });
```

| Parameter | Type | Description |
| ----------- | ------ | ------------- |
| `layerName` | string | Which layer to read and write. See the table below. |
| `rules` | array | Ordered list of `{ when, paint }`. First match wins. |
| `options` | object | Optional. `passes`, `order` and `bounds` — see [Scan model](#scan-model); `collect` — see [Collect mode](#collect-mode). |

**Returns** the number of tiles **written** — not the number of cells changed — *unless* you pass `collect`, in which case it returns the cells instead. See [Collect mode](#collect-mode). Repainting the same cell on three passes counts as three. Writes made through `tileContext.paint()` are included in the count.

```js
// 2 cells, 3 passes, a rule that always matches
mapManager.applyTilePattern('background', [{ when: () => true, paint: 7 }], { passes: 3 });
// → 6
```

### Layer names

A pattern can address any of the four tile layers. The names are the same ones you
use in Tiled, so what a designer draws and what a pattern paints line up:

| Name | Holds |
| ------ | ------- |
| `background` | Void and decoration behind everything |
| `floor` | Walkable terrain |
| `wildcards` | Procedural generation markers |
| `overlay` | Tiles drawn above the rest |

See [MAP.md](MAP.md) for what each layer is for on the Tiled side.

There is no `wall` layer. Walls are actors, not tiles — a generator queues them as
pending spawns and the engine instantiates them, so there are no wall tiles for a
pattern to read or write. To reason about walls in a rule, test the `floor` layer
for the absence of walkable terrain rather than looking for a wall tile.

An unrecognised layer name logs a warning and returns `0` without painting anything.
There is no thrown error, so a tool that gets the name wrong will look like it ran
and did nothing:

```js
mapManager.applyTilePattern('walls', rules);  // → 0, nothing painted
```

---

## The rule contract

A rule is a plain object with two keys:

```js
{
    when:  (tileContext, x, y) => boolean,
    paint: tileId | ((tileContext, x, y) => tileId | null)
}
```

**`when`** decides whether this rule claims the cell. Return anything truthy to claim it. A rule missing `when`, or whose `when` is not a function, is skipped entirely.

**`paint`** is either a tile id to write, or a function returning one:

| `paint` is | Effect |
| ------------ | -------- |
| a number | Write that tile id at `(x, y)` |
| a function returning a number | Write the returned tile id at `(x, y)` |
| a function returning `null` | Write nothing here — but the cell is still claimed |

### Matching is what ends the cell

The cell stops at the first rule whose **`when`** returns true. This has nothing to do with what `paint` returns. A rule that matches and then paints `null` has still consumed the cell, and no later rule will be tried:

```js
mapManager.applyTilePattern('background', [
    { when: () => true, paint: () => null },     // matches, writes nothing
    { when: () => true, paint: () => 99 }        // never runs
]);
// the cell keeps its original value
```

This is the mechanism behind a **veto rule** — one that exists purely to protect certain cells from the rules below it. Put it first, match the cells you want to shield, and paint `null`.

### A rule cannot erase a tile

Returning `null` means "don't write", not "clear this cell". The underlying `setTile` *does* clear a cell when handed `null`, but the driver skips `null` returns before it gets there, so that path is unreachable from a rule. If you need a cell emptied, do it outside the pattern.

---

## `tileContext`

Every callback receives the same `tileContext` object. It is built once per `applyTilePattern` call and shared by all rules, cells and passes.

| Member | Signature | Returns |
| -------- | ----------- | --------- |
| `get` | `(x, y)` | Tile id on the target layer |
| `is` | `(x, y, value)` | Whether the target layer matches `value` |
| `on` | `(layer, x, y)` | Tile id on any other layer |
| `isOn` | `(layer, x, y, value)` | Whether another layer matches `value` |
| `inBounds` | `(x, y)` | Whether the coordinate is on the map |
| `paint` | `(x, y, tileId)` | Writes immediately; no return |
| `count4` | `(pred, x, y)` | How many of the 4 cardinal neighbours satisfy `pred` (0–4) |
| `count8` | `(pred, x, y)` | How many of the 8 neighbours satisfy `pred` (0–8) |
| `any4` | `(pred, x, y)` | Whether any cardinal neighbour satisfies `pred` |
| `any8` | `(pred, x, y)` | Whether any of the 8 neighbours satisfies `pred` |
| `width` | number | Map width in tiles |
| `height` | number | Map height in tiles |

### Neighbour tests take a predicate

`pred` has the signature `(tileContext, x, y) => boolean` — **the same shape as a
rule's `when`**. A helper written for one works as the other with no adapter:

```js
const hasFloor = (ctx, x, y) => ctx.on('floor', x, y) !== null;

{ when: (ctx, x, y) => ctx.any8(hasFloor, x, y), paint: 231 }   // touches floor
{ when: (ctx, x, y) => ctx.count4(hasFloor, x, y) >= 3, paint: 158 }  // room interior
```

Predicate-taking rather than value-taking is deliberate: real rules need compound
tests ("is void **and** has no floor"), and a plain value test is still short —
`ctx.count8((c, nx, ny) => c.is(nx, ny, 158), x, y)`.

Off-map neighbours are still passed to `pred`, where `get`/`on` return `null` for
them, so they normally test false. A predicate that needs a different edge policy
should check `ctx.inBounds` itself.

> `architect/architect.js` also has module-scope `anyNeighbor8(pred, x, y)` and
> `countNeighbors8(pred, x, y)` for generator code that isn't inside a tile pattern.
> **Those take a plain `(x, y)` predicate**, not `(ctx, x, y)` — the generators that
> use them already have `(x, y)` closures in hand. Don't mix the two signatures up.

### Empty and off-map both read as `null`

`get` and `on` return `null` for an empty cell *and* for a coordinate outside the map. They do not distinguish the two — use `inBounds` when the difference matters. Reading out of bounds is safe and never throws, so edge cells need no special handling.

### `is` and `isOn` accept a set

Pass an array instead of a single value and the test becomes membership:

```js
ctx.is(x, y, 158)            // exactly tile 158
ctx.is(x, y, [10, 20, 30])   // any one of these three
```

This is the natural way to express "any floor-ish tile" or a domain of permitted tiles.

### `paint` writes now, not at the end

`tileContext.paint(x, y, tileId)` writes straight through to the layer, and can target **any** cell, not just the one being visited. It is the escape hatch for a rule that needs to fill a whole run at once. A rule that paints this way should return `null` so the driver doesn't also write the origin cell.

Cells you paint ahead of the cursor are still visited later by the sweep, so make sure your `when` will reject them by then — otherwise they get processed twice.

---

## Scan model

### Order

The default (`order: 'rows'`) visits cells left-to-right, top-to-bottom. `order: 'reverse'` runs the exact inverse — both axes flip, ending at `(0, 0)`:

```text
rows:     0,0  1,0  2,0  0,1  1,1  2,1
reverse:  2,1  1,1  0,1  2,0  1,0  0,0
```

**Order is load-bearing.** A rule that reads the cell above-left of itself is reading a cell the same pass already finished. That is exactly how `addBaseAndShadows` grows a diagonal, and it is why running it in reverse would produce nothing.

### Passes

`passes: N` sweeps the whole grid N times with the same rule list. Later passes see everything earlier passes wrote. Useful when a shape needs to grow further than one cell per sweep.

> `passes` and `order: 'reverse'` both work, but nothing in the kit currently uses them — `addBaseAndShadows` is a single forward pass. Treat them as functional but unexercised.

### Bounds

`bounds: { x1, y1, x2, y2 }` (inclusive, clamped to the map) restricts the sweep to
a sub-rectangle. Omitted, it is the whole map — so a caller that passes no options
iterates exactly as it always did.

```js
// only the interior, never the outer ring
mapManager.applyTilePattern('floor', rules,
    { bounds: { x1: 1, y1: 1, x2: mapManager.width - 2, y2: mapManager.height - 2 } });
```

**Bounds restricts *visiting*, not *reading*.** Rules may still read any cell on the
map, and `ctx.paint` may still write anywhere — `paint` is documented below as a
free escape hatch, and boxing it in would break that.

This is what lets a region generator stop doing `worldX = startX + x` arithmetic
with a hand-written edge check on every cell. An inverted or fully off-map box
visits nothing, logs a warning, and returns the empty result for the mode you asked
for.

### Rules read the layer they write

There is no double-buffering. Within a single pass, a rule reading `(x-1, y)` sees the new value if that cell was already visited, and the old value if it hasn't been reached yet.

This is the feature that makes propagation possible, and it is also the main way patterns go wrong. If your rule can match the tiles your own pattern paints, it will re-consume its own output. The fix is to keep two separate sets of tile ids — the ones you **recognise** as input, and the ones you **paint** — and exclude the paint values from the recognition test. `addBaseAndShadows` does this in `isUnpaintedVoid`.

---

## Collect mode

Sometimes you want the sweep to *find* cells rather than paint them — "every floor
tile on the lip of an abyss", "every cell this wildcard region claims". `collect`
makes the driver hand those back.

```js
const edges = mapManager.applyTilePattern('floor', [{ when: isAbyssEdge, paint: null }],
                                          { collect: true });
```

| `options.collect` | Return value |
| ------------------- | -------------- |
| absent / falsy | `number` — cells painted. **Unchanged.** |
| `true` | `Array<{x, y}>` |
| `'set'` | `Set<string>` of `"x,y"` keys |

`'set'` exists because a mask handed to `generateOverlayBlobs` wants exactly that
shape, and building an array to convert and discard it over a 100×100 map is waste
the driver can avoid with one `if`.

**Collect is additive, not a mode switch.** Rules are still tried in order, first
match still wins, and a `paint` that returns a tile id **still writes**. A rule can
both record a cell and paint it.

A cell is collected when a rule claims it, unless that rule sets `collect: false` —
the opt-out for a veto rule that exists only to shield cells from the rules below:

```js
mapManager.applyTilePattern('floor', [
    { when: isProtected, paint: null, collect: false },  // claims, records nothing
    { when: isCandidate, paint: null }                   // recorded
], { collect: true });
```

The `painted` counter still increments in collect mode; it just isn't what comes
back. With `passes > 1`, array mode can return the same cell more than once —
`'set'` is the dedup answer.

## Worked example: `addBaseAndShadows`

This is the pattern that gives every abyss its hard 45° drop shadow. It runs on the `background` layer with default options — one forward pass — and is built from three rules.

Three shared helpers set up the vocabulary first:

```js
const SHADE = globalVars.VOID_SHADE;         // 207 — the shadow body
const DIAGONAL = globalVars.VOID_DIAGONAL;   // 372 — the 45° edge glyph

// Flat void on the FLOOR layer means void, not walkable floor.
const hasFloor = (tileContext, x, y) => {
    const t = tileContext.on('floor', x, y);
    return t !== null && !globalVars.VOID_FLOOR_FILLS.includes(t);
};

// Void this pass hasn't painted over yet. Excluding the paint values is what
// stops the automaton re-reading its own output as fresh input.
const isUnpaintedVoid = (tileContext, x, y) => {
    const bg = tileContext.get(x, y);
    if (bg === null || bg === SHADE || bg === DIAGONAL) return false;
    return globalVars.VOID_TILE_IDS.includes(bg);
};

const eligible = (tileContext, x, y) =>
    isUnpaintedVoid(tileContext, x, y) && !hasFloor(tileContext, x, y);
```

`isUnpaintedVoid` is the recognition/paint split described above: `VOID_TILE_IDS` is the set of tiles that *count as* void, and the two values this pattern paints are explicitly excluded from it. Without those two exclusions the rules would keep matching their own output.

**Rule 1 — start a diagonal** where floor sits directly above void, at the corner where the drop begins:

```js
{
    when: (tileContext, x, y) => eligible(tileContext, x, y) &&
        hasFloor(tileContext, x, y - 1) &&
        (hasFloor(tileContext, x - 1, y) || !hasFloor(tileContext, x - 1, y - 1)),
    paint: DIAGONAL
}
```

**Rule 2 — continue it down-right.** This is the propagating rule: it reads the diagonal rule 1 wrote up-left of here, plus shade already laid down directly above. Both are cells the same pass has already visited.

```js
{
    when: (tileContext, x, y) => eligible(tileContext, x, y) &&
        tileContext.is(x - 1, y - 1, DIAGONAL) &&
        tileContext.is(x, y - 1, SHADE),
    paint: DIAGONAL
}
```

**Rule 3 — flood the shadow body** rightward from a diagonal edge, for as long as the run stays void, floorless and sheltered from above:

```js
{
    when: (tileContext, x, y) => eligible(tileContext, x, y) &&
        tileContext.is(x - 1, y, DIAGONAL) &&
        (hasFloor(tileContext, x, y - 1) || tileContext.is(x, y - 1, SHADE)),
    paint: (tileContext, x, y) => {
        for (let xPos = x; xPos < tileContext.width; xPos++) {
            if (!eligible(tileContext, xPos, y)) break;
            if (!hasFloor(tileContext, xPos, y - 1) && !tileContext.is(xPos, y - 1, SHADE)) break;
            tileContext.paint(xPos, y, SHADE);
        }
        return null;
    }
}
```

Rule 3 paints a whole horizontal run itself rather than one cell, so it uses `tileContext.paint` — and it returns `null` so the driver doesn't write the origin cell a second time. The cells it painted ahead of the cursor are still visited later, but by then `eligible` rejects them, because `isUnpaintedVoid` excludes `SHADE`.

The whole pattern is **idempotent** for the same reason: running it over already-shaded background matches nothing. It is called on both the generation path (`loadFloor` in `engine/dungeon-engine/floors.js`, after the map is built) and the save-restore path, and running twice is harmless.

---

## Authoring rules from data

`when` and `paint` are functions, but nothing requires a *human* to write them. A rule editor, a config file or a constraint solver can emit a plain-data description and compile it into the shape the driver expects.

A small declarative spec — a tile to match under the cursor, plus neighbour constraints:

```js
function compileRule(spec) {
    const { match = {}, paint } = spec;
    return {
        when: (ctx, x, y) => {
            if (match.self !== undefined && !ctx.is(x, y, match.self)) return false;
            for (const n of match.neighbors || []) {
                const hit = n.layer
                    ? ctx.isOn(n.layer, x + n.dx, y + n.dy, n.is)
                    : ctx.is(x + n.dx, y + n.dy, n.is);
                if (hit === Boolean(n.negate)) return false;
            }
            return true;
        },
        paint
    };
}
```

The spec itself is pure JSON — serialisable, diffable, and editable in a UI:

```js
// "an empty cell with floor tile 158 directly above it → paint shade 207"
const CLIFF_LIP = {
    match: {
        self: null,
        neighbors: [{ dx: 0, dy: -1, is: 158 }]
    },
    paint: 207
};

mapManager.applyTilePattern('background', [compileRule(CLIFF_LIP)]);
```

Because `is` and `isOn` accept arrays, a neighbour constraint can name a **set** of acceptable tiles rather than one — which is the primitive a WFC-style adjacency table needs:

```js
{ dx: -1, dy: 0, is: [158, 159, 160] }   // any of three floors to the west
{ dx: 0, dy: 1, is: 231, negate: true }  // anything except void below
```

### What the API does not give you

A frontend has to supply four things itself:

- **Numeric tile ids.** `MapManager` has no access to the sprite library, so rules cannot resolve tile *names*. Convert names to ids before building rules — the formula is `tileId = row * 23 + col + 1` against the `[col, row]` table in `data/static-tiles.json`. See [TILED_KEY.md](TILED_KEY.md).
- **The recognition/paint split.** Nothing stops a generated rule from matching the tiles it paints. A tool that emits multiple rules over one layer needs to track which ids are output and keep them out of the input tests.
- **Rule ordering.** First-match-wins means priority is just list position. A UI that lets rules be reordered is editing their precedence.
- **Neighbour-completeness.** The driver visits cells in a fixed sweep; it does not backtrack, retry, or resolve contradictions. True constraint propagation has to happen in your own solver, with `applyTilePattern` used to render the result.

---

## Gotchas

- **A pattern can eat its own output.** Keep the recognition set and the paint set disjoint. This is the single most common way a rule list misbehaves.
- **Order dependence is invisible.** A pattern that relies on the forward sweep breaks silently under `order: 'reverse'`. Nothing warns you.
- **Painting replaces the whole cell.** `setTile` writes a fresh cell object, so any `flipH` / `flipV` / `flipD` flags a Tiled map set on that tile are discarded when a pattern paints over it.
- **A wrong layer name is a silent no-op** — it returns `0` and logs a warning, but nothing fails. There are only four: `background`, `floor`, `wildcards`, `overlay`.
- **The return value counts writes, not cells.** Don't read it as "cells changed".
- **The return *type* depends on `options.collect`** — a number normally, an array or a `Set` when collecting. Only reachable by opting in.
- **`bounds` restricts visiting, not reading or `ctx.paint`.** A rule can still read and paint outside the box.
- **Ids, not names.** Rules deal in numbers; there is no name lookup inside `MapManager`.
- **One name in `data/static-tiles.json` has a stray space** — `OPAQUE_BLACK_LOWER_LEFT_TRIANGLE_WITH_DARK_SHADE_UPPER_RIGHT _TRIANGLE`. Nothing is broken today because `globals.js` hardcodes the id (`372`), but a `getTileIdByName` lookup using the sensible spelling returns `null`.

---

See also: [MAP.md](MAP.md) (Tiled layers and the void tiles), [TILED_KEY.md](TILED_KEY.md) (tile id formula, the name→coordinate table), [BRIDGES.md](BRIDGES.md) (how bridge cells interact with `addBaseAndShadows`), [DUNGEON_MODE_KIT_DESIGN.md](DUNGEON_MODE_KIT_DESIGN.md) (where tile patterns sit in the architecture).
