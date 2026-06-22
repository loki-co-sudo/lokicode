mod openrouter;

/// Read a UTF-8 text file from an absolute path chosen via the dialog plugin.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write UTF-8 text to an absolute path.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env (project root) so OPENROUTER_API_KEY is available during dev.
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            openrouter::send_chat,
            openrouter::get_settings,
            openrouter::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
