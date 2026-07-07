# Readex Next

Readex Next is a clean restart of Readex: a local-first app for reading EPUB books while listening to locally prepared narration.

The primary experience is a reader-first desktop workspace with sentence-level narration highlighting, a compact audio rail, and optional word-learning tools.

## Current Stage

Foundation and design direction.

No production app code has been scaffolded yet. The first goal is to lock the product direction, architecture principles, and guardrails so the implementation starts clean.

## Important Docs

- `AGENTS.md`: rules for agents working in this project
- `docs/product-direction.md`: product goals and non-goals
- `docs/design-direction.md`: visual and interaction direction
- `docs/architecture-principles.md`: event-driven and module design rules
- `docs/quality-system.md`: project guardrails and review checklist
- `docs/development.md`: local setup and commands
- `docs/decisions/`: architecture and product decisions

## Core Decisions

- Playback highlighting is sentence-level, not word-level.
- Word lookup is click/selection based.
- The app is reader-first, not podcast-first.
- User-facing copy must hide implementation internals.
- Desktop starts with Tauri + Solid + TypeScript.
- Long-running work should be modeled with domain events and UI-friendly projections.
