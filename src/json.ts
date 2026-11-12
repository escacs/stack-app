// Typed `stack ... --json` decoding. With --json, stdout holds one JSON
// value; errors stay plain text on stderr with a nonzero exit, so stdout
// stays parseable. Shapes mirror tools/stack/cli.mjs (list/search/show) and
// tools/stack/imports.mjs (status/import/sync/update/remove json:true).
// This module supersedes the text parsers in parse.ts (parseList, parseShow,
// parseStatus): views must decode JSON through here instead.
import type { StackOut } from './bridge';
import type { StatusRow } from './parse';

export type EntryLibrary = { name: string; extends: string | null; default: boolean };

export type JsonEntry = {
  id: string;
  kind: string;
  name: string;
  summary: string;
  status: string;
  origin: string;
  usage: string;
  doc: string;
  tags: string[];
  targets: string[];
  related?: string[];
  requires?: string[];
  payload?: string;
  source?: Record<string, unknown>;
  /** Present on components inside a known component library. */
  library?: EntryLibrary;
  /** False when the entry is not in the stack's HEAD commit: unimportable. */
  committed: boolean;
  /** File count and total bytes (list/search rows). */
  files: number;
  bytes: number;
  /** First image file for the row thumbnail, or null. */
  preview: string | null;
};

export type ListJson = {
  command: 'list';
  kind: string | null;
  count: number;
  entries: JsonEntry[];
  /** Ids with uncommitted worktree changes in the stack checkout. */
  uncommitted: string[];
};

export type SearchJson = {
  command: 'search';
  query: string;
  kind: string | null;
  count: number;
  entries: JsonEntry[];
  uncommitted: string[];
};

export type ShowFile = { path: string; size: number };

export type ShowJson = {
  command: 'show';
  id: string;
  committed: boolean;
  usage: string;
  manifest: Record<string, unknown>;
  /** Present on components inside a known component library. */
  library?: EntryLibrary;
  files: ShowFile[];
  /** Entry doc body, or null when the doc file is missing. */
  doc: string | null;
};

export type StatusJsonRow = {
  id: string;
  path: string;
  commit: string;
  local: string[];
  upstream: string[];
  gone: boolean;
};

export type StatusJson = { command: 'status'; commit: string; rows: StatusJsonRow[] };

export type ImportJson = {
  command: 'import';
  commit: string;
  imported: { id: string; path: string; requiredBy?: string }[];
  already: string[];
  gitignore: 'updated' | 'unchanged';
};

/** `import --dry-run --json`: the plan plus its collisions; writes nothing. */
export type ImportDryRunJson = {
  command: 'import';
  dryRun: boolean;
  commit: string;
  imported: { id: string; path: string; requiredBy?: string }[];
  already: string[];
  conflicts: string[];
  gitignore: 'updated' | 'unchanged';
};

export type SyncJson = {
  command: 'sync';
  restored: string[];
  kept: string[];
  skipped: string[];
};

export type UpdateJson = {
  command: 'update';
  commit: string;
  updated: { id: string; changed: number }[];
  conflicts: string[];
  merged: string[];
  kept: string[];
  skipped: string[];
  gone: string[];
  imported: { id: string; path: string; requiredBy?: string }[];
  upToDate: boolean;
};

export type RemoveJson = {
  command: 'remove';
  removed: string;
  kept: string[];
  requiredBy: string[];
  gitignore: 'updated' | 'unchanged';
};

export type InitJson = {
  command: 'init';
  migrated: boolean;
  entries: number;
  gitignore: 'updated' | 'unchanged';
};

export type PresetImport = { id: string; to: string | null };

export type PresetListItem = {
  name: string;
  description: string;
  imports: PresetImport[];
};

export type PresetListJson = {
  command: 'preset';
  action: 'list';
  count: number;
  presets: PresetListItem[];
};

export type PresetShowJson = {
  command: 'preset';
  action: 'show';
  preset: { name: string; description: string; source: string; imports: PresetImport[] };
};

export type PresetApplyJson = {
  command: 'preset';
  action: 'apply';
  preset: string;
  /** Dry-run only: true when nothing was written. Absent on a real apply. */
  dryRun?: boolean;
  commit: string;
  imported: { id: string; path: string; requiredBy?: string }[];
  already: string[];
  /** Dry-run only: files that would collide. Absent on a real apply. */
  conflicts?: string[];
  gitignore: 'updated' | 'unchanged';
};

/** A CLI failure: message is the plain-text stderr for the UI. */
export class CliError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

