// Outcome and undo planning for every mutation (no DOM, no bridge): what the
// toast says, and, when the operation really has an inverse, the stack
// commands that undo it. An operation without a true inverse (update, restore
// missing files, init, adopt) plans no undo, so its toast shows no Undo button.
//   import  ->  remove what the import wrote (it was just created)
//   remove  ->  re-import the same entry to the same destination, but only
//               when nothing is lost: no local edits (they stay on disk and
//               would collide), still in the stack, no pending upstream
//               change (an import takes the current stack commit, so the
//               restored files would differ from what was removed)
//   preset  ->  remove what the preset wrote
//   worktree switch -> install into the previous worktree again
import type { ImportJson, PresetApplyJson, RemoveJson, SyncJson, UpdateJson } from './json';
import { importArgs } from './json';
import type { StatusRow } from './parse';
import { updateResultSentences } from './humanize';
import type { ToastInput } from './toast';

export type UndoStep = {
  sub: 'import' | 'remove';
  args: string[];
  /** The entry this step touches (for messages). */
  id: string;
};

export type Outcome = {
  tone: 'success' | 'info' | 'warning';
  title: string;
  description?: string;
  /** Inverse commands, in order; null when the operation cannot be undone. */
  undo: UndoStep[] | null;
  /** What the follow-up toast says once the undo has run. */
  undone?: string;
};

const plural = (n: number, w: string, p = `${w}s`): string => `${n} ${n === 1 ? w : p}`;

/** `a, b and 2 more` for a short description line. */
export function listIds(ids: readonly string[], max = 3): string {
  if (ids.length <= max) return ids.join(', ');
  return `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`;
}

/** remove steps for the entries an operation just wrote, main entry first. */
export function removeSteps(written: readonly { id: string }[]): UndoStep[] | null {
  const ids = [...new Set(written.map((w) => w.id))];
  return ids.length ? ids.map((id) => ({ sub: 'remove', args: [id, '--json'], id })) : null;
}

/** import step restoring a removed row, or null when the restore would not be faithful. */
export function planUndoRemove(row: StatusRow | null | undefined): UndoStep[] | null {
  if (!row) return null;
  if (row.gone || row.local.length > 0 || (row.upstreamCount ?? 0) > 0) return null;
  return [{ sub: 'import', args: importArgs(row.id, row.path), id: row.id }];
}

export function importOutcome(r: Pick<ImportJson, 'imported' | 'already'>, wanted?: string): Outcome {
  const ids = r.imported.map((p) => p.id);
  if (!ids.length) {
    const id = wanted ?? r.already[0];
    return { tone: 'info', title: id ? `Already imported ${id}` : 'Nothing to import', undo: null };
  }
  const main = wanted && ids.includes(wanted) ? wanted : ids[0];
  const deps = ids.filter((i) => i !== main);
  return {
    tone: 'success',
    title: ids.length === 1 ? `Imported ${main}` : `Imported ${main} and ${plural(deps.length, 'dependency', 'dependencies')}`,
    description: deps.length ? `Also ${listIds(deps)}` : r.imported[0]?.path,
    undo: removeSteps(r.imported),
    undone: `Undid import of ${main}`,
  };
}

/** Several rows imported in one go (batch import). */
export function batchOutcome(c: { imported: readonly string[]; already: number; refused: number; stopped: boolean }): Outcome {
  const n = c.imported.length;
  const bits = [c.already ? `${c.already} already there` : '', c.refused ? `${c.refused} refused` : '', c.stopped ? 'stopped early' : ''].filter(Boolean);
  return {
    tone: c.refused || c.stopped ? 'warning' : n ? 'success' : 'info',
    title: n ? `Imported ${plural(n, 'entry', 'entries')}` : 'Nothing imported',
    description: [n ? listIds(c.imported) : '', ...bits].filter(Boolean).join(' · ') || undefined,
    undo: removeSteps(c.imported.map((id) => ({ id }))),
    undone: `Undid import of ${plural(n, 'entry', 'entries')}`,
  };
}

export function removeOutcome(r: Pick<RemoveJson, 'removed' | 'kept' | 'requiredBy'>, row?: StatusRow | null): Outcome {
  const bits: string[] = [];
  if (r.kept.length) bits.push(`Kept ${plural(r.kept.length, 'edited file')}: ${listIds(r.kept, 2)}`);
  if (r.requiredBy.length) bits.push(`${listIds(r.requiredBy)} still require${r.requiredBy.length === 1 ? 's' : ''} it`);
  return {
    tone: r.kept.length || r.requiredBy.length ? 'warning' : 'success',
    title: `Removed ${r.removed}`,
    description: bits.join(' · ') || undefined,
    undo: r.kept.length ? null : planUndoRemove(row),
    undone: `Restored ${r.removed}`,
  };
}

