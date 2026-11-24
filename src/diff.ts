// Line diff for the review-changes panel (no DOM): a Myers shortest-edit
// script over lines, the unified view with long unchanged runs collapsed, and
// the labels the panel prints. Tested in diff.test.ts.
export type DiffOp = { kind: 'eq' | 'add' | 'del'; text: string; oldNo: number | null; newNo: number | null };

/** Past this many changed lines the exact script is skipped: the whole file reads as replaced. */
const MAX_EDITS = 4000;

/** Split text into lines the way an editor counts them: a trailing newline adds no empty line. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Myers O(ND): ops turning `a` into `b`, with line numbers on both sides. */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  // Trim the shared head and tail first: most edited files differ in the middle.
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const ma = a.slice(head, n - tail);
  const mb = b.slice(head, m - tail);
  const mid = myers(ma, mb);
  const ops: DiffOp[] = [];
  let o = 1;
  let w = 1;
  const push = (kind: DiffOp['kind'], text: string) => {
    ops.push({ kind, text, oldNo: kind === 'add' ? null : o, newNo: kind === 'del' ? null : w });
    if (kind !== 'add') o++;
    if (kind !== 'del') w++;
  };
  for (let i = 0; i < head; i++) push('eq', a[i]);
  for (const x of mid) push(x.kind, x.text);
  for (let i = n - tail; i < n; i++) push('eq', a[i]);
  return ops;
}

function myers(a: string[], b: string[]): { kind: DiffOp['kind']; text: string }[] {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((text) => ({ kind: 'add' as const, text }));
  if (!m) return a.map((text) => ({ kind: 'del' as const, text }));
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) {
    // Too different to script cheaply: show it as one replacement.
    return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
  }
  // Walk back through the saved frontiers.
  const out: { kind: DiffOp['kind']; text: string }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && pv[offset + k - 1] < pv[offset + k + 1]);
    const pk = down ? k + 1 : k - 1;
    const px = pv[offset + pk];
    const py = px - pk;
    while (x > px && y > py) {
      x--;
      y--;
      out.push({ kind: 'eq', text: a[x] });
    }
    if (down) {
      y--;
      out.push({ kind: 'add', text: b[y] });
    } else {
      x--;
      out.push({ kind: 'del', text: a[x] });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    out.push({ kind: 'eq', text: a[x] });
  }
  return out.reverse();
}

export type DiffStats = { added: number; removed: number };

export function diffStats(ops: readonly DiffOp[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.kind === 'add') added++;
    else if (o.kind === 'del') removed++;
  }
  return { added, removed };
}

export type DiffBlock =
  | { type: 'lines'; lines: DiffOp[] }
  /** A run of unchanged lines folded away; `lines` are what opening it reveals. */
  | { type: 'fold'; lines: DiffOp[] };

/**
 * Group ops into shown blocks and folds: an unchanged run longer than
 * `2 * context + minFold` keeps `context` lines beside each change and folds
 * the rest. Runs at the file's ends keep context on their change side only.
 */
export function collapseDiff(ops: readonly DiffOp[], context = 3, minFold = 4): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let i = 0;
  const pushLines = (lines: DiffOp[]) => {
    if (!lines.length) return;
    const last = blocks[blocks.length - 1];
    if (last?.type === 'lines') last.lines.push(...lines);
    else blocks.push({ type: 'lines', lines: [...lines] });
  };
  while (i < ops.length) {
    if (ops[i].kind !== 'eq') {
      let j = i;
      while (j < ops.length && ops[j].kind !== 'eq') j++;
      pushLines(ops.slice(i, j) as DiffOp[]);
      i = j;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j].kind === 'eq') j++;
    const run = ops.slice(i, j) as DiffOp[];
    const first = i === 0;
    const lastRun = j === ops.length;
    const keepHead = first ? 0 : context;
    const keepTail = lastRun ? 0 : context;
    if (run.length > keepHead + keepTail + minFold) {
      pushLines(run.slice(0, keepHead));
      blocks.push({ type: 'fold', lines: run.slice(keepHead, run.length - keepTail) });
      pushLines(run.slice(run.length - keepTail));
    } else {
      pushLines(run);
    }
    i = j;
  }
  return blocks;
}

// ------------------------------------------------------------------ review labels

export type ReviewMode = 'upstream' | 'local' | 'both' | 'missing';

