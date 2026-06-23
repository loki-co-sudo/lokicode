import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

/**
 * Check GitHub Releases for a newer version. Returns the pending Update, or
 * null if already up to date. Throws on failure (e.g. network error, or the
 * release endpoint being unreachable because the repo is private) so callers can
 * distinguish "up to date" from "could not check" instead of masking errors.
 */
export async function checkForUpdate(): Promise<Update | null> {
  return await check();
}

/** Download and install the update, reporting download progress in bytes. */
export async function installUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, total);
        break;
      case "Finished":
        onProgress?.(total ?? downloaded, total);
        break;
    }
  });
}

/** Restart the app so the freshly installed version takes effect. */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
