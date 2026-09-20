# Claudian 0.19.2

A patch release about the screens. Protocol stays at **2.9.0**; nothing in your vault changes
and there is no migration. 0.19.0 was about getting installed and finding the next step,
0.19.1 about pointing Claudian's own memory in the right direction. This one is about the
setup, review and connection screens telling the truth and being possible to act on.

Every change below came from someone using 0.19.1 and finding the screen wrong, not from
reading the code.

## Nothing on these screens moves any more

The recommended next action pulsed. It was introduced so that exactly one control would carry
"press this", and it did that — and then kept doing it, after it had been read and understood,
while the sentence explaining it was still being read. `prefers-reduced-motion` turned it into
a static border, which was the right answer for the wrong question: the motion was wrong for
everyone, not only for people who ask the system to stop it.

The pulse is gone. Not shortened, not moved to another control, not hidden behind a media
query — the keyframes and the class that existed to carry them are removed from the
stylesheet. Rank is now carried by colour, weight, border and position. The one-shot entrance
animations on the connection dialog and the step checkmarks are gone with it.

One animation remains: the spinner shown while a check is actually running. It reports work in
progress, which is the only thing on these screens that has any business moving.

A test now fails if any button on a setup screen has a computed animation, and if the
stylesheet declares any keyframes other than that spinner.

## "Verify access" verifies access

The setup banner on the Connections screen offered a button called **Verify access**. Its
action was "go to the Connections screen" — the screen the banner is drawn on. Pressed from
there, it re-rendered the same page: same state, same text, same buttons. Nothing about the
installation changed and nothing told the user why.

The button now names the connection it is about, opens it, and issues the real read/write
challenge for it — the same device-issued test the connection dialog offers, with its result
landing in the same place. **Finish the connection** and **Repair the connection** were the
same kind of no-op from that screen and now open the connection they refer to.

When there is nothing a press could test — a read-only profile cannot write a test answer, a
cloud connection whose tools are not reachable yet has no test to run — the button is not
drawn at all. A control that cannot answer is worse than no control.

## The review screen is a screen, not an article

Reopening Claudian over an existing installation put five paragraphs between the top of the
review screen and the box you have to tick. Two of them repeated each other, one belonged to a
provider card, and the access level was buried in the middle of a sentence about user
agreements.

The main flow now carries the state, the choice, one helper line, the consent sentence and the
action. Processing, the account/permission distinction and the access level are real and still
there — one fold down, under **What this changes, and what it does not**. The consent checkbox
and the sentence saying what it allows stay in the open, and Apply stays closed until it is
ticked, with the reason printed beside it.

## Providers are cards, and three different facts stay three facts

The review screen listed AI applications as bare checkbox rows. A checkbox can say "ticked".
It cannot say that **selected**, **connected** and **verified** are three separate claims with
three separate kinds of evidence — which is the distinction Claudian exists to keep.

Each provider is now a card carrying its name, its badge, how it connects, its own requirement
where the vendor imposes one, and its evidence line: *not connected*, *connected · access not
verified*, or *connected · read/write verified* — and only the last of those is green.
Unticking a provider states the consequence on the card being removed, where it is read while
the decision is being made rather than in a paragraph further down.

## Antigravity is one connection

Antigravity and "Antigravity CLI" were listed as two AI applications. They are not. They are
the IDE and the terminal of one product: both write into `~/.gemini`, both share the same
`GEMINI.md` instruction file, and the CLI card's "open app" action already launched the IDE,
because there is no separate CLI binary to launch.

There is now one **Antigravity** card. Selecting it installs both entry points, removing it
removes both, and its dialog offers **Continue in the app** and **Continue in the terminal** —
two ways in, not two providers. The internal `antigravity-cli` id is untouched, so existing
installations keep resolving, repairing and removing exactly as before.

## Spark opens Spark

The Spark connection's primary action opened `gemini.google.com/app` — ordinary Gemini chat,
the one surface where a Spark connection does not exist. It now opens `gemini.google.com/spark`.

The manual-sharing fallback still opens ordinary Gemini chat, because that is what it is for,
and it now says so: **Gemini manual sharing — no connection**. It installs nothing, verifies
nothing, and no longer looks like the Spark action.

## A web first review can now finish, and cannot be finished by prose

A first review on a web provider could not complete at all, for a structural reason rather than
a bug. The verification value lived only behind `read_first_review`; the provider's policy
blocked that call; `submit_first_review` requires that value. So the only thing that ever came
back was a free-form report that read like success while Claudian waited a full day.

The value now travels inside the instruction you paste, so the deterministic call is reachable
on its own. It is still single use, still expires with the request, still bound to that one
request on that one device, and the call still arrives over that provider's authenticated
grant. What it no longer proves by itself is that a scan happened — so Claudian now also
requires evidence, from its own record of what that grant has actually called, that the
conversation read something through Claudian before it reported on it. A token echoed back by
a conversation that never read anything is refused, and the refusal is shown on the screen.

Nothing about the provider's prose is parsed, at any point, for any purpose.

A review that is neither submitted nor refused no longer reads as "waiting" for twenty-four
hours: when the grant record shows the connection was used after the review was issued and no
report followed, the screen says the AI used the connection and returned no report.

## Provider requirements come from the provider

Where a vendor imposes a plan or surface requirement, the card states it in one sentence taken
from that vendor's current documentation, including the part that depends on what access is
being asked for. ChatGPT reads: custom MCP app on ChatGPT web only, read and write needs
Business or Enterprise/Edu, Pro can connect read-only in developer mode. One sentence, one
answer — never two badges that contradict each other, and never a requirement Claudian guessed.

## Also in this release

- A retried web review submission is told the review is already complete instead of failing
  with a raw file-exists error.
- Removing a provider that owns more than one entry point refuses as a whole if any of its
  files were edited by hand, rather than removing half of it.
