
// From scratch architect js needs to:
// check if there is a map.tmj as before
// if there is a map.tmj check for wildcard tiles and do generated tiles there as before
// if there is no map.tmj, generate from prototype.json as before but:
//differences-
// The old architect.js would start with null background and floor tiles, and add floors, wall perimeters and doors using various rot.js methods, then it would fill in black background tiles and shadows using the addbaseandshadows method. 
//That gave the impression of a maze surrounded by a single tile of wall floating in a void.
//We want to have more traditional dug levels that are surrounded by wall actors that can be destroyed and will have walkable floor in newly cleared areas. That means that levels with no map.tmj file should by default fill the floor layer with a walkable tile, different from the floor tiles added by our maze generators and surrounding wall actors. If it causes performance problems adding too many wall actors, we can only add them as needed when they are exposed by mining or scrolls of shattering, etc. 
// bring back the rot.js dungeon creation methods, along with Brogue shaped room methods, see '/Users/wileywiggins/Development/Brogue-iPad/iBrogue_iPad/BrogueCode/Architect.c'
// In addition to lake and lava fields, we will randomly add chasms to maps- this means changing floor tiles in an area to null, THEN running addbaseandshadows on the background layer just in the area of the chasm where floor tiles have been removed.
//Since chasms are the only place that the background will be visible, we don't need to run addbaseandshadows until this point. 
//Add rope bridges using the inverted box drawing tiles, tinted brown. They should cross some chasms. 
//Add 'lakes'- areas of water or lava actors as needed. Higher chance of lava on lower levels.
// other old architect.js methods like tile flipping etc can be added back one at a time to make sure that the base functionality isn't interfered with. 

//previous depricated architect.js: /deprecated/architect.js
