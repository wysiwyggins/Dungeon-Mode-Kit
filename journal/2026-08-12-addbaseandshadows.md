---
date: 2026-08-12
author: Wiley Wiggins
project: "Dungeon Mode Kit"
---

# Shadows

---

One of the idiosyncratic things DMK does by default is fill void areas with no floor tiles with a background tile pattern that looks like hard, angular shadows, suggesting cliff faces. It was something I came up with in earlier experiments that has stuck as a visual motif. Eaarly projects like [Grotto](https://mudroom.rip) used hand edited tilemaps for this.

The very first version of an algorithmic way of doing this was in an untitled experiment that predated DMK:

```javascript
function addBaseAndShadows() {
    //console.log("adding shadows");
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            // Check if the current tile is a floor
            if (backgroundMap[y][x].value === 216 && floorMap[y][x].value !== 177 && wallMap[y][x].value !== 177 && wallMap[y][x].value !== 131) { 
                if (!isUpperLeftCornerTile(floorMap, x,y,177) && isAbove(floorMap, x, y, 177) ) {
                    createSprite(x,y,{x: 12, y: 5},backgroundMap, 127);
                }
                if ((isOnLeft(wallMap, x,y,177) || isOnLeft(wallMap, x,y,131) || isOnLeft(floorMap, x,y,177)) && isAbove(floorMap, x, y, 177) ) {
                    createSprite(x,y,{x: 12, y: 5},backgroundMap, 127);
                }
                if ((isUpperLeftCornerTile(backgroundMap,x,y,127) && isAbove(backgroundMap,x,y,177))){
                    createSprite(x,y,{x: 12, y: 5},backgroundMap, 127);
                }

                if ((isOnLeft(backgroundMap,x,y,127)) && wallMap[y][x].value !== 177 && floorMap[y][x].value !== 177  && (isAbove(floorMap,x,y,177) || isAbove(backgroundMap,x,y,177))){
                    let xPos = x; // Start checking from the tile to the right of the current tile
                    while (y > 1 && xPos < MAP_WIDTH -1 && floorMap[y][xPos].value !== 177 && wallMap[y][xPos].value !== 177 && wallMap[y][xPos].value !== 131 && backgroundMap[y][xPos].value === 216 && (isAbove(floorMap,xPos,y,177) || isAbove(backgroundMap,xPos,y,177))) {
                        createSprite(xPos, y, {x: 16, y: 7},backgroundMap, 177);
                        createChasmWall(xPos,y);
                        xPos++; // Move to the next tile to the right
                    }
                }
            }
            
        }
    }
}
```

A version very close to this ended up in DMK, but of course it was very brittle and opinionated. When I started adding lighting effects and ambient color tints there were issues because this method had hard coded tile id's that used translucent tiles with no white pixels to tint, and switching which tiles were used actually broke the method, since those id's were also part of the tile placing logic.

In DMK I am endeavoring to make reusable utility functions that can flex and have easy to edit surfaces. In Unity when you make variables public they show up as UI controls and fields that you can tweak easily as you test, looking for the right settings for things as you develop game-feel.

In addition to the hard-coded tile id's, the lighting pass in DMK skipped any cell without a floor tile, and void cells are floorless by definition, so the one code path that could have colored them was excluded from doing so. Background sprites now carry the ambient hue directly, and the shadow art uses the opaque variants of the same glyphs. As for the tile id's hard coded into the method logic, recognition and painting are now separate concerns. All four tile values now live in `globals.js`, so an abyss can be restyled from one place instead of five scattered literals in two files. Then the method itself got taken apart.
Its three rules:

- start a diagonal at a cliff corner
- continue it down-right
- flood the shadow body rightward
... are now data passed to a general `applyTilePattern(layer, rules)` that walks any layer and applies an ordered list of `{ when, paint }` rules, first match winning. `addBaseAndShadows` is a short method that hands it the globals and gets out of the way.

Now that I've separated this into two methods, the new applyTilePattern uses an input for an ordered rule list object, which I will admit is something dirty that I got from Mephisto in exchange for $20. I will try to do better when I touch this again and either learn why it is this way or make something (probably worse) that at least I understand better. Sorry mom, sorry god. 😤

I'm imagining a future visual editor that would let you make other kind of pattern flood fill rules. I don't know what someone might use that for, but I do know I got very invested in the different [pattern generators](https://wileywiggins.com/p5/patterns/) I was making with the same tileset. Maybe the tilePattern method and a visual rule editor could be used to make things like forest or building generators, or patterns of grass and vegetation using the various dotted tiles.
