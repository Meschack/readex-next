mod commands;
mod epub_import;
mod storage;
mod text;

#[tauri::command]
fn app_status() -> &'static str {
    "ready"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_status,
            commands::import_epub,
            commands::list_books,
            commands::open_book,
            commands::save_reading_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
