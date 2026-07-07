use tauri::AppHandle;

use crate::epub_import::import_epub_file;
use crate::storage::{
    LibraryBookView, ReaderDocumentView, ReadexStore, SaveReadingPositionRequest,
};

#[tauri::command]
pub fn import_epub(app: AppHandle, path: String) -> Result<ReaderDocumentView, String> {
    let imported = import_epub_file(path.as_ref()).map_err(|error| error.to_string())?;
    ReadexStore::open(&app)?.save_imported_book(imported)
}

#[tauri::command]
pub fn list_books(app: AppHandle) -> Result<Vec<LibraryBookView>, String> {
    ReadexStore::open(&app)?.list_books()
}

#[tauri::command]
pub fn open_book(app: AppHandle, book_id: String) -> Result<ReaderDocumentView, String> {
    ReadexStore::open(&app)?.open_book(&book_id)
}

#[tauri::command]
pub fn save_reading_position(
    app: AppHandle,
    position: SaveReadingPositionRequest,
) -> Result<(), String> {
    ReadexStore::open(&app)?.save_reading_position(position)
}
