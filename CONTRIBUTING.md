# Contributing

Thanks for helping with Readex Next.

## Local Setup

```bash
pnpm install
pnpm setup:piper
pnpm dev:desktop
```

Run the core checks before pushing:

```bash
pnpm format
pnpm typecheck
pnpm test
pnpm build
cargo check --workspace --locked
```

## Product Rules

- Keep the reader calm and book-first.
- Preserve original EPUB structure when possible.
- Use sentence-level highlighting, not word-by-word playback highlighting.
- Left click selects a sentence. Right click on a word opens lookup.
- Keep technical internals out of user-facing copy.
- Prefer explicit module boundaries over giant files that try to become a city government.

## Code Rules

- Use pnpm.
- Keep filenames kebab-case when practical.
- Keep Rust and TypeScript responsibilities separated.
- Add tests when changing parsing, storage, playback, release automation, or reader state.
- Update docs when behavior or commands change.

## Pull Requests

Open a PR with:

- what changed
- why it changed
- screenshots for UI changes
- commands used to verify the change

Small, focused PRs are easier to review and less likely to become soup.