/**
 * Which side(s) changed a file. A file deleted from the project (`missing`)
 * is its own case: it is neither your edit nor a conflict. Null when
 * nothing changed it (nothing to review).
 */
export function reviewMode(file: string, upstream: readonly string[], local: readonly string[], missing: readonly string[] = []): ReviewMode | null {
  if (missing.includes(file)) return 'missing';
  const u = upstream.includes(file);
  const l = local.includes(file);
  return u && l ? 'both' : u ? 'upstream' : l ? 'local' : null;
}

/** Files worth reviewing: upstream changes first, then the rest of the local edits, each once. */
export function reviewFiles(upstream: readonly string[], local: readonly string[]): string[] {
  return [...new Set([...upstream, ...local])];
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------- two-column model

/**
 * A row of the two-column view used when both sides changed a file: `yours`
 * is the installed file's line, `upstream` the stack copy's, as two labelled
 * versions side by side. No line is framed as removed: each line simply
 * belongs to the side it came from, and the differing rows are the ones
 * that carry only one side.
 */
export type SideRow = {
  kind: 'same' | 'yours' | 'upstream';
  yours: string;
  upstream: string;
  yoursNo: number | null;
  upstreamNo: number | null;
};

/**
 * Ops as two-column rows: `eq` fills both cells, a `del` (a line of the
 * installed file) goes to the Yours column only, an `add` (a line of the
 * stack copy) to Upstream only. Collapsed unchanged runs stay: any subset
 * of ops maps 1:1 onto rows, so `collapseDiff` keeps working unchanged.
 */
export function sideRows(ops: readonly DiffOp[]): SideRow[] {
  return ops.map((op) => ({
    kind: op.kind === 'eq' ? 'same' : op.kind === 'del' ? 'yours' : 'upstream',
    yours: op.kind === 'add' ? '' : op.text,
    upstream: op.kind === 'del' ? '' : op.text,
    yoursNo: op.kind === 'add' ? null : op.oldNo,
    upstreamNo: op.kind === 'del' ? null : op.newNo,
  }));
}

export type SideStats = { yours: number; upstream: number };

/** How many lines only one side has: the two-column view's quiet counts. */
export function sideStats(rows: readonly SideRow[]): SideStats {
  let yours = 0;
  let upstream = 0;
  for (const r of rows) {
    if (r.kind === 'yours') yours++;
    else if (r.kind === 'upstream') upstream++;
  }
  return { yours, upstream };
}

/** `Upstream changed 2 files` / `You edited SKILL.md` / both, as one line each. */
export function reviewHeadline(
  upstream: readonly string[],
  local: readonly string[],
  missing: readonly string[] = [],
): { upstream: string | null; local: string | null; missing: string | null } {
  const edited = local.filter((f) => !missing.includes(f));
  local = edited;
  return {
    missing: missing.length ? `Deleted here: ${missing.length === 1 ? missing[0] : plural(missing.length, 'file')}` : null,
    upstream: upstream.length ? `Upstream changed ${upstream.length === 1 ? upstream[0] : plural(upstream.length, 'file')}` : null,
    local: local.length ? `You edited ${local.length === 1 ? local[0] : plural(local.length, 'file')}` : null,
  };
}

/** True when both sides changed something: updating needs a review first. */
export const bothSides = (upstream: readonly string[], local: readonly string[]): boolean => upstream.length > 0 && local.length > 0;

/** Plain-words caption for one file's diff, saying what the columns mean. */
export function modeCaption(mode: ReviewMode): string {
  if (mode === 'missing') return 'This file was deleted from your project. The stack’s copy is shown as it would be restored; nothing of yours is lost.';
  if (mode === 'upstream') return 'Upstream changed this file. + lines are what a merge adds, − lines are what it replaces.';
  if (mode === 'local') return 'You edited this file. + lines are your edits, − lines are the original.';
  return 'Both sides changed this file. The columns are the two versions — Yours is what is imported here, Upstream is the stack’s; a line that appears on one side only is one side’s change.';
}

/** Map an installed file (relative to the import folder) to the entry's own file path. */
export function upstreamPathOf(file: string, payload?: string | null): string {
  return payload ? `${payload.replace(/\/+$/, '')}/${file}` : file;
}

/** The project-relative path of an installed file: an import at `.` sits at the root. */
export function installedPathOf(importPath: string, file: string): string {
  const base = importPath.trim().replace(/\/+$/, '');
  return !base || base === '.' ? file : `${base}/${file}`;
}
