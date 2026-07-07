# 0003: Application Base

## Status

Accepted.

## Decision

Readex Next starts as a desktop-first TypeScript monorepo:

- desktop shell: Tauri
- renderer: Vite + Solid
- package manager: pnpm
- shared language: TypeScript
- native layer: Rust commands for filesystem, dialogs, local processes, audio preparation, and storage adapters
- storage model: SQLite-backed local projections behind storage interfaces
- long-running workflows: domain events plus projections

Do not use Electron, TanStack Start, Next.js, Remix, or SSR for the desktop renderer.

## Why

The first platform needs local filesystem access, native dialogs, subprocess control for local TTS, audio file serving, offline behavior, and export. Tauri gives us a smaller desktop shell and a stricter split between native capabilities and UI code.

Vite + Solid is enough for the renderer. Solid's fine-grained reactivity fits a reader/player UI where sentence highlight state, playback state, word inspection, and panels update independently without dragging the whole UI through unnecessary rerenders.

SSR-style application frameworks add routing/build complexity that does not buy much in a local desktop app.

SQLite is the right persistence shape because Readex has durable local relational state:

- books
- chapters
- sentences
- audio assets
- playback positions
- bookmarks
- word learning state
- domain event log

The storage implementation must sit behind interfaces so tests can use in-memory adapters and future mobile can use its own SQLite adapter.

## Alternatives Considered

Electron:

- Familiar and flexible.
- Easier to wire if everything is already Node-first.
- Larger runtime and easier to blur UI/native responsibilities.
- Too close to the old architecture we are intentionally leaving behind.

React:

- Familiar and ecosystem-rich.
- More likely to recreate provider-heavy state flows and broad rerenders.
- Solid is a better fit for a precise reading surface with small reactive updates.

Browser-only PWA:

- Good long-term optional target.
- Bad first target because local file handling, durable audio cache, and subprocess TTS are central.

SSR framework inside a desktop shell:

- Powerful for server-rendered web apps.
- Unnecessary for a local app shell.
- Encourages route/data complexity before the core modules are stable.

## Consequences

The new base should keep platform code at the edge:

- Tauri commands own native filesystem/dialog/subprocess adapters.
- Renderer owns UI only.
- Domain/use-case modules should run in tests without Tauri.

This decision can be revisited after the desktop base is stable.
