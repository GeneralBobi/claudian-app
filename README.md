# claudian.app

A Windows application for a local, user-owned Markdown memory shared by AI tools.

**Preview 0.19.0 — protocol 2.8.0.** The companion is under construction. A hosted device relay is available for account connectors; native account acceptance remains host-specific. This release improves local memory maintenance; it is not a guarantee that every AI host will automatically use memory.

[Windows installer](https://github.com/GeneralBobi/claudian-app/releases/download/v0.19.0/Claudian-Setup-0.19.0.exe) · [Website](https://claudian.app) · [Connection coverage](COMPATIBILITY.md)

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

## 0.18.6 corrections

Only the recommended action is accented: terminal when available, otherwise opening the AI app. Completed checks and first reviews show green confirmation with neutral retry controls. File readiness now uses the same managed-section check as connection diagnostics, so unrelated provider settings changes no longer produce conflicting status. Empty first reviews finish without onboarding questions. Hook input accepts a UTF-8 BOM and empty input; session writes retry transient Windows file locks. The reported Codex hook failure still requires native confirmation. No additional provider acceptance tests were run for this patch.

### 0.18.6: Gemini web and Perplexity

Gemini opens the actual Gemini website. Spark custom-app setup copies the device address and opens Connected Apps; without Spark, a separate guide supports manual context sharing without claiming connected memory. Gemini CLI is retained only for existing installations and is not offered for new setup. Its test results are not migrated to Gemini web.

Perplexity setup opens its Connectors page, with device OAuth and an optional AI setup guide. Account approval and real MCP calls remain separate from setup preparation. Both web connections have independent test and first-review receipts.

Gemini Spark and Perplexity account acceptance remain pending. This release adds setup support; it does not certify a connection in your account.

### 0.18.7: Guided cloud setup

ChatGPT, Gemini Spark and Perplexity now open a focused setup guide. It prepares the device URL, provides ready-to-copy form values, puts matching-code approval in the connection window, and provides an explicit unavailable-account exit. OAuth approval returns to the AI automatically. Authorization alone cannot unlock testing: the required tools must have been requested. ChatGPT web tests and first reviews require their MCP receipt, never a local-file fallback.

Provider-owned create-app forms and account eligibility still apply; this is not a marketplace-listed, one-click installation. Account acceptance is scheduled separately with Claude Code after publication.

### 0.19.0: Setup, routing and connection reliability

The controlled continuation of 0.18.7. No new architecture. Upgrading requires no migration.

Obsidian is the default note application instead of a guess derived from what happens to be
installed; plain Markdown stays as an explicit advanced choice. Claudian derives one
recommended next action from state it already had and marks a single control with it, with a
static border in place of the pulse under reduced motion. "Selected", "connected" and
"read/write verified" are stated as three separate facts, because they are. Finishing setup
now actually opens Connections; the destination was previously discarded by the panel reload.

The working Google integration is presented as **Spark**, with a Beta badge, because ordinary
Gemini chat cannot use it. Perplexity is marked **Untested**: it has never been exercised with
a real account here. No plan requirement is shown for any provider, because none is recorded
in this repository.

`offline_access` is accepted and advertised — clients asking for it were previously rejected
with `invalid_scope` — and authorization responses now carry `iss` per RFC 9207. Reconnection
uses exponential backoff with jitter. Profile writes are serialised against a second window.

`npm test` passes end to end again; the packaged smoke run was broken on 0.18.7 because it
drove its remove/re-add round trip through a retired host.

The public gateway described in the planning contract is **not** part of this release. Cloud
connections work exactly as they did in 0.18.7, over the existing device relay.
