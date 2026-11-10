// Manual update flow over tauri-plugin-updater v2: check GitHub releases
// for a newer build, download + install it with progress, then relaunch.
// Errors propagate untouched; the settings view shows them verbatim.
// (The silent non-blocking check at startup lives in src-tauri/src/lib.rs.)
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type { DownloadEvent, Update };

export type UpdateProgress = {
  downloaded: number;
  total: number | null;
  done: boolean;
};

/** Check for updates; resolves to null when already up to date. */
export const checkForUpdate = (): Promise<Update | null> => check();

/** Download and install a previously checked update, reporting progress. */
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((e) => {
    if (e.event === 'Started') {
      total = e.data.contentLength ?? null;
      downloaded = 0;
      onProgress({ downloaded, total, done: false });
    } else if (e.event === 'Progress') {
      downloaded += e.data.chunkLength;
      onProgress({ downloaded, total, done: false });
    } else {
      onProgress({ downloaded, total, done: true });
    }
  });
  await update.close();
}

/** Quit and reopen the app so the installed update runs. */
export const relaunchApp = (): Promise<void> => relaunch();
