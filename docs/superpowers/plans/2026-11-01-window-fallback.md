# Windows Capture Fallback and Clip Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the capture/backend work. Independent frontend work is delegated under superpowers:dispatching-parallel-agents.

**Goal:** Automatically replace failed game capture with Windows Graphics Capture of the same game window, retaining quality and stretching; add right-click and multi-select clip management.

**Architecture:** A serialized video-source controller manages game/display/WGC scene items within the existing encoder. A dimension-based health check waits 2.5 seconds before trying WGC, switches only after WGC has a valid image, then disables failed game hooks for this target. Library deletion resolves known registered clips and uses the Windows Recycle Bin.

**Tech Stack:** Historical 0.2.0 work used Electron, portable OBS Studio 33.0.1 and obs-websocket. The current successor uses headless `Klip.Capture.exe`/libobs 33.0.1, without the OBS GUI or websocket; source-controller behavior remains.

**Spec:** User requests in this chat: automatic Windows window fallback, same quality/FPS/4:3 stretch; right-click watch/edit/Explorer/delete, multiple selection/deletion.

## Global Constraints

- Preserve NVENC CQP16, selected resolution/FPS, separate audio tracks, continuous replay encoder.
- Game-only mode must never enable monitor capture, including failures.
- WGC uses method=2, client_area=true, selected game window only; no anti-cheat settings changed.
- Fallback readiness uses source dimensions, not image brightness, so legitimate black game scenes do not trigger it.
- Keep the approved sunset layout, top single-row controls, fixed dimensions and no horizontal scroll.
- All deletion is explicit and reversible via shell.trashItem; never directly unlink user's clips.
- Fresh-install Windows startup and auto-buffer defaults remain OFF; preserve saved user preferences.

## Review Focus

- Failed hooks at startup and after capture begins must both reach WGC without restarting the encoder.
- Rapid focus/target changes cannot leave an older game's image on top or leak the desktop in game-only mode.
- Alt+Tab with minimized/unavailable windows cannot cause fallback to a monitor in game-only mode.
- Partially failed bulk deletion must preserve failed items and report results truthfully.
- Delete must act only on registered library IDs, pause an open player and release its media handle.

## Tasks

### 1. Source controller and capture integration

- [x] Add failing tests in tests/video-sources.test.js for failed capture fallback, successful capture, 4:3 geometry, game-only privacy, sticky WGC, focus and target changes, unavailable window.
- [x] Implement src/video-sources.js with initialize(), setTarget(selector), setFocus(isGame), check(), stop(); serialized operations; injected clock for deterministic tests.
- [x] Integrate into src/capture.js: lazy WGC source, health timer, startup readiness, source status events, cleanup.
- [x] Run unit tests and real controlled 800x600 WGC capture, forced failed game capture, and game/desktop transitions. Inspect video dimensions/FPS, decode and edge content.

### 2. Library management

- [x] Frontend agent adds right-click menu, selection and bulk-delete binding in src/ui-template.html and tools/build-ui.js.
- [x] Parent implements a tested src/library-actions.js service and main IPC delete handler using shell.trashItem, input validation, cache invalidation and partial results.
- [x] Verify real native UI with disposable clips only, including multi-select, context actions and Recycle Bin deletion.

### 3. Review and delivery

- [x] Fresh read-only code review of integration; fix important findings and rerun relevant tests.
- [x] Update README, package the native application, smoke test packaged UI and actual replay, reopen it normally from the existing desktop shortcut.

## Execution ledger

- Historical ruling: work began in the existing project before Git setup. The current source repository is private `bynkrn/klip`.
- Ruling: the user's follow-up chooses the window-capture approach and explicitly authorizes continuing implementation; no further design approval needed.
- Ruling: newly added independent library frontend work is delegated with exclusive file ownership, while parent owns capture and native IPC.

- Complete: fresh read-only review approved both important fixes; 38 tests pass. Packaged 0.2.0 produced real WGC 800x600 -> 1920x1080/60 FPS, six tracks, valid decode and no black side bars. Native checkbox-only selection, one-click viewer and real Recycle Bin deletion verified; original recording settings restored and normal executable reopened.

This is a historical personal-build completion record. Current headless-engine, real Quake Live, editor and device-specific sync evidence is summarized in the audio-capture plan and README. The controlled 800×600 test is not evidence of a completed real Quake Live 4:3 test. No friend-ready package or public/private distribution Release is being delivered now.
