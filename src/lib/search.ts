import { invoke } from "@tauri-apps/api/core";

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface ReplaceResult {
  filesChanged: number;
  replacements: number;
}

export function grepSearch(root: string, pattern: string, maxResults?: number): Promise<SearchMatch[]> {
  return invoke<SearchMatch[]>("grep_search", { root, pattern, maxResults: maxResults ?? null });
}

export function listFiles(root: string): Promise<string[]> {
  return invoke<string[]>("list_files", { root });
}

export function replaceInFiles(
  root: string,
  pattern: string,
  replacement: string,
  isRegex: boolean,
): Promise<ReplaceResult> {
  return invoke<ReplaceResult>("replace_in_files", { root, pattern, replacement, isRegex });
}
