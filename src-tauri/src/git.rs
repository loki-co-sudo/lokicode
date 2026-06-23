// Minimal Git source-control backend: shells out to the `git` CLI in the given
// working directory. Used by the Source Control sidebar panel.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::process::Command;
use tauri::AppHandle;

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
    /// Whether the current branch has a configured upstream.
    pub upstream: bool,
    /// Commits ahead of the upstream (local-only).
    pub ahead: u32,
    /// Commits behind the upstream.
    pub behind: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranches {
    pub current: String,
    pub branches: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

/// Build `-c http.<host>.extraheader=...` args that authenticate github.com
/// HTTPS pushes/pulls with the stored token. Empty when logged out.
fn auth_args(app: &AppHandle) -> Vec<String> {
    match crate::github::load_token(app) {
        Some(token) => {
            let basic = STANDARD.encode(format!("x-access-token:{token}"));
            vec![
                "-c".to_string(),
                format!("http.https://github.com/.extraheader=AUTHORIZATION: basic {basic}"),
            ]
        }
        None => Vec::new(),
    }
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
            upstream: false,
            ahead: 0,
            behind: 0,
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
    // ahead/behind vs upstream (best-effort; no upstream → all zero).
    let (mut upstream, mut ahead, mut behind) = (false, 0u32, 0u32);
    let (ab_out, _ab_err, ab_code) =
        run_git(&cwd, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])?;
    if ab_code == 0 {
        let mut it = ab_out.split_whitespace();
        if let (Some(a), Some(b)) = (it.next(), it.next()) {
            upstream = true;
            ahead = a.parse().unwrap_or(0);
            behind = b.parse().unwrap_or(0);
        }
    }

    Ok(GitStatus {
        is_repo: true,
        branch,
        files,
        upstream,
        ahead,
        behind,
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

/// Unified diff for a single file. `staged` selects index-vs-HEAD (`--cached`),
/// otherwise worktree-vs-index. Untracked files are shown as fully added.
#[tauri::command]
pub fn git_diff(cwd: String, path: String, staged: bool) -> Result<String, String> {
    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", &path]
    } else {
        vec!["diff", "--", &path]
    };
    let (out, err, c) = run_git(&cwd, &args)?;
    if c != 0 {
        return Err(err);
    }
    // Empty diff for an unstaged change usually means the file is untracked;
    // show its full content as additions via --no-index against an empty input.
    if out.trim().is_empty() && !staged {
        let (out2, _e2, _c2) =
            run_git(&cwd, &["diff", "--no-index", "--", "/dev/null", &path])?;
        if !out2.trim().is_empty() {
            return Ok(out2);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn git_branches(cwd: String) -> Result<GitBranches, String> {
    let (out, err, c) = run_git(&cwd, &["branch", "--format=%(refname:short)"])?;
    if c != 0 {
        return Err(err);
    }
    let branches: Vec<String> = out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let (cur, _e, _c) = run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(GitBranches {
        current: cur.trim().to_string(),
        branches,
    })
}

#[tauri::command]
pub fn git_switch(cwd: String, branch: String) -> Result<(), String> {
    let (_o, e, c) = run_git(&cwd, &["switch", &branch])?;
    if c != 0 {
        return Err(if e.trim().is_empty() {
            "ブランチを切り替えできませんでした。".to_string()
        } else {
            e
        });
    }
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(cwd: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("ブランチ名が空です。".to_string());
    }
    let (_o, e, c) = run_git(&cwd, &["switch", "-c", name.trim()])?;
    if c != 0 {
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn git_pull(app: AppHandle, cwd: String) -> Result<String, String> {
    let auth = auth_args(&app);
    let mut args: Vec<&str> = auth.iter().map(String::as_str).collect();
    args.extend(["pull", "--ff-only"]);
    let (o, e, c) = run_git(&cwd, &args)?;
    if c != 0 {
        return Err(if e.trim().is_empty() { o } else { e });
    }
    Ok(o.trim().to_string())
}

#[tauri::command]
pub fn git_push(app: AppHandle, cwd: String) -> Result<String, String> {
    let auth = auth_args(&app);
    let base: Vec<&str> = auth.iter().map(String::as_str).collect();

    // First try a plain push; if there is no upstream, set it on origin.
    let mut args = base.clone();
    args.push("push");
    let (o, e, c) = run_git(&cwd, &args)?;
    if c == 0 {
        return Ok(format!("{o}{e}").trim().to_string());
    }
    let no_upstream = e.contains("no upstream") || e.contains("--set-upstream");
    if no_upstream {
        let (branch_out, _be, bc) = run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        if bc == 0 {
            let branch = branch_out.trim();
            let mut args2 = base.clone();
            args2.extend(["push", "-u", "origin", branch]);
            let (o2, e2, c2) = run_git(&cwd, &args2)?;
            if c2 == 0 {
                return Ok(format!("{o2}{e2}").trim().to_string());
            }
            return Err(if e2.trim().is_empty() { o2 } else { e2 });
        }
    }
    Err(if e.trim().is_empty() { o } else { e })
}

/// Recent commit history of the repo (newest first).
#[tauri::command]
pub fn git_log(cwd: String, limit: u32) -> Result<Vec<GitCommit>, String> {
    let n = format!("-n{}", limit.clamp(1, 500));
    // Fields separated by US (0x1f), records by RS (0x1e).
    let fmt = "--pretty=format:%H\x1f%h\x1f%an\x1f%ad\x1f%s\x1e";
    let (out, err, c) = run_git(&cwd, &["log", &n, "--date=short", fmt])?;
    if c != 0 {
        return Err(err);
    }
    let mut commits = Vec::new();
    for rec in out.split('\x1e') {
        let rec = rec.trim_matches(['\n', '\r']);
        if rec.is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.split('\x1f').collect();
        if f.len() >= 5 {
            commits.push(GitCommit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                author: f[2].to_string(),
                date: f[3].to_string(),
                subject: f[4].to_string(),
            });
        }
    }
    Ok(commits)
}
