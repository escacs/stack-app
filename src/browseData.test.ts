// Tests for the pure Browse helpers (src/browseData.ts): route resolution,
// breadcrumb parts, the catalog index (backlinks), and the fetch plumbing
// (concurrency limit, in-flight dedupe, skip-when-not-live, cache rules).
import { describe, expect, it } from 'vitest';
import {
  CATALOG_NAME,
  applyRange,
  buildIndex,
  byKindOrder,
  catalogs,
  clearCatalogs,
  clearPreviews,
  createFetchCache,
  createLimiter,
  crumbParts,
  pruneSelection,
  mayMoveFocusToImport,
  notImportedIds,
  previewCache,
  previewKey,
  rangeIds,
  refreshLine,
  resolveRoute,
  sameRoute,
  sourceKey,
  toggleSelected,
  type Route,
} from './browseData';
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

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('resolveRoute', () => {
  const entries = [
    entry({ id: 'skills/file-pr' }),
    entry({ id: 'components/react/button' }),
    entry({ id: 'components/react' }),
  ];

  it('home for an empty tail, all and kind views by name or plural', () => {
    expect(resolveRoute(['browse'], entries)).toEqual({ kind: 'home' });
    expect(resolveRoute(['browse', 'all'], entries)).toEqual({ kind: 'all' });
    expect(resolveRoute(['browse', 'presets'], entries)).toEqual({ kind: 'presets' });
    expect(resolveRoute(['browse', 'skills'], entries)).toEqual({ kind: 'kind', kindSingular: 'skill' });
    expect(resolveRoute(['browse', 'component'], entries)).toEqual({ kind: 'kind', kindSingular: 'component' });
  });

  it('the longest entry id wins, the rest is the file tail', () => {
    expect(resolveRoute(['browse', 'components', 'react', 'button'], entries)).toEqual({
      kind: 'entry',
      id: 'components/react/button',
      file: null,
    });
    expect(resolveRoute(['browse', 'components', 'react', 'button', 'src', 'x.tsx'], entries)).toEqual({
      kind: 'entry',
      id: 'components/react/button',
      file: 'src/x.tsx',
    });
    expect(resolveRoute(['browse', 'components', 'react'], entries)).toEqual({
      kind: 'entry',
      id: 'components/react',
      file: null,
    });
  });

  it('unknown ids and unknown kinds are missing, not a kind view', () => {
    expect(resolveRoute(['browse', 'nope'], entries)).toEqual({ kind: 'missing' });
    expect(resolveRoute(['browse', 'skills', 'nope'], entries)).toEqual({ kind: 'missing' });
    expect(resolveRoute(['browse', 'skills', 'nope'], [])).toEqual({ kind: 'missing' });
  });

  it('an empty catalog resolves ids to missing', () => {
    expect(resolveRoute(['browse', 'skills', 'file-pr'], [])).toEqual({ kind: 'missing' });
  });
});

describe('sameRoute', () => {
  it('compares by kind, id and file, so unchanged routes keep identity', () => {
    const a: Route = { kind: 'entry', id: 'skills/a', file: 'x.md' };
    expect(sameRoute(a, { kind: 'entry', id: 'skills/a', file: 'x.md' })).toBe(true);
    expect(sameRoute(a, { kind: 'entry', id: 'skills/a', file: null })).toBe(false);
    expect(sameRoute({ kind: 'kind', kindSingular: 'skill' }, { kind: 'kind', kindSingular: 'system' })).toBe(false);
    expect(sameRoute({ kind: 'home' }, { kind: 'home' })).toBe(true);
    expect(sameRoute({ kind: 'home' }, { kind: 'all' })).toBe(false);
  });
});

