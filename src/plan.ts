// The import plan as files (no DOM): what a dry run says will land where,
// turned into a compact tree with `+` new / `~` overwrite / `!` collision
// marks, and the plain-words lines around it. The dry run names each entry's
// destination folder and the colliding paths; the file list and sizes come
// from `show`. Tested in plan.test.ts.
export type PlanMark = 'new' | 'overwrite' | 'collision';

export type PlanFile = {
  /** Project-relative path the file would be written to. */
  path: string;
  size: number;
  mark: PlanMark;
};

export type PlanTarget = {
  id: string;
  /** Destination folder, project-relative; `.` is the project root. */
  dest: string;
  /** The entry that needs this one, when this target is only here because of it. */
  requiredBy?: string;
  /** True when nothing selected this entry: it follows from `requiredBy`. */
  dependency: boolean;
  files: PlanFile[];
  /**
   * How many files the entry itself lists — its docs and manifest included.
   * `files` holds only what an import writes, so the two numbers differ (see
   * `fileCountLabel`) and a header can say both instead of contradicting the
   * entry's page.
   */
  entryFiles?: number;
};

/** What one dry run reported (import or preset apply). */
export type DryJson = {
  imported: { id: string; path: string; requiredBy?: string }[];
  already: string[];
  conflicts?: string[];
  gitignore?: 'updated' | 'unchanged';
};

export type Plan = {
  targets: PlanTarget[];
  already: string[];
  gitignore: boolean;
  /** Entries the user picked. */
  selectedCount: number;
  /** Entries in the plan only because a selected entry requires them. */
  requiredCount: number;
};

const posix = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

/** Join a destination folder and a path inside it; `.` and empty mean the project root. */
export function joinDest(dest: string, rel: string): string {
  const d = posix(dest.trim());
  return !d || d === '.' ? posix(rel) : `${d}/${posix(rel)}`;
}

/**
 * The files an import writes for one entry. The manifest (`stack.json`) is
 * never copied; an entry with a payload folder copies only that folder's
 * contents, with the folder name dropped (a template mirrors the project root).
 */
export function importedFiles(files: readonly { path: string; size: number }[], payload?: string | null): { path: string; size: number }[] {
  const pre = payload ? `${posix(payload)}/` : '';
  const out: { path: string; size: number }[] = [];
  for (const f of files) {
    if (pre) {
      if (f.path.startsWith(pre)) out.push({ path: f.path.slice(pre.length), size: f.size });
    } else if (f.path !== 'stack.json') {
      out.push(f);
    }
  }
  return out;
}

/**
 * One target from an entry's files and the dry run's collisions. `existing`
 * (paths that exist with the same content) would mark `~`; the CLI does not
 * report those, so callers normally omit it. A collision the file list does
 * not know of still appears, so none can go missing from the plan.
 */
