import { describe, expect, it } from 'vitest';
import type { JsonEntry } from './json';
import { crumbParts, resolveRoute, upRoute } from './browseData';
import { filterEntries, sortEntries } from './browseList';
import {
  expandFolder,
  folderChecked,
  folderImport,
  folderKey,
  folderSummary,
  foldersTouched,
  isFolderKey,
  libraryFolders,
  listRows,
  memberCountLabel,
  pickableMembers,
  rowIds,
  selectionLabel,
} from './folders';

const lib = (name: string, o: { extends?: string | null; default?: boolean } = {}) => ({ name, extends: o.extends ?? null, default: o.default ?? false });
const e = (id: string, o: Partial<JsonEntry> = {}): JsonEntry => ({
  id,
  kind: id.split('/')[0].replace(/s$/, ''),
  name: id.split('/').pop() as string,
  summary: '',
  status: 'stable',
  origin: 'custom',
  usage: 'copy',
  doc: '',
  tags: [],
  targets: [],
  committed: true,
  files: 1,
  bytes: 1,
  requires: [],
  related: [],
  ...o,
} as JsonEntry);

const entries = [
  e('components/base/card', { library: lib('base', { default: true }) }),
  e('components/base/avatar', { library: lib('base', { default: true }) }),
  e('components/dithercn/button', { library: lib('dithercn', { extends: 'base' }), committed: false }),
  e('components/dithercn/image', { library: lib('dithercn', { extends: 'base' }), committed: false }),
  e('components/solo/thing'),
  e('components/loose'),
  e('skills/a'),
];
const comps = entries.filter((x) => x.kind === 'component');

describe('folder rows from entries', () => {
  it('groups component libraries by name, sorted, with members in order given', () => {
    const f = libraryFolders(comps);
    expect(f.map((x) => x.name)).toEqual(['base', 'dithercn', 'solo']);
    expect(f[0].members.map((m) => m.name)).toEqual(['card', 'avatar']);
    expect(f.map((x) => x.members.length)).toEqual([2, 2, 1]);
  });
  it('carries only library facts as the summary', () => {
    const [base, dither, solo] = libraryFolders(comps);
    expect(folderSummary(base)).toBe('Default library');
    expect(folderSummary(dither)).toBe('Extends base');
    expect(folderSummary(solo)).toBe('');
  });
  it('lists folders then loose components at the root, flat entries otherwise', () => {
    const root = listRows(comps, true);
    expect(root.map((r) => r.key)).toEqual(['folder:base', 'folder:dithercn', 'folder:solo', 'components/loose']);
    expect(root.map((r) => r.kind)).toEqual(['folder', 'folder', 'folder', 'entry']);
    const flat = listRows(comps, false);
    expect(flat.every((r) => r.kind === 'entry')).toBe(true);
    expect(flat).toHaveLength(comps.length);
    expect(listRows([], true)).toEqual([]);
  });
  it('builds folders from the chip-filtered list, so counts match what imports', () => {
    const shown = filterEntries(sortEntries(comps, 'name'), new Set(['custom'] as const));
    expect(libraryFolders(shown).map((f) => f.members.length)).toEqual([2, 2, 1]);
    const experimental = filterEntries(comps, new Set(['experimental'] as const));
    expect(libraryFolders(experimental)).toEqual([]);
  });
  it('keys never collide with entry ids', () => {
    expect(folderKey('base')).toBe('folder:base');
    expect(isFolderKey('folder:base')).toBe(true);
    expect(isFolderKey('components/base/card')).toBe(false);
    expect(memberCountLabel(1)).toBe('1 component');
    expect(memberCountLabel(3)).toBe('3 components');
  });
});

