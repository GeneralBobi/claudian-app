# Claudian 1.6.1

Phone app Yüzük 0.11.1 ships with this release.

- **Sync only runs on the vault itself.** Choosing a folder inside the vault (for example Yüzük) as the phone's vault copied the whole vault into that folder. The phone now accepts only a folder that contains `.obsidian`, and sync checks this before it starts.
- **Copies from that mistake are cleaned.** A file under Yüzük/ on the phone that is a copy of a file elsewhere in the vault is not sent to the computer; an exact copy is deleted from the phone.
- Older phone versions can no longer sync; they are asked to update.
