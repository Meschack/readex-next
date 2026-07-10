# 0011. Reader Performance Projections

Date: 2026-07-09

## Status

Accepted

## Context

Large EPUB chapters can contain thousands of sentences. The reader already hydrates only the
active chapter, but opening or switching chapters still rebuilt paragraph structure from the stored
chapter body. That made large chapters pay text parsing costs every time the user navigated.

The Solid reader also needs stable object identity while playback advances. If paragraph objects are
recreated for every sentence window update, the UI loses reuse opportunities and repeats token work.

## Decision

Persist paragraph ranges during import as a storage projection:

- sentences remain the source for playback and highlighting
- paragraphs store only chapter-local sentence ranges
- opening a chapter groups already-loaded sentences into paragraphs
- legacy books without paragraph ranges fall back to body parsing

Build reader views with:

- stable paragraph and sentence objects
- paragraph start/end sentence indexes for render-window filtering
- precomputed sentence search text
- lazy tokenization cached by sentence object identity

Debounce library search before crossing the native boundary so quick typing does not run a SQLite
query for every keystroke.

## Consequences

Chapter opening and switching now avoid repeated paragraph parsing. Import owns the paragraph
projection cost, which is acceptable because import is rare while reading and chapter navigation are
common.

The paragraph projection is intentionally not a domain source of truth. It can be rebuilt from
chapter body and sentence rows if needed.

Audio transport was still a separate performance concern when this decision was accepted. Decision
0012 subsequently moved prepared WAVs to scoped Tauri asset URLs.
