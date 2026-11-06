# Ember → Video Editor: Project Import V1

This is the sender/receiver handoff for the exact V1 contract requested by the user. Ember prepares and launches requests. The separately developed editor owns project creation, media inspection, optional copying, project persistence and its recent-project list.

## Sender entry points

Select one or more completed clips using Ember's existing selection checkboxes. Use **Yeni Projeye Aktar** in the selection toolbar or the clip context menu. The modal contains an editable project name, the frozen clip list/count, `copyMedia` unchecked by default, Import and Cancel. Editor EXE selection is in **Ayarlar → Genel → Video Editörü** and is also offered by the modal when missing.

Ember exports the original `clip.file` paths, not browser preview URLs or remuxed previews. Only native-known library/import entries are accepted, with fresh file/media checks. Ember does not create `.tuckproj`, copy/transcode media, change audio streams or add timeline items.

## Request transport

Default directory:

`%APPDATA%\Ember\project-imports\`

Each request is UTF-8 JSON at `<requestId>.json`, published atomically from a flushed temporary sibling. The EXE comes only from the user's native file-picker choice; there is no development-machine default path.

Executable and argument array are passed separately, without a shell:

```text
editorExecutable
["--import-project", "<absolute request JSON path>"]
```

Example `<requestId>.json`:

```json
{
  "schema": "kurgu-project-import",
  "version": 1,
  "requestId": "ce846ac6-c827-46dc-b86d-82ed734d6384",
  "projectName": "Arkadaşlarla maç",
  "files": [
    "C:\\Klipler ve oyunlar\\Arkadaşlarla maç 01.mp4",
    "C:\\Klipler ve oyunlar\\İkinci klip.mp4"
  ],
  "copyMedia": false
}
```

The immutable request ID is reused for unchanged-content retries. Editing the project name, file list/order or copy preference creates a different request ID. Repeated in-flight submissions are coalesced. Request files are retained across Ember restarts; restart only resumes observation and does not automatically launch the editor.

## Receiver responsibilities

1. Parse `--import-project` followed by one full path. Preserve spaces and Unicode; never split/reconstruct a shell command.
2. If already running, forward this path to the existing editor instance. The secondary launcher may exit immediately; Ember does not interpret its exit as acknowledgement.
3. Validate schema/version/ID and input files. Create a **new** project with the supplied name and import all files into its media pool. **Leave the timeline empty.**
4. If `copyMedia` is true, the editor performs and manages the copy. Otherwise reference existing paths. Preserve every embedded audio stream and the source media.
5. Never overwrite an existing project. Report `PROJECT_EXISTS`; do not silently rename it. Ember keeps the user's selection/copy choice and asks for a different name.
6. Persist idempotence by `requestId`, including requests forwarded to an existing instance or retried after restart. A repeated active/completed request must not create another project or duplicate media imports. Re-publish a cached result when appropriate. A failed request can be retried with the same ID without weakening completed-request deduplication.
7. Publish `completed` only after project/media-import persistence succeeds. The editor owns its recent-project list.

## Result transport

Write beside the request, replacing `.json` with `.result.json`:

`ce846ac6-c827-46dc-b86d-82ed734d6384.result.json`

Write UTF-8 JSON. Atomic publication from a temporary sibling is recommended, including when re-publishing a cached acknowledgement. Ember tolerates a transient incomplete/invalid result and keeps waiting. On retry of a receiver error, the previous result remains on disk; re-publish the acknowledgement to acknowledge the new delivery.

Completed:

```json
{
  "schema": "kurgu-project-import-result",
  "version": 1,
  "requestId": "ce846ac6-c827-46dc-b86d-82ed734d6384",
  "status": "completed",
  "projectPath": "C:\\Projeler\\Arkadaşlarla maç\\proje.tuckproj"
}
```

Name conflict:

```json
{
  "schema": "kurgu-project-import-result",
  "version": 1,
  "requestId": "ce846ac6-c827-46dc-b86d-82ed734d6384",
  "status": "error",
  "error": {
    "code": "PROJECT_EXISTS",
    "message": "Bu proje adı zaten kullanılıyor."
  }
}
```

User cancellation in the editor:

```json
{
  "schema": "kurgu-project-import-result",
  "version": 1,
  "requestId": "ce846ac6-c827-46dc-b86d-82ed734d6384",
  "status": "cancelled"
}
```

Other errors use the same error shape with an appropriate code/message. No progress or cancellation-request schema is added to V1. Closing Ember's dialog only closes that view; it cannot cancel the editor operation. A valid matching result is the only receiver acknowledgement. There is no elapsed-time deadline for copying/importing. Completed/cancelled requests retain their acknowledgement; pending and failed deliveries can be retried with the original JSON and ID.

## Audio verification

Published replay MP4s contain separate embedded AAC tracks for combined sound, audible applications and microphone when available. Temporary PCM journals, WAV snapshots and editor preview audio caches are implementation intermediates. They are not required sidecars of published library clips. The V1 `files` array is therefore sufficient for current Ember media. The non-MP4 browser preview path is explicitly not used because it may contain only one audio stream.

If a future capture backend introduces published audio sidecars, V1 must not silently drop them. Both sides must first agree on an extension carrying video linkage, track name/channel identity and time offset; this sender does not invent one.

## Verification boundaries

`tests/project-transfer.test.js` checks atomic requests, same-ID retry/content changes, source/editor failures, matching/malformed/delayed results, receiver errors/cancellation, restart and result/validation races.

`tests/project-transfer-ui.test.js` exercises the actual Electron DOM, single/multi-selection, conflict preservation, retry, closing/reopening during preparation, TR/EN and narrow-window geometry.

`tests/project-transfer-native.test.js` compiles a **test-only Windows EXE**, passes real Unicode/space paths, simulates early launcher exit and delayed completed/error/cancelled result files. The fixture uses a real MP4 with two embedded audio tracks and verifies original hashes and track count remain unchanged. It does not implement the real editor, create real projects or prove existing-instance forwarding in the actual receiving editor. End-to-end integration must still be tested with that editor.
