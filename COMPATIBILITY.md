# Connection coverage — 0.18.1

Installation and actual conversation behavior are separate checks. Connections offers a file-access challenge; it is not a complete long-conversation acceptance test.

| Host | Installed integration | Acceptance evidence |
| --- | --- | --- |
| Claude Code | Skill, startup rule, local MCP, conversation hooks | Controlled 20-turn CLI session passed |
| Codex | Skill, global AGENTS block, local MCP, conversation hooks | Controlled 5-turn CLI session passed; hooks need host trust |
| Claude Desktop | Local MCP configuration and generated .mcpb | Packaged extension read/write tests; native conversation acceptance pending |
| Gemini CLI | Skill, context file, local MCP | Configuration tests; installed client returned UNSUPPORTED_CLIENT; account login alone is not proof |
| Antigravity / CLI | Skill and context file | Configuration tests; real conversation acceptance pending |
| ChatGPT | Hosted device relay, guided account OAuth | Live HTTPS OAuth/read/write/revoke passed with synthetic client; real account acceptance pending |

Claude Code and Codex acceptance explicitly supplied generated settings and instructions in isolated synthetic vaults. Codex hook trust was explicitly enabled for that controlled fixture. Neither result proves that a freshly installed native host automatically activates the connection.

Claude hooks can request a bounded retry for a missing review. Codex observes a missed final review without an automatic Stop retry, because that retry can create another user turn. Both record incomplete maintenance. MCP-only and file-only hosts do not have the same lifecycle hooks.

Cursor is no longer offered for new connections (13.09.2026). A Cursor connection made by an earlier version can still be repaired and removed from Connections.

Restart the selected AI application after setup. Review any host permission or trust request. Existing unrelated configuration and user rules are preserved. A conflicting same-name server is reported instead of overwritten. No account OAuth permission is obtained merely by editing local configuration.

The connection test now uses host-scoped MCP test tools; the hidden-note boundary remains in place. A real Claude test read and submitted the challenge successfully. The provider-memory pointer is available under Connections, but saving it in a provider account is not automatically verified.
