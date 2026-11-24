import { describe, expect, it } from 'vitest';
import {
  importCounts,
  buildPlan,
  buildTarget,
  buildTree,
  entryFileCountLabel,
  fileCountLabel,
  collidingTargets,
  collisionMessage,
  importedFiles,
  intoWords,
  joinDest,
  markGlyph,
  mergePlans,
  plainError,
  batchHeadline,
  targetFileLabel,
  planCountLabel,
  planCounts,
  planSummary,
  planTotals,
  requiredLabel,
  runnable,
  type PlanFile,
  type PlanTarget,
} from './plan';

const f = (path: string, size = 10, mark: PlanFile['mark'] = 'new'): PlanFile => ({ path, size, mark });

describe('paths', () => {
  it('joins destinations', () => {
    expect(joinDest('.agents/skills/x', 'SKILL.md')).toBe('.agents/skills/x/SKILL.md');
    expect(joinDest('.', 'AGENTS.md')).toBe('AGENTS.md');
    expect(joinDest('', 'a/b.md')).toBe('a/b.md');
    expect(joinDest('src/ui/', 'a.tsx')).toBe('src/ui/a.tsx');
  });
  it('drops the manifest and strips a payload folder', () => {
    const files = [{ path: 'README.md', size: 1 }, { path: 'stack.json', size: 2 }, { path: 'files/AGENTS.md', size: 3 }, { path: 'files/x/y.json', size: 4 }];
    expect(importedFiles(files).map((x) => x.path)).toEqual(['README.md', 'files/AGENTS.md', 'files/x/y.json']);
    expect(importedFiles(files, 'files').map((x) => x.path)).toEqual(['AGENTS.md', 'x/y.json']);
  });
});

describe('buildTarget', () => {
  const files = [{ path: 'SKILL.md', size: 100 }, { path: 'theme.json', size: 50 }];
  it('marks new files and sorts them', () => {
    const t = buildTarget({ id: 'skills/x', dest: '.agents/skills/x' }, [files[1], files[0]], []);
    expect(t.files).toEqual([
      { path: '.agents/skills/x/SKILL.md', size: 100, mark: 'new' },
      { path: '.agents/skills/x/theme.json', size: 50, mark: 'new' },
    ]);
  });
  it('marks collisions from the dry run', () => {
    const t = buildTarget({ id: 'skills/x', dest: '.agents/skills/x' }, files, ['.agents/skills/x/SKILL.md']);
    expect(t.files.map((x) => x.mark)).toEqual(['collision', 'new']);
  });
  it('keeps a collision the file list does not know of, under its destination only', () => {
    const t = buildTarget({ id: 'skills/x', dest: 'a' }, files, ['a/extra.md', 'elsewhere/y.md']);
    expect(t.files.map((x) => [x.path, x.mark])).toEqual([['a/SKILL.md', 'new'], ['a/theme.json', 'new'], ['a/extra.md', 'collision']].sort((p, q) => String(p[0]).localeCompare(String(q[0]))));
  });
  it('marks identical-on-disk files as overwrite when told', () => {
    const t = buildTarget({ id: 'x', dest: '.' }, [{ path: 'AGENTS.md', size: 1 }], [], new Set(['AGENTS.md']));
    expect(t.files[0].mark).toBe('overwrite');
  });
});

describe('buildPlan', () => {
  it('builds each imported entry and carries already + gitignore', () => {
    const plan = buildPlan(
      {
        imported: [{ id: 'skills/a', path: '.agents/skills/a' }, { id: 'systems/b', path: '.stack/systems/b', requiredBy: 'skills/a' }],
        already: ['skills/c'],
        conflicts: ['.stack/systems/b/README.md'],
        gitignore: 'updated',
      },
      (id) => (id === 'skills/a' ? [{ path: 'SKILL.md', size: 5 }] : [{ path: 'README.md', size: 7 }]),
    );
    expect(plan.targets.map((t) => [t.id, t.requiredBy ?? null, t.files.map((x) => x.mark)])).toEqual([
      ['skills/a', null, ['new']],
      ['systems/b', 'skills/a', ['collision']],
    ]);
    expect(plan.already).toEqual(['skills/c']);
    expect(plan.gitignore).toBe(true);
    expect(collidingTargets(plan).map((t) => t.id)).toEqual(['systems/b']);
  });
});

