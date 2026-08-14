# Lighting System

The lighting system uses ROT.js shadowcasting to create dynamic light and darkness with colored light sources.

## Overview

When `darkness: true` is set in a prototype's mechanics config, the lighting system activates:

```json
{
  "mechanics": {
    "darkness": true,
    "fog_of_war": true,
    "ambient_light": 0.0,
    "player_light_radius": 6
  }
}
```

## Architecture

### LightingManager

Handles light computation using `ROT.FOV.PreciseShadowcasting`.

**Light Map Structure:**
Each tile stores:
- `intensity` (0-1): Overall brightness
- `r`, `g`, `b` (0-255): Accumulated color from light sources

**Light Sources:**
- Actors with `light_source` attribute emit light
- Player-controlled actors emit white light (radius from config)
- Each source contributes its tint color to illuminated tiles

**Light Blocking:**
- Wall tiles block light
- Actors with `solid` attribute block light
- Light sources don't block their own light (tracked via `currentSource`)

### Render Layers

The rendering system uses multiple layers (bottom to top):

1. **backgroundContainer** (z=0) - Wall tiles, shadows
2. **floorContainer** (z=1) - Floor tiles
3. **entityContainer** (z=2) - Actors and items
4. **overlayContainer** (z=3) - Visual effects overlays
5. **lightColorContainer** (z=4) - Colored light overlay
6. **darknessContainer** (z=5) - Darkness/shadow overlay
7. **uiContainer** (z=6) - UI elements (inventory, menus)
8. **splashContainer** (z=7) - Full-screen splash effects

### Darkness Overlay

Uses two textures:
- **solidDarkTexture**: Pure black for fully dark areas
- **darkTexture**: FULL_BLOCK tile (textured) for gradations, randomly flipped to avoid visual repetition

### Light Color Overlay

A white texture with `PIXI.BLEND_MODES.MULTIPLY` blend mode. When tinted with a light color and made semi-transparent, it shifts the colors of everything beneath it toward the light's hue.

## How Light Color Works

1. **Color Accumulation**: Each light source's RGB values are extracted from its tint and weighted by intensity at each tile

2. **Color Normalization**: The accumulated color is normalized so the brightest channel reaches 255, preserving hue

3. **Multiply Blend**: The light color layer uses multiply blending - a white overlay has no effect, but an orange overlay (high R, medium G, low B) darkens blues and greens while preserving reds/oranges

4. **Entity Tinting**: Actors and items have their tints blended with the light color using multiplicative RGB blending

## Configuration

### Prototype Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `darkness` | `false` | Enable lighting system |
| `fog_of_war` | `false` | Remember explored tiles |
| `ambient_light` | `0.0` | Minimum light level (0-1) |
| `player_light_radius` | `6` | Light radius for controlled actors |

### Actor Attributes

| Attribute | Description |
|-----------|-------------|
| `light_source` | Actor emits light |
| `solid` | Actor blocks light (and movement) |
| `controlled` | Actor emits player light |

### Actor Properties

| Property | Default | Description |
|----------|---------|-------------|
| `tint` | `0xFFFFFF` | Color of emitted light |
| `lightRadius` | `5` | Tiles of light range |
| `lightIntensity` | `1.0` | Light brightness (0-1) |

## Example: Fire Light

```json
{
  "fire": {
    "name": "Fire",
    "tint": "#EC7505",
    "attributes": {
      "light_source": true
    }
  }
}
```

