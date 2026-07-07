# Real-Book QA Pass: 2026-07-07

## Scope

This pass covered the importer, local persistence, reopen/resume, search, bookmarks, export, and large-chapter reader rendering behavior against local EPUB files with different structures.

Audio preparation remains covered by the existing fake and local adapter tests. Full native listening with the desktop file dialog is still a manual smoke area because the automated real-book QA runs below the Tauri shell.

## Command

```sh
cargo test real_book_qa_imports_configured_epubs_through_storage_workflow -- --ignored --nocapture
```

By default, the ignored QA test looks for EPUBs in `~/Downloads/books`. It can also be pointed at explicit files:

```sh
READEX_QA_EPUBS="/path/book-a.epub;/path/book-b.epub" cargo test real_book_qa_imports_configured_epubs_through_storage_workflow -- --ignored --nocapture
```

## Books Tested

| Book                                                                 | Chapters | Sentences | Largest chapter                                               |
| -------------------------------------------------------------------- | -------: | --------: | ------------------------------------------------------------- |
| The Selfish Gene: 40th Anniversary edition (Oxford Landmark Science) |       50 |     9,730 | Bibliography, 1,336 sentences                                 |
| The Kreutzer Sonata and Other Stories                                |       13 |     5,663 | The Kreutzer Sonata, 2,027 sentences                          |
| The God Delusion                                                     |       26 |     7,896 | Chapter 4 Why there almost certainly is no God, 873 sentences |
| The Way of the Superior Man                                          |       71 |     3,016 | Introduction, 174 sentences                                   |
| Industrial Society and Its Future                                    |       33 |     1,839 | Notes, 188 sentences                                          |
| Basic Economics - 5th Edition                                        |       70 |     9,746 | Notes, 1,069 sentences                                        |

## Checks

- EPUB import produced non-empty books and chapters.
- Chapter titles had enough diversity to catch collapsed-title imports.
- Imported books persisted into a temporary SQLite store.
- Books reopened successfully from the store.
- Reading position saved and restored.
- Bookmark creation and listing worked.
- Library search returned book-scoped results from imported sentence text.
- Export returned book data and saved bookmarks.
- Reader sentence render windows are covered by unit tests for large chapters.

## Findings Fixed

- EPUB 2 NCX files with a `DOCTYPE` were ignored by strict XML parsing, so some navigation labels never reached chapter import.
- XHTML 1.1 chapter files with a `DOCTYPE` parsed as empty, causing at least one valid EPUB to import as an empty book.
- Headings with leading inline anchors, such as `<h2><a id="..."/>Chapter</h2>`, failed direct text extraction and fell back to repeated document titles.

## Remaining Risk

- The real-book QA test uses local EPUB files and is intentionally ignored during normal test runs.
- The automated pass does not drive the native desktop file picker.
- Native audio playback should still get a human smoke test after re-importing a large book in the Tauri app.
