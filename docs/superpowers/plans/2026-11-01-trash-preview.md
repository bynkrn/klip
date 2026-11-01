# Trash thumbnails and read-only playback

User asks for thumbnails and viewing within the existing Windows Recycle Bin tab.

- [x] Add scoped ID resolution and lazy cached thumbnails. Keep deleted physical paths private; never register deleted clips as editable library clips.
- [x] Add playback metadata and range-capable opaque media URLs. Read original deleted MP4 directly; remux other containers only to private preview cache.
- [x] Add small thumbnails and a dedicated modal with seek controls, close, and restore. Closing/navigation/restore releases the player and invalidates delayed requests.
- [x] Coordinate preview jobs with restore so decoding cannot hold a restored file open. Preserve selection, collision and partial-success behavior; a failed refresh cannot erase confirmed restore successes.
- [x] Verify unit tests and native thumbnail/playback/seek/restore with owned disposable files, plus the actual UI and media cleanup. Preserve the active buffer and existing preferences during the earlier authorized personal update.

Implementation ownership: parent backend/native integration/local runtime; clip_library_ui owns template/build adapter and frontend tests. Work began in the existing checkout before Git setup; current private source is `bynkrn/klip`. Sunset/window bounds and checkbox-only multi-selection remain. No permanent delete or empty-bin action was added. No published Release or friend-ready distribution is authorized.
