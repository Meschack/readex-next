mod audio;
mod background_process;
mod commands;
mod epub_import;
mod kokoro_manifest;
pub mod kokoro_narration;
pub mod kokoro_text;
pub mod narration_cache;
mod narration_engine_pack;
mod narration_manifest;
pub mod narration_pack;
mod narration_rendered_audio;
mod narration_wav;
mod storage;
mod supertonic_helper;
mod supertonic_narration;
mod text;
mod voice_installation;

use std::io;

use tauri::Manager;

use crate::storage::SonelleStore;

#[tauri::command]
fn app_status() -> &'static str {
    "ready"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store = SonelleStore::open(app.handle()).map_err(io::Error::other)?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            commands::clear_prepared_audio_cache,
            commands::delete_bookmark,
            commands::export_book_data,
            commands::get_audio_cache_stats,
            commands::get_narration_engine_status,
            commands::import_epub,
            commands::install_narration_engine,
            commands::list_bookmarks,
            commands::list_books,
            commands::open_book,
            commands::prepare_manifest_narration,
            commands::prepare_sentence_audio,
            commands::record_domain_event,
            commands::report_development_error,
            commands::play_sentence_audio,
            commands::save_bookmark,
            commands::save_reading_position,
            commands::search_library,
            commands::stop_sentence_audio,
            commands::get_narration_voice_status,
            commands::install_narration_voice
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
