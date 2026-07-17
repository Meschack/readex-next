# Architecture Principles

Sonelle should be built around stable domain events, deep modules, and small interfaces.

## Event-Driven Development

Long-running work emits domain events. UI and storage consume projections of those events.

Core event examples:

- `BookImportRequested`
- `BookImported`
- `NarrationPreparationStarted`
- `PassageNarrationReady`
- `NarrationPlaybackFailed`
- `WordInspected`
- `BookmarkCreated`
- `BookmarkDeleted`
- `BookExportRequested`
- `BookExported`

Events are domain language. They should not mention worker internals, chunk implementation, or transport details.

The canonical payload map, event factory, and dispatcher live in `@sonelle/domain`. Producers
complete their core operation and dispatch the resulting fact. Registered listeners own follow-up
reactions. Dispatch is intentionally in-process and is not recorded in SQLite. Durable product
state belongs in purpose-built repositories and projections, not in a general event journal.

## Module Map

Initial modules:

- `domain`: types, invariants, event names, value objects
- `epub`: EPUB extraction and metadata recovery
- `text`: normalization, sentence segmentation, pronunciation transforms
- `library`: book import orchestration and local library use cases
- `audio`: TTS preparation, audio cache, audio export
- `reader`: playback position, sentence highlight state, reading progress
- `learning`: word lookup, known-word state, notes
- `storage`: persistence adapters and migrations
- `platform`: desktop/mobile filesystem, dialogs, subprocesses
- `ui`: renderer components and routes

Current ownership notes for substantial modules live in [`docs/modules`](modules/README.md).

## Deep Module Standard

A module should have a small interface that hides real complexity.

Good:

```ts
await library.importBook(file);
```

Bad:

```ts
const hash = await hashFile(file);
const metadata = await parseOpf(file);
const chapters = await extractSpine(file);
const sentences = await splitAllChapters(chapters);
await insertBook(metadata);
await insertChapters(chapters);
await insertSentences(sentences);
```

The second example spreads book-import knowledge across callers. That is how the old kind of mess starts breeding.

## SOLID Interpretation

Use SOLID as a design pressure, not as ceremonial class confetti.

- Single responsibility: one reason to change per module.
- Open/closed: add a TTS adapter without editing reader UI.
- Liskov: fake adapters obey the same behavior promises as real adapters.
- Interface segregation: callers only learn the interface they need.
- Dependency inversion: domain/use cases depend on interfaces, platform details sit at the edge.

## Testing Strategy

Test through module interfaces.

Required early tests:

- EPUB extraction against small fixture EPUBs
- sentence segmentation edge cases
- event reducer/projection behavior
- import orchestration with fake storage
- audio preparation with fake TTS
- playback highlight state

Avoid tests that know private implementation details. If the test has to reach inside the module, redesign the module.

## User State vs Internal State

Internal state can be detailed. User state must be humane.

Internal:

- sentence id
- audio asset id
- retry attempt
- cache entry

User-facing:

- ready
- preparing
- needs attention
- unavailable

Do not leak internal state directly into UI copy.
