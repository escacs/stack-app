// Component libraries as folders (no DOM). Browse lists Components like a file
// explorer: at the root each library is a folder row; Open drills into it and
// shows its members as the normal entry rows. Import all expands a folder to
// its member ids client-side (the CLI cannot import a library by id yet) and
// runs the same batch import as the selection. Tested in folders.test.ts.
import type { JsonEntry } from './json';
import { libraryOf } from './browseData';

export type Folder = {
  name: string;
  /** Members in the order given (the list is already sorted/filtered). */
  members: JsonEntry[];
  /** Library facts the catalog really carries (no README text is available). */
  extends: string | null;
  isDefault: boolean;
};

export type ListRow = { kind: 'folder'; key: string; folder: Folder } | { kind: 'entry'; key: string; entry: JsonEntry };

/** Cursor key of a folder row; entry ids never start with `folder:`. */
export const folderKey = (name: string): string => `folder:${name}`;
export const isFolderKey = (key: string): boolean => key.startsWith('folder:');

/** Folders of the component entries given, by name; each lists its members. Loose components are not folders. */
export function libraryFolders(entries: readonly JsonEntry[]): Folder[] {
  const by = new Map<string, Folder>();
  for (const e of entries) {
    const name = libraryOf(e);
    if (!name) continue;
    let f = by.get(name);
    if (!f) {
      f = { name, members: [], extends: null, isDefault: false };
      by.set(name, f);
    }
    f.members.push(e);
    if (e.library?.name === name) {
      f.extends ??= e.library.extends;
      f.isDefault ||= e.library.default;
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The one quiet line a folder carries beyond its count, from library data only. */
export function folderSummary(f: Pick<Folder, 'extends' | 'isDefault'>): string {
  if (f.extends) return `Extends ${f.extends}`;
  return f.isDefault ? 'Default library' : '';
}

export const memberCountLabel = (n: number): string => `${n} ${n === 1 ? 'component' : 'components'}`;

/**
 * The rows of the list. With `folders` on (Components, no search) every
 * library is a folder row, followed by components that live in no library;
 * otherwise every entry is a plain row.
 */
export function listRows(entries: readonly JsonEntry[], folders: boolean): ListRow[] {
  if (!folders) return entries.map((entry) => ({ kind: 'entry', key: entry.id, entry }));
  const loose = entries.filter((e) => !libraryOf(e));
  return [
    ...libraryFolders(entries).map((folder): ListRow => ({ kind: 'folder', key: folderKey(folder.name), folder })),
    ...loose.map((entry): ListRow => ({ kind: 'entry', key: entry.id, entry })),
  ];
}

export type FolderImport = {
  /** `import`: Import all N; `imported`: every importable member is in; `none`: nothing can be imported. */
  state: 'import' | 'imported' | 'none';
  /** Members an import would bring in (committed, not imported yet). */
  ready: string[];
  already: number;
  /** Not committed in the stack: the plan skips them. */
  skipped: number;
  /** Why Import all is off, for its tooltip. */
  reason: string | null;
};

/** What Import all would do for a folder's members, given which ids are imported. */
export function folderImport(members: readonly JsonEntry[], isImported: (id: string) => boolean): FolderImport {
  const ready: string[] = [];
  let already = 0;
  let skipped = 0;
  for (const m of members) {
    if (isImported(m.id)) already++;
    else if (!m.committed) skipped++;
    else ready.push(m.id);
  }
  if (ready.length) return { state: 'import', ready, already, skipped, reason: null };
  if (already) return { state: 'imported', ready, already, skipped, reason: 'Every component in it is already imported' };
  return { state: 'none', ready, already, skipped, reason: 'None of its components are in the stack yet, so none can be imported' };
}

/** The id list a folder import runs on: every member (the plan skips imported and uncommitted ones and says how many). */
export const expandFolder = (f: Pick<Folder, 'members'>): JsonEntry[] => [...f.members];

/** Members a selection can hold (committed in the stack). */
export const pickableMembers = (f: Pick<Folder, 'members'>): string[] => f.members.filter((m) => m.committed !== false).map((m) => m.id);

/** The ids a list row stands for in a selection: an entry itself (when committed), a folder its pickable members. */
export const rowIds = (r: ListRow): string[] => (r.kind === 'folder' ? pickableMembers(r.folder) : r.entry.committed !== false ? [r.entry.id] : []);

/** A folder row is selected when it has pickable members and all of them are selected. */
export function folderChecked(f: Pick<Folder, 'members'>, selected: ReadonlySet<string>): boolean {
  const ids = pickableMembers(f);
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/** How many folders hold at least one selected member. */
export const foldersTouched = (folders: readonly Pick<Folder, 'members'>[], selected: ReadonlySet<string>): number =>
  folders.filter((f) => f.members.some((m) => selected.has(m.id))).length;

/** The selection line: members counted, with the folders they sit in when folders are listed. */
export function selectionLabel(count: number, folders: number): string {
  return folders > 0 ? `${count} selected in ${folders} ${folders === 1 ? 'folder' : 'folders'}` : `${count} selected`;
}
