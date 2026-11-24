// Browse list logic (no DOM): filter chips, sort, match highlighting, and
// what a route selects. Tested in browseList.test.ts.
import type { JsonEntry } from './json';
import { libraryOf, type Route } from './browseData';
import { toneOf } from './vocab';

export type ChipKey = 'stable' | 'experimental' | 'custom';
export const CHIPS: { key: ChipKey; label: string }[] = [
  { key: 'stable', label: 'Stable' },
  { key: 'experimental', label: 'Experimental' },
  { key: 'custom', label: 'Custom' },
];

export type SortKey = 'name' | 'size' | 'status' | 'recent';
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'status', label: 'Status' },
  { key: 'recent', label: 'Recently imported' },
];

const STATUS_GROUP: ChipKey[] = ['stable', 'experimental'];

/**
 * Catalog facets only (Browse never filters by project state). The status
 * chips widen each other (stable OR experimental) and narrow Custom. No chip
 * lit means no filter.
 */
export function filterEntries(entries: readonly JsonEntry[], chips: ReadonlySet<ChipKey>): JsonEntry[] {
  if (!chips.size) return [...entries];
  const statuses = STATUS_GROUP.filter((k) => chips.has(k));
  return entries.filter((e) => {
    if (statuses.length && !statuses.includes(e.status as ChipKey)) return false;
    if (chips.has('custom') && e.origin !== 'custom') return false;
    return true;
  });
}

/** How many of `entries` each chip would show on its own (for the chip badges). */
export function chipCounts(entries: readonly JsonEntry[]): Record<ChipKey, number> {
  const out: Record<ChipKey, number> = { stable: 0, experimental: 0, custom: 0 };
  for (const e of entries) {
    if (e.status === 'stable') out.stable++;
    if (e.status === 'experimental') out.experimental++;
    if (e.origin === 'custom') out.custom++;
  }
  return out;
}

export function toggleChip(chips: ReadonlySet<ChipKey>, key: ChipKey): Set<ChipKey> {
  const next = new Set(chips);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

const STATUS_RANK: Record<string, number> = { stable: 0, experimental: 1, deprecated: 2 };

const byName = (a: JsonEntry, b: JsonEntry): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Sort a copy. `recent` puts entries imported in this app first, newest
 * first (`importedAt`: id → ms), then the rest by name; size is largest
 * first; status is stable, experimental, deprecated, then others.
 */
export function sortEntries(entries: readonly JsonEntry[], key: SortKey, importedAt: ReadonlyMap<string, number> = new Map()): JsonEntry[] {
  const list = [...entries];
  switch (key) {
    case 'size':
      return list.sort((a, b) => b.bytes - a.bytes || byName(a, b));
    case 'status':
      return list.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || byName(a, b));
    case 'recent':
      return list.sort((a, b) => (importedAt.get(b.id) ?? -1) - (importedAt.get(a.id) ?? -1) || byName(a, b));
    default:
      return list.sort(byName);
  }
}

export type RowStatus = { text: string; tone: 'error'; title: string };

/**
 * The ONE trailing mark a catalog row can show: the catalog problem "Not in
 * stack" (the entry is not committed, so import refuses it). Browse is a pure
 * catalog view: what is imported or out of date is the Project tab's business,
 * so no project state reaches the row. Experimental/deprecated ride the muted
 * kind text (see rowKindText).
 */
export function rowStatus(e: JsonEntry): RowStatus | null {
  if (!e.committed) return { text: 'Not in stack', tone: toneOf('Not in stack') as RowStatus['tone'], title: "Not in the stack's HEAD commit. Import refuses it until it is committed there." };
  return null;
}

/** Muted text after the name: the library or kind, plus a non-stable status. `stable` is never shown. */
export function rowKindText(e: JsonEntry, showKind: boolean, inLibrary = false): string {
  // A list scoped to one library already says which; the name would repeat on every row.
  const base = e.library?.name && !inLibrary ? e.library.name : e.library?.name ? '' : showKind ? e.kind : '';
  const st = e.status && e.status !== 'stable' ? e.status : '';
  return [base, st].filter(Boolean).join(' · ');
}

/** Plain label for the sort in effect. */
// ------------------------------------------------------------------ highlight

export type Range = [number, number];

