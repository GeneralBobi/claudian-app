# Claudian 1.0.0

This release is about one question: what can a sentence spoken near the ring make Claudian do? The answer is now: nothing. Anyone near a recording can put words into its transcript, including "delete that folder" or "forget your rules". Those words become part of the note, never an instruction.

- **Notes are written by a call that has no tools.** The note writer is no longer an agent program on your computer (Claude Code, Codex, Gemini): those carry file, shell, browser and connector tools, and for Codex and Gemini there is no single documented switch that closes all of them. The transcript now goes to the Claudian cloud, which makes one plain API call to Claude with no tools at all and returns a structured answer. The writing key stays in the cloud; it is not in this app, the phone app or any download. A saved "ChatGPT" or "Gemini" choice falls back to Claude, and the note says so.
- **The engine builds the note, not the model.** The model returns fields (title, summary, sections, reminders, follow-ups) that must match a fixed schema; anything else is refused and no note is written. The engine writes the markdown itself and neutralises anything Obsidian could run or open: HTML and scripts, Templater and Dataview code, code fences, links and embeds. Reminders come only from their own field, with a checked date.
- **What was said stays data.** The transcript travels as a marked data block; tags, speaker labels and role labels inside it are escaped. Your own voice does not grant authority either: "make a website from this conversation" becomes a line in the note, and only a request with a clear date or time ("remind me at 19:00") becomes a reminder. The privacy filter runs in code before and after the writer, and no sentence can switch it off.
- **Notes from recordings are marked.** They carry `kaynak: ses`. The vault protocol now says that sentences in such notes are data, and `read_note` flags these notes so an AI reading your memory later is told the same.
- **Approved devices only, with a quota (test phase).** A newly paired phone waits until it is approved; until then it can see why it is waiting, and its recordings stay on the phone. Each device has a daily and monthly quota. When a spending limit is reached, the phone says "this month's quota is used up" instead of failing quietly. Token counts and an estimated cost are recorded per device and day; the transcript and the note are never stored in the cloud.
- **An admin panel for the test phase** at admin.claudian.app shows pending and approved devices, approve and revoke, per-device quotas, and per-device, per-day requests, tokens and estimated cost, plus download and active-use counts. It shows numbers only. It opens only behind Cloudflare Access; until Access is set up it stays closed.
- **The audit tool counts attempts.** `yuzuk_audit` now also reports how many instruction-like sentences the transcripts contained (a count, no content) and which prompt version the writer uses.
- The phone app's privacy policy (claudian.app/yuzuk/gizlilik) now says that during the test phase transcripts are sent to Anthropic from the Claudian account to write notes, and that Anthropic deletes API inputs and outputs within 30 days.

## Security

**Closed in this release**

- Agent programs no longer write notes, so a transcript cannot reach a shell, the file system, the network or a connected tool through the writer.
- The writer's output is schema-checked and turned into markdown by fixed code; nothing the model writes can run in Obsidian.
- The phone engine's job IDs are now visible only to the account that created them (read and delete).
- A new device cannot record, sync the vault or read reminders before it is approved; revoking takes effect on the next request.
- Per-device quotas and spending-limit errors are handled; the cloud refuses any prompt that is not the published one.

**Knowingly still open**

- The Windows installer is still not Authenticode-signed; updates are verified with the publisher's Ed25519 signature, but Windows shows "Unknown publisher" on first install.
- Cloudflare Access in front of the engine's tunnel (yuzuk.claudian.app) and moving connections off the old relay address are separate steps that change live connections; they are done only with explicit approval.
- ChatGPT/Codex and Gemini are closed as note writers rather than locked down; they can return once a no-tools mode can be verified.
- **Legal compliance is not settled.** Consent of the people around you, KVKK, voiceprints as biometric data, and Google Play's Data Safety form still need a lawyer's review. Nothing in this release should be read as that review.
