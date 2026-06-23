import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function terminalStart(cwd: string | null, rows: number, cols: number): Promise<void> {
  return invoke("terminal_start", { cwd: cwd ?? null, rows, cols });
}

export function terminalWrite(data: string): Promise<void> {
  return invoke("terminal_write", { data });
}

export function terminalResize(rows: number, cols: number): Promise<void> {
  return invoke("terminal_resize", { rows, cols });
}

export function terminalKill(): Promise<void> {
  return invoke("terminal_kill");
}

/** Subscribe to raw (base64) PTY output. Returns an unlisten function. */
export function onTerminalOutput(cb: (base64: string) => void): Promise<UnlistenFn> {
  return listen<string>("terminal-output", (e) => cb(e.payload));
}

/** Fires when the shell process exits. */
export function onTerminalExit(cb: () => void): Promise<UnlistenFn> {
  return listen("terminal-exit", () => cb());
}
