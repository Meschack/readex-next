# 0005: Word Dictionary Lookup

## Status

Accepted.

## Decision

Sonelle word tools are dictionary-first. A user clicks or taps a word, Sonelle looks up that word through a public dictionary API, then displays the definition in the popover and side inspector.

Sonelle uses DictionaryAPI for direct English lookups, the French Wiktionary Action API for
French-language definitions, and FreeDictionaryAPI for other non-English lookups and multilingual
fallback:

```text
https://api.dictionaryapi.dev/api/v2/entries/en/<word>
https://fr.wiktionary.org/w/api.php?action=parse&page=<word>&prop=text
https://freedictionaryapi.com/api/v1/entries/<language>/<word>
```

Book language metadata selects the lookup language. French lookups use the French Wiktionary
edition so definitions are written in French rather than translated into English. The providers do
not require an API key. English 404 responses fall back to the multilingual endpoint so the reader
can recover when EPUB metadata is incomplete.

The user can save a returned dictionary entry. Saved entries are stored locally and reused before the app makes another remote lookup.

## Why

The goal is quick dictionary help while reading, not a LingQ-style vocabulary workflow.

This keeps the feature small and useful:

- click a word
- fetch a real definition
- show it beside the text
- save it to avoid future network lookups

Word lookup remains independent from narration timing. It does not need word-level audio timestamps and it must not interrupt sentence-level playback.

## Consequences

The `packages/learning` boundary owns:

- word normalization
- dictionary API response parsing
- dictionary lookup display states
- saved dictionary entries
- saved-entry serialization

The desktop renderer owns:

- calling the public API
- local saved-entry storage
- popover and inspector presentation

If the API cannot find a word or the network fails, the UI shows a friendly status instead of exposing request internals.

## User-Facing Language

Use:

- looking up
- definition found
- saved
- not found
- needs attention

Avoid:

- learning state
- known word
- flashcard
- lookup pipeline
- API request
