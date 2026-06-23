import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function terminalStart(id: string, cwd: string | null, rows: number, cols: number): Promise<void> {
  return invoke("terminal_start", { id, cwd: cwd ?? null, rows, cols });
}

export function terminalWrite(id: string, data: string): Promise<void> {
  return invoke("terminal_write", { id, data });
}

export function terminalResize(id: string, rows: number, cols: number): Promise<void> {
  return invoke("terminal_resize", { id, rows, cols });
}

export function terminalKill(id: string): Promise<void> {
  return invoke("terminal_kill", { id });
}

/** Raw (base64) PTY output, tagged by session id. */
export function onTerminalOutput(cb: (id: string, base64: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string; data: string }>("terminal-output", (e) => cb(e.payload.id, e.payload.data));
}

/** Fires (with the session id) when a shell process exits. */
export function onTerminalExit(cb: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>("terminal-exit", (e) => cb(e.payload));
}
