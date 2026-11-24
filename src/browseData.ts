// Pure helpers for the Browse view: route resolution, breadcrumb parts, the
// catalog index, and the fetch plumbing that keeps list and preview reloads
// cheap (a concurrency limit, a result cache with in-flight dedupe, and a
// shared visibility watcher). No Solid and no bridge import, so node tests
// cover all of it.
import { KINDS, kindOf, pluralOf } from './parse';
import type { JsonEntry } from './json';

// ------------------------------------------------------------------ routes

/** Route shape inside #browse: [] home, [kind] kind view, [all], [id...], [id..., file...]. */
export type Route =
  | { kind: 'home' }
  | { kind: 'all' }
  | { kind: 'presets' }
  | { kind: 'kind'; kindSingular: string; library?: string }
  | { kind: 'entry'; id: string; file: string | null }
  | { kind: 'missing' };

/**
 * A library folder inside the components kind is routed as `components/@base`.
 * Entry ids never carry an `@` segment, so the form cannot collide with
 * `components/<library>/<name>`.
 */
export const LIBRARY_MARK = '@';

/** The route segment naming a component library. */
export const librarySeg = (name: string): string => `${LIBRARY_MARK}${name}`;

/**
 * The library folder a component lives in: its `library.name`, else the second
 * id segment of `components/<library>/<name>`. Null for anything else.
 */
export function libraryOf(e: Pick<JsonEntry, 'id' | 'kind' | 'library'>): string | null {
  if (e.kind !== 'component') return null;
  if (e.library?.name) return e.library.name;
  const segs = e.id.split('/');
  return segs.length >= 3 && segs[1] ? segs[1] : null;
}

/** Resolve browse sub-segments: longest entry-id prefix wins (web parse). */
export function resolveRoute(segs: string[], entries: JsonEntry[]): Route {
  const rest = segs.slice(1);
  if (!rest.length) return { kind: 'home' };
  for (let n = rest.length; n >= 1; n--) {
    const id = rest.slice(0, n).join('/');
    if (entries.some((e) => e.id === id)) {
      const tail = rest.slice(n).join('/');
      return { kind: 'entry', id, file: tail || null };
    }
  }
  if (rest.length === 2 && rest[0] === pluralOf('component') && rest[1].startsWith(LIBRARY_MARK) && rest[1].length > 1) {
    const library = rest[1].slice(1);
    // Before the catalog loads nothing can be checked; afterwards an unknown library is a stale link.
    if (!entries.length || entries.some((e) => libraryOf(e) === library)) return { kind: 'kind', kindSingular: 'component', library };
    return { kind: 'missing' };
  }
  if (rest.length === 1) {
    if (rest[0] === 'all') return { kind: 'all' };
    if (rest[0] === 'presets') return { kind: 'presets' };
    const k = KINDS.find((x) => x === rest[0] || pluralOf(x) === rest[0]);
    if (k) return { kind: 'kind', kindSingular: k };
  }
  return { kind: 'missing' };
}

/** Structural equality, so a memo keeps its identity when the route is unchanged. */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'kind') return a.kindSingular === (b as typeof a).kindSingular && a.library === (b as typeof a).library;
  if (a.kind === 'entry') {
    const o = b as typeof a;
    return a.id === o.id && a.file === o.file;
  }
  return true;
}

/** One level up from a library folder (the components list); null where there is no folder to leave. */
export function upRoute(r: Route): Route | null {
  return r.kind === 'kind' && r.library ? { kind: 'kind', kindSingular: r.kindSingular } : null;
}

export type CrumbTarget = { to: 'home' } | { to: 'kind'; kindSingular: string } | { to: 'entry'; id: string };
export type CrumbPart = { label: string; target: CrumbTarget | null };

/**
 * The one catalog Browse shows today: the stack checkout's entries. Kept as
 * a named constant — heads the crumb trail — so a second catalog later only
 * adds a picker where this name sits. No multi-catalog support yet.
 */
export const CATALOG_NAME = 'stack';

/**
 * Breadcrumb parts for the prompt line. The separator supplies the slash, so
 * labels carry none. The trail starts at the catalog name, then for an entry
 * its kind, the id tail below the kind (`react/button`), then the file, so
 * nested ids read like their path.
 */
