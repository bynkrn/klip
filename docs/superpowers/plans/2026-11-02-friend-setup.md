# Friend Setup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produce one Windows x64 setup executable with Turkish/English and basic startup choices.

**Architecture:** A per-user NSIS wizard installs the existing Electron/native runtime at a stable writable location. It writes a small installation seed containing only the selected language and startup preferences; the app consumes each installation seed once while preserving other settings.

**Tech Stack:** Existing Electron 44 / Node, PowerShell, pinned portable NSIS 3.12.

**Spec:** User request in this chat: create a setup for a friend, ask language and startup preferences during installation, leave other settings in the app. Existing defaults: Windows startup and automatic buffer enabled; minimized startup optional. Existing sunset identity and icon remain.

## Global Constraints

- No personal settings, recordings, sound imports, credentials or signing private keys in the package.
- Use the current checkout and isolated build output; leave the running local runtime untouched.
- No forced process termination or game control. Preserve the buffer before any necessary local restart.
- This request authorizes a local installer, not publication of a GitHub Release.
- Updates remain anonymous, signed Release updates at the existing stable installation path.

## Review Focus

- Reopening must not reset preferences after the initial installation seed has been consumed.
- Reinstallation changes only explicit installer preferences, not recording quality or clip paths.
- Invalid/truncated seeds must not override defaults or expose arbitrary settings.
- Uninstall must preserve recordings, user settings and unrelated files.
- Fresh installs must contain all native helpers and runtime libraries without the OBS UI.

### Task 1: Installation preferences

- [x] Write and run failing behavior tests for valid EN/TR seed application, once-only semantics, a new installation ID, invalid input and missing files.
- [x] Implement `applyInstallationPreferences(settings, seedText)` and `loadInstallationPreferences(settings, filename)` in `src/installation-preferences.js`; return merged settings without mutating inputs.
- [x] Consume the packaged app's `installation.ini` before startup registration, sound initialization and auto-buffer startup in `src/main.js`.
- [x] Run the focused tests.

### Task 2: Installer and packaging

- [x] Add a pinned portable compiler bootstrap, NSIS wizard and build script.
- [x] Wizard: language choice, Windows startup, minimized startup, automatic buffer and optional desktop shortcut; Start menu and uninstall support.
- [x] Write only a fresh installation ID and the four selected preferences to the seed. Register the selected Windows login choice immediately, even when the finish-page launch is unchecked; preserve Windows StartupApproved decisions.
- [x] Block installation/uninstallation while Ember is running; never terminate it.
- [x] Generate a precise uninstall file list; use nonrecursive directory removal and keep userData/video folders.
- [x] Add an isolated output parameter to `tools/package.ps1`; build 0.6.1 without overwriting the running 0.6.0 runtime.
- [x] Include setup generation in future explicit tagged releases, not branch CI; document use.

### Task 3: Verification and delivery

- [x] Run the project suite, compile the full setup and inspect package contents.
- [x] Exercise real installer language/preferences, isolated installation, consumed seed and uninstallation while preserving unrelated files and original user settings.
- [x] Review the final change and fix findings (update archive uninstaller, previous shortcut ownership).
- [ ] Commit and push source; wait for CI.
- [ ] Deliver the local setup path and size. State that no Release has been published and that Windows publisher signing is not configured.

## Verification Record

- Full project suite: 292/292, no skips. Includes a real NSIS fixture compilation/export regression test, also enabled in branch CI.
- Production setup: 332,932,110 bytes; SHA256 `e6fb358abeee12944c24eba54fd3820d47603422f957740a2f2589b3cba08201`.
- Live-app safety: silent installation returned exit 2 without creating its target while Ember was open.
- Actual full isolated installation returned exit 0; EN, launch=1, minimized=1, autoBuffer=0 seed values and immediate Windows Run entry verified. Installed uninstaller exactly matches the executable exported into future update archives.
- Packaged 0.6.1 booted with an isolated appData/videos fixture: EN, hidden startup, no automatic buffer, F8 registered. In-app language/startup/volume changes survived another boot without being reset by the seed.
- Actual uninstall returned exit 0, removed its Windows entry and all packaged files, retained unrelated root/nested files. Personal settings hash unchanged; original 0.6.0 runtime and startup registration restored with live capture.
- NSIS input is explicitly UTF8: fixed the observed mojibake in the language chooser title; Turkish preference labels and checkbox dependency checked in a rendered wizard.
- No new Release, tag, personal sound import, sync calibration, credentials or recordings shipped.
