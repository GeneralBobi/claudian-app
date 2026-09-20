# 0.19.1 manual smoke checklist

0.19.1 is a memory and runtime patch. Automated tests cover the logic; this list covers what
only a person looking at their own vault can confirm. Run the upgrade section on a machine
currently running 0.19.0 — a fresh install is covered by the 0.19.0 checklist, which still
applies unchanged.

Installer: `release/Claudian-Setup-0.19.1.exe`
SHA-256: `d5c8583cf05a43fb990c17d0e9c2339e78b7d68890204b90c7ea46f1a442de6d`

## A · Upgrade from 0.19.0

| # | Step | Expected |
| --- | --- | --- |
| A1 | Install over 0.19.0, open Claudian | The panel opens normally; no setup screen, no re-consent |
| A2 | Open the vault, look at the protocol note | Front matter reads `sürüm: 2.9.0` / `version: 2.9.0` |
| A3 | Look at any other note you wrote | Byte-identical; nothing reformatted, nothing reordered |
| A4 | Settings → memory health | No migration conflict is reported |
| A5 | If you had edited the protocol note yourself | It is untouched and reported as a conflict, as before |

## B · History is visible, and no longer current

| # | Step | Expected |
| --- | --- | --- |
| B1 | Put `> **⚠ Arşiv — yürürlükte değil (01.01.2026)**` under a heading in your decisions note, with an unchecked task below it | Saved as ordinary Markdown; readable in Obsidian |
| B2 | Start a new conversation on a connected AI, ask what is open | The archived task is **not** listed as something to do |
| B3 | In the same conversation, ask what that section used to say | The AI reads the note and answers from the archived section |
| B4 | Ask for current decisions | Only the active section is used |
| B5 | Look at your note again | Unchanged — filtering happens in the payload, never in the file |

## C · Persistent memory stops asking

| # | Step | Expected |
| --- | --- | --- |
| C1 | On a surface with account memory (ChatGPT, Claude), complete a first review | The pointer is offered once |
| C2 | Open the adapter note in the vault | `Durum:` / `State:` reads `kabul edildi` / `accepted` |
| C3 | Start a second conversation on that surface | Consent is **not** requested again |
| C4 | If you had declined earlier | The line still reads `reddedildi` / `declined`; nothing overwrote it |

## D · Memory review on a dual connection

Only relevant if both a Claude Code connection and the Claude application connection are
installed against the same vault.

| # | Step | Expected |
| --- | --- | --- |
| D1 | In a Claude Code session inside the Claude application, say something durable ("from now on, no bullet lists") | It is recorded |
| D2 | Watch the end of the turn | No `This session belongs to a different connection` message |
| D3 | Settings → memory sessions | The turn shows as reviewed; the row names which connection opened it |
| D4 | Repeat in a second turn | Still clean; the rebind does not have to happen again |

## E · Startup stays honest

| # | Step | Expected |
| --- | --- | --- |
| E1 | With a large control panel, start a conversation and ask what is open | Open items are listed; long ones may be shortened to their opening line |
| E2 | Read the end of what the AI used | It states how many records were shortened or left out |
| E3 | Ask for the detail of a shortened item | The AI reads the whole note and answers |
| E4 | Confirm nothing open is missing | Every unchecked item in an active section is reachable |
