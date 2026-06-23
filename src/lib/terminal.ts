import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function terminalStart(cwd: string | null): Promise<void> {
  return invoke("terminal_start", { cwd: cwd ?? null });
}

export function terminalWrite(data: string): Promise<void> {
  return invoke("terminal_write", { data });
}

export function terminalKill(): Promise<void> {
  return invoke("terminal_kill");
}

/** Subscribe to streamed shell output. Returns an unlisten function. */
export function onTerminalOutput(cb: (chunk: string) => void): Promise<UnlistenFn> {
  return listen<string>("terminal-output", (e) => cb(e.payload));
}
