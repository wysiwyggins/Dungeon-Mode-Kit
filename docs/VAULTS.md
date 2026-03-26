# Vault System

This is an idea for an unimplemented game system- "vaults"

Currently we generate "treasure rooms" which are a much more primitive version of the locked treasure rooms in Brogue. There is a color-paired key and lock and there's a chance that items will spawn inside. Vaults will replace this. Instead of a room with a locked door, the locked door will function as a portal to a "place" outside the normal game. The map will be temporarily replaced by a random layer from a tmj file of "room backgrounds." These will be perspective drawn rooms like those in early perspective dungeon games. A vault can either contain a puzzle, which is an interactive text piece in the form of an inform7 file, or a conversation, which is a branching dialogue script in .ink format. A conversation could simulate trading or buying items or answering a riddle. Another layer of tile art representing either the puzzle or the conversations will also be displayed in the canvas, and backgrounds and foregrounds are randomly combined for variation. These can all be layers in the same vault.tmj file with a naming convention to differentiate them. Interacting with either a puzzle or a conversation can result in either winning a powerful item, stat change or death depending on player choices.
There would need to be a consistent way to exit the vault back into the regular game.

We assume there would be folders in /data/ for the conversation files and puzzle files, and that prototype overrides could specify unique conversations or puzzles at determined prototype levels. We will need to determine how dialogue and inform7 display text and text entry would be layed out on the page (somewhere in the html text outside of the canvas, probably in Description). For inform7 we can probably use Vorple, a javascript package, to parse and display the file and to connect outcomes back to the game. Since modern audiences often have issues typing commands in a text parser, we could also use vorple to make clickable commands in the text output.

It may be overly complicated but I could even imagine a system where the ink file is subordinate to the inform7 file, imported into it so that you could talk to an npc to get hints to solve a puzzle written in inform. The ink file would be easier to manage for large conversation trees than writing directly into inform.

Why not just use ink?
Ink is a branching text editor that can have some variables, inform is a full programming lanugage with prefab extensions that could simulate much more complex systems with state as opposed to a bunch of conditional logic. Both are good for different things. Randomization is also much easier in inform7.

Why not just use javascript?
We want to be able to more easily create content with an ide/editor for a game feature that requires writing lots of content.

Since ink and the ZMachine aren't directly compatible, one solution would be a script that converts ink exported json to inform7 or inform6 code. Generating inform7 code has been difficult and buggy so far though. We'd want a way to facilitate ink conversations without inform puzzles, inform puzzles without ink conversations, or both together.

research links:

- Vorple <https://vorple-if.com>
- Vorple api <https://vorple-if.com/api/index.html>
- Inform7 as middleware <https://intfiction.org/t/integrating-inform-7-within-a-larger-game/53122/3>
- ZMachine tools as middleware <https://intfiction.org/t/z-machine-tools-as-future-narrative-middleware/52111>
- Ink <https://www.inklestudios.com/ink/>
