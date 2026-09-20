# Connection coverage — 0.19.1

Installation and actual conversation behavior are separate checks. Connections offers a file-access challenge; it is not a complete long-conversation acceptance test.

| Host | Installed integration | Acceptance evidence |
| --- | --- | --- |
| Claude Code | Skill, startup rule, local MCP, conversation hooks | Controlled 20-turn CLI session passed |
| Codex | Skill, global AGENTS block, local MCP, conversation hooks | Controlled 5-turn CLI session passed; hooks need host trust |
| Claude Desktop | Local MCP configuration and generated .mcpb | Packaged extension read/write tests; native conversation acceptance pending |
| Spark (Google) | Hosted device relay, guided account OAuth | Setup support only. Runs inside Spark, not ordinary Gemini chat. Early access; no real account acceptance |
| Perplexity | Hosted device relay, guided account OAuth | **Untested.** Never exercised with a real account; setup support is not evidence of a working connection |
| Gemini CLI (legacy) | Preserved existing files; no new connections | Earlier local file receipts are not Gemini web acceptance |
| Antigravity / CLI | Skill and context file | Configuration tests; real conversation acceptance pending |
| ChatGPT | Hosted device relay, guided account OAuth | Live HTTPS OAuth/read/write/revoke passed with synthetic client; real account acceptance pending |

Claude Code and Codex acceptance explicitly supplied generated settings and instructions in isolated synthetic vaults. Codex hook trust was explicitly enabled for that controlled fixture. Neither result proves that a freshly installed native host automatically activates the connection.

Claude hooks can request a bounded retry for a missing review. Codex observes a missed final review without an automatic Stop retry, because that retry can create another user turn. Both record incomplete maintenance. MCP-only and file-only hosts do not have the same lifecycle hooks.

Cursor is no longer offered for new connections (13.09.2026). A Cursor connection made by an earlier version can still be repaired and removed from Connections.

Restart the selected AI application after setup. Review any host permission or trust request. Existing unrelated configuration and user rules are preserved. A conflicting same-name server is reported instead of overwritten. No account OAuth permission is obtained merely by editing local configuration.

The connection test now uses host-scoped MCP test tools; the hidden-note boundary remains in place. A real Claude test read and submitted the challenge successfully. The provider-memory pointer is available under Connections, but saving it in a provider account is not automatically verified.

## 0.18.6 — Gemini web and Perplexity setup

| Application | Setup | Acceptance boundary |
| --- | --- | --- |
| Gemini web | Spark custom app, device OAuth/DCR, Streamable HTTP | New identity `gemini`; no inherited Gemini CLI receipts. Google currently restricts custom apps to eligible personal accounts in the US, 18+, English, Spark access and Keep Activity on. Real account acceptance pending. |
| Gemini without Spark | Copy guide and open Gemini website | Manual user-selected context only; no automatic local read/write and no verified connection claim. |
| Perplexity | Private custom remote connector, OAuth/DCR, Streamable HTTP | Account custom-connector availability/admin permission required. Real account acceptance pending. |

New web connection tests and first reviews require a receipt from the corresponding MCP route as well as the expected response; a vault response written by another local application is insufficient. This is not protection from a malicious local process with access to Claudian's own data directory.

Sources checked 2026-09-14:
- https://support.google.com/gemini/answer/17209137
- https://support.google.com/gemini/answer/17094507
- https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors

Release authorized on 2026-09-14. Live AI/account acceptance tests remain deferred at the user’s request; setup support is not proof of account connectivity.

## 0.18.7 — Guided cloud installation

Setup navigation is persisted per vault/provider without marking account permission or access verified. Missing add-app options have a blocked exit. Pairing requests are shown in the current setup step; OAuth completion automatically returns to the provider. Test entry is gated by real tool-list evidence, independently of authorization. A fresh connector may need its tools refreshed before the test becomes available.

Cloud HTTP negotiates MCP 2025-03-26 / 2025-06-18 rather than always returning the older stdio protocol. This addresses a compatibility risk; it is not confirmation of the reported ChatGPT schema failure on a real account.

Provider-owned creation forms are still required. Claudian is not a published marketplace app with universal one-click installation. Setup availability is account dependent. Do not claim the three providers are accepted until Claude Code completes the post-release installation and tool-call checks.

Sources: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle ; https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt ; https://support.google.com/gemini/answer/17209137 ; https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors
