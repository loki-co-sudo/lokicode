// Codebase-wide text search (the agent's `grep_search` tool). Walks the
// workspace, skipping heavy/ignored directories, and returns matching lines.

use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".next"];
const MAX_FILE_BYTES: u64 = 1_000_000;
const DEFAULT_MAX_RESULTS: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// Path relative to the search root.
    pub path: String,
    pub line: usize,
    pub text: String,
}

/// Walk `root`, skipping heavy/ignored directories. Shared by search & listing.
fn walk(root: &str) -> impl Iterator<Item = walkdir::DirEntry> {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            !(e.file_type().is_dir()
                && e.file_name()
                    .to_str()
                    .map(|n| SKIP_DIRS.contains(&n))
                    .unwrap_or(false))
        })
        .filter_map(|e| e.ok())
}

/// All file paths (relative to `root`) under the workspace — used by quick-open.
#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<String>, String> {
    let root_path = Path::new(&root);
    let mut files = Vec::new();
    for entry in walk(&root) {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(root_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        files.push(rel);
        if files.len() >= 20000 {
            break;
        }
    }
    files.sort();
    Ok(files)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
}

/// Replace all matches of `pattern` with `replacement` across the workspace.
/// `is_regex` selects regex vs literal matching. Returns counts.
#[tauri::command]
pub fn replace_in_files(
    root: String,
    pattern: String,
    replacement: String,
    is_regex: bool,
) -> Result<ReplaceResult, String> {
    if pattern.is_empty() {
        return Err("検索文字列が空です。".to_string());
    }
    let re = if is_regex {
        Some(regex::Regex::new(&pattern).map_err(|e| format!("正規表現エラー: {e}"))?)
    } else {
        None
    };
    let mut files_changed = 0usize;
    let mut replacements = 0usize;

    for entry in walk(&root) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let (new_content, count) = match &re {
            Some(r) => {
                let count = r.find_iter(&content).count();
                if count == 0 {
                    continue;
                }
                (r.replace_all(&content, replacement.as_str()).into_owned(), count)
            }
            None => {
                let count = content.matches(&pattern).count();
                if count == 0 {
                    continue;
                }
                (content.replace(&pattern, &replacement), count)
            }
        };
        if std::fs::write(entry.path(), new_content).is_ok() {
            files_changed += 1;
            replacements += count;
        }
    }
    Ok(ReplaceResult {
        files_changed,
        replacements,
    })
}

#[tauri::command]
pub fn grep_search(
    root: String,
    pattern: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchMatch>, String> {
    let re = regex::Regex::new(&pattern).map_err(|e| format!("正規表現エラー: {e}"))?;
    let limit = max_results.unwrap_or(DEFAULT_MAX_RESULTS).clamp(1, 2000);
    let root_path = Path::new(&root);
    let mut matches = Vec::new();

    for entry in walk(&root) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue; // non-UTF8 / binary
        };
        let rel = entry
            .path()
            .strip_prefix(root_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        for (i, line) in content.lines().enumerate() {
            if re.is_match(line) {
                matches.push(SearchMatch {
                    path: rel.clone(),
                    line: i + 1,
                    text: line.chars().take(400).collect(),
                });
                if matches.len() >= limit {
                    return Ok(matches);
                }
            }
        }
    }
    Ok(matches)
}