describe('crumbParts', () => {
  it('heads the trail with the catalog name', () => {
    expect(CATALOG_NAME).toBe('stack');
  });

  it('home is a single crumb; searching collapses to home', () => {
    expect(crumbParts({ kind: 'home' }, false)).toEqual([{ label: CATALOG_NAME, target: null }]);
    expect(crumbParts({ kind: 'all' }, true)).toEqual([{ label: CATALOG_NAME, target: { to: 'home' } }]);
  });

  it('kind and all trails carry no leading slash in their labels', () => {
    expect(crumbParts({ kind: 'kind', kindSingular: 'skill' }, false).map((p) => p.label)).toEqual([CATALOG_NAME, 'skills']);
    expect(crumbParts({ kind: 'all' }, false).map((p) => p.label)).toEqual([CATALOG_NAME, 'all']);
  });

  it('nested ids show their path below the kind, linked only when a file is open', () => {
    expect(crumbParts({ kind: 'entry', id: 'components/react/button', file: null }, false)).toEqual([
      { label: CATALOG_NAME, target: { to: 'home' } },
      { label: 'components', target: { to: 'kind', kindSingular: 'component' } },
      { label: 'react/button', target: null },
    ]);
    expect(crumbParts({ kind: 'entry', id: 'components/react/button', file: 'src/x.tsx' }, false)).toEqual([
      { label: CATALOG_NAME, target: { to: 'home' } },
      { label: 'components', target: { to: 'kind', kindSingular: 'component' } },
      { label: 'react/button', target: { to: 'entry', id: 'components/react/button' } },
      { label: 'x.tsx', target: null },
    ]);
  });

  it('two-segment ids use the id tail, not the display name', () => {
    expect(crumbParts({ kind: 'entry', id: 'skills/file-pr', file: null }, false)[2]).toEqual({
      label: 'file-pr',
      target: null,
    });
  });
});

describe('buildIndex', () => {
  it('indexes ids and backlinks in catalog order, once per citing entry', () => {
    const idx = buildIndex([
      entry({ id: 'skills/a', requires: ['skills/b'], related: ['skills/b'] }),
      entry({ id: 'skills/b' }),
      entry({ id: 'skills/c', related: ['skills/b'] }),
    ]);
    expect(idx.byId.get('skills/b')?.id).toBe('skills/b');
    expect(idx.citedBy.get('skills/b')).toEqual(['skills/a', 'skills/c']);
    expect(idx.citedBy.get('skills/a')).toBeUndefined();
  });

  it('is empty for an empty catalog', () => {
    const idx = buildIndex([]);
    expect(idx.byId.size).toBe(0);
    expect(idx.citedBy.size).toBe(0);
  });
});

describe('selection model', () => {
  it('toggles one id without touching the input set', () => {
    const prev = new Set(['a']);
    expect([...toggleSelected(prev, 'b')].sort()).toEqual(['a', 'b']);
    expect([...toggleSelected(prev, 'a')]).toEqual([]);
    expect([...prev]).toEqual(['a']);
  });

  it('ranges inclusively between anchor and focus, either direction', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, 'c', 'c')).toEqual(['c']);
  });

  it('a missing anchor or focus selects just the focus row, or nothing', () => {
    const order = ['a', 'b', 'c'];
    expect(rangeIds(order, null, 'b')).toEqual(['b']);
    expect(rangeIds(order, 'gone', 'b')).toEqual(['b']);
    expect(rangeIds(order, 'a', 'gone')).toEqual([]);
  });

  it('applies a range by replace, or by union when additive', () => {
    expect([...applyRange(new Set(['x']), ['a', 'b'], false)].sort()).toEqual(['a', 'b']);
    expect([...applyRange(new Set(['x']), ['a', 'b'], true)].sort()).toEqual(['a', 'b', 'x']);
  });

  it('`a` picks every not-imported row in list order, committed or not', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(notImportedIds(rows, new Set(['b']))).toEqual(['a', 'c']);
    expect(notImportedIds(rows, new Set())).toEqual(['a', 'b', 'c']);
  });
});

describe('byKindOrder', () => {
  it('sorts by KINDS order, stable within a kind', () => {
    const list = [
      entry({ id: 'systems/z', kind: 'system' }),
      entry({ id: 'skills/b', kind: 'skill' }),
      entry({ id: 'skills/a', kind: 'skill' }),
    ];
    expect([...list].sort(byKindOrder).map((e) => e.id)).toEqual(['skills/b', 'skills/a', 'systems/z']);
  });
});

