use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBookView {
    pub id: String,
    pub title: String,
    pub author: String,
    pub cover_image_src: Option<String>,
    pub imported_at: String,
    pub chapter_count: i64,
    pub sentence_count: i64,
    pub last_chapter_id: Option<String>,
    pub completed_sentence_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocumentView {
    pub book: ReaderBookView,
    pub active_chapter_id: Option<String>,
    pub chapters: Vec<ReaderChapterView>,
    pub position: Option<ReadingPositionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderBookView {
    pub id: String,
    pub title: String,
    pub author: String,
    pub language: Option<String>,
    pub cover_image_src: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderChapterView {
    pub id: String,
    pub title: String,
    pub index: i64,
    pub sentence_count: i64,
    pub sentences: Vec<ReaderSentenceView>,
    pub paragraphs: Vec<ReaderParagraphView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderParagraphView {
    pub id: String,
    pub index: i64,
    pub start_sentence_index: i64,
    pub sentence_count: i64,
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

#[derive(Debug, Clone)]
pub struct LegacyBookLanguageSource {
    pub book_id: String,
    pub source_path: String,
}

#[derive(Debug, Clone)]
pub struct LegacyChapterText {
    pub book_id: String,
    pub chapter_id: String,
    pub body: String,
    pub sentence_count: usize,
}
