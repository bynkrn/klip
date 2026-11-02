# Klip native capture service

Build from the project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/native-capture/build.ps1
```

The script locates Visual Studio C++ Build Tools and Windows SDK, generates an x64 import library from the pinned runtime's `obs.dll`, and builds `tools/Ember.Capture.exe`. It also copies that executable beside the runtime DLLs in `engine/obs/bin/64bit`, which is its runtime location: NVENC's capability probe and the replay muxer resolve their helper executables relative to the host executable.

The service loads libobs 33.0.1 and only `win-capture`, `win-wasapi`, `obs-nvenc`, and `obs-ffmpeg`. It does not start `obs64.exe`, load Qt, expose a websocket, or read/write OBS frontend profiles. Short-lived OBS library helpers still run: NVENC capability probing, graphics hook/injection helpers, and `obs-ffmpeg-mux.exe` when a replay is saved. These are engine components, not the OBS application.

The Node adapter prepends the engine DLL directory to its child-only PATH. Stdin/stdout carry UTF-8 JSON lines: request `{id,type,data}`, reply `{id,data}` or `{id,error}`, event `{event,data}`. Engine logs go to stderr. `Initialize` accepts `{root,config,bufferDir}`; `Close` waits for replay stop and releases all owned engine objects. The adapter preserves the request names used by `Capture` and `VideoSources` and emits `ReplayBufferSaved` with `{savedReplayPath}`.

Output is NVIDIA NVENC H.264, p5, high profile, one-second keyframes, with six AAC 256 kbps stereo audio tracks at 48 kHz. `Initialize.config.qualityMode` selects `quality` (the default, CQP12) or `bitrate` (CBR). `videoBitrate` is an integer Mbps value from 5 through 250, converted to kbps only at the encoder boundary; the default is 60. Invalid modes fall back to quality, and invalid/noninteger/out-of-range bitrates fall back to 60. A remembered manual bitrate does not constrain quality mode. `src/video-quality.js` applies the same normalization at the app boundary.

Both the output scaler and scene source scaler use Lanczos. This matters when input dimensions differ from output dimensions; it does not add image detail to a 1:1 source or change the existing stretch behavior. The replay output writes MKV files to the supplied buffer directory and uses the configured time limit. In manual bitrate mode the encoded-packet limit covers the selected video Mbps plus six 256 kbps audio tracks for the chosen duration, with 15% headroom, rounded up to MiB. For 250 Mbps and five minutes this is 10345 MiB; the buffer grows as packets arrive, so this is a limit rather than a startup allocation. Quality mode retains a 4096 MiB packet limit and may retain less than the selected duration if content exceeds it. Final MP4 publication remains the Electron app's responsibility.

`GetReplayEncodingSettings` prepares the replay encoder if needed and returns `{qualityMode,videoBitrate,encoderId,encoderSettings,active,outputScaleFilter,replayBufferLimitMiB}`. `encoderSettings` and `replayBufferLimitMiB` are read back from the native encoder/output, not reconstructed by the Node adapter. Startup also logs the selected rate control/settings. `GetSceneItemTransform.sceneItemTransform.scaleFilter` reports the scene item's effective scaler for native integration tests.

Before starting a replay, visible monitor sources must produce an actual nonzero texture. If an automatic monitor source cannot initialize DXGI capture, the service tries Windows Graphics Capture and validates it before starting; failure of both paths rejects startup. Hidden game-only monitor sources are skipped. This handles the tested machine's `DXGI_ERROR_UNSUPPORTED` without recording a black desktop. Set the child-only environment variable `KLIP_CAPTURE_DEBUG=1` for detailed engine diagnostics; default logging remains bounded by the Node adapter.

Audio calibration RPCs use milliseconds: `GetInputAudioSyncOffset` and `SetInputAudioSyncOffset` return/accept `inputAudioSyncOffset`. `CreateInput` also accepts this optional field for output and process WASAPI sources; a nonzero initial value is applied before binding the real endpoint/window so the first audio packet already uses the calibrated timeline. For a running source, changing the getter field does not guarantee immediate relocation of already queued audio. `GetInputAudioTracks` and `GetInputMute` expose the effective routing/mute state for tests. `GetDefaultAudioEndpointInfo` returns the default render endpoint ID, name, sample rate, channel count, format, and matching default roles. No calibration is installed by the service; callers must match a measured local profile to its endpoint and sample rate, and leave microphones and fresh devices at zero.

Verification:

```powershell
node --test tools/native-capture/adapter.test.js
node --test tests/video-quality.test.js
node tools/native-capture/quality-check.js
node tools/native-capture/smoke.js
```

The smoke check explicitly opens the controlled OpenGL target from `tests/KlipCaptureTest.exe`, captures its 800×600 source stretched to 1920×1080, saves and decodes a six-track replay, verifies changing frames and the isolated tone/silent unused audio track, and checks stopped status. Set `SMOKE_SOURCE=window` to test WGC and `SMOKE_FPS=90` to test custom FPS. It writes only under this directory. It does not run Quake Live and cannot certify real-game compatibility or freeze-free capture.

The explicit quality check runs seven development engine sessions sequentially, without opening a target/game or controlling the installed Klip application. It checks default quality mode, a remembered bitrate in quality mode, CBR at 5/60/250 Mbps, and malformed settings. It reads back the actual packet limits, including the 250 Mbps/five-minute case and shorter lower-bitrate cases. Each session checks encoder/scaler settings, starts NVENC on a black scene, saves a replay, verifies 1080p60 H.264, and fully decodes video. Results are under `smoke-buffer/quality/`. Black-scene bitrate is not used as a quality metric or an assertion of the configured CBR target.

Vendor inputs are unmodified headers from the official [OBS Studio 33.0.1 tag](https://github.com/obsproject/obs-studio/tree/33.0.1/libobs), licensed under the included OBS `COPYING` and per-header notices, plus [nlohmann/json 3.11.3](https://github.com/nlohmann/json/tree/v3.11.3), under the included MIT license. The local `obsconfig.h` supplies the Windows consumer build configuration.
