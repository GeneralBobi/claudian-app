# Claudian 1.3.0

- **One card per AI permission.** Connections now show every account that approved a web connection as its own card: the name the app reported, when it connected, its last real call, whether it can write, and "Disconnect" for that one permission. Claudian never sees the e-mail behind a web permission and does not guess it. For local connections (Claude Code, Codex) the card says the connection belongs to this computer and shows the account the program itself records as signed in. No token is ever shown.
- **Panel is switched off, and its ghost cards are fixed.** Panel was a beta and is now hidden behind a flag; the code stays. Old cards kept coming back for work that had already been closed. There were four causes:
  - an item's opening date on the dashboard note was read as a due date;
  - a new card was made every night while the old one stayed;
  - cards of closed items lived for 14 days;
  - closing was read late.

  Due dates now come only from the reminders note; a new card replaces the old one for the same item; a closed item's cards are withdrawn in the same pass. Reminders and calendar notifications are not affected.
