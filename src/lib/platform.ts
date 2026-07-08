// Thin, cached wrapper around the Rust `get_platform_info` command — the
// single source of truth for "what OS/shell is this", used to stop the system
// prompt and UI text from hardcoding Windows (see specs/fix-roadmap-deepthink-400-crossplatform-shell.md 修正2).

import { invoke } from "@tauri-apps/api/core";

export interface PlatformInfo {
  /** "windows" | "macos" | "linux" (std::env::consts::OS). */
  os: string;
  shell: string;
}

// Safe default: matches the app's previous (Windows-only) hardcoded behavior,
// used until the async fetch below resolves (typically a few ms after startup).
let cached: PlatformInfo = { os: "windows", shell: "PowerShell" };
let inflight: Promise<PlatformInfo> | null = null;

/** Fetch and cache the platform info once; call at app startup. Safe to call
 * more than once (subsequent calls return the same in-flight/resolved promise). */
export function initPlatformInfo(): Promise<PlatformInfo> {
  if (!inflight) {
    inflight = invoke<PlatformInfo>("get_platform_info")
      .then((p) => {
        cached = p;
        return p;
      })
      .catch(() => cached);
  }
  return inflight;
}

/** Synchronous read of the cached platform info (default until init resolves). */
export function getPlatformInfo(): PlatformInfo {
  return cached;
}

export function isWindows(): boolean {
  return getPlatformInfo().os === "windows";
}
