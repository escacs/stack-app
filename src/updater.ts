// Manual update flow over tauri-plugin-updater v2: check GitHub releases
// for a newer build, download + install it with progress, then relaunch.
// Errors propagate untouched; the footer shows them short with the full
// text in a tooltip. (The silent non-blocking check at startup lives in
// src-tauri/src/lib.rs.)
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { fmtBytes } from './parse';

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

/** One-line download progress for the footer; null until the first event. */
export function formatUpdateProgress(p: UpdateProgress | null): string | null {
  if (!p) return null;
  if (p.done) return `downloaded ${fmtBytes(p.downloaded)}`;
  if (p.total) {
    const pct = Math.round((p.downloaded / p.total) * 100);
    return `${fmtBytes(p.downloaded)} / ${fmtBytes(p.total)} (${pct}%)`;
  }
  return `${fmtBytes(p.downloaded)}…`;
}

/**
 * Short dim footer form of an update error (the full text goes in the
 * `title` tooltip): first non-blank line, capped at `max` chars.
 */
export function shortenError(full: string, max = 60): string {
  const line = full.split('\n').map((s) => s.trim()).find((s) => s) ?? '';
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}
