# 0.19.2 acceptance

Run before publishing. Every item below was exercised on the packaged build, not on source.

## Automated

| Check | Command | Result |
| --- | --- | --- |
| Unit and contract tests | `npm run test:unit` | 291 pass, 0 fail |
| Source smoke | `npm run smoke` | PASS |
| Packaged smoke | `release/win-unpacked/Claudian.exe --smoke` | PASS |
| Upgrade, protocol and packaging | `node --test test/upgrade.test.cjs test/protocol-version.test.cjs test/packaging.test.cjs` | 18 pass |

The smoke run drives the packaged application and writes its screenshots to
`CLAUDIAN_SMOKE_OUTPUT`. It fails, rather than warns, on each of the defects below.

## Screens, and what the user does next

Each capture has to answer one question: looking at this screen, what do I do next? A screen
that cannot answer it is a failure, not a note for later.

| Capture | The answer |
| --- | --- |
| `reinstall.png` | Apply choices — the ticked providers are repaired, the unticked ones removed |
| `review-consent.png` | Tick the permission box; the reason the button is closed is printed beside it |
| `review-removing.png` | The unticked provider says on its own card that it will be removed |
| `next-cta.png` | Verify access — the banner names a pending state and offers the action for it |
| `verify-cta.png` | Run the test in the AI, or copy the instruction; the prompt is on screen |
| `antigravity.png` | Continue in the app, or continue in the terminal — one connection, two ways in |
| `antigravity-terminal.png` | Paste the copied instruction into the Antigravity terminal |
| `spark.png` | Start setup; the manual-sharing fallback is kept out of the primary path |
| `verify.png` | Copy the challenge into the AI and return for the result |
| `first-review.png` / `first-review-tr.png` | Read the report, or review again |
| `connection-grid.png` | Open the connection that still needs attention |
| `consent.png` | Grant and connect, after choosing read or read/write |

## Regressions named after the complaint

These assert the defect, not the implementation, because the previous suite was green while
the screens were visibly wrong.

- No setup control pulses, blinks or is otherwise animated. The keyframes and the class that
  carried them are absent from the stylesheet; no button has a computed animation; the only
  remaining keyframes belong to the in-progress spinner.
- Every pending action is aimed at a named connection, and none of them is "go to the screen
  this banner is already on".
- No verification button is offered when there is nothing it could test.
- Antigravity CLI is not rendered as a provider of its own, in the picker or in the grid.
- Choosing Antigravity installs both entry points; removing it removes both; a hand-edited
  file refuses the whole removal rather than half of it.
- Spark's primary action opens `/spark`; `/app` remains only as the labelled manual fallback.
- A web first review completes without the call the provider blocks, and a token echoed back
  by a conversation that never read anything through Claudian is refused and shown as refused.
- A retried web submission is told the review is complete instead of failing with `EEXIST`.
- The global memory seed contains no username, home path or vault path.

## Known, unchanged in this release

- The Windows installer is unsigned. `Get-AuthenticodeSignature` reports `NotSigned`, and
  Windows shows an unknown-publisher warning. This needs a certificate, not a code change.
- `remote-connector.cjs` still carries a personal hostname in its default relay URL.
- Claudian Desktop has no tray, no background runtime and no auto-start: closing the window
  quits the application and stops the device connection with it.
