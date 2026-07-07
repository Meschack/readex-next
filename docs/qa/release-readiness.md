# Release Readiness

Use this checklist before the visual-polish phase and before any packaged build is treated as shareable.

## Local Checks

- `pnpm check`
- `pnpm build`
- `pnpm check:native`
- `cargo fmt --check`
- `cargo check`

## Real-Book QA

Run this when at least two representative EPUBs are available:

```bash
pnpm qa:real-books
```

The real-book QA pass should cover:

- a small or medium EPUB
- a larger EPUB with long chapters
- chapter titles that come from navigation metadata, not only document titles
- reading position save and reopen
- bookmark save/list/delete
- library search
- export

## Product Smoke

- Import a fresh EPUB.
- Re-import the same EPUB and confirm the existing book reopens.
- Play narration at the default speed.
- Change narration voice and confirm playback pauses before the next sentence prepares.
- Change reader tool tab and library filter, reload, and confirm they persist.
- Search a chapter with results and without results.
- Check empty states for bookmarks and saved words.
