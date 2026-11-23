# Independent audio clips

Healthy dynamic-audio saves embed one AAC stereo 48 kHz stream per enabled application that produced sound during the clip, plus the enabled microphone stream. They do not add a duplicate combined track. Application names remain in stream `title` / `handler_name`; all source tracks are enabled. Video packets are copied without re-encoding. The MP4 contains `ember_audio_layout=separate` in format metadata.

The existing global **Separate App Audio Automatically** preference controls capture; no per-clip visit to Ember's editor is required. Existing files are not rewritten. Disabling separation or receiving missing-audio warnings retains the combined stream as a safety fallback rather than losing audio.

Normal media players often play only one embedded audio stream. Ember generates a mixed playback copy on demand in its private preview cache while preserving the editing source. The copy is never used for Explorer, project imports, or exports. The same applies in the recycle bin. Editor exports preserve independent tracks for files carrying the separate layout marker, including per-source gains and mute selections.

The clip cue acknowledges an accepted manual save immediately, before background processing. Overlapping/rejected requests and automatic preservation do not produce the cue. Completion and failure remain visible separately.

TF2 is recognized as `tf_win64.exe` and `tf.exe` in both the Windows watcher and capture logic, with the library name **Team Fortress 2**. Explicit target selection still takes precedence. Executable matching is culture independent.

Validation uses real FFmpeg files to check independent source tones, stereo/channel/sample-rate consistency, all tracks enabled, unchanged video packet hashes, playback mixing, and exports. No Premiere window or live game is opened by these tests. Actual Premiere timeline import and live TF2 capture still require a later interactive check; they are not claimed as verified by the container tests.