describe('sourceKey and previewKey', () => {
  it('keys on project and stack checkout only', () => {
    const withWorker = { project: '/p', stackPath: '/s', worker: 'mel' };
    expect(sourceKey(withWorker)).toBe(sourceKey({ project: '/p', stackPath: '/s' }));
    expect(sourceKey({ project: '/p', stackPath: '/s' })).not.toBe(sourceKey({ project: '/q', stackPath: '/s' }));
    expect(sourceKey(null)).toBe(sourceKey({ project: null, stackPath: null }));
  });

  it('preview keys separate entry, file and source', () => {
    expect(previewKey('s', 'skills/a', 'x.png')).not.toBe(previewKey('s', 'skills/a', 'y.png'));
    expect(previewKey('s1', 'skills/a', 'x.png')).not.toBe(previewKey('s2', 'skills/a', 'x.png'));
  });
});

describe('clearCatalogs and refreshLine', () => {
  it('drops one source, or every source when omitted', () => {
    catalogs.set('a', { raw: 'a', entries: [], uncommitted: new Set() });
    catalogs.set('b', { raw: 'b', entries: [], uncommitted: new Set() });
    clearCatalogs('a');
    expect(catalogs.has('a')).toBe(false);
    expect(catalogs.has('b')).toBe(true);
    clearCatalogs();
    expect(catalogs.size).toBe(0);
  });

  it('clearing an unknown source is a no-op', () => {
    catalogs.set('a', { raw: 'a', entries: [], uncommitted: new Set() });
    clearCatalogs('nope');
    expect(catalogs.has('a')).toBe(true);
    clearCatalogs();
  });

  it('names the entry count, singular included', () => {
    expect(refreshLine(93)).toBe('refreshed · 93 entries');
    expect(refreshLine(1)).toBe('refreshed · 1 entry');
    expect(refreshLine(0)).toBe('refreshed · 0 entries');
  });
});

