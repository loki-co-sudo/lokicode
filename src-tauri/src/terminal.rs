// Integrated terminals backed by real PTYs (portable-pty). Multiple independent
// sessions are keyed by an id so the UI can show several terminal tabs. Raw PTY
// output is streamed as base64 over `terminal-output` events tagged with the id;
// xterm.js renders it. Input/resize come back via `terminal_write`/`terminal_resize`.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    /// Name/path used to launch it (Windows: "pwsh" | "powershell" | "cmd" | "bash";
    /// Unix: an absolute path from /etc/shells or $SHELL).
    id: String,
    label: String,
}

/// Enumerate shells actually present on this machine, for the terminal shell
/// picker (`agentSettings.ts` `getTerminalShell`/`TerminalPanel.tsx`). Only the
/// integrated terminal uses this — the agent's `run_command` shell stays fixed
/// (see specs/terminal-shell-selection.md scope note).
#[tauri::command]
pub fn list_shells() -> Vec<ShellInfo> {
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        if crate::win_which("pwsh.exe") {
            out.push(ShellInfo { id: "pwsh".to_string(), label: "PowerShell 7".to_string() });
        }
        if crate::win_which("powershell.exe") {
            out.push(ShellInfo {
                id: "powershell".to_string(),
                label: "Windows PowerShell".to_string(),
            });
        }
        if crate::win_which("cmd.exe") {
            out.push(ShellInfo { id: "cmd".to_string(), label: "コマンドプロンプト".to_string() });
        }
        // Git Bash (or any bash.exe on PATH). WSL's bash.exe is indistinguishable
        // this way — intentionally not special-cased (see spec).
        if crate::win_which("bash.exe") {
            out.push(ShellInfo { id: "bash".to_string(), label: "Git Bash".to_string() });
        }
        out
    }
    #[cfg(not(windows))]
    {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        let mut add = |path: &str| {
            let path = path.trim();
            if path.is_empty() || !std::path::Path::new(path).exists() {
                return;
            }
            if !seen.insert(path.to_string()) {
                return;
            }
            let label = std::path::Path::new(path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string());
            out.push(ShellInfo { id: path.to_string(), label });
        };
        if let Ok(sh) = std::env::var("SHELL") {
            add(&sh);
        }
        if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                add(line);
            }
        }
        out
    }
}

#[derive(Default)]
pub struct TerminalState(pub Mutex<HashMap<String, Session>>);

pub struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Serialize, Clone)]
struct Chunk {
    id: String,
    data: String,
}

/// Build the launch command for the integrated terminal. `preferred` (from the
/// UI's shell picker) is honored when it resolves to something actually present;
/// otherwise falls back to the previous fixed default (never errors here — a
/// bad/stale preference just degrades to the default instead of failing to open
/// a terminal at all).
fn shell(preferred: Option<&str>) -> CommandBuilder {
    #[cfg(windows)]
    {
        if let Some(p) = preferred.map(str::trim).filter(|p| !p.is_empty()) {
            let exe = match p {
                "cmd" => Some("cmd.exe"),
                "pwsh" => Some("pwsh.exe"),
                "powershell" => Some("powershell.exe"),
                "bash" => Some("bash.exe"),
                _ => None,
            };
            if let Some(exe) = exe {
                if crate::win_which(exe) {
                    let mut c = CommandBuilder::new(exe);
                    // PSReadLine (history/search/completion) only applies to the
                    // PowerShell family; cmd doesn't understand -NoLogo.
                    if exe == "pwsh.exe" || exe == "powershell.exe" {
                        c.arg("-NoLogo");
                    }
                    return c;
                }
            }
        }
        // Default: PowerShell ships PSReadLine, giving modern line editing —
        // command history (↑/↓), Ctrl+R reverse search, tab completion, syntax
        // colors — which cmd.exe lacks. Prefer PowerShell 7 (pwsh) if installed
        // (shared resolution with get_platform_info via crate::default_shell_name).
        let exe = format!("{}.exe", crate::default_shell_name());
        let mut c = CommandBuilder::new(&exe);
        c.arg("-NoLogo");
        c
    }
    #[cfg(not(windows))]
    {
        if let Some(p) = preferred.map(str::trim).filter(|p| !p.is_empty()) {
            if std::path::Path::new(p).exists() {
                return CommandBuilder::new(p);
            }
        }
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        CommandBuilder::new(sh)
    }
}

/// Start (or restart) a PTY session under `id`.
#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<TerminalState>,
    id: String,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    shell_pref: Option<String>,
) -> Result<(), String> {
    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut s) = map.remove(&id) {
            let _ = s.child.kill();
        }
    }

    let pty = portable_pty::native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY の作成に失敗しました: {e}"))?;

    let mut cmd = shell(shell_pref.as_deref());
    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        cmd.cwd(dir);
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("シェルの起動に失敗しました（shell={}）: {e}", shell_pref.as_deref().unwrap_or("(既定)")))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("PTY の読み取り初期化に失敗しました: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("PTY の書き込み初期化に失敗しました: {e}"))?;

    let app2 = app.clone();
    let id2 = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app2.emit("terminal-exit", id2.clone());
                    break;
                }
                Ok(n) => {
                    let _ = app2.emit(
                        "terminal-output",
                        Chunk { id: id2.clone(), data: STANDARD.encode(&buf[..n]) },
                    );
                }
            }
        }
    });

    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.insert(id, Session { writer, master: pair.master, child });
    Ok(())
}

#[tauri::command]
pub fn terminal_write(state: State<TerminalState>, id: String, data: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let s = map.get_mut(&id).ok_or("ターミナルが起動していません。".to_string())?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<TerminalState>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(s) = map.get(&id) {
        s.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_kill(state: State<TerminalState>, id: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut s) = map.remove(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}
