// Tests for the pure website-port helpers (src/site.tsx): bars, search
// scoring, link resolution, kind rollups. The JSX renders (Markdown,
// FileTree, Legend) are covered by fixture screenshots instead.
import { describe, expect, it } from 'vitest';
import { barCells, groupComponents, kindAgg, libraryMeta, mdLink, mimeFor, scoreEntries } from './site';
import type { JsonEntry } from './json';

const entry = (o: Partial<JsonEntry> & { id: string }): JsonEntry => ({
  kind: 'skill',
  name: o.id.split('/').pop() ?? o.id,
  summary: '',
  status: 'stable',
  origin: 'custom',
  usage: 'link',
  doc: `${o.id}/SKILL.md`,
  tags: [],
  targets: [],
  committed: true,
  files: 1,
  bytes: 100,
  preview: null,
  ...o,
});

describe('barCells', () => {
  it('fills twenty cells, at least one when nonzero', () => {
    expect(barCells(10, 10)).toEqual({ on: 20, off: 0 });
    expect(barCells(0, 10)).toEqual({ on: 0, off: 20 });
    expect(barCells(5, 10)).toEqual({ on: 10, off: 10 });
    expect(barCells(1, 100)).toEqual({ on: 1, off: 19 });
    expect(barCells(0, 0)).toEqual({ on: 0, off: 20 });
  });
});

describe('scoreEntries', () => {
  const entries = [
    entry({ id: 'skills/file-pr', name: 'file-pr', summary: 'open a pull request', tags: ['github'] }),
    entry({ id: 'skills/leaving-pr-comments', name: 'leaving-pr-comments', summary: 'comment well' }),
    entry({ id: 'systems/b', name: 'b', summary: 'unrelatedPSK grading' }),
  ];

  it('weights name above tags above id above summary', () => {
    // "pr" hits names of both skills plus tags of the first.
    expect(scoreEntries(entries, 'pr').map((e) => e.id)).toEqual([
      'skills/file-pr',
      'skills/leaving-pr-comments',
    ]);
  });

  it('drops zero-score rows and returns all on empty query', () => {
    expect(scoreEntries(entries, 'zzz')).toEqual([]);
    expect(scoreEntries(entries, '')).toEqual(entries);
    expect(scoreEntries(entries, 'PSK')).toEqual([entries[2]]);
  });

  it('breaks ties by id', () => {
    const tied = [
      entry({ id: 'skills/b', name: 'same' }),
      entry({ id: 'skills/a', name: 'same' }),
    ];
    expect(scoreEntries(tied, 'same').map((e) => e.id)).toEqual(['skills/a', 'skills/b']);
  });
});

describe('mdLink', () => {
  const entries = [entry({ id: 'skills/a' }), entry({ id: 'templates/agents-md' })];

  it('passes external and anchor targets through', () => {
    expect(mdLink(entries, 'skills/a', 'SKILL.md', 'https://x.test/y')).toEqual({
      kind: 'external',
      url: 'https://x.test/y',
    });
    expect(mdLink(entries, 'skills/a', 'SKILL.md', '#frag')).toEqual({ kind: 'external', url: '#frag' });
  });

  it('refuses blocked schemes as plain text', () => {
    expect(mdLink(entries, 'skills/a', 'SKILL.md', 'javascript:alert(1)')).toEqual({ kind: 'none' });
    expect(mdLink(entries, 'skills/a', 'SKILL.md', '//evil.test/x')).toEqual({ kind: 'none' });
  });

  it('treats other relative paths as files under the current entry, like the web', () => {
    expect(mdLink(entries, 'skills/a', 'SKILL.md', 'nowhere/nothing')).toEqual({
      kind: 'entry',
      id: 'skills/a',
      file: 'nowhere/nothing',
    });
  });

  it('matches bare and ../-prefixed entry ids, splitting file tails', () => {
    expect(mdLink(entries, 'skills/a', 'SKILL.md', 'templates/agents-md')).toEqual({
      kind: 'entry',
      id: 'templates/agents-md',
      file: null,
    });
    expect(mdLink(entries, 'skills/a', 'SKILL.md', '../templates/agents-md')).toEqual({
      kind: 'entry',
      id: 'templates/agents-md',
      file: null,
    });
    expect(mdLink(entries, 'skills/a', 'SKILL.md', 'templates/agents-md/files/x')).toEqual({
      kind: 'entry',
      id: 'templates/agents-md',
      file: 'files/x',
    });
  });

  it('resolves relative files against the current doc dir', () => {
    expect(mdLink(entries, 'templates/agents-md', 'files/AGENTS.md', './config.json')).toEqual({
      kind: 'entry',
      id: 'templates/agents-md',
      file: 'files/config.json',
    });
    expect(mdLink(entries, 'templates/agents-md', 'files/AGENTS.md', '../README.md')).toEqual({
      kind: 'entry',
      id: 'templates/agents-md',
      file: 'README.md',
    });
  });
});

