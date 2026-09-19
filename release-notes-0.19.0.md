# Claudian 0.19.0

The controlled continuation of 0.18.7. This release is about getting installed, finding the
next step and knowing what is actually connected. No new architecture, no new service.

Upgrading from 0.18.7 requires no migration. Your notes folder, your profile, your grants and
your existing connections are used exactly as they are.

## Setup no longer reads as a storage-format decision

The first screen proposed **Markdown** to anyone who did not already have Obsidian installed —
which is every new machine. Obsidian is now the default answer, with plain Markdown kept as an
explicit advanced choice. A missing Obsidian is treated as the next step rather than a wrong
answer: the screen says so and offers the download.

## One recommended action, everywhere

Claudian now derives a single next step from state it already had — the profile, the health
check, the connection list and the cloud progress — and marks exactly one control with a soft
orange pulse. Under `prefers-reduced-motion` the pulse is replaced by a static border, not
removed. Warnings keep their own triangle so that "press this" and "be careful" never look
alike.

If setup is unfinished while you are on another screen, a **Setup incomplete** banner names
what is missing and takes you to it.

## "Selected" is no longer mistaken for "connected"

Ticking an AI during setup put it in your profile and the screen then looked finished. Each
connection now states both facts separately — selected, connected, and read/write verified —
because they are three different things with three different kinds of evidence.

Finishing setup and choosing **Set up AI connections** now actually opens Connections. It
previously landed on Memory: the panel reloads at that moment and the requested destination
was discarded, which is the single place the product most looked complete while nothing was.
On later launches Claudian does not take the screen away from you; the banner does the work.

## Obsidian restart is a warning, not a grey sentence

When Obsidian is running, Claudian cannot register your notes folder. That now appears as a
warning callout with the one action that resolves it. It is shown only when the application
actually reported the condition — never as a guess.

## Provider names say what can be proven

- The working Google integration runs inside **Spark**, reached from the Gemini web app.
  Ordinary Gemini chat cannot use it, so the connection is no longer presented as "Gemini".
  It carries a **Beta** badge, because Spark is early access.
- **Perplexity** has never been exercised with a real account here. It is marked **Untested**:
  it may work, it is not proven.
- No plan requirement is displayed for any provider. None is recorded anywhere in this
  codebase, and a guessed one would be a claim the product cannot stand behind.

Internal identifiers are unchanged, so profiles installed before this release keep resolving.

## Connection reliability

- `offline_access` is now advertised and accepted. A client that asked for it — which the
  providers do — was previously rejected with `invalid_scope` and the authorization flow died
  on its first hop. It is accepted as a refresh signal and stripped before any permission
  decision; it never becomes an access right.
- Authorization responses now carry `iss` (RFC 9207), on denials as well as approvals, and the
  discovery document advertises it.
- Reconnection uses exponential backoff with jitter instead of a fixed three-second retry, so
  devices no longer reconnect in lockstep when a relay returns.
- The approval screen now states that the application name and return address are reported by
  the requesting application itself and cannot be verified by Claudian.

## Profile writes are serialised

Every profile write was already atomic, but the read-modify-write around it was not: two
Claudian windows changing settings at the same moment could silently lose one of the changes.
Those operations now hold a lock. A lock left behind by a crash is cleared automatically
instead of blocking settings forever.

Vault notes were already protected by their own expected-hash guard and are unchanged.

## Test suite

`npm test` passes end to end again. On 0.18.7 the packaged smoke run failed: it drove its
remove/re-add round trip through `gemini-cli`, which had been retired, and a retired host can
neither be listed nor installed. 250 unit tests and the smoke run now pass, including new
suites covering the gateway contract, the onboarding state machine, the profile lock and the
entry-view handover.

## Not in this release

The public gateway at a single canonical endpoint — a fixed issuer, a device identifier absent
from the public URL, gateway-side pairing and a token index — is designed in
`planning/PUBLIC-GATEWAY.md` but not built. Cloud connections continue to work exactly as they
did in 0.18.7, through the existing device relay. Nothing in this release changes that
transport.
