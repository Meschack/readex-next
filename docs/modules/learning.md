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
codes are normalized by `@sonelle/domain` before an API endpoint is selected. French lookups parse
the French Wiktionary language section so the returned definition remains in the book's language.

## Domain Events

`WordInspected` records the book, chapter, sentence, surface text, and normalized book language
context without coupling lookup to playback timing.

## Invariants

- word lookup never participates in narration timing or playback control
- adapters return normalized insight data rather than leaking provider response shapes into the UI
- French entries use French-language definitions rather than English translation glosses
- lookup failures remain recoverable reader feedback and do not mutate saved-word state

## Tests

Package tests cover response parsing and saved words. Adapter tests cover language-specific
endpoint selection, French definition extraction, fallback behavior, and failures.
