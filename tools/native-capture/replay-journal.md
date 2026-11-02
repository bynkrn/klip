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
If there is too little free space to mux a disk history, its existing payloads
are flushed and retained in place with an atomic `Ember-Recovery-*.json`
manifest containing codec headers and exact packet offsets/timestamps. No
payload copy is required. `ListRecoveryManifests` and `RecoverReplay` allow
later muxing; `CompleteRecovery` removes the checkpoint only after the caller
has verified its final library clip. Recovery retains video, combined audio
and microphone; separate app stems are explicitly reported unavailable.
RAM history, or a failed disk checkpoint, stays frozen in the live native
session and emits `ReplayBufferRecoveryRequired` with `keepAlive:true`; the
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
```

Manual native integrations require Windows process-loopback support, and video
tests require an NVIDIA encoder. All test PCM stays inside journal buffers;
nothing is sent to speakers and no user game/app is controlled:

```powershell
./tools/native-capture/build.ps1
./tools/native-capture/test-audio-manager.ps1
$env:EMBER_NATIVE_REPLAY_TEST='1'
node --test tools/native-capture/replay-native.test.js
$env:EMBER_NATIVE_AUDIO_TEST='1'
node --test tools/native-capture/audio-replay-native.test.js
```

Coverage includes bounded RAM/disk history, five-minute keyframe trimming,
snapshots surviving expiry, exact payload reads, resource-cap recovery order,
real H.264/AAC decoding, unchanged CQP/preset and 4:3/60 fps, eight independent
app stems, multiple-root mixing, silence/outside-window exclusion, aligned WAV
samples, pending tails, pinned expired history, and concurrent sink detachment.
