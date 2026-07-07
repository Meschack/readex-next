# 0001: Sentence-Level Playback Highlighting

## Status

Accepted.

## Decision

Readex Next highlights playback sentence by sentence.

Word-level playback highlighting is not part of the core playback system.

## Why

Sentence-level highlighting is the right balance for this product:

- It is fast enough for long books.
- It works with ordinary TTS output.
- It avoids requiring word timestamp metadata.
- It keeps the reading experience calm.
- It still gives the user a clear follow-along anchor.

Word-by-word playback highlighting would add timing complexity, engine-specific metadata requirements, more UI churn, and more opportunities for annoying mismatch. Not worth it for the first serious base.

## Consequences

The app still supports word interactions, but they are interaction-driven:

- click/select word
- show definition or translation
- save word
- mark learning state

Those features do not need word-level audio timestamps.

## User-Facing Language

Use:

- current sentence
- current passage
- resume from here

Avoid:

- chunk
- sentence unit
- timing segment
