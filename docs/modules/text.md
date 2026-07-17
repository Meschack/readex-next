# Text

## Owns

- reader-text and paragraph normalization
- sentence and paragraph segmentation
- stable word and punctuation tokenization for reader interaction
- lookup-surface normalization

## Refuses To Own

- EPUB archive traversal, UI selection state, dictionary HTTP calls, or narration timing
- language detection and provider-specific phoneme conversion

## Interface

`@sonelle/text` exposes normalized segment and token values through pure functions. Native import has
an equivalent Rust boundary for persisted chapter projections; neither implementation knows about
Solid or SQLite queries.

## Domain Events

Text functions emit no events. Import orchestration publishes library-level lifecycle facts after
sentence and paragraph projections are complete.

## Invariants

- normalized text preserves meaningful paragraph boundaries
- sentence indexes and token indexes are deterministic for the same input
- empty input does not create synthetic content

## Tests

Package and native tests cover whitespace, punctuation, abbreviations, multilingual text,
paragraph ranges, and lookup normalization.
