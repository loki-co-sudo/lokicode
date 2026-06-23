// Integrated terminal: a persistent shell process whose stdout/stderr are
// streamed to the frontend via `terminal-output` events, with stdin fed by
// `terminal_write`. Not a full PTY (no curses/interactive TUIs), but `cd`,
// env and command output persist for the life of the session.

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct TerminalState(pub Mutex<TerminalInner>);

#[derive(Default)]
pub struct TerminalInner {
    stdin: Option<ChildStdin>,
    child: Option<Child>,
}

fn spawn_reader(mut reader: impl Read + Send + 'static, app: AppHandle) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit("terminal-output", text);
                }
            }
        }
    });
}

/// Start (or restart) the shell session in `cwd`.
#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<TerminalState>,
    cwd: Option<String>,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = inner.child.take() {
        let _ = c.kill();
    }
    inner.stdin = None;

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/Q"); // no command echo
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.arg("-i");
        c
    };

    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("シェルの起動に失敗しました: {e}"))?;
    if let Some(out) = child.stdout.take() {
        spawn_reader(out, app.clone());
    }
    if let Some(err) = child.stderr.take() {
        spawn_reader(err, app.clone());
    }
    inner.stdin = child.stdin.take();
    inner.child = Some(child);
    Ok(())
}

/// Write raw input (the frontend appends its own newline) to the shell's stdin.
#[tauri::command]
pub fn terminal_write(state: State<TerminalState>, data: String) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let stdin = inner
        .stdin
        .as_mut()
        .ok_or("ターミナルが起動していません。".to_string())?;
    stdin.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_kill(state: State<TerminalState>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = inner.child.take() {
        let _ = c.kill();
    }
    inner.stdin = None;
    Ok(())
}
