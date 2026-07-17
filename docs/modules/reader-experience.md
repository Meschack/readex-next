# Reader Experience

## Owns

- composing the reader's UI state and user workflows
- coordinating library, narration, dictionary, preferences, and dispatcher interfaces
- projecting domain state into reader, library, and inspector surfaces

## Refuses To Own

- SQLite statements, EPUB parsing, TTS subprocesses, or HTTP response parsing
- construction details for platform adapters
- reusable playback, progress, segmentation, or dictionary rules

## Interface

`ReaderExperience` accepts an optional `ReaderExperienceDependencies` bundle. Production callers use
`createReaderExperienceDependencies`; integration tests can provide stable fakes.

The composition root exposes stable, getter-backed view models to the library and inspector
surfaces. Each model is split by responsibility so those surfaces receive one meaningful interface
instead of mirroring every signal and workflow as a component prop.

The Tools inspector exposes separate color swatches for active narration and bookmarked passages.
The reader shell projects those preferences as CSS variables and derives readable foreground colors
without putting persistence or validation logic in Solid components.

Rendered paragraphs receive layout data directly and obtain reading interactions from the scoped
`ReaderContentProvider`. The provider owns no state or services; it only exposes reader-content
actions and projections for the current reader tree. Active-sentence membership uses Solid's
selector primitive so a narration step invalidates the previous and next sentence consumers rather
than every visible sentence.

## Domain Events

Library workflows complete their core operation and dispatch the resulting event. `ReaderOpened`
and `ReaderClosed` independently drive playback, surfaces, rails, and bookmark refresh. Settings,
lookup, installation, export, cache clearing, and narration reactions follow the same pattern.
Domain events are dispatched to live listeners and are not journaled in the database.

## Invariants

- initiating workflows publish facts; independent listeners own follow-up reactions
- UI modules depend on product-facing application views, not platform or narration-provider types
- surface models are stable objects whose getters preserve Solid's fine-grained tracking
- scoped reader-content interactions must not grow into an application-wide service locator
- closing the reader stops its playback scope before the library surface becomes active

## Tests

Pure reader behavior is tested in `apps/desktop/src/reader/*.test.ts`. Workflow tests use fake
repositories and the real dispatcher to prove that producers publish facts and listeners react
without mocking Tauri globals. `reader-experience.integration.test.tsx` characterizes navigation
across every inspector surface through the composed reader shell.
