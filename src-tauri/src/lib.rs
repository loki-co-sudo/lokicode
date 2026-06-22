mod openrouter;

use serde::Serialize;

/// Read a UTF-8 text file from an absolute path.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write UTF-8 text to an absolute path.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
}

/// List the entries of a directory (used by the agent's `list_dir` tool).
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: entry.path().is_dir(),
        });
    }
    // Directories first, then alphabetical.
    entries.sort_by(|a, b| (!a.is_dir, a.name.to_lowercase()).cmp(&(!b.is_dir, b.name.to_lowercase())));
    Ok(entries)
}

#[derive(Serialize)]
struct CommandOutput {
    stdout: String,
    stderr: String,
    code: i32,
}

/// Run a shell command (used by the agent's `run_command` tool). The frontend
/// requires explicit user approval before invoking this.
#[tauri::command]
async fn run_command(command: String, cwd: Option<String>) -> Result<CommandOutput, String> {
    let handle = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = std::process::Command::new("cmd");
            c.args(["/C", &command]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = std::process::Command::new("sh");
            c.args(["-c", &command]);
            c
        };

        if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
            cmd.current_dir(dir);
        }

        let output = cmd.output().map_err(|e| e.to_string())?;
        Ok::<CommandOutput, String>(CommandOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            code: output.status.code().unwrap_or(-1),
        })
    });
    handle.await.map_err(|e| e.to_string())?
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
            list_dir,
            run_command,
            openrouter::send_chat,
            openrouter::chat_once,
            openrouter::complete,
            openrouter::list_models,
            openrouter::get_settings,
            openrouter::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
