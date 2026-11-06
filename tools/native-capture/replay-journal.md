# Bounded native replay storage

`ember_replay_journal` is an OBS encoded output. It receives the original NVENC
H.264 and six AAC packets; it does not render a second video or reencode saved
clips. Existing NVENC CQP 12, p5, one-second GOPs, selected dimensions and frame
rate remain in the encoder configuration.

RAM mode retains encoded payloads in bounded allocations. Disk mode writes them
to private per-session GOP files and retains packet metadata in memory. Disk
files are removed by their segment owner after closing the handle. Snapshots
share that ownership and expired history never unlinks a pinned segment.
Dead-process transient directories without a recovery marker are reclaimed on
the next session; preserved recovery directories are skipped. An interrupted
container save remains an identifiable `.partial.mkv` and is removed on a later
startup only when its owning process is dead. Active saves and links are skipped.

Default encoded payload limits are 4 GiB RAM and 64 GiB disk, configurable with
`replayRamLimitMiB` / `replayDiskLimitMiB`. There is also a 500,000-packet metadata
limit and 32 MiB maximum individual packet. Disk capture reserves 1 GiB of free
space; its free-space cache refreshes after one second or 64 MiB of writes.
OBS/GPU allocations and bounded snapshot metadata are additional to payload
limits. A resource limit freezes capture and attempts an automatic save before
reporting the stopped output, rather than silently dropping selected history.
During ordinary disk recording, a low-priority worker checkpoints completed
GOPs about every two seconds. It flushes new segment payloads and atomically
replaces one `Ember-Recovery-*.json` manifest per session, containing codec
headers, exact packet offsets/timestamps, CRC32 checksums and independent
application PCM records. There is no per-frame disk flush or payload copy.
The prior generation stays owned until its replacement is durable. Old
checkpoint owners are then released, so rolling expiry remains bounded even
while a manual save is reading its own pinned history.

After an abrupt process exit, `ListRecoveryManifests`, `RecoverReplay` and
`SnapshotRecoveryAudio` reconstruct the last durable completed-GOP window,
combined audio, microphone and durably available app stems. WAVs preserve
sample alignment; the manifest retains application IDs/names, source start,
source offset and video offset. Missing or unsafe stems have explicit warnings.
Truncated payloads, invalid packet ranges/timing and checksum failures reject
recovery while leaving its original manifest and payloads in place. Recovery
retries reuse one raw output and one owned WAV folder rather than accumulating
full copies. Legacy version-one manifests remain readable, with an explicit
warning that they contain no separate application PCM.

If there is too little free space to mux a disk history, a final emergency
checkpoint retains that frozen window, including available app PCM.
`CompleteRecovery` retires the manifest durably before deleting payloads, and
is called only after the final library clip has been verified and published.
Shared payloads remain until every referencing recovery has completed.
Normal stop removes the active periodic checkpoint; an error preserves the
last valid checkpoint if a newer emergency checkpoint cannot be written.
Dead-owner garbage absent from all valid manifests is collected on the next
recording start. Invalid manifests suspend collection. Four pending manifests
block another disk recording instead of silently deleting unsaved recovery;
unreadable recovery metadata also blocks recording until repaired or recovered;
the existing per-session video and shared audio payload budgets still apply.

This protects the last successful disk checkpoint, not the incomplete tail.
On a responsive disk, the omitted tail is normally up to roughly three seconds
(checkpoint interval plus one GOP); slow or failed storage can increase it.
There is no crash checkpoint before the first completed GOP and successful
flush. Hardware must honor Windows flush/write-through requests. Real process
kill/relaunch is tested; physical power-cut behavior is not claimed as tested.
On resource exhaustion, RAM history or disk history whose emergency
checkpoint cannot be written stays frozen in the live native session and emits `ReplayBufferRecoveryRequired` with `keepAlive:true`; the
engine does not report a stopped output or discard it automatically.

