# Reader Experience

## Owns

- composing the reader's UI state and user workflows
- coordinating library, narration, dictionary, preferences, dispatcher, and event-sink interfaces
- projecting domain state into reader, library, and inspector surfaces

## Refuses To Own

- SQLite statements, EPUB parsing, TTS subprocesses, or HTTP response parsing
- construction details for platform adapters
- reusable playback, progress, segmentation, or dictionary rules

## Interface

`ReaderExperience` accepts an optional `ReaderExperienceDependencies` bundle. Production callers use
`createReaderExperienceDependencies`; integration tests can provide stable fakes.

## Domain Events

Library workflows complete their core operation and dispatch the resulting event. Registered
listeners independently update projections, open books, show notices, perform word lookup, and
prepare narration. Renderer-only events use an `EventSink` persistence listener; native library
mutations record their durable event inside the storage transaction.

## Tests

Pure reader behavior is tested in `apps/desktop/src/reader/*.test.ts`. Workflow tests use fake
repositories and the real dispatcher to prove that producers publish facts and listeners react
without mocking Tauri globals.
