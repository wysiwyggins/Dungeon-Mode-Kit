# Bugs and ideas

- falling on a prototype with mutliple levels shouldn't instadeath, it takes you to the next level down with a fall injury (unless you fall in a deep nonlethal liquid actor), looks for walkable ground in the same general map area.

- there is a bug where when leaving and returning to a level with ambient light like the first level of dungeon, the ambient light is not restored (test on dungeon prototype).

- Arbitrary variables like bools could be added to prototypes that could be changed by events like actor attributes currently are. This would be a tool for designers to add persistent states across levels that can be changed by the player.

- A dialogue/options window
    This would be a new kind of interface window, like an alert, with an optional list of options, that would be used for a new conversation interaction that could be accessed by bumping into some non hostile actors. This would be a large new feature requiring planning. There could be a simple version, a switch statement that looks for a prototype variable to pick a message, or more complex- could use an existing library like ink (actor personalities could include a link to a corresponding ink file that is accessed when the personality state machine decides its a turn in which to talk). We should strive for simplicity.

- Scripted npc actor actions- a script of turn-by-turn actions that gets executed by an actor and then it returns to other behaviors.  (Is this just another behavior? Maybe we create a behavior editor that allows us to Logo-like program an actor). some sort of web interface for programming actors.

- The `lock` sound exists in the audio sprite but is never played. Should be wired to locked door rejection.

- Add more tones to sound sprite with specified notes for use in simple music tracker for levels. Bitsy is so good at this

- Look to Bitsy and ZZT for feature inspiration as well as roguelikes, we want to be surprised by what designers make rather than be proscriptive

- A web front end level creator would create a prototype that supplements and sometimes overrides the base data. It could even have an upload or pixel art tool for adding tiles to an overriding prototype version. You’d be able to experiment with combining tiles to make actors. A web map editor would replicate some tiled features but would also let you paint entities with color tints, currently tiled can only draw shapes with objects and attributes for entities which you can’t see the tile or tint of.

future- the kit is hosted online in a way that users could create prototypes with web forms and test them, like bitsy.

## Bugs found during doc audit (2026-05-23)

- Broken sound references: `trap1` (interface.js:2504) and `match` (behaviors.js:671) call playSound but have no audio sprite entry. They fail silently. Need source audio files added to the sprite.
