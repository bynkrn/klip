# Playback, Recording Health, Durable Recovery And Editor Plan

**User-authorized scope:** finish the five previously agreed features: fullscreen normal playback, opt-in recording-health UI (default off), stronger disk crash recovery including separate application audio, export improvements, and persistent editor audio mixes/waveforms. Retain the V1 external-editor sender.

**Architecture:** independent native recovery/checkpoint work, a separate verified export module, and bounded audio-preference/waveform modules are implemented in parallel. Root owns main IPC/lifecycle integration, fullscreen/health UI, export dialog and final assembly. Existing sunset UI, fixed normal window size, capture quality, 4:3 stretch, selected duration and notification behavior remain.

## Contracts

- Fullscreen applies to the normal viewer; button/double-click/F enter, Escape exits, playback/seek/volume work, navigation exits, normal dimensions restore. No editor-only fullscreen substitution.
- Recording-health display is off by default and changes live without restarting capture. Reuse existing cheap health samples. Distinguish actual frame-delivery evidence from WGC/hook lifecycle checks; no static-scene pixel-change alarm and no unsupported guarantee.
- Disk checkpoints are periodic, bounded and durably published off the realtime packet callback. Preserve only committed payloads and enough metadata/headers/PCM timing to recover app stems. Keep failed recoveries until verified clip publication. RAM-only video cannot survive power loss; the last uncommitted tail may be unavailable.
- Audio-only full-length output copies video. Fast trimming copies source video at actual indexed keyframe boundaries, displayed before confirmation. Precise trimming uses high-quality reencoding and requested boundaries. Never overwrite the original; verify and atomically publish new output with matching selected mix.
- Editor audio defaults key by application/track identity, not changing stream indexes. Named mixes and per-clip overrides remain explicit; combined/stem double counting is prevented. Waveforms are lazy, bounded, cached, cancel stale work and use low-priority media work.
- Preserve the running packages and all user profiles/game settings. Build the integrated runtime separately; no new setup, Release, forced app/game termination or physical power-off test.

## Implementation / Verification

- [x] Root: meaningful health model and fullscreen control tests RED → GREEN; normal viewer UI/keyboard/resize state checks.
- [x] Native agent: rolling checkpoint + durable separate app audio, real killed-test-process/relaunch recovery; normal stop cleanup, limits, repeated failures, corrupt/tail cases and existing replay tests.
- [x] Export agent: actual FFmpeg copy packet hashes, fast actual range/duration, precise frame boundaries, selected audio/mutes/gains and source preservation.
- [x] Audio agent: stable persistent mixes/presets, stale/missing/cache cases, actual waveform signal tests and rendered controls.
- [x] Root: integrate typed native IPC, live preference policy, frontend hooks, localized compact UI; verify neighboring library/project transfer behavior.
- [x] Root: full suite, native integration where available, scoped independent review, isolated versioned build, protected package hashes and documentation of observed limits.

Final verification: 348/348 suite tests, 9/9 packaged native integration cases, isolated real-main/preload boot, exact packaged-source matching, unchanged protected artifact hashes. Review fixes cover stale/missing health samples, PID reuse, transactional checkpoint retirement, replaced export sources, export mix readiness and controls. Integrated runtime: `dist/Ember-0.7.0-preview/Ember-win32-x64`. Details: [Delivery And Limits](../../playback-recovery-editor.md).