describe('dependencies', () => {
  const file = [{ path: 'SKILL.md', size: 3 }];

  it('marks a target that only follows from another entry', () => {
    const picked = buildTarget({ id: 'skills/a', dest: '.agents/skills/a' }, file, []);
    const dep = buildTarget({ id: 'systems/b', dest: '.stack/systems/b', requiredBy: 'skills/a' }, file, []);
    expect([picked.dependency, dep.dependency]).toEqual([false, true]);
    expect(dep.requiredBy).toBe('skills/a');
  });

  it('counts what was selected apart from what it pulls in', () => {
    const counts = planCounts([
      { ...buildTarget({ id: 'a', dest: 'pa' }, file, []) },
      { ...buildTarget({ id: 'b', dest: 'pd', requiredBy: 'a' }, file, []) },
      { ...buildTarget({ id: 'c', dest: 'pe', requiredBy: 'a' }, file, []) },
    ]);
    expect(counts).toEqual({ selected: 1, required: 2, total: 3 });
  });

  it('carries the counts on the plan itself', () => {
    const plan = buildPlan(
      {
        imported: [
          { id: 'a', path: 'pa' },
          { id: 'dep', path: 'pd', requiredBy: 'a' },
        ],
        already: [],
      },
      () => file,
    );
    expect([plan.selectedCount, plan.requiredCount]).toEqual([1, 1]);
    expect(plan.targets.map((t) => [t.id, t.dependency])).toEqual([
      ['a', false],
      ['dep', true],
    ]);
  });

  it('says "+N required" rather than counting a dependency as a pick', () => {
    expect(requiredLabel(1)).toBe('+1 required');
    expect(requiredLabel(2)).toBe('+2 required');
    expect(planCountLabel({ selected: 3, required: 2, total: 5 })).toBe('3 selected · +2 required');
    expect(planCountLabel({ selected: 1, required: 0, total: 1 })).toBe('1 entry');
    expect(planCountLabel({ selected: 2, required: 0, total: 2 })).toBe('2 entries');
  });

  it('a shared dependency is one target and one required entry, not two', () => {
    const a = buildPlan({ imported: [{ id: 'a', path: 'pa' }, { id: 'dep', path: 'pd', requiredBy: 'a' }], already: [] }, () => file);
    const b = buildPlan({ imported: [{ id: 'b', path: 'pb' }, { id: 'dep', path: 'pd', requiredBy: 'b' }], already: [] }, () => file);
    const m = mergePlans([a, b]);
    expect(m.targets.map((t) => t.id)).toEqual(['a', 'dep', 'b']);
    expect([m.selectedCount, m.requiredCount]).toEqual([2, 1]);
    expect(m.selectedCount + m.requiredCount).toBe(m.targets.length);
  });

  it('counts an entry as selected when one batch picked it and another only needed it', () => {
    const a = buildPlan({ imported: [{ id: 'a', path: 'pa' }, { id: 'dep', path: 'pd', requiredBy: 'a' }], already: [] }, () => file);
    const b = buildPlan({ imported: [{ id: 'dep', path: 'pd' }], already: [] }, () => file);
    const m = mergePlans([a, b]);
    expect(m.targets.map((t) => [t.id, t.dependency])).toEqual([
      ['a', false],
      ['dep', false],
    ]);
    expect([m.selectedCount, m.requiredCount]).toEqual([2, 0]);
  });

  it('an optional dependency hint in a plan is typed, not free text', () => {
    const t: PlanTarget = buildTarget({ id: 'x', dest: 'p', requiredBy: 'y' }, file, []);
    expect(t.dependency).toBe(true);
  });
});

