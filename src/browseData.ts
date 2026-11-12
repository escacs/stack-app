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
  | { kind: 'kind'; kindSingular: string }
  | { kind: 'entry'; id: string; file: string | null }
  | { kind: 'missing' };

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
  if (rest.length === 1) {
    if (rest[0] === 'all') return { kind: 'all' };
    const k = KINDS.find((x) => x === rest[0] || pluralOf(x) === rest[0]);
    if (k) return { kind: 'kind', kindSingular: k };
  }
  return { kind: 'missing' };
}

/** Structural equality, so a memo keeps its identity when the route is unchanged. */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'kind') return a.kindSingular === (b as typeof a).kindSingular;
  if (a.kind === 'entry') {
    const o = b as typeof a;
    return a.id === o.id && a.file === o.file;
  }
  return true;
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

let watcher: IntersectionObserver | undefined;
const watched = new Map<Element, () => void>();

/**
 * Calls `cb` once, when `el` first comes within 200px of the viewport. One
 * shared observer serves every row. Returns a stop function for cleanup.
 */
export function whenVisible(el: Element, cb: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb();
    return () => {};
  }
  watcher ??= new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const fn = watched.get(en.target);
        if (!fn) continue;
        watched.delete(en.target);
        watcher?.unobserve(en.target);
        fn();
      }
    },
    { rootMargin: '200px' },
  );
  watched.set(el, cb);
  watcher.observe(el);
  return () => {
    watched.delete(el);
    watcher?.unobserve(el);
  };
}

/** Module-wide preview cache: data URLs (or null when the file has no image bytes). */
export const previewCache = createFetchCache<string | null>(3);

/** Empty the module-wide preview cache (row thumbnails, entry previews). */
export function clearPreviews(): void {
  previewCache.clear();
}
