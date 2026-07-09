# Security Policy

## Supported Versions

Readex Next is pre-1.0. Security fixes target the latest `main` branch and the latest published release.

## Reporting a Vulnerability

Please do not open a public issue for sensitive security reports.

Use GitHub private vulnerability reporting if available for this repository, or contact the maintainer directly through GitHub.

Helpful details:

- affected version or commit
- operating system
- reproduction steps
- impact
- whether local files, imported EPUBs, generated audio, or exported data are involved

## Scope

Relevant areas include:

- EPUB import and archive handling
- local file access
- SQLite persistence
- export workflows
- Tauri command boundaries
- release artifacts and update metadata

Readex is local-first, so reports involving local data privacy and filesystem boundaries are especially important.