describe('import all: expansion with skips', () => {
  const [base, dither] = libraryFolders(comps);
  it('expands to every member for the batch plan (which does the skipping)', () => {
    expect(expandFolder(base).map((m) => m.id)).toEqual(['components/base/card', 'components/base/avatar']);
  });
  it('counts ready members, skipping imported and uncommitted ones', () => {
    const r = folderImport(base.members, (id) => id === 'components/base/avatar');
    expect(r).toMatchObject({ state: 'import', ready: ['components/base/card'], already: 1, skipped: 0, reason: null });
    const mixed = folderImport([...base.members, e('components/base/x', { committed: false })], () => false);
    expect(mixed).toMatchObject({ state: 'import', skipped: 1 });
    expect(mixed.ready).toHaveLength(2);
  });
  it('says Imported when every importable member is in', () => {
    expect(folderImport(base.members, () => true).state).toBe('imported');
    // An uncommitted straggler does not block Imported.
    const r = folderImport([...base.members, e('components/base/x', { committed: false })], (id) => !id.endsWith('/x'));
    expect(r.state).toBe('imported');
  });
  it('disables with a reason when nothing is pickable', () => {
    const r = folderImport(dither.members, () => false);
    expect(r.state).toBe('none');
    expect(r.skipped).toBe(2);
    expect(r.reason).toMatch(/in the stack/i);
    expect(folderImport([], () => false).state).toBe('none');
  });
});

describe('selecting folders', () => {
  const [base, dither] = libraryFolders(comps);
  it('a folder means its pickable members only', () => {
    expect(pickableMembers(base)).toEqual(['components/base/card', 'components/base/avatar']);
    expect(pickableMembers(dither)).toEqual([]);
  });
  it('a folder row is selected only when all its pickable members are', () => {
    const all = new Set(['components/base/card', 'components/base/avatar']);
    expect(folderChecked(base, all)).toBe(true);
    expect(folderChecked(base, new Set(['components/base/card']))).toBe(false);
    expect(folderChecked(dither, new Set(['x']))).toBe(false);
  });
  it('rowIds expands a folder to its pickable members and an entry to itself when committed', () => {
    const rows = listRows(comps, true);
    const folder = rows.find((r) => r.kind === 'folder')!;
    expect(rowIds(folder)).toEqual(pickableMembers(base));
    expect(rowIds({ kind: 'entry', key: 'a', entry: { ...comps[0], committed: true } })).toEqual([comps[0].id]);
    expect(rowIds({ kind: 'entry', key: 'a', entry: { ...comps[0], committed: false } })).toEqual([]);
  });
  it('summarises members and the folders they sit in', () => {
    const f = libraryFolders(comps);
    const sel = new Set(pickableMembers(base));
    expect(foldersTouched(f, sel)).toBe(1);
    expect(selectionLabel(2, 1)).toBe('2 selected in 1 folder');
    expect(selectionLabel(5, 2)).toBe('5 selected in 2 folders');
    expect(selectionLabel(3, 0)).toBe('3 selected');
  });
});

describe('folder navigation', () => {
  it('goes up from a library to the components list, and nowhere from the root', () => {
    const open = resolveRoute(['browse', 'components', '@base'], entries);
    expect(upRoute(open)).toEqual({ kind: 'kind', kindSingular: 'component' });
    expect(upRoute({ kind: 'kind', kindSingular: 'component' })).toBeNull();
    expect(upRoute({ kind: 'home' })).toBeNull();
    expect(upRoute({ kind: 'entry', id: 'components/base/card', file: null })).toBeNull();
  });
  it('breadcrumbs name the kind (a link up) then the folder', () => {
    const parts = crumbParts({ kind: 'kind', kindSingular: 'component', library: 'base' }, false);
    expect(parts.map((p) => p.label)).toEqual(['stack', 'components', 'base']);
    expect(parts[1].target).toEqual({ to: 'kind', kindSingular: 'component' });
    expect(parts[2].target).toBeNull();
  });
  it('a library of loose id segments resolves; an unknown one stays missing', () => {
    expect(resolveRoute(['browse', 'components', '@solo'], entries)).toMatchObject({ kind: 'kind', library: 'solo' });
    expect(resolveRoute(['browse', 'components', '@nope'], entries)).toEqual({ kind: 'missing' });
  });
});
