# Claudian 1.1.0

Yüzük can now be installed on a computer that has never had it. Until this release the engine had to be copied from a computer that already ran it, and on a new computer the app suggested a folder that only existed on the developer's machine.

- **One button installs the engine.** Yüzük → "Install the engine on this computer" downloads everything it needs into your own user folder (`%LOCALAPPDATA%\Claudian\yuzuk-motor`): the engine, Python 3.12, its libraries and about 1.7 GB of speech models. It never writes to Program Files or to Claudian's own install folder. Free space is checked before the first byte is downloaded, and if the connection drops it continues where it stopped.
- **Only signed code is unpacked.** The engine package comes from this release on GitHub and is unpacked only if it is listed in the release's checksum file and that file carries the Claudian publisher's signature, the same check app updates pass. Python, the libraries, the models and the connection tool are pinned to exact versions and SHA-256 digests; a file that does not match is discarded.
- **Graphics card or processor, said plainly.** With an NVIDIA card the installer adds the CUDA library Whisper needs; without one Whisper runs on the processor. Which one is used is reported after the model has actually been loaded, not guessed.
- **A new computer registers itself and waits for approval.** During the test phase a newly installed computer joins the Claudian cloud as its own account's processing computer and waits until it is approved; its phones wait too. Nothing is lost while waiting. Phone recordings of that account are processed on that computer and also written into that computer's vault, which is why notes no longer stay only on the phone.
- **No computer, no silent failure.** The phone and the desktop now say which of these it is: there is no computer for this account yet, the computer has not connected yet, it is waiting for approval, or it is switched off (with when it was last seen).
- **"Choose engine folder" only chooses.** It is kept for an engine that is already on this computer and says clearly when a folder is not an engine. "Prepare package" is offered only when this computer has a working engine.
- **Your AI connections move to relay.claudian.app without breaking.** The first relay address carried a person's name. This computer now uses relay.claudian.app for itself and for every new connection. ChatGPT and Gemini connections that were added under the old address keep working: that address still answers for them, as itself. Re-adding them with the new address is optional and can happen at any time; the old address is retired only after that.

## Security

**Closed in this release**

- A new computer no longer needs a hand-copied engine folder (which could carry another computer's keys); the installer only unpacks a package the publisher signed.
- Program Files and the app folder are refused as install locations.
- The cloud accepts only its own kind of tunnel address from a computer's heartbeat and never changes the address of an existing named connection.

**Knowingly still open**

- New computers reach the cloud through Cloudflare's account-free "quick tunnel", which Cloudflare describes as a testing feature with no uptime guarantee. It fits the test phase; a larger rollout needs a named tunnel per computer or a cloud processing node.
- The Windows installer is still not Authenticode-signed.
- **Legal compliance is not settled** (consent of people nearby, KVKK, voiceprints as biometric data, Google Play Data Safety). Nothing in this release should be read as that review.
