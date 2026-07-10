# Sonelle

[![CI](https://github.com/Meschack/sonelle/actions/workflows/ci.yml/badge.svg)](https://github.com/Meschack/sonelle/actions/workflows/ci.yml)
[![Release](https://github.com/Meschack/sonelle/actions/workflows/release.yml/badge.svg)](https://github.com/Meschack/sonelle/actions/workflows/release.yml)
[![Latest Release](https://img.shields.io/github/v/release/Meschack/sonelle?label=latest%20release)](https://github.com/Meschack/sonelle/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-153f34.svg)](LICENSE)

Sonelle is a local-first desktop reader for EPUB books with sentence-level narration, clean chapter navigation, and dictionary lookup for language learners.

It is a ground-up rebuild on a saner base: Tauri, Solid, TypeScript, Rust, SQLite, and a reader-first product model.

## What It Does

- Import and read EPUB books locally.
- Preserve chapter structure and paragraph formatting.
- Highlight the currently narrated sentence.
- Use left click to select a sentence and right click on a word to open dictionary lookup.
- Save words and bookmarks for later review.
- Prepare local neural narration through Piper.
- Export book progress, saved words, and annotations.

## Downloads

Current desktop builds are published on the [latest release](https://github.com/Meschack/sonelle/releases/latest).

Automated releases are built for:

- Linux x64
- macOS Apple Silicon
- macOS Intel
- Windows x64

macOS builds currently use ad-hoc signing until a Developer ID certificate and notarization pipeline are configured.

## Development

Requirements:

- Node.js LTS
- pnpm 11.7.0 through Corepack
- Rust 1.95 (installed automatically by `rustup` from `rust-toolchain.toml`)
- Tauri system dependencies for your OS

```bash
pnpm install
pnpm setup:piper
pnpm dev:desktop
```

Useful checks:

```bash
pnpm format
pnpm typecheck
pnpm test
pnpm build
cargo check --workspace --locked
```

Build the desktop app locally:

```bash
pnpm build:desktop
```

The project also includes a local command TUI:

```bash
pnpm dev:tui
```

See [docs/development.md](docs/development.md) for platform dependencies, QA commands, narration setup, and performance harness details.

## Release Automation

Every push to `main` runs CI. After CI passes, the release workflow:

1. Reads existing `v*` tags.
2. Computes the next patch version.
3. Patches the package, Tauri, and Cargo versions inside the CI workspace.
4. Builds platform bundles with `tauri-apps/tauri-action`.
5. Publishes a GitHub Release with downloadable assets.

Manual releases can also be triggered from the GitHub Actions `Release` workflow.

## Architecture Notes

- Frontend: Solid + TypeScript
- Desktop shell: Tauri v2
- Native backend: Rust
- Storage: SQLite through `rusqlite`
- Narration: local Piper voices
- Reader behavior: sentence-level playback and paragraph-preserving rendering

Important docs:

- [Product direction](docs/product-direction.md)
- [Design direction](docs/design-direction.md)
- [Architecture principles](docs/architecture-principles.md)
- [Quality system](docs/quality-system.md)
- [Roadmap](docs/roadmap.md)
- [Decision records](docs/decisions)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening larger changes. The short version: keep the reader experience calm, preserve original book structure, do not leak implementation internals into user-facing copy, and keep modules boringly clear.

## License

MIT. See [LICENSE](LICENSE).
