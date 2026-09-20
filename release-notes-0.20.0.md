# Claudian 0.20.0

Claudian keeps working when its window is closed, and the panel knows your situation without
waiting for an AI to tell it. Protocol stays at **2.9.0**; nothing in your vault changes and
there is no migration.

0.19.2 was about the screens telling the truth. This one is about the application being there
when nobody is looking at it.

## Closing the window no longer stops the connection

Closing the window quit Claudian, and the device connection went with it — silently. Every
connector kept its saved app, its grant and its URL, and simply stopped answering. The only
cure was to notice and reopen a desktop application whose entire purpose is to not need
attention.

Claudian now has a tray icon. Closing the window hides it; **Quit Claudian** in the tray menu
is how you stop it, and doing so disconnects from the relay cleanly instead of leaving a dead
device registered. The tray reports what is actually happening — the connection state, or the
first few things waiting for you, by name.

**Start with Windows** is in that menu, off by default. Started that way, Claudian brings its
connection up without opening a window at you on every sign-in.

## The panel knows your state by itself

The panel used to be a window onto a separate web application, reached with an access code,
over a tunnel, from a server started by hand on the same machine. So the answer to *"is my
Spark verification still pending?"* depended on that server being up — and when it was not,
the panel asked for a code that could not work and explained nothing.

That question never needed a language model. It is application state, sitting in a few local
files. It was being computed inside a render function, shown once and thrown away.

The **Panel** tab now shows what Claudian derives from this computer:

- what needs you, each item named and openable — an unverified connection, a refused report,
  an authorization waiting for approval, a device connection that has dropped
- every connection with its three separate facts: connected, verified, first review
- your open loops and reminders, read from your own notes — **active sections only**, so an
  unchecked box inside an archived plan is not resurrected as today's task
- what changed recently, recorded as it changed rather than reconstructed afterwards

No AI has to be open. Nothing waits for a model to write Markdown. A fact that cannot be
derived is absent rather than guessed, and the panel states when it was last derived.

Claudian records only transitions, never levels: the same picture twice is not an event.

## Why a web first review could sit "waiting" all day

Found, and it was not what it looked like.

On this machine a Spark review was issued at 09:50 under memory protocol 2.8.0 and read
successfully at 09:56 — `read_first_review` was never blocked. That afternoon, installing
0.19.1 rewrote the vault's protocol note to 2.9.0, which invalidated the request that was
still in flight. Every later call failed a configuration check. And because only *successful*
calls were recorded, the device had no trace of the attempts: "the AI never submitted" and
"Claudian refused every submission" left exactly the same evidence, which is none.

Three changes:

- An application update that moves the protocol now produces its own state — **superseded** —
  carrying both versions, instead of a generic "configuration changed". The screen says an
  update replaced the protocol after the review started, and offers to run it again.
- The model is told the same thing, in the tool's own error, instead of receiving a bare
  configuration error after doing the entire scan.
- **A refused call is recorded as refused**, with its reason, kept separate from the record of
  successful reads. The connection screen shows what Claudian turned away and why.

A moved notes folder remains a different failure with a different sentence, because it is one.

## Deploying the public site no longer involves this machine

`claudian.app`'s published pages are served by a Cloudflare Worker from its own copy — they
never touched the tunnel. What was not one action was releasing them: build, snapshot, deploy,
remembered in order, with a build folder a running server might be reading at the same time.
So "the site still says 0.19.1" looked like a tunnel problem when nobody had run the snapshot.

`npm run yayin` now does all three into its own build folder, with nothing else running. The
deployed snapshot's timestamp is published at `/snapshot.txt`, so whether the live site is
current can be answered without starting the machine it does not need.

## Signing

Still unsigned, and still not something code can fix. The build configuration now has the
place a certificate goes, so it becomes two environment variables once one exists.
`SIGNING.md` sets out the three routes and what each requires — the free one needs an
open-source licence this repository does not yet have, which is the decision that comes first.
