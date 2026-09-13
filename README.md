# claudian.app

A Windows application for a local, user-owned Markdown memory shared by AI tools.

**Preview 0.18.4 — protocol 2.8.0.** The companion is under construction. A hosted device relay is available for account connectors; native account acceptance remains host-specific. This release improves local memory maintenance; it is not a guarantee that every AI host will automatically use memory.

[Windows installer](https://github.com/GeneralBobi/claudian-app/releases/download/v0.18.4/Claudian-Setup-0.18.4.exe) · [Website](https://claudian.app) · [Connection coverage](COMPATIBILITY.md)

## Setup and updates

Setup proposes a new folder under Documents and lets you change its path or choose an existing vault. A detected personal vault is never selected implicitly. Preview the changes and choose read-only or read/write access before installation.

Updates preserve existing user notes and customized protocol copies. The runtime has an application-owned protocol, and generated skills include a fallback: removing the vault protocol copy does not remove the memory instructions. Removing a connection preserves the notes.

Connections distinguishes installed files, file-access verification and observed conversation maintenance. Technical capability names, configuration paths and repair are available on demand. No remote connection is claimed from installing local files.

## Memory maintenance

Local MCP tools provide bounded retrieval and guarded create, patch, append and archive operations. Updates use current content hashes, backups and write receipts. Conversation hooks and memory reviews expose missing checks; a later successful turn does not erase earlier failures. Long tool sequences request another review.

These controls verify writes and observed checks, not the model's semantic judgment. Direct filesystem writes outside these tools do not receive these protections. External writers can still race; receipt storage is local, not a tamper-proof audit system. Archive is reversible and is not permanent erasure of backups.

## Validation

224 unit tests and the Electron setup smoke test pass. Controlled real-model tests passed 20 Claude Code turns and 5 Codex turns, checking final notes, cancellation, preferences, no-op turns and quiet maintenance. These sessions explicitly supplied generated instructions and connector configuration in synthetic vaults. They do not establish automatic activation in all native apps. See acceptance/ for sanitized evidence.

## Development

Use Windows and Node.js 22.12 or newer:

```sh
npm ci
npm test
npm start
npm run dist
```

Installers are generated in release/. End users do not need a separate Node.js installation for the packaged local bridge. AI applications and their accounts are separate installations.

The installer is unsigned. Production signing and Windows VM install/uninstall coverage remain incomplete. Notes stay in the selected folder; application state and migration backups live under %APPDATA%/Claudian Desktop.

This public repository excludes personal vaults, credentials and the separate legacy backend. Third-party font licenses are included; an application redistribution license has not yet been assigned.

The connection test now uses host-scoped MCP test tools; the hidden-note boundary remains in place. A real Claude test read and submitted the challenge successfully. The provider-memory pointer is available under Connections, but saving it in a provider account is not automatically verified.

## 0.18 connection experience

AI tools appear in a compact status grid. Selecting a tool opens its setup and verification dialog. Read/write proof and first-review receipts are separate and persist across restarts. A simple acknowledgement is never counted as proof. Instructions no longer force a response language. Windows launchers use an instruction file to preserve paths with spaces and smart quotes.

The deployed relay passed HTTPS OAuth, authenticated read/write and revocation acceptance with a synthetic client. This is service evidence, not a claim that every provider account or mobile surface is verified.

## 0.18.4 corrections

Only the recommended action is accented: terminal when available, otherwise opening the AI app. Completed checks and first reviews show green confirmation with neutral retry controls. File readiness now uses the same managed-section check as connection diagnostics, so unrelated provider settings changes no longer produce conflicting status. Empty first reviews finish without onboarding questions. Hook input accepts a UTF-8 BOM and empty input; session writes retry transient Windows file locks. The reported Codex hook failure still requires native confirmation. No additional provider acceptance tests were run for this patch.
