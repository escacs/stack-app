// Tests for outcome and undo planning (src/undo.ts): every mutation's toast
// text, and that Undo exists only where a faithful inverse does.
import { describe, expect, it } from 'vitest';
import type { StatusRow } from './parse';
import {
  adoptOutcome,
  batchOutcome,
  importOutcome,
  initOutcome,
  listIds,
  planUndoRemove,
  presetOutcome,
  removeOutcome,
  removeSteps,
  retargetToast,
  syncOutcome,
  toastTtl,
  updateOutcome,
} from './undo';

const row = (over: Partial<StatusRow> = {}): StatusRow => ({
  id: 'skills/file-pr',
  commit: 'abc1234',
  path: '.agents/skills/file-pr',
  local: [],
  upstreamCount: null,
  gone: false,
  ...over,
});

describe('importOutcome', () => {
  it('names a single import and undoes it with a remove', () => {
    const o = importOutcome({ imported: [{ id: 'skills/file-pr', path: '.agents/skills/file-pr' }], already: [] }, 'skills/file-pr');
    expect(o.title).toBe('Imported skills/file-pr');
    expect(o.undone).toBe('Undid import of skills/file-pr');
    expect(o.tone).toBe('success');
    expect(o.undo).toEqual([{ sub: 'remove', args: ['skills/file-pr', '--json'], id: 'skills/file-pr' }]);
  });

  it('counts dependencies and undoes all of them, main entry first', () => {
    const o = importOutcome(
      {
        imported: [
          { id: 'components/react', path: 'c/react' },
          { id: 'components/base', path: 'c/base', requiredBy: 'components/react' },
        ],
        already: [],
      },
      'components/react',
    );
    expect(o.title).toBe('Imported components/react and 1 dependency');
    expect(o.undo?.map((s) => s.id)).toEqual(['components/react', 'components/base']);
  });

  it('an already-imported entry is info with no undo', () => {
    const o = importOutcome({ imported: [], already: ['skills/file-pr'] }, 'skills/file-pr');
    expect(o).toMatchObject({ tone: 'info', title: 'Already imported skills/file-pr', undo: null });
  });
});

describe('batchOutcome', () => {
  it('summarises and undoes what landed; refusals make it a warning', () => {
    const o = batchOutcome({ imported: ['a/1', 'a/2'], already: 1, refused: 1, stopped: false });
    expect(o.title).toBe('Imported 2 entries');
    expect(o.tone).toBe('warning');
    expect(o.description).toBe('a/1, a/2 · 1 already there · 1 refused');
    expect(o.undo).toHaveLength(2);
  });

  it('nothing imported plans no undo', () => {
    expect(batchOutcome({ imported: [], already: 3, refused: 0, stopped: false })).toMatchObject({ title: 'Nothing imported', undo: null });
  });
});

describe('removeOutcome and planUndoRemove', () => {
  it('a clean row can be restored by re-importing to the same destination', () => {
    const o = removeOutcome({ removed: 'skills/file-pr', kept: [], requiredBy: [] }, row());
    expect(o.title).toBe('Removed skills/file-pr');
    expect(o.undone).toBe('Restored skills/file-pr');
    expect(o.undo).toEqual([
      { sub: 'import', args: ['skills/file-pr', '--to', '.agents/skills/file-pr', '--json'], id: 'skills/file-pr' },
    ]);
  });

  it('keeps no Undo when edited files were kept (the restore would collide)', () => {
    const o = removeOutcome({ removed: 'skills/file-pr', kept: ['.agents/skills/file-pr/SKILL.md'], requiredBy: [] }, row({ local: ['SKILL.md'] }));
    expect(o.undo).toBeNull();
    expect(o.tone).toBe('warning');
    expect(o.description).toContain('Kept 1 edited file');
  });

  it('no Undo when the stack moved on, the entry is gone, or the row is unknown', () => {
    expect(planUndoRemove(row({ upstreamCount: 2 }))).toBeNull();
    expect(planUndoRemove(row({ gone: true }))).toBeNull();
    expect(planUndoRemove(null)).toBeNull();
    expect(planUndoRemove(undefined)).toBeNull();
  });

  it('notes entries that still require the removed one', () => {
    const o = removeOutcome({ removed: 'a/b', kept: [], requiredBy: ['x/y'] }, row({ id: 'a/b' }));
    expect(o.description).toBe('x/y still requires it');
    expect(o.tone).toBe('warning');
  });
});