export function crumbParts(r: Route, searching: boolean): CrumbPart[] {
  const home: CrumbPart = { label: CATALOG_NAME, target: searching || r.kind !== 'home' ? { to: 'home' } : null };
  if (searching || r.kind === 'home') return [home];
  if (r.kind === 'all') return [home, { label: 'all', target: null }];
  if (r.kind === 'presets') return [home, { label: 'presets', target: null }];
  if (r.kind === 'kind' && r.library) {
    return [home, { label: pluralOf(r.kindSingular), target: { to: 'kind', kindSingular: r.kindSingular } }, { label: r.library, target: null }];
  }
  if (r.kind === 'kind') return [home, { label: pluralOf(r.kindSingular), target: null }];
  if (r.kind === 'entry') {
    const kind = kindOf(r.id);
    const parts: CrumbPart[] = [
      home,
      { label: pluralOf(kind), target: { to: 'kind', kindSingular: kind } },
      { label: r.id.split('/').slice(1).join('/'), target: r.file ? { to: 'entry', id: r.id } : null },
    ];
    if (r.file) parts.push({ label: r.file.split('/').pop() ?? r.file, target: null });
    return parts;
  }
  return [home, { label: 'missing', target: null }];
}

// ------------------------------------------------------------------ catalog

export type CatalogIndex = {
  byId: Map<string, JsonEntry>;
  /** Entries whose requires/related cite the id, in catalog order. */
  citedBy: Map<string, string[]>;
};

/** One pass over the catalog: id lookup and backlinks, built once per list. */
export function buildIndex(entries: JsonEntry[]): CatalogIndex {
  const byId = new Map<string, JsonEntry>();
  const citedBy = new Map<string, string[]>();
  for (const e of entries) byId.set(e.id, e);
  for (const e of entries) {
    for (const target of new Set([...(e.requires ?? []), ...(e.related ?? [])])) {
      const list = citedBy.get(target);
      if (list) list.push(e.id);
      else citedBy.set(target, [e.id]);
    }
  }
  return { byId, citedBy };
}

/** Kind order used by the `all` list: KINDS order, stable within a kind. */
export function byKindOrder(a: JsonEntry, b: JsonEntry): number {
  return KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
}

// ------------------------------------------------------------------ cache keys

/** Which stack checkout and project a result belongs to. */
export function sourceKey(c: { project?: string | null; stackPath?: string | null } | null | undefined): string {
  return JSON.stringify([c?.project ?? '.', c?.stackPath ?? null]);
}

export function previewKey(source: string, id: string, file: string): string {
  return `${source}|${id}|${file}`;
}

/** Last list result per source, with the raw stdout so an unchanged refresh is a no-op. */
export type CatalogData = { raw: string; entries: JsonEntry[]; uncommitted: Set<string> };
export const catalogs = new Map<string, CatalogData>();

/**
 * Drop cached catalogs so the next load re-reads the checkout from
 * scratch: one source, or every source when omitted (a stack-side change
 * is visible under any project that points at the checkout).
 */
export function clearCatalogs(source?: string): void {
  if (source === undefined) catalogs.clear();
  else catalogs.delete(source);
}

/** Short dim result after a catalog refresh: `refreshed · 93 entries`. */
export function refreshLine(count: number): string {
  return `refreshed · ${count} ${count === 1 ? 'entry' : 'entries'}`;
}

// ------------------------------------------------------------------ fetch plumbing

/** Runs tasks at most `limit` at a time, FIFO. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const pump = (): void => {
    while (active < limit && waiting.length) {
      const go = waiting.shift() as () => void;
      go();
    }
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        active++;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
  };
}

/**
 * Keyed result cache for bridge fetches. Concurrent callers share one in-flight
 * promise; a finished result stays for the session. `run` returning undefined
 * means "failed or skipped": nothing is cached, so the next caller retries.
 * `live` is checked when the task starts, so rows scrolled past before their
 * turn never spend a fetch.
 */
export function createFetchCache<V>(limit: number) {
  const schedule = createLimiter(limit);
  const done = new Map<string, V>();
  const pending = new Map<string, Promise<V | undefined>>();
  const load = (key: string, run: () => Promise<V | undefined>, live: () => boolean): Promise<V | undefined> => {
    if (done.has(key)) return Promise.resolve(done.get(key));
    const hit = pending.get(key);
    // Joining a shared fetch that was skipped (its first caller went away)
    // would leave this caller empty-handed, so a live joiner retries.
    if (hit) return hit.then((v) => (v === undefined && live() ? load(key, run, live) : v));
    const p = schedule(async () => {
      if (!live()) return undefined;
      const v = await run();
      if (v !== undefined) done.set(key, v);
      return v;
    }).finally(() => {
      pending.delete(key);
    });
    pending.set(key, p);
    return p;
  };
  return {
    peek(key: string): V | undefined {
      return done.get(key);
    },
    load: (key: string, run: () => Promise<V | undefined>, live: () => boolean = () => true) =>
      load(key, run, live),
    /**
     * Drop finished results so the next load re-fetches. In-flight
     * fetches are left alone: they already read the live checkout and
     * land fresh when they resolve.
     */
    clear(): void {
      done.clear();
    },
  };
}

/** Module-wide preview cache: data URLs (or null when the file has no image bytes). */
export const previewCache = createFetchCache<string | null>(3);

