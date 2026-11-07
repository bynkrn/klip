# Reliable update handoff and visible progress

Observed: user's 0.7/0.8 clients close during update, remain old after manual restart, and offer the same update. Actual 0.8.1 archive validates and extracts; latest failed attempt retains a staging tree but never moves the old app. A regression launching the existing helper with cwd=appRoot reproduces a Windows sharing violation. Helper inherits appRoot and locks its own replacement target. Existing tests used a different cwd and missed it. Helper stdout was discarded and no terminal result was persisted.

Fix and user flow:

1. App shows download, verification, buffer preservation, capture stop, and handoff phases. Sender explicitly spawns helper with cwd outside appRoot; helper also clears inherited cwd itself, retaining compatibility with old senders.
2. Separate sunset WinForms progress window survives app shutdown. Helper atomically persists scoped progress.json/result.json with file-byte progress and readable error/recovery states. Existing validation, archive protections, backup retention and rollback remain.
3. New app launches hidden for a valid update-health/version context. It waits for its UI, starts the replay buffer even if normal auto-start is off (without changing the user's preference), writes truthful buffer health, then shows/focuses the app. Capture failure opens the updated UI with an explicit warning rather than claiming buffer success or rolling back a healthy app.
4. On reopening, the app reads bounded trusted operation history and explains failed/incomplete updates instead of silently reoffering one. A failed pre-swap install relaunches the unchanged app when safe.
5. Publish signed 0.8.2 after native, frontend, actual packaged/isolated update checks. Patch only the old installed helper binary locally, keeping its original backup, so the user's existing 0.7/0.8 sender can perform the fixed update. Preserve active capture until the user starts the update.

Agent ownership: update_helper_repair owns tools/update-install.cs, build-updater.ps1, native updater tests. Root owns JS lifecycle/history, main integration, UI, packaging/release. Existing app/buffer/game settings remain untouched during development. No live screen-capture tooling.
