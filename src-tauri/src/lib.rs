mod git;
mod github;
mod openrouter;
mod search;
mod terminal;

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

/// Delete a file (used to undo agent-created files).
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Open the webview DevTools (requires the `devtools` Cargo feature). Bound to
/// F12 in the frontend so logs are reachable even in release builds.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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

/// Is `exe` resolvable on PATH? Used to prefer PowerShell 7 (pwsh) over Windows
/// PowerShell for the agent's `run_command`, matching the integrated terminal.
#[cfg(windows)]
fn win_which(exe: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(exe).is_file()))
        .unwrap_or(false)
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
            use std::os::windows::process::CommandExt;
            // Run directly through PowerShell (same shell as the integrated
            // terminal) instead of `cmd /C ...`. Going via cmd meant a
            // `cmd → powershell` double-spawn, and the inner PowerShell flashed a
            // visible console window on EVERY command (alarming, looks like
            // malware). Spawning the shell directly with CREATE_NO_WINDOW keeps the
            // whole invocation — and its child processes — hidden.
            let shell = if win_which("pwsh.exe") { "pwsh.exe" } else { "powershell.exe" };
            let mut c = std::process::Command::new(shell);
            c.args(["-NoProfile", "-NonInteractive", "-Command", &command]);
            // CREATE_NO_WINDOW: no console window; output still captured via pipes.
            c.creation_flags(0x0800_0000);
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
        .manage(terminal::TerminalState::default())
        .manage(openrouter::Cancellations::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            delete_file,
            open_devtools,
            list_dir,
            run_command,
            openrouter::send_chat,
            openrouter::chat_once,
            openrouter::chat_once_stream,
            openrouter::complete,
            openrouter::cancel_run,
            openrouter::clear_run,
            search::grep_search,
            search::list_files,
            search::replace_in_files,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            openrouter::list_models,
            openrouter::get_settings,
            openrouter::save_settings,
            git::git_status,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_init,
            git::git_diff,
            git::git_branches,
            git::git_switch,
            git::git_create_branch,
            git::git_pull,
            git::git_push,
            git::git_log,
            git::git_blame,
            git::git_remote_url,
            git::git_apply_cached,
            github::github_device_start,
            github::github_device_poll,
            github::github_user,
            github::github_logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
