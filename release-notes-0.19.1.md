# Claudian 0.19.1

A patch release carrying protocol **2.9.0**. 0.19.0 was about getting installed, finding the
next step and knowing what is actually connected — it pointed the user in the right direction.
This release points Claudian's own memory in the right direction.

No new architecture, no new service, no new screen. Upgrading from 0.19.0 requires no
migration: your notes folder, your profile, your grants and your connections are used exactly
as they are. The one file the application rewrites is its own protocol note in your vault,
which moves from 2.8.0 to 2.9.0 on first launch. Your own notes are not touched, and a protocol
note you edited yourself is reported as a conflict and left alone, as before.

## History is preserved but no longer treated as current context

A memory in long use accumulates old decisions, abandoned architectures and unfinished
historical plans. They are worth keeping — for rollback, for provenance, for what was learned —
but they were reaching the conversation with exactly the authority of a current decision.
Decisions from three retired version lines sat beside today's in one note, all read at the same
level by the same startup.

Protocol 2.9.0 gives information a lifecycle: **active**, **superseded**, **archived**.
Deletion is deliberately not one of the three — an explicit request to forget something removes
it, and is never quietly satisfied by moving it into an archive.

A section that has fallen out of force carries a marker directly under its heading, where the
owner of the notes can see it:

```text
> **⚠ Archive — no longer in force (31.08.2026)**
> This section is a historical record. It is not used as an active decision, task or current
> product behaviour. It is consulted only for rollback, provenance or historical review.
```

The marker is not decoration. Session entry, open loops, current decisions and recommended
actions see active content only. Archived and superseded sections stay in the file, stay
searchable, and are read when history, a rollback or the provenance of a decision is actually
asked for. **An unchecked box inside an archived plan is not an open task**, and the "missing"
items of an abandoned plan are not promoted into the current list.

Being old is not the same as being out of force. Nothing is archived because it carries an
earlier version number; a decision taken in an older release that still holds stays active.

## Startup carries less and loses nothing

Two notes grow without bound in any long-lived memory — every decision ever taken, and every
open loop ever opened. Both are now bounded by **whole records**: the records that fit arrive
complete, and the ones that do not arrive as the bold opening line they are written to carry.
Only finished records fall out entirely, and the count of what was shortened or left out is
stated in the payload rather than left to be discovered. An open commitment is never dropped to
make room.

A vault protocol copy identical to the one the application already sent in the same payload is
no longer flagged for a second full read. A copy you have customised has a different digest,
and keeps its override and its read exactly as before.

## Persistent memory setup stops asking after it has been answered

Setup wrote "not offered" into the adapter note, the first AI review carried its own separate
pointer text and never touched that line, and so every later conversation asked for consent
again — on installations that had completed their review months earlier.

The application now records the answer itself, in the same operation that accepts the review
receipt, guarded by the expected hash and idempotent: an answer already recorded is left alone,
a declined answer is never overwritten, and a review that failed or was blocked records
nothing. An installation that completed its review before this release is caught up the next
time its status is checked. The duplicate pointer text in the scan prompt is gone; there is one
seed, and it calls the protocol instead of restating it.

## The memory review no longer refuses the turn it just did the work for

Two Claudian connections can be registered on one machine — the Claude Code entry and the
Claude application's own entry — and a Claude Code session running inside the Claude
application uses the first one's prompt hook while its tool calls are served by the second.
The turn was opened under one identity, every receipt carried the other, and the review was
refused: `This session belongs to a different connection`. The writes were durable; only the
maintenance receipt was lost.

Ownership now follows the writer, on evidence rather than on a label. A connection may take a
turn only when it committed at least one receipt in that turn and no other connection wrote in
it. Two connections genuinely working one session is ambiguous, and ambiguity is refused rather
than guessed. A turn nobody wrote in cannot be claimed at all. Every rebind is recorded and
reported; none of it is silent, and no connection can review another connection's receipts.

## Smaller corrections

- `external_source` has been named in the protocol since 2.5.0 and rejected by the capture
  tool, so a finding taken from a document had to be recorded as the agent's own observation.
  It is accepted now, and asks for the reference it is worthless without.
- A read failure is reported when it materially affects the answer, the task or an expected
  save, instead of on every small retrieval miss. Quietly inventing something in place of what
  is missing stays forbidden, and "I could not reach it" never stands in for "there is no such
  record".
- The map-of-content rule said a subject's own note and its map were born at the same moment,
  which would open an empty map beside every note that splits. A map is now born when a subject
  holds more than one canonical note and navigating between them is worth something.
- The protocol's eleven behaviour checks were carried into every conversation as runtime text
  and verified by nothing. They are acceptance tests now, and the runtime keeps the rules.

## Test suite

279 unit tests and the packaged smoke run pass — 29 more than 0.19.0, covering the lifecycle
filter, the bounded startup payload, the persistent-memory initialization and the turn
ownership rules. The 0.19.0 onboarding, connector and gateway-contract suites are unchanged and
still pass.

## Not in this release

The public gateway (`planning/PUBLIC-GATEWAY.md`, D1–D6) remains designed and unbuilt; cloud
connections continue to work through the existing device relay. Automatic promotion of notes
into maps, a role field for maps, unified Turkish/English protocol sources, and a session
identifier on write receipts are all deliberately deferred.