/** Where the query's words occur in `text` (case-insensitive), merged and sorted. */
export function highlightRanges(query: string, text: string): Range[] {
  const toks = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!toks.length || !text) return [];
  const s = text.toLowerCase();
  const raw: Range[] = [];
  for (const t of toks) {
    for (let i = s.indexOf(t); i >= 0; i = s.indexOf(t, i + t.length)) raw.push([i, i + t.length]);
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Plain and marked runs of `text` for rendering `<mark>`. */
export function markSegments(text: string, ranges: readonly Range[]): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: text.slice(at, a), mark: false });
    out.push({ text: text.slice(a, b), mark: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out;
}

// ------------------------------------------------------------------ routes

export type RouteSelection = {
  /** Singular kind the list narrows to, or null for all. */
  kind: string | null;
  /** Component library folder the list narrows to (kind is `component`), or null. */
  library: string | null;
  /** Entry to put the cursor on and preview, if the route names one. */
  entryId: string | null;
  /** File open in the preview's Files tab, if the route names one. */
  file: string | null;
  /** A route that matches nothing (a stale link). */
  missing: boolean;
};

/**
 * What a browse route selects. A kind route narrows the list (the sidebar's
 * Catalog kinds); an entry route narrows to the entry's kind and selects it
 * (so a deep link shows the entry among its siblings); home and `all` show
 * everything with nothing chosen.
 */
export function routeSelection(r: Route, entries: readonly JsonEntry[]): RouteSelection {
  switch (r.kind) {
    case 'kind':
      return { kind: r.kindSingular, library: r.library ?? null, entryId: null, file: null, missing: false };
    case 'entry': {
      const e = entries.find((x) => x.id === r.id);
      return { kind: e?.kind ?? null, library: null, entryId: r.id, file: r.file, missing: !e };
    }
    case 'missing':
      return { kind: null, library: null, entryId: null, file: null, missing: true };
    default:
      return { kind: null, library: null, entryId: null, file: null, missing: false };
  }
}

/** Index of an entry in a list, or -1. */
export const indexOfEntry = (list: readonly JsonEntry[], id: string | null): number => (id ? list.findIndex((e) => e.id === id) : -1);

/** Narrow a catalog to one singular kind (null keeps all). */
export const inKind = (entries: readonly JsonEntry[], kind: string | null): JsonEntry[] => (kind ? entries.filter((e) => e.kind === kind) : [...entries]);

// ------------------------------------------------------------------ libraries

/** Narrow to one component library (null keeps all). */
export const inLibrary = (entries: readonly JsonEntry[], library: string | null): JsonEntry[] =>
  library ? entries.filter((e) => libraryOf(e) === library) : [...entries];

/** The component libraries of a catalog with their entry counts, by name. */
export function libraryGroups(entries: readonly JsonEntry[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const name = libraryOf(e);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Matches per component library (what the sidebar shows next to each library while a query is on). */
export function countByLibrary(matches: readonly JsonEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of matches) {
    const name = libraryOf(m);
    if (name) out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}

/** Matches outside the scope (the kind, and within it the library), for the empty state. */
export function matchesOutsideScope(matches: readonly JsonEntry[], kind: string | null, library: string | null): number {
  if (!kind) return 0;
  return matches.filter((m) => m.kind !== kind || (library !== null && libraryOf(m) !== library)).length;
}

// ------------------------------------------------------------------ search scope

/** What the search box says it searches: the whole catalog, or the kind in scope. */
export const searchPlaceholder = (pluralKind: string | null, library: string | null = null): string =>
  pluralKind ? `Search ${library ? `${library} ${pluralKind}` : pluralKind} (/)` : 'Search the catalog (/)';

/** Matches per singular kind (what the sidebar shows next to each kind while a query is on). */
export function countByKind(matches: readonly JsonEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of matches) out.set(m.kind, (out.get(m.kind) ?? 0) + 1);
  return out;
}

/** Matches outside the scoped kind (0 when nothing is scoped), for the empty state. */
export const matchesElsewhere = (counts: ReadonlyMap<string, number>, kind: string | null): number => {
  if (!kind) return 0;
  let n = 0;
  for (const [k, c] of counts) if (k !== kind) n += c;
  return n;
};

/** Esc in the search box: clear a non-empty field (keep focus), blur an empty one. */
export const searchEscape = (value: string): 'clear' | 'blur' => (value ? 'clear' : 'blur');
