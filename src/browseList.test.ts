import { describe, expect, it } from 'vitest';
import type { JsonEntry } from './json';
import {
  chipCounts,
  filterEntries,
  highlightRanges,
  indexOfEntry,
  inKind,
  markSegments,
  routeSelection,
  rowKindText,
  rowStatus,
  sortEntries,
  toggleChip,
  type ChipKey,
} from './browseList';
import { resolveRoute } from './browseData';

const e = (id: string, o: Partial<JsonEntry> = {}): JsonEntry => ({
  id,
  kind: id.split('/')[0].replace(/s$/, ''),
  name: id.split('/').pop() as string,
  summary: '',
  status: 'stable',
  origin: 'custom',
  usage: 'link',
  doc: '',
  tags: [],
  targets: [],
  committed: true,
  files: 1,
  bytes: 100,
  preview: null,
  ...o,
});

const catalog = [
  e('skills/zeta', { bytes: 500 }),
  e('skills/alpha', { status: 'experimental', bytes: 50 }),
  e('styles/mid', { origin: 'imported', bytes: 900 }),
  e('skills/old', { status: 'deprecated', bytes: 10 }),
];
const chips = (...k: ChipKey[]) => new Set<ChipKey>(k);

describe('filterEntries', () => {
  it('keeps everything with no chip', () => {
    expect(filterEntries(catalog, chips())).toHaveLength(4);
  });
  it('status chips widen each other', () => {
    expect(filterEntries(catalog, chips('stable', 'experimental')).map((x) => x.name)).toEqual(['zeta', 'alpha', 'mid']);
    expect(filterEntries(catalog, chips('experimental')).map((x) => x.name)).toEqual(['alpha']);
  });
  it('custom narrows by origin', () => {
    expect(filterEntries(catalog, chips('custom')).map((x) => x.name)).toEqual(['zeta', 'alpha', 'old']);
  });
  it('groups narrow one another', () => {
    expect(filterEntries(catalog, chips('stable', 'custom')).map((x) => x.name)).toEqual(['zeta']);
  });
  it('counts per chip', () => {
    expect(chipCounts(catalog)).toEqual({ stable: 2, experimental: 1, custom: 3 });
  });
  it('toggles without mutating', () => {
    const a = chips('stable');
    const b = toggleChip(a, 'custom');
    expect([...a]).toEqual(['stable']);
    expect([...b].sort()).toEqual(['custom', 'stable']);
    expect([...toggleChip(b, 'stable')]).toEqual(['custom']);
  });
});

describe('sortEntries', () => {
  it('sorts by name by default and does not mutate', () => {
    const copy = [...catalog];
    expect(sortEntries(catalog, 'name').map((x) => x.name)).toEqual(['alpha', 'mid', 'old', 'zeta']);
    expect(catalog).toEqual(copy);
  });
  it('sorts by size, largest first', () => {
    expect(sortEntries(catalog, 'size').map((x) => x.name)).toEqual(['mid', 'zeta', 'alpha', 'old']);
  });
  it('sorts by status rank then name', () => {
    expect(sortEntries(catalog, 'status').map((x) => x.name)).toEqual(['mid', 'zeta', 'alpha', 'old']);
  });
  it('puts recent imports first, newest first', () => {
    const at = new Map([['skills/old', 20], ['styles/mid', 10]]);
    expect(sortEntries(catalog, 'recent', at).map((x) => x.name)).toEqual(['old', 'mid', 'alpha', 'zeta']);
    expect(sortEntries(catalog, 'recent').map((x) => x.name)).toEqual(['alpha', 'mid', 'old', 'zeta']);
  });
});

describe('highlight', () => {
  it('finds each word, merged', () => {
    expect(highlightRanges('file pr', 'file-pr: File a PR')).toEqual([[0, 4], [5, 7], [9, 13], [16, 18]]);
    expect(highlightRanges('ab', 'xabab')).toEqual([[1, 5]]);
  });
  it('is empty with no query or no text', () => {
    expect(highlightRanges('', 'abc')).toEqual([]);
    expect(highlightRanges('!!', 'abc')).toEqual([]);
    expect(highlightRanges('a', '')).toEqual([]);
  });
  it('segments for <mark>', () => {
    expect(markSegments('hello world', [[0, 2], [6, 7]])).toEqual([
      { text: 'he', mark: true },
      { text: 'llo ', mark: false },
      { text: 'w', mark: true },
      { text: 'orld', mark: false },
    ]);
    expect(markSegments('abc', [])).toEqual([{ text: 'abc', mark: false }]);
  });
});

