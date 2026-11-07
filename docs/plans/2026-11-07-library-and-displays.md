# Library and desktop display selection

Keep the sunset theme, fixed window, compact cards, and checkbox-only multiple selection.

## Library

- Persist display name, favorite, and tags in application data using atomic writes. Never rename source files or change editor-import paths.
- Search names, original filenames, game folders, and tags with Turkish-aware case folding. Combine search, favorites, tag, local date range, and duration filters in grid and list views.
- Show older clips with an honest date heading, not Yesterday. Empty results offer a clear-filters action.
- Add a subtle favorite control on cards/rows and metadata editing in the context menu. Selection actions support adding tags and changing favorites in batches.
- Preserve selection behavior and source identity checks; retain metadata after same-file recycle/restore.

## Displays

- Persist a stable monitor identifier and optional follow-game-monitor setting; defaults are primary monitor and follow off.
- List connected monitors with name, resolution, position, and primary designation. Fall back explicitly if a stored monitor is disconnected.
- Follow the target game's monitor, retaining it across desktop transitions. Keep output dimensions, stretch, replay encoder, and audio clock unchanged.
- Put controls in recording settings, with a clear explanation when the running buffer must be stopped to edit settings.

## Validation and delivery

Use backend unit tests, offscreen Electron interactions at 1280×800 and 850×650, existing capture/regression tests, and an isolated package. Do not replace the current running installation or publish a new release as part of this task. Avoid live screen-capture tools because they previously caused a yellow desktop border.
