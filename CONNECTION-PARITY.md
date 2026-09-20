# Connection parity — measured, and what can be retired

The question was whether the connection a normal user installs gives the same read, write and
memory capability as the old personal `Claudian Core`.

**There is no parity gap, because there are not two connections.** That is the finding, and it
replaces an earlier, wronger version of this document.

## What `Claudian Core` actually is

An installed Claude Desktop extension, `local.mcpb.claudian.claudian-memory`, whose entire
server is 825 bytes:

```js
const config = require('./installation.json');
const child = spawn(config.launcher, [config.mcpScript], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
         CLAUDIAN_DATA: config.dataDir, CLAUDIAN_HOST: 'claude-desktop' } });
process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout);
```

```json
{ "launcher":   "…\\Programs\\Claudian\\Claudian.exe",
  "mcpScript":  "…\\Programs\\Claudian\\resources\\app.asar\\mcp-server.cjs",
  "dataDir":    "…\\Roaming\\Claudian Desktop" }
```

It is a pipe. It launches **the installed application's own MCP server**, from the same
binary, against the same data directory, under the same host identity. The `0.18.4` in its
manifest is the version of the bundle that was generated, not of any Claudian code it
carries — it carries none.

## Measured

| Check | `Claudian Core` | `claudian` |
| --- | --- | --- |
| `read_note("Start Here.md")` | returns the note | returns the same note, same SHA-256 |
| `read_first_review` | `ENOENT … reviews\claude-desktop.json` | **byte-identical error** |
| Host identity | `claude-desktop` | `claude-desktop` |
| Data directory | `…\Roaming\Claudian Desktop` | the same |
| Vault | `…\Documents\Claudian` | the same |
| Tools | 16 | 16, same names |

The identical error is the strongest evidence available: both reached the same code, looked
for the same file, and failed the same way.

So capability drift between them is not unlikely — it is impossible by construction. Both are
served by `memory-capabilities.cjs`, which defines every Claudian tool exactly once.

### Two earlier claims, corrected

- *"The legacy connection uses a different transport (a tunnel)."* Wrong. Both are local stdio.
- *"It timed out, so its transport is down."* Wrong. One heavy call (`list_notes`) timed out on
  one attempt; every later read answered normally.

## The actual hazard, and the cleanup

Duplication, not divergence. Two MCP registrations run **two server processes under the same
host identity against the same data directory**. Turn ownership in the memory protocol
arbitrates exactly this, and it should not have to.

| Item | Where it lives | Status |
| --- | --- | --- |
| Duplicate registration | Either the `local.mcpb.claudian.claudian-memory` extension in Claude Desktop, or the `claudian` entry in `~/.claude.json` | **Cleanup candidate. Keep exactly one.** Local extension/config — no account, tunnel or remote record is involved, and either is reinstallable from the app |
| Dead `Claudian Core — Personal` OpenAI tunnel (`tunnel_6a8db8…`) | OpenAI platform control plane | Dead, holds nothing. Delete from the Platform tunnels page — not by minting an admin key, which was rejected for a reason that has not changed |
| Five revoked `gemini` grants | `remote-grants.json` | Harmless. They are the evidence trail for the first-review investigation; keep until one Spark review completes |
| `Direct` / cloudflared connector for MCP | this machine | Superseded by the device relay for MCP purposes. The tunnel still serves the personal web Core, which is a separate decision |
| Web Core access-code client | `companion-bridge.cjs`, preload, renderer | **Removed from the product.** The bridge file is kept, no longer attached, and nothing in the UI can reach it. The Panel derives its own state |

Nothing above was deleted in this release. The first row is the only one that changes
behaviour, and it is a local registration the owner should remove from whichever side they
prefer to keep.
