# Roadmap

Readex Next is organized as vertical slices. Each phase should leave the app more usable, not merely more abstract.

## Phase 1: Foundation

Goal: create the project base and developer workflow.

Deliverables:

- Tauri + Solid desktop scaffold.
- pnpm workspace.
- package slots for domain, text, reader, library, audio, storage, and learning.
- root scripts for dev, typecheck, test, build, and format.
- TUI command config.
- GitHub issues and project guardrails.

Done when:

- `pnpm install` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test` succeeds.
- `pnpm build` succeeds for the renderer.

## Phase 2: Reader Slice

Goal: prove the core reading experience before importing real books.

Deliverables:

- fixture book loaded from local code.
- chapter text rendered in the reader.
- sentence segmentation.
- fake playback timer.
- sentence-by-sentence highlight.
- word click tooltip.

Done when:

- user can press play and watch the active sentence move.
- clicking a word opens a lightweight word insight popover.
- no user-facing copy mentions internal preparation machinery.

## Phase 3: Import And Persistence

Goal: make local books durable.

Deliverables:

- EPUB import through Tauri command.
- metadata and chapter extraction.
- sentence records persisted in SQLite.
- library view backed by local storage.
- resume last reading position.
- event projections for library and reader views.

Done when:

- imported books survive app restart.
- the user can reopen a book and resume reading.

## Phase 4: Audio Preparation

Goal: make local narration real without leaking internals.

Deliverables:

- audio preparation interface.
- fake TTS adapter retained for tests.
- first real local TTS adapter.
- sentence audio cache.
- sentence audio playback.
- humane status states: ready, preparing, needs attention.

Done when:

- user can listen to sentence audio and sentence highlighting follows playback.
- cached audio is reused.
- errors are actionable without mentioning chunks/jobs/workers.

## Phase 5: Learning Layer

Goal: make word inspection useful for language learners.

Deliverables:

- word selection/click model.
- word insight popover.
- optional right inspector panel.
- saved words.
- known/learning states.
- notes and examples.

Done when:

- word tools feel helpful but do not disturb reading or playback.

## Phase 6: Library Power Tools

Goal: round out daily use.

Deliverables:

- bookmarks.
- search.
- filters.
- export.
- audio settings.
- cache cleanup.
- keyboard shortcuts.

Done when:

- the app feels like a usable private reading/listening library.

## Phase 8: Release Readiness Before Visual Polish

Goal: smooth the small daily-use edges before the full UI polish pass.

Deliverables:

- narration preferences with a calmer default speed and explicit voice choice.
- persisted reader workflow preferences.
- duplicate import feedback.
- release QA commands and checklist.

Done when:

- Phase 8 issues are closed by a single release-readiness pass.
- `pnpm check`, `pnpm build`, and native checks pass.
- real-book QA is documented and available through a root command.
