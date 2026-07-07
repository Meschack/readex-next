# Development

## Requirements

- Node.js
- pnpm
- Rust and Cargo
- Tauri Linux prerequisites when developing on Linux

Tauri's scaffold reported missing Linux desktop dependencies on this machine. Install the platform prerequisites from the official Tauri docs before running the native desktop shell.

On Debian/Ubuntu-like systems, the missing `cargo check` dependency reported here was:

```bash
sudo apt install libdbus-1-dev pkg-config
```

The Tauri prerequisite set may require more packages, including WebKitGTK and librsvg development packages.

## Commands

```bash
pnpm install
pnpm dev:desktop
pnpm dev:web
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

## TUI

The project includes a small local TUI at `scripts/dev-tui.mjs`. It reads `.dev-tui.json` with entries for:

- desktop app
- web renderer
- tests
- typecheck

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
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check`
- `cargo fmt --check`

Current blocked command:

- `cargo check`

Reason: missing Linux system package `dbus-1` according to `pkg-config`.