describe('createLimiter', () => {
  it('never runs more than the limit at once, FIFO', async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (n: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      order.push(n);
      await tick();
      await tick();
      active--;
      return n;
    };
    const got = await Promise.all([1, 2, 3, 4, 5].map((n) => run(task(n))));
    expect(got).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('a rejected task frees its slot', async () => {
    const run = createLimiter(1);
    const bad = run(async () => {
      throw new Error('boom');
    });
    await expect(bad).rejects.toThrow('boom');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('createFetchCache', () => {
  it('runs once per key, then serves from the cache', async () => {
    const cache = createFetchCache<string | null>(3);
    let calls = 0;
    const run = async () => {
      calls++;
      return 'data:x';
    };
    expect(await cache.load('k', run)).toBe('data:x');
    expect(await cache.load('k', run)).toBe('data:x');
    expect(calls).toBe(1);
    expect(cache.peek('k')).toBe('data:x');
    expect(cache.peek('other')).toBeUndefined();
  });

  it('shares one in-flight promise between concurrent callers', async () => {
    const cache = createFetchCache<string | null>(3);
    let calls = 0;
    const run = async () => {
      calls++;
      await tick();
      return null;
    };
    const [a, b] = await Promise.all([cache.load('k', run), cache.load('k', run)]);
    expect([a, b]).toEqual([null, null]);
    expect(calls).toBe(1);
  });

  it('caches null (no image) but not undefined (failed or skipped)', async () => {
    const cache = createFetchCache<string | null>(3);
    let calls = 0;
    await cache.load('none', async () => null);
    expect(cache.peek('none')).toBeNull();

    const failing = async () => {
      calls++;
      return undefined;
    };
    expect(await cache.load('bad', failing)).toBeUndefined();
    expect(await cache.load('bad', failing)).toBeUndefined();
    expect(calls).toBe(2);
    expect(cache.peek('bad')).toBeUndefined();
  });

  it('skips a task whose row went away before its turn, and does not cache the skip', async () => {
    const cache = createFetchCache<string | null>(1);
    let runs = 0;
    let alive = false;
    const slow = cache.load('busy', async () => {
      await tick();
      return 'a';
    });
    const queued = cache.load(
      'gone',
      async () => {
        runs++;
        return 'b';
      },
      () => alive,
    );
    expect(await queued).toBeUndefined();
    expect(runs).toBe(0);
    expect(await slow).toBe('a');
    alive = true;
    expect(await cache.load('gone', async () => 'b', () => alive)).toBe('b');
  });

  it('clear drops finished results, so the next load re-fetches', async () => {
    const cache = createFetchCache<string | null>(3);
    let calls = 0;
    const run = async () => {
      calls++;
      return 'v';
    };
    expect(await cache.load('k', run)).toBe('v');
    cache.clear();
    expect(cache.peek('k')).toBeUndefined();
    expect(await cache.load('k', run)).toBe('v');
    expect(calls).toBe(2);
  });

  it('clearPreviews empties the module-wide preview cache', async () => {
    await previewCache.load('k', async () => 'data:x');
    expect(previewCache.peek('k')).toBe('data:x');
    clearPreviews();
    expect(previewCache.peek('k')).toBeUndefined();
  });

  it('a live caller that joined a skipped fetch retries instead of coming back empty', async () => {
    const cache = createFetchCache<string | null>(1);
    let runs = 0;
    const busy = cache.load('busy', async () => {
      await tick();
      return 'a';
    }, () => true);
    const first = cache.load('k', async () => 'never', () => false);
    const joiner = cache.load('k', async () => {
      runs++;
      return 'retried';
    }, () => true);
    expect(await first).toBeUndefined();
    expect(await joiner).toBe('retried');
    expect(runs).toBe(1);
    expect(await busy).toBe('a');
  });
});

describe('mayMoveFocusToImport', () => {
  it('holds focus while typing in any text field', () => {
    expect(mayMoveFocusToImport({ tagName: 'INPUT', type: 'text' })).toBe(false);
    expect(mayMoveFocusToImport({ tagName: 'INPUT', type: 'search' })).toBe(false);
    expect(mayMoveFocusToImport({ tagName: 'INPUT' })).toBe(false);
    expect(mayMoveFocusToImport({ tagName: 'TEXTAREA' })).toBe(false);
    expect(mayMoveFocusToImport({ tagName: 'SELECT' })).toBe(false);
    expect(mayMoveFocusToImport({ tagName: 'DIV', isContentEditable: true })).toBe(false);
  });

  it('moves focus from body, list rows and buttons', () => {
    expect(mayMoveFocusToImport(null)).toBe(true);
    expect(mayMoveFocusToImport({ tagName: 'BODY' })).toBe(true);
    expect(mayMoveFocusToImport({ tagName: 'A' })).toBe(true);
    expect(mayMoveFocusToImport({ tagName: 'BUTTON' })).toBe(true);
    expect(mayMoveFocusToImport({ tagName: 'INPUT', type: 'checkbox' })).toBe(true);
  });
});

import { selectClick, type SelectState } from './browseData';

describe('list-style selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const none: SelectState = { selected: new Set(), anchor: null };
  const ids = (s: SelectState) => [...s.selected].sort();
  const plain = { shift: false, ctrl: false };
  const ctrl = { shift: false, ctrl: true };
  const shift = { shift: true, ctrl: false };
  const both = { shift: true, ctrl: true };

  it('a plain click (or an arrow with no modifier) selects only that row and anchors it', () => {
    const s = selectClick({ selected: new Set(['a', 'b']), anchor: 'b' }, order, 'b', 'd', plain);
    expect(ids(s)).toEqual(['d']);
    expect(s.anchor).toBe('d');
  });
  it('follow-focus walks the selection one row at a time', () => {
    let s = selectClick(none, order, null, 'a', plain);
    s = selectClick(s, order, 'a', 'b', plain);
    s = selectClick(s, order, 'b', 'c', plain);
    expect(ids(s)).toEqual(['c']);
    expect(s.anchor).toBe('c');
  });
  it('Ctrl-click toggles one row, keeps the rest and moves the anchor', () => {
    const s1 = selectClick(selectClick(none, order, null, 'a', plain), order, 'a', 'c', ctrl);
    expect(ids(s1)).toEqual(['a', 'c']);
    expect(s1.anchor).toBe('c');
    const s2 = selectClick(s1, order, 'c', 'a', ctrl);
    expect(ids(s2)).toEqual(['c']);
    expect(ids(selectClick(s2, order, 'a', 'c', ctrl))).toEqual([]);
  });
  it('Shift-click selects the inclusive range from the anchor, either way, replacing', () => {
    const a = selectClick(none, order, null, 'b', plain);
    const s = selectClick(a, order, 'b', 'e', shift);
    expect(ids(s)).toEqual(['b', 'c', 'd', 'e']);
    expect(s.anchor).toBe('b');
    expect(ids(selectClick(s, order, 'e', 'a', shift))).toEqual(['a', 'b']);
  });
  it('Shift with no anchor ranges from the cursor row', () => {
    expect(ids(selectClick(none, order, 'a', 'd', shift))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(selectClick(none, order, 'd', 'b', shift))).toEqual(['b', 'c', 'd']);
    expect(ids(selectClick(none, order, null, 'c', shift))).toEqual(['c']);
  });
  it('Shift+Arrow grows and shrinks the range around a fixed anchor', () => {
    let s = selectClick(none, order, null, 'b', plain);
    s = selectClick(s, order, 'b', 'c', shift);
    s = selectClick(s, order, 'c', 'd', shift);
    expect(ids(s)).toEqual(['b', 'c', 'd']);
    s = selectClick(s, order, 'd', 'c', shift);
    expect(ids(s)).toEqual(['b', 'c']);
    s = selectClick(s, order, 'c', 'a', shift);
    expect(ids(s)).toEqual(['a', 'b']);
  });
  it('Ctrl+Shift adds the range to the selection', () => {
    const base: SelectState = { selected: new Set(['a']), anchor: 'c' };
    expect(ids(selectClick(base, order, 'c', 'e', both))).toEqual(['a', 'c', 'd', 'e']);
    expect(ids(selectClick(base, order, 'c', 'e', shift))).toEqual(['c', 'd', 'e']);
  });
  it('a row with no ids (not in the stack) selects nothing and contributes nothing to a range', () => {
    const idsOf = (k: string) => (k === 'b' ? [] : [k]);
    expect(ids(selectClick(none, order, 'a', 'd', shift, idsOf))).toEqual(['a', 'c', 'd']);
    expect(ids(selectClick(none, order, 'a', 'b', ctrl, idsOf))).toEqual([]);
    expect(ids(selectClick({ selected: new Set(['a']), anchor: 'a' }, order, 'a', 'b', plain, idsOf))).toEqual([]);
  });
  it('ignores a row that is not listed', () => {
    expect(selectClick(none, order, 'a', 'zz', ctrl)).toBe(none);
  });
  it('a folder row stands for its members: plain replaces, Ctrl toggles all of them, a range spans them', () => {
    const rows = ['f:base', 'f:dither', 'x'];
    const idsOf = (k: string) => (k === 'f:base' ? ['c1', 'c2'] : k === 'f:dither' ? ['d1'] : [k]);
    const s1 = selectClick(none, rows, null, 'f:base', plain, idsOf);
    expect(ids(s1)).toEqual(['c1', 'c2']);
    const s2 = selectClick(s1, rows, 'f:base', 'x', ctrl, idsOf);
    expect(ids(s2)).toEqual(['c1', 'c2', 'x']);
    expect(ids(selectClick(s2, rows, 'x', 'f:base', ctrl, idsOf))).toEqual(['x']);
    expect(ids(selectClick(s1, rows, 'f:base', 'x', shift, idsOf))).toEqual(['c1', 'c2', 'd1', 'x']);
  });
});

describe('pruneSelection', () => {
  it('drops ids no longer listed and keeps the same set when nothing drops', () => {
    const s = new Set(['a', 'b', 'c']);
    expect([...pruneSelection(s, ['a', 'c', 'z'])].sort()).toEqual(['a', 'c']);
    expect(pruneSelection(s, ['a', 'b', 'c', 'd'])).toBe(s);
    expect(pruneSelection(s, []).size).toBe(0);
  });
});
