# Biomes

## About Biomes

A biome is a theme for a range of floors in a multi-floor prototype. It bundles the monsters, items, hazards, decorations, map generator and mechanics for those floors. Instead of writing spawn lists for floor 1, floor 2, floor 3 and so on, you describe the theme once and give each monster or item a range of floors where it can appear. As the player goes deeper, things fade in and out of their ranges and the mix shifts on its own. The idea comes from Brogue's depth tables.

## Where Biomes Live

Biomes are data files, like `actors.json` and `items.json`. The default library is `data/biomes.json`. A prototype can add its own `prototypes/<name>/biomes.json`, which adds new biomes or replaces default ones with the same name. A replaced biome is replaced completely, so each definition has to stand on its own. Biomes can't be defined inside `prototype.json`; a `biomes` block there is thrown away at load.

Biomes are written with the Biome Editor (`editors/biome-editor.html`). The prototype editor only assigns them to floors, in its Biome plan section. That section shows up for prototypes with more than one floor, and you can switch it off to go back to plain floor overrides.

## Assigning Biomes to Floors

`prototype.json` needs a total floor count and a `floor_plan`:

```json
{
  "floors": 26,
  "floor_plan": [
    { "biome": "caves",    "floors": "1-8"   },
    { "biome": "depths",   "floors": "9-19"  },
    { "biome": "infernal", "floors": "20-26" }
  ]
}
```

Each entry claims a range of floors, counting from 1 and including both ends. A range can be written as `"1-8"`, a single number, or `[1, 8]`. Ranges should cover every floor without gaps or overlaps. The prototype editor warns about both, but the engine doesn't: if two ranges overlap, the first one listed wins. A floor with no biome, or one naming a biome that doesn't exist, uses the prototype's floor overrides and top-level settings instead. Unknown biome names log a warning at load.

## Biome Fields

The `caves` biome from `data/biomes.json`, shortened:

```json
"caves": {
  "map_generator": { "type": "dungeon", "options": { "map_width": 100, "map_height": 100 } },
  "mechanics": { "treasure_room": 30 },
  "actors": [
    { "id": "rat", "min": 1, "max": 6, "freq": 120, "count": [1, 10] },
    { "id": "bat", "min": 1, "max": 6, "freq": 100, "count": [1, 3] }
  ],
  "actor_budget": { "base": 3, "extra_chance": 60, "max_extra": 3 },
  "items": [
    { "type": "potion", "min": 2, "max": 26, "freq": 50 },
    { "type": "scroll", "min": 2, "max": 26, "freq": 40 }
  ],
  "item_budget": { "base": 2, "extra_chance": 40, "max_extra": 3 },
  "traps": { "min_depth": 2, "intercept": 0, "slope": 2.5, "max": 30 },
  "fungus": { "min_depth": 2, "intercept": 1, "slope": 1, "max": 9, "tall_chance": 0.25 },
  "decorations": [
    { "entity": "moss", "pattern": "near_liquid", "density": 0.25, "min": 1, "max": 8, "freq": 60 }
  ]
}
```

`actors` and `items` are the spawn lists, described below, and `actor_budget` and `item_budget` set how many things are picked from them each floor. `traps` and `fungus` grow in number with depth. `decorations` scatters floor dressing. `map_generator` and `default_floor` (not used by caves) work as they do at the top of a prototype (see [PROTOTYPE.md](PROTOTYPE.md) and [MAP.md](MAP.md)) and apply to every floor in the biome. `mechanics` holds flags like `darkness` or `treasure_room`.

`win_conditions` and `switch_puzzles` are not biome fields. They belong to single floors, so set them in a floor override.

## Spawn Lists

Each row in `actors` names an actor `id`. Each row in `items` names an item `type` such as `potion` or `weapon`, not a specific item (see Item Types below).

```json
{ "id": "goblin", "min": 3, "max": 10, "freq": 100 }
{ "id": "oculus", "min": 2, "max": 2, "freq": 100, "count": [1, 4] }
```

`min` and `max` are the first and last floors the row can appear on (defaults 1 and no limit). Setting both to the same number pins a row to a single floor, which is a good way to place a set piece. `freq` is the row's weight against the other rows available on that floor (default 1, though the editor starts new rows at 100). It's relative, not a percentage. `count` is how many spawn each time the row is picked (default `[1, 1]`).

On each floor the engine keeps only the rows whose range includes that floor, then makes a number of weighted picks set by the budget. If the same row is picked twice its counts add up, so a row with `count` `[1, 2]` picked twice spawns 2 to 4.

## Budgets

A budget is a number of guaranteed picks (`base`) plus `max_extra` bonus rolls that each succeed `extra_chance` percent of the time.

```json
"actor_budget": { "base": 3, "extra_chance": 60, "max_extra": 3 }
```

This gives 3 to 6 picks per floor. All three numbers default to 0, so a biome with `actors` but no `actor_budget` spawns no monsters at all.

