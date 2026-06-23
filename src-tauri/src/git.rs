// Minimal Git source-control backend: shells out to the `git` CLI in the given
// working directory. Used by the Source Control sidebar panel.

use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    /// Index (staged) status char from `git status --porcelain`.
    pub index: String,
    /// Worktree (unstaged) status char.
    pub worktree: String,
    pub staged: bool,
    pub untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub files: Vec<GitFile>,
}

fn run_git(cwd: &str, args: &[&str]) -> Result<(String, String, i32), String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git の実行に失敗しました（git は入っていますか？）: {e}"))?;
    Ok((
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
        output.status.code().unwrap_or(-1),
    ))
}

fn parse_branch(s: &str) -> String {
    if let Some(idx) = s.find("...") {
        s[..idx].trim().to_string()
    } else if let Some(rest) = s.strip_prefix("No commits yet on ") {
        rest.split_whitespace().next().unwrap_or("").to_string()
    } else {
        s.split_whitespace().next().unwrap_or("").to_string()
    }
}

#[tauri::command]
pub fn git_status(cwd: String) -> Result<GitStatus, String> {
    let (inside, _e, code) = run_git(&cwd, &["rev-parse", "--is-inside-work-tree"])?;
    if code != 0 || inside.trim() != "true" {
        return Ok(GitStatus {
            is_repo: false,
            branch: String::new(),
            files: Vec::new(),
        });
    }

    let (out, err, status_code) = run_git(&cwd, &["status", "--porcelain=v1", "-b"])?;
    if status_code != 0 {
        return Err(err);
    }

    let mut branch = String::new();
    let mut files = Vec::new();
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            branch = parse_branch(rest);
        } else if line.len() >= 3 {
            let x = &line[0..1];
            let y = &line[1..2];
            let path = line[3..].to_string();
            let untracked = x == "?";
            files.push(GitFile {
                path,
                index: x.to_string(),
                worktree: y.to_string(),
                staged: !untracked && x != " ",
                untracked,
            });
        }
    }
    Ok(GitStatus {
        is_repo: true,
        branch,
        files,
    })
}

#[tauri::command]
pub fn git_stage(cwd: String, path: String) -> Result<(), String> {
    let (_o, e, c) = run_git(&cwd, &["add", "--", &path])?;
    if c != 0 {
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn git_unstage(cwd: String, path: String) -> Result<(), String> {
    let (_o, e, c) = run_git(&cwd, &["restore", "--staged", "--", &path])?;
    if c != 0 {
        // Fallback for repos with no commits yet.
        let (_o2, e2, c2) = run_git(&cwd, &["reset", "-q", "HEAD", "--", &path])?;
        if c2 != 0 {
            return Err(if e.trim().is_empty() { e2 } else { e });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(cwd: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("コミットメッセージが空です。".to_string());
    }
    let (o, e, c) = run_git(&cwd, &["commit", "-m", &message])?;
    if c != 0 {
        return Err(if e.trim().is_empty() { o } else { e });
    }
    Ok(o.trim().to_string())
}

#[tauri::command]
pub fn git_init(cwd: String) -> Result<(), String> {
    let (_o, e, c) = run_git(&cwd, &["init"])?;
    if c != 0 {
        return Err(e);
    }
    Ok(())
}
