# Replay Reliability Implementation Plan

> For agentic workers: use executing-plans for each owned task, or subagent-driven-development for independent native journal, source watchdog, public client tasks.

Goal: complete user-authorized reliability, storage, dynamic audio and public-update scope.
Architecture and constraints: docs/superpowers/specs/2026-11-02-replay-reliability.md.

- [x] Native immutable GOP packet ring with actual disk/RAM persistence, bounds, pinned snapshots, exact timestamps; native tests, synthetic copy/decode.
- [x] Source delivery freshness and bounded recovery without false static-frame alarms or game-only desktop leakage; lifecycle tests.
- [x] Independent per-process audio session discovery, sparse PCM journals, aligned audible-only snapshot stems; native tone/silence/late-session tests and >6-track MP4 proof.
- [x] Dynamic JS save/export/audio controls and cleanup/preserve-original failure paths; editor variable-track tests.
- [x] Public repository audit/visibility and anonymous signed update read/download; auth-free test and tampering tests.
- [x] Custom local notification import and installed Medal cue selection; no third-party audio in repo.
- [x] Full verification, review, local runtime with retained old buffer, private profile preserved. No friend setup or Release. GitHub CI is verified on the pushed commit.
