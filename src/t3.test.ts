// Unit tests for T3 Code worktree labels, prompt injection builders, and
// multi-worktree sync helpers (src/t3.ts).
import { describe, expect, it } from 'vitest';
import type { T3ThreadInfo, T3WorkspaceReport, WorktreeInfo } from './bridge';
import { buildInjectionPrompt, syncAllWorktrees, threadLabel, threadTargetDir, worktreeLabel } from './t3';

const wt = (o: Partial<WorktreeInfo>): WorktreeInfo => ({
  path: '/repo',
  branch: null,
  detached: false,
  isMain: false,
  isT3: false,
  hasLock: false,
  isCurrent: false,
  ...o,
});

const thr = (o: Partial<T3ThreadInfo>): T3ThreadInfo => ({
  threadId: 't1',
  title: 'Fix auth',
  status: 'idle',
  provider: 'claude-code',
  model: 'sonnet-4',
  branch: null,
  worktreePath: null,
  link: null,
  updatedAt: null,
  ...o,
});

describe('worktreeLabel', () => {
  it('avoids redundant (main) suffix when branch is already main', () => {
    expect(worktreeLabel(wt({ branch: 'main', isMain: true }))).toBe('main');
  });

  it('annotates non-main branch on primary checkout and t3 worktrees', () => {
    expect(worktreeLabel(wt({ branch: 'feat/x', isMain: true }))).toBe('feat/x (main)');
    expect(worktreeLabel(wt({ branch: 't3/feat-ui', isT3: true }))).toBe('t3/feat-ui (t3)');
    expect(worktreeLabel(wt({ detached: true, isT3: true }))).toBe('detached (t3)');
    expect(worktreeLabel(wt({ path: '/tmp/wt-1' }))).toBe('wt-1');
  });
});

describe('threadLabel and threadTargetDir', () => {
  it('formats branch/worktree/main fallback cleanly', () => {
    expect(threadLabel(thr({ branch: 't3/ui', status: 'running' }))).toBe('Fix auth [t3/ui · running]');
    expect(threadLabel(thr({ worktreePath: '/wt/a', status: 'idle' }))).toBe('Fix auth [worktree · idle]');
    expect(threadLabel(thr({ status: 'idle' }))).toBe('Fix auth [main · idle]');
  });

  it('resolves worktreePath or falls back to mainRoot', () => {
    const ws: T3WorkspaceReport = {
      t3Available: true,
      t3Version: '0.1.7',
      t3Error: null,
      registered: true,
      mainRoot: '/repo',
      worktrees: [],
      threads: [],
    };
    expect(threadTargetDir(null, null)).toBeNull();
    expect(threadTargetDir(null, ws)).toBe('/repo');
    expect(threadTargetDir(thr({ worktreePath: '/wt/feat' }), ws)).toBe('/wt/feat');
    expect(threadTargetDir(thr({ worktreePath: null }), ws)).toBe('/repo');
  });
});

describe('buildInjectionPrompt', () => {
  const skill = { id: 'skills/file-pr', kind: 'skill', name: 'file-pr', summary: 'File a PR.', usage: 'link' };
  const sys = { id: 'systems/conventions', kind: 'system', name: 'conventions', summary: 'Repo rules.', usage: 'reference' };

  it('builds workspace prompt using $skill mention for skills', () => {
    expect(buildInjectionPrompt({ entry: skill, mode: 'workspace', dest: '.agents/skills/file-pr' })).toBe(
      'Use $file-pr (stack entry `skills/file-pr`) imported at `.agents/skills/file-pr`.\n\nFile a PR.',
    );
    expect(buildInjectionPrompt({ entry: sys, mode: 'workspace', dest: '.stack/systems/conventions' })).toBe(
      'Use stack entry `systems/conventions` imported at `.stack/systems/conventions`.\n\nRepo rules.',
    );
  });

  it('builds inline prompt and clips oversized doc bodies', () => {
    expect(buildInjectionPrompt({ entry: skill, mode: 'inline', docBody: '# File PR\n\nSteps.' })).toBe(
      'Apply stack entry `skills/file-pr` (skill, usage: link).\n\nFile a PR.\n\n---\n\n# File PR\n\nSteps.',
    );

    const longBody = 'x'.repeat(16050);
    const out = buildInjectionPrompt({ entry: sys, mode: 'inline', docBody: longBody });
    expect(out).toContain('…[truncated 50 chars]');
  });
});

describe('syncAllWorktrees', () => {
  it('runs sync sequentially across lock holders, skips non-lock trees, and keeps going on error', async () => {
    const order: string[] = [];
    const list: WorktreeInfo[] = [
      wt({ path: '/repo', branch: 'main', isMain: true, hasLock: true }),
      wt({ path: '/wt/nolock', branch: 't3/spike', isT3: true, hasLock: false }),
      wt({ path: '/wt/ok', branch: 't3/ok', isT3: true, hasLock: true }),
      wt({ path: '/wt/fail', branch: 't3/fail', isT3: true, hasLock: true }),
    ];
    const summary = await syncAllWorktrees(list, async (dir) => {
      order.push(dir);
      if (dir === '/wt/fail') throw 'sync failed in /wt/fail';
      const payload =
        dir === '/repo'
          ? { command: 'sync', restored: ['a'], kept: [], skipped: [] }
          : { command: 'sync', restored: [], kept: [], skipped: [] };
      return { stdout: JSON.stringify(payload), stderr: '', code: 0, truncated: false };
    });

    expect(order).toEqual(['/repo', '/wt/ok', '/wt/fail']);
    expect(summary.synced).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.rows).toEqual([
      { path: '/repo', label: 'main', status: 'synced', detail: '1 restored' },
      { path: '/wt/nolock', label: 't3/spike (t3)', status: 'skipped', detail: 'no stack.toml' },
      { path: '/wt/ok', label: 't3/ok (t3)', status: 'synced', detail: 'up to date' },
      { path: '/wt/fail', label: 't3/fail (t3)', status: 'error', detail: 'sync failed in /wt/fail' },
    ]);
  });
});
