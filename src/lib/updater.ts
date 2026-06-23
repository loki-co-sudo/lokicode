import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

/**
 * Check GitHub Releases for a newer version. Returns the pending Update, or
 * null if up to date. Swallows errors (e.g. running in `npm run dev` where the
 * updater isn't wired) and returns null so the UI can stay quiet.
 */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    return null;
  }
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
