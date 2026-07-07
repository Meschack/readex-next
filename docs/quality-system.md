# Quality System

This file defines the project guardrails. It exists so the codebase does not quietly become a junk drawer with a logo.

## Required Practices

Use these on every meaningful change:

- Start from the relevant product decision or architecture note.
- Identify the module that owns the change.
- Keep user-facing copy free of implementation internals.
- Prefer domain events for long-running work.
- Test through module interfaces.
- Add or update a decision record when the choice affects future work.

## Module Contract Template

Every substantial module should have a short module note with this shape:

```md
# Module: Name

## Owns

## Does Not Own

## Interface

## Events

## Invariants

## Tests
```

## Pull Request / Change Checklist

- The reader-first product direction is preserved.
- Sentence-level highlighting remains the playback model.
- Word lookup does not require word-level audio timing.
- User copy says what the user can do or what the app needs, not what the internals are doing.
- The change has one clear owning module.
- Dependencies are passed in at seams instead of created deep inside business logic.
- Tests use real interfaces or faithful fake adapters.
- No unrelated refactors ride along.

## Code Smells To Stop Immediately

- UI code importing storage adapters.
- Storage code importing UI framework code.
- TTS code knowing about UI routes.
- UI copy containing chunk, job, worker, or cache key.
- A module with many methods that only pass through to another module.
- A test that reaches into private implementation details.
- A "temporary" abstraction with one adapter and no test leverage.

## Review Rhythm

Before finalizing a substantial change, run the Readex Steward checklist:

`.codex/skills/readex-steward/SKILL.md`

If the checklist catches a violation, fix it before presenting the work.
