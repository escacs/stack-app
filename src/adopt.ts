// Adopt suggestions: match project folders against the catalog. The stack
// CLI has no "list untracked look-alikes" command — `status` only reports
// lock entries — so the app derives candidates by name: a folder in the
// project that sits where an entry would land, for an entry this project
// never imported. Adopting runs the plain `import`, which joins identical
// files into stack.toml and refuses (writing nothing) when any file differs.
// Pure logic, no bridge: node tests cover all of it.
import type { JsonEntry } from './json';

export type AdoptCandidate = {
  /** Project-relative folder, e.g. `.agents/skills/file-pr`. */
  folder: string;
  /** Catalog entry id the folder looks like. */
  id: string;
  /** `--to` for the adopt import, or null when the folder is the default. */
  to: string | null;
};

/**
 * Where `import <id>` lands without `--to`, mirroring the CLI fallback
 * (imports.mjs): skills and styles share `.agents/skills/<name>`, payload
 * entries (templates) mirror the project root, everything else goes to
 * `.stack/<id>`.
 */
export function defaultDestFor(e: Pick<JsonEntry, 'id' | 'kind' | 'name' | 'payload'>): string {
  if (e.kind === 'skill' || e.kind === 'style') return `.agents/skills/${e.name}`;
  if (e.payload) return '.';
  return `.stack/${e.id}`;
}

/** Args for a candidate's adopt import: `--to` only off the default path. */
export function adoptArgs(c: AdoptCandidate): string[] {
  return c.to ? [c.id, '--to', c.to, '--json'] : [c.id, '--json'];
}

/** Args for a candidate's identical/differs probe: a dry run writes nothing. */
export function adoptDryRunArgs(c: AdoptCandidate): string[] {
  return c.to ? [c.id, '--to', c.to, '--dry-run', '--json'] : [c.id, '--dry-run', '--json'];
}

/**
 * The dry-run conflicts that belong to one candidate: a dry run also plans
 * the entry's `requires`, whose collisions land at other destinations.
 */
export function conflictsFor(conflicts: string[], dest: string): string[] {
  if (dest === '.') return [...conflicts];
  return conflicts.filter((f) => f === dest || f.startsWith(`${dest}/`));
}

function cleanFolder(folder: string): string | null {
  const f = folder.trim().replace(/\/+$/, '');
  if (!f || f === '.' || f.startsWith('/') || f.split('/').some((s) => !s || s === '.' || s === '..')) {
    return null;
  }
  return f;
}

/**
 * Folders that look like unimported catalog entries, sorted by folder:
 *
 * - `.agents/skills/<name>` and `.claude/skills/<name>` match the skill or
 *   style named `<name>` (one shared namespace, like the CLI install).
 * - `.stack/<id>` matches the entry `<id>` exactly (any kind).
 * - `src/components/<name>` matches the component named `<name>`; several
 *   same-named components resolve to the default library's, or to none.
 *
 * Already imported ids and entries missing from the stack HEAD (uncommitted
 * in the stack: unimportable) never match. One folder claims an id only
 * once: when two folders name the same entry (the `.agents` folder and its
 * `.claude` link), the default destination wins.
 */
export function matchAdoptCandidates(
  folders: string[],
  entries: JsonEntry[],
  imported: Set<string>,
): AdoptCandidate[] {
  const byId = new Map<string, JsonEntry>();
  const skillByName = new Map<string, JsonEntry>();
  const componentsByName = new Map<string, JsonEntry[]>();
  for (const e of entries) {
    byId.set(e.id, e);
    if (!e.committed || imported.has(e.id)) continue;
    if (e.kind === 'skill' || e.kind === 'style') {
      if (!skillByName.has(e.name)) skillByName.set(e.name, e);
    } else if (e.kind === 'component') {
      const list = componentsByName.get(e.name);
      if (list) list.push(e);
      else componentsByName.set(e.name, [e]);
    }
  }

  const eligible = (e: JsonEntry | undefined): e is JsonEntry =>
    !!e && e.committed && !imported.has(e.id);

  const pickComponent = (name: string): JsonEntry | undefined => {
    const list = (componentsByName.get(name) ?? []).filter(eligible);
    if (list.length === 1) return list[0];
    const defaults = list.filter((e) => e.library?.default);
    return defaults.length === 1 ? defaults[0] : undefined;
  };

  const found = new Map<string, AdoptCandidate>();
  const claim = (folder: string, e: JsonEntry): void => {
    const dest = defaultDestFor(e);
    const c: AdoptCandidate = { folder, id: e.id, to: folder === dest ? null : folder };
    const prev = found.get(e.id);
    // The default destination beats a custom one (the `.agents` folder beats
    // its `.claude` link); otherwise the first folder wins.
    if (!prev || (prev.to !== null && c.to === null)) found.set(e.id, c);
  };

  for (const raw of folders) {
    const folder = cleanFolder(raw);
    if (!folder) continue;
    const segs = folder.split('/');
    if (segs.length === 3 && (folder.startsWith('.agents/skills/') || folder.startsWith('.claude/skills/'))) {
      const e = skillByName.get(segs[2]);
      if (eligible(e)) claim(folder, e);
    } else if (folder.startsWith('.stack/')) {
      const e = byId.get(folder.slice('.stack/'.length));
      if (eligible(e)) claim(folder, e);
    } else if (segs.length === 3 && folder.startsWith('src/components/')) {
      const e = pickComponent(segs[2]);
      if (e) claim(folder, e);
    }
  }
  return [...found.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}

/** Heading count: `1 look-alike entry` / `3 look-alike entries`. */
export function adoptCountText(n: number): string {
  return n === 1 ? '1 look-alike entry' : `${n} look-alike entries`;
}
