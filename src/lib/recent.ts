// Recently opened folders and files, persisted in localStorage.

const FOLDERS_KEY = "lokicode.recentFolders";
const FILES_KEY = "lokicode.recentFiles";
const MAX = 12;

function load(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function push(key: string, path: string) {
  if (!path) return;
  const list = [path, ...load(key).filter((p) => p !== path)].slice(0, MAX);
  localStorage.setItem(key, JSON.stringify(list));
}

export const recentFolders = () => load(FOLDERS_KEY);
export const recentFiles = () => load(FILES_KEY);
export const addRecentFolder = (path: string) => push(FOLDERS_KEY, path);
export const addRecentFile = (path: string) => push(FILES_KEY, path);
export function clearRecent() {
  localStorage.removeItem(FOLDERS_KEY);
  localStorage.removeItem(FILES_KEY);
}
