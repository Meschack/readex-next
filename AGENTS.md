# Readex Next Agent Rules

Readex Next is a clean restart. Do not copy architecture from the old Readex app unless a specific function is intentionally recovered and documented.

## Product Shape

Readex is a local-first reading and listening app for EPUB books. The primary experience is reading the book text while sentence-level narration plays in sync.

The app is reader-first, not podcast-first. Audio supports the text; it does not turn the interface into a music player clone.

## UX Language

Do not expose implementation machinery to users. Avoid words like:

- chunk
- job
- queue internals
- generation worker
- cache key
- sentence unit

Use user-facing language instead:

- preparing audio
- ready to listen
- resume reading
- needs attention
- retry audio
- offline library

## Highlighting Decision

Highlight narration sentence by sentence. Word-level playback highlighting is intentionally out of scope for the core playback path.

Word interactions are still allowed: clicking or selecting a word can show a definition, translation, pronunciation, notes, or learning state. That interaction must not depend on word-level audio timing.

## Architecture

Prefer deep modules with small interfaces and meaningful behavior behind them. Keep seams real: introduce an interface when two adapters exist or a test needs a stable fake.

Use event-driven flows for long-running local work:

- importing a book
- extracting text
- preparing narration
- exporting audio
- updating reading progress

State changes should be represented as domain events first, then projected into UI-friendly views.

## Responsibility Split

Keep these concerns separate:

- product/domain vocabulary
- EPUB parsing and text normalization
- sentence segmentation
- local storage
- audio preparation
- playback orchestration
- reader UI
- learning tools
- platform adapters

No module should know about Solid UI state, SQLite, and TTS subprocesses at the same time. If it does, stop and redesign before adding more code.

## Documentation

Important decisions go in `docs/decisions/`.

Every substantial module must document:

- what it owns
- what it refuses to own
- its interface
- its domain events, if any
- how it is tested

## Steward Checklist

Before non-trivial changes, read `.codex/skills/readex-steward/SKILL.md` and apply its checklist.
