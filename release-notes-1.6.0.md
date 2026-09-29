# Claudian 1.6.0

Phone app Yüzük 0.11.0 ships with this release.

- **Gemini writes notes.** Choose Claude, ChatGPT or Gemini. Gemini runs on your computer through the Antigravity CLI with your own Google sign-in; Google no longer lets personal accounts use the Gemini CLI. It runs in a separate, empty home and folder, and a hook blocks every tool before it starts, web search included. If Gemini cannot write, Claude writes the note and the note says so.
- **The recording is kept until its note is written.** The phone saves the audio, sends it to your computer, and deletes it once the note is in Obsidian. If there is no connection, the recording waits on the phone. The offline speech model is gone; it is no longer needed.
- **The phone app is called Yüzük again.**
- **One phone, one entry.** Re-pairing the same phone, or reinstalling the app, replaces its old entry and keeps its approval.
- **Less text.** The phone install page has two buttons, Download and Pair. Error messages are one line.

## Security

- Gemini: a PreToolUse hook allows only the final answer; every tool call, including web search, file reads, commands, image generation and subagents, is denied. The deny list in agy's own settings does not stop web search, so the hook carries the lock. If the hook fails, the tool does not run.
- The transcript for a Gemini note goes from your computer to Google under your own Google account; it does not pass through the Claudian cloud.
- The engine behind yuzuk.claudian.app is now behind Cloudflare Access. Only the Claudian cloud, with its service token, reaches it. The calendar feed stays public, protected by its own key.

**Knowingly still open**

- New computers reach the cloud through Cloudflare's quick tunnel, a testing feature without an uptime guarantee.
- The Windows installer is not Authenticode-signed; updates are verified with the publisher's Ed25519 signature.
- **Legal compliance is not settled** (consent of people nearby, KVKK, voiceprints as biometric data, Google Play Data Safety).