/** Plain-text failure message: stderr first, then stdout, then the exit. */
export function cliText(out: StackOut): string {
  return out.stderr.trim() || out.stdout.trim() || `stack exited ${out.code}`;
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error('expected a JSON object');
  }
  return v as Record<string, unknown>;
}

/** Decode one --json stdout payload; throws Error on malformed JSON. */
export function parseJsonOut<T>(stdout: string): T {
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    throw new Error('could not parse the stack reply as JSON');
  }
  return asRecord(v) as T;
}

/**
 * Decode a stack_run result: nonzero exit becomes CliError carrying the
 * plain-text stderr; otherwise the stdout JSON is parsed and returned.
 */
export function fromStackOut<T>(out: StackOut): T {
  if (out.code !== 0) throw new CliError(cliText(out), out.code);
  if (out.truncated) throw new Error('the stack reply was truncated; narrow the query and retry');
  return parseJsonOut<T>(out.stdout);
}

/** Map a status --json payload onto the UI row shape. */
export function toStatusRows(s: StatusJson): { commit: string | null; rows: StatusRow[] } {
  return {
    commit: s.commit,
    rows: s.rows.map((r) => ({
      id: r.id,
      commit: r.commit,
      path: r.path,
      local: [...r.local],
      upstreamCount: r.upstream.length,
      gone: r.gone,
    })),
  };
}

/** Entry doc file name: manifest `entry`, else the kind default. */
export function docNameFor(manifest: Record<string, unknown>): string {
  const e = manifest['entry'];
  if (typeof e === 'string' && e) return e;
  const k = manifest['kind'];
  return k === 'skill' || k === 'style' ? 'SKILL.md' : 'README.md';
}

/** Map a show --json payload onto the UI doc shape. */
export function toShowDoc(s: ShowJson): {
  id: string;
  committed: boolean;
  usage: string | null;
  manifest: Record<string, unknown>;
  files: ShowFile[];
  docBody: string;
} {
  return {
    id: s.id,
    committed: s.committed,
    usage: s.usage,
    manifest: s.manifest,
    files: s.files.map((f) => ({ path: f.path, size: f.size })),
    docBody: (s.doc ?? '').trim(),
  };
}

/** show <id> --file <path> --json: one entry file body. */
export type ShowFileJson = {
  command: 'show';
  id: string;
  file: string;
  size: number;
  binary: boolean;
  markdown: boolean;
  text: string | null;
  base64: string | null;
};

export function showFileArgs(id: string, file: string): string[] {
  return [id, '--file', file, '--json'];
}

/** Map a show --file payload onto the UI file shape. */
export function toShowFile(s: ShowFileJson): {
  id: string;
  file: string;
  size: number;
  binary: boolean;
  markdown: boolean;
  text: string;
  base64: string | null;
} {
  return {
    id: s.id,
    file: s.file,
    size: s.size,
    binary: s.binary,
    markdown: s.markdown,
    text: s.text ?? '',
    base64: s.base64,
  };
}

// ------------------------------------------------------------------ markers

/**
 * Git-state markers for a catalog row. `committed: false` means the entry is
 * not in the stack's HEAD commit, so `import` refuses it ("not-committed").
 * Membership in the list/search `uncommitted` array means the stack worktree
 * holds uncommitted changes for it ("uncommitted-in-stack"); imports read the
 * committed state, so what lands may differ from the worktree.
 */
export type EntryMarkers = { notCommitted: boolean; uncommittedInStack: boolean };

export function entryMarkers(e: JsonEntry, uncommitted: Set<string>): EntryMarkers {
  return { notCommitted: !e.committed, uncommittedInStack: uncommitted.has(e.id) };
}

// ------------------------------------------------------------------ args

/**
 * Args for `search`: exactly one query positional (Rust rejects anything
 * else). A query starting with `-` goes after `--` so it never parses as a
 * flag; --kind stays before the separator.
 */
export function searchArgs(query: string, kind: string): string[] {
  const args = [...(kind ? ['--kind', kind] : []), '--json'];
  if (query.startsWith('-')) args.push('--');
  args.push(query);
  return args;
}

/** Args for `import`: ids plus an optional single-entry --to. */
export function importArgs(id: string, to: string): string[] {
  const dest = to.trim();
  return dest ? [id, '--to', dest, '--json'] : [id, '--json'];
}

/**
 * Where `import <id>` lands without --to, mirroring imports.mjs: skills and
 * styles go to .agents/skills/<name>, payload entries (templates) mirror at
 * the project root, everything else under .stack/<id>. The row button shows
 * this as its hover text; the CLI stays authoritative for the real path.
 */