export function buildTarget(
  t: { id: string; dest: string; requiredBy?: string; entryFiles?: number },
  files: readonly { path: string; size: number }[],
  conflicts: readonly string[],
  existing: ReadonlySet<string> = new Set(),
): PlanTarget {
  const clash = new Set(conflicts.map(posix));
  const prefix = (p: string) => {
    const d = posix(t.dest);
    return !d || d === '.' ? true : p === d || p.startsWith(`${d}/`);
  };
  const out: PlanFile[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const path = joinDest(t.dest, f.path);
    seen.add(path);
    out.push({ path, size: f.size, mark: clash.has(path) ? 'collision' : existing.has(path) ? 'overwrite' : 'new' });
  }
  for (const c of clash) {
    if (!seen.has(c) && prefix(c)) out.push({ path: c, size: 0, mark: 'collision' });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return {
    id: t.id,
    dest: t.dest,
    ...(t.requiredBy ? { requiredBy: t.requiredBy } : {}),
    ...(t.entryFiles !== undefined ? { entryFiles: t.entryFiles } : {}),
    dependency: !!t.requiredBy,
    files: out,
  };
}

/** Assemble the whole plan from a dry run plus each imported entry's file list. */
export function buildPlan(dry: DryJson, filesOf: (id: string) => readonly { path: string; size: number }[]): Plan {
  const conflicts = dry.conflicts ?? [];
  const targets = dry.imported.map((i) => buildTarget({ id: i.id, dest: i.path, requiredBy: i.requiredBy }, filesOf(i.id), conflicts));
  const counts = planCounts(targets);
  return {
    targets,
    already: [...dry.already],
    gitignore: dry.gitignore === 'updated',
    selectedCount: counts.selected,
    requiredCount: counts.required,
  };
}

/** Several plans as one: an entry already planned (a shared dependency) is listed once. */
export function mergePlans(plans: readonly Plan[]): Plan {
  const seen = new Set<string>();
  const targets: PlanTarget[] = [];
  const already = new Set<string>();
  for (const p of plans) {
    for (const t of p.targets) {
      if (seen.has(t.id)) {
        // One batch's dependency can be another's picked entry: it is selected then.
        const at = targets.findIndex((x) => x.id === t.id);
        if (at >= 0 && targets[at].dependency && !t.dependency) {
          const picked: PlanTarget = { ...targets[at], dependency: false };
          const entryFiles = targets[at].entryFiles ?? t.entryFiles;
          if (entryFiles !== undefined) picked.entryFiles = entryFiles;
          delete picked.requiredBy;
          targets[at] = picked;
        }
        continue;
      }
      seen.add(t.id);
      targets.push(t);
    }
    for (const a of p.already) already.add(a);
  }
  const counts = planCounts(targets);
  return {
    targets,
    already: [...already],
    gitignore: plans.some((p) => p.gitignore),
    selectedCount: counts.selected,
    requiredCount: counts.required,
  };
}

/**
 * The entries of a batch that would really be written: none whose own dry run
 * failed (`errs`) and none whose plan (its dependencies included) holds a
 * collision. The rest are skipped up front instead of being refused one by one.
 */
export function runnable<T extends { id: string }>(targets: readonly T[], per: ReadonlyMap<string, Plan>, errs: ReadonlyMap<string, string>): T[] {
  return targets.filter((t) => {
    const p = per.get(t.id);
    return !errs.has(t.id) && !(p && collidingTargets(p).length);
  });
}

/** What an import would write and what it leaves out; header, button and list all read this. */
export type ImportCounts = {
  /** Targets that will be written. */
  kept: PlanTarget[];
  /** Targets left out (chosen, colliding, or needed only by a skipped entry), each with why. */
  skipped: { target: PlanTarget; why: 'chosen' | 'collision' | 'dependency' }[];
  /** Ids already imported, never written again. */
  already: string[];
  entries: number;
  files: number;
  /** Everything left out: skipped targets plus already-imported ids. */
  skippedTotal: number;
};

/**
 * One counting rule: a target is written unless it is in `skipped`, is needed
 * only by a skipped entry, or (`skipColliding`) holds a collision. Already
 * imported ids (the plan's own, plus `alreadyExtra`) count as skipped.
 */
export function importCounts(
  plan: Pick<Plan, 'targets' | 'already'>,
  o: { skipColliding?: boolean; skipped?: ReadonlySet<string>; alreadyExtra?: readonly string[] } = {},
): ImportCounts {
  const chosen = o.skipped ?? new Set<string>();
  const kept: PlanTarget[] = [];
  const skipped: ImportCounts['skipped'] = [];
  for (const t of plan.targets) {
    const clash = t.files.some((f) => f.mark === 'collision');
    if (chosen.has(t.id)) skipped.push({ target: t, why: 'chosen' });
    else if (t.requiredBy && chosen.has(t.requiredBy)) skipped.push({ target: t, why: 'dependency' });
    else if (o.skipColliding && clash) skipped.push({ target: t, why: 'collision' });
    else kept.push(t);
  }
  const already = [...new Set([...plan.already, ...(o.alreadyExtra ?? [])])];
  return {
    kept,
    skipped,
    already,
    entries: kept.length,
    files: kept.reduce((n, t) => n + t.files.length, 0),
    skippedTotal: skipped.length + already.length,
  };
}

// ------------------------------------------------------------------ tree

export type TreeNode =
  | { kind: 'dir'; name: string; path: string; children: TreeNode[]; files: number; bytes: number; collisions: number }
  | { kind: 'file'; name: string; path: string; size: number; mark: PlanMark };

/**
 * Group files by folder. A folder holding exactly one folder and no files
 * folds into it (`src/components/button` shows as one line), so a deep
 * destination is not five indents of nothing. Folders list before files.
 */
export function buildTree(files: readonly PlanFile[]): TreeNode[] {
  type Raw = { name: string; dirs: Map<string, Raw>; files: PlanFile[] };
  const root: Raw = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const segs = f.path.split('/');
    let cur = root;
    for (const s of segs.slice(0, -1)) {
      let next = cur.dirs.get(s);
      if (!next) cur.dirs.set(s, (next = { name: s, dirs: new Map(), files: [] }));
      cur = next;
    }
    cur.files.push(f);
  }
  const conv = (raw: Raw, parent: string): TreeNode[] => {
    const dirs: TreeNode[] = [];
    for (const d of [...raw.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      let node = d;
      let name = d.name;
      while (node.files.length === 0 && node.dirs.size === 1) {
        node = [...node.dirs.values()][0];
        name = `${name}/${node.name}`;
      }
      const path = parent ? `${parent}/${name}` : name;
      const children = conv(node, path);
      const all = collect(children);
      dirs.push({ kind: 'dir', name, path, children, files: all.length, bytes: all.reduce((n, f) => n + f.size, 0), collisions: all.filter((f) => f.mark === 'collision').length });
    }
    const fl: TreeNode[] = [...raw.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ kind: 'file' as const, name: f.path.slice(f.path.lastIndexOf('/') + 1), path: f.path, size: f.size, mark: f.mark }));
    return [...dirs, ...fl];
  };
  return conv(root, '');
}

