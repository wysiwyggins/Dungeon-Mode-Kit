let tiles = [];
let tileMap = [];
let spritesheet;
let spritesheetData;
let baseColor;
let colors = [];
let sounds = [];
// Function to convert x, y coordinates to an index
function xyToIndex(x, y) {
  return y * 23 + x;
}

// Detect if running locally or on production
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BASE_PATH = isLocal ? '.' : '/dungeonkit';

const globalVars = {
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
  MAX_TILES: 65 * 60, // CANVAS_COLS * CANVAS_ROWS

  // ---------------------------------------------------------------------------
  // Void background tiles
  //
  // The bottomless-pit look: an abyss cell has one of these on the background
  // layer and NOTHING on the floor layer. Change VOID_FILL / VOID_SHADE /
  // VOID_DIAGONAL to restyle every abyss in the game from one place.
  //
  // Opaque variants are the default because a transparent glyph has no pixels
  // for the lighting pass to tint, so ambient_light could never reach the
  // background layer (see LightingManager.getBackgroundTint).
  //
  // VOID_TILE_IDS is the recognition set and must stay a SUPERSET of the three
  // paint values above. Hand-authored Tiled maps embed these numbers literally
  // — prototypes/dungeon/map.tmj uses the opaque family, every other map ships
  // the transparent one — so both families have to keep reading as "void"
  // no matter which the paint constants point at. Recognition and painting are
  // deliberately separate concerns: narrowing this set to just the current
  // paint values would make existing maps stop registering as abyss.
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
};

// Attach to window
window.myAppGlobals = globalVars;