export function defaultImportDest(e: Pick<JsonEntry, 'id' | 'kind' | 'name' | 'payload'>): string {
  if (e.kind === 'skill' || e.kind === 'style') return `.agents/skills/${e.name}`;
  if (e.payload) return '.';
  return `.stack/${e.id}`;
}

/**
 * Whether the row must ask for a destination instead of importing blindly.
 * The CLI never *requires* --to (there is always a fallback), but its own
 * usage text imports `copy` entries as `import <id> --to <dir>`: without a
 * destination a component lands in .stack/, not in the source tree. Payload
 * entries (templates) are the exception: their default mirrors the project
 * root, which is the documented landing spot.
 */
export function needsImportDest(e: Pick<JsonEntry, 'usage' | 'payload'>): boolean {
  return e.usage === 'copy' && !e.payload;
}

/**
 * Prefill for the inline destination field: components follow the
 * `src/components/<name>` convention (the CLI's own hint for member
 * imports). Anything else needing a destination has no catalog convention,
 * so the field opens empty.
 */
export function importDestHint(e: Pick<JsonEntry, 'kind' | 'name'>): string | null {
  return e.kind === 'component' ? `src/components/${e.name}` : null;
}

/** Args for `preset list` / `preset show <name>` / `preset apply <name>`. */
export function presetListArgs(): string[] {
  return ['list', '--json'];
}

export function presetShowArgs(name: string): string[] {
  return ['show', name, '--json'];
}

export function presetApplyArgs(name: string, dryRun = false): string[] {
  return dryRun ? ['apply', name, '--dry-run', '--json'] : ['apply', name, '--json'];
}

/** Hover text for a preset's apply button: what apply will import. */
export function presetImportsHint(imports: PresetImport[]): string {
  if (!imports.length) return 'no imports';
  return imports.map((i) => (i.to ? `${i.id} → ${i.to}` : i.id)).join(', ');
}

/**
 * A dry-run preview names pre-op lock state: it may only land when no op
 * started since it was requested. The project page bumps a sequence counter
 * on every op start; the preview carries the count from its request, and a
 * mismatch means an op began mid-flight, so the answer is stale and dropped.
 */
export function previewFresh(requestSeq: number, opSeqNow: number): boolean {
  return requestSeq === opSeqNow;
}

/**
 * A preset row's compact counts against the lock: "2 new" ("all here" when
 * nothing is new). Once a preview has named `deps` auto-imported
 * dependencies, " · N dep" is appended so the row agrees with the preview.
 */
export function presetCountText(imports: PresetImport[], ids: Set<string>, deps: number): string {
  const fresh = imports.filter((i) => !ids.has(i.id)).length;
  const base = fresh ? `${fresh} new` : 'all here';
  return deps > 0 ? `${base} · ${deps} dep` : base;
}

/** The row counts spelled out, for the tooltip: "2 imports, 1 new, 1 dependency". */
export function presetCountTitle(imports: PresetImport[], ids: Set<string>, deps: number): string {
  const fresh = imports.filter((i) => !ids.has(i.id)).length;
  const n = `${imports.length} import${imports.length === 1 ? '' : 's'}`;
  const base = fresh ? `${n}, ${fresh} new` : `${n}, all here`;
  return deps > 0 ? `${base}, ${deps} ${deps === 1 ? 'dependency' : 'dependencies'} (named by the preview)` : base;
}

/** Rows a long presets list shows before its `+N more` toggle. */
export const PRESET_ROWS = 5;
/** More presets than this earns the type-to-filter input. */
export const PRESET_FILTER_MIN = 8;

/** Whether the presets section needs a filter input at this list size. */
export function presetsFilterable(total: number): boolean {
  return total > PRESET_FILTER_MIN;
}

/**
 * Whether the presets section starts unfolded. A project that already has
 * imports treats presets as a starting point, so a list longer than the
 * default row count starts folded to its heading; a short list, or any list
 * in a project with nothing imported yet, is open.
 */
export function presetsStartOpen(total: number, imported: number): boolean {
  return imported === 0 || total <= PRESET_ROWS;
}

/**
 * Presets matching a typed filter: every space-separated term must appear,
 * case-insensitively, in the name or the description. An empty filter keeps
 * everything.
 */
