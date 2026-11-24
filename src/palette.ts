// Command palette logic (no DOM): fuzzy match with highlight ranges, ranking,
// grouping. Tested in palette.test.ts.
import { isLive } from './actions';

export type Range = [start: number, end: number];

export type Match = { score: number; ranges: Range[] };

const isBoundary = (ch: string | undefined): boolean => ch === undefined || /[\s/\-_.:·→]/.test(ch);

/** Merge touching ranges. */
function merge(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Match one term against text (case-insensitive). A plain substring beats a
 * scattered subsequence; word starts and a prefix score higher. Null when the
 * term's letters do not appear in order.
 */
export function fuzzyTerm(term: string, text: string, substringOnly = false): Match | null {
  const t = term.toLowerCase();
  const s = text.toLowerCase();
  if (!t) return { score: 0, ranges: [] };
  // Best substring occurrence: prefer a word start, then the earliest.
  let at = -1;
  for (let i = s.indexOf(t); i >= 0; i = s.indexOf(t, i + 1)) {
    if (isBoundary(s[i - 1])) {
      at = i;
      break;
    }
    if (at < 0) at = i;
  }
  if (at >= 0) {
    const boundary = isBoundary(s[at - 1]);
    const score = 20 + t.length * 3 + (at === 0 ? 12 : boundary ? 8 : 0) - Math.min(at, 10) * 0.2;
    return { score, ranges: [[at, at + t.length]] };
  }
  if (substringOnly) return null;
  // Subsequence, preferring word starts.
  const ranges: Range[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of t) {
    let found = -1;
    // First prefer a word-start hit ahead, else the next occurrence.
    for (let i = from; i < s.length; i++) {
      if (s[i] !== ch) continue;
      if (found < 0) found = i;
      if (isBoundary(s[i - 1]) || i === prev + 1) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    score += 1 + (found === prev + 1 ? 2 : 0) + (isBoundary(s[found - 1]) ? 3 : 0) - Math.min(found - from, 6) * 0.1;
    ranges.push([found, found + 1]);
    prev = found;
    from = found + 1;
  }
  return { score, ranges: merge(ranges) };
}

/** Whitespace-separated terms must all match; scores add, ranges merge. */
export function fuzzy(query: string, text: string, substringOnly = false): Match | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, ranges: [] };
  let score = 0;
  const ranges: Range[] = [];
  for (const term of terms) {
    const m = fuzzyTerm(term, text, substringOnly);
    if (!m) return null;
    score += m.score;
    ranges.push(...m.ranges);
  }
  return { score, ranges: merge(ranges.sort((a, b) => a[0] - b[0])) };
}

export type Rankable = {
  id: string;
  title: string;
  group: string;
  /** Extra words that find the command but are not shown or highlighted. */
  keywords?: string;
  /** Why the command cannot run now; null when it can. */
  disabled?: string | null;
  /**
   * Too numerous to list up front (one per worktree): the command appears only
   * while a query is being typed, and only when that query matches it.
   */
  onlyWhenSearching?: boolean;
  /**
   * A row that is a thing to open rather than a thing to run (a catalog entry,
   * a tracked import). It matches letters scattered through its name, and on an
   * equal match it outranks a command that only matched a hidden keyword.
   */
  result?: boolean;
  /** The kind beside the row (`skill`), for the view to show as a subtitle. */
  hint?: string;
};

export type Ranked<T extends Rankable> = { item: T; score: number; ranges: Range[] };

/** Score drop for a command that cannot run now: it still shows, below equal matches. */
const DISABLED_PENALTY = 6;

/**
 * Score bonus for a result (an entry, an import) that only matched a hidden
 * word: a query that lands on what the row *is* beats one that lands on a
 * command's synonym list.
 */
const RESULT_BONUS = 6;

/**
 * How well a query names a title, used as the first sort key so a real match
 * always beats a lucky one:
 *   3 — the whole title, `pony` for `pony`;
 *   2 — starts a word in it, `brow` for `Go to Browse`;
 *   1 — anywhere else, `ort` for `Import entry`.
 */
export function titleQuality(query: string, text: string): 1 | 2 | 3 {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const s = text.toLowerCase().replace(/\s+/g, ' ');
  if (!q) return 1;
  if (s === q) return 3;
  for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + 1)) {
    if (isBoundary(s[i - 1])) return 2;
  }
  return 1;
}

/** How a ranking decides a page action is in scope; defaults to the actions registry. */
export type RankOptions = {
  /** Whether the id can be offered now (a page action: is its page the current route?). */
  live?: (id: string) => boolean;
  /** Rows to keep per group; defaults to `GROUP_CAP` (a group absent from it is uncapped). */
  cap?: Readonly<Record<string, number>>;
};

/** At most this many rows of one result group (see `GROUP_CAP`). */
export const ENTRY_CAP = 8;

/** The catalog-entry group and the tracked-import group. */
export const CATALOG_GROUP = 'Catalog';
export const IMPORTS_GROUP = 'Imports';

/**
 * A result group keeps its best `ENTRY_CAP` rows: past eight, the palette stops
 * being a shortcut and becomes a worse Browse list.
 */
export const GROUP_CAP: Readonly<Record<string, number>> = { [CATALOG_GROUP]: ENTRY_CAP, [IMPORTS_GROUP]: ENTRY_CAP };

/**
 * The only commands the palette lists while they cannot run: the ways to leave
 * a screen with no project open. Their reason ("Open a project first") is the
 * whole point of the row — with nothing to navigate there is nothing to do.
 * Every other command that cannot run now is hidden, not dimmed: a row the
 * user cannot pick, with a line of explanation they did not ask for, is noise.
 */
export const SHOWS_WHEN_DISABLED: ReadonlySet<string> = new Set(['go-project', 'go-browse', 'go-presets']);

/**
 * Superseded by `SHOWS_WHEN_DISABLED` (inverted): no disabled command is ever
 * listed now, so "nothing to act on" needs no list of its own. Kept exported
 * because the palette tests and older callers still name it.
 */
export const EMPTY_ACTIONS: ReadonlySet<string> = new Set(['focus-toasts']);

/**
 * Whether the palette draws this command at all, before any matching: it must
 * be live, it must be able to run (or be one of the few that says why not), and
 * a `onlyWhenSearching` command needs a query to be listed.
 */
export function isListed(item: Rankable, query = ''): boolean {
  if (item.onlyWhenSearching && !query.trim()) return false;
  if (item.disabled) return SHOWS_WHEN_DISABLED.has(item.id);
  return true;
}

/**
 * Filter and order commands for a query. No query keeps the given order.
 * A title match highlights; a hit only in the group name or keywords still
 * lists the command (lower) without highlight. Ties keep the given order.
 *
 * A command matches on a whole word of its title or on a deliberate keyword,
 * never on letters scattered through it: `pony` used to reach `Import entry`
 * through a subsequence match, and Enter then ran the wrong thing. A row marked
 * `result` (a catalog entry, a tracked import) may still match scattered
 * letters, because its name is the thing being searched; on an equal match a
 * result outranks a command that only matched a hidden word.
 *
 * A command that cannot run now is not offered at all, with one exception: the
 * "Go to …" navigation rows stay listed while no project is open, because the
 * reason beside them is the answer to "why can I not go anywhere?". A page
 * command whose route is not current is dropped too, not dimmed: pressing
 * "Clear Browse filters" from the Project page is not a thing the palette
 * should offer at all. A command marked `onlyWhenSearching` (one per worktree,
 * one per catalog entry) appears only while a query is typed and matches it.
 */
export function rankCommands<T extends Rankable>(items: readonly T[], query: string, opts: RankOptions = {}): Ranked<T>[] {
  const live = opts.live ?? isLive;
  const q = query.trim();
  const here = items.filter((item) => live(item.id) && isListed(item, q));
  if (!q) return here.map((item) => ({ item, score: 0, ranges: [] }));
  const caps = opts.cap ?? GROUP_CAP;
  const out: (Ranked<T> & { i: number; tier: number })[] = [];
  here.forEach((item, i) => {
    const title = fuzzy(q, item.title, !item.result);
    let tier: number;
    let m: Match | null = title;
    let ranges = title?.ranges ?? [];
    if (m) tier = titleQuality(q, item.title);
    else {
      // Hidden words must match as whole substrings: a scattered subsequence over that much text matches nearly anything.
      m = fuzzy(q, `${item.group} ${item.title} ${item.keywords ?? ''}`, true);
      if (m) m = { score: m.score - 8, ranges: [] };
      ranges = [];
      tier = 1;
    }
    if (!m) return;
    const bonus = item.result && tier < 2 ? RESULT_BONUS : 0;
    out.push({ item, score: m.score - (item.disabled ? DISABLED_PENALTY : 0) + bonus, ranges, i, tier });
  });
  out.sort((a, b) => b.tier - a.tier || b.score - a.score || a.i - b.i);
  // One group keeps at most its cap: a query listing every matching entry is a
  // search, and a search is what Browse is for.
  const kept: (Ranked<T> & { i: number; tier: number })[] = [];
  const counts = new Map<string, number>();
  for (const r of out) {
    const cap = caps[r.item.group];
    if (cap !== undefined) {
      const n = counts.get(r.item.group) ?? 0;
      if (n >= cap) continue;
      counts.set(r.item.group, n + 1);
    }
    kept.push(r);
  }
  return kept.map(({ item, score, ranges }) => ({ item, score, ranges }));
}


