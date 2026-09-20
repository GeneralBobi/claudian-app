# Claudian 0.21.0

The panel knows more, interrupts less, and the application no longer carries a client for a
service that only ran when a batch file was open. Protocol stays at **2.9.0**; nothing in your
vault changes and there is no migration.

0.20.0 gave Claudian a panel that derives its own state. This one makes that derivation cover
the states it was still missing, and turns a small number of them into notifications.

## What Claudian can now work out for itself

**A reminder with a date is due, overdue, or neither.** The reminders note is the one place
your vault holds an obligation with a moment attached, and "due" was exactly the state the
panel could not derive — it listed unchecked boxes and left the reading of them to you, or to
a model, which is the thing this engine exists to stop needing.

Three spellings are understood, because these are the three your notes actually use:
`13.08.2026`, `21 Eylül 2026` / `21 September 2026`, and `2026-09-25`. A line with no
recognisable date is a reminder without a date, never one that happens to be due today, and
`31.02.2026` is not a date at all — it produces nothing rather than something invented.

Only today and past due appear under **Needs you**. Next week is a list entry. That rule is
your reminders note's own: remind without drowning, only the near ones.

**A broken connection is distinguished from an unfinished one.** Claudian already checked its
own work — the files, the folder permission, and whether the server a host would launch
actually answers — but that verdict was shown on one screen and never became state, so "this
connection is broken" could not be known with the window shut. It now is, and the failing
layer is named rather than summarised.

**A verification that was started and abandoned is its own state.** A challenge issued whose
answer never came back is not the same as one never attempted, and the panel can now say
which.

**Attention going away is recorded, not just attention arriving.** A solved problem is simply
not in the list any more — nothing has to be dismissed — and the moment it left is in the
history beside the moment it appeared.

## Notifications: five kinds, once a day, three at most

A toast is caused by a state transition the application derived from its own files, and by
nothing else. No model decides that something feels important, and a level repeated on a timer
is never news.

Only five kinds may interrupt: an authorization waiting for your approval, a broken
connection, a device connection that has dropped, and a reminder that is due or overdue.
Everything else is a line in the panel, which is where most things belong.

The same worry does not arrive twice in a day — keyed by the kind *and* the connection it is
about, so two connections failing are two notices while one connection failing repeatedly is
one. At most three a day. And resolution is deliberately silent: "your connection came back"
is good news that interrupts for nothing, so the tray and the panel show it without a toast.

**Notifications** is a checkbox in the tray menu. Turning it off turns it off, and nothing is
recorded while it is off, so switching back on does not swallow the next one.

## The client for the separate web Core is gone

Claudian still shipped the code that reached `claudian.app` with an access code — a service
that only answered while a Next server and a tunnel were running by hand on this machine. The
Panel has derived its own state since 0.20.0 and asks for no code, which left that bridge as
an unreachable piece of IPC pointed at an external origin.

It is no longer attached, its three methods are gone from the preload bridge, and the dead
screen is out of the renderer. The bridge file itself is kept rather than deleted: whether a
remote Core is wanted at all is a product decision, not a cleanup.

Nothing in the normal user's path now needs `run.bat`, a tunnel, or a source tree.

## Housekeeping

A superseded or abandoned first review used to leave its instruction file behind in your notes
folder. One is litter; a year of them is a folder you did not agree to. Starting the next
review now removes the previous instruction — never a response file, which may hold a report
that was actually received and is the one thing a review produces.

## Also

`Claudian Core` and `claudian` were measured against each other and turned out to be the same
thing: the legacy extension is an 825-byte pipe that launches the installed application's own
MCP server, same binary, same data directory, same host identity. Capability drift between
them is impossible by construction. What is real is the duplication — two servers under one
identity against one data directory — and `CONNECTION-PARITY.md` says which registration to
keep. Nothing was removed.