describe('buildTree', () => {
  it('groups by folder and folds single-folder chains', () => {
    const tree = buildTree([f('.agents/skills/x/SKILL.md', 100), f('.agents/skills/x/refs/a.md', 20), f('.agents/skills/x/refs/b.md', 30)]);
    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.kind === 'dir' && root.name).toBe('.agents/skills/x');
    const kids = root.kind === 'dir' ? root.children : [];
    expect(kids.map((k) => `${k.kind}:${k.name}`)).toEqual(['dir:refs', 'file:SKILL.md']);
    const refs = kids[0];
    expect(refs.kind === 'dir' && [refs.files, refs.bytes]).toEqual([2, 50]);
  });
  it('lists root files plainly and counts collisions per folder', () => {
    const tree = buildTree([f('AGENTS.md', 5), f('docs/a.md', 1, 'collision'), f('docs/b.md', 1)]);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(['dir:docs', 'file:AGENTS.md']);
    const docs = tree[0];
    expect(docs.kind === 'dir' && docs.collisions).toBe(1);
  });
  it('is empty for no files', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('words', () => {
  it('says where files go', () => {
    expect(intoWords('.agents/skills/taste-skill')).toBe('into .agents/skills/taste-skill');
    expect(intoWords('.')).toBe('into the project root');
  });
  it('translates collisions without CLI wording', () => {
    const t = buildTarget({ id: 'x', dest: '.agents/skills/x' }, [{ path: 'a', size: 1 }, { path: 'b', size: 1 }], ['.agents/skills/x/a', '.agents/skills/x/b']);
    const m = collisionMessage(t) ?? '';
    expect(m).toBe('2 files already exist at .agents/skills/x — choose another folder or keep them');
    expect(m).not.toMatch(/refus|--to|abort/i);
    expect(collisionMessage(buildTarget({ id: 'x', dest: '.' }, [{ path: 'a', size: 1 }], ['a']))).toBe('1 file already exists in the project root — choose another folder or keep it');
    expect(collisionMessage(buildTarget({ id: 'x', dest: '.' }, [], []))).toBeNull();
  });
  it('totals and summarises', () => {
    const plan = buildPlan({ imported: [{ id: 'a', path: 'p' }, { id: 'b', path: 'q' }], already: [] }, () => [{ path: 'f', size: 1024 }]);
    const t = planTotals(plan);
    expect(t).toMatchObject({ entries: 2, files: 2, bytes: 2048, collisions: 0, fresh: 2 });
    expect(planSummary(t, (b) => `${b / 1024} KB`)).toBe('2 files · 2 KB · 2 entries');
  });
  it('glyphs', () => {
    expect([markGlyph('new'), markGlyph('overwrite'), markGlyph('collision')]).toEqual(['+', '~', '!']);
  });
  it('plain errors drop the CLI voice', () => {
    expect(plainError('these files already exist with other content; move them or choose --to:\n  a')).not.toMatch(/--to|refus/);
    expect(plainError('skills/x is not an entry at stack commit abc (new entries must be committed)')).toMatch(/not in the stack/);
    expect(plainError('path escapes the project directory')).toBe('That folder is outside the project.');
    expect(plainError('boom\nmore')).toBe('boom');
  });
});

describe('mergePlans', () => {
  it('lists a shared dependency once and keeps gitignore if any plan changes it', () => {
    const a = buildPlan({ imported: [{ id: 'a', path: 'pa' }, { id: 'dep', path: 'pd', requiredBy: 'a' }], already: ['x'], gitignore: 'unchanged' }, () => []);
    const b = buildPlan({ imported: [{ id: 'b', path: 'pb' }, { id: 'dep', path: 'pd', requiredBy: 'b' }], already: ['x', 'y'], gitignore: 'updated' }, () => []);
    const m = mergePlans([a, b]);
    expect(m.targets.map((t) => t.id)).toEqual(['a', 'dep', 'b']);
    expect(m.already).toEqual(['x', 'y']);
    expect(m.gitignore).toBe(true);
  });
});

describe('runnable', () => {
  it('drops entries with a failed dry run or a collision anywhere in their plan', () => {
    const ok = buildPlan({ imported: [{ id: 'a', path: 'pa' }], already: [] }, () => [{ path: 'f', size: 1 }]);
    const clash = buildPlan({ imported: [{ id: 'b', path: 'pb' }, { id: 'dep', path: 'pd', requiredBy: 'b' }], already: [], conflicts: ['pd/f'] }, () => [{ path: 'f', size: 1 }]);
    const per = new Map([['a', ok], ['b', clash]]);
    const errs = new Map([['c', 'nope']]);
    expect(runnable([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], per, errs).map((t) => t.id)).toEqual(['a', 'd']);
  });
});

describe('batchHeadline', () => {
  it('leads with what will import, then what needs attention', () => {
    expect(batchHeadline({ willImport: 6, differentFolder: 12, already: 0, notCommitted: 0 })).toBe('6 will import, 12 need a different folder');
  });
  it('mentions already imported and uncommitted rows', () => {
    expect(batchHeadline({ willImport: 3, differentFolder: 0, already: 2, notCommitted: 1 })).toBe('3 will import, 2 already imported, 1 not in stack');
  });
  it('says plainly when nothing will import', () => {
    expect(batchHeadline({ willImport: 0, differentFolder: 2, already: 0, notCommitted: 0 })).toBe('Nothing will import, 2 need a different folder');
  });
});

describe('file counts agree with the entry page', () => {
  // templates/agents-md as the stack lists it: README.md + stack.json plus the
  // payload folder's two files. The entry page counts 4; an import writes 2.
  const listed = [
    { path: 'README.md', size: 109 },
    { path: 'stack.json', size: 110 },
    { path: 'files/AGENTS.md', size: 115 },
    { path: 'files/config.json', size: 116 },
  ];

  it('says how many of the entry\'s files an import copies', () => {
    expect(fileCountLabel(4)).toBe('4 files');
    expect(fileCountLabel(4, 4)).toBe('4 files');
    expect(fileCountLabel(4, 2)).toBe('4 files · 2 copied');
    expect(fileCountLabel(1)).toBe('1 file');
    expect(fileCountLabel(1, 0)).toBe('1 file · 0 copied');
  });

  it('reads the entry listing the same way the plan does', () => {
    expect(entryFileCountLabel(listed, 'files')).toBe('4 files · 2 copied');
    // Without a payload folder everything but the manifest is copied.
    expect(entryFileCountLabel(listed, null)).toBe('4 files · 3 copied');
    expect(fileCountLabel(listed.length)).toBe('4 files');
  });

  it('carries the entry count onto the plan target, so the header cannot contradict the page', () => {
    const t = buildTarget({ id: 'templates/agents-md', dest: '.', entryFiles: listed.length }, importedFiles(listed, 'files'), []);
    expect(t.entryFiles).toBe(4);
    expect(t.files.map((f) => f.path)).toEqual(['AGENTS.md', 'config.json']);
    expect(targetFileLabel(t)).toBe('4 files · 2 copied');
  });

  it('a target with no entry count claims nothing about copying', () => {
    const t = buildTarget({ id: 'x', dest: 'p' }, [{ path: 'f', size: 1 }], []);
    expect(t.entryFiles).toBeUndefined();
    expect(targetFileLabel(t)).toBe('1 file');
  });

  it('keeps the count when a batch turns a dependency into a picked entry', () => {
    const dep = buildTarget({ id: 'dep', dest: 'pd', requiredBy: 'a', entryFiles: 2 }, [{ path: 'f', size: 1 }], []);
    const picked = buildTarget({ id: 'dep', dest: 'pd', entryFiles: 3 }, [{ path: 'f', size: 1 }], []);
    const merged = mergePlans([{ targets: [dep], already: [], gitignore: false, selectedCount: 0, requiredCount: 1 }, { targets: [picked], already: [], gitignore: false, selectedCount: 1, requiredCount: 0 }]);
    expect(merged.targets[0].entryFiles).toBe(2);
    expect(merged.targets[0].dependency).toBe(false);
  });
});

describe('importCounts', () => {
  const t = (id: string, marks: ('new' | 'collision')[], extra: object = {}) => ({
    id,
    dest: '.',
    dependency: false,
    files: marks.map((m, i) => ({ path: `${id}/f${i}`, size: 1, mark: m })),
    ...extra,
  });
  const plan = { targets: [t('a', ['new', 'new', 'new']), t('b', ['collision', 'new'])], already: ['c'] };
  it('counts only what is written; colliding and already-imported entries are skipped', () => {
    const c = importCounts(plan, { skipColliding: true });
    expect([c.entries, c.files, c.skippedTotal]).toEqual([1, 3, 2]);
    expect(c.skipped[0]).toMatchObject({ why: 'collision' });
    expect(c.already).toEqual(['c']);
  });
  it('without skipColliding every target is written', () => {
    const c = importCounts(plan);
    expect([c.entries, c.files, c.skippedTotal]).toEqual([2, 5, 1]);
  });
  it('a chosen skip drops the entry and what only it needs; extras are not double counted', () => {
    const p = { targets: [t('a', ['new']), t('d', ['new', 'new'], { requiredBy: 'a', dependency: true })], already: ['c'] };
    const c = importCounts(p, { skipped: new Set(['a']), alreadyExtra: ['c', 'e'] });
    expect([c.entries, c.files, c.skippedTotal]).toEqual([0, 0, 4]);
    expect(c.skipped.map((s) => s.why)).toEqual(['chosen', 'dependency']);
  });
});
