# Game overlay capture

Ember explicitly sets `game_capture.capture_overlays=false` when creating or updating the game source at startup and whenever it selects a new game window. Native source recreation copies the source settings, preserving this policy during capture recovery. This makes the existing engine default explicit; it is not a new per-process window filter.

The intended Steam behavior is that the user can still see Steam's in-game notifications while a supported game-capture hook omits the overlay. Steam settings, running Steam processes, notification audio, and audio-track selections are not changed. The underlying setting applies to third-party game overlays generally; it cannot identify just message notifications or just Steam.

Windows window capture and display capture are unchanged. An overlay already composited into their captured image may remain visible. Ember does not remove pixels after encoding or replace recovery with an unreliable game feed to hide a notification.

Tests check new/reused startup sources, Steam game switching, fallback behavior, and the existing capture recovery suite. They do not open or control a live game. Actual omission of Steam notifications in TF2 requires a later recording check; the setting alone does not prove visual exclusion for every graphics API or hook order.

The option is documented by the [capture engine](https://obsproject.com/kb/game-capture-source).
