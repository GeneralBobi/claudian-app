# Claudian 1.7.0

- **Install on another computer in seconds, without the internet.** The install package now carries Python and every library the engine needs, as signed files from this release. On a test computer the whole install took 26 seconds instead of 20 minutes. Only signing up with the Claudian cloud needs a connection.
- **Only signed libraries.** The engine's libraries no longer come from PyPI at install time; they come from this release, checked against the publisher's signed checksum list.
- **Set up ChatGPT and Gemini from Claudian.** In Yüzük → Note written by, a writer that is not ready shows its next step: Install, then Sign in. ChatGPT installs OpenAI's own Codex build (pinned, signature checked); Gemini runs Google's own Antigravity installer in a window you see. Signing in happens in your browser; Claudian never sees your account.
- **New devices are announced.** When a new phone or computer waits for approval, the owner's Claudian shows a notification; clicking it opens the admin panel.
- **The ChatGPT writer locks every tool of the Codex version it finds.** The list of switched-off features is read from that Codex itself, so a newer Codex cannot bring a new tool in unnoticed.