Saving freezes packet metadata and pins payload owners. The rolling capture
continues while a hidden, time-limited OBS `obs-ffmpeg-mux.exe` copies the original
packets into an MKV. Finalization renames a completed temporary file atomically.
The helper ABI follows the pinned [OBS 33.0.1 mux protocol](https://github.com/obsproject/obs-studio/blob/33.0.1/plugins/obs-ffmpeg/ffmpeg-mux/ffmpeg-mux.h).

Snapshots start on the earliest usable keyframe inside the requested window;
the output never exceeds the selected duration, up to 300 seconds. With a
one-second GOP this may shorten a clip by less than one second. The native
`SaveReplayBuffer` response and `ReplayBufferSaved` event contain `snapshotId`,
`replayStartMonotonicNs`, and `replayEndMonotonicNs`. Nanoseconds are decimal
strings. Boundaries use OBS's composition timestamps (`encoder_packet_time.cts`)
on the `os_gettime_ns()` clock, with the end exclusive after the final frame.
Packet sys-DTS is retained independently, including original time bases and
presentation/decode ordering.

# Application audio

Core Audio session enumeration covers active render endpoints and both active
and inactive sessions. Same-executable process trees become roots grouped by
executable path; Ember and its parent application's descendants are excluded.
Session-created notifications request immediate refreshes. Process loopback
sources include each app root, apply the configured sync offset before starting,
and send stereo 48 kHz floating-point PCM to independent journals. Their OBS mix
mask starts at zero, so app count is independent of OBS's six output mixes.

Windows includes descendant processes in each process-loopback root. When two
application groups overlap, such as Steam owning a Quake process, the native
policy keeps the leaf roots and immediately disconnects the ancestor's PCM
sink. It reports that the ancestor stem was omitted and keeps the combined
backup. Historical ancestor PCM is also marked unsafe, including snapshots
pinned before discovery, so it cannot reappear in a later export. Unsafe roots
stay quarantined for the retained-history interval. This platform exception
does not impose a fixed application count, and no PCM subtraction is attempted.

Each app journal has a 4 MiB pending queue, a writer thread, bounded retention,
and a shared 16 GiB disk payload budget with a 1 GiB free-space reserve. Zero
blocks consume no journal storage. Every app has its own private session to
avoid segment-name collisions. Multiple roots of one app mix into one aligned
floating-point WAV. WAV gaps are zero-filled, with sparse storage enabled where
the filesystem supports it. Only nonzero overlap with the video window produces
a returned app track. Writer faults return explicit per-app warnings; the
combined track remains in the saved video.

Before video muxing, the output observer pins the app journal owners for that
exact window. It performs no PCM flush or disk read. The writers also attach
matching queued tail blocks to those pins. `SnapshotAudioReplay` later drains
the queues and consumes the pinned window; continued recording and expiry cannot
remove it. A failed video save discards its app pins. Unclaimed snapshot pins are
limited to 32. Sink unregistration precedes journal release, video save threads
join before the manager is destroyed, and the manager is cleared before OBS
sources are released.

# Verification

The release workflow runs these deterministic tests without GPU/audio devices:

```powershell
./tools/native-capture/test-packet-ring.ps1
./tools/native-capture/test-audio-journal.ps1
./tools/native-capture/test-source-health.ps1
./tools/native-capture/build-recovery-test.ps1
node --test tools/native-capture/durable-recovery.test.js tests/durable-recovery-capture.test.js
```

Manual native integrations require Windows process-loopback support, and video
tests require an NVIDIA encoder. All test PCM stays inside journal buffers;
nothing is sent to speakers and no user game/app is controlled:

```powershell
./tools/native-capture/build.ps1
./tools/native-capture/test-audio-manager.ps1
$env:EMBER_NATIVE_REPLAY_TEST='1'
node --test tools/native-capture/replay-native.test.js
$env:EMBER_NATIVE_RUNTIME=(Resolve-Path 'tools/build-deps/durable-recovery/runtime').Path
node --test tools/native-capture/replay-native.test.js tools/native-capture/periodic-recovery-native.test.js
$env:EMBER_NATIVE_AUDIO_TEST='1'
node --test tools/native-capture/audio-replay-native.test.js
```

Coverage includes bounded RAM/disk history, five-minute keyframe trimming,
snapshots surviving expiry, exact payload reads, resource-cap recovery order,
real H.264/AAC decoding, unchanged CQP/preset and 4:3/60 fps, eight independent
app stems, multiple-root mixing, silence/outside-window exclusion, aligned WAV
samples, pending tails, pinned expired history, and concurrent sink detachment.
