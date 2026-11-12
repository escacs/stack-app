// Tests for the pure Browse helpers (src/browseData.ts): route resolution,
// breadcrumb parts, the catalog index (backlinks), and the fetch plumbing
// (concurrency limit, in-flight dedupe, skip-when-not-live, cache rules).
import { describe, expect, it } from 'vitest';
import {
  CATALOG_NAME,
  applyRange,
  buildIndex,
  byKindOrder,
  createFetchCache,
  createLimiter,
  crumbParts,
  dragPassed,
  mayMoveFocusToImport,
  notImportedIds,
  previewKey,
  rangeIds,
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

describe('dragPassed', () => {
  it('ignores a stationary cursor (the bar-shift synthetic enter), accepts a real drag', () => {
    expect(dragPassed(100, 200, 100, 200)).toBe(false);
    expect(dragPassed(100, 200, 102, 203)).toBe(false);
    expect(dragPassed(100, 200, 100, 205)).toBe(true);
    expect(dragPassed(100, 200, 100, 220)).toBe(true);
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