export type Group<T extends Rankable> = { group: string; entries: Ranked<T>[] };

/**
 * The group slots, in the order they are drawn: what the query found first
 * (a catalog entry, a tracked import), then ways out of the screen, then what
 * the open page offers, then workspace-level switches, then the app's own
 * settings. A fixed order (rather than "whichever group matched best") keeps
 * the list in one recognizable place while typing, so a row is where the eye
 * last saw it and the first ten rows stay stable — and so a query that names an
 * entry puts that entry first, where Enter will land on it.
 */
export const GROUP_ORDER: readonly string[] = [CATALOG_GROUP, IMPORTS_GROUP, 'Navigate', 'Entry', 'Project', 'Workspace', 'App'];

/** A group's slot; an unknown group follows the known ones. */
const slotOf = (group: string): number => {
  const i = GROUP_ORDER.indexOf(group);
  return i < 0 ? GROUP_ORDER.length : i;
};

/** Bucket ranked commands by group; groups are drawn in `GROUP_ORDER`, entries keep their rank. */
export function groupRanked<T extends Rankable>(ranked: readonly Ranked<T>[]): Group<T>[] {
  const groups: Group<T>[] = [];
  for (const r of ranked) {
    let g = groups.find((x) => x.group === r.item.group);
    if (!g) groups.push((g = { group: r.item.group, entries: [] }));
    g.entries.push(r);
  }
  // Stable: same slot keeps first-appearance order (two unknown groups).
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => slotOf(a.g.group) - slotOf(b.g.group) || a.i - b.i)
    .map(({ g }) => g);
}

/** Split text into plain and highlighted runs for rendering `<mark>`. */
export function segments(text: string, ranges: readonly Range[]): { text: string; mark: boolean }[] {
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

/** Move the cursor over enabled-or-not rows with wrap; -1 when empty. */
export function step(cur: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  if (cur < 0) return delta > 0 ? 0 : len - 1;
  return (cur + delta + len) % len;
}

// ------------------------------------------------------------------ results

/**
 * What a palette result row needs from a catalog entry or a lock row: the id
 * (`skills/pony`), the name it is listed under, its kind, and the words that
 * should also find it.
 */
export type ResultEntry = {
  id: string;
  name: string;
  kind: string;
  summary?: string | null;
  tags?: readonly string[];
};

/** A row that opens something: `route` is where Enter goes, and it is never an action. */
export type PaletteRow = Rankable & { result: true; route: string };

/** Kind, summary and tags, so `pony` also finds an entry that only mentions ponies. */
export const resultKeywords = (e: ResultEntry): string =>
  [e.kind, e.summary ?? '', ...(e.tags ?? [])].filter(Boolean).join(' ');

/** One palette row per thing, all in one group, each opening `route(id)`. */
export function entryRows(entries: readonly ResultEntry[], group: string, route: (id: string) => string): PaletteRow[] {
  const pre = group === CATALOG_GROUP ? 'entry' : 'import';
  return entries.map((e) => ({
    id: `${pre}:${e.id}`,
    title: e.name || e.id,
    group,
    keywords: resultKeywords(e),
    hint: e.kind,
    onlyWhenSearching: true,
    disabled: null,
    result: true,
    route: route(e.id),
  }));
}

export type ResultSource = {
  /** The catalog Browse publishes (or `ensureCatalog` loads): the `Catalog` group. */
  entries?: readonly ResultEntry[];
  /** The project's tracked imports: the `Imports` group, on the Project route only. */
  imports?: readonly ResultEntry[];
};

/** Where a row's Enter goes: the entry's page in Browse, the import's page in the project. */
export type ResultRoutes = { catalog: (id: string) => string; project: (id: string) => string };

/**
 * The result rows for the palette: catalog entries, plus the project's tracked
 * imports. Both are `onlyWhenSearching` (hundreds of rows are searched, never
 * listed) and both are links, so Enter opens the thing instead of running
 * whatever command happened to be under the cursor.
 */
export function resultRows(src: ResultSource, routes: ResultRoutes): PaletteRow[] {
  return [
    ...entryRows(src.entries ?? [], CATALOG_GROUP, routes.catalog),
    ...entryRows(src.imports ?? [], IMPORTS_GROUP, routes.project),
  ];
}
