# Screen/audio timing probe

This fixture creates a 240×100 no-activate, click-through topmost window at primary-screen `(16,16)`. Its 16×16 marker is at `(24,24)`. A quiet 1000 Hz, 60 ms pulse at source amplitude 0.0125 occurs every five seconds. The marker follows `IAudioClock::GetPosition` and its correlated QPC clock, not the time that audio is queued. PCM prefill is included in the waveform frame counter; before/after-start clock anchors and submitted frame counts are logged.

Build and run only when local screen/audio capture is authorized:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/av-sync/build.ps1
node tests/av-sync/record.js
python tests/av-sync/analyze.py
```

The default run records 130 seconds through the real `Capture.start` screen path, with the probe isolated on audio track 2. Other applications, system mix and microphone are muted in this fixture only. `AV_SYNC_SYSTEM=1` additionally records system audio for a local matched-filter comparison. `AV_SYNC_SECONDS` changes the test duration. The helper stops automatically after 160 seconds, and the controller closes it when recording ends. No existing app settings, volume controls, game configurations, native capture binaries or release packages are changed by running the fixture.

`analyze.py [run-directory] [optional-media-path] [optional-zero-based-audio-index]` detects actual marker transitions and tone events. It associates every video frame with its decoded PTS and maps decoded PCM samples to each AAC frame's PTS and sample count. It records stream start times, AAC priming metadata, beginning/end offset, event drift and jitter. Negative audio-minus-video means audio leads the marker. `compare_tracks.py [run-directory] [optional-media-path]` uses isolated track 2 as a local PCM reference to locate the same pulse in system track 1 despite unrelated desktop audio. Its lag search uses each 12 kHz PCM sample (0.0833 ms), because integer-millisecond steps alias a 1 kHz carrier and can miss fractional-delay chirp peaks.

For a second baseline with known intrinsic media timing, `media-baseline.js` routes an aligned local MP4 through one libobs media source; `screen-media-baseline.js` plays aligned media in an isolated, no-activate Electron window and records the actual monitor plus both WASAPI paths. Its marker is at screen `(40,40)` and window is `(16,16,320,180)`. Set `AV_SYNC_CHIRP=1` for a 20 ms 1 kHz timing tag followed by a 60 ms 1500–3000 Hz chirp at source amplitude 0.03; `AV_SYNC_SOURCE_VOLUME=0.8` controls only this private player's volume. The chirp comparison applies identical 1400 Hz high-pass and 3100 Hz low-pass filters to both decoded tracks. No other app or system volume changes.

`AV_SYNC_SCREEN_CALIBRATION_RUN=<baseline-directory>` derives separate system/process offsets from measured events and passes `inputAudioSyncOffset` to each source's `CreateInput`, before its first packet. The fixture default is zero without this explicit option. `AV_SYNC_INITIAL_OFFSETS=0` reproduces live setter behavior for investigation. Every run audits all input masks/mutes and asserts exactly one unmuted WASAPI system source feeds track 1, the process source feeds track 2 only, and microphone remains muted at zero offset. Run calibration JSON remains an ignored test artifact. The corrected known-media run is 15 seconds; a separate clock-probe run measured 125 seconds of event coverage without observed drift.

The installed personal profile is separate: `%APPDATA%/Klip/audio-sync.json`, matched only to the user's HyperX Cloud III Wireless endpoint at 48 kHz stereo by endpoint ID, sample rate and channel count. Measured residual audio/video differences were 3.33 ms for system loopback and 5 ms for process loopback, within one 60 FPS frame. Fresh/changed endpoints and microphones use zero correction. The profile, endpoint identifiers and recordings are excluded from source; these measurements do not establish timing for another headset/computer or physical acoustic latency.

`KlipAvClockReader.exe <pid>` independently records raw Windows process-loopback packet timestamps and tone amplitudes; PID `0` selects default-endpoint system loopback. `KlipAvSessionInfo.exe` reads endpoint/session routing, state, mute and volume without setters. These diagnostics do not establish physical acoustic headset latency.

All recordings, desktop images, logs, compiled probe binaries and generated reports are ignored locally. Source files remain available for repeatable testing. Absolute offset includes DWM presentation/capture and device/process-loopback timing, which are not independently calibrated by this fixture. A stable offset is not proof of correct lip sync; stream durations alone are not used as a sync test.