function collect(nodes: readonly TreeNode[]): Extract<TreeNode, { kind: 'file' }>[] {
  const out: Extract<TreeNode, { kind: 'file' }>[] = [];
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n);
    else out.push(...collect(n.children));
  }
  return out;
}

/** The marker glyph for a file line: `+` new, `~` overwrite, `!` collision. */
export const markGlyph = (m: PlanMark): string => (m === 'new' ? '+' : m === 'overwrite' ? '~' : '!');

export const markLabel = (m: PlanMark): string =>
  m === 'new' ? 'new file' : m === 'overwrite' ? 'will be overwritten' : 'already exists with different content';

// ------------------------------------------------------------------ words

const plural = (n: number, w: string, p = `${w}s`): string => `${n} ${n === 1 ? w : p}`;

/** Plain-words destination: `into .agents/skills/taste-skill`, `into the project root`. */
export function intoWords(dest: string): string {
  const d = posix(dest.trim());
  return !d || d === '.' ? 'into the project root' : `into ${d}`;
}

export type PlanTotals = { entries: number; files: number; bytes: number; collisions: number; overwrites: number; fresh: number };

export function planTotals(plan: Pick<Plan, 'targets'>): PlanTotals {
  const all = plan.targets.flatMap((t) => t.files);
  return {
    entries: plan.targets.length,
    files: all.length,
    bytes: all.reduce((n, f) => n + f.size, 0),
    collisions: all.filter((f) => f.mark === 'collision').length,
    overwrites: all.filter((f) => f.mark === 'overwrite').length,
    fresh: all.filter((f) => f.mark === 'new').length,
  };
}

/** Targets whose destination holds a colliding file. */
export const collidingTargets = (plan: Pick<Plan, 'targets'>): PlanTarget[] => plan.targets.filter((t) => t.files.some((f) => f.mark === 'collision'));

export type PlanCounts = { selected: number; required: number; total: number };

/**
 * How many entries the plan writes because they were picked, and how many are
 * only there because a picked entry requires them (`requiredBy`).
 */
export function planCounts(targets: readonly Pick<PlanTarget, 'dependency'>[]): PlanCounts {
  const required = targets.filter((t) => t.dependency).length;
  return { selected: targets.length - required, required, total: targets.length };
}

/**
 * The tag beside a plan's own entries: `+2 required`. Dependencies are never
 * listed as if the user had picked them — they add to what a selection pulls
 * in, and the count says how many.
 */
export const requiredLabel = (n: number): string => `+${n} required`;

/** The plan's headline count: `3 selected · +2 required`, or `2 entries` when nothing is pulled in. */
export function planCountLabel(counts: PlanCounts): string {
  if (!counts.required) return `${counts.selected} ${counts.selected === 1 ? 'entry' : 'entries'}`;
  return `${counts.selected} selected · ${requiredLabel(counts.required)}`;
}

