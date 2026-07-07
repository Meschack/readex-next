use std::{fs, path::PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::{
    epub_import::ImportedBook,
    text::{normalize_reader_text, segment_sentences},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBookView {
    pub id: String,
    pub title: String,
    pub author: String,
    pub imported_at: String,
    pub chapter_count: i64,
    pub sentence_count: i64,
    pub last_chapter_id: Option<String>,
    pub last_sentence_index: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocumentView {
    pub book: ReaderBookView,
    pub chapters: Vec<ReaderChapterView>,
    pub position: Option<ReadingPositionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderBookView {
    pub id: String,
    pub title: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderChapterView {
    pub id: String,
    pub title: String,
    pub index: i64,
    pub sentences: Vec<ReaderSentenceView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSentenceView {
    pub id: String,
    pub index: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPositionView {
    pub book_id: String,
    pub chapter_id: String,
    pub sentence_index: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReadingPositionRequest {
    pub book_id: String,
    pub chapter_id: String,
    pub sentence_index: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkView {
    pub id: String,
    pub book_id: String,
    pub book_title: String,
    pub chapter_id: String,
    pub chapter_title: String,
    pub sentence_id: String,
    pub sentence_index: i64,
    pub text: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBookmarkRequest {
    pub book_id: String,
    pub chapter_id: String,
    pub sentence_id: String,
    pub sentence_index: i64,
    pub text: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySearchRequest {
    pub query: String,
    pub book_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySearchResultView {
    pub id: String,
    pub kind: String,
    pub book_id: String,
    pub book_title: String,
    pub author: String,
    pub chapter_id: Option<String>,
    pub chapter_title: Option<String>,
    pub sentence_id: Option<String>,
    pub sentence_index: Option<i64>,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookExportView {
    pub exported_at: String,
    pub book: ReaderBookView,
    pub chapters: Vec<ReaderChapterView>,
    pub position: Option<ReadingPositionView>,
    pub bookmarks: Vec<BookmarkView>,
}

pub struct ReadexStore {
    db_path: PathBuf,
}

impl ReadexStore {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "We couldn't open the local library folder.".to_string())?;
        fs::create_dir_all(&app_dir)
            .map_err(|_| "We couldn't prepare the local library folder.".to_string())?;
        let store = Self {
            db_path: app_dir.join("readex.sqlite3"),
        };

        store.init()?;
        Ok(store)
    }

    #[cfg(test)]
    fn open_at(db_path: PathBuf) -> Result<Self, String> {
        let store = Self { db_path };
        store.init()?;
        Ok(store)
    }

    pub fn save_imported_book(&self, book: ImportedBook) -> Result<ReaderDocumentView, String> {
        let mut connection = self.connect()?;
        let imported_at = now();
        let transaction = connection
            .transaction()
            .map_err(|_| "We couldn't save that book.".to_string())?;

        transaction
            .execute(
                "INSERT INTO books (id, title, author, source_path, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title,
                   author = excluded.author,
                   source_path = excluded.source_path",
                params![
                    book.id,
                    book.title,
                    book.author,
                    book.source_path,
                    imported_at
                ],
            )
            .map_err(|_| "We couldn't save that book.".to_string())?;
        transaction
            .execute("DELETE FROM sentences WHERE book_id = ?1", params![book.id])
            .map_err(|_| "We couldn't refresh that book.".to_string())?;
        transaction
            .execute("DELETE FROM chapters WHERE book_id = ?1", params![book.id])
            .map_err(|_| "We couldn't refresh that book.".to_string())?;

        for chapter in &book.chapters {
            transaction
                .execute(
                    "INSERT INTO chapters (id, book_id, title, position, body)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        chapter.id,
                        book.id,
                        chapter.title,
                        chapter.index as i64,
                        normalize_reader_text(&chapter.body)
                    ],
                )
                .map_err(|_| "We couldn't save a chapter from that book.".to_string())?;

            for (sentence_index, sentence) in segment_sentences(&chapter.body).iter().enumerate() {
                transaction
                    .execute(
                        "INSERT INTO sentences (id, book_id, chapter_id, position, text)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            format!("{}:sentence-{}", chapter.id, sentence_index + 1),
                            book.id,
                            chapter.id,
                            sentence_index as i64,
                            sentence
                        ],
                    )
                    .map_err(|_| "We couldn't save a sentence from that book.".to_string())?;
            }
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
                "chapterCount": book.chapters.len()
            }),
        )?;

        transaction
            .commit()
            .map_err(|_| "We couldn't finish saving that book.".to_string())?;
        self.open_book(&book.id)
    }

    pub fn list_books(&self) -> Result<Vec<LibraryBookView>, String> {
        let connection = self.connect()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    books.id,
                    books.title,
                    books.author,
                    books.imported_at,
                    COUNT(DISTINCT chapters.id) AS chapter_count,
                    COUNT(sentences.id) AS sentence_count,
                    reading_positions.chapter_id,
                    COALESCE(reading_positions.sentence_index, 0)
                 FROM books
                 LEFT JOIN chapters ON chapters.book_id = books.id
                 LEFT JOIN sentences ON sentences.book_id = books.id
                 LEFT JOIN reading_positions ON reading_positions.book_id = books.id
                 GROUP BY books.id
                 ORDER BY books.imported_at DESC",
            )
            .map_err(|_| "We couldn't read your library.".to_string())?;
        let books = statement
            .query_map([], |row| {
                Ok(LibraryBookView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    author: row.get(2)?,
                    imported_at: row.get(3)?,
                    chapter_count: row.get(4)?,
                    sentence_count: row.get(5)?,
                    last_chapter_id: row.get(6)?,
                    last_sentence_index: row.get(7)?,
                })
            })
            .map_err(|_| "We couldn't read your library.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read your library.".to_string())?;

        Ok(books)
    }

    pub fn open_book(&self, book_id: &str) -> Result<ReaderDocumentView, String> {
        let connection = self.connect()?;
        let book = connection
            .query_row(
                "SELECT id, title, author FROM books WHERE id = ?1",
                params![book_id],
                |row| {
                    Ok(ReaderBookView {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        author: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|_| "We couldn't open that book.".to_string())?
            .ok_or_else(|| "We couldn't find that book in your library.".to_string())?;
        let chapters = self.read_chapters(&connection, book_id)?;
        let position = connection
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
            .map_err(|_| "We couldn't restore your reading place.".to_string())?;

        Ok(ReaderDocumentView {
            book,
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
                "bookId": bookmark.book_id,
                "chapterId": bookmark.chapter_id,
                "sentenceId": bookmark.sentence_id,
                "sentenceIndex": bookmark.sentence_index
            }),
        )?;

        self.read_bookmark_by_id(&connection, &id)
    }

    pub fn delete_bookmark(&self, bookmark_id: &str) -> Result<(), String> {
        let connection = self.connect()?;
        let deleted = connection
            .execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])
            .map_err(|_| "We couldn't remove that bookmark.".to_string())?;

        if deleted > 0 {
            insert_event(
                &connection,
                "BookmarkDeleted",
                json!({
                    "bookmarkId": bookmark_id
                }),
            )?;
        }

        Ok(())
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
                &pattern,
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

        let document = self.open_book(book_id)?;
        let bookmarks = self.list_bookmarks(Some(book_id))?;
        insert_event(
            &connection,
            "BookExported",
            json!({
                "bookId": book_id,
                "bookmarkCount": bookmarks.len()
            }),
        )?;

        Ok(BookExportView {
            exported_at: now(),
            book: document.book,
            chapters: document.chapters,
            position: document.position,
            bookmarks,
        })
    }

    fn init(&self) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS books (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    author TEXT NOT NULL,
                    source_path TEXT NOT NULL,
                    imported_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chapters (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    body TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sentences (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    text TEXT NOT NULL
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
                CREATE INDEX IF NOT EXISTS idx_bookmarks_book_created
                    ON bookmarks(book_id, created_at);
                ",
            )
            .map_err(|_| "We couldn't prepare the local library.".to_string())
    }

    fn read_chapters(
        &self,
        connection: &Connection,
        book_id: &str,
    ) -> Result<Vec<ReaderChapterView>, String> {
        let mut statement = connection
            .prepare(
                "SELECT id, title, position FROM chapters
                 WHERE book_id = ?1
                 ORDER BY position ASC",
            )
            .map_err(|_| "We couldn't read that book.".to_string())?;
        let chapters = statement
            .query_map(params![book_id], |row| {
                Ok(ReaderChapterView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    index: row.get(2)?,
                    sentences: Vec::new(),
                })
            })
            .map_err(|_| "We couldn't read that book.".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "We couldn't read that book.".to_string())?;

        chapters
            .into_iter()
            .map(|mut chapter| {
                chapter.sentences = self.read_sentences(connection, &chapter.id)?;
                Ok(chapter)
            })
            .collect()
    }

    fn read_sentences(
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
        pattern: &str,
        limit: i64,
    ) -> Result<Vec<LibrarySearchResultView>, String> {
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
                 FROM sentences
                 INNER JOIN books ON books.id = sentences.book_id
                 INNER JOIN chapters ON chapters.id = sentences.chapter_id
                 WHERE (?1 IS NULL OR books.id = ?1)
                   AND LOWER(sentences.text) LIKE ?2 ESCAPE '\\'
                 ORDER BY books.imported_at DESC, chapters.position ASC, sentences.position ASC
                 LIMIT ?3",
            )
            .map_err(|_| "We couldn't search your library.".to_string())?;

        let results = statement
            .query_map(params![book_id, pattern, limit], |row| {
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

    fn connect(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path)
            .map_err(|_| "We couldn't open the local library.".to_string())
    }
}

fn insert_event(
    connection: &Connection,
    name: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let occurred_at = now();
    let id = format!("{name}-{occurred_at}");

    connection
        .execute(
            "INSERT INTO domain_events (id, name, occurred_at, payload_json)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, name, occurred_at, payload.to_string()],
        )
        .map(|_| ())
        .map_err(|_| "We couldn't save the library update.".to_string())
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
        time::Instant,
    };

    use chrono::Utc;

    use super::{
        LibrarySearchRequest, ReadexStore, SaveBookmarkRequest, SaveReadingPositionRequest,
    };
    use crate::epub_import::{import_epub_file, ImportedBook, ImportedChapter};

    #[test]
    fn saves_books_and_restores_reading_position() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let store =
            ReadexStore::open_at(temp_dir.join("readex.sqlite3")).expect("store should initialize");
        let document = store
            .save_imported_book(ImportedBook {
                id: "book-test".to_string(),
                title: "Test Book".to_string(),
                author: "Test Author".to_string(),
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
        assert_eq!(document.chapters[0].sentences.len(), 2);
        assert_eq!(store.list_books().expect("books should list").len(), 1);

        store
            .save_reading_position(SaveReadingPositionRequest {
                book_id: "book-test".to_string(),
                chapter_id: "book-test:chapter-1".to_string(),
                sentence_index: 1,
            })
            .expect("position should save");

        let reopened = store.open_book("book-test").expect("book should reopen");
        assert_eq!(
            reopened
                .position
                .expect("position should exist")
                .sentence_index,
            1
        );

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn persists_bookmarks_searches_sentences_and_exports_book_data() {
        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("test store dir should be created");
        let store =
            ReadexStore::open_at(temp_dir.join("readex.sqlite3")).expect("store should initialize");
        store
            .save_imported_book(ImportedBook {
                id: "book-search".to_string(),
                title: "Searchable Book".to_string(),
                author: "Test Author".to_string(),
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

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    #[ignore = "runs against local EPUB files for manual real-book QA"]
    fn real_book_qa_imports_configured_epubs_through_storage_workflow() {
        let epub_paths = configured_qa_epub_paths();
        assert!(
            epub_paths.len() >= 2,
            "real-book QA needs at least two EPUBs; set READEX_QA_EPUBS with semicolon-separated paths"
        );

        let temp_dir = temp_store_dir();
        fs::create_dir_all(&temp_dir).expect("qa store dir should be created");
        let store =
            ReadexStore::open_at(temp_dir.join("readex.sqlite3")).expect("store should initialize");

        for epub_path in &epub_paths {
            let started_at = Instant::now();
            let imported = import_epub_file(epub_path).expect("epub should import");
            assert_chapter_titles_are_diverse(&imported, epub_path);

            let document = store
                .save_imported_book(imported)
                .expect("imported epub should persist");
            let total_sentences = document
                .chapters
                .iter()
                .map(|chapter| chapter.sentences.len())
                .sum::<usize>();
            let largest_chapter = document
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
                .open_book(&document.book.id)
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
                document.chapters.len(),
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

    fn temp_store_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "readex-store-test-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }

    fn configured_qa_epub_paths() -> Vec<PathBuf> {
        if let Ok(paths) = env::var("READEX_QA_EPUBS") {
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
}
