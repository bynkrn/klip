# Trash Tab and Windows Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native services and superpowers:dispatching-parallel-agents for the independent frontend task.

**Goal:** Show and restore this application's deleted clips from Windows Recycle Bin, and optionally start in the tray at Windows login.

**Architecture:** A short-lived Windows Shell COM helper enumerates scoped recycled video files and invokes the canonical restore action. A Node service validates IDs, persists scope for changed library folders/imports and reports partial results. Startup registration passes `--startup`; the window is hidden only when launch and launchMinimized are both enabled and that marker is present.

**Tech Stack:** Existing Electron, C#/.NET Framework Shell COM helper, Node test runner.

**Spec:** Current user request: app trash tab and minimized startup on PC boot; preserve all prior capture and checkbox-only selection behavior.

## Global Constraints

- Keep Windows Recycle Bin as the storage; never silently replace it with private app storage.
- List only videos from registered library roots or explicitly remembered imported file paths; do not expose unrelated Windows trash.
- Restore through Windows Shell; refuse occupied destinations and never overwrite an existing file.
- No permanent-delete/empty-bin feature in this change; offer opening Windows Bin instead.
- Preserve sunset style, fixed dimensions, one-click viewer, checkbox-only multi-selection and no duplicate outer outline.
- launchMinimized defaults false; manual launch always shows the window; startup and automatic replay stay opt-in.

## Review Focus

- Duplicate original names and changed library roots must not cause restoration of the wrong item.
- External imports remain in scope across restarts only after an explicit app delete request.
- Failed/externally removed recycled items must produce honest per-item outcomes.
- Hidden startup must not briefly show the window or prevent tray/manual reopening.
- Registration changes must preserve user's actual startup preference and avoid launching a second recording engine.

## Tasks

- [x] Add failing tests for startup policy and scoped trash service, then implement src/startup.js and src/windows-trash.js.
- [x] Add tools/recycle-bin.cs: scoped enumeration and single-item restore with collision checks; update native helper build.
- [x] Integrate delete scope history, trash-list/trash-restore/trash-open IPC and startup marker/visibility in main.js.
- [x] Frontend agent adds trash navigation/list/restore states and disabled-until-launch startup tray checkbox, with tests.
- [x] Verify actual Recycle Bin round-trip of disposable files, failed collision preserving bytes, manual vs startup window visibility, and existing tests.
- [x] Read-only review, fix important findings, package and open normal app.

## Ledger

- Historical ruling: use the existing project before Git setup. Current source is in private `bynkrn/klip`.
- Ruling: keep existing Windows Recycle Bin behavior; its existing clip entries remain visible in the new tab.
- Ruling: omit permanent deletion because the request only asks for a trash section; native Windows Bin remains available for that action.

- Complete: 53 unit/behavior tests pass; real Windows Bin roundtrip and collision bytes verified; packaged bulk restore and startup hidden/manual visibility verified. Existing active 119-second replay saved before approved update; original launch/autoBuffer preferences restored and normal app reopened.

The count/build above records that earlier personal update, not the current total test count. Trash now also supports read-only thumbnails/playback. Current delivery remains the user's local application and private source; no friend-ready ZIP/installer or published Release is authorized.
