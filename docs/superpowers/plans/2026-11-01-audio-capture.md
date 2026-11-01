# Editor application audio and capture engine

User wants per-application editor audio switches reflected in exports, no OBS application starting, and reliable real Quake Live capture without a frozen picture.

## Audio And Editor Implementation

- [x] Extract selected original audio streams into a private seekable cache; read-only source, bounded and deduplicated work.
- [x] Mute the editor's original video audio; synchronize isolated streams with play/pause/seek/rate and release them on close/source changes. Reject late results and late play promises.
- [x] Keep a known combined track exclusive with isolated tracks. Default to isolated sources; all-off exports silence.
- [x] Apply per-track 0–100% gains to preview and export. The first output track mixes only selected sources; remaining stems contain only selected sources at their chosen gains.
- [x] Add large preview, right audio inspector, real 12-frame filmstrip, ruler, playhead, click seeking, pointer/keyboard trim handles, and TR/EN without changing user filenames.
- [x] Verify actual frequencies, playback/pause/seek, excluded Discord, a 0.35 preview volume from 0.7 × 0.5, approximately 0.5 exported amplitude, and a 2.8-second cut in the isolated native fixture.
- [x] Verify 1280×800 and 850×650 layout, reachable controls, no horizontal overflow, proportional flush title controls, and themed focus.
- [x] Replaced and reopened the personal v0.4.0 runtime, verified packaged capture and native F8 save/playback, and uploaded source to the private repository.

## Capture Decision And Evidence

- [x] Replace the portable OBS application with `Klip.Capture.exe` using headless libobs 33.0.1. No OBS GUI, Qt, websocket or frontend-profile access; short-lived capture-library helpers remain.
- [x] Retain NVIDIA NVENC CQP16, fixed output/FPS, replay duration, isolated audio and game/desktop source modes.
- [x] Verify real user-opened Quake Live practice-map attachment: 50 seconds, 237 sampled unique frames, and moving frames after desktop return. This is not a long-duration guarantee for every game.
- [x] Verify 800×600 stretching separately with controlled OpenGL/WGC sources. Do not claim a completed real Quake Live 4:3 test.
- [x] Measure screen/WASAPI timing on the user's HyperX Cloud III Wireless endpoint only, at 48 kHz stereo: residual system 3.33 ms and process 5 ms, within one 60 FPS frame; no drift observed across 125 seconds.
- [x] Match calibration by endpoint/sample rate/channels; fresh or changed endpoints use zero correction. Keep the personal AppData profile out of source.

The current encoder is NVIDIA NVENC-only. AMD/Intel support and friend-computer validation are not established. The app name/logo remain Klip; Ember is only a proposal. No friend-ready ZIP, installer or published Release is part of this delivery.

Trash thumbnails, read-only playback/seek/restore, decoder coordination and partial-success behavior are complete; see the trash-preview plan. Evidence sources include `tests/editor-native-integration.js`, `tests/real-quakelive-live.js` and `tests/av-sync/`. Generated personal recordings, measurements and profiles remain local ignored artifacts.
