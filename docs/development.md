# Development

## Requirements

- Node.js
- pnpm
- Rust 1.95 and Cargo (selected by the checked-in `rust-toolchain.toml`)
- Tauri Linux prerequisites when developing on Linux

Tauri's scaffold reported missing Linux desktop dependencies on this machine. Install the platform prerequisites from the official Tauri docs before running the native desktop shell.

On Debian/Ubuntu-like systems, use the full Tauri prerequisite set:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev gstreamer1.0-plugins-bad build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

`gstreamer1.0-plugins-bad` supplies WebKit's `webvttenc` and `fakevideosink` elements. Without it,
the desktop shell logs degraded subtitle handling and missing video-sink warnings at startup.

If installing dependencies piecemeal, the direct errors seen on this machine were `dbus-1`, `glib-2.0`, and `gdk-3.0`. Those are provided by development packages such as:

```bash
sudo apt install libdbus-1-dev libglib2.0-dev libgtk-3-dev pkg-config
```

## Commands

```bash
pnpm install
pnpm setup:piper
pnpm dev:desktop
pnpm dev:web
pnpm dev:stop
pnpm typecheck
pnpm test
pnpm build
pnpm build:desktop
pnpm check
pnpm check:native
pnpm qa:real-books
pnpm perf:large-books
cargo check
```

## TUI

The project includes a small local TUI at `scripts/dev-tui.mjs`. It reads `.dev-tui.json` with entries for:

- desktop app
- web renderer
- dev server stop command
- tests
- full JS/TS check
- native Rust/Tauri check
- real-book QA
- large-book performance harness

Run it with:

```bash
pnpm dev:tui
```

Use arrow keys or `j`/`k`, press Enter to run a command, and press `q` to quit.

For non-interactive checks, list the configured commands with:

```bash
pnpm dev:tui -- --list
```

## Verification Notes

Current verified commands:

- `pnpm install`
- `pnpm dev:tui -- --list`
- `pnpm dev:stop`
- `pnpm dev:desktop`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check`
- `pnpm check:native`
- `cargo fmt --check`
- `cargo check`

Current blocked commands:

- None known after Linux Tauri prerequisites are installed.

Run this from the repository root. The root `Cargo.toml` is a workspace that points to `apps/desktop/src-tauri`.

If native checks report missing system packages through `pkg-config`, install the Tauri prerequisite set above and retry.

If `pnpm dev:desktop` reports that port `1420` is already in use, run `pnpm dev:stop` and rerun the command.

## Real-Book QA

Run the release-oriented EPUB workflow check with:

```bash
pnpm qa:real-books
```

By default, the test looks for known local EPUB files in `~/Downloads/books`. To use specific files, pass a semicolon-separated list:

```bash
SONELLE_QA_EPUBS="/path/book-one.epub;/path/book-two.epub" pnpm qa:real-books
```

Use at least two books. The check imports each EPUB, verifies chapter titles do not collapse into the book title, saves and reopens reading position, creates a bookmark, searches the imported text, and exports the book data.

## Large-Book Performance Harness

Run the reader performance harness with:

```bash
pnpm perf:large-books
```

The harness always measures a synthetic large book, then adds any configured real EPUBs from `SONELLE_QA_EPUBS` or `~/Downloads/books`. It reports book size, chapter count, sentence count, import timing, persistence timing, open-book timing, and chapter-switch timing.

Use the same EPUB override format as real-book QA:

```bash
SONELLE_QA_EPUBS="/path/book-one.epub;/path/book-two.epub" pnpm perf:large-books
```

## Local Narration Voice

Sonelle uses Piper for local neural narration during desktop development.

Install the supported development voices with:

```bash
pnpm setup:piper
```

This creates a local `.sonelle/` sandbox containing:

- `piper-venv`: a Python virtual environment with Piper installed
- `voices/piper`: downloaded Piper voice files
- `piper-smoke-*.wav`: short generated samples proving each voice works

The default in-app voice is `en_US-amy-medium` (American English). By default,
`pnpm setup:piper` installs every voice exposed by the app: American and British English voices plus
the French voice. The catalog in `packages/audio/src/narration-voices.json` is the source of truth
for both the setup script and the native fallback.

To install only a specific voice while debugging, pass it when running setup:

```bash
SONELLE_PIPER_VOICE=en_GB-alba-medium pnpm setup:piper
```

Advanced overrides:

- `SONELLE_PIPER_BIN`: exact Piper executable
- `SONELLE_PIPER_PYTHON`: exact Python executable with the Piper module installed
- `SONELLE_PIPER_MODEL`: exact `.onnx` model path with a matching `.onnx.json` beside it; this overrides the in-app voice selection
- `SONELLE_PIPER_DATA_DIR`: directory containing downloaded Piper voices
- `SONELLE_PIPER_VOICE`: voice to install through `pnpm setup:piper`, and a native fallback for older requests without an explicit in-app voice
- `SONELLE_PIPER_VOICES`: comma, semicolon, or space separated list of voices to install through `pnpm setup:piper`

If no neural local voice is available, Sonelle shows a friendly needs-attention state instead of playing robotic system speech.

## CI and Releases

GitHub Actions runs two workflows:

- `CI`: verifies formatting, TypeScript, tests, frontend build, native Rust checks, and a Linux desktop bundle.
- `Release`: runs after a successful `main` CI build and publishes GitHub Releases for Linux, macOS, and Windows.

The release workflow uses `scripts/prepare-release-version.mjs` to compute the next patch version from existing `v*` tags. The computed version is applied to the package, Tauri, and Cargo manifests inside the workflow workspace before `tauri-apps/tauri-action` builds release bundles.

Release versions are not committed back to `main`; the immutable GitHub tag and release represent the shipped build. To intentionally move to a new base version, update the manifest versions in source and let the next release start from that value.

Manual release runs are available from the GitHub Actions `Release` workflow.