/** Empty the module-wide preview cache (row thumbnails, entry previews). */
export function clearPreviews(): void {
  previewCache.clear();
}

// ------------------------------------------------------------------ selection

/**
 * Toggle one id in a selection. Returns a new set; the input is untouched,
 * so a Solid signal holding it sees a changed reference.
 */
export function toggleSelected(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Inclusive id range between anchor and focus in list order, either
 * direction. A missing anchor (or one no longer listed) selects just the
 * focus row; an unlisted focus selects nothing.
 */
export function rangeIds(ordered: string[], anchor: string | null, focus: string): string[] {
  const f = ordered.indexOf(focus);
  if (f < 0) return [];
  const a = anchor === null ? -1 : ordered.indexOf(anchor);
  if (a < 0) return [focus];
  const [lo, hi] = a <= f ? [a, f] : [f, a];
  return ordered.slice(lo, hi + 1);
}

/**
 * Apply a range to a selection: replace it, or union when additive (Ctrl
 * held). Returns a new set.
 */
export function applyRange(prev: Set<string>, range: string[], additive: boolean): Set<string> {
  const next = additive ? new Set(prev) : new Set<string>();
  for (const id of range) next.add(id);
  return next;
}

export type SelectMods = { shift: boolean; ctrl: boolean };
export type SelectState = { selected: Set<string>; anchor: string | null };

/**
 * Select by row, the way file lists and mail lists do. `order` is the list's
 * row keys in view order; `idsOf` maps a row to the ids it stands for (an
 * entry is itself, a folder is its pickable members, an unpickable row is
 * nothing). `selected` holds ids; `anchor` is a row key.
 *  - plain: select only this row (replace). Arrow keys use it too, so the
 *    selection follows the cursor like Finder;
 *  - Ctrl/Cmd: toggle this row, keep the rest; it becomes the anchor;
 *  - Shift: the inclusive range anchor..row replaces the selection (the
 *    cursor row is the anchor when there is none); the anchor stays put;
 *  - Ctrl+Shift: that range is added to the selection.
 */
export function selectClick(
  prev: SelectState,
  order: readonly string[],
  cursor: string | null,
  key: string,
  mods: SelectMods,
  idsOf: (key: string) => string[] = (k) => [k],
): SelectState {
  if (!order.includes(key)) return prev;
  if (mods.shift) {
    const from = prev.anchor !== null && order.includes(prev.anchor) ? prev.anchor : cursor !== null && order.includes(cursor) ? cursor : key;
    const range = rangeIds([...order], from, key).flatMap(idsOf);
    return { selected: applyRange(prev.selected, range, mods.ctrl), anchor: from };
  }
  const own = idsOf(key);
  if (mods.ctrl) {
    const next = new Set(prev.selected);
    const on = own.length > 0 && own.every((id) => next.has(id));
    for (const id of own) {
      if (on) next.delete(id);
      else next.add(id);
    }
    return { selected: next, anchor: key };
  }
  return { selected: new Set(own), anchor: key };
}

/** Keep only the ids still listed (a sort, chip or refresh dropped the rest). Same set back when nothing drops. */
export function pruneSelection(selected: Set<string>, listed: Iterable<string>): Set<string> {
  const keep = new Set(listed);
  let drop = false;
  for (const id of selected) if (!keep.has(id)) drop = true;
  return drop ? new Set([...selected].filter((id) => keep.has(id))) : selected;
}

/**
 * Ids the `a` key selects: every listed row not imported yet, in list
 * order. Not-committed rows stay selectable: the batch plan skips them with
 * a count instead of refusing one by one.
 */
export function notImportedIds(entries: Pick<JsonEntry, 'id'>[], imported: Set<string>): string[] {
  return entries.filter((e) => !imported.has(e.id)).map((e) => e.id);
}

/** The focused-element facts the confirm focus rule needs (structural, so unit-testable). */
export type FocusCandidate = {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
};

/**
 * Whether the batch confirm may move focus to [import] once actionable.
 * Never while the user is typing in a text field (search, an inline `to:`
 * ask, the confirm's own base field): stealing focus mid-typing drops
 * keystrokes. Body, list rows and buttons stay fair game, so keyboard
 * users still land on the actionable button.
 */
export function mayMoveFocusToImport(active: FocusCandidate | null): boolean {
  if (!active) return true;
  if (active.isContentEditable) return false;
  const tag = active.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (tag === 'INPUT') {
    // Button-like inputs take no text; every other type (text, search, …) does.
    return ['BUTTON', 'SUBMIT', 'RESET', 'CHECKBOX', 'RADIO', 'FILE', 'RANGE', 'COLOR', 'HIDDEN', 'IMAGE'].includes(
      (active.type ?? 'text').toUpperCase(),
    );
  }
  return true;
}
