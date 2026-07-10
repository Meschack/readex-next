# 0012. Native Performance Boundaries

Date: 2026-07-09

## Status

Accepted

## Context

Reading is responsive only when expensive local work stays outside the webview's main thread and
the native boundary carries reader data rather than duplicate text or binary payloads.

The initial desktop implementation performed import, SQLite work, audio preparation, and cache
inspection through synchronous Tauri commands. It also returned prepared WAVs and book covers as
base64 data URLs. Those choices made the cost of a local library and narration cache grow with the
amount of content already prepared.

## Decision

- Tauri commands that perform filesystem, SQLite, EPUB, or narration work run through blocking
  tasks instead of the application main thread.
- The local store is initialized once at application startup and reused by commands.
- Paragraph projections cross the native boundary as sentence ranges. Sentence text remains in the
  active chapter's sentence list and is not duplicated into each paragraph.
- Prepared WAVs and imported covers are persisted as local files. The webview loads them through
  scoped asset URLs.
- Audio cache totals are maintained when WAVs are written or cleared. A directory walk is retained
  only to rebuild a missing or invalid manifest.
- Sentence search uses an SQLite FTS5 projection. Active-reader search is capped before results
  reach the inspector.
- Python-based Piper installations use a persistent local process that loads the selected model
  once. The standalone Piper command remains a compatibility fallback.

## Consequences

Import and narration preparation can no longer freeze reader interaction. The app trades a small
amount of durable projection metadata and local asset files for smaller IPC payloads and stable
work during long reading sessions.

The asset protocol has a deliberately narrow scope: only Sonelle's audio and cover directories are
available to the webview. Existing libraries with legacy data URLs remain readable; new imports use
file-backed assets.

## Ownership

- `storage` owns summary counts, paragraph ranges, full-text projections, and persisted cover paths.
- `audio` owns Piper lifecycle, WAV paths, and cache accounting.
- `commands` owns scheduling blocking native work away from the UI thread.
- `reader` owns bounded rendering and search-result presentation; it does not know about SQLite,
  filesystem paths, or Piper.

## Verification

- Storage and audio behavior are covered through native adapter tests.
- Reader range selection and bounded search are covered through unit tests.
- The ignored large-book harness reports import, persistence, open, and chapter-switch timings for
  synthetic and configured local EPUBs.
