// Kobold Hermit: the dungeon prototype's first talker.
// Compile with `npm run ink` (or export JSON from Inky) to kobold_hermit.json.

// Engine functions (engine/actor/dialogue-functions.js). The ink fallback
// below only runs when previewing in Inky.
EXTERNAL give(item)

VAR gave_bread = false

// Mirrors floor 1's `desecrated` level variable (prototype.json "variables").
// Setting it true has the same effect as attacking the hermit or digging up a
// grave: the hermit's personality names it as its provoked_variable.
VAR desecrated = false

{ greet > 0:
    You again. The dead do not need visitors.
- else:
    I beg you, do not defile this place.
}
-> greet

=== greet ===
+ [Who are you?] -> who
+ [The way down?] -> below
* [Any advice?] -> advice
+ {not gave_bread} [Can you spare any food?] -> food
+ [I'll dig where I please.] -> threat
+ [Farewell.] -> END

=== who ===
We kobold dug the dungeon, but our unclean bodies were not fit to lie there near the opressors. I watch over this potter's field, though the light burns my eyes.
+ [Back to the rest.] -> greet

=== below ===
The cathedral gate opens with a lever, but it will lock behind you to keep what is within from escaping.
+ [Back to the rest.] -> greet

=== food ===
{ give("bread"):
    ~ gave_bread = true
    The dead do not eat. Take it, and go.
- else:
    You carry too much already.
}
-> greet

=== threat ===
Then you will lie down with them.
~ desecrated = true
-> END

=== advice ===
There is nothing I can say other than to turn back now.
-> END

// Inky preview fallbacks for the EXTERNALs above.
=== function give(item) ===
~ return true
