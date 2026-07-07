use std::{fs, path::PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
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

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use chrono::Utc;

    use super::{ReadexStore, SaveReadingPositionRequest};
    use crate::epub_import::{ImportedBook, ImportedChapter};

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

    fn temp_store_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "readex-store-test-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }
}
