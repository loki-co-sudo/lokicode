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

fn shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        CommandBuilder::new("cmd.exe")
    }
    #[cfg(not(windows))]
    {
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

    let mut cmd = shell();
    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        cmd.cwd(dir);
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("シェルの起動に失敗しました: {e}"))?;
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
