// Kobold Hermit: the dungeon prototype's first talker.
// Compile with `npm run ink` (or export JSON from Inky) to kobold_hermit.json.
//
// Items are never named here. Slot 1 and slot 2 are the hermit's default_items
// (actors.json) and [wanted] is his `wants` attribute, so changing his data
// changes what he offers without touching this file.

EXTERNAL give(slot)
EXTERNAL trade(slot)
EXTERNAL speaker_slot(slot)
EXTERNAL can_trade(slot)

// Mirrors floor 1's `desecrated` level variable. Setting it has the same effect
// as attacking the hermit or digging up a grave (his provoked_variable).
VAR desecrated = false

{ greet > 0:
    You again. The dead do not need visitors.
- else:
    I beg you, do not defile this place.
}
-> greet

=== greet ===
+ [Who are you?] -> who
+ [Farewell.] -> END

=== who ===
We kobold dug the crypt below, but our bodies were not fit to lie there near the opressors. I watch over this potter's field, though the sunlight burns my eyes.
+ [The way down?] -> below
+ {speaker_slot(1)} [Can you spare \[a-an\] \[speaker_slot:1\]?] -> gift
+ [I'll dig where I please.] -> threat

=== below ===
The cathedral gate opens with a lever, but it will lock behind you to keep what is within from escaping.
* [Any advice?] -> advice
+ [Something else] -> greet

=== gift ===
{ give(1): The dead have no use for it. Take the [given], and go. | You carry too much already. }
-> greet

=== swap ===
{ trade(2): The [given] is yours. | You have no room for what I would give. }
-> greet

=== threat ===
Again! I won't watch another human steal from the dead!
~ desecrated = true
-> END

=== advice ===
There is nothing I can say other than to turn back now.
-> END

// Inky preview fallbacks for the EXTERNALs above.
=== function give(slot) ===
~ return true
=== function trade(slot) ===
~ return true
=== function speaker_slot(slot) ===
~ return 1
=== function can_trade(slot) ===
~ return true
