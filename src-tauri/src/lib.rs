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
/// requires explicit user approval before invoking this. The command is killed if
/// it exceeds `timeout_secs` (default 60) so a hanging process can't block forever.
#[tauri::command]
async fn run_command(
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<CommandOutput, String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let timeout = Duration::from_secs(timeout_secs.unwrap_or(60).clamp(1, 600));

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
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        // Drain pipes on threads so a full pipe buffer can't deadlock the wait.
        let mut out_pipe = child.stdout.take().expect("piped stdout");
        let mut err_pipe = child.stderr.take().expect("piped stderr");
        let out_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = out_pipe.read_to_end(&mut buf);
            buf
        });
        let err_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = err_pipe.read_to_end(&mut buf);
            buf
        });

        let start = Instant::now();
        let mut timed_out = false;
        let code = loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(status) => break status.code().unwrap_or(-1),
                None => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        timed_out = true;
                        break -1;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        };

        let stdout = String::from_utf8_lossy(&out_thread.join().unwrap_or_default()).to_string();
        let mut stderr = String::from_utf8_lossy(&err_thread.join().unwrap_or_default()).to_string();
        if timed_out {
            stderr = format!("(タイムアウト {} 秒で強制終了しました)\n{}", timeout.as_secs(), stderr);
        }

        Ok::<CommandOutput, String>(CommandOutput { stdout, stderr, code })
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
