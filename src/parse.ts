// Text-format helpers. The CLI text parsers below (parseList, parseShow,
// parseStatus, parseOpLog, conflictLines, importConflicts,
// hasMergeMarkersNote) are SUPERSEDED by the typed --json decoders in
// json.ts: views must decode stack_run output through json.ts instead. They
// stay exported only as documentation of the human-readable formats — do not
// use them for new UI. The kind/manifest/row helpers (kindOf, pluralOf,
// KINDS, manifestName, manifestList, rowState) are live and shared.

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
  gone: boolean;
};

export type LockStatus = { commit: string | null; rows: StatusRow[] };

// formatStatus(): `stack at <sha>` then
// `<*| > <id> @<sha> -> <path>[  (<bit>; <bit>)]`
// bits: `removed from stack` | `update: N file(s)` | `edited here: f, …`
/** @deprecated Superseded by json.ts --json decoders; do not use for new UI. */
export function parseStatus(text: string): LockStatus {
  // Keep leading markers (`* `/`  `); drop trailing whitespace only.
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length || lines[0].startsWith('No stack imports here')) {
    return { commit: null, rows: [] };
  }
  const commit = /^stack at ([0-9a-f]+)/.exec(lines[0])?.[1] ?? null;
  const rows: StatusRow[] = [];
  for (const line of lines.slice(1)) {
    const m = /^[* ] (\S+) @([0-9a-f]+) -> (\S+?)(?: {2,}\((.*)\))?$/.exec(line);
    if (!m) continue;
    const [, id, c, path, bits] = m;
    const row: StatusRow = { id, commit: c, path, local: [], upstreamCount: null, gone: false };
    for (const bit of (bits ?? '').split(';').map((s) => s.trim())) {
      if (bit === 'removed from stack') row.gone = true;
      else if (bit.startsWith('update: ')) {
        const n = /^update: (\d+) files?/.exec(bit)?.[1];
        row.upstreamCount = n ? parseInt(n, 10) : 0;
      } else if (bit.startsWith('edited here: ')) {
        row.local = bit.slice('edited here: '.length).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    rows.push(row);
  }
  return { commit, rows };
}

export type RowState = 'imported' | 'edited' | 'update' | 'gone';

export function rowState(r: StatusRow): RowState {
  if (r.gone) return 'gone';
  if (r.upstreamCount) return 'update';
  if (r.local.length) return 'edited';
  return 'imported';
}

export type OpLine = { tag: string; text: string };

// Op logs: `<tag><spaces><rest>` (tags: import update remove kept skip
// merged restored note gone have ignore CONFLICT) or bare lines.
/** @deprecated Superseded by json.ts --json decoders; do not use for new UI. */
export function parseOpLog(text: string): OpLine[] {
  const out: OpLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const m = /^([A-Za-z]+) {2,}(\S.*)$/.exec(line) ?? /^([A-Z]+) (\S.*)$/.exec(line);
    out.push(m ? { tag: m[1], text: m[2] } : { tag: '', text: line.trim() });
  }
  return out;
}

/** @deprecated Superseded by json.ts --json decoders; do not use for new UI. */
export const conflictLines = (lines: OpLine[]): OpLine[] =>
  lines.filter((l) => l.tag === 'CONFLICT');

// import refusal: `these files already exist with other content; …:`
// followed by `  <file>` lines.
/** @deprecated Superseded by json.ts --json decoders; do not use for new UI. */
export function importConflicts(text: string): string[] {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes('already exist with other content'));
  if (i < 0) return [];
  return lines
    .slice(i + 1)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** @deprecated Superseded by json.ts --json decoders; do not use for new UI. */
export const hasMergeMarkersNote = (text: string): boolean =>
  text.includes('<<<<<<<');