export function matchPresets(list: PresetListItem[], query: string): PresetListItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return list;
  return list.filter((p) => {
    const hay = `${p.name} ${p.description}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * The rows to draw: the filter's matches, cut to `limit` unless `all`. The
 * preset whose preview is open (`pinned`) always stays, in its place in the
 * list, even when the filter or the cut would hide it. `hidden` counts
 * matches left out (what `+N more` would reveal).
 */
export function visiblePresets(
  list: PresetListItem[],
  query: string,
  all: boolean,
  pinned: string | null,
  limit: number = PRESET_ROWS,
): { rows: PresetListItem[]; hidden: number } {
  const matches = new Set(matchPresets(list, query));
  const rows: PresetListItem[] = [];
  let seen = 0;
  let hidden = 0;
  for (const p of list) {
    const match = matches.has(p);
    const idx = match ? seen++ : -1;
    if (p.name === pinned || (match && (all || idx < limit))) rows.push(p);
    else if (match) hidden++;
  }
  return { rows, hidden };
}

// ------------------------------------------------------------------ op summaries

export type OpSection = { title: string; lines: string[]; tone?: 'bad' | 'dim' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Render an import --json result as display sections (no CLI text). */
export function describeImport(r: ImportJson): OpSection[] {
  const secs: OpSection[] = [];
  if (r.imported.length) {
    secs.push({
      title: `imported ${plural(r.imported.length, 'entry', 'entries')}`,
      lines: r.imported.map((p) =>
        `${p.id} → ${p.path}${p.requiredBy ? ` (required by ${p.requiredBy})` : ''}`,
      ),
    });
  }
  if (r.already.length) secs.push({ title: 'already here', lines: [...r.already], tone: 'dim' });
  if (r.gitignore === 'updated') {
    secs.push({ title: '.gitignore', lines: ['managed escacs block updated'], tone: 'dim' });
  }
  if (!secs.length) secs.push({ title: 'nothing to do', lines: [], tone: 'dim' });
  return secs;
}

/**
 * The inline one-liner after a row import: `imported → <path>`, plus `+N
 * dep` when the import pulled in entries required by others
 * (ImportJson.requiredBy). A row that landed in `already` (imported
 * elsewhere between the list and the click) reads `already here`.
 */
export function quickImportLine(r: ImportJson, id: string): string {
  const main = r.imported.find((p) => p.id === id) ?? r.imported[0];
  if (!main) return r.already.includes(id) ? 'already here' : 'imported';
  const deps = r.imported.filter((p) => p.requiredBy).length;
  const base = `imported → ${main.path}`;
  return deps ? `${base} +${deps} dep` : base;
}

/** The inline one-liner for a failed row import: the first stderr line, capped. */
export function quickImportError(stderrText: string): string {
  const first = stderrText
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return 'import failed';
  return first.length > 100 ? `${first.slice(0, 99)}…` : first;
}

/** Render an update --json result as display sections. */
export function describeUpdate(r: UpdateJson): OpSection[] {
  if (r.upToDate) return [{ title: `up to date with ${r.commit.slice(0, 7)}`, lines: [], tone: 'dim' }];
  const secs: OpSection[] = [];
  for (const u of r.updated) {
    secs.push({
      title: `update ${u.id} → ${r.commit.slice(0, 7)} (${plural(u.changed, 'file')} changed upstream)`,
      lines: [],
    });
  }
  if (r.conflicts.length) {
    secs.push({
      title: 'conflicts — open each file, keep one side, delete the <<<<<<< markers',
      lines: [...r.conflicts],
      tone: 'bad',
    });
  }
  if (r.merged.length) secs.push({ title: 'merged (your edits kept)', lines: [...r.merged] });
  if (r.kept.length) secs.push({ title: 'kept (edited here)', lines: [...r.kept], tone: 'dim' });
  if (r.skipped.length) {
    secs.push({ title: 'skipped (deleted here; the stack changed it)', lines: [...r.skipped], tone: 'dim' });
  }
  if (r.gone.length) {
    secs.push({
      title: 'removed from the stack; kept as is',
      lines: [...r.gone],
      tone: 'dim',
    });
  }
  if (r.imported.length) {
    secs.push({
      title: 'newly required (auto-imported)',
      lines: r.imported.map((p) => `${p.id} → ${p.path}`),
    });
  }
  return secs;
}

/**
 * Render a preset apply --json result as display sections. The apply log
 * mirrors the import log, so this delegates to describeImport and only adds
 * the dry-run conflicts section (a real apply never carries one).
 */
export function describePresetApply(r: PresetApplyJson): OpSection[] {
  const secs = describeImport({
    command: 'import',
    commit: r.commit,
    imported: r.imported,
    already: r.already,
    gitignore: r.gitignore,
  });
  const conflicts = r.conflicts ?? [];
  if (!conflicts.length) return secs;
  const sec: OpSection = {
    title: 'conflicts (dry run, nothing was written)',
    lines: [...conflicts],
    tone: 'bad',
  };
  const idle = secs.findIndex((s) => s.title === 'nothing to do');
  if (idle >= 0) secs[idle] = sec;
  else secs.unshift(sec);
  return secs;
}

/**
 * One line of a preset dry-run preview. `new` and `dep` would land at `path`
 * (a `dep` was pulled in by another entry: `title` names which), `here` is
 * already imported, `conflict` is a file that would collide, `note` is
 * plain information. `tag` is the short dim label; `title` the long reason.
 */
export type PreviewLine = {
  kind: 'new' | 'dep' | 'here' | 'conflict' | 'note';
  id: string;
  path?: string;
  tag?: string;
  title?: string;
};

/**
 * Render a preset dry-run (`preset apply <name> --dry-run --json`) as one
 * line per entry: what would collide first, then what would land where
 * (dependencies tagged), then what is already imported. No line ever claims
 * a write.
 */
export function describePresetPreview(r: PresetApplyJson): PreviewLine[] {
  const lines: PreviewLine[] = [];
  for (const f of r.conflicts ?? []) {
    lines.push({
      kind: 'conflict',
      id: f,
      tag: 'exists',
      title: 'would collide: this file already exists with other content. nothing was written',
    });
  }
  for (const p of r.imported) {
    lines.push(
      p.requiredBy
        ? { kind: 'dep', id: p.id, path: p.path, tag: 'dep', title: `required by ${p.requiredBy}` }
        : { kind: 'new', id: p.id, path: p.path },
    );
  }
  for (const id of r.already) {
    lines.push({ kind: 'here', id, tag: '✓ here', title: 'already imported' });
  }
  if (r.gitignore === 'updated') {
    lines.push({ kind: 'note', id: '.gitignore', path: 'managed escacs block updates' });
  }
  if (!lines.length) {
    lines.push({ kind: 'note', id: 'nothing new: everything already here' });
  }
  return lines;
}

/** Render a remove --json result as display sections. */
export function describeRemove(r: RemoveJson): OpSection[] {
  const secs: OpSection[] = [{ title: `remove ${r.removed}`, lines: [] }];
  if (r.requiredBy.length) {
    secs.push({
      title: `note: ${r.requiredBy.join(', ')} require${r.requiredBy.length === 1 ? 's' : ''} ${r.removed}`,
      lines: [],
      tone: 'dim',
    });
  }
  if (r.kept.length) secs.push({ title: 'kept (edited here)', lines: [...r.kept], tone: 'dim' });
  if (r.gitignore === 'updated') {
    secs.push({ title: '.gitignore', lines: ['managed escacs block updated'], tone: 'dim' });
  }
  return secs;
}

/** Render an init --json result as display sections. */
export function describeInit(r: InitJson): OpSection[] {
  const secs: OpSection[] = [
    {
      title: r.migrated
        ? `migrated stack.lock.json → stack.toml (${plural(r.entries, 'entry', 'entries')})`
        : 'created stack.toml',
      lines: [],
    },
  ];
  if (r.gitignore === 'updated') {
    secs.push({ title: '.gitignore', lines: ['managed escacs block updated'], tone: 'dim' });
  }
  return secs;
}

/** Render a sync --json result as display sections. */
export function describeSync(r: SyncJson): OpSection[] {
  if (!r.restored.length && !r.kept.length && !r.skipped.length) {
    return [{ title: 'sync done: everything already in place', lines: [], tone: 'dim' }];
  }
  const secs: OpSection[] = [];
  if (r.restored.length) {
    secs.push({ title: `restored ${plural(r.restored.length, 'file')}`, lines: [...r.restored] });
  }
  if (r.kept.length) secs.push({ title: 'kept (edited here)', lines: [...r.kept], tone: 'dim' });
  if (r.skipped.length) {
    secs.push({ title: 'skipped (not an entry at the recorded commit)', lines: [...r.skipped], tone: 'dim' });
  }
  return secs;
}

/**
 * Refusal file list from a failed import/update/remove/sync: the CLI throws
 * before writing anything with `these files already exist with other
 * content:` followed by one file per line. Operates on the stderr text —
 * this is error prose, not a data format, so it stays a text scan.
 */
export function refusalFiles(stderrText: string): string[] {
  const lines = stderrText.split('\n');
  const i = lines.findIndex((l) => l.includes('already exist with other content'));
  if (i < 0) return [];
  return lines
    .slice(i + 1)
    .map((l) => l.trim())
    .filter(Boolean);
}
