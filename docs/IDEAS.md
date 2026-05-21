# Bugs and ideas

currently darkness has no affect on FOV. when your torch burns out on dark levels it should affect gameplay other than visually. This could be a big task that also deals with stealth and how actors notice one another.

Arbitrary variables like bools could be added to prototypes that could be changed by events like actor attributes are. This would be a tool for designers to add persistent states across levels that can be changed bu the player.

A dialogue/options window
This would be a new kind of interface window, like an alert, with an optional list of options, that would be used for a new conversation interaction that could be accessed by bumping into some non hostile actors. This would be a large new feature requiring planning. There could be a simple version, a switch statement that looks for a prototype variable to pick a message, or more complex- could use an existing library like ink (actor personalities could include a link to a corresponding ink file that is accessed when the personality state machine decides its a turn in which to talk). We should strive for simplicity.
le
It seems really easy to ignore descriptions right now, should there be other kinds of interface window messages that are also recorded in descriptions? Interface messages have less space and are a little harder to read but demand attention. Could also have css colorful description messages in the sidebar that are more noticable.

Scripted npc actor actions- a script of turn-by-turn actions that gets executed by an actor and then it returns to other behaviors. (Is this just another behavior? Maybe we have a behavior editor that allows us to logo-like program an actor). some sort of web interface for programming actors.

A web-form for creating actors with controls for making attributes and stats and selecting pre defined ones.

A web front end level creartor would create a prototype that supplements and sometimes overrides the base data. It could even have an upload or pixel art tool for adding tiles to an overriding prototype version. You’d be able to experiment with combining tiles to make actors.
A web map editor would replicate some tiled features but would also let you paint entities with color tints, currently tiled can only draw shapes with objects and attributes for entities which you can’t see the tile or tint of.

The dialogue/options window
Arbitrary options that can set a prototype-level variable (should prototypes just have flags or also enums?)

The visual concept of the tiles should extend to the code- building with LEGO brick recombinable chunks that can be combined in unexpected ways.

future- the kit is hosted online in a way that users could create prototypes with web forms and test them, like bitsy.
