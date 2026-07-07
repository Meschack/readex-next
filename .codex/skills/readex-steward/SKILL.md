---
name: readex-steward
description: Use when working inside Readex Next to enforce reader-first UX, sentence-level highlighting, event-driven architecture, deep modules, and humane user-facing language.
---

# Readex Steward

Use this checklist before and after non-trivial Readex Next changes.

## Product Check

- The reader remains the primary surface.
- Playback supports sentence-level highlighting.
- Word lookup is click/selection based, not timing based.
- User copy avoids internals like chunk, job, queue worker, cache key, and sentence unit.

## Architecture Check

- The change belongs to one clear module.
- The module has a small interface and hides meaningful behavior.
- Platform details stay at the edge.
- Solid UI code does not know storage, filesystem, or TTS internals.
- Long-running work emits domain events or updates projections derived from domain events.

## Naming Check

Use domain language:

- book
- chapter
- sentence
- passage
- narration
- audio preparation
- playback position
- word insight

Avoid implementation language in product surfaces:

- chunk
- job
- worker
- IPC
- cache key

## Testing Check

- Test through interfaces.
- Add fake adapters where behavior varies.
- Prefer event/projection tests for flows.
- Avoid tests that assert private implementation details.

## Before Final Response

Report:

- what changed
- what decision was made, if any
- what was verified
- what remains intentionally out of scope
