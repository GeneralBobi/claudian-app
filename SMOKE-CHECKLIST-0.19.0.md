# 0.19.0 manual smoke checklist

Run on a machine that does **not** already have Claudian, then repeat the upgrade section on
a machine that is currently running 0.18.7. Automated tests cover the logic; this list covers
what only a person looking at the screen can confirm.

Installer: `release/Claudian-Setup-0.19.0.exe`
SHA-256: `343a738a03ffcde19443a92b1c40f3217f5eb90597730154e93cd2b3c82b492d`

## A · Fresh install, no Obsidian present

| # | Step | Expected |
| --- | --- | --- |
| A1 | Run the installer, open Claudian | Setup window, not the panel |
| A2 | Look at **Note application** | **Obsidian** is selected, and it is the first option |
| A3 | Same field | Markdown appears as "Plain Markdown files (advanced)" |
| A4 | Below the form | A warning callout says Obsidian is not installed, with **Download Obsidian** |
| A5 | Count the pulsing controls on the screen | Exactly one |
| A6 | Windows Settings → Accessibility → Visual effects → Animation effects **off**, reopen | The pulse is gone; the same control has a solid orange border |
| A7 | AI applications section | Provider cards, not a row of checkboxes |
| A8 | The Google card | Reads **Spark**, carries a **Beta** badge, says it runs inside Spark and not ordinary Gemini chat |
| A9 | The Perplexity card | Carries an **Untested** badge |
| A10 | Every card | No "Requires Plus/Pro/Team/Enterprise" anywhere |
| A11 | Continue → permission screen | The action row stays visible; it says which box is unticked |
| A12 | Tick the permission box | The reason text changes and the button starts pulsing |
| A13 | Grant and connect → wait | Progress, then "Your notes folder is ready. One step left." |
| A14 | Read that screen | It says nothing is connected yet; **Set up AI connections** is the pulsing control |
| A15 | Press **Set up AI connections** | The panel opens on **Connections**, not Memory |
| A16 | Connections screen | A banner names the missing step with one action |

## B · Obsidian restart path

| # | Step | Expected |
| --- | --- | --- |
| B1 | Install Obsidian, leave it **running**, open Claudian → Memory | Press **Open in Obsidian** |
| B2 | After the press | A warning callout with a triangle: "Obsidian restart required", one pulsing action |
| B3 | Read it | It states that nothing was changed |
| B4 | Quit Obsidian completely, press the callout action | The vault registers and the home note opens; the callout is gone |
| B5 | Without ever pressing the button | The restart warning must **never** appear on its own |

## C · Selected is not connected

| # | Step | Expected |
| --- | --- | --- |
| C1 | Connections, a selected but unconnected provider tile | Two lines: "Selected · Not connected" |
| C2 | Finish that provider's connection | The same tile reads "Selected · Connected" |
| C3 | Run the read/write test and pass it | The evidence line reads "Read/write verified" |
| C4 | With one connection usable, open Memory | The Setup incomplete banner is gone |

## D · Landing behaviour

| # | Step | Expected |
| --- | --- | --- |
| D1 | Close and reopen Claudian with setup still unfinished | It does **not** force you to Connections; the banner is visible instead |
| D2 | Navigate to Memory, close, reopen | You are not dragged off the screen you chose |
| D3 | With at least one usable connection, reopen | Normal Memory landing, no banner |

## E · Upgrade from 0.18.7

| # | Step | Expected |
| --- | --- | --- |
| E1 | Install 0.19.0 over an existing 0.18.7 | Opens without a migration prompt |
| E2 | Notes folder | Same path, same files, nothing rewritten |
| E3 | Existing connections | Still listed, still installed |
| E4 | A profile that had Gemini selected | Now displayed as **Spark**; the connection still works |
| E5 | An existing cloud grant | Still authorizes; no re-pairing requested |
| E6 | Open two Claudian windows, change a setting in each | Neither change is silently lost |

## F · Cloud connection (only if an account is available)

| # | Step | Expected |
| --- | --- | --- |
| F1 | Start a ChatGPT connection | The approval screen states the application name is self-declared and unverified |
| F2 | The pairing code on screen and in the browser | They match before you approve |
| F3 | Disconnect the relay, watch reconnection | Retries slow down instead of hammering every 3 seconds |
| F4 | Complete the flow | Tools become available and the connection test passes |

> Perplexity is **not** part of the acceptance criteria. It has never been exercised with a
> real account; do not record it as working.
