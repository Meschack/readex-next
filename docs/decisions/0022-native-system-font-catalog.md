# ADR 0022: Native System Font Catalog

## Status

Accepted.

## Context

Book and interface typography should reflect fonts already installed on the reader's computer.
Browser font APIs cannot reliably enumerate local families across Sonelle's WebKit and WebView2
targets, and the reader UI must not learn OS directory layouts or font-file paths.

## Decision

The native shell uses `fontdb` to scan platform font directories on a blocking runtime task. A
single `list_system_fonts` command returns deduplicated family names through the injected
`SystemFontCatalog` port. Sonelle does not copy, embed, upload, or retain font files.

Reader preferences store nullable family names. A null value selects Sonelle's bundled Satoshi or
SpaceMono Nerd Font Propo defaults. A selected system family is quoted before it is composed into
the appropriate CSS fallback stack.

Typography changes publish `ReaderTypographyChanged`. Independent listeners project the selection
and persist preferences. Event history persistence was subsequently removed by decision 0026.

## Consequences

- cold discovery may touch many files, so it never runs on the UI thread;
- removing a selected font from the operating system naturally falls through to Sonelle's bundled
  defaults;
- browser-only development cannot enumerate fonts and exposes only the defaults;
- the platform adapter returns family names, never paths or font bytes.
