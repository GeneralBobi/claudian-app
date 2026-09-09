# Claudian AI connections

Implemented adapters as of 2026-09-09. Paths are relative to the user's home directory. These are conversation-time instructions, not an unattended agent or an OAuth grant.

| Application | Skill | Automatic context |
| --- | --- | --- |
| Claude Code | `.claude/skills/claudian-memory/SKILL.md` | `.claude/rules/claudian-memory.md` |
| Codex | `.agents/skills/claudian-memory/SKILL.md` | Active `CODEX_HOME/AGENTS.override.md` or `AGENTS.md` |
| Cursor Agent | `.agents/skills/claudian-memory/SKILL.md` | `.cursor/rules/claudian-memory.mdc`, alwaysApply |
| Gemini CLI | `.agents/skills/claudian-memory/SKILL.md` | `.gemini/GEMINI.md`, respecting user context.fileName |
| Antigravity | `.gemini/config/skills/claudian-memory/SKILL.md` | `.gemini/GEMINI.md` |
| Antigravity CLI | `.gemini/antigravity-cli/skills/claudian-memory.md` | `.gemini/GEMINI.md` |

Shared destinations are written once. Existing global instructions are appended with a backup. Existing unmanaged Claudian files cause a conflict instead of being overwritten. Additional applications can be connected from the panel without replacing the vault; unchanged files owned by the previous installation are reused.

Restart the selected host after installation. The host can still require skill activation, trusted-workspace or folder-access consent. Workspace overrides, disabled skills, custom provider settings and older host versions can affect activation. Cursor support concerns Agent Chat, not Tab completion or Inline Edit.

The automated checks cover installation files, preservation and integration planning. Real provider sessions and visual acceptance are left to the user; installation status is not evidence of model behavior. The existing per-host read/write challenge remains available in the panel.

## References

- [Cursor rules](https://prod.cursor.com/help/customization/rules)
- [Cursor skills](https://prod.cursor.com/help/customization/skills)
- [Gemini skills](https://geminicli.com/docs/cli/skills/)
- [Gemini context](https://geminicli.com/docs/cli/gemini-md/)
- [Antigravity skills](https://antigravity.google/docs/skills)
- [Antigravity rules](https://antigravity.google/docs/rules-workflows)
- [Antigravity CLI skills](https://antigravity.google/docs/cli/plugins/)
- [Antigravity CLI context migration](https://antigravity.google/docs/gcli-migration)