/**
 * The collision line, in plain words and without the CLI's wording:
 * `2 files already exist at .agents/skills/x — choose another folder or keep them`.
 */
export function collisionMessage(t: Pick<PlanTarget, 'dest' | 'files'>): string | null {
  const n = t.files.filter((f) => f.mark === 'collision').length;
  if (!n) return null;
  const at = posix(t.dest) && posix(t.dest) !== '.' ? ` at ${posix(t.dest)}` : ' in the project root';
  return `${plural(n, 'file')} already exist${n === 1 ? 's' : ''}${at} — choose another folder or keep ${n === 1 ? 'it' : 'them'}`;
}

/**
 * A file count that never contradicts the entry's own page. The entry's
 * listing counts everything it holds — its doc (`README.md`/`SKILL.md`) and the
 * manifest (`stack.json`) included — while an import writes only the entry's
 * payload (or, without one, everything but the manifest), so `4 files` on the
 * Overview and `2 files` in the plan were both true and the pair read as a bug.
 *
 *   fileCountLabel(4)     -> '4 files'
 *   fileCountLabel(4, 4)  -> '4 files'
 *   fileCountLabel(4, 2)  -> '4 files · 2 copied'
 *
 * `writtenFiles` is what the import writes (`PlanTarget.files.length`);
 * leaving it out claims nothing about copying.
 */
export function fileCountLabel(entryFiles: number, writtenFiles?: number): string {
  const total = Math.max(0, Math.trunc(entryFiles));
  const written = writtenFiles === undefined ? null : Math.max(0, Math.trunc(writtenFiles));
  const head = plural(total, 'file');
  if (written === null || written === total) return head;
  return `${head} · ${written} copied`;
}

/**
 * A plan target's count: its destination's files written against the entry's
 * own file count, so the plan header and the entry page agree.
 */
export function targetFileLabel(t: Pick<PlanTarget, 'files' | 'entryFiles'>): string {
  return fileCountLabel(t.entryFiles ?? t.files.length, t.files.length);
}

/**
 * An entry's count from its `show` listing: `4 files · 2 copied` when only part
 * of the listing is copied (the doc and the manifest stay behind), `4 files`
 * when the whole entry lands.
 */
export function entryFileCountLabel(files: readonly { path: string; size: number }[], payload?: string | null): string {
  return fileCountLabel(files.length, importedFiles(files, payload).length);
}

/** One-line summary of a plan for the header: `7 files · 3.1 KB · 2 entries`. */
export function planSummary(totals: PlanTotals, fmt: (bytes: number) => string): string {
  const parts = [plural(totals.files, 'file'), fmt(totals.bytes)];
  if (totals.entries > 1) parts.push(plural(totals.entries, 'entry', 'entries'));
  return parts.join(' · ');
}

/**
 * The sentence that leads a batch plan: what will happen to the rows picked,
 * most important first: `6 will import, 12 need a different folder`.
 */
export function batchHeadline(o: { willImport: number; differentFolder: number; already: number; notCommitted: number }): string {
  const parts = [o.willImport ? `${o.willImport} will import` : 'Nothing will import'];
  if (o.differentFolder) parts.push(`${o.differentFolder} need a different folder`);
  if (o.already) parts.push(`${o.already} already imported`);
  if (o.notCommitted) parts.push(`${o.notCommitted} not in stack`);
  return parts.join(', ');
}

/**
 * Translate a failed dry run or import into words for a person: the CLI's
 * refusal and path errors lose their flags and verbs. Anything unknown keeps
 * its first line.
 */
export function plainError(text: string): string {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (/already exist with (?:other|different) content/i.test(text)) return 'Some files already exist in that folder — choose another folder or keep them.';
  if (/not an entry at stack commit/i.test(first)) return 'This entry is not in the stack yet, so it cannot be imported.';
  if (/use a project-relative path/i.test(first)) return 'Use a folder inside the project, not an absolute path.';
  if (/escapes the project/i.test(first)) return 'That folder is outside the project.';
  if (/--to/.test(first)) return first.replace(/--to/g, 'the destination folder');
  return first.length > 200 ? `${first.slice(0, 197)}…` : first;
}