describe('rowStatus', () => {
  it('only the catalog blocker shows; project state never does', () => {
    expect(rowStatus(e('skills/x'))).toBeNull();
    expect(rowStatus(e('skills/x', { committed: false }))).toMatchObject({ text: 'Not in stack', tone: 'error' });
  });
  it('a non-stable status rides the kind text, not a badge', () => {
    const x = e('skills/x', { status: 'experimental' });
    expect(rowStatus(x)).toBeNull();
    expect(rowKindText(x, true)).toBe('skill · experimental');
  });
});

describe('rowKindText', () => {
  it('shows the library or kind, never a stable status', () => {
    expect(rowKindText(e('skills/x'), true)).toBe('skill');
    expect(rowKindText(e('skills/x'), false)).toBe('');
    expect(rowKindText(e('skills/x', { library: { name: 'react', extends: null, default: false } }), false)).toBe('react');
    expect(rowKindText(e('skills/x', { status: 'deprecated' }), true)).toBe('skill · deprecated');
  });
});

describe('routeSelection', () => {
  const all = [e('skills/file-pr'), e('components/react/button')];
  const sel = (segs: string[]) => routeSelection(resolveRoute(segs, all), all);
  it('home and all select nothing', () => {
    expect(sel(['browse'])).toEqual({ kind: null, library: null, entryId: null, file: null, missing: false });
    expect(sel(['browse', 'all'])).toEqual({ kind: null, library: null, entryId: null, file: null, missing: false });
  });
  it('a kind route narrows the list (sidebar Catalog kinds)', () => {
    expect(sel(['browse', 'skills'])).toMatchObject({ kind: 'skill', entryId: null });
    expect(sel(['browse', 'components'])).toMatchObject({ kind: 'component' });
  });
  it('a deep link selects the entry and its kind', () => {
    expect(sel(['browse', 'skills', 'file-pr'])).toEqual({ kind: 'skill', library: null, entryId: 'skills/file-pr', file: null, missing: false });
    expect(sel(['browse', 'components', 'react', 'button'])).toMatchObject({ kind: 'component', entryId: 'components/react/button' });
  });
  it('a deep link can open a file', () => {
    expect(sel(['browse', 'skills', 'file-pr', 'SKILL.md'])).toMatchObject({ entryId: 'skills/file-pr', file: 'SKILL.md' });
  });
  it('flags stale links', () => {
    expect(sel(['browse', 'nope'])).toMatchObject({ missing: true });
  });
  it('finds the cursor index', () => {
    expect(indexOfEntry(all, 'components/react/button')).toBe(1);
    expect(indexOfEntry(all, 'x')).toBe(-1);
    expect(indexOfEntry(all, null)).toBe(-1);
    expect(inKind(all, 'skill').map((x) => x.id)).toEqual(['skills/file-pr']);
    expect(inKind(all, null)).toHaveLength(2);
  });
});

import { countByKind, matchesElsewhere, searchEscape, searchPlaceholder } from './browseList';

describe('search scope helpers', () => {
  it('names what the box searches', () => {
    expect(searchPlaceholder(null)).toBe('Search the catalog (/)');
    expect(searchPlaceholder('skills')).toBe('Search skills (/)');
  });
  it('counts matches per kind and elsewhere', () => {
    const m = countByKind([e('skills/a'), e('skills/b'), e('styles/c')]);
    expect(m.get('skill')).toBe(2);
    expect(m.get('style')).toBe(1);
    expect(m.get('component')).toBeUndefined();
    expect(matchesElsewhere(m, 'skill')).toBe(1);
    expect(matchesElsewhere(m, null)).toBe(0);
  });
  it('Esc clears first, then blurs', () => {
    expect(searchEscape('zzz')).toBe('clear');
    expect(searchEscape('')).toBe('blur');
  });
});

