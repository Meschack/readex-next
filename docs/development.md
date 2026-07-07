# Development

## Requirements

- Node.js
- pnpm
- Rust and Cargo
- Tauri Linux prerequisites when developing on Linux

Tauri's scaffold reported missing Linux desktop dependencies on this machine. Install the platform prerequisites from the official Tauri docs before running the native desktop shell.

On Debian/Ubuntu-like systems, use the full Tauri prerequisite set:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

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
pnpm check
pnpm check:native
pnpm qa:real-books
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
READEX_QA_EPUBS="/path/book-one.epub;/path/book-two.epub" pnpm qa:real-books
```

Use at least two books. The check imports each EPUB, verifies chapter titles do not collapse into the book title, saves and reopens reading position, creates a bookmark, searches the imported text, and exports the book data.

## Local Narration Voice

Readex uses Piper for local neural narration during desktop development.

Install the default development voice with:

```bash
pnpm setup:piper
```

This creates a local `.readex/` sandbox containing:

- `piper-venv`: a Python virtual environment with Piper installed
- `voices/piper`: downloaded Piper voice files
- `piper-smoke.wav`: a short generated sample proving the voice works

The default in-app voice is `en_US-lessac-medium` (American English). Install it with:

```bash
pnpm setup:piper
```

To install another supported voice for the settings panel, pass it when running setup:

```bash
READEX_PIPER_VOICE=en_GB-alba-medium pnpm setup:piper
```

Advanced overrides:

- `READEX_PIPER_BIN`: exact Piper executable
- `READEX_PIPER_PYTHON`: exact Python executable with the Piper module installed
- `READEX_PIPER_MODEL`: exact `.onnx` model path with a matching `.onnx.json` beside it; this overrides the in-app voice selection
- `READEX_PIPER_DATA_DIR`: directory containing downloaded Piper voices
- `READEX_PIPER_VOICE`: voice to install through `pnpm setup:piper`, and a native fallback for older requests without an explicit in-app voice

If no neural local voice is available, Readex shows a friendly needs-attention state instead of playing robotic system speech.
