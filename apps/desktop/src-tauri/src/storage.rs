use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::{
    epub_import::{read_epub_language, ImportedBook, ImportedCover},
    text::{segment_normalized_paragraphs, segment_paragraphs},
};

mod event_journal;
mod model;

use event_journal::{insert_event, insert_renderer_event};
pub use model::*;

#[derive(Clone)]
pub struct SonelleStore {
    db_path: PathBuf,
    covers_dir: PathBuf,
}

impl SonelleStore {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "We couldn't open the local library folder.".to_string())?;
        fs::create_dir_all(&app_dir)
            .map_err(|_| "We couldn't prepare the local library folder.".to_string())?;
        let store = Self {
            db_path: app_dir.join("sonelle.sqlite3"),
            covers_dir: app_dir.join("covers"),
        };

        store.init()?;
        Ok(store)
    }

    pub fn record_domain_event(&self, event: RecordDomainEventRequest) -> Result<(), String> {
        let connection = self.connect()?;
        insert_renderer_event(
            &connection,
            &event.id,
            &event.name,
            &event.occurred_at,
            &event.payload,
        )
    }

    #[cfg(test)]
    fn open_at(db_path: PathBuf) -> Result<Self, String> {
        let covers_dir = db_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("covers");
        let store = Self {
            db_path,
            covers_dir,
        };
        store.init()?;
        Ok(store)
    }

    pub fn save_imported_book(&self, book: ImportedBook) -> Result<ReaderDocumentView, String> {
        let mut connection = self.connect()?;
        let imported_at = now();
        let replaced_existing = connection
            .query_row(
                "SELECT 1 FROM books WHERE id = ?1",
                params![book.id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| "We couldn't inspect the local library.".to_string())?
            .is_some();
        let cover_image_src = self.persist_cover(&book.id, book.cover_image.as_ref())?;
        let transaction = connection
            .transaction()
            .map_err(|_| "We couldn't save that book.".to_string())?;

        transaction
            .execute(
                "INSERT INTO books (id, title, author, language, cover_image_src, source_path, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title,
                   author = excluded.author,
                   language = excluded.language,
                   cover_image_src = excluded.cover_image_src,
                   source_path = excluded.source_path",
                params![
                    book.id,
                    book.title,
                    book.author,
                    book.language,
                    cover_image_src,
                    book.source_path,
                    imported_at
                ],
            )
            .map_err(|_| "We couldn't save that book.".to_string())?;
        transaction
            .execute(
                "DELETE FROM paragraphs WHERE book_id = ?1",
                params![book.id],
            )
            .map_err(|_| "We couldn't refresh that book.".to_string())?;
        transaction
            .execute("DELETE FROM sentences WHERE book_id = ?1", params![book.id])
            .map_err(|_| "We couldn't refresh that book.".to_string())?;
        transaction
            .execute("DELETE FROM chapters WHERE book_id = ?1", params![book.id])
            .map_err(|_| "We couldn't refresh that book.".to_string())?;

        {
            let mut insert_chapter = transaction
                .prepare(
                    "INSERT INTO chapters (id, book_id, title, position, body, sentence_count)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(|_| "We couldn't save a chapter from that book.".to_string())?;
            let mut insert_sentence = transaction
                .prepare(
                    "INSERT INTO sentences (id, book_id, chapter_id, position, text)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .map_err(|_| "We couldn't save a sentence from that book.".to_string())?;
            let mut insert_paragraph = transaction
                .prepare(
                    "INSERT INTO paragraphs (
                        id,
                        book_id,
                        chapter_id,
                        position,
                        start_sentence_index,
                        sentence_count
                     )
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(|_| "We couldn't save a paragraph from that book.".to_string())?;

            let mut total_sentence_count = 0_i64;
            for chapter in &book.chapters {
                let normalized_body = chapter.body.clone();
                let paragraph_sentences = segment_normalized_paragraphs(&normalized_body);
                let chapter_sentence_count = paragraph_sentences
                    .iter()
                    .map(|sentences| sentences.len() as i64)
                    .sum::<i64>();
                total_sentence_count += chapter_sentence_count;

                insert_chapter
                    .execute(params![
                        chapter.id,
                        book.id,
                        chapter.title,
                        chapter.index as i64,
                        normalized_body,
                        chapter_sentence_count
                    ])
                    .map_err(|_| "We couldn't save a chapter from that book.".to_string())?;

                let mut sentence_index = 0_i64;
                for (paragraph_index, sentences) in paragraph_sentences.iter().enumerate() {
                    let paragraph_start = sentence_index;

                    for sentence in sentences {
                        insert_sentence
                            .execute(params![
                                format!("{}:sentence-{}", chapter.id, sentence_index + 1),
                                book.id,
                                chapter.id,
                                sentence_index,
                                sentence
                            ])
                            .map_err(|_| {
                                "We couldn't save a sentence from that book.".to_string()
                            })?;
                        sentence_index += 1;
                    }

                    let sentence_count = sentence_index - paragraph_start;
                    if sentence_count > 0 {
                        insert_paragraph
                            .execute(params![
                                format!("{}:paragraph-{}", chapter.id, paragraph_index + 1),
                                book.id,
                                chapter.id,
                                paragraph_index as i64,
                                paragraph_start,
                                sentence_count
                            ])
                            .map_err(|_| {
                                "We couldn't save a paragraph from that book.".to_string()
                            })?;
                    }
                }
            }

            transaction
                .execute(
                    "UPDATE books
                     SET chapter_count = ?2, sentence_count = ?3
                     WHERE id = ?1",
                    params![book.id, book.chapters.len() as i64, total_sentence_count],
                )
                .map_err(|_| "We couldn't finish saving that book.".to_string())?;
        }

        let first_chapter = book
            .chapters
            .first()
            .ok_or_else(|| "That book did not include readable chapters.".to_string())?;
        transaction
            .execute(
                "INSERT INTO reading_positions (book_id, chapter_id, sentence_index, updated_at)
                 VALUES (?1, ?2, 0, ?3)
                 ON CONFLICT(book_id) DO NOTHING",
                params![book.id, first_chapter.id, imported_at],
            )
            .map_err(|_| "We couldn't save your reading place.".to_string())?;

        insert_event(
            &transaction,
            "BookImported",
            json!({
                "bookId": book.id,
                "title": book.title,
                "chapterCount": book.chapters.len(),
                "replacedExisting": replaced_existing
            }),
        )?;

        transaction
            .commit()
            .map_err(|_| "We couldn't finish saving that book.".to_string())?;
        self.open_book(&book.id, Some(&first_chapter.id))
    }

    pub fn list_books(&self) -> Result<Vec<LibraryBookView>, String> {
        let connection = self.connect()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    books.id,
                    books.title,
                    books.author,
                    books.cover_image_src,
                    books.imported_at,
                    books.chapter_count,
                    books.sentence_count,
                    reading_positions.chapter_id,
                    COALESCE(reading_positions.sentence_index, 0)
                 FROM books
                 LEFT JOIN reading_positions ON reading_positions.book_id = books.id
                 ORDER BY books.imported_at DESC",
            )
            .map_err(|_| "We couldn't read your library.".to_string())?;
        let books = statement
            .query_map([], |row| {
                Ok(LibraryBookView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    author: row.get(2)?,
                    cover_image_src: row.get(3)?,
                    imported_at: row.get(4)?,
                    chapter_count: row.get(5)?,
                    sentence_count: row.get(6)?,
                    last_chapter_id: row.get(7)?,
                    last_sentence_index: row.get(8)?,
                })
            })
            .map_err(|_| "We couldn't read your library.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read your library.".to_string())?;

        Ok(books)
    }

    pub fn open_book(
        &self,
        book_id: &str,
        requested_chapter_id: Option<&str>,
    ) -> Result<ReaderDocumentView, String> {
        let connection = self.connect()?;
        let book = self.read_book(&connection, book_id)?;
        let mut chapters = self.read_chapter_summaries(&connection, book_id)?;
        let position = self.read_position(&connection, book_id)?;
        let active_chapter_id = resolve_active_chapter_id(
            &chapters,
            requested_chapter_id,
            position.as_ref().map(|entry| entry.chapter_id.as_str()),
        );

        if let Some(chapter_id) = active_chapter_id.as_deref() {
            let sentences = self.read_sentences_for_chapter(&connection, chapter_id)?;
            let paragraphs = self.read_paragraphs_for_chapter(&connection, chapter_id)?;
            if let Some(chapter) = chapters.iter_mut().find(|entry| entry.id == chapter_id) {
                chapter.sentences = sentences;
                chapter.paragraphs = paragraphs;
            }
        }

        Ok(ReaderDocumentView {
            book,
            active_chapter_id,
            chapters,
            position,
        })
    }

    fn open_book_for_export(&self, book_id: &str) -> Result<ReaderDocumentView, String> {
        let connection = self.connect()?;
        let book = self.read_book(&connection, book_id)?;
        let chapters = self.read_chapters_with_sentences(&connection, book_id)?;
        let position = self.read_position(&connection, book_id)?;
        let active_chapter_id = resolve_active_chapter_id(
            &chapters,
            None,
            position.as_ref().map(|entry| entry.chapter_id.as_str()),
        );

        Ok(ReaderDocumentView {
            book,
            active_chapter_id,
            chapters,
            position,
        })
    }

    pub fn save_reading_position(
        &self,
        position: SaveReadingPositionRequest,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        let updated_at = now();
        connection
            .execute(
                "INSERT INTO reading_positions (book_id, chapter_id, sentence_index, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(book_id) DO UPDATE SET
                   chapter_id = excluded.chapter_id,
                   sentence_index = excluded.sentence_index,
                   updated_at = excluded.updated_at",
                params![
                    position.book_id,
                    position.chapter_id,
                    position.sentence_index,
                    updated_at
                ],
            )
            .map_err(|_| "We couldn't save your reading place.".to_string())?;

        insert_event(
            &connection,
            "PlaybackPositionChanged",
            json!({
                "bookId": position.book_id,
                "chapterId": position.chapter_id,
                "sentenceIndex": position.sentence_index
            }),
        )
    }

    pub fn list_bookmarks(&self, book_id: Option<&str>) -> Result<Vec<BookmarkView>, String> {
        let connection = self.connect()?;

        if let Some(book_id) = book_id {
            let mut statement = connection
                .prepare(
                    "SELECT
                        bookmarks.id,
                        bookmarks.book_id,
                        books.title,
                        bookmarks.chapter_id,
                        chapters.title,
                        bookmarks.sentence_id,
                        bookmarks.sentence_index,
                        bookmarks.text,
                        bookmarks.note,
                        bookmarks.created_at
                     FROM bookmarks
                     INNER JOIN books ON books.id = bookmarks.book_id
                     INNER JOIN chapters ON chapters.id = bookmarks.chapter_id
                     WHERE bookmarks.book_id = ?1
                     ORDER BY bookmarks.created_at DESC",
                )
                .map_err(|_| "We couldn't read your bookmarks.".to_string())?;

            let bookmarks = statement
                .query_map(params![book_id], read_bookmark_row)
                .map_err(|_| "We couldn't read your bookmarks.".to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| "We couldn't read your bookmarks.".to_string())?;

            return Ok(bookmarks);
        }

        let mut statement = connection
            .prepare(
                "SELECT
                    bookmarks.id,
                    bookmarks.book_id,
                    books.title,
                    bookmarks.chapter_id,
                    chapters.title,
                    bookmarks.sentence_id,
                    bookmarks.sentence_index,
                    bookmarks.text,
                    bookmarks.note,
                    bookmarks.created_at
                 FROM bookmarks
                 INNER JOIN books ON books.id = bookmarks.book_id
                 INNER JOIN chapters ON chapters.id = bookmarks.chapter_id
                 ORDER BY bookmarks.created_at DESC",
            )
            .map_err(|_| "We couldn't read your bookmarks.".to_string())?;

        let bookmarks = statement
            .query_map([], read_bookmark_row)
            .map_err(|_| "We couldn't read your bookmarks.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read your bookmarks.".to_string())?;

        Ok(bookmarks)
    }

    pub fn save_bookmark(&self, bookmark: SaveBookmarkRequest) -> Result<BookmarkView, String> {
        let connection = self.connect()?;
        let id = bookmark_id(
            &bookmark.book_id,
            &bookmark.chapter_id,
            &bookmark.sentence_id,
        );
        let created_at = connection
            .query_row(
                "SELECT created_at FROM bookmarks WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| "We couldn't save that bookmark.".to_string())?
            .unwrap_or_else(now);

        connection
            .execute(
                "INSERT INTO bookmarks (
                    id,
                    book_id,
                    chapter_id,
                    sentence_id,
                    sentence_index,
                    text,
                    note,
                    created_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(book_id, chapter_id, sentence_id) DO UPDATE SET
                   sentence_index = excluded.sentence_index,
                   text = excluded.text,
                   note = excluded.note",
                params![
                    id,
                    bookmark.book_id,
                    bookmark.chapter_id,
                    bookmark.sentence_id,
                    bookmark.sentence_index,
                    bookmark.text,
                    bookmark.note,
                    created_at
                ],
            )
            .map_err(|_| "We couldn't save that bookmark.".to_string())?;

        insert_event(
            &connection,
            "BookmarkCreated",
            json!({
                "bookmarkId": id,
                "bookId": bookmark.book_id,
                "chapterId": bookmark.chapter_id,
                "sentenceId": bookmark.sentence_id,
                "sentenceIndex": bookmark.sentence_index
            }),
        )?;

        self.read_bookmark_by_id(&connection, &id)
    }

    pub fn delete_bookmark(&self, bookmark_id: &str) -> Result<(), String> {
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction()
            .map_err(|_| "We couldn't prepare that bookmark update.".to_string())?;
        let book_id = transaction
            .query_row(
                "SELECT book_id FROM bookmarks WHERE id = ?1",
                params![bookmark_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| "We couldn't find that bookmark.".to_string())?;
        let deleted = transaction
            .execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])
            .map_err(|_| "We couldn't remove that bookmark.".to_string())?;

        if let (true, Some(book_id)) = (deleted > 0, book_id) {
            insert_event(
                &transaction,
                "BookmarkDeleted",
                json!({
                    "bookmarkId": bookmark_id,
                    "bookId": book_id
                }),
            )?;
        }

        transaction
            .commit()
            .map_err(|_| "We couldn't finish removing that bookmark.".to_string())
    }

    pub fn search_library(
        &self,
        request: LibrarySearchRequest,
    ) -> Result<Vec<LibrarySearchResultView>, String> {
        let query = normalize_search_query(&request.query);
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let connection = self.connect()?;
        let limit = request.limit.unwrap_or(20).clamp(1, 50);
        let pattern = like_pattern(&query);
        let mut results =
            self.search_books(&connection, request.book_id.as_deref(), &pattern, limit)?;
        let remaining = limit - results.len() as i64;

        if remaining > 0 {
            results.extend(self.search_sentences(
                &connection,
                request.book_id.as_deref(),
                &query,
                remaining,
            )?);
        }

        Ok(results)
    }

    pub fn export_book_data(&self, book_id: &str) -> Result<BookExportView, String> {
        let connection = self.connect()?;
        insert_event(
            &connection,
            "BookExportRequested",
            json!({
                "bookId": book_id
            }),
        )?;

        let document = self.open_book_for_export(book_id)?;
        let bookmarks = self.list_bookmarks(Some(book_id))?;
        let exported_at = now();
        insert_event(
            &connection,
            "BookExported",
            json!({
                "bookId": book_id,
                "bookmarkCount": bookmarks.len(),
                "exportedAt": exported_at,
                "fileName": null
            }),
        )?;

        Ok(BookExportView {
            exported_at,
            book: document.book,
            chapters: document.chapters,
            position: document.position,
            bookmarks,
        })
    }

    fn init(&self) -> Result<(), String> {
        let connection = self.connect()?;
        let has_sentence_search = connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sentence_search'",
                [],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| "We couldn't inspect the local library.".to_string())?
            .is_some();
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS books (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    author TEXT NOT NULL,
                    language TEXT,
                    cover_image_src TEXT,
                    source_path TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    chapter_count INTEGER NOT NULL DEFAULT 0,
                    sentence_count INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS chapters (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    body TEXT NOT NULL,
                    sentence_count INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS sentences (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    text TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS paragraphs (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    start_sentence_index INTEGER NOT NULL,
                    sentence_count INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS reading_positions (
                    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                    sentence_index INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS bookmarks (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                    sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
                    sentence_index INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    note TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(book_id, chapter_id, sentence_id)
                );

                CREATE TABLE IF NOT EXISTS domain_events (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_chapters_book_position
                    ON chapters(book_id, position);
                CREATE INDEX IF NOT EXISTS idx_sentences_chapter_position
                    ON sentences(chapter_id, position);
                CREATE INDEX IF NOT EXISTS idx_sentences_book_chapter_position
                    ON sentences(book_id, chapter_id, position);
                CREATE INDEX IF NOT EXISTS idx_paragraphs_chapter_position
                    ON paragraphs(chapter_id, position);
                CREATE INDEX IF NOT EXISTS idx_bookmarks_book_created
                    ON bookmarks(book_id, created_at);

                CREATE VIRTUAL TABLE IF NOT EXISTS sentence_search USING fts5(
                    text,
                    content = 'sentences',
                    content_rowid = 'rowid',
                    tokenize = 'unicode61 remove_diacritics 2'
                );

                CREATE TRIGGER IF NOT EXISTS sentences_search_insert
                AFTER INSERT ON sentences BEGIN
                    INSERT INTO sentence_search(rowid, text) VALUES (new.rowid, new.text);
                END;

                CREATE TRIGGER IF NOT EXISTS sentences_search_delete
                AFTER DELETE ON sentences BEGIN
                    INSERT INTO sentence_search(sentence_search, rowid, text)
                    VALUES ('delete', old.rowid, old.text);
                END;

                CREATE TRIGGER IF NOT EXISTS sentences_search_update
                AFTER UPDATE OF text ON sentences BEGIN
                    INSERT INTO sentence_search(sentence_search, rowid, text)
                    VALUES ('delete', old.rowid, old.text);
                    INSERT INTO sentence_search(rowid, text) VALUES (new.rowid, new.text);
                END;
                ",
            )
            .map_err(|_| "We couldn't prepare the local library.".to_string())?;

        if !has_sentence_search {
            connection
                .execute(
                    "INSERT INTO sentence_search(sentence_search) VALUES ('rebuild')",
                    [],
                )
                .map_err(|_| "We couldn't index the local library.".to_string())?;
        }

        ensure_column(&connection, "books", "cover_image_src", "TEXT")?;
        ensure_column(&connection, "books", "language", "TEXT")?;
        let added_book_chapter_count = ensure_column(
            &connection,
            "books",
            "chapter_count",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        let added_book_sentence_count = ensure_column(
            &connection,
            "books",
            "sentence_count",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        let added_chapter_sentence_count = ensure_column(
            &connection,
            "chapters",
            "sentence_count",
            "INTEGER NOT NULL DEFAULT 0",
        )?;

        if added_book_chapter_count || added_book_sentence_count {
            connection
                .execute_batch(
                    "UPDATE books
                     SET chapter_count = (
                            SELECT COUNT(*) FROM chapters WHERE chapters.book_id = books.id
                         ),
                         sentence_count = (
                            SELECT COUNT(*) FROM sentences WHERE sentences.book_id = books.id
                         );",
                )
                .map_err(|_| "We couldn't update library summaries.".to_string())?;
        }

        if added_chapter_sentence_count {
            connection
                .execute_batch(
                    "UPDATE chapters
                     SET sentence_count = (
                        SELECT COUNT(*) FROM sentences WHERE sentences.chapter_id = chapters.id
                     );",
                )
                .map_err(|_| "We couldn't update chapter summaries.".to_string())?;
        }

        Ok(())
    }

    fn read_book(&self, connection: &Connection, book_id: &str) -> Result<ReaderBookView, String> {
        let (mut book, source_path) = connection
            .query_row(
                "SELECT id, title, author, language, cover_image_src, source_path
                 FROM books WHERE id = ?1",
                params![book_id],
                |row| {
                    Ok((
                        ReaderBookView {
                            id: row.get(0)?,
                            title: row.get(1)?,
                            author: row.get(2)?,
                            language: row.get(3)?,
                            cover_image_src: row.get(4)?,
                        },
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| "We couldn't open that book.".to_string())?
            .ok_or_else(|| "We couldn't find that book in your library.".to_string())?;

        if book.language.is_none() {
            if let Some(language) = read_epub_language(Path::new(&source_path)) {
                let _ = connection.execute(
                    "UPDATE books SET language = ?1 WHERE id = ?2",
                    params![&language, &book.id],
                );
                book.language = Some(language);
            }
        }

        Ok(book)
    }

    fn read_position(
        &self,
        connection: &Connection,
        book_id: &str,
    ) -> Result<Option<ReadingPositionView>, String> {
        connection
            .query_row(
                "SELECT book_id, chapter_id, sentence_index, updated_at
                 FROM reading_positions WHERE book_id = ?1",
                params![book_id],
                |row| {
                    Ok(ReadingPositionView {
                        book_id: row.get(0)?,
                        chapter_id: row.get(1)?,
                        sentence_index: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|_| "We couldn't restore your reading place.".to_string())
    }

    fn read_chapter_summaries(
        &self,
        connection: &Connection,
        book_id: &str,
    ) -> Result<Vec<ReaderChapterView>, String> {
        let mut statement = connection
            .prepare(
                "SELECT
                    chapters.id,
                    chapters.title,
                    chapters.position,
                    chapters.sentence_count
                 FROM chapters
                 WHERE chapters.book_id = ?1
                 ORDER BY chapters.position ASC",
            )
            .map_err(|_| "We couldn't read that book.".to_string())?;
        let chapters = statement
            .query_map(params![book_id], |row| {
                Ok(ReaderChapterView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    index: row.get(2)?,
                    sentence_count: row.get(3)?,
                    sentences: Vec::new(),
                    paragraphs: Vec::new(),
                })
            })
            .map_err(|_| "We couldn't read that book.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read that book.".to_string())?;

        Ok(chapters)
    }

    fn read_chapters_with_sentences(
        &self,
        connection: &Connection,
        book_id: &str,
    ) -> Result<Vec<ReaderChapterView>, String> {
        let mut chapters = self.read_chapter_summaries(connection, book_id)?;
        let chapter_indexes = chapters
            .iter()
            .enumerate()
            .map(|(index, chapter)| (chapter.id.clone(), index))
            .collect::<HashMap<_, _>>();

        for (chapter_id, sentence) in self.read_sentences_for_book(connection, book_id)? {
            if let Some(chapter_index) = chapter_indexes.get(&chapter_id) {
                chapters[*chapter_index].sentences.push(sentence);
            }
        }

        for chapter in &mut chapters {
            chapter.paragraphs = self.read_paragraphs_for_chapter(connection, &chapter.id)?;
        }

        Ok(chapters)
    }

    fn read_sentences_for_chapter(
        &self,
        connection: &Connection,
        chapter_id: &str,
    ) -> Result<Vec<ReaderSentenceView>, String> {
        let mut statement = connection
            .prepare(
                "SELECT id, position, text FROM sentences
                 WHERE chapter_id = ?1
                 ORDER BY position ASC",
            )
            .map_err(|_| "We couldn't read that chapter.".to_string())?;

        let sentences = statement
            .query_map(params![chapter_id], |row| {
                Ok(ReaderSentenceView {
                    id: row.get(0)?,
                    index: row.get(1)?,
                    text: row.get(2)?,
                })
            })
            .map_err(|_| "We couldn't read that chapter.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read that chapter.".to_string())?;

        Ok(sentences)
    }

    fn read_paragraphs_for_chapter(
        &self,
        connection: &Connection,
        chapter_id: &str,
    ) -> Result<Vec<ReaderParagraphView>, String> {
        let persisted = self.read_persisted_paragraphs_for_chapter(connection, chapter_id)?;
        if !persisted.is_empty() {
            return Ok(persisted);
        }

        self.read_paragraphs_from_chapter_body(connection, chapter_id)
    }

    fn read_persisted_paragraphs_for_chapter(
        &self,
        connection: &Connection,
        chapter_id: &str,
    ) -> Result<Vec<ReaderParagraphView>, String> {
        let mut statement = connection
            .prepare(
                "SELECT id, position, start_sentence_index, sentence_count
                 FROM paragraphs
                 WHERE chapter_id = ?1
                 ORDER BY position ASC",
            )
            .map_err(|_| "We couldn't read that chapter.".to_string())?;
        let paragraphs = statement
            .query_map(params![chapter_id], |row| {
                Ok(ReaderParagraphView {
                    id: row.get(0)?,
                    index: row.get(1)?,
                    start_sentence_index: row.get(2)?,
                    sentence_count: row.get(3)?,
                })
            })
            .map_err(|_| "We couldn't read that chapter.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read that chapter.".to_string())?;

        Ok(paragraphs)
    }

    fn read_paragraphs_from_chapter_body(
        &self,
        connection: &Connection,
        chapter_id: &str,
    ) -> Result<Vec<ReaderParagraphView>, String> {
        let body = connection
            .query_row(
                "SELECT body FROM chapters WHERE id = ?1",
                params![chapter_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| "We couldn't read that chapter.".to_string())?
            .unwrap_or_default();
        let mut sentence_index = 0_i64;

        Ok(segment_paragraphs(&body)
            .into_iter()
            .enumerate()
            .map(|(paragraph_index, sentences)| {
                let start_sentence_index = sentence_index;
                let sentence_count = sentences.len() as i64;
                sentence_index += sentence_count;

                ReaderParagraphView {
                    id: format!("{chapter_id}:paragraph-{}", paragraph_index + 1),
                    index: paragraph_index as i64,
                    start_sentence_index,
                    sentence_count,
                }
            })
            .collect())
    }

    fn read_sentences_for_book(
        &self,
        connection: &Connection,
        book_id: &str,
    ) -> Result<Vec<(String, ReaderSentenceView)>, String> {
        let mut statement = connection
            .prepare(
                "SELECT chapter_id, id, position, text FROM sentences
                 WHERE book_id = ?1
                 ORDER BY chapter_id ASC, position ASC",
            )
            .map_err(|_| "We couldn't read that chapter.".to_string())?;

        let sentences = statement
            .query_map(params![book_id], |row| {
                Ok((
                    row.get(0)?,
                    ReaderSentenceView {
                        id: row.get(1)?,
                        index: row.get(2)?,
                        text: row.get(3)?,
                    },
                ))
            })
            .map_err(|_| "We couldn't read that chapter.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read that chapter.".to_string())?;

        Ok(sentences)
    }

    fn read_bookmark_by_id(
        &self,
        connection: &Connection,
        bookmark_id: &str,
    ) -> Result<BookmarkView, String> {
        connection
            .query_row(
                "SELECT
                    bookmarks.id,
                    bookmarks.book_id,
                    books.title,
                    bookmarks.chapter_id,
                    chapters.title,
                    bookmarks.sentence_id,
                    bookmarks.sentence_index,
                    bookmarks.text,
                    bookmarks.note,
                    bookmarks.created_at
                 FROM bookmarks
                 INNER JOIN books ON books.id = bookmarks.book_id
                 INNER JOIN chapters ON chapters.id = bookmarks.chapter_id
                 WHERE bookmarks.id = ?1",
                params![bookmark_id],
                read_bookmark_row,
            )
            .map_err(|_| "We couldn't read that bookmark.".to_string())
    }

    fn search_books(
        &self,
        connection: &Connection,
        book_id: Option<&str>,
        pattern: &str,
        limit: i64,
    ) -> Result<Vec<LibrarySearchResultView>, String> {
        let mut statement = connection
            .prepare(
                "SELECT id, title, author
                 FROM books
                 WHERE (?1 IS NULL OR id = ?1)
                   AND (
                    LOWER(title) LIKE ?2 ESCAPE '\\'
                    OR LOWER(author) LIKE ?2 ESCAPE '\\'
                   )
                 ORDER BY imported_at DESC
                 LIMIT ?3",
            )
            .map_err(|_| "We couldn't search your library.".to_string())?;

        let results = statement
            .query_map(params![book_id, pattern, limit], |row| {
                let id: String = row.get(0)?;
                let title: String = row.get(1)?;
                let author: String = row.get(2)?;

                Ok(LibrarySearchResultView {
                    id: format!("book:{id}"),
                    kind: "book".to_string(),
                    book_id: id,
                    book_title: title.clone(),
                    author,
                    chapter_id: None,
                    chapter_title: None,
                    sentence_id: None,
                    sentence_index: None,
                    excerpt: title,
                })
            })
            .map_err(|_| "We couldn't search your library.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't search your library.".to_string())?;

        Ok(results)
    }

    fn search_sentences(
        &self,
        connection: &Connection,
        book_id: Option<&str>,
        query: &str,
        limit: i64,
    ) -> Result<Vec<LibrarySearchResultView>, String> {
        let search_query = fts_search_query(query);
        if search_query.is_empty() {
            return Ok(Vec::new());
        }

        let mut statement = connection
            .prepare(
                "SELECT
                    sentences.id,
                    books.id,
                    books.title,
                    books.author,
                    chapters.id,
                    chapters.title,
                    sentences.position,
                    sentences.text
                 FROM sentence_search
                 INNER JOIN sentences ON sentences.rowid = sentence_search.rowid
                 INNER JOIN books ON books.id = sentences.book_id
                 INNER JOIN chapters ON chapters.id = sentences.chapter_id
                 WHERE (?1 IS NULL OR books.id = ?1)
                   AND sentence_search MATCH ?2
                 ORDER BY bm25(sentence_search), books.imported_at DESC,
                          chapters.position ASC, sentences.position ASC
                 LIMIT ?3",
            )
            .map_err(|_| "We couldn't search your library.".to_string())?;

        let results = statement
            .query_map(params![book_id, search_query, limit], |row| {
                let sentence_id: String = row.get(0)?;

                Ok(LibrarySearchResultView {
                    id: format!("sentence:{sentence_id}"),
                    kind: "sentence".to_string(),
                    book_id: row.get(1)?,
                    book_title: row.get(2)?,
                    author: row.get(3)?,
                    chapter_id: Some(row.get(4)?),
                    chapter_title: Some(row.get(5)?),
                    sentence_id: Some(sentence_id),
                    sentence_index: Some(row.get(6)?),
                    excerpt: row.get(7)?,
                })
            })
            .map_err(|_| "We couldn't search your library.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't search your library.".to_string())?;

        Ok(results)
    }

    fn persist_cover(
        &self,
        book_id: &str,
        cover: Option<&ImportedCover>,
    ) -> Result<Option<String>, String> {
        let Some(cover) = cover else {
            return Ok(None);
        };

        fs::create_dir_all(&self.covers_dir)
            .map_err(|_| "We couldn't save that book cover.".to_string())?;
        let digest = Sha256::digest(book_id.as_bytes());
        let path = self.covers_dir.join(format!(
            "cover-{}.{}",
            hex_prefix(&digest, 24),
            cover_file_extension(&cover.media_type)
        ));
        fs::write(&path, &cover.bytes)
            .map_err(|_| "We couldn't save that book cover.".to_string())?;

        Ok(Some(path.to_string_lossy().into_owned()))
    }

    fn connect(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.db_path)
            .map_err(|_| "We couldn't open the local library.".to_string())?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA busy_timeout = 5000;",
            )
            .map_err(|_| "We couldn't prepare the local library connection.".to_string())?;
        Ok(connection)
    }
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<bool, String> {
    let escaped_table = table.replace('"', "\"\"");
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info(\"{escaped_table}\")"))
        .map_err(|_| "We couldn't prepare the local library.".to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| "We couldn't prepare the local library.".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "We couldn't prepare the local library.".to_string())?;

    if columns.iter().any(|name| name == column) {
        return Ok(false);
    }

    let escaped_column = column.replace('"', "\"\"");
    connection
        .execute(
            &format!(
                "ALTER TABLE \"{escaped_table}\" ADD COLUMN \"{escaped_column}\" {definition}"
            ),
            [],
        )
        .map(|_| true)
        .map_err(|_| "We couldn't prepare the local library.".to_string())
}

fn read_bookmark_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookmarkView> {
    Ok(BookmarkView {
        id: row.get(0)?,
        book_id: row.get(1)?,
        book_title: row.get(2)?,
        chapter_id: row.get(3)?,
        chapter_title: row.get(4)?,
        sentence_id: row.get(5)?,
        sentence_index: row.get(6)?,
        text: row.get(7)?,
        note: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn resolve_active_chapter_id(
    chapters: &[ReaderChapterView],
    requested_chapter_id: Option<&str>,
    saved_chapter_id: Option<&str>,
) -> Option<String> {
    requested_chapter_id
        .filter(|chapter_id| chapters.iter().any(|chapter| chapter.id == *chapter_id))
        .or_else(|| {
            saved_chapter_id
                .filter(|chapter_id| chapters.iter().any(|chapter| chapter.id == *chapter_id))
        })
        .or_else(|| chapters.first().map(|chapter| chapter.id.as_str()))
        .map(str::to_string)
}

fn bookmark_id(book_id: &str, chapter_id: &str, sentence_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(book_id.as_bytes());
    hasher.update(chapter_id.as_bytes());
    hasher.update(sentence_id.as_bytes());

    format!("bookmark-{}", hex_prefix(&hasher.finalize(), 24))
}

fn normalize_search_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn fts_search_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter_map(|term| {
            let token = term
                .chars()
                .filter(|character| character.is_alphanumeric())
                .collect::<String>();
            (!token.is_empty()).then(|| format!("\"{}\"*", token.replace('"', "\"\"")))
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn cover_file_extension(media_type: &str) -> &'static str {
    match media_type {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

fn hex_prefix(bytes: &[u8], length: usize) -> String {
    bytes
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .take(length)
        .map(|nibble| char::from_digit(nibble.into(), 16).unwrap_or('0'))
        .collect()
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        env, fs,
        path::{Path, PathBuf},
        time::{Duration, Instant},
    };

    use chrono::Utc;

    use super::{
        BookExportView, LibrarySearchRequest, ReaderChapterView, ReaderDocumentView,
        SaveBookmarkRequest, SaveReadingPositionRequest, SonelleStore,
    };
    use crate::epub_import::{import_epub_file, ImportedBook, ImportedChapter, ImportedCover};
    use rusqlite::{params, Connection};

    #[test]
    fn saves_books_and_restores_reading_position() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let store = SonelleStore::open_at(temp_dir.join("sonelle.sqlite3"))
            .expect("store should initialize");
        let document = store
            .save_imported_book(ImportedBook {
                id: "book-test".to_string(),
                title: "Test Book".to_string(),
                author: "Test Author".to_string(),
                language: Some("fr-FR".to_string()),
                cover_image: None,
                source_path: "/tmp/test.epub".to_string(),
                chapters: vec![ImportedChapter {
                    id: "book-test:chapter-1".to_string(),
                    title: "Chapter One".to_string(),
                    index: 0,
                    body: "First sentence. Second sentence.".to_string(),
                }],
            })
            .expect("book should save");

        assert_eq!(document.book.title, "Test Book");
        assert_eq!(document.book.language.as_deref(), Some("fr-FR"));
        assert_eq!(document.chapters[0].sentences.len(), 2);
        assert_eq!(store.list_books().expect("books should list").len(), 1);

        store
            .save_reading_position(SaveReadingPositionRequest {
                book_id: "book-test".to_string(),
                chapter_id: "book-test:chapter-1".to_string(),
                sentence_index: 1,
            })
            .expect("position should save");

        let reopened = store
            .open_book("book-test", None)
            .expect("book should reopen");
        assert_eq!(
            reopened
                .position
                .expect("position should exist")
                .sentence_index,
            1
        );
        assert_eq!(reopened.book.language.as_deref(), Some("fr-FR"));

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn migrates_existing_books_table_and_persists_cover_image() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let db_path = temp_dir.join("sonelle.sqlite3");
        Connection::open(&db_path)
            .expect("legacy database should open")
            .execute_batch(
                "
                CREATE TABLE books (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    author TEXT NOT NULL,
                    source_path TEXT NOT NULL,
                    imported_at TEXT NOT NULL
                );
                ",
            )
            .expect("legacy books table should be created");
        let store = SonelleStore::open_at(db_path).expect("store should migrate");
        let cover_bytes = b"cover".to_vec();
        let document = store
            .save_imported_book(ImportedBook {
                id: "book-cover".to_string(),
                title: "Covered Book".to_string(),
                author: "Test Author".to_string(),
                language: None,
                cover_image: Some(ImportedCover {
                    media_type: "image/png".to_string(),
                    bytes: cover_bytes.clone(),
                }),
                source_path: "/tmp/cover.epub".to_string(),
                chapters: vec![ImportedChapter {
                    id: "book-cover:chapter-1".to_string(),
                    title: "Chapter One".to_string(),
                    index: 0,
                    body: "A covered sentence.".to_string(),
                }],
            })
            .expect("book should save after migration");
        let books = store.list_books().expect("books should list");
        let reopened = store
            .open_book("book-cover", None)
            .expect("book should reopen");

        let cover_path = document
            .book
            .cover_image_src
            .as_deref()
            .expect("cover path should persist");
        assert_eq!(
            fs::read(cover_path).expect("cover should read"),
            cover_bytes
        );
        assert_eq!(books[0].cover_image_src.as_deref(), Some(cover_path));
        assert_eq!(reopened.book.cover_image_src.as_deref(), Some(cover_path));

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn lists_books_without_multiplying_chapters_by_sentences() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let store = SonelleStore::open_at(temp_dir.join("sonelle.sqlite3"))
            .expect("store should initialize");

        store
            .save_imported_book(ImportedBook {
                id: "book-counts".to_string(),
                title: "Counted Book".to_string(),
                author: "Test Author".to_string(),
                language: None,
                cover_image: None,
                source_path: "/tmp/counts.epub".to_string(),
                chapters: vec![
                    ImportedChapter {
                        id: "book-counts:chapter-1".to_string(),
                        title: "Chapter One".to_string(),
                        index: 0,
                        body: "First sentence. Second sentence.".to_string(),
                    },
                    ImportedChapter {
                        id: "book-counts:chapter-2".to_string(),
                        title: "Chapter Two".to_string(),
                        index: 1,
                        body: "Third sentence.".to_string(),
                    },
                ],
            })
            .expect("book should save");

        let books = store.list_books().expect("books should list");

        assert_eq!(books.len(), 1);
        assert_eq!(books[0].chapter_count, 2);
        assert_eq!(books[0].sentence_count, 3);

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn opens_reader_payload_with_only_active_chapter_sentences() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let store = SonelleStore::open_at(temp_dir.join("sonelle.sqlite3"))
            .expect("store should initialize");

        let document = store
            .save_imported_book(ImportedBook {
                id: "book-active".to_string(),
                title: "Active Book".to_string(),
                author: "Test Author".to_string(),
                language: None,
                cover_image: None,
                source_path: "/tmp/active.epub".to_string(),
                chapters: vec![
                    ImportedChapter {
                        id: "book-active:chapter-1".to_string(),
                        title: "Chapter One".to_string(),
                        index: 0,
                        body: "First sentence. Second sentence.".to_string(),
                    },
                    ImportedChapter {
                        id: "book-active:chapter-2".to_string(),
                        title: "Chapter Two".to_string(),
                        index: 1,
                        body: "Third sentence.".to_string(),
                    },
                ],
            })
            .expect("book should save");

        assert_eq!(document.chapters.len(), 2);
        assert_eq!(
            document.active_chapter_id.as_deref(),
            Some("book-active:chapter-1")
        );
        assert_eq!(document.chapters[0].sentence_count, 2);
        assert_eq!(document.chapters[0].sentences.len(), 2);
        assert_eq!(document.chapters[1].sentence_count, 1);
        assert!(
            document.chapters[1].sentences.is_empty(),
            "inactive chapters should stay lightweight in reader payloads"
        );

        let requested = store
            .open_book("book-active", Some("book-active:chapter-2"))
            .expect("requested chapter should open");
        assert_eq!(
            requested.active_chapter_id.as_deref(),
            Some("book-active:chapter-2")
        );
        assert!(requested.chapters[0].sentences.is_empty());
        assert_eq!(requested.chapters[1].sentences.len(), 1);

        store
            .save_reading_position(SaveReadingPositionRequest {
                book_id: "book-active".to_string(),
                chapter_id: "book-active:chapter-2".to_string(),
                sentence_index: 0,
            })
            .expect("position should save");
        let restored = store
            .open_book("book-active", None)
            .expect("saved chapter should reopen");
        assert_eq!(
            restored.active_chapter_id.as_deref(),
            Some("book-active:chapter-2")
        );
        assert!(restored.chapters[0].sentences.is_empty());
        assert_eq!(restored.chapters[1].sentences.len(), 1);

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn persists_paragraph_ranges_for_fast_chapter_opening() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let store = SonelleStore::open_at(temp_dir.join("sonelle.sqlite3"))
            .expect("store should initialize");

        let document = store
            .save_imported_book(ImportedBook {
                id: "book-paragraphs".to_string(),
                title: "Paragraph Book".to_string(),
                author: "Test Author".to_string(),
                language: None,
                cover_image: None,
                source_path: "/tmp/paragraphs.epub".to_string(),
                chapters: vec![ImportedChapter {
                    id: "book-paragraphs:chapter-1".to_string(),
                    title: "Chapter One".to_string(),
                    index: 0,
                    body: "First sentence. Second sentence.\n\nThird sentence.".to_string(),
                }],
            })
            .expect("book should save");
        let connection = store.connect().expect("store should connect");
        let paragraph_count = connection
            .query_row(
                "SELECT COUNT(*) FROM paragraphs WHERE chapter_id = ?1",
                params!["book-paragraphs:chapter-1"],
                |row| row.get::<_, i64>(0),
            )
            .expect("paragraph count should read");
        let reopened = store
            .open_book("book-paragraphs", None)
            .expect("book should reopen");

        assert_eq!(paragraph_count, 2);
        assert_eq!(document.chapters[0].paragraphs.len(), 2);
        assert_eq!(reopened.chapters[0].paragraphs.len(), 2);
        assert_eq!(reopened.chapters[0].paragraphs[0].start_sentence_index, 0);
        assert_eq!(reopened.chapters[0].paragraphs[0].sentence_count, 2);
        assert_eq!(reopened.chapters[0].paragraphs[1].start_sentence_index, 2);
        assert_eq!(reopened.chapters[0].paragraphs[1].sentence_count, 1);

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn persists_bookmarks_searches_sentences_and_exports_book_data() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let store = SonelleStore::open_at(temp_dir.join("sonelle.sqlite3"))
            .expect("store should initialize");
        store
            .save_imported_book(ImportedBook {
                id: "book-search".to_string(),
                title: "Searchable Book".to_string(),
                author: "Test Author".to_string(),
                language: None,
                cover_image: None,
                source_path: "/tmp/search.epub".to_string(),
                chapters: vec![ImportedChapter {
                    id: "book-search:chapter-1".to_string(),
                    title: "Chapter One".to_string(),
                    index: 0,
                    body: "A quiet sentence. The bookmark target appears here.".to_string(),
                }],
            })
            .expect("book should save");

        let bookmark = store
            .save_bookmark(SaveBookmarkRequest {
                book_id: "book-search".to_string(),
                chapter_id: "book-search:chapter-1".to_string(),
                sentence_id: "book-search:chapter-1:sentence-2".to_string(),
                sentence_index: 1,
                text: "The bookmark target appears here.".to_string(),
                note: None,
            })
            .expect("bookmark should save");
        let bookmarks = store
            .list_bookmarks(Some("book-search"))
            .expect("bookmarks should list");
        let results = store
            .search_library(LibrarySearchRequest {
                query: "bookmark target".to_string(),
                book_id: Some("book-search".to_string()),
                limit: Some(10),
            })
            .expect("search should run");
        let exported = store
            .export_book_data("book-search")
            .expect("book should export");

        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].sentence_index, 1);
        assert!(results.iter().any(|result| result.kind == "sentence"));
        assert_eq!(exported.book.title, "Searchable Book");
        assert_eq!(exported.bookmarks.len(), 1);

        store
            .delete_bookmark(&bookmark.id)
            .expect("bookmark should delete");
        assert!(store
            .list_bookmarks(Some("book-search"))
            .expect("bookmarks should list")
            .is_empty());
        let connection = store.connect().expect("store should connect");
        let deleted_payload = connection
            .query_row(
                "SELECT payload_json FROM domain_events
                 WHERE name = 'BookmarkDeleted'
                 ORDER BY occurred_at DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("bookmark deletion event should exist");
        let deleted_payload: serde_json::Value =
            serde_json::from_str(&deleted_payload).expect("event payload should be valid JSON");
        assert_eq!(
            deleted_payload["bookmarkId"].as_str(),
            Some(bookmark.id.as_str())
        );
        assert_eq!(deleted_payload["bookId"].as_str(), Some("book-search"));

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    #[ignore = "measures synthetic and local EPUB performance for manual QA"]
    fn large_book_performance_harness_reports_reader_timings() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("performance store dir should be created");
        let store = SonelleStore::open_at(temp_dir.join("sonelle.sqlite3"))
            .expect("store should initialize");

        measure_imported_book_performance(
            &store,
            "synthetic-large-book",
            None,
            None,
            synthetic_large_book(),
        );

        for epub_path in configured_qa_epub_paths() {
            let file_size = fs::metadata(&epub_path).ok().map(|metadata| metadata.len());
            let import_started_at = Instant::now();
            let imported = import_epub_file(&epub_path).expect("epub should import");
            let import_elapsed = import_started_at.elapsed();
            assert_chapter_titles_are_diverse(&imported, &epub_path);

            measure_imported_book_performance(
                &store,
                &epub_path.display().to_string(),
                file_size,
                Some(import_elapsed),
                imported,
            );
        }

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    #[ignore = "runs against local EPUB files for manual real-book QA"]
    fn real_book_qa_imports_configured_epubs_through_storage_workflow() {
        let epub_paths = configured_qa_epub_paths();
        assert!(
            epub_paths.len() >= 2,
            "real-book QA needs at least two EPUBs; set SONELLE_QA_EPUBS with semicolon-separated paths"
        );

        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("qa store dir should be created");
        let store = SonelleStore::open_at(temp_dir.join("sonelle.sqlite3"))
            .expect("store should initialize");

        for epub_path in &epub_paths {
            let started_at = Instant::now();
            let imported = import_epub_file(epub_path).expect("epub should import");
            assert_chapter_titles_are_diverse(&imported, epub_path);

            let document = store
                .save_imported_book(imported)
                .expect("imported epub should persist");
            let full_document = store
                .export_book_data(&document.book.id)
                .expect("full book data should export for QA");
            let total_sentences = full_document
                .chapters
                .iter()
                .map(|chapter| chapter.sentences.len())
                .sum::<usize>();
            let largest_chapter = full_document
                .chapters
                .iter()
                .max_by_key(|chapter| chapter.sentences.len())
                .expect("document should have chapters");
            let target_sentence = largest_chapter
                .sentences
                .iter()
                .find(|sentence| search_query_from_sentence(&sentence.text).is_some())
                .or_else(|| largest_chapter.sentences.first())
                .expect("largest chapter should have sentences");

            assert!(
                total_sentences > 0,
                "real-book QA imported zero sentences for {}",
                epub_path.display()
            );

            store
                .save_reading_position(SaveReadingPositionRequest {
                    book_id: document.book.id.clone(),
                    chapter_id: largest_chapter.id.clone(),
                    sentence_index: target_sentence.index,
                })
                .expect("reading position should save");
            let reopened = store
                .open_book(&document.book.id, None)
                .expect("book should reopen after position save");
            assert_eq!(
                reopened
                    .position
                    .expect("position should exist")
                    .sentence_index,
                target_sentence.index
            );

            let bookmark = store
                .save_bookmark(SaveBookmarkRequest {
                    book_id: document.book.id.clone(),
                    chapter_id: largest_chapter.id.clone(),
                    sentence_id: target_sentence.id.clone(),
                    sentence_index: target_sentence.index,
                    text: target_sentence.text.clone(),
                    note: None,
                })
                .expect("bookmark should save");
            let bookmarks = store
                .list_bookmarks(Some(&document.book.id))
                .expect("bookmarks should list");
            assert_eq!(bookmarks.len(), 1);
            assert_eq!(bookmarks[0].id, bookmark.id);

            let query = search_query_from_sentence(&target_sentence.text)
                .unwrap_or_else(|| document.book.title.clone());
            let search_results = store
                .search_library(LibrarySearchRequest {
                    query: query.clone(),
                    book_id: Some(document.book.id.clone()),
                    limit: Some(8),
                })
                .expect("book search should run");
            assert!(
                !search_results.is_empty(),
                "search for {query:?} returned no results in {}",
                document.book.title
            );

            let exported = store
                .export_book_data(&document.book.id)
                .expect("book export should work");
            assert_eq!(exported.book.id, document.book.id);
            assert_eq!(exported.bookmarks.len(), 1);

            println!(
                "QA {}: {} chapters, {} sentences, largest chapter {:?} has {} sentences, imported in {:?}",
                document.book.title,
                full_document.chapters.len(),
                total_sentences,
                largest_chapter.title,
                largest_chapter.sentences.len(),
                started_at.elapsed()
            );
        }

        assert_eq!(
            store.list_books().expect("library should list").len(),
            epub_paths.len()
        );

        fs::remove_dir_all(temp_dir).ok();
    }

    fn measure_imported_book_performance(
        store: &SonelleStore,
        source_label: &str,
        source_size_bytes: Option<u64>,
        import_elapsed: Option<Duration>,
        imported: ImportedBook,
    ) {
        let persist_started_at = Instant::now();
        let document = store
            .save_imported_book(imported)
            .expect("performance book should persist");
        let persist_elapsed = persist_started_at.elapsed();

        let full_document = store
            .export_book_data(&document.book.id)
            .expect("performance book should export");
        let total_sentences = total_exported_sentences(&full_document);
        let largest_chapter = full_document
            .chapters
            .iter()
            .max_by_key(|chapter| chapter.sentences.len())
            .expect("performance book should have chapters");

        let open_started_at = Instant::now();
        let opened = store
            .open_book(&document.book.id, None)
            .expect("performance book should open");
        let open_elapsed = open_started_at.elapsed();
        assert_reader_payload_is_lightweight(&opened);

        let switch_measurements =
            measure_chapter_switches(store, &document.book.id, &full_document.chapters);
        let max_switch = switch_measurements
            .iter()
            .max_by_key(|measurement| measurement.elapsed)
            .expect("chapter switch measurements should exist");

        println!(
            "PERF {} | source={} | chapters={} | sentences={} | largest={:?} ({} sentences) | import={} | persist={} | open={} | max_switch={} ({:?}, {} sentences)",
            document.book.title,
            source_size_bytes.map(format_bytes).unwrap_or_else(|| "synthetic".to_string()),
            full_document.chapters.len(),
            total_sentences,
            largest_chapter.title,
            largest_chapter.sentences.len(),
            import_elapsed
                .map(format_duration_ms)
                .unwrap_or_else(|| "n/a".to_string()),
            format_duration_ms(persist_elapsed),
            format_duration_ms(open_elapsed),
            format_duration_ms(max_switch.elapsed),
            max_switch.title,
            max_switch.sentence_count
        );
        println!("PERF source path: {source_label}");
    }

    fn measure_chapter_switches(
        store: &SonelleStore,
        book_id: &str,
        chapters: &[ReaderChapterView],
    ) -> Vec<ChapterSwitchMeasurement> {
        let mut chapter_ids = Vec::<String>::new();
        for chapter in [
            chapters.first(),
            chapters.get(chapters.len() / 2),
            chapters
                .iter()
                .max_by_key(|chapter| chapter.sentences.len()),
            chapters.last(),
        ]
        .into_iter()
        .flatten()
        {
            if !chapter_ids.contains(&chapter.id) {
                chapter_ids.push(chapter.id.clone());
            }
        }

        chapter_ids
            .into_iter()
            .map(|chapter_id| {
                let started_at = Instant::now();
                let document = store
                    .open_book(book_id, Some(&chapter_id))
                    .expect("performance chapter should open");
                let elapsed = started_at.elapsed();
                assert_eq!(
                    document.active_chapter_id.as_deref(),
                    Some(chapter_id.as_str())
                );
                assert_reader_payload_is_lightweight(&document);
                let chapter = document
                    .chapters
                    .iter()
                    .find(|chapter| chapter.id == chapter_id)
                    .expect("active chapter should exist");

                ChapterSwitchMeasurement {
                    title: chapter.title.clone(),
                    sentence_count: chapter.sentences.len(),
                    elapsed,
                }
            })
            .collect()
    }

    fn assert_reader_payload_is_lightweight(document: &ReaderDocumentView) {
        let hydrated_chapters = document
            .chapters
            .iter()
            .filter(|chapter| !chapter.sentences.is_empty())
            .count();

        assert!(
            hydrated_chapters <= 1,
            "reader payload should hydrate only the active chapter for {}",
            document.book.title
        );
    }

    fn total_exported_sentences(document: &BookExportView) -> usize {
        document
            .chapters
            .iter()
            .map(|chapter| chapter.sentences.len())
            .sum()
    }

    fn synthetic_large_book() -> ImportedBook {
        ImportedBook {
            id: "synthetic-large-book".to_string(),
            title: "Synthetic Large Book".to_string(),
            author: "Sonelle QA".to_string(),
            language: None,
            cover_image: None,
            source_path: "synthetic://large-book".to_string(),
            chapters: (0..14)
                .map(|chapter_index| {
                    let sentence_count = if chapter_index == 6 { 2_000 } else { 600 };
                    ImportedChapter {
                        id: format!("synthetic-large-book:chapter-{}", chapter_index + 1),
                        title: format!("Synthetic Chapter {}", chapter_index + 1),
                        index: chapter_index,
                        body: synthetic_chapter_body(chapter_index, sentence_count),
                    }
                })
                .collect(),
        }
    }

    fn synthetic_chapter_body(chapter_index: usize, sentence_count: usize) -> String {
        (0..sentence_count)
            .map(|sentence_index| {
                format!(
                    "Synthetic chapter {} sentence {} keeps performance measurement repeatable.",
                    chapter_index + 1,
                    sentence_index + 1
                )
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    struct ChapterSwitchMeasurement {
        title: String,
        sentence_count: usize,
        elapsed: Duration,
    }

    fn temp_store_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "sonelle-store-test-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }

    fn configured_qa_epub_paths() -> Vec<PathBuf> {
        if let Ok(paths) = env::var("SONELLE_QA_EPUBS") {
            return paths
                .split([';', '\n'])
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from)
                .collect();
        }

        let Some(home_dir) = env::var_os("HOME").map(PathBuf::from) else {
            return Vec::new();
        };
        let books_dir = home_dir.join("Downloads/books");

        [
            "the-selfish-gene.epub",
            "the-kreutzer-sonata.epub",
            "the-god-delusion.epub",
            "the-way-of-the-superior-man.epub",
            "industrial-society-and-its-future.epub",
            "basic-economics-thomas-sowell.epub",
        ]
        .into_iter()
        .map(|file_name| books_dir.join(file_name))
        .filter(|path| path.exists())
        .collect()
    }

    fn assert_chapter_titles_are_diverse(book: &ImportedBook, path: &Path) {
        assert!(
            !book.chapters.is_empty(),
            "real-book QA imported no chapters for {}",
            path.display()
        );
        assert!(
            book.chapters
                .iter()
                .all(|chapter| !chapter.title.trim().is_empty()),
            "real-book QA found empty chapter titles for {}",
            path.display()
        );

        if book.chapters.len() < 4 {
            return;
        }

        let mut title_counts = HashMap::<String, usize>::new();
        for chapter in &book.chapters {
            *title_counts
                .entry(chapter.title.to_lowercase())
                .or_default() += 1;
        }

        let (dominant_title, dominant_count) = title_counts
            .iter()
            .max_by_key(|(_, count)| *count)
            .expect("title count should exist");

        assert!(
            title_counts.len() >= 3,
            "chapter titles look collapsed for {}: only {} unique titles across {} chapters",
            path.display(),
            title_counts.len(),
            book.chapters.len()
        );
        assert!(
            dominant_count * 100 <= book.chapters.len() * 70,
            "chapter titles look collapsed for {}: {:?} appears in {} of {} chapters",
            path.display(),
            dominant_title,
            dominant_count,
            book.chapters.len()
        );
    }

    fn search_query_from_sentence(text: &str) -> Option<String> {
        text.split_whitespace()
            .map(|word| {
                word.trim_matches(|character: char| !character.is_alphanumeric())
                    .to_string()
            })
            .find(|word| word.chars().count() >= 5 && word.chars().all(char::is_alphabetic))
    }

    fn format_duration_ms(duration: Duration) -> String {
        format!("{:.2}ms", duration.as_secs_f64() * 1_000.0)
    }

    fn format_bytes(bytes: u64) -> String {
        if bytes >= 1_048_576 {
            return format!("{:.2} MiB", bytes as f64 / 1_048_576.0);
        }

        if bytes >= 1_024 {
            return format!("{:.2} KiB", bytes as f64 / 1_024.0);
        }

        format!("{bytes} B")
    }
}
