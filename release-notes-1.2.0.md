# Claudian 1.2.0

Phone app 0.8.0 ships with this release. It is about installing the phone app without surprises and reading it comfortably.

- **The install page works when no computer is on.** yuzuk-api.claudian.app/kur is now served by the Claudian cloud itself, and the app is downloaded from this public release instead of from the developer's computer.
- **The install page says what Android will say.** If a version from before 0.6 is installed, the new one cannot be installed on top of it ("App not installed", "package conflicts"): the page now says to uninstall the old one first, and that notes in Obsidian are kept. It also shows the Play Protect step ("Install without scanning" or "More details → Install anyway") for an app that does not come from the Play Store.
- **The bottom menu sits at the bottom with three-button navigation too.** On some phones it floated above the navigation bar with a gap. The system bar spacing is now requested again once the page is ready. Checked on Android 15 with both three-button and gesture navigation.
- **Offline transcription is explained where you turn it on.** It is optional and off until you download it. The app says why it exists (no audio file is kept, so without a connection transcribing on the phone is the only way not to lose what was said), what is downloaded (the open-source Whisper small model for whisper.cpp, 5-bit, about 190 MB) and that it only transcribes. It never writes the note or sends anything. It can now be removed again.
- **The listen screen says when a note cannot be written right now**, in the cloud's own words (no computer, waiting for approval, computer off).
- **"Which data, where, for how long" reads on a phone.** On narrow screens the table on claudian.app/yuzuk/gizlilik becomes one card per kind of data. The app and the desktop link to that page instead of keeping their own copies, so the text is the same everywhere.
- **No white flash on claudian.app** while scrolling on a phone.
- The phone app no longer carries the emulator-only x86_64 native library (about 3.6 MB smaller).

## Security

- The release APK is signed only with the upload key; a build without it stops. versionCode 8000.
- **Legal compliance is not settled** (consent of people nearby, KVKK, voiceprints as biometric data, Google Play Data Safety).