import { countByLibrary, inLibrary, libraryGroups, matchesOutsideScope } from './browseList';
import { crumbParts, librarySeg, sameRoute } from './browseData';

describe('component libraries', () => {
  const lib = (name: string) => ({ name, extends: null, default: false });
  const comps = [
    e('components/base/avatar', { library: lib('base') }),
    e('components/base/card', { library: lib('base') }),
    e('components/dithercn/button', { library: lib('dithercn') }),
    e('components/loose/thing'),
    e('skills/a', { library: lib('base') }),
  ];
  const all = [...comps, e('skills/b')];

  it('groups component libraries by name with counts (components only)', () => {
    // A component outside a declared library still has its folder (second id segment).
    expect(libraryGroups(all)).toEqual([
      { name: 'base', count: 2 },
      { name: 'dithercn', count: 1 },
      { name: 'loose', count: 1 },
    ]);
    expect(libraryGroups([])).toEqual([]);
  });
  it('filters by library; null keeps all', () => {
    // Only components belong to a library folder, whatever other kinds declare.
    expect(inLibrary(all, 'base').map((x) => x.id)).toEqual(['components/base/avatar', 'components/base/card']);
    expect(inLibrary(inKind(all, 'component'), 'dithercn').map((x) => x.id)).toEqual(['components/dithercn/button']);
    expect(inLibrary(all, null)).toHaveLength(all.length);
  });
  it('counts matches per library and outside the scope', () => {
    const m = countByLibrary(all);
    expect(m.get('base')).toBe(2);
    expect(m.get('dithercn')).toBe(1);
    expect(matchesOutsideScope(all, 'component', 'base')).toBe(4);
    expect(matchesOutsideScope(all, 'component', null)).toBe(2);
    expect(matchesOutsideScope(all, null, null)).toBe(0);
  });
  it('parses the @library route without colliding with entry ids', () => {
    expect(librarySeg('base')).toBe('@base');
    expect(resolveRoute(['browse', 'components', '@base'], all)).toEqual({ kind: 'kind', kindSingular: 'component', library: 'base' });
    expect(resolveRoute(['browse', 'components', '@nope'], all)).toEqual({ kind: 'missing' });
    expect(resolveRoute(['browse', 'components', '@base'], [])).toEqual({ kind: 'kind', kindSingular: 'component', library: 'base' });
    expect(resolveRoute(['browse', 'components', 'base', 'avatar'], all)).toEqual({ kind: 'entry', id: 'components/base/avatar', file: null });
    expect(resolveRoute(['browse', 'components'], all)).toEqual({ kind: 'kind', kindSingular: 'component' });
    expect(resolveRoute(['browse', 'skills', '@base'], all)).toEqual({ kind: 'missing' });
  });
  it('selects the library through routeSelection and compares routes', () => {
    const r = resolveRoute(['browse', 'components', '@base'], all);
    expect(routeSelection(r, all)).toMatchObject({ kind: 'component', library: 'base', entryId: null, missing: false });
    expect(routeSelection({ kind: 'kind', kindSingular: 'component' }, all).library).toBeNull();
    expect(sameRoute(r, { kind: 'kind', kindSingular: 'component', library: 'base' })).toBe(true);
    expect(sameRoute(r, { kind: 'kind', kindSingular: 'component' })).toBe(false);
  });
  it('adds the library to the crumb trail', () => {
    expect(crumbParts({ kind: 'kind', kindSingular: 'component', library: 'base' }, false).map((p) => p.label)).toEqual(['stack', 'components', 'base']);
  });
  it('shows the library in row text only when the list is not scoped to one', () => {
    const x = e('components/base/avatar', { library: lib('base'), status: 'experimental' });
    expect(rowKindText(x, true)).toBe('base · experimental');
    expect(rowKindText(x, true, true)).toBe('experimental');
    expect(rowKindText(e('components/base/card', { library: lib('base') }), false, true)).toBe('');
  });
  it('names the library in the search placeholder', () => {
    expect(searchPlaceholder('components', 'base')).toBe('Search base components (/)');
    expect(searchPlaceholder('components')).toBe('Search components (/)');
  });
});
