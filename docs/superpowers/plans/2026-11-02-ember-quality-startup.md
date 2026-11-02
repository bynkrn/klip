# Ember Quality, Naming And Startup

Goal: apply the user's requested Ember name, higher recording quality/manual bitrate, and default-enabled reliable Windows startup/replay. Existing symbol, sunset layout, clips and private update trust stay intact. No friend ZIP or Release.

- [x] Inspect original full-resolution samples versus preview thumbnails; improve the actual encoder and paused preview without claiming static-scene bitrate proves quality loss.
- [x] Add qualityMode quality/bitrate, videoBitrate integer5–250Mbps (default60). Automatic quality CQP12, manual CBR; Lanczos scaling; preserve resolution/FPS/stretch. Test native effective settings and decoded saves. Explain manual RAM cost.
- [x] Integrate startup reconciliation on every packaged launch and preference change. Defaults launch/autoBuffer true. Verify actual Windows Run entry and real --startup launch, hidden according to preference with a running buffer. Preserve explicit OS disable decisions.
- [x] Rename product/executable/capture host/project/shortcut/default data and video paths to Ember. Migrate settings/calibration/history and existing default library without overwrites, retaining historical trash roots. Preserve internal protocol IDs.
- [x] Update private updater/installer/future workflow asset/executable names. No release now. Run installer tests and full suite.
- [x] Preserve any active replay before replacement. Build local app, verify actual F8/playback/quality and startup registration, upload source and require clean Windows CI.

Review focus: renamed directory conflicts; stale startup paths; ignored bitrate versus actual encoder; RAM limits truncating selected manual duration; data loss or active readers during migration.

Local verification:178 tests passed; seven native NVENC profiles saved and decoded. Actual packaged --startup launch was hidden with auto-buffer running and F8 registered. Canonical HKCU Ember entry points to the renamed stable executable. Existing library and calibration hashes matched. Private branch CI is checked after source push; no tag/Release/distributable.
