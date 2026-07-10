# 0013. Language-Aware Narration

Date: 2026-07-10

## Status

Accepted

## Context

Narration settings are durable, but a voice selected for one language is not necessarily suitable
for the next book. Voice metadata had also drifted between TypeScript, Rust, setup documentation,
and the settings UI.

## Decision

- `packages/audio/src/narration-voices.json` is the single narration voice catalog.
- The catalog owns the default voice, locale, label, and reader-facing description.
- The setup script and native Rust adapter consume that catalog rather than declaring their own
  defaults.
- Opening a different book selects a supported voice when the current voice language does not match
  the EPUB language. Chapter changes and same-language book changes preserve the current choice.
- Missing book language preserves the current voice because guessing a language is worse than
  retaining an explicit user choice.
- The native adapter may discover `.readex` voice state only as a documented migration aid for
  existing local installations. New state is always written under `.sonelle`.

## Ownership

- `domain` owns language-code normalization.
- `audio` owns the voice catalog and matching rules.
- `reader` decides when a book transition requests voice matching.
- the desktop adapter owns Piper model discovery and legacy state compatibility.

## Verification

- Domain tests cover EPUB locale and bibliographic language aliases.
- Audio tests cover language matching and same-language preference preservation.
- Native tests prove the Rust fallback reads the shared catalog.
