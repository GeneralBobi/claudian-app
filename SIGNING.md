# Signing the Windows installer

The installer is unsigned. Windows therefore shows **Unknown Publisher** and a SmartScreen
warning on first run. This is not a malware detection; it is what Windows shows for any
installer whose publisher it cannot verify.

```powershell
Get-AuthenticodeSignature .\release\Claudian-Setup-0.20.0.exe
# Status : NotSigned
```

Nothing is broken and nothing was misconfigured: signing was never set up. The build
configuration now has a place for a certificate, so once one exists this becomes two
environment variables and a rebuild — and until one exists, the build behaves exactly as it
does today. **Code cannot fix this.** A certificate is an identity, and identity is issued to
a person or a company, not to a repository.

## Once a certificate exists

`electron-builder` reads these from the environment. Nothing is committed, and the build is
unchanged when they are absent:

```powershell
$env:CSC_LINK     = "C:\path\to\certificate.pfx"   # or a base64 string
$env:CSC_KEY_PASSWORD = "…"
npm run dist
```

For a certificate on a hardware token or cloud HSM — which is mandatory for every new
Authenticode certificate issued since June 2023 — the key never leaves the device, so the
build instead calls the token's signing tool. That is `win.signtoolOptions` or a custom
`sign` hook, and which one depends on the issuer; it is configured when the certificate is
chosen, not before.

Verify afterwards with the same command:

```powershell
Get-AuthenticodeSignature .\release\Claudian-Setup-<version>.exe
# Status : Valid
```

## Choosing a route

The licence question decides this, so answer it first.

| Route | Cost | What it needs | Fit |
| --- | --- | --- | --- |
| **SignPath Foundation** | Free | An OSI-approved licence, no proprietary components, a public repository, an already-released project | Open only if Claudian becomes open source. **This repository has no LICENSE file today.** |
| **Azure Trusted Signing** | Lowest per-signature | Individual onboarding was restricted during preview to US/Canada organisations with 3+ years of verifiable history | Very likely closed from KKTC |
| **OV Authenticode certificate** | ~$200–400/year | Identity validation with a CA; key on a hardware token or cloud HSM | Always available. SmartScreen reputation still accrues with downloads — the warning fades, it does not vanish on day one |
| **EV certificate** | Higher | Stricter validation, hardware token | Immediate SmartScreen reputation |

## What is not acceptable

Telling people to disable SmartScreen, to "run anyway", or to add an exclusion. If the
publisher cannot be verified, the honest answer is to publish the SHA-256 of the installer
next to the download — which this project already does — and to get a certificate.
