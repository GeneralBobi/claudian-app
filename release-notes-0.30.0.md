# Claudian 0.30.0

- **Signed updates.** Claudian now installs an update only if its checksum file carries the publisher's Ed25519 signature. A release that is unsigned, or signed by anyone else, is discarded instead of run. The check applies to updates offered from this version on.
- **Privacy rules you can check.** A new tool, `yuzuk_audit`, lets any connected AI ask whether the Yüzük engine's privacy rules are the published, signed version, how many audio files are sitting on disk, and how many sentences each note had removed. It returns numbers only, never note text or audio.
- **The Wi-Fi receiver is gone.** "Send over Wi-Fi" had the phone's browser record an audio file and carried it over the local network without encryption. The Yüzük phone app now does this with no audio file at all, over an encrypted connection, so the receiver and its network port were removed.
- **Safer cloud connections.** An AI application that registers but never gets your approval is removed after a day, and registrations are limited per hour, so a flood of fake registrations can no longer block a real connection.
- **Protocol text.** The note-from-recording rules no longer say that everything after someone says "don't record" is dropped; that two-minute silence rule was removed from the engine because it fired on ordinary sentences and cut notes short.
- Privacy policy updated; the phone app's policy is at claudian.app/yuzuk/gizlilik.