export function updateOutcome(r: UpdateJson, id?: string, opts: { backup?: boolean } = {}): Outcome {
  const n = r.updated.length;
  if (!n && !r.conflicts.length && !r.merged.length && !r.gone.length && !r.unmatched?.length) {
    return { tone: 'info', title: id ? `${id} is up to date` : 'Everything is up to date', undo: null };
  }
  const bad = r.conflicts.length;
  const title = id ? `Updated ${id}` : `Updated ${plural(n, 'entry', 'entries')}`;
  const bits = [
    bad ? `${plural(bad, 'conflict')} to resolve` : '',
    r.kept.length ? `${plural(r.kept.length, 'edited file')} kept` : '',
    r.gone.length ? `${plural(r.gone.length, 'entry', 'entries')} gone from the stack` : '',
    r.unmatched?.length ? `${plural(r.unmatched.length, 'choice')} matched no changed file` : '',
    !bad && n && !id ? listIds(r.updated.map((u) => u.id)) : '',
  ].filter(Boolean);
  // Per-file sentences (kept yours, replaced, markers written) come after the summary bits.
  const sentences = updateResultSentences(r, opts);
  const description = [bits.join(' · '), ...sentences].filter(Boolean).join('\n') || undefined;
  // An update has no true inverse (merged files cannot be un-merged), so no Undo; a took-upstream backup is named in the text.
  const warn = bad || r.gone.length || r.unmatched?.length;
  return { tone: warn ? 'warning' : 'success', title: bad ? `${title} with conflicts` : n ? title : id ? `${id} is up to date` : 'Nothing to update', description, undo: null };
}

export function syncOutcome(r: SyncJson): Outcome {
  if (!r.restored.length && !r.kept.length && !r.skipped.length) {
    return { tone: 'info', title: 'Nothing was missing', description: 'Every imported file is already in place.', undo: null };
  }
  const bits = [r.kept.length ? `${plural(r.kept.length, 'edited file')} kept` : '', r.skipped.length ? `${r.skipped.length} skipped` : ''].filter(Boolean);
  return {
    tone: r.skipped.length ? 'warning' : 'success',
    title: r.restored.length ? `Restored ${plural(r.restored.length, 'file')}` : 'No files restored',
    description: bits.join(' · ') || undefined,
    undo: null,
  };
}

export function presetOutcome(r: Pick<PresetApplyJson, 'preset' | 'imported' | 'already'>): Outcome {
  const n = r.imported.length;
  return {
    tone: n ? 'success' : 'info',
    title: n ? `Imported preset ${r.preset}` : `Preset ${r.preset} was already imported`,
    description: n ? `Imported ${plural(n, 'entry', 'entries')}${r.already.length ? `, ${r.already.length} already there` : ''}` : undefined,
    undo: removeSteps(r.imported),
    undone: `Undid preset ${r.preset}`,
  };
}

export function initOutcome(): Outcome {
  return { tone: 'success', title: 'Created stack.toml', description: 'Imports have somewhere to live now.', undo: null };
}

export function adoptOutcome(id: string, imported: boolean): Outcome {
  // Adopting records files that were already there: removing the entry would
  // delete the user's own folder, so there is deliberately no undo.
  return imported
    ? { tone: 'success', title: `Adopted ${id}`, description: 'Recorded in stack.toml, files untouched.', undo: null }
    : { tone: 'info', title: `Already tracking ${id}`, undo: null };
}

/**
 * The worktree switch, in words (formerly the "retarget" toast): imports and
 * updates land in `label` now, and Undo installs back into `from` — reached
 * only when there was a previous worktree to go back to.
 */
export function retargetToast(label: string, from: string | null, back: (dir: string) => void): ToastInput {
  return {
    tone: 'info',
    title: `Installing into ${label}`,
    description: 'Imports and updates land in this worktree now.',
    action: from ? { label: 'Undo', run: () => back(from) } : undefined,
  };
}

/** How long a toast stays, by tone and whether it offers an action; hover pauses it. */
export function toastTtl(tone: string | undefined, hasAction: boolean): number {
  if (tone === 'error') return 8000;
  return hasAction ? 6000 : 3500;
}
