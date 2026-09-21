# Claudian 0.21.1

A patch release that closes gaps left by 0.20.0 and 0.21.0. Protocol stays at **2.9.0**; no
migration, no new surface, nothing to learn.

Most of what follows is the same defect in different places: the application claiming to know
something it had no way to find out, or saying one thing twice in different words.

## Two states the panel could name and never reach

`OBSIDIAN_MISSING` and `OBSIDIAN_RESTART_REQUIRED` existed in the derivation with nothing able
to set them. Only the window learns whether Obsidian is installed or currently running, and it
never told the part of the application that does the deriving — so the panel could describe a
missing note application in two languages and never once report one.

The window now reports what it finds. A state that is offered and unreachable is worse than
one that is not offered, because it reads as working.

Unknown stays unknown: before the probe answers, nothing is claimed.

## The panel now re-reads when you come back to it

Its whole claim is that a solved problem is not in the list any more. It was loading the state
once and keeping that answer until a timer fired, so you could fix a connection, return, and be
told about it again for up to a minute.

The same lag applied to the tray and to notifications: they followed a one-minute tick, not
your actions. Anything that changes the installation — installing, verifying, repairing,
removing, relocating, approving or revoking an authorization, starting a review — now settles
the derivation immediately. Reads deliberately do not, because re-deriving after a list call
is work with no change behind it.

## One change, one line

A single verification completing used to produce five entries in the history, two pairs of
which said the same thing in different words: `verification_completed` alongside the clearing
of `verification_pending`, and `setup_changed` alongside the clearing of `setup_incomplete`.
A history that reports one event twice is read as two events.

There is now one vocabulary for worries — raised and cleared, uniform across every kind — plus
two events for the things that are levels rather than worries: the setup level, which carries
both ends, and the device connection coming back, which is the only good news that needs its
own line. The same change now produces two entries, each saying something the other does not.

Worries keep their own detail: the relay's error text, the protocol pair behind a superseded
review, the layers that failed a self-check. Folding the kind into that field had quietly
thrown the detail away.

And the history is written for the person reading the panel rather than for the code —
*"Resolved — Codex · Access has never been verified"* instead of `attention_cleared`.

## The tray and the panel now say the same things

Four of the states added in 0.21.0 had a sentence in the panel and no phrase in the tray, so
the tray printed `connection_broken` and `reminder_overdue` at people. Both surfaces now draw
from one vocabulary, and a test fails if a state is ever added to the engine without words in
both — in both languages.

## Removed

- **`background`, a preference that was stored and never read.** The tray decides whether
  Claudian keeps running; there was never a second switch behind it. A stored value nothing
  consults is a promise the product does not keep.
- **`SETUP`, an exported list nothing imported.**
- **One function returning two shapes.** Open loops came back as sentences and reminders as
  records, from the same call, depending on an argument. They are now two functions, because
  they are two things: the panel note holds the undated work and the reminders note holds the
  dated.

## Corrected

The daily notification budget needed no fix. A quiet day spends nothing, and the day rolls over
the next time something is raised — so the window is always right at the moment it is used. The
guard added for it was removed again rather than left in place looking like it did something.
