# Bugs and ideas

Currently when confused you are warned about stepping on a hazard when you are actually going to step on it, instead of any time you attempt a move while next to the hazard. The intention is that you do not know if you will step on it because you are confused so you are taking a risk.

There should be a visual effect for an invisible playable actor (reduced opacity on the actor, other invisible actors should be visible: false and actually invisible)

Arbitrary variables like bools could be added to prototypes that could be changed by events like actor attributes are.

A ‘clock’ actor that triggers an adjacent actor bool after a counter loops (a light? A gate?)

The dialogue/options window
Arbitrary options that can set a prototype-level variable (should prototypes just have flags or also enums?)

An Illusionist actor, who makes you hallucinate and summons un-solid harmless clones of himself that approach and disappear when you hit them.

A hell hound actor that blinks and sets fires.

It seems really easy to ignore descriptions right now, should there be interface messages that are also recorded in descriptions? Interface messages have less space and are a little harder to read but demand attention. Could also have colorful description messages

Scripted npc actions- a script of turns that gets executed by an actor and then it returns to other behaviors. (Is this just another behavior? Maybe we have a behavior editor that allows us to logo-like program an actor.

Solid actors could have a descriptive message when you bump into them other than default that is set in actors.json

A web-form for creating actors with controls for making attributes and stats and selecting pre defined ones.

A web front end would create a prototype that supplements and sometimes overrides the base data. It could even have an upload or pixel art tool for adding tiles to an overriding prototype version. You’d be able to experiment with combining tiles to make actors.
A web map editor would replicate some tiled features but would also let you paint entities with color tints, currently tiled can only draw shapes with objects and attributes for entities which you can’t see the tile or tint of.
