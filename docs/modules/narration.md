# Narration

## Owns

- voice catalog metadata and language-aware voice resolution
- narration request identity, prefetching, and playback readiness contracts
- the desktop adapter for native Piper preparation and playback

## Refuses To Own

- reader UI state, chapter navigation, or reading progress
- book-language detection and EPUB metadata extraction
- persisted reader preferences

## Interface

Reader workflows depend on `PrefetchingNarrationGateway`. Voice labels, locales, descriptions, and
the default voice come from `packages/audio/src/narration-voices.json`. Browser media lifecycle is
hidden behind the injected `HtmlAudioPlayer` interface.

## Domain Events

`AudioPreparationRequested`, `SentenceAudioReady`, and `AudioPreparationFailed` describe the
reader-visible narration lifecycle.

## Tests

Package tests cover voice selection, settings, request identity, and prefetch behavior. Rust tests
cover native request validation, cache behavior, and the shared default voice catalog.