`item_budget` does a second job. Besides setting the picks from the biome's `items` list, it also sets how many extra items drop from the prototype's `item_catalog` (see [Item Budget](PROTOTYPE.md#item-budget)). Those extra drops follow the catalog's weights, not the biome's rows. If a biome has no `item_budget`, the extra drops use the prototype's own `item_budget`.

## Traps and Fungus

`traps` and `fungus` use a formula that grows with depth. The count on floor `d` is `intercept + d * slope`, rounded and kept between 0 and `max`, with nothing at all on floors shallower than `min_depth`.

```json
"traps": { "min_depth": 2, "intercept": 0, "slope": 2.5, "max": 30 }
```

With these numbers, floor 1 has no traps, floor 2 has 4 or 5, floor 5 has 12 or 13, floor 8 has 19 or 20, and from floor 12 on it stays at 29 or 30. The result is always one of two neighboring numbers so that floors next to each other aren't identical.

For `fungus` the count is the number of patches. Patches hold 1 to 4 fungi each unless `cluster` is set to `false`, which places single fungi instead. `tall_chance` (0 to 1) is the chance each one is a tall fungus.

## Decorations

Decorations are floor dressing scattered when a floor is built, like moss by water, rubble along walls, or a skull in an empty room. They never block movement. If a decoration has a `walk_description`, the player sees it when they step on it.

```json
"decorations": [
  { "entity": "moss",   "pattern": "near_liquid",  "density": 0.25, "min": 1, "max": 8, "freq": 60 },
  { "entity": "rubble", "pattern": "wall_hugging", "density": 0.08, "min": 0, "max": 20 },
  { "entity": "skull",  "pattern": "room_floor",   "density": 0.01, "min": 0, "max": 3, "freq": 25 },
  { "actor":  "grave",  "pattern": "room_floor",   "density": 0.004, "min": 0, "max": 2, "freq": 35 }
]
```

A row names either an `entity` from `data/entities.json`, for plain scenery, or an `actor` from `data/actors.json`, for dressing that does something, like a grave you can dig up. Actors used as decorations have to be `solid: false`. A solid actor or an unknown name is skipped with a warning.

`pattern` chooses where it can land (default `scatter`):

| Pattern | Lands on |
| --------- | ---------- |
| `scatter` | Any walkable tile |
| `clusters` | Any walkable tile, in patches instead of spread evenly |
| `wall_hugging` | Tiles next to a wall, including diagonally |
| `near_liquid` | Tiles next to water, sewage or lava |
| `room_floor` | Open room floor, never corridors |

`wall_hugging` counts anything solid as a wall, so a monster standing nearby counts too. An unknown pattern warns and falls back to `scatter`.

`density` is the fraction of matching tiles to fill (default 0.1). `min` and `max` then clamp that number. In a decoration row, `min` and `max` are counts, not floors, which is the opposite of the spawn lists. The editor labels them "count" for that reason. So with `density` 0.25, `min` 1 and `max` 8, a floor with 12 tiles beside water gets 3 moss, and a floor with 200 gets 8. `max` defaults to `min`, and `min` defaults to 0, so a row needs a `max` above 0 to place anything. It also never places more than there are matching tiles.

`freq` is the percent chance the row is used on a given floor (default 100). Decoration rows have no floor range of their own, so use `freq`, or give the biome a narrower range in `floor_plan`. `region` limits a row to a named area such as `largest_room`, `sanctum`, `portico` or `treasure_room`. If the map doesn't have that region, the row warns and uses the whole map.

Decorations are placed after the monsters, items, stairs and player, so they never sit under a monster or in a doorway, and two never share a tile. Unlike spawn lists they don't go through a budget, so a row asking for 1 to 8 moss gets 1 to 8 moss. They're saved with the floor, so going back to a level shows the same layout.

## Precedence

Every floor's settings come from three layers. A floor override in `levels` wins over the biome, and the biome wins over the top of `prototype.json`.

`mechanics` is merged across the layers, so a biome can turn on `treasure_room` and still keep the prototype's `darkness`. Everything else is replaced whole. A floor override that wants the biome's decorations plus one more has to repeat the whole list. A biome's `map_generator` replaces the prototype's, with one exception: if it leaves out `options`, the prototype's `options` are used.

A few mechanics are only read from the top of `prototype.json` and are ignored in a biome or floor override: `fog_of_war`, `observer_mode` and `beacon_range`.

## Item Types

Rows in a biome's `items` list name item types, such as `potion`, `scroll`, `weapon` or `armor`. When the prototype has an `item_catalog` that includes that type, the catalog decides which items are possible. When it doesn't, the row picks from every item of that type, so a biome can spawn items the prototype's catalog was meant to leave out. Only `dungeon` and `sewer` have an `item_catalog` at the moment.

The engine warns at load when a biome uses a type the prototype's catalog doesn't include, and the prototype editor shows the same warning in its Biome plan section. The warning checks every biome in the library, not just the ones the prototype uses. Common types travel best between prototypes.

Actor ids work the same way. An id that only exists in one prototype's `actors.json` won't be found anywhere else, which is why the Biome Editor only offers ids from `data/actors.json`.

## Notes for Implementers

The biome code is in `engine/dungeon-engine/floors.js`. `getFloorConfig` builds a floor's settings, and `resolveBiome` turns the floor's biome into spawn lists. The merged library is stored on `config.biomes` by `Prototype.loadAssets()` before the first floor loads. It's read by `resolveBiome`, `getFloorActorPool` and `warnUnsatisfiedBiomeCategories` in `engine/prototype.js`.

`resolveBiome` uses the random number generator for its budget rolls and weighted picks, so every call gives a different result. `getFloorConfig` runs several times while a floor loads and again during play, for things like stairs, mechanics lookups and `summon_monsters`. Don't cache a resolved biome and expect it to match what spawned.

Apart from the biome name and item type warnings at load, nothing checks `prototype.json`. A misspelled key is ignored, and a range the engine can't read means that floor has no biome. The editors do the checking.

## See Also

[PROTOTYPE.md](PROTOTYPE.md) covers prototype fields, floor overrides and `item_catalog`. [MAP.md](MAP.md) covers map generators and their options.
