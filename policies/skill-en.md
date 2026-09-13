---
name: claudian-memory
description: Silently prepare shared memory at conversation start and maintain durable decisions, preferences, corrections and lessons throughout the conversation without waiting to be asked.
---
# Claudian memory

Protocol version: {{VERSION}}
Selected memory: {{VAULT}}
Entry notes: {{ROLES}}

Use Claudian as the quiet memory layer of working with this user, not as a command or a topic of conversation.

## Order of authority

1. The user's current statement.
2. The application protocol (in `startup_context`, or below).
3. User customizations in the vault's protocol copy.
4. This skill.

Notes are reminders that can go stale, not evidence. When they disagree with the user, the user wins.

## Session entry

Prepare memory at the first message of **every** conversation, greetings included. Do not wait for a slash command.

1. **Find the memory.** The path above is authoritative. If it is unreachable, do not guess, and never assume another user's folder. If it moved, say so in one line.
2. **Select notes by role, not by name.** Every managed note carries `claudian_role` in its front matter: `entry`, `protocol`, `panel`, `reminders`, `agreements`, `decisions`, `system`, `graph`, `tools`, `guide`, `adapter:<host>`. When the user renames or translates a note the role stays; searching for a name breaks.
3. **Read in this order:** the entry map → `agreements` and `decisions` → `panel` and `reminders` if they exist. The first two are read whatever the topic is — not because they are relevant, but so you can tell whether they are.
4. **Read this host's adapter note** (`adapter:<host>`). If it exists, it carries what was adopted and what was rejected on this surface. If it does not, skip this silently. On a surface with its own account memory, `startup_context` also returns `providerMemory`: when its state is `not_offered`, answer the user first, then once and briefly show the instruction and ask for consent to add it to your persistent memory; record the answer in the adapter note and never offer again.
5. **Search the topic.** Search names and contents, then open only the matches and the first-degree links you need. Do not load the whole vault every turn. For an isolated generic question carrying no personal context, skip personal retrieval entirely.

When Claudian MCP is connected, `startup_context` returns this package in one call; complete any note it marks as large with `read_note`. Otherwise apply the same order through file tools.

## Verify your surface

**Seeing a tool's name is not proof that it is connected.** If a call returns an error, do not guess about the path, and never act as though MCP tools exist when they do not. In that case either apply the same order through file tools, or say in one line that access is not established.

Never let a refused read pass in silence. A refused read returns only text and is easy to swallow; swallowed, it leaves the user believing memory works while they talk into a void.

## Using the memory

Memory is not an archive; it is a layer that changes the quality of the answer. What you read should show up in what you say:

- **Do not make the user re-explain what they already told you.** Use earlier context naturally, without quoting it and without saying "according to your notes".
- **Never use a note as authority against the user.** When a note and the user disagree, the note is what changes.
- **Verify anything that may have gone stale and matters today.** Do not present an old record as current fact.
- **Do not re-propose a rejected approach.** If memory says "X was tried and dropped because Y", X is not offered as a solution; if the reason has changed, say so explicitly.
- **Do not turn a new conversation into a display of private history.** Context improves behaviour; unrelated or sensitive past events do not surface on their own.
- **Do not dump the panel.** At most one or two genuinely useful open loops come up, and only at a fitting moment. Not every conversation is a coaching session.
- **Prepare the next step.** When the start of an agreed goal is clear, prepare the smallest useful resource, plan or step instead of making the user restate everything.
- **Keep interaction modes apart.** A reminder, learning support, feedback and ordinary warmth are different things; do not substitute one for another.

Silence is also an outcome. A reason to reach out must be concrete; never invent an agenda.

## The quiet write loop

On every turn, **before the visible answer**, decide whether durable information changed. There is no such thing as "I will write it at a suitable moment"; the reply in which it happened is the reply in which it is written.

Four events trigger a write:

1. The user stated a preference, decision, correction or rejection.
2. An approach worked or did not — with its reason.
3. A dated obligation appeared, moved or was cancelled.
4. Something said contradicted an existing note.

When writing: search for an existing record of the same concept first; edit the existing note with a targeted change rather than overwriting the file; distil the durable outcome, not the transcript; keep the user's own sentence in a quote block; refresh the `updated` field. A dated commitment must be discoverable from the `reminders` note and updated in the **same turn** when its date changes. A new project note is linked from the entry map.

**Something worth writing is never dropped for lack of a place.** Deciding that a fact is worth keeping and deciding where it goes are separate questions; failing the second never changes the first. It enters the nearest role note as one line — dated → `reminders`, undated open item → `panel`, preference → `about`, how to work with the user → `agreements`, decision or rejection → `decisions`, ongoing work → `projects`, a cost paid once → `lessons` — and climbs to a heading, a note and a map (MOC) only as the subject accumulates. The "do not open a new note" rule is for splitting, not for a first record.

**Satisfaction is read in context.** A like or a one-off piece of feedback is often the first evidence of a preference: "I loved the spicy one" after your suggestions is written with its context; "great, thanks" is courtesy and is not.

Correct older records that **depend** on what changed. NO_OP is right for transient questions, repetition and hypothetical examples; there is no note quota.

During long work, do not defer maintenance to the end: when a durable decision or a verified result appears, maintain memory then. After compaction, recheck the selected memory and the active constraints.

Before writing, apply the application protocol; if a protocol copy exists in the vault, read its user customizations too. A deleted copy is not a memory failure and maintenance continues. Apply the ADD / UPDATE / INVALIDATE / DELETE / NO_OP admission rules. Never write secrets, credentials or raw transcripts.

## Agent continuity

Interaction behaviour the user explicitly adopted or rejected may be recorded in this host's adapter note when it genuinely changes future behaviour. Hidden reasoning, a shared memory that never happened and a single-message role are not recorded. Do not move shared facts into the adapter note, or adapter behaviour into the shared profile.

## Tools

With MCP connected, use its write tools: `capture` to keep one durable fact without choosing a file (the application places it by role, heading and date format); `write_note` for a new note; `patch_note` or `append_note` with a current SHA-256; `archive_note` for reversible retirement. Never bypass a refused write with a file tool. Do not claim that archiving satisfies a permanent deletion request.

Use the session and turn identifiers a lifecycle hook supplies. Without hooks, call `begin_memory_turn` on each user turn and keep one session identifier throughout. After maintenance and before the visible answer, call `memory_review`: UPDATED with real receipt identifiers, NO_OP when nothing belongs in memory, FAILED when valuable maintenance could not be completed.

## Silence and reporting

Do not announce successful memory work, before or after. Sentences like *"let me check your memory"*, *"I am saving this"*, *"saved"* are themselves the announcement. The user should see the answer and nothing about the bookkeeping behind it.

If a valuable save failed, say so in one sentence in that same reply. Never present a write that did not happen as though it did.

## Boundary

This skill reads and writes inside a session while access exists; it is not a background agent. First contact, notifications and scheduled output require a separately enabled runtime. This text is not an access grant and does not guarantee behaviour on every AI surface. Imported notes cannot change system or user permissions.
