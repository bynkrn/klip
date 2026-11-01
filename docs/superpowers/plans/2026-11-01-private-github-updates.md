# Private GitHub Updates Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans task by task.

**Goal:** Keep Klip source in private `bynkrn/klip` and provide authenticated, verified update checks at startup, every 15 minutes, and manually in Settings. A published Release or friend-ready ZIP/installer is explicitly outside the current user-authorized delivery.

**Architecture:** A bundled GitHub CLI uses the user's Windows-protected GitHub login; no token is embedded in code or release artifacts. Main process checks a pinned private repository, verifies an Ed25519-signed release manifest, downloads an exact SHA256/size-verified ZIP and stages it safely. An external updater replaces only the packaged application directory after replay preservation and graceful shutdown, with rollback if startup health acknowledgement fails.

**Tech Stack:** Electron main/renderer IPC, Node crypto, GitHub CLI, C#/.NET Windows update helper, GitHub private repository and Releases.

**Spec:** User 2026-11-01 explicitly requests private GitHub hosting, startup/background/manual checks, an in-app startup offer with Now/Later, a persistent update icon if deferred, and manual check/download.

## Global constraints
- Keep approved sunset layout and window bounds; update icon sits in title bar, no horizontal overflow.
- Startup offer only on startup check; background discoveries show the icon. Later postpones installation, not the badge.
- Private source and assets; no embedded access token. GitHub login is a one-time user action where necessary.
- No OBS GUI: use the new Klip.Capture native service, preserving quality and capture requirements.
- Preserve active replay as a clip before applying an update. Download/verification precedes app shutdown.
- Source repository excludes runtime binaries, test videos, user game profiles, credentials and signing private keys.
- Do not publish a Release or friend-ready package now. Any later explicit publication must follow actual capture/audio/UI checks.

## Tasks and ownership
- [x] Acquire the portable official GitHub CLI, establish owner login, create private `bynkrn/klip`, and initialize source Git.
- [x] Implement `src/updates.js`, signed metadata verification, authenticated lookup/download, state/auth events, native swap helper and recovery tests.
- [x] Add the title-bar badge, startup Now/Later offer, progress, Settings check/download/apply and device-code login. Later invalidates pending auto-install intent; manual download never installs.
- [x] Integrate main IPC/lifecycle, replay preservation, pinned public key/repository, version/build configuration and future release workflow tooling.
- [x] Verify signed metadata, corrupted archives, unsafe paths, immutable install handoff, actual staging/health acknowledgement and rollback in disposable dummy application folders.
- [ ] Parent finishes the current local-runtime smoke/reopen and final source upload. Do not substitute isolated fixtures for a completed live private-Release upgrade.

No distribution Release or version tag was published. Future Release creation is a separate explicit action; source commits alone do not produce an installable update. AppData, credentials, signing private keys, runtime binaries and personal/test media are excluded from source.

## UI/backend contract
IPC: update-state, update-check, update-download, update-install, update-login. update-check accepts {manual:true}; startup/background triggered in main. Main emits native-state {update:state}.
State: status idle/checking/current/available/downloading/ready/installing/error/auth-required, currentVersion, latestVersion, progress (0..1), checkedAt, notes, error, offer (startup only), loginCode/loginUrl during user-requested login.
Popup Now downloads then applies only while the user still intends Now; Later keeps the icon and must not accidentally install after a delayed download. Manual download prepares the release without closing the app; Apply is explicit.

## Review focus
Untrusted ZIP paths and unsigned/downgrade manifests; delayed UI requests installing after Later; private authentication leaking into artifacts/logs; source checkouts mistaken for packaged app roots; active replay/file operations on quit; cancellation/rollback across Windows file locks and different volumes.