This creates an orange light that:
- Casts from the fire's position
- Stops at walls and solid actors
- Tints nearby floors and entities orange
- Combines with other light sources (player's white light, other fires)

## Visibility vs Illumination

The lighting system separates two distinct concepts:

**Visibility** - What controlled actors can currently see based on their field of view
**Illumination** - How brightly lit tiles are based on light sources

This separation allows for scenarios like:
- Seeing a dark corner (visible but unlit)
- Light spilling from an unseen room (illuminated but not visible)
- Remembering explored areas in fog of war

### Visibility System

Each viewpoint actor — the controlled player, plus any `pov`-tagged actor — has a `vision_range` property (default 8) that determines how far they can see. Visibility is computed as the union of all viewpoint actors' FOV using `ROT.FOV.PreciseShadowcasting`.

**Light radius controls how brightly you see; vision range controls how far.** A held torch never shrinks your field of view. Past the reach of your light, terrain stays readable out to `vision_range` and fades into black (see the gradient band in the table below), so you get an edge that falls off rather than a hard circle.

Two maps back this, and the distinction matters:

| Map | Means | Drives |
|-----|-------|--------|
| `losMap` | Line of sight within vision range, regardless of light | Terrain darkness only |
| `visibilityMap` | Lit *and* seen | Entities, targeting, autoexplore, sidebar, `exploredMap` |

Keeping them separate is what stops a monster standing unlit 25 tiles away from rendering, becoming a throw target, or halting auto-explore just because the wall behind it is faintly visible. Terrain you merely make out in the gradient is *not* marked explored — you have to light a room to map it.

The gradient is anchored to light you actually carry (a burning torch, a phial, a worn glowing ring, or `player_auto_light`). With no personal light at all on a dark level, vision collapses to adjacent tiles as before, so losing your torch stays dangerous.

**Vision Blocking:**
- Wall tiles block vision
- Closed doors block vision
- Open doors allow vision
- Actors do not block vision (you can see past friendly NPCs)

### Observer Mode

When no actors have the `controlled` attribute (or all controlled actors are dead), the game enters observer mode:
- All tiles are shown based on illumination only
- All actors and items are visible
- Darkness overlays reflect light levels, not visibility

This enables spectating AI-vs-AI scenarios or watching the game continue after player death.

## Tile Visibility States

Darkness alpha values are designed to create a monotonically increasing gradient from fully lit to unexplored:

| State | Darkness Alpha | Light Color Alpha | Entity Visibility | Description |
|-------|---------------|-------------------|-------------------|-------------|
| Visible + fully lit | 0 | Based on color | Shown, animated | Bright, colored |
| Visible + partially lit | 0.85 × (1 - intensity) | 0.5 × intensity | Shown, animated | Gradual falloff (0 to 0.85) |
| In LOS + unlit (gradient) | 0.85 + 0.12 × (dist / gradient range) | 0 | **Hidden** | Beyond light radius but within vision — terrain only, fading 0.85 → 0.97 |
| Explored (fog) | 0.92 | 0 | Shown, static, dark tint | Remembered but not currently seen |
| Unexplored | 1.0 | 0 | Hidden | Solid black |
| Observer mode | Based on light | Based on light | Always shown, animated | No visibility restriction |

### Animation Behavior

Animated sprites (fire, water, etc.) only play their animations when within a controlled actor's field of view. In remembered (fog of war) areas, they appear as static frames, reinforcing that they are memories rather than active observations.

### Actor Properties

| Property | Default | Description |
|----------|---------|-------------|
| `vision_range` | `8` | How far the actor can see, in tiles. Shipped prototypes override this (the dungeon player uses 30). Effective range adds passive state bonuses and ring `wear_effect.visionRange`. |
| `dark_vision` | `false` | Perceives entities within FOV without needing light |

### Prototype Mechanics

| Key | Default | Description |
|-----|---------|-------------|
| `beacon_range` | the actor's effective vision range | How far distant unobstructed light sources show as lone lit tiles on a dark level. Set a number to override; previously defaulted to the whole map. |

## Performance Notes

- Visibility is recomputed when controlled actors move
- Light is recomputed when controlled or light_source actors move
- FOV uses shadowcasting (efficient ray-based algorithm)
- Sprite tints and visibility updated per-tile only when lighting changes
- Animations are paused for non-visible entities to reduce rendering overhead
