# claudian.app

Build your second brain. Keep it yours.

A Windows application that prepares a local Markdown memory environment for Claude Code, Codex, Cursor, Gemini CLI, Antigravity and Antigravity CLI. The first-run setup discovers existing note locations and AI configuration folders, proposes settings, previews changes, and reports real installation progress. After setup, the application opens directly into the memory panel.

**Preview software — version 0.7.0.** The proactive companion is under construction. This application does not run an always-on language model or require an API key.

## Download

[Windows installer](https://github.com/GeneralBobi/claudian-app/releases/tag/v0.7.0) · [Website](https://claudian.app)

The Windows x64 installer is unsigned. Windows may display an unknown-publisher warning. Windows VM install/uninstall coverage and production signing are not complete.

## Development

Use Windows with Node.js 22.12 or newer and npm:

```sh
npm ci
npm start
npm test
npm run smoke
npm run dist
```

The installer is generated in `release/`. End users do not need Node.js, npm, a tunnel, or a separately running web server.

## What it does

- Discovers registered Obsidian vaults and common Claudian folders without changing them.
- Detects Claude Code/Codex configuration directories and suggests connections. Directory detection is not proof of an installed or authenticated AI application.
- Creates starter notes in a new empty folder, or preserves an existing note environment.
- Installs a versioned memory skill with the exact chosen vault path, plus automatic startup instructions in Claude Code user rules and Codex global AGENTS.md (or its active override). No slash command is required. Existing Codex rules are backed up before appending a scoped Claudian block.
- Refuses to overwrite existing notes or a conflicting skill.
- Records setup progress and verifies written files.
- Separately guides a real read/write check in the chosen AI application.

The application does not install Obsidian, Claude Code, or Codex themselves. Reading notes in an AI application is subject to that application's permissions and provider data policies.

## Architecture

`core.cjs` is the filesystem setup engine. `main.cjs` owns the Electron window and narrow IPC handlers. `preload.cjs` exposes those handlers to a sandboxed renderer. `ui/` contains the local setup and memory panel. Fonts are bundled locally; their OFL licenses are included in `licenses/`.

The visual identity follows claudian.app: Poppins, Lora, JetBrains Mono, dark surfaces, off-white text, and the orange dot wordmark. No custom motion or animation is included.

This repository contains the standalone desktop preview. It does not contain personal memory, credentials, the private development history, or the separate legacy web backend.

## Data and limitations

Application state is stored under `%APPDATA%/Claudian Desktop`. Notes remain in the chosen directory. External skills and notes are preserved when the application is uninstalled.

Existing skills are not automatically migrated. Direct AI edits do not yet have application-managed version history or concurrency protection. Controlled setup cancellation rolls back unchanged files created by that run; abrupt process termination recovery is not implemented.

Claude Desktop, ChatGPT, Notion, cloud synchronization, and the autonomous companion are not implemented in this preview. The app does not claim that a copied skill guarantees automatic invocation by an AI host.

## Tests

The tests use isolated temporary directories. The Electron smoke test exercises setup, the panel transition, persistent profile state, and renderer isolation. Its AI filesystem response is simulated; it does not invoke a paid model. Use `--smoke` with a packaged executable to exercise the same diagnostic flow in an isolated profile.

The source is public for review. An application redistribution license has not yet been assigned; third-party fonts retain their included licenses.


## 0.5 connection management

Choose English or Turkish in setup. New protocol and skill files use the selected language; existing notes are preserved. The panel provides removal, configuration file locations, Obsidian and folder shortcuts, and local integrity checks. Removal preserves notes and shared dependencies. Local checks do not claim to verify AI behavior.

Validation: 26 core/management tests passed; English and Turkish DOM flows passed setup, installation, removal and reconnection. Native Electron window testing was blocked by a GPU/helper startup failure in the build environment and is not claimed as passed.

## Desktop changes in 0.7

The embedded companion panel has been withdrawn pending a native redesign. The Memory page focuses on notes; connection management lives in its own tab. Obsidian links use the registered vault ID. Unregistered folders open the vault manager with guidance for registering the selected folder.

Validation: 26 core and management tests passed, and the Windows installer was built. Full native end-to-end validation was not repeated for this release.
