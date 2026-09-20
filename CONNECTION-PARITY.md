# Connection parity — measured, and what can be retired

Three generations of connection have been alive at once: the old personal `Claudian Core`,
a cloudflared `Direct` connector, an OpenAI Secure MCP Tunnel, and the connection a normal
user gets today. The question that decides whether any of them can go is narrow:

> Does the connection a normal user installs give the same read, write and memory capability
> as the old personal one?

## The answer is structural, not a coincidence

Both connections are served by the **same file**. `memory-capabilities.cjs` defines every
Claudian tool exactly once; `remote-http.cjs` exposes that list over the device relay, and
`mcp-server.cjs` exposes the same list over stdio to a locally launched host. There is one
capability implementation and several ways to reach it.

So parity is not something that was achieved and could drift. It is the shape of the code:

| | Old `Claudian Core` | Global `Claudian — Bu cihaz` |
| --- | --- | --- |
| Tool definitions | `memory-capabilities.cjs` | **the same file** |
| Tools exposed | 16 | 16, identical names |
| Read notes | `read_note`, `list_notes`, `search_notes`, `noticed` | same |
| Write notes | `write_note`, `patch_note`, `append_note`, `archive_note`, `capture` | same |
| Session entry | `startup_context` | same |
| Turn accounting | `begin_memory_turn`, `memory_review` | same |
| Connection proof | `read_connection_test`, `submit_connection_test` | same |
| First review | `read_first_review`, `submit_first_review` | same |
| Scope filtering | profile access, read-only drops write tools | same code path |
| Vault | the selected folder | the selected folder |

What differs is transport and authorisation, and only there:

| | Old `Claudian Core` | Global `Claudian — Bu cihaz` |
| --- | --- | --- |
| Transport | named tunnel / personal endpoint | HTTPS long-poll to the device relay |
| Authorisation | pre-arranged, personal | OAuth + DCR + PKCE, approved by matching code in the app |
| Revocation | manual, outside the app | per grant, in the connection screen |
| Requires a batch file on this desktop | yes | no |

## Measured today

- The global connection answered a full `list_notes` against the real vault (91 notes), and
  committed write receipts during this session. Working, in both directions.
- The old `Claudian Core` connection **timed out**. Its transport is not running, and has not
  been for the whole day.
- The only local MCP registration on this machine is `claudian`, pointing at the installed
  `Claudian.exe`. The legacy entries are account-side, not on disk here.

So the normal user's connection is not merely at parity — it is the only one of the two that
currently works, and it carries capability the old one never had: per-grant revocation,
authorisation approved against a code shown in the app, and a device that can be disconnected
without touching the vault.

## Cleanup plan

Nothing is deleted here. Each row states what has to be true before it can be.

| Item | Where it lives | Safe to remove when |
| --- | --- | --- |
| Dead `Claudian Core — Personal` OpenAI tunnel (`tunnel_6a8db8…`) | OpenAI platform, control plane | Now. It is dead and holds nothing. Delete it from the Platform tunnels page — deliberately not by minting an admin key, which was rejected for a reason that has not changed |
| Legacy `Claudian Core` connector on the AI account | claude.ai / provider connector settings | After one first review completes over the global connection on 0.20.0. Until then it is the control for that comparison |
| Five revoked `gemini` grants | `remote-grants.json` | After the same run. They are the evidence trail for why a review sat waiting, and they cost nothing |
| `Direct` / cloudflared connector for MCP | this machine | Now, for MCP purposes. The device relay replaced it and the relay is healthy. The tunnel still serves the personal web Core, which is a separate decision |
| Web Core access code in the desktop | `companion-bridge.cjs`, IPC handlers | Already off the default surface in 0.20.0: the Panel derives its own state and asks for no code. The handlers stay until you decide whether a remote Core is still wanted at all |
| `run.bat` as a product dependency | this machine | Gone for the desktop and gone for the public site. It still starts the personal web Core, which is now the only thing that needs it |
| `relay/*` in the public repository but deleted locally | both | Decide one way. Either the worker source belongs in the repository and should come back locally, or it does not and should leave the repository. Split is the only wrong answer |

The first two rows are the only ones that need a specific event rather than a decision, and it
is the same event: one completed first review over the global connection.
