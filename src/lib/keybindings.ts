// Customizable keyboard shortcuts for app-level actions, persisted in localStorage.

export type ActionId =
  | "save"
  | "palette"
  | "quickOpen"
  | "toggleSidebar"
  | "toggleChat"
  | "toggleTerminal"
  | "outline";

export const DEFAULT_KEYS: Record<ActionId, string> = {
  save: "Ctrl+S",
  palette: "Ctrl+Shift+P",
  quickOpen: "Ctrl+P",
  toggleSidebar: "Ctrl+B",
  toggleChat: "Ctrl+Alt+B",
  toggleTerminal: "Ctrl+J",
  outline: "Ctrl+Shift+O",
};

export const ACTION_LABELS: Record<ActionId, string> = {
  save: "保存",
  palette: "コマンドパレット",
  quickOpen: "クイックオープン",
  toggleSidebar: "サイドバーの表示切替",
  toggleChat: "AI エージェントの表示切替",
  toggleTerminal: "ターミナルの表示切替",
  outline: "アウトライン / シンボル検索",
};

const KEY = "lokicode.keybindings";

export function loadKeybindings(): Record<ActionId, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULT_KEYS, ...stored };
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

export function saveKeybindings(map: Record<ActionId, string>) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

/** Normalized combo string (e.g. "Ctrl+Shift+P") from a keyboard event. */
export function comboFromEvent(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): string {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  if (k === " ") k = "Space";
  else if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join("+");
}
