# Security policy

Suno Desktop wraps a website that people sign in to, so we take security reports seriously. Thanks for helping keep users safe.

## Supported versions

Only the **latest release** gets security fixes. Installed copies update themselves automatically; portable builds have to be replaced by hand.

| Version        | Supported |
| -------------- | --------- |
| Latest release | ✅        |
| Anything older | ❌        |

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for security problems.**

Report it privately through GitHub instead: go to the [Security tab](https://github.com/Cat-things/suno-desktop/security) and click **Report a vulnerability** (or use [this direct link](https://github.com/Cat-things/suno-desktop/security/advisories/new)). Only the maintainers can see these reports.

Helpful things to include:

- The app version (Settings → About) and your Windows version
- What an attacker could do, and what they need first (for example "a malicious link the user clicks" or "code running on suno.com")
- Steps to reproduce, or a proof of concept
- Any logs from `%APPDATA%\Suno Desktop\logs\main.log` that matter

Never include your Suno password, session cookies or other account tokens in a report.

## What happens next

- We aim to acknowledge reports within **5 days** and to share a first assessment within **14 days**.
- We'll keep you posted while we work on a fix, and agree on a disclosure date with you. Fixes ship as a normal release, which installed copies pick up automatically.
- With your permission, we'll credit you in the release notes and the published advisory.

This is a small volunteer project, so timelines are goals rather than guarantees.

## Scope

**In scope**: anything in this repository, for example:

- Remote content (suno.com, sign-in pages, anything they load) escaping the sandbox, reaching Node.js, or calling app IPC it shouldn't
- Bypassing the navigation allowlist, the permission policy or the IPC sender/payload checks
- `window.sunoDesktop` or the plugin bridge exposing something privileged
- Malicious `suno-desktop://` deep links doing more than opening a suno.com page
- Tampering with downloads or auto-updates
- Problems in our build and release pipeline (GitHub Actions, packaging)

**Out of scope**:

- Bugs in suno.com itself, your Suno account or billing. Report those to Suno at [help.suno.com](https://help.suno.com).
- Bugs in Electron or Chromium that this app doesn't make worse. Please report them upstream (Electron's [security policy](https://github.com/electron/electron/security/policy)). If our configuration makes an upstream bug exploitable, that _is_ in scope.
- Attacks that need admin rights, physical access, or malware already running as your user
- The SmartScreen warning on unsigned builds (code signing is on the roadmap)
- Social engineering, spam or denial of service

## How the app is hardened

The short version: every web page runs sandboxed with context isolation and no Node.js; the page bridge is read-only; every IPC message is checked for sender, origin and payload; only suno.com and Suno's sign-in providers load inside the app; and suno.com only gets the permissions it needs, with a prompt before microphone use. The full details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).
