# Learning

## Owns

- dictionary lookup results, saved-word state, and insight normalization
- parsing the supported dictionary API response shapes
- the desktop HTTP and local-storage dictionary adapter

## Refuses To Own

- word-level narration timing
- reader sentence selection or popover placement
- book-language extraction

## Interface

The UI depends on `DictionaryRepository`; domain behavior lives in `@sonelle/learning`. Language
codes are normalized by `@sonelle/domain` before an API endpoint is selected.

## Domain Events

`WordInspected` records the book, chapter, sentence, surface text, and normalized book language
context without coupling lookup to playback timing.

## Tests

Package tests cover response parsing and saved words. Adapter tests cover endpoint selection,
fallback behavior, and failures.
