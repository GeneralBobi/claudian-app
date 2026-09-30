# Claudian 1.8.2

- **Claude Code inside the Claude app keeps its memory turns.** A Claude Code session started from the Claude app is served by the app's own Claudian connection, but its prompt hook opened each turn under the Claude Code name. A turn with nothing to save could then not be closed, and was counted as unreviewed. The hook now opens the turn under the connection that actually serves it; Claude Code in a terminal is unchanged.
