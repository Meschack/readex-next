# Reader Applications

## Owns

- application workflows connecting domain events to reader-facing projections
- library import reactions, reader opening and closing, navigation, playback, settings, offline
  narration, word insight, export, and search
- serial delivery of desktop EPUB open requests into the library import workflow
- lifecycle subscription and cleanup behind small application interfaces
- typography and reading-color selection, projection, and preference persistence

## Refuses To Own

- concrete SQLite statements, TTS subprocesses, EPUB parsing, or provider IDs in UI contracts
- reusable reader-state rules already owned by `@sonelle/reader`

## Interface

Each `reader-*-application.ts` or `reader-*-workflow.ts` file exposes one constructor and a small
interface. Dependencies are ports or other application interfaces. `ReaderExperience` is the
composition root and projects results into Solid signals.

Offline narration exposes English and multilingual product profiles. Kokoro and Supertonic mapping
stays inside the offline-narration application. `ReaderOpeningWorkflow` correlates a loaded
`ReaderView` with one `ReaderOpened` fact, then independent listeners activate playback, show the
reader, update the library rail, clear notices, and refresh bookmarks.

`BookOpenRequestAdapter` drains native cold-start requests and listens for later requests. It only
delivers file paths; `ReaderLibraryApplication` turns them into the same `BookImportRequested` flow
used by dialogs and drag and drop.

Closing a reader flushes and awaits the latest reading-position save before playback stops. An
independent `ReaderClosed` listener then refreshes the library projection, so collection cards show
the position that was just persisted rather than the position from when the book was opened.

## Domain Events

Applications dispatch facts before follow-up reactions. Long-running import, narration, lookup,
installation, cache clearing, export, progress, reader opening, and reader closing flows use the
canonical domain dispatcher. `ReaderTypographyChanged` and `ReaderAppearanceChanged` independently
drive projection and preference persistence. Domain events are not recorded in SQLite.

## Invariants

- initiating functions do not manually fan out unrelated consequences
- platform adapters are injected at the composition edge
- event diagnostics never alter product control flow
- reading-position writes are serialized, and reader closure waits for the latest write to settle
- stopping an application removes every subscription and cancels owned work

## Tests

Workflow tests use real dispatchers and fake ports. Navigation tests cover sample, chapter, bookmark,
and search paths. The opening workflow proves that one fact drives independent projections. The
reader integration test covers lifecycle startup, reader closure, playback stop, and cleanup.
Playback tests prove that closure waits for pending progress, while library tests prove that
`ReaderClosed` refreshes the collection projection.
