// T3 Code workspace discovery (git worktrees + T3 threads), multi-worktree
// sync, and thread prompt/skill injection helpers. Pure formatters and sync
// logic live here so vitest can pin them without a Tauri shell.
import { createSignal } from 'solid-js';
import {
  errText,
  t3Workspace,
  type StackOut,
  type T3ThreadInfo,
  type T3WorkspaceReport,
  type WorktreeInfo,
} from './bridge';
import { fromStackOut, type JsonEntry, type SyncJson } from './json';

export type InjectMode = 'inline' | 'workspace';

const MAX_INLINE_DOC_CHARS = 16000;

export const [t3Info, setT3Info] = createSignal<T3WorkspaceReport | null>(null);
export const [t3Loading, setT3Loading] = createSignal(false);
export const [t3Error, setT3Error] = createSignal<string | null>(null);

let workspaceSeq = 0;

export function clearT3Workspace(): void {
  workspaceSeq += 1;
  setT3Info(null);
  setT3Error(null);
  setT3Loading(false);
}

/** Refresh T3 threads + worktrees for `projectDir`. Older answers drop silently. */
export async function refreshT3Workspace(projectDir: string | null): Promise<void> {
  const seq = ++workspaceSeq;
  if (!projectDir) {
    clearT3Workspace();
    return;
  }
  setT3Loading(true);
  setT3Error(null);
  try {
    const rep = await t3Workspace(projectDir);
    if (seq !== workspaceSeq) return;
    setT3Info(rep);
  } catch (err) {
    if (seq !== workspaceSeq) return;
    setT3Error(errText(err));
  } finally {
    if (seq === workspaceSeq) setT3Loading(false);
  }
}

/** Short label for a worktree option in TopBar and Project. */
export function worktreeLabel(w: WorktreeInfo): string {
  const leaf = w.path.split(/[\\/]/).filter(Boolean).pop() ?? w.path;
  const branch = w.branch ?? (w.detached ? 'detached' : leaf);
  const tags: string[] = [];
  if (w.isMain) tags.push('main');
  else if (w.isT3) tags.push('t3');
  if (tags.length && tags[0] !== branch) return `${branch} (${tags.join(', ')})`;
  if (!w.branch && !w.detached) return leaf;
  return branch;
}

/** Short label for a T3 thread option in the injection picker. */
export function threadLabel(t: T3ThreadInfo): string {
  const where = t.branch ?? (t.worktreePath ? 'worktree' : 'main');
  return `${t.title} [${where} · ${t.status}]`;
}

/** Find the worktree object matching a thread's worktreePath (or main root fallback). */
export function threadTargetDir(thread: T3ThreadInfo | null, ws: T3WorkspaceReport | null): string | null {
  if (!ws) return null;
  if (thread?.worktreePath) return thread.worktreePath;
  return ws.mainRoot;
}

export function buildInjectionPrompt(opts: {
  entry: Pick<JsonEntry, 'id' | 'kind' | 'name' | 'summary' | 'usage'>;
  mode: InjectMode;
  dest?: string | null;
  docBody?: string | null;
}): string {
  const { entry, mode, dest, docBody } = opts;
  const lines: string[] = [];
  if (mode === 'workspace') {
    const mention = entry.kind === 'skill' && entry.name ? `$${entry.name}` : null;
    const head = mention
      ? `Use ${mention} (stack entry \`${entry.id}\`)`
      : `Use stack entry \`${entry.id}\``;
    const where = dest ? ` imported at \`${dest}\`` : '';
    lines.push(`${head}${where}.`);
    if (entry.summary) lines.push('', entry.summary);
    return lines.join('\n');
  }

  lines.push(`Apply stack entry \`${entry.id}\` (${entry.kind}, usage: ${entry.usage}).`);
  if (entry.summary) lines.push('', entry.summary);
  const body = docBody?.trim();
  if (body) {
    const clipped =
      body.length > MAX_INLINE_DOC_CHARS
        ? `${body.slice(0, MAX_INLINE_DOC_CHARS)}\n\n…[truncated ${body.length - MAX_INLINE_DOC_CHARS} chars]`
        : body;
    lines.push('', '---', '', clipped);
  }
  return lines.join('\n');
}

export type WorktreeSyncRow = {
  path: string;
  label: string;
  status: 'synced' | 'skipped' | 'error';
  detail: string;
};

export type WorktreeSyncSummary = {
  synced: number;
  skipped: number;
  failed: number;
  rows: WorktreeSyncRow[];
};

/**
 * Run `stack sync --json` across every worktree that holds a `stack.toml`
 * (or `stack.lock.json`). Sequential so git/node never thrash across 30+
 * worktrees at once.
 */
export async function syncAllWorktrees(
  worktrees: WorktreeInfo[],
  runSync: (projectDir: string) => Promise<StackOut>,
): Promise<WorktreeSyncSummary> {
  const rows: WorktreeSyncRow[] = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  for (const wt of worktrees) {
    const label = worktreeLabel(wt);
    if (!wt.hasLock) {
      skipped += 1;
      rows.push({ path: wt.path, label, status: 'skipped', detail: 'no stack.toml' });
      continue;
    }
    try {
      const out = await runSync(wt.path);
      const r = fromStackOut<SyncJson>(out);
      synced += 1;
      const parts: string[] = [];
      if (r.restored.length) parts.push(`${r.restored.length} restored`);
      if (r.kept.length) parts.push(`${r.kept.length} kept`);
      if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
      rows.push({
        path: wt.path,
        label,
        status: 'synced',
        detail: parts.length ? parts.join(' · ') : 'up to date',
      });
    } catch (err) {
      failed += 1;
      rows.push({ path: wt.path, label, status: 'error', detail: errText(err) });
    }
  }
  return { synced, skipped, failed, rows };
}
