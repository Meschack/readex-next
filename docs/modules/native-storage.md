# Native Storage

## Owns

- SQLite schema, migrations, transactions, and durable library projections
- local cover assets and reading-data queries

## Refuses To Own

- Solid state, UI copy decisions, TTS subprocesses, or dictionary HTTP requests
- EPUB archive parsing and text segmentation rules

## Interface

`SonelleStore` exposes library use cases to thin Tauri commands. Transport models live in
`storage/model.rs`. Domain event dispatch stays outside native storage.

The `.readex` application-data directory is retained as an intentional compatibility path for
existing local libraries. New user-facing naming remains Sonelle.

## Domain Events

Native storage does not journal domain events. Application workflows publish events through the
in-process dispatcher after their core storage operation succeeds.

## Invariants

- durable product state is stored in purpose-built tables rather than reconstructed from events
- library projections expose reading progress as a cumulative completed-sentence count across the
  book, derived from the active chapter position and bounded by the book's sentence count
- initialization removes the discontinued `domain_events` table from existing libraries
- migrations preserve existing local libraries, including the intentional `.readex` compatibility path

## Tests

Rust tests use temporary SQLite databases and exercise the public store behavior, migrations,
search, bookmarks, exports, cumulative cross-chapter progress, and removal of legacy event history.
