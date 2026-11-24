// Text-format helpers. The CLI text parsers below (parseList, parseShow,
// parseStatus, parseOpLog, conflictLines, importConflicts,
// hasMergeMarkersNote) are SUPERSEDED by the typed --json decoders in
// json.ts: views must decode stack_run output through json.ts instead. They
// stay exported only as documentation of the human-readable formats — do not
// use them for new UI. The kind/manifest/row helpers (kindOf, pluralOf,
// KINDS, manifestName, manifestList, rowState) are live and shared.
import { LABEL, STATE_WORD } from './vocab';

export type CatalogEntry = {
  id: string;
  kind: string;
  name: string;
  usage: string;
  status: string | null;
  summary: string;
};

const PLURAL: Record<string, string> = {
  skill: 'skills',
  style: 'styles',
  system: 'systems',
  component: 'components',
  library: 'libraries',
  asset: 'assets',
  template: 'templates',
  worker: 'workers',
};

const SINGULAR: Record<string, string> = Object.fromEntries(
  Object.entries(PLURAL).map(([k, v]) => [v, k]),
);

export const kindOf = (id: string): string =>
  SINGULAR[id.split('/')[0]] ?? id.split('/')[0] ?? '';

export const pluralOf = (kind: string): string => PLURAL[kind] ?? kind;

export const KINDS = Object.keys(PLURAL);

/** Byte counts the way the website renders them (B/kB/MB/GB). */
// Byte sizes, exactly like the website's fmt(): 219b, 3.6k, 173k, 1.8m.
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n}b`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}k`;
  return `${(n / 1048576).toFixed(1)}m`;
}

// `- <id> [<usage>(, <status>)?]: <summary>` or `No matching entries.`
/** @deprecated Superseded by json.ts --json decoders; do not use for new UI. */
export function parseList(text: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const line of text.split('\n')) {
    const m = /^- (\S+) \[([^\]]+)\]: (.*)$/.exec(line.trim());
    if (!m) continue;
    const [, id, bracket, summary] = m;
    const [usage, status] = bracket.split(',').map((s) => s.trim());
    const segs = id.split('/');
    out.push({
      id,
      kind: kindOf(id),
      name: segs[segs.length - 1],
      usage,
      status: status || null,
      summary,
    });
  }
  return out;
}

export type ShowDoc = {
  id: string;
  usage: string | null;
  manifest: Record<string, unknown>;
  files: string[];
  docPath: string | null;
  docBody: string;
};

const get = (m: Record<string, unknown>, k: string): string | null =>
  typeof m[k] === 'string' ? (m[k] as string) : null;

export const manifestName = (m: Record<string, unknown>): string =>
  get(m, 'name') ?? '';

