# Project Import Sender Implementation Plan

**Goal:** Implement only Ember's V1 project-import sender, using the user's exact request/result contract. The receiving editor is developed separately.

**Architecture:** A Node sender owns immutable atomic request files and asynchronous result observation. The existing library gets a compact modal and context/selection actions. General settings choose the EXE through a native picker. The sender never writes projects, copies media, transcodes, merges tracks or treats launcher exit as completion.

**Existing audio:** Published replay MP4s embed combined/application/microphone AAC streams. Application PCM journals and snapshot WAVs are temporary preparation files, not companion files required by library clips. Export original `clip.file`, not the single-audio browser preview used for some imported formats.

**Scope:** No fullscreen, capture recovery, health UI, internal editor enhancements or receiver implementation. Preserve the current runtime and setup in `dist` and current user settings. No automatic launch until the user chooses an editor and submits a transfer.

## State Contract

- Draft: editable name, frozen clip selection, copyMedia unchecked; Transfer/Cancel.
- Preparing: controls disabled while validating and publishing the request.
- Waiting: no timeout; explicit same-ID resend and Close (closing the dialog does not cancel the editor).
- Completed/cancelled/error: only a valid matching result establishes these receiver outcomes.
- PROJECT_EXISTS: retain files/name/copy choice, focus the name input and require another name; changed content gets a new ID.
- Launch/file validation errors: actionable sender errors; same immutable request can be retried where already created.
- Restart: reload requests/results without auto-launching, continue observing unfinished requests.

## Tasks

- [x] Write failing sender tests for exact payload, original media preservation, Unicode/space paths, missing source/editor, idempotence, name changes, early launcher exit, delayed/malformed/matching results and restart.
- [x] Implement `src/project-transfer.js`, guarded native IPC, editor EXE selection and nonblocking lifecycle integration.
- [x] Add native renderer module, selection/context entry points and settings/modal UI; preserve existing single-click viewing and checkbox-only selection.
- [x] Add real DOM tests and a real Windows launcher/result fixture; verify rendered TR/EN and narrow/wide states.
- [x] Document V1 receiver requirements and result examples, including existing-instance forwarding and persistent idempotence responsibility.
- [x] Run the complete suite, review changes and preserve hashes of the existing packaged runtime/setup. Report sender-only evidence honestly.

## Verification

- Full suite: 305 passed, zero failures/skips. Sender tests first failed before implementation; asynchronous race regressions also verified RED → GREEN.
- Independent review's important findings fixed: retry cannot overwrite a result arriving during source validation; late replies cannot attach to another reopened draft; restored pending jobs publish state even without a result file. Receiver-error resend and English error text were also corrected.
- Real test-only Windows EXE received the exact two arguments through Unicode/space paths. Exit 0 without acknowledgement stayed waiting. Delayed completed, PROJECT_EXISTS and cancelled fixtures were consumed. A real two-audio-track MP4 retained its byte hash and both streams.
- Real Electron DOM covers checkbox selection, modal, preserved collision inputs, retries, receiver success after sender retry failure, draft switching, EN/TR and 850px/1280px geometry. Offscreen rendering provided an actual modal screenshot without interacting with the user's live app.
- Separate runtime built at `dist/project-import-preview/Ember-win32-x64`, version 0.6.2; packaged source matches current source. No new setup or Release created. Existing setup SHA256 remains `e6fb358abeee12944c24eba54fd3820d47603422f957740a2f2589b3cba08201`; checked runtime/setup files remain unchanged.
- Real receiving editor and its existing-instance forwarding are not verified. Only the sender and controlled result/launcher fixtures are validated. Receiver handoff is `docs/project-import-v1.md`.
