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

    let walker = WalkDir::new(&root).into_iter().filter_entry(|e| {
        // Skip ignored directories by name.
        !(e.file_type().is_dir()
            && e.file_name()
                .to_str()
                .map(|n| SKIP_DIRS.contains(&n))
                .unwrap_or(false))
    });

    for entry in walker.filter_map(|e| e.ok()) {
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
