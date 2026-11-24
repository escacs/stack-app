// "Sync all worktrees": one op shared by the sidebar button and the Project
// page's result line. Runs `stack sync` in every worktree that has a
// stack.toml; sync restores files and has no inverse, so no Undo.
import { createSignal } from 'solid-js';
import { stackRun } from './bridge';
import { config, refreshLock, refreshReport } from './store';
import { refreshT3Workspace, syncAllWorktrees, t3Info, type WorktreeSyncSummary } from './t3';
import { pushToast } from './toast';

const [syncing, setSyncing] = createSignal(false);
const [syncRes, setSyncRes] = createSignal<WorktreeSyncSummary | null>(null);
export { syncing, syncRes };

/** Worktrees that carry a stack.toml, i.e. the ones a sync would touch. */
export const lockedWorktrees = (): number => t3Info()?.worktrees.filter((w) => w.hasLock).length ?? 0;

export async function runSyncAllWorktrees(): Promise<void> {
  const c = config();
  const w = t3Info();
  if (!c || !w || syncing()) return;
  setSyncing(true);
  setSyncRes(null);
  try {
    const summary = await syncAllWorktrees(w.worktrees, (dir) => stackRun('sync', ['--json'], dir, c.stackPath));
    setSyncRes(summary);
    pushToast({
      tone: summary.failed > 0 ? 'warning' : 'success',
      title: `Synced ${summary.synced} worktree${summary.synced === 1 ? '' : 's'}`,
      description: [summary.skipped ? `${summary.skipped} skipped` : '', summary.failed ? `${summary.failed} failed` : ''].filter(Boolean).join(' · ') || undefined,
    });
    await refreshLock();
    await refreshReport();
    if (c.project) void refreshT3Workspace(c.project);
  } finally {
    setSyncing(false);
  }
}
