// Shared constants: asset paths, tile/canvas dimensions and tile ids used across the engine.

// Detect if running locally or on production
// (globalThis.location is absent in Node, where the tools/ scripts load the Architect.)
const hostname = globalThis.location?.hostname;
const isLocal = !hostname || hostname === 'localhost' || hostname === '127.0.0.1';
const BASE_PATH = isLocal ? '.' : '/dungeonkit';

export const globalVars = {
  BASE_PATH: BASE_PATH,
  SPRITESHEET_PATH: `${BASE_PATH}/assets/sprites/static-tiles.png`,
  SPRITE_DATA_PATH: `${BASE_PATH}/data/sprites/static-tiles.json`,
  TILE_WIDTH: 40,
  TILE_HEIGHT: 30,
  TILE_HALF_WIDTH: 20,
  TILE_HALF_HEIGHT: 15,
  CANVAS_COLS: 65,
  CANVAS_ROWS: 60,
  SPRITESHEET_COLS: 23,
  SPRITESHEET_ROWS: 12,

  // ---------------------------------------------------------------------------
  // Void background tiles
  // ---------------------------------------------------------------------------
  VOID_FILL: 231,      // OPAQUE_FULL_BLOCK — flat void
  VOID_SHADE: 207,     // OPAQUE_DARK_SHADE — shadow body under a cliff lip
  VOID_DIAGONAL: 372,  // OPAQUE_BLACK_LOWER_LEFT_TRIANGLE_WITH_DARK_SHADE_UPPER_RIGHT_TRIANGLE
  VOID_TILE_IDS: [
    217, 178, 128,     // transparent family: FULL_BLOCK, DARK_SHADE, diagonal
    231, 207, 372      // opaque family
  ],
  // The flat fills only, both families. A tile from this list sitting on the
  // FLOOR layer means void rather than walkable floor; the shade/diagonal values
  // are background art and never appear on the floor layer.
  VOID_FLOOR_FILLS: [217, 231], // FULL_BLOCK, OPAQUE_FULL_BLOCK

  // Blob actors nothing may spawn on top of: they damage what stands there, or
  // they swallow it. Generation has to know this before any actor exists — it
  // runs before the spawn context — so it can't be read off the actor the way
  // most attribute checks are. Mirrors `damage_type` or `deep` in actors.json;
  // add an id here when adding a liquid with either.
  HAZARD_BLOB_ACTORS: ['lava', 'fire', 'quicksand', 'deep_water', 'deep_sewage'],

  // Detect magic: the EVIL_EYE marker's tint for each polarity (Item.getMagicPolarity),
  // shared by the inventory icon and the map marker.
  MAGIC_POLARITY_TILE: 'EVIL_EYE',
  MAGIC_POLARITY_TINTS: { good: 0x3D7DFF, bad: 0xE03030 },
};