export const manifestList = (m: Record<string, unknown>, k: string): string[] =>
  Array.isArray(m[k]) ? (m[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];

// describe(): `# <id>` … `## Manifest` ```json … ``` `## Files` `- f` … `## <doc>` body
/** @deprecated Superseded by json.ts --json decoders; do not use for new UI. */
export function parseShow(text: string): ShowDoc {
  const id = (/^# (\S+)/m.exec(text)?.[1] ?? '').trim();
  const usage = /^Usage: (\S+)/m.exec(text)?.[1] ?? null;
  let manifest: Record<string, unknown> = {};
  const fence = /```json\n([\s\S]*?)\n```/.exec(text);
  if (fence) {
    try {
      manifest = JSON.parse(fence[1]) as Record<string, unknown>;
    } catch {
      manifest = {};
    }
  }
  const files: string[] = [];
  const filesSec = /## Files\n([\s\S]*?)(?:\n## |$)/.exec(text)?.[1] ?? '';
  for (const line of filesSec.split('\n')) {
    const m = /^- (\S.*)$/.exec(line.trim());
    if (m) files.push(m[1].trim());
  }
  // The entry doc is the first `## <path>` section after `## Files`; its
  // body may itself contain `## ` headings, so rejoin the tail.
  const parts = text.split('\n## ');
  let docPath: string | null = null;
  let docBody = '';
  const fi = parts.findIndex((p) => p === 'Files\n' || p.startsWith('Files\n'));
  if (fi >= 0 && fi + 1 < parts.length) {
    const first = parts[fi + 1];
    const nl = first.indexOf('\n');
    docPath = nl < 0 ? first.trim() : first.slice(0, nl).trim();
    const head = nl < 0 ? '' : first.slice(nl + 1);
    const tail = parts.length > fi + 2 ? `\n## ${parts.slice(fi + 2).join('\n## ')}` : '';
    docBody = (head + tail).trim();
  }
  return { id, usage, manifest, files, docPath, docBody };
}

export type StatusRow = {
  id: string;
  commit: string;
  path: string;
  local: string[];
  upstreamCount: number | null;
  /** Files changed upstream (names relative to the import's folder); absent on rows built from text. */
  upstream?: string[];
  /** Imported files deleted from the project (a subset of `local`: the CLI counts a deletion as a local change). */
  missing?: string[];
  /** The CLI's state word when it sent one (newer CLIs). */
  state?: 'up-to-date' | 'update-available' | 'edited' | 'missing' | 'gone';
  gone: boolean;
};

export type LockStatus = { commit: string | null; rows: StatusRow[] };

export type RowState = 'imported' | 'edited' | 'update' | 'missing' | 'gone';

/** Imported files that are no longer in the project. */
export const missingOf = (r: StatusRow): string[] => (r.gone ? [] : r.missing ?? []);

/** Files the user changed on purpose: local changes minus the deleted ones. */
export const editedOf = (r: StatusRow): string[] => {
  const m = new Set(r.missing ?? []);
  return r.local.filter((f) => !m.has(f));
};

/**
 * The state a row shows in a chip: the highest-priority fact. A row can be
 * missing files AND updated AND edited; the page lists every fact, the chip
 * names the one to act on first (gone > missing > update > edited).
 */
export function rowState(r: StatusRow): RowState {
  if (r.gone) return 'gone';
  if (missingOf(r).length) return 'missing';
  if (r.upstreamCount) return 'update';
  if (editedOf(r).length) return 'edited';
  return 'imported';
}

/** The CLI's state word for a row state (`status --json` `state`), so the two can be compared. */
export const CLI_STATE: Record<RowState, NonNullable<StatusRow['state']>> = {
  imported: 'up-to-date',
  edited: 'edited',
  update: 'update-available',
  missing: 'missing',
  gone: 'gone',
};

/** Every state a row is in at once (priority order); `imported` only when it is none of the others. */
export function rowFacts(r: StatusRow): RowState[] {
  const out: RowState[] = [];
  if (r.gone) out.push('gone');
  if (missingOf(r).length) out.push('missing');
  if (!r.gone && r.upstreamCount) out.push('update');
  if (!r.gone && editedOf(r).length) out.push('edited');
  return out.length ? out : ['imported'];
}

/** The word a row state shows (badges and chips; verbs never reuse them). */
export const rowWord = (st: RowState): string =>
  st === 'imported' ? LABEL.upToDate : st === 'missing' ? LABEL.missingFiles : STATE_WORD[st] ?? st;

/** The one tone each row state carries. */
export const rowTone = (st: RowState): 'success' | 'warning' | 'error' =>
  st === 'imported' ? 'success' : st === 'gone' ? 'error' : 'warning';

/** Rows with upstream changes waiting (the footer's update count), whatever else they are. */
export function countUpdates(rows: StatusRow[]): number {
  return rows.filter((r) => !r.gone && (r.upstreamCount ?? 0) > 0).length;
}

/** True when at least one row has imported files missing: the only time restoring does anything. */
export const hasMissing = (rows: readonly StatusRow[]): boolean => rows.some((r) => missingOf(r).length > 0);
