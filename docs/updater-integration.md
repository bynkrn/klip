# GitHub updater integration

The integration pins public repository `bynkrn/klip`, checks at startup, every 15 minutes, and manually, and verifies signed Ed25519 metadata and exact archive size/SHA-256 before installation. Published releases provide the updater ZIP and installer. Source commits alone never install an update.

`src/updates.js` exports `Updates`, `GhTransport`, and `healthAckPath`.

```js
const updates = new Updates({
  currentVersion: app.getVersion(),
  mode: config.mode,                // public releases need no GitHub login
  repo: config.repo,                 // pinned owner/repository
  publicKey: config.publicKey,       // pinned Ed25519 SPKI PEM, never the private key
  ghPath: path.join(root, 'tools/github/gh.exe'),
  cacheDir: path.join(app.getPath('userData'), 'updates'),
  appRoot: path.dirname(process.execPath),
  installerPath: path.join(root, 'tools/update-install.exe'),
  packaged: app.isPackaged
});
updates.on('state', update => status('', {update}));
```

`state()` returns a fresh public snapshot. `check({manual, source})` accepts `startup`, `background`, or `manual`; only a successful startup check sets `offer`. Checks and downloads are coalesced. `download()` waits for an active check and produces `ready` only after streaming SHA256 and exact size verification. Operational failures return an `error` or `auth-required` state; a download without verified metadata rejects. `login()` explicitly runs GitHub's web/device flow and emits only its public device code and official login URL. No token command is used. The bundled CLI uses its normal Windows credential manager login.

Release `/releases/latest` must be published, stable, and newer, with exactly one of each:

- `ember-update.json`: exact UTF-8 signed bytes containing `{version, platform:'win32', arch:'x64', fileName:'Ember-vX.Y.Z-win32-x64.zip', size, sha256}`.
- `ember-update.sig`: standard base64 Ed25519 signature over those exact JSON bytes.
- The named ZIP, with API size equal to the signed size and only the `Ember-win32-x64/` root.

The ZIP must contain `Ember.exe` and `resources/app/package.json`, whose version equals the signed version. Package-with-ASAR layouts are intentionally not accepted by this installer.

## Apply and health acknowledgement

Main must preserve replay and finish active file operations before preparing installation. Only explicit current user intent may apply an update; downloading alone never installs it.

```js
const descriptor = await updates.prepareInstall({parentPid: process.pid});
const helper = spawn(descriptor.helperPath, descriptor.args, {
  cwd: path.dirname(descriptor.helperPath), detached: true, windowsHide: true, stdio: 'ignore'
});
helper.once('spawn', () => { helper.unref(); app.quit(); });
helper.once('error', error => updates.failure(error));
```

The helper is copied outside the application tree to the trusted updates cache. Its job contains schema 1, checked absolute app/cache/archive paths, signed ZIP identity/version, parent PID, and bounded timeouts. It rejects development roots, volume roots, overlapping cache/app paths, reparse paths, downgrade versions, changed archives, unexpected ZIP roots, escaping/ADS/reserved paths, duplicate destinations, links, and excessive expanded size.

The helper generates a random 64-character hex health nonce. It launches the staged app with `--update-health=<nonce> --update-version=<version>`. Main computes the destination from its own trusted `cacheDir` and `healthAckPath(cacheDir, nonce)`; it must never accept an arbitrary ACK path from launch arguments. After initialization is healthy, atomically write JSON `{nonce, version:app.getVersion(), pid:process.pid}` there. Invalid nonces must be ignored/rejected; the version argument alone is not sufficient evidence.

Staging, backup, and failed trees are unique siblings of the installed app so directory moves stay on the same volume. The helper waits for the exact packaged parent process to exit before swapping. If the new app fails to acknowledge, it stops only the newly launched process tree, moves the failed package aside, restores the old application, and relaunches it. Backups and failed/staged trees are retained; no recursive delete, user library operation, or settings removal occurs.

Exit codes: 0 installed; 1 rejected before swap; 2 rolled back; 3 recovery required. A code 3 result retains the backup location for recovery. The protocol assumes the current Windows user and the existing application/cache are trusted; it does not attempt to protect an application already modified by that same user or another process running as that user.

## Build and verification

On Windows, run `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-updater.ps1` (the bypass applies only to that build process), then `npm test`. The build requires the installed .NET Framework 4 compiler and compression assemblies. Include `tools/update-install.exe` in the packaged application; exclude test fixtures and private signing material from source releases.

`tests/updates.test.js` covers signed metadata, tampering/downgrades, streaming size/hash failures, auth states, concurrency, and handoff. `tests/updates-installer.test.js` builds disposable dummy executables only inside its own temporary directories and verifies actual swap/ACK, rollback, child file-lock recovery, hostile ZIP names, and pre-swap identity rejection. It never launches or replaces the user's application or accesses user settings/libraries.

GitHub CLI behavior follows the official [API](https://cli.github.com/manual/gh_api) and [web login](https://cli.github.com/manual/gh_auth_login) contracts.

## 0.8.2 progress and completion protocol

The native helper releases its inherited current directory immediately. Windows otherwise locks the old app directory when the helper was launched from it, preventing replacement after the parent exits. Both sender cwd and native cwd are outside the app tree.

A standalone bilingual Ember window remains visible during verification, byte-based extraction, replacement, launch and replay startup. Scoped atomic `progress.json`, `result.json` and `install.log` are retained beside each validated job. Failed pre-swap installation waits for the verified parent to exit before reopening the unchanged app; unrelated or still-running parents never cause duplicate launches.

A matching update-health/version launch keeps the new app hidden until the renderer is ready and replay startup has completed or reported an explicit error. The ordinary autoBuffer preference is not changed. Intermediate startup is written to the separately derived `health-<nonce>.progress.json`; this never counts as success. For targets 0.8.2 and later, the final `health-<nonce>.json` must contain matching nonce, version and PID, `completed:true`, and an actual JSON boolean `bufferRunning`. An explicit buffer error is shown as a warning while the healthy updated app opens, rather than being silently reported as recording or rolling back the entire app.

Older clients cannot fix their already-running helper through an update that helper cannot install. Use the current Setup over the existing installation once, or replace the helper with a trusted locally built copy, to bootstrap that fix. Future updates include the corrected helper. Settings, clips, failed packages and backups are retained.

Validation: 419 tests passed, including real native cwd/swap/rollback fixtures. `tests/update-handoff-main.test.js` uses the real ready-state updater to test replay preservation, safe cwd, handoff ordering and recovery from helper-launch failure. `node tests/update-startup-package-smoke.js <resources/app>` tests actual packaged main/preload/renderer with isolated app data and controlled replay-start success/failure; it never captures the user's desktop. The release pipeline runs this packaged startup check before publishing.