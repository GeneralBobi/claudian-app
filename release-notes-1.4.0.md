# Claudian 1.4.0

Phone app 0.9.0 ships with this release. This is the first public release since 0.30.0. It carries everything from 1.0.0 to 1.4.0: the notes of each version are in the repository (`release-notes-1.0.0.md` … `release-notes-1.3.0.md`), and the short version is below.

- **1.0.0: what is said is data, never an instruction.** Notes are written by one tool-less call in the Claudian cloud and returned as a fixed structure. The engine builds the markdown and neutralises anything Obsidian could run. Notes from recordings are marked `kaynak: ses`. New devices wait for approval; each device has a quota.
- **1.1.0: the engine installs with one button** on a computer that has never had it. It installs into your own user folder and never into Program Files. Only a package signed by the publisher is unpacked, downloads resume, and a new computer registers itself and waits for approval. Connections move to relay.claudian.app without breaking the ones already added.
- **1.2.0: the phone app installs and reads better.** The install page works when no computer is on and explains the uninstall and Play Protect steps. The bottom menu sits right with three-button navigation. The data table becomes cards on a phone.
- **1.3.0: one card per AI permission, with Disconnect. Panel is off and its ghost cards are fixed.**
- **1.4.0: delete your account.** Yüzük → Settings → Account → "Delete my account" removes your account and everything the Claudian cloud keeps about it: devices, job and usage records, the computer's registration, and the voiceprint on your computer. Your notes in Obsidian stay yours. If you cannot open the app, claudian.app/yuzuk/hesap-sil explains how to ask by e-mail. In the phone app, ChatGPT and Gemini now show as "closed for now" instead of looking selectable.

## Security

**Knowingly still open**

- Note writing in the cloud needs the publisher's API key to be configured; until then the app says clearly that a note cannot be written.
- New computers reach the cloud through Cloudflare's quick tunnel, a testing feature without an uptime guarantee.
- The Windows installer is not Authenticode-signed; updates are verified with the publisher's Ed25519 signature.
- **Legal compliance is not settled** (consent of people nearby, KVKK, voiceprints as biometric data, Google Play Data Safety). Nothing here should be read as that review.
