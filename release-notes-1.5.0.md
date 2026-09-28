# Claudian 1.5.0

Phone app 0.10.0 ships with this release.

- **A recording knows what it was.** The engine compares a recording's time with your own notes: the weekly hours in your course notes (`tür: ders`), your event notes (`tür: etkinlik`) and the day's timed reminders. The note writer picks the one the conversation is actually about, or none. A club meeting held during a lecture hour is not filed under the lecture. The note gets a course or event line and a link, the course note lists the recording, and a meeting reminder links to its recording. Relative dates such as "in tomorrow's lab" are resolved from the course's timetable.
- **ChatGPT writes notes again, with no tools.** Choose Claude (in the Claudian cloud) or ChatGPT (on your computer, with your own ChatGPT sign-in). Codex runs with every tool switched off: no shell, no files, no browser, no connectors, no web search. Its answer is checked against the same structure as Claude's, and Claudian builds the note itself. If ChatGPT cannot write, the note is written by Claude and says why.
- **One note per recording, at the right time.** The phone and the computer now write the same note, `Yüzük/<date> <time> <title>.md`, in local time. Before, a phone recording was written twice, and the computer's copy carried a UTC hour.
- **Reminders close themselves.** A timed reminder is marked "time passed, reminded" when its hour comes, and an all-day one when its day ends. On the phone, a reminder from your vault has **Done** and **Tomorrow again** buttons that work without opening the app, and they wait on the phone if there is no connection.
- **Install on another computer, from a folder.** "Prepare package" writes a `Yuzuk-kurulum` folder (USB drive or any folder, about 2 GB) with the signed installer, the signed engine package, the models and the tools. On the other computer, run the installer, then in Yüzük choose **Install from a folder**. Any folder works: every file whose checksum matches is taken from it, and only the rest is downloaded. An engine folder copied by hand before 1.1 lends its models; its code is never used.
- **Less text.** The Yüzük screen and the phone app lost their explanatory paragraphs: a title, a state and a button.
- **Site:** `claudian.app/install?from=…` and the other public pages now work with query parameters.

## Security

- ChatGPT as a note writer runs locally with every Codex tool switched off, a read-only sandbox, an empty temporary folder, no user configuration, and a required output schema. In a test, the tool calls it attempted failed.
- The transcript for a ChatGPT note goes from your computer to OpenAI under your own ChatGPT account; it does not pass through the Claudian cloud. See claudian.app/yuzuk/gizlilik.
- Course, event and reminder context is read only for the computer owner's own recordings. It never reaches another account's recording.

**Knowingly still open**

- New computers reach the cloud through Cloudflare's quick tunnel, a testing feature without an uptime guarantee.
- The Windows installer is not Authenticode-signed; updates are verified with the publisher's Ed25519 signature.
- **Legal compliance is not settled** (consent of people nearby, KVKK, voiceprints as biometric data, Google Play Data Safety).
