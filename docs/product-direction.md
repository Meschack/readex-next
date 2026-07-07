# Product Direction

Readex Next is a private reading and listening app for books the user owns.

The product promise is simple: import a book, read it comfortably, listen locally, and follow the narration sentence by sentence without giving up privacy or control.

## Core Experience

The central screen is a reading desk:

- a library/navigation rail
- a large reader surface
- sentence-level playback highlighting
- a compact bottom audio rail
- an optional word/notes inspector

The app should feel like a modern reading tool with audio built in, not a podcast app that happens to show text.

## User-Facing Features

Core:

- Import EPUB files.
- Extract readable book text.
- Read chapter text in a focused reader.
- Listen from any sentence.
- Highlight the currently narrated sentence.
- Resume reading/listening from the last position.
- Prepare audio locally and reuse it offline.

Language-learning layer:

- Click/select a word to inspect it.
- Show definition, translation, pronunciation, examples, and notes when available.
- Let the user mark words as known, learning, or saved.
- Keep word learning optional and unobtrusive.

Library layer:

- Browse local books.
- Continue recent books.
- View bookmarks and notes.
- Export a prepared book later.

## User-Friendly Status

Implementation detail must stay behind the curtain.

Bad:

- Generating chunk 14/950.
- Job failed.
- Queue worker retrying.

Good:

- Preparing audio for this chapter.
- Ready to listen offline.
- Audio needs attention.
- Retry this passage.

## Non-Goals For The First Base

- Cloud sync.
- Marketplace/catalog browsing.
- Paid TTS as a required dependency.
- Word-by-word audio highlighting.
- Social features.
- DRM bypass.

## Design Goal

Readex should feel calm, precise, and reader-first. The user should trust it with long books and long sessions.
