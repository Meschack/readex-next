# Reader Core

## Owns

- playback-state transitions and narration-event projection
- sentence highlighting, search, progress, render-window calculation, and preference parsing
- book and interface typography preferences, including migration-safe font-family normalization
- narration and bookmark highlight colors, including safe defaults and readable foreground selection
- bounded scheduling of reading-position persistence

## Refuses To Own

- Solid components, SQLite, Tauri, EPUB parsing, or audio decoding
- provider selection and narration-file installation

## Interface

`@sonelle/reader` exports pure state functions and the `ReadingPositionScheduler` interface. Callers
provide sentence counts, chapter metadata, and persistence callbacks; the package returns new state
without importing platform adapters.

Null font-family preferences retain Sonelle's bundled typography defaults. Invalid stored highlight
colors fall back to the current narration yellow and bookmark green (`#016630`).

## Domain Events

Reader core consumes narration projection events but does not dispatch or persist them. Desktop
applications own event production and reactions.

## Invariants

- exactly one sentence index is active when a non-empty chapter is selected
- sentence highlighting remains sentence-level
- active narration takes visual priority when a sentence is also bookmarked
- progress and render windows are clamped to available chapter data
- scheduled position writes can be flushed during navigation or shutdown

## Tests

Package tests cover every transition, search normalization, progress indexing, render windows,
preference serialization, and position scheduling.
