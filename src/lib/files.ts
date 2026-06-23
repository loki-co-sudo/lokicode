// Local file open/save. Native pickers come from the dialog plugin; the actual
// read/write goes through small Rust commands (read_text_file / write_text_file).

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface OpenedFile {
  path: string;
  content: string;
}

export async function openFile(): Promise<OpenedFile | null> {
  const selected = await open({ multiple: false, directory: false });
  if (typeof selected !== "string") return null;
  const content = await invoke<string>("read_text_file", { path: selected });
  return { path: selected, content };
}

export async function writeFile(path: string, contents: string): Promise<void> {
  await invoke("write_text_file", { path, contents });
}

export function readFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export function listDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path });
}

/** Open a folder picker; returns the chosen directory path or null. */
export async function openFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

/** Join a directory and child name using the directory's separator. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** Show a save dialog and write; returns the chosen path, or null if cancelled. */
export async function saveFileAs(
  contents: string,
  defaultPath?: string,
): Promise<string | null> {
  const path = await save({ defaultPath });
  if (!path) return null;
  await writeFile(path, contents);
  return path;
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    md: "markdown",
    markdown: "markdown",
    rs: "rust",
    py: "python",
    go: "go",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    sh: "shell",
    bash: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    xml: "xml",
    sql: "sql",
  };
  return map[ext] ?? "plaintext";
}
