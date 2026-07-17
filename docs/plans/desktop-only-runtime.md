# Desktop-Only Runtime Plan

## Goal

Remove Sonelle's standalone browser runtime and its production browser fallbacks while preserving
the existing Tauri desktop application, shared domain packages, and test fakes.

This plan does **not** remove HTML, CSS, Solid, Vite, or the operating system webview. Tauri uses
those pieces to render the desktop interface. Removing them would require a separate native UI
rewrite in technologies such as SwiftUI, Jetpack Compose, or Flutter and is outside this plan.

## Current Browser Surface

The removable browser-specific behavior currently includes:

- the root `dev:web` command and browser-preview documentation
- runtime detection through `__TAURI_INTERNALS__`
- in-memory or local-storage fallbacks for books, bookmarks, narration, audio cache, events, and
  voice installation
- browser-only sample-library behavior used to keep the standalone preview useful
- tests that verify browser fallback selection rather than a desktop contract

The following pieces remain because the desktop application still needs them:

- `apps/desktop/index.html` as the Tauri frontend entry
- Vite as the renderer compiler and Tauri development asset server
- Solid components and CSS
- browser APIs intentionally used inside the desktop webview, such as media playback and selection
- fake repositories and narration adapters used explicitly by tests

## Target Architecture

Production dependency construction becomes desktop-only and explicit:

```text
Reader UI -> application workflows -> repository interfaces -> Tauri adapters -> native modules
```

No production repository chooses an adapter by inspecting `window`. Browser-shaped fakes remain
available only through test dependency injection.

## Migration

### 1. Lock The Desktop Contract

- Add integration tests for production dependency construction that assert every repository uses a
  Tauri adapter.
- Add smoke coverage for empty library, EPUB import, voice status, voice installation, narration,
  bookmarks, dictionary state, and reader preferences under the desktop dependency graph.
- Record the decision in `docs/decisions/` before removing fallbacks.

Exit condition: the native desktop path is covered independently of browser fallback behavior.

### 2. Separate Production Adapters From Test Fakes

- Make `createReaderExperienceDependencies` construct desktop adapters directly.
- Move `FakeNarrationGateway` and repository fakes into test-support modules or keep them in shared
  packages only when they are legitimate public testing interfaces.
- Remove `isTauriRuntime` checks from production repositories.
- Fail clearly during development if required Tauri APIs are unavailable instead of silently
  switching behavior.

Exit condition: opening the renderer outside Tauri cannot masquerade as a functioning Sonelle app.

### 3. Remove Browser Persistence

- Delete the browser book and bookmark repository.
- Delete browser audio-cache and voice-installation fallbacks.
- Decide whether preferences, dictionary entries, and audio settings remain in webview
  `localStorage` or move into native storage. The recommended choice is native storage so backup,
  migration, and reset behavior share one application-data boundary.
- If migrated, add domain events and storage migrations for preference changes where durable
  reactions matter; do not make UI handlers coordinate SQLite writes directly.

Exit condition: all durable user state lives beneath the Sonelle application-data directory.

### 4. Retire Browser-Only Product Behavior

- Remove `dev:web` and references to direct browser previewing from development scripts and docs.
- Remove browser-only sample-library branching. Keep a sample book only if it remains an intentional
  desktop onboarding feature; otherwise use the real empty-library experience.
- Simplify reader source types and code paths after the sample decision is made.
- Remove browser-only copy and styling that no longer has a reachable desktop state.

Exit condition: every production screen and state is reachable and testable through Tauri.

### 5. Tighten Tooling And CI

- Keep `pnpm build`; Tauri still requires a compiled renderer bundle.
- Keep Vite's development server behind `tauri dev`; remove only the public standalone command.
- Add a check that rejects new production `__TAURI_INTERNALS__` detection and browser fallback
  factories.
- Run TypeScript tests, Rust tests, desktop renderer build, native checks, and packaged smoke tests on
  Linux, Windows, and macOS.

Exit condition: CI verifies one supported production runtime instead of two vaguely similar ones.

### 6. Delete Compatibility Debris

- Remove dead browser adapters, obsolete storage keys, unused fixtures, and superseded tests.
- Update module ownership documentation and architecture diagrams.
- Run a final search for `dev:web`, browser repository names, runtime detection, and browser-only
  persistence keys.
- Perform a clean-state QA pass: import books, install each supported voice, narrate, restart,
  bookmark, search, clear audio, and verify persistence.

Exit condition: no browser production path remains, desktop QA is green, and the repository still
retains focused fakes for tests.

## Recommended Delivery Slices

1. Desktop dependency graph and contract tests.
2. Native settings, preferences, and dictionary persistence.
3. Browser repository and fallback removal.
4. Sample-reader decision and reader simplification.
5. Script, documentation, CI, and dead-code cleanup.

Each slice should be independently reviewable and leave the desktop application functional. The
state migration should land before deleting local-storage readers so existing desktop users do not
lose settings during an upgrade.

## Risks

- Removing fallbacks too early can make unit tests accidentally depend on Tauri globals.
- Moving local-storage state without a one-time migration can reset user preferences and saved
  dictionary entries.
- Deleting the Vite server or HTML entry would break Tauri development and packaging; they are not
  standalone-web features.
- Removing the sample reader changes first-run UX and must be treated as a product decision, not
  cleanup lint.

## Intentionally Deferred

- Replacing Tauri's webview UI with a native widget toolkit
- Mobile architecture or shared mobile UI decisions
- Removing legacy `.readex` data discovery, which requires its own migration cutoff policy