describe('mimeFor', () => {
  it('maps image extensions, svg included', () => {
    expect(mimeFor('a.png')).toBe('image/png');
    expect(mimeFor('a.JPG')).toBe('image/jpeg');
    expect(mimeFor('a.svg')).toBe('image/svg+xml');
    expect(mimeFor('a.txt')).toBe('application/octet-stream');
  });
});

describe('groupComponents', () => {
  const comp = (id: string, lib?: { name: string; extends: string | null; default: boolean }) =>
    entry({ id, kind: 'component', name: id.split('/').pop() ?? id, ...(lib ? { library: lib } : {}) });

  it('groups by library, default first, then by name', () => {
    const g = groupComponents([
      comp('components/z/a', { name: 'z', extends: 'base', default: false }),
      comp('components/base/a', { name: 'base', extends: null, default: true }),
      comp('components/a/x', { name: 'a', extends: null, default: false }),
    ]);
    expect(g.groups.map((x) => x.lib.name)).toEqual(['base', 'a', 'z']);
    expect(g.ungrouped).toEqual([]);
  });

  it('keeps catalog order inside each group', () => {
    const g = groupComponents([
      comp('components/base/b', { name: 'base', extends: null, default: true }),
      comp('components/base/a', { name: 'base', extends: null, default: true }),
    ]);
    expect(g.groups[0].members.map((m) => m.id)).toEqual([
      'components/base/b',
      'components/base/a',
    ]);
  });

  it('collects components without a library block as ungrouped', () => {
    const g = groupComponents([
      comp('components/base/a', { name: 'base', extends: null, default: true }),
      comp('components/stray/x'),
    ]);
    expect(g.groups).toHaveLength(1);
    expect(g.ungrouped.map((m) => m.id)).toEqual(['components/stray/x']);
  });

  it('returns no groups when nothing carries a block', () => {
    const g = groupComponents([comp('components/stray/x')]);
    expect(g.groups).toEqual([]);
    expect(g.ungrouped).toHaveLength(1);
  });
});

describe('libraryMeta', () => {
  it('joins the count with default/extends markers', () => {
    expect(libraryMeta({ name: 'base', extends: null, default: true }, 2)).toBe('2 members · default');
    expect(libraryMeta({ name: 'z', extends: 'base', default: false }, 1)).toBe('1 member · extends base');
    expect(libraryMeta({ name: 'a', extends: null, default: false }, 3)).toBe('3 members');
  });
});

describe('kindAgg', () => {
  it('rolls up per-kind counts, files and bytes with totals', () => {
    const agg = kindAgg([
      entry({ id: 'skills/a', files: 2, bytes: 100 }),
      entry({ id: 'skills/b', files: 3, bytes: 200 }),
      entry({ id: 'systems/c', kind: 'system', files: 1, bytes: 50 }),
    ]);
    expect(agg.stats.filter((s) => s.n > 0)).toEqual([
      { kind: 'skill', n: 2, files: 5, bytes: 300 },
      { kind: 'system', n: 1, files: 1, bytes: 50 },
    ]);
    expect(agg.stats).toHaveLength(8);
    expect([agg.total, agg.files, agg.bytes]).toEqual([3, 6, 350]);
  });
});
