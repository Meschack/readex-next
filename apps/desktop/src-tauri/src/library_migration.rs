use std::path::Path;

use crate::{
    epub_import::read_epub_language,
    error_log::record_native_error,
    library_import::{prepare_legacy_paragraphs, PreparedParagraphImport},
    storage::{LegacyChapterText, SonelleStore},
};

const REPAIR_BATCH_SIZE: usize = 16;

pub fn migrate_legacy_library(store: &SonelleStore) -> Result<(), String> {
    repair_legacy_library(store)
}

fn repair_legacy_library(store: &SonelleStore) -> Result<(), String> {
    let mut after_book_id = None;
    loop {
        let books =
            store.legacy_books_missing_language(after_book_id.as_deref(), REPAIR_BATCH_SIZE)?;
        if books.is_empty() {
            break;
        }
        for book in &books {
            after_book_id = Some(book.book_id.clone());
            let result = read_epub_language(Path::new(&book.source_path))
                .ok_or_else(|| "The book language could not be recovered.".to_string())
                .and_then(|language| store.save_book_language(&book.book_id, &language));
            record_repair_result(result, "language", &book.book_id);
        }
        if books.len() < REPAIR_BATCH_SIZE {
            break;
        }
    }

    let mut after_chapter_id = None;
    loop {
        let chapters = store
            .legacy_chapters_missing_paragraphs(after_chapter_id.as_deref(), REPAIR_BATCH_SIZE)?;
        if chapters.is_empty() {
            break;
        }
        for chapter in &chapters {
            after_chapter_id = Some(chapter.chapter_id.clone());
            let paragraphs = recovered_paragraphs(chapter);
            let result =
                store.save_recovered_paragraphs(&chapter.book_id, &chapter.chapter_id, &paragraphs);
            record_repair_result(result, "paragraphs", &chapter.chapter_id);
        }
        if chapters.len() < REPAIR_BATCH_SIZE {
            break;
        }
    }

    Ok(())
}

fn record_repair_result(result: Result<(), String>, stage: &str, entity_id: &str) {
    if let Err(error) = result {
        record_native_error(
            "library.repair",
            &format!("stage={stage} entity={entity_id} error={error}"),
        );
    }
}

fn recovered_paragraphs(chapter: &LegacyChapterText) -> Vec<PreparedParagraphImport> {
    let prepared = prepare_legacy_paragraphs(&chapter.chapter_id, &chapter.body);
    let prepared_sentence_count: usize = prepared
        .iter()
        .map(|paragraph| paragraph.sentence_count)
        .sum();
    if prepared_sentence_count == chapter.sentence_count {
        return prepared;
    }
    if chapter.sentence_count == 0 {
        return Vec::new();
    }

    vec![PreparedParagraphImport {
        id: format!("{}:paragraph-1", chapter.chapter_id),
        index: 0,
        start_sentence_index: 0,
        sentence_count: chapter.sentence_count,
    }]
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use rusqlite::{params, Connection};

    use super::{migrate_legacy_library, recovered_paragraphs, REPAIR_BATCH_SIZE};
    use crate::storage::{LegacyChapterText, SonelleStore};

    #[test]
    fn recovers_paragraphs_outside_the_storage_read_path() {
        let paragraphs = recovered_paragraphs(&LegacyChapterText {
            book_id: "book-1".to_string(),
            chapter_id: "chapter-1".to_string(),
            body: "First sentence.\n\nSecond sentence.".to_string(),
            sentence_count: 2,
        });

        assert_eq!(paragraphs.len(), 2);
        assert_eq!(paragraphs[1].start_sentence_index, 1);
    }

    #[test]
    fn repairs_in_batches_and_isolates_an_unreadable_book() {
        let root = std::env::temp_dir().join(format!(
            "sonelle-library-repair-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("repair fixture directory should exist");
        let db_path = root.join("library.sqlite3");
        let store = SonelleStore::open_at(db_path.clone()).expect("store should open");
        let connection = Connection::open(&db_path).expect("fixture database should open");

        for index in 0..=REPAIR_BATCH_SIZE {
            let book_id = format!("book-{index:02}");
            let chapter_id = format!("chapter-{index:02}");
            let language = if index == 0 { None } else { Some("en") };
            connection
                .execute(
                    "INSERT INTO books (
                        id, title, author, language, source_path, imported_at,
                        chapter_count, sentence_count
                     ) VALUES (?1, ?2, 'Author', ?3, ?4, '2026-07-15', 1, 2)",
                    params![
                        book_id,
                        format!("Book {index}"),
                        language,
                        root.join("missing.epub").to_string_lossy()
                    ],
                )
                .expect("legacy book should insert");
            connection
                .execute(
                    "INSERT INTO chapters (id, book_id, title, position, body, sentence_count)
                     VALUES (?1, ?2, 'Chapter', 0, 'First sentence.\n\nSecond sentence.', 2)",
                    params![chapter_id, book_id],
                )
                .expect("legacy chapter should insert");
        }
        drop(connection);

        migrate_legacy_library(&store).expect("repair pass should survive one unreadable book");

        let connection = Connection::open(&db_path).expect("fixture database should reopen");
        let paragraph_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM paragraphs", [], |row| row.get(0))
            .expect("paragraph count should read");
        assert_eq!(paragraph_count, ((REPAIR_BATCH_SIZE + 1) * 2) as i64);
        fs::remove_dir_all(root).expect("repair fixture should clean up");
    }
}
