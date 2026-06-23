// Integrated terminal backed by a real PTY (portable-pty), so colors and
// interactive TUIs (vim, etc.) work. Raw PTY output is streamed to the frontend
// as base64 over `terminal-output` events; xterm.js renders it. Input and resize
// come back via `terminal_write` / `terminal_resize`.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct TerminalState(pub Mutex<TerminalInner>);

#[derive(Default)]
pub struct TerminalInner {
    writer: Option<Box<dyn Write + Send>>,
    master: Option<Box<dyn MasterPty + Send>>,
    child: Option<Box<dyn Child + Send + Sync>>,
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

/// Start (or restart) a PTY shell session of the given size in `cwd`.
#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<TerminalState>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = inner.child.take() {
        let _ = c.kill();
    }
    inner.writer = None;
    inner.master = None;

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

    // Stream raw PTY bytes (base64-encoded to survive the JSON event boundary).
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app2.emit("terminal-exit", ());
                    break;
                }
                Ok(n) => {
                    let _ = app2.emit("terminal-output", STANDARD.encode(&buf[..n]));
                }
            }
        }
    });

    inner.writer = Some(writer);
    inner.master = Some(pair.master);
    inner.child = Some(child);
    Ok(())
}

#[tauri::command]
pub fn terminal_write(state: State<TerminalState>, data: String) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let writer = inner
        .writer
        .as_mut()
        .ok_or("ターミナルが起動していません。".to_string())?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(state: State<TerminalState>, rows: u16, cols: u16) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(master) = inner.master.as_ref() {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_kill(state: State<TerminalState>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = inner.child.take() {
        let _ = c.kill();
    }
    inner.writer = None;
    inner.master = None;
    Ok(())
}
