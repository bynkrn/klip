# Ember 0.8.0: library and desktop displays

## Using the library

The library has one search row with a Favorites toggle and a Filters panel. Search matches the display name, original filename, game folder and tags. Local date endpoints and duration endpoints (seconds) are inclusive and combine with search, tags and favorites. Blank endpoints have no limit. Grid and list use the same results. Old clips are grouped by their actual local date.

Use the star on a card or list row to change a favorite. Checkbox selection remains separate from watching: clicking the clip opens the viewer, and only its checkbox adds it to a multiple selection. Clips hidden by a filter are removed from the selection before batch actions. The selection toolbar can change favorites in a batch.

Right-click a clip and choose **Ad ve Etiketleri Düzenle / Edit Name And Tags**. Clear the display name to use the original file stem. Tags are comma-separated. These edits never rename, move, remux or rewrite media files. Explorer and external-editor project transfers still receive the original paths and source identity.

Metadata lives in `%APPDATA%\Ember\clip-metadata.json`. Updates use a flushed temporary file and atomic rename. Metadata is keyed by the source path and checked against its mtime and size; replacing a file at the same path does not inherit unrelated metadata. Restoring the same file from Recycle Bin to its original path retains metadata. A corrupt metadata file is preserved and writes are rejected rather than silently discarding it.

## Recording displays

In **Ayarlar → Kayıt / Settings → Capture**, the Desktop Display section lists attached monitors with their names, native resolutions and primary designation. The default follows Windows' primary monitor. Explicit choices use the exact stable device interface ID used by OBS monitor_capture, never a monitor's current list index.

**Oyunun Ekranını Takip Et / Follow The Game's Display** starts off. When enabled, it follows the target game's monitor and retains that monitor while the desktop or Ember has focus. Moving the target game in the background updates the followed monitor. The existing recognized games and optional target executable setting identify the game. Game Only mode continues to exclude desktop video.

Monitor preferences can be changed while the replay buffer is stopped. Automatic following and monitor reconnects update the existing desktop source without restarting the replay encoder or changing output resolution, stretch, audio clock or transport fallback. If a saved monitor is disconnected, the primary monitor is used and the interface explains the fallback; reconnecting restores the saved choice. Enumeration and switching failures are shown explicitly.

## Validation and local package

Final coordinated validation: **398/398 tests passed**, with no failures or skips. Both packaged main/preload smoke checks passed. Source and packaged main, generated UI, renderer modules, capture controller and native window helper hashes match. The full suite log is `tests/library-displays-validation.log` (ignored test artifact).

The isolated package is `dist/Ember-0.8.0-preview/Ember-win32-x64`. The working 0.7.0 installation and desktop shortcut are preserved. No 0.8.0 GitHub release or installer has been published by this task.

- Node suites cover metadata persistence, source validation, failed atomic writes, races, combined filters, date grouping, monitor selection, follow behavior, disconnect/reconnect and capture fallback regressions.
- Offscreen Electron tests exercise the actual generated interface at 1280×800 and 850×650, including TR/EN round trips, checkbox selection, metadata dialogs and monitor-setting persistence/errors.
- `node tests/library-package-smoke.js <resources/app>` boots the packaged main/preload with isolated settings, edits a real Unicode-path MP4's metadata, verifies its bytes/path are unchanged, and enumerates actual Windows monitors. It never starts a desktop recording.
- `node tests/playback-package-smoke.js <resources/app>` checks the existing health/editor/export IPC behavior through the packaged preload.

Actual unplug/replug and moving a live game between physical monitors have not been performed on the user's desktop; those transitions are exercised using controlled backend fixtures. Safe native enumeration and the packaged application detect both connected monitors on this development PC.