describe('operations with no true inverse plan no undo', () => {
  it('update, sync, init and adopt', () => {
    const upd = updateOutcome({ command: 'update', commit: 'c', updated: [{ id: 'skills/x', changed: 2 }], conflicts: [], merged: [], kept: [], skipped: [], gone: [], imported: [], upToDate: false }, 'skills/x');
    expect(upd).toMatchObject({ tone: 'success', title: 'Updated skills/x', undo: null });
    expect(syncOutcome({ command: 'sync', restored: ['a', 'b'], kept: [], skipped: [] })).toMatchObject({ title: 'Restored 2 files', undo: null });
    expect(initOutcome().undo).toBeNull();
    expect(adoptOutcome('skills/x', true).undo).toBeNull();
  });

  it('update conflicts warn; an up-to-date update is info', () => {
    const base = { command: 'update' as const, commit: 'c', updated: [], conflicts: [], merged: [], kept: [], skipped: [], gone: [], imported: [], upToDate: true };
    expect(updateOutcome(base)).toMatchObject({ tone: 'info', title: 'Everything is up to date' });
    const bad = updateOutcome({ ...base, upToDate: false, updated: [{ id: 'a/b', changed: 1 }], conflicts: ['f.md'] });
    expect(bad.tone).toBe('warning');
    expect(bad.title).toBe('Updated 1 entry with conflicts');
    expect(bad.description).toContain('1 conflict to resolve');
  });

  it('a sync with nothing missing says so', () => {
    expect(syncOutcome({ command: 'sync', restored: [], kept: [], skipped: [] }).title).toBe('Nothing was missing');
  });
});

describe('presetOutcome', () => {
  it('applying a preset undoes by removing what it imported', () => {
    const o = presetOutcome({ preset: 'web', imported: [{ id: 'a/1', path: 'p' }, { id: 'a/2', path: 'q' }], already: ['a/3'] });
    expect(o.title).toBe('Imported preset web');
    expect(o.description).toBe('Imported 2 entries, 1 already there');
    expect(o.undo?.map((s) => s.id)).toEqual(['a/1', 'a/2']);
  });

  it('a preset that imported nothing is info with no undo', () => {
    expect(presetOutcome({ preset: 'web', imported: [], already: ['a/1'] })).toMatchObject({ tone: 'info', undo: null });
  });
});

describe('helpers', () => {
  it('listIds trims long lists', () => {
    expect(listIds(['a', 'b'])).toBe('a, b');
    expect(listIds(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
  });

  it('removeSteps dedupes and returns null for nothing', () => {
    expect(removeSteps([{ id: 'a' }, { id: 'a' }])).toHaveLength(1);
    expect(removeSteps([])).toBeNull();
  });

  it('the worktree switch offers Undo only with a previous worktree', () => {
    const calls: string[] = [];
    const t = retargetToast('feat/x', '/p/main', (d) => calls.push(d));
    expect(t.title).toBe('Installing into feat/x');
    expect(t.description).not.toMatch(/target|sync/i);
    t.action?.run();
    expect(calls).toEqual(['/p/main']);
    expect(retargetToast('x', null, () => {}).action).toBeUndefined();
  });

  it('actions and errors stay longer than plain notes', () => {
    expect(toastTtl('success', false)).toBeLessThan(toastTtl('success', true));
    expect(toastTtl('error', false)).toBeGreaterThan(toastTtl('success', true));
  });
});
