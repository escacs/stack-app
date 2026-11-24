// Project page, as a list-detail: the sidebar owns the list of imports, and
// `#/project` always lands on the Summary (counts by state, the imports that
// need attention, the project-level actions) — never a redirect. A project
// with no imports keeps one helpful empty state (adopt a folder, browse the
// catalog, create stack.toml). The detail page owns its
// actions; the quiet ones (adopt, the whole-project ops, remove) sit in a
// "⋯" overflow in its header instead of a sticky footer. App-wide state
// (app version, updater) lives in the footer line, not here. Every op
// reports its outcome as a toast (with Undo where a real inverse exists, see
// undo.ts); the detailed output panel stays only for what needs attention
// (conflicts, kept files, failures). One op runs at a time; the lock is re-read after every op, failed or not, so
// the rows never lag what the CLI last did. Update merges or leaves
// <<<<<<< markers, remove keeps edited files, sync only restores missing
// files, adopt never overwrites.
import { For, Show, createEffect, createMemo, createSignal, on, onMount, untrack } from 'solid-js';
import { errText, pickAdoptFolder, projectFolders, stackRun, type StackOut } from '../bridge';
import {
  adoptArgs,
  adoptCountText,
  adoptDryRunArgs,
  conflictsFor,
  inferAdoptCandidates,
  mapPooled,
  matchAdoptCandidates,
  type AdoptCandidate,
} from '../adopt';
import { catalogs, sourceKey, type CatalogData } from '../browseData';
import {
  describeImport,
  describeInit,
  describeRemove,
  describeSync,
  describeUpdate,
  fromStackOut,
  importArgs,
  refusalFiles,
  restoreArgs,
  updateArgs,
  type FileChoice,
  type ImportDryRunJson,
  type ImportJson,
  type InitJson,
  type JsonEntry,
  type ListJson,
  type OpSection,
  type RemoveJson,
  type SyncJson,
  type UpdateJson,
} from '../json';
import { countUpdates, editedOf, hasMissing, kindOf, missingOf, rowFacts, rowState, rowTone, rowWord, type RowState, type StatusRow } from '../parse';
import { href } from '../router';
import { config, lock, lockError, refreshLock, refreshReport, report } from '../store';
import { Button, CliErr, Empty, LinkButton, OpResult } from '../ui';
import { humanizeCliError, nameIds, nameOf, oneSentence } from '../humanize';
import { Alert } from '../ui';
import { OverflowMenu } from './Sidebar';
import { LABEL, hintOf, threadWord, toneOf, wordFor } from '../vocab';
import { Icon } from '../icons';
import { t3Info, worktreeLabel } from '../t3';
import t3Logo from '../assets/t3-code.png';
import { lockedWorktrees, runSyncAllWorktrees, syncRes, syncing } from '../worktreeSync';
import { runGuarded, useAction } from '../actions';
import { confirmDialog } from '../dialog';
import { bothSides } from '../diff';
import { bothFiles, choicesFor, clearChoices, liveChoices, mergeFiles } from '../choices';
import { UpdatePreview } from './UpdatePreview';
import { pushToast } from '../toast';
import { CONFLICT_NOTE, ReviewChanges } from './ReviewChanges';
import { opCtx, toastFailure, toastOutcome } from '../mutations';
import {
  adoptOutcome,
  initOutcome,
  removeOutcome,
  syncOutcome,
  updateOutcome,
  type Outcome,
} from '../undo';

// One stack command. `key` names the control that shows `working` while it
// runs (every other control is disabled); `label` heads its output.
type Op = {
  key: string;
  label: string;
  sub: string;
  args: string[];
  describe: (out: StackOut) => OpSection[];
  /** What the toast says (and whether it can offer Undo). */
  outcome: (out: StackOut) => Outcome;
};

function decode<T>(describe: (j: T) => OpSection[]): (out: StackOut) => OpSection[] {
  return (out) => describe(fromStackOut<T>(out));
}

// The "⋯" overflow menu (shared pill-menu surface, Escape/outside-click
// close, focus back to the trigger) lives in ./Sidebar.tsx and is reused by
// the project page header and the detail headers here, and by the sidebar's
// "Tracked imports" heading. Only items that can run right now are offered,
// so restoring missing files is hidden, not disabled.
type OverflowItem = import('./Sidebar').OverflowItem;

/** The states the summary can count, in reading order (zero counts hide, except Up to date). */
const SUMMARY_STATES: readonly RowState[] = ['imported', 'update', 'edited', 'missing', 'gone'];

/** One summary stat: the count big, the state word under it, in the state's tone. */
function StatChip(props: { state: RowState; n: number; active?: boolean; onToggle?: () => void }) {
  const body = (
    <>
      <span class="stat__n">{props.n}</span>
      <span class="stat__label">{rowWord(props.state)}</span>
    </>
  );
  return (
    <li class="stat" data-tone={rowTone(props.state)} data-state={props.state}>
      <Show when={props.onToggle} fallback={body}>
        <button
          type="button"
          class="stat__btn"
          aria-pressed={!!props.active}
          title={props.active ? 'Show every entry that needs attention' : `Show only ${rowWord(props.state).toLowerCase()}`}
          onClick={() => props.onToggle?.()}
        >
          {body}
        </button>
      </Show>
    </li>
  );
}

/** A row's state as a chip (the one word each state carries, in its one tone). */
function RowChip(props: { state: RowState }) {
  return (
    <span class="chip" data-tone={rowTone(props.state)} data-state={props.state}>
      {rowWord(props.state)}
    </span>
  );
}

export default function Project(props: { scenario: string; segs?: string[] }) {
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [logLabel, setLogLabel] = createSignal('');
  const [pending, setPending] = createSignal<string | null>(null);
  const [lookalikes, setLookalikes] = createSignal<string[]>([]);
  // Adopt picker: a folder chosen in the native dialog, confined to the
  // project by the shell. The entry is inferred from the folder name; when
  // nothing matches, a catalog-autocomplete id field is the last resort.
  const [pickOpen, setPickOpen] = createSignal(false);
  const [picking, setPicking] = createSignal(false);
  const [picked, setPicked] = createSignal<string | null>(null);
  const [pickError, setPickError] = createSignal<string | null>(null);
  const [manualId, setManualId] = createSignal('');
  let manualRef: HTMLInputElement | undefined;
  // Adopt suggestions: the catalog plus the project's folders, matched by
  // name (see adopt.ts). Hints arrive later, one dry run per candidate.
  const [entries, setEntries] = createSignal<JsonEntry[]>([]);
  const [folders, setFolders] = createSignal<string[]>([]);
  const [hints, setHints] = createSignal<Record<string, 'identical' | 'differs'>>({});
  // Dry-run hints for the picked folder, keyed per candidate: the same id
  // at another destination can differ, so the auto-list hints don't apply.
  const [pickedHints, setPickedHints] = createSignal<Record<string, 'identical' | 'differs'>>({});
  // Review changes: which row states were read in full — a key names the
  // row's commit and changed files, so an update or a new edit makes it stale
  // and the review is asked for again. The review itself lives on the detail
  // page; reading it there marks the row.
  const [reviewed, setReviewed] = createSignal<ReadonlySet<string>>(new Set<string>());
  const rowKey = (r: StatusRow): string => `${r.id}|${r.commit}|${(r.upstream ?? []).join(',')}|${r.local.join(',')}`;
  const isReviewed = (r: StatusRow): boolean => reviewed().has(rowKey(r));
  const hasChanges = (r: StatusRow): boolean => !r.gone && ((r.upstream?.length ?? 0) > 0 || r.local.length > 0);
  const payloadOf = (id: string): string | null => entries().find((e) => e.id === id)?.payload ?? null;
  // `/project/<kind>/<name>` opens one tracked import (header, source, changes, actions).
  const detailId = (): string => (props.segs ?? []).slice(1).join('/');
  const detailRow = (): StatusRow | undefined => lock().rows.find((r) => r.id === detailId());
  const detailHref = (id: string): string => href(props.scenario, 'project', ...id.split('/'));
  // Restoring does something only when at least one imported file is missing.
  const syncable = (): boolean => hasMissing(lock().rows);
  const NOTHING_TO_SYNC = 'Nothing to restore: every imported file is present';
  const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
  let adoptGen = 0;
  let hintGen = 0;
  let hintedKey = '';
  let pickedHintGen = 0;
  let pickedHintedKey = '';

  // True once the first lock read has settled: a deep link to an import must
  // not flash "not tracked" while the rows are still loading.
  const [lockSettled, setLockSettled] = createSignal(lock().rows.length > 0);
  onMount(() => void refreshLock().finally(() => setLockSettled(true)));

  // The rows that need attention, and why, for the summary.
  const attentionRows = (): StatusRow[] => lock().rows.filter((r) => rowState(r) !== 'imported');
  // A summary chip filters the list below it; clicking it again clears the filter.
  const [stateFilter, setStateFilter] = createSignal<RowState | null>(null);
  const shownRows = (): StatusRow[] => {
    const f = stateFilter();
    return f ? attentionRows().filter((r) => rowState(r) === f) : attentionRows();
  };
  const whyRow = (r: StatusRow): string => {
    const bits: string[] = [];
    const miss = missingOf(r);
    const ed = editedOf(r);
    if (r.gone) bits.push('no longer in the stack');
    if (miss.length) bits.push(`missing here: ${miss.join(', ')}`);
    if ((r.upstreamCount ?? 0) > 0 && !r.gone) bits.push(`${r.upstreamCount} file${r.upstreamCount === 1 ? '' : 's'} changed upstream`);
    if (ed.length && !r.gone) bits.push(`edited here: ${ed.join(', ')}`);
    return bits.join(' · ');
  };
  const worktrees = () => t3Info()?.worktrees ?? [];
  const allMissing = (): number => lock().rows.reduce((n, x) => n + missingOf(x).length, 0);
  // How many rows sit in one state (the summary badges).
  const stateCount = (s: RowState): number => lock().rows.filter((r) => rowState(r) === s).length;

  // Output and adopt fields belong to the project they ran against.
  createEffect(
    on(
      () => config()?.project ?? null,
      () => {
        clearOutput();
        setPickOpen(false);
        setPicked(null);
        setPickError(null);
        setManualId('');
        setEntries([]);
        setFolders([]);
        setHints({});
        setPickedHints({});
        setReviewed(new Set<string>());
        hintedKey = '';
        pickedHintedKey = '';
        // In-flight dry-run hints belong to the old project: bump both
        // generations so they resolve stale and can't stick.
        hintGen++;
        pickedHintGen++;
      },
      { defer: true },
    ),
  );

  const candidates = createMemo((): AdoptCandidate[] => {
    const ids = new Set(lock().rows.map((r) => r.id));
    return matchAdoptCandidates(folders(), entries(), ids);
  });
  const candidatesKey = createMemo(() =>
    candidates()
      .map((c) => `${c.folder}|${c.id}|${c.to ?? ''}`)
      .join('\n'),
  );
  // Manual-form autocomplete: committed entries this project never imported.
  const suggestIds = createMemo(() => {
    const ids = new Set(lock().rows.map((r) => r.id));
    return entries()
      .filter((e) => e.committed && !ids.has(e.id))
      .map((e) => e.id);
  });
  // What the picked folder could be: re-inferred when the catalog or the
  // lock lands, so a pick before the list loads still resolves.
  const pickedCands = createMemo((): AdoptCandidate[] => {
    const folder = picked();
    if (!folder) return [];
    const ids = new Set(lock().rows.map((r) => r.id));
    return inferAdoptCandidates(folder, entries(), ids);
  });
  const pickedKey = createMemo(() =>
    pickedCands()
      .map((c) => `${c.folder}|${c.id}|${c.to ?? ''}`)
      .join('\n'),
  );
  const pickedHintKey = (c: AdoptCandidate): string => `${c.folder}|${c.id}|${c.to ?? ''}`;

  // Stale-while-revalidate catalog (shared with Browse through `catalogs`)
  // plus a fresh folder listing; a failure just means no suggestions.
  async function loadAdopt(): Promise<void> {
    const c = config();
    const proj = c?.project ?? null;
    if (!proj) return;
    const key = sourceKey(c);
    const gen = ++adoptGen;
    const cached = catalogs.get(key);
    setEntries(cached?.entries ?? []);
    setFolders([]);
    setHints({});
    hintedKey = '';
    const foldersP = projectFolders(proj).then(
      (r) => r.folders,
      () => [] as string[],
    );
    const listP = stackRun('list', ['--json'], proj, c?.stackPath).then(
      (out) => out,
      () => null,
    );
    const [found, out] = await Promise.all([foldersP, listP]);
    if (gen !== adoptGen) return;
    setFolders(found);
    if (out && !(cached && cached.raw === out.stdout)) {
      try {
        const data = fromStackOut<ListJson>(out);
        const next: CatalogData = {
          raw: out.stdout,
          entries: data.entries,
          uncommitted: new Set<string>(data.uncommitted ?? []),
        };
        catalogs.set(key, next);
        setEntries(next.entries);
      } catch {
        // Keep the cached (or empty) catalog: the page works without hints.
      }
    }
  }

  // One dry run per candidate: collisions under its destination mean its
  // files differ, none mean they match the stack entry. Pooled four at a
  // time, so a long candidate list never spawns a hundred node processes at
  // once. Skipped while an op runs; the lock refresh after it re-triggers
  // this through candidatesKey.
  async function loadHints(key: string, busy: string | null): Promise<void> {
    if (busy || !key || key === hintedKey) return;
    const gen = ++hintGen;
    const c = config();
    if (!c?.project) return;
    const proj = c.project;
    const stackPath = c.stackPath;
    const found: Record<string, 'identical' | 'differs'> = {};
    await mapPooled(candidates(), 4, async (cand) => {
      try {
        const out = await stackRun('import', adoptDryRunArgs(cand), proj, stackPath);
        const data = fromStackOut<ImportDryRunJson>(out);
        const mine = conflictsFor(data.conflicts ?? [], cand.to ?? cand.folder);
        found[cand.id] = mine.length ? 'differs' : 'identical';
      } catch {
        // No hint for this one; the adopt button still works.
      }
    });
    if (gen !== hintGen) return;
    hintedKey = key;
    setHints(found);
  }

  // Same dry-run probe for the picked folder, keyed per candidate.
  async function loadPickedHints(key: string, busy: string | null): Promise<void> {
    if (busy || !key || key === pickedHintedKey) return;
    const gen = ++pickedHintGen;
    const c = config();
    if (!c?.project) return;
    const proj = c.project;
    const stackPath = c.stackPath;
    const found: Record<string, 'identical' | 'differs'> = {};
    await mapPooled(pickedCands(), 4, async (cand) => {
      try {
        const out = await stackRun('import', adoptDryRunArgs(cand), proj, stackPath);
        const data = fromStackOut<ImportDryRunJson>(out);
        const mine = conflictsFor(data.conflicts ?? [], cand.to ?? cand.folder);
        found[pickedHintKey(cand)] = mine.length ? 'differs' : 'identical';
      } catch {
        // No hint for this one; the adopt button still works.
      }
    });
    if (gen !== pickedHintGen) return;
    pickedHintedKey = key;
    setPickedHints(found);
  }

  // Suggestions load for this source; a project or stack switch reloads.
  createEffect(() => {
    sourceKey(config());
    untrack(() => void loadAdopt());
  });

  createEffect(() => {
    const key = candidatesKey();
    const busy = pending();
    untrack(() => void loadHints(key, busy));
  });

  createEffect(() => {
    const key = pickedKey();
    const busy = pending();
    untrack(() => void loadPickedHints(key, busy));
  });

  function clearOutput() {
    setSections(null);
    setFailed(null);
    setLookalikes([]);
    setLogLabel('');
  }

  async function run(op: Op): Promise<boolean> {
    const c = config();
    if (!c?.project || pending()) return false;
    setPending(op.key);
    clearOutput();
    const ctx = opCtx();
    try {
      const out = await stackRun(op.sub, op.args, c.project, c.stackPath);
      setLogLabel(op.label);
      // A non-zero exit is a failure whatever the op's parser would make of its output.
      if (out.code !== 0) fromStackOut(out);
      let o: Outcome;
      try {
        o = op.outcome(out);
      } catch {
        o = { tone: 'success', title: `Done: ${op.label}`, undo: null };
      }
      toastOutcome(o, ctx);
      // The toast carries the result; the panel stays only when something needs a look.
      if (o.tone === 'warning') setSections(op.describe(out));
      return true;
    } catch (err) {
      const text = errText(err);
      setLogLabel(op.label);
      setFailed(text);
      toastFailure(`Could not ${op.label}`, err);
      // Preset apply runs through the same import plan as import, so its
      // collisions print the same "already exist with other content" text.
      if (op.sub === 'import' || op.sub === 'preset') setLookalikes(refusalFiles(text));
      return false;
    } finally {
      await refreshLock();
      // Import, adopt (an import) and preset apply create stack.toml
      // implicitly, so the set-up slot must re-check after them, not just
      // after init.
      if (op.sub === 'init' || op.sub === 'import' || op.sub === 'preset') await refreshReport();
      setPending(null);
    }
  }

  const busyText = (key: string, text: string) => (pending() === key ? 'Working…' : text);

  // The op label heads the output unless the first section already names
  // the op (`remove x`, `update x → …`), which would print it twice.
  const sectionsHeading = () => {
    const first = sections()?.[0]?.title ?? '';
    return first.startsWith(logLabel()) ? '' : logLabel();
  };

  const needsInit = () => {
    const markers = report()?.markers ?? [];
    return (
      lock().rows.length === 0 &&
      !markers.includes('stack.toml') &&
      !markers.includes('stack.lock.json')
    );
  };

  // The per-file choices (keep mine / take upstream) become the CLI's flags; files left on Merge get none.
  const updateRow = (id: string, choices: Readonly<Record<string, FileChoice>> = {}): Op => ({
    key: `update ${id}`,
    label: `merge ${id}`,
    sub: 'update',
    args: updateArgs(id, choices),
    describe: decode<UpdateJson>(describeUpdate),
    outcome: (out) => updateOutcome(fromStackOut<UpdateJson>(out), id, { backup: true }),
  });
  /** `restore <id>`: only this import's missing files. */
  const restoreRow = (id: string): Op => ({
    key: `restore ${id}`,
    label: `restore ${id}`,
    sub: 'restore',
    args: restoreArgs([id]),
    describe: decode<SyncJson>(describeSync),
    outcome: (out) => syncOutcome(fromStackOut<SyncJson>(out)),
  });
  // The row is captured now: after the remove it is gone from the lock, and
  // an Undo needs its destination and state.
  const removeRow = (id: string): Op => {
    const row = lock().rows.find((x) => x.id === id) ?? null;
    return {
      key: `remove ${id}`,
      label: `remove ${id}`,
      sub: 'remove',
      args: [id, '--json'],
      describe: decode<RemoveJson>(describeRemove),
      outcome: (out) => removeOutcome(fromStackOut<RemoveJson>(out), row),
    };
  };
  const updateAll: Op = {
    key: 'update all',
    label: 'merge all upstream',
    sub: 'update',
    args: ['--json'],
    describe: decode<UpdateJson>(describeUpdate),
    outcome: (out) => updateOutcome(fromStackOut<UpdateJson>(out)),
  };
  // The project-wide button: `restore` with no ids puts back every import's missing files.
  const sync: Op = {
    key: 'sync',
    label: 'restore files',
    sub: 'restore',
    args: restoreArgs(),
    describe: decode<SyncJson>(describeSync),
    outcome: (out) => syncOutcome(fromStackOut<SyncJson>(out)),
  };
  const init: Op = {
    key: 'init',
    label: 'init',
    sub: 'init',
    args: ['--json'],
    describe: decode<InitJson>(describeInit),
    outcome: () => initOutcome(),
  };
  // Adopt records files already in the project; there is no undo for it on purpose.
  const adoptOp = (id: string, args: string[], key = `adopt ${id}`): Op => ({
    key,
    label: `adopt ${id}`,
    sub: 'import',
    args,
    describe: decode<ImportJson>(describeImport),
    outcome: (out) => adoptOutcome(id, fromStackOut<ImportJson>(out).imported.length > 0),
  });

  // Anything that rewrites files the user edited asks first.
  async function confirmEdited(rows: StatusRow[], title: string, description: string, confirmLabel: string): Promise<boolean> {
    const edited = rows.filter((r) => editedOf(r).length);
    if (!edited.length) return true;
    return confirmDialog({
      title,
      description,
      details: edited.flatMap((r) => editedOf(r).map((f) => `${r.path}/${f}`)),
      confirmLabel,
      tone: 'destructive',
    });
  }
  async function requestRemove(r: StatusRow): Promise<void> {
    if (pending()) return;
    const ok = await confirmEdited(
      [r],
      `Remove ${r.id}?`,
      'The entry stops being tracked. Your edited files stay on disk, so this one cannot be undone from here:',
      'Remove',
    );
    if (ok) {
      const inDetail = detailId() === r.id;
      void run(removeRow(r.id)).then(() => {
        if (inDetail && !lock().rows.some((x) => x.id === r.id)) location.hash = href(props.scenario, 'project');
      });
    }
  }
  /** Open the diff for a row and bring it into view. */
  /** The review lives on the import's detail page: open (or stay on) it. */
  function openReview(id: string): void {
    location.hash = detailHref(id);
  }
  async function requestUpdate(r: StatusRow): Promise<void> {
    if (pending()) return;
    // Rows both sides changed are never updated blind: the diff comes first.
    if (bothSides(r.upstream ?? [], editedOf(r)) && !isReviewed(r)) {
      openReview(r.id);
      pushToast({ tone: 'warning', title: `Review ${r.id} first`, description: `You edited files that upstream also changed. Read the changes, then ${LABEL.update.toLowerCase()}.` });
      return;
    }
    const both = bothFiles(r.upstream ?? [], editedOf(r));
    const choices = liveChoices(choicesFor(r.id), both);
    // Conflict markers are only mentioned while some both-changed file is still on Merge.
    const markers = mergeFiles(both, choicesFor(r.id)).length > 0;
    const ok = await confirmEdited(
      [r],
      `Update ${r.id}?`,
      markers
        ? 'Updating brings upstream changes into the files you edited; where you both changed the same lines the file gets conflict markers to resolve. Edited files:'
        : 'Updating brings upstream changes in; for the files you both changed it does what you chose. Edited files:',
      LABEL.update,
    );
    if (ok) await doUpdate(r.id, choices);
  }
  async function doUpdate(id: string, choices: Readonly<Record<string, FileChoice>>): Promise<void> {
    const done = await run(updateRow(id, choices));
    if (done) clearChoices(id);
  }
  // Preview: the same update as a dry run with the current choices; Update now runs it for real.
  const [preview, setPreview] = createSignal<{ id: string; choices: Readonly<Record<string, FileChoice>> } | null>(null);
  function openPreview(r: StatusRow): void {
    if (pending()) return;
    setPreview({ id: r.id, choices: liveChoices(choicesFor(r.id), bothFiles(r.upstream ?? [], editedOf(r))) });
  }
  async function requestUpdateAll(): Promise<void> {
    if (pending()) return;
    const rows = lock().rows.filter((r) => !r.gone && (r.upstreamCount ?? 0) > 0);
    const unseen = rows.filter((r) => bothSides(r.upstream ?? [], editedOf(r)) && !isReviewed(r));
    if (unseen.length) {
      // No list to open panels in anymore: the first unseen review's detail
      // page is where reading happens; the toast says how many remain.
      openReview(unseen[0].id);
      pushToast({
        tone: 'warning',
        title: `Review ${unseen.length} ${unseen.length === 1 ? 'import' : 'imports'} first`,
        description: `Both you and upstream changed files in them. Read the changes, then ${LABEL.updateAll.toLowerCase()}.`,
      });
      return;
    }
    const ok = await confirmEdited(
      rows,
      'Update every import that has changes waiting?',
      'Files that both you and the stack changed get conflict markers to fix by hand, unless you resolved them per import first (Keep mine / Take upstream on each import\u2019s page). Edited files:',
      LABEL.updateAll,
    );
    if (ok) void run(updateAll);
  }

  // The palette and shortcuts call these same functions.
  useAction('update-all', {
    run: requestUpdateAll,
    guard: true,
    reason: () => (pending() ? 'Another operation is running' : countUpdates(lock().rows) > 0 ? null : 'No imports have upstream changes'),
  });
  useAction('review-changes', {
    run: () => {
      const r = lock().rows.find(hasChanges);
      if (r) openReview(r.id);
    },
    reason: () => (lock().rows.some(hasChanges) ? null : 'No imports have changes to review'),
  });
  useAction('sync-missing', {
    run: async () => void (await run(sync)),
    guard: true,
    reason: () => (pending() ? 'Another operation is running' : lock().rows.length ? (syncable() ? null : NOTHING_TO_SYNC) : 'Nothing is imported yet'),
  });
  // The project-level "⋯" next to the sidebar's Tracked imports heading
  // dispatches these same actions (adopt opens the folder picker here).
  useAction('adopt-folder', {
    run: () => void pickFlow(),
    guard: true,
    reason: () => (pending() ? 'Another operation is running' : null),
  });

  function closePick() {
    setPickOpen(false);
    setPicked(null);
    setPickError(null);
    setManualId('');
    setPickedHints({});
    pickedHintedKey = '';
  }

  async function pickFlow(): Promise<void> {
    const c = config();
    if (!c?.project || pending() || picking()) return;
    setPicking(true);
    setPickError(null);
    try {
      const rel = await pickAdoptFolder(c.project);
      // The dialog outlives a project switch; a pick for the old project
      // must not open a panel on the new one.
      if (config()?.project !== c.project) return;
      // Cancel stays quiet: no panel, nothing cleared.
      if (rel == null) return;
      setPicked(rel);
      setManualId('');
      setPickedHints({});
      pickedHintedKey = '';
      setPickOpen(true);
      // The panel sits at the end of the page (it serves every branch), so
      // bring it into view once it opens.
      queueMicrotask(() => document.getElementById('adopt-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      // No match means the id field is the next step; focus it once shown.
      if (!inferAdoptCandidates(rel, entries(), new Set(lock().rows.map((r) => r.id))).length) {
        queueMicrotask(() => manualRef?.focus());
      }
    } catch (err) {
      setPicked(null);
      setPickError(errText(err));
      setPickOpen(true);
    } finally {
      setPicking(false);
    }
  }

  function submitManual() {
    const id = manualId().trim();
    const folder = picked();
    if (!id || !folder || pending()) return;
    // On success the panel closes cleared, leaving the shared output above;
    // on failure it stays open so the id can be fixed and retried.
    void run(adoptOp(id, importArgs(id, folder), 'adopt')).then((ok) => {
      if (ok) closePick();
    });
  }

  function adoptPicked(c: AdoptCandidate) {
    if (pending()) return;
    // Same one-op runner as the auto list; a differing pick refuses with the
    // look-alike list and the panel stays open for another try.
    void run(adoptOp(c.id, adoptArgs(c))).then((ok) => {
      if (ok) closePick();
    });
  }

  function adoptCandidate(c: AdoptCandidate) {
    if (pending()) return;
    // The destination is implied by the folder; a differing candidate shows
    // the same look-alike refusal as a manual adopt.
    void run(adoptOp(c.id, adoptArgs(c)));
  }

  return (
    <div class="project">
      <Show when={report()?.errors?.[0]}>
        {(e) => (
          <Alert tone="error" icon="alert" role="alert">
            {e()}
          </Alert>
        )}
      </Show>
      <Show when={config()?.project} fallback={<Empty>no project</Empty>}>
        <Show when={!detailId()} fallback={
        <Show when={detailRow()} fallback={<Show when={lockSettled()}><Empty>That import is not tracked in this project. <LinkButton variant="ghost" size="sm" href={href(props.scenario, 'project')}>Back to Project</LinkButton></Empty></Show>}>
          {(r) => {
            const upstream = () => r().upstreamCount ?? 0;
            const canUpdate = () => !r().gone && upstream() > 0;
            const miss = () => missingOf(r());
            const edited = () => editedOf(r());
            const both = () => canUpdate() && bothSides(r().upstream ?? [], edited());
            const restoreLabel = () => `Restore ${miss().length === 1 ? '1 missing file' : `${miss().length} missing files`}`;
            const needsReview = () => canUpdate() && bothSides(r().upstream ?? [], editedOf(r())) && !isReviewed(r());
            const entry = () => entries().find((e) => e.id === r().id);
            const name = () => r().id.split('/').slice(-1)[0];
            // This entry's own action, behind the header's ellipsis: remove.
            // The whole-project ops (update all, restore missing, adopt a
            // folder) live in the sidebar's project-level ellipsis next to
            // "Tracked imports" (and as buttons on the project summary), so
            // the two scopes stay separate. Remove last (files edited here
            // stay on disk).
            const overflow = (): OverflowItem[] => {
              const items: OverflowItem[] = [];
              items.push({
                key: `catalog ${r().id}`,
                label: 'View in catalog',
                title: 'Open this entry in Browse',
                onPick: () => {
                  location.hash = href(props.scenario, 'browse', ...r().id.split('/'));
                },
              });
              items.push({
                key: `remove ${r().id}`,
                label: 'Remove import',
                title: 'Unimports this entry; files edited here are kept on disk',
                danger: true,
                onPick: () => void requestRemove(r()),
              });
              return items;
            };
            return (
              <div class="entry idetail">
                <header class="doc-head">
                  <div class="doc-head__main">
                    <div class="doc-crumb">
                      <a href={href(props.scenario, 'project')}>Summary</a>
                      <span>·</span>
                      <span>{cap(kindOf(r().id))}</span>
                      <Show when={canUpdate()}>
                        <span>·</span>
                        <span>{upstream()} file{upstream() === 1 ? '' : 's'} changed upstream</span>
                      </Show>
                    </div>
                    <h1 class="doc-title">{name()}</h1>
                    <Show when={entry()?.summary}>
                      {(t) => <p class="doc-lead">{t()}</p>}
                    </Show>
                  </div>
                  <div class="doc-actions">
                    <For each={rowFacts(r())}>{(st) => <RowChip state={st} />}</For>
                    <Show when={miss().length}>
                      <Button
                        variant="obsidian"
                        title="Puts back this import’s missing files from the stack; your edits are never touched"
                        disabled={!!pending()}
                        onClick={() => void runGuarded('restore-entry', async () => void (await run(restoreRow(r().id))))}
                      >
                        {busyText(`restore ${r().id}`, restoreLabel())}
                      </Button>
                    </Show>
                    <Show when={canUpdate()}>
                      <div class="doc-actions__col">
                        <Button
                          variant={miss().length || both() ? 'raised' : 'obsidian'}
                          title={needsReview() ? 'You and upstream both changed files: read the changes below first' : 'Brings the stack\u2019s changes in; conflicts get <<<<<<< markers'}
                          disabled={!!pending()}
                          onClick={() => void requestUpdate(r())}
                        >
                          {busyText(`update ${r().id}`, needsReview() ? LABEL.reviewChanges : LABEL.update)}
                        </Button>
                        <Show when={both()}>
                          <p class="doc-actions__note">{CONFLICT_NOTE}</p>
                        </Show>
                      </div>
                    </Show>
                    <OverflowMenu disabled={!!pending() || picking()} items={overflow} />
                  </div>
                </header>
                <div class="facts">
                  <div class="fact">
                    <div class="fact__label">Target path</div>
                    <div class="fact__value fact__value--path">{r().path}</div>
                  </div>
                  <div class="fact">
                    <div class="fact__label">Upstream source</div>
                    <div class="fact__value">stack · @{r().commit.slice(0, 7)}</div>
                  </div>
                  <Show when={edited().length}>
                    <div class="fact">
                      <div class="fact__label">Edited here</div>
                      <div class="fact__value">{edited().join(', ')}</div>
                    </div>
                  </Show>
                  <div class="fact">
                    <div class="fact__label">Catalog</div>
                    <div class="fact__value fact__value--link">
                      <LinkButton variant="ghost" size="sm" href={href(props.scenario, 'browse', ...r().id.split('/'))}>View in catalog</LinkButton>
                    </div>
                  </div>
                </div>
                <Show when={miss().length}>
                  <Alert tone="warning" icon="alert" role="status">
                    <span class="sa-alert__title">{miss().length === 1 ? '1 imported file is missing' : `${miss().length} imported files are missing`}</span>
                    <span class="sa-alert__description">
                      {miss().join(', ')} {miss().length === 1 ? 'is' : 'are'} in the stack but no longer in this project. {restoreLabel()} puts {miss().length === 1 ? 'it' : 'them'} back; your edits are never touched.
                    </span>
                  </Alert>
                </Show>
                <Show
                  when={hasChanges(r())}
                  fallback={
                    <Alert tone="neutral" role="status">
                      Files match the lock: nothing changed upstream or here.
                    </Alert>
                  }
                >
                  <h2>Changes</h2>
                  <ReviewChanges
                    embedded
                    row={r()}
                    payload={payloadOf(r().id)}
                    busy={!!pending()}
                    updateLabel={bothSides(r().upstream ?? [], editedOf(r())) ? LABEL.reviewChanges : LABEL.update}
                    onLoaded={(k) => setReviewed((s) => new Set<string>(s).add(k))}
                    onUpdate={() => void requestUpdate(r())}
                    onPreview={() => openPreview(r())}
                    onClose={() => undefined}
                  />
                </Show>
              </div>
            );
          }}
        </Show>
        }>
        <header class="doc-head page-head">
          <div class="doc-head__main">
            <div class="doc-crumb">
              <span>Project</span>
              <Show when={lock().rows.length}>
                <span>·</span>
                <span>{lock().rows.length} import{lock().rows.length === 1 ? '' : 's'}</span>
              </Show>
              <Show when={lock().commit}>
                <span>·</span>
                <span class="mono" title="stack commit the lock was last synced to">stack @{(lock().commit ?? '').slice(0, 7)}</span>
              </Show>
            </div>
            <h1 class="doc-title">{(config()?.project ?? '').split(/[\\/]+/).filter(Boolean).pop()}</h1>
            <p class="doc-lead">{config()?.project}</p>
          </div>
        </header>
        <Show when={lockError()}>
          {(e) => <CliErr text={e()} />}
        </Show>
        {/*
          Project summary: the landing for `#/project` when nothing needs
          attention, and the page the sidebar's Summary item returns to.
          State badges, the entries that need attention (each with a jump to
          its review), and the project-level actions as buttons — the same
          actions also sit in the sidebar's "⋯" next to Tracked imports.
        */}
        <Show when={lock().rows.length && !lockError()}>
          <section class="proj-summary" aria-label="Project summary">
            <Show
              when={attentionRows().length}
              fallback={
                <p class="proj-summary__ok" role="status">
                  <Icon name="check" size={16} />
                  <span>Everything is up to date</span>
                  <Show when={lock().commit}>
                    <span class="dimtxt">· stack @{(lock().commit ?? '').slice(0, 7)}</span>
                  </Show>
                </p>
              }
            >
              <ul class="stats" aria-label="Imports by state">
                <For each={SUMMARY_STATES}>
                  {(st) => (
                    <Show when={st === 'imported' || stateCount(st) > 0}>
                      <StatChip
                        state={st}
                        n={stateCount(st)}
                        active={stateFilter() === st}
                        onToggle={st === 'imported' ? undefined : () => setStateFilter((f) => (f === st ? null : st))}
                      />
                    </Show>
                  )}
                </For>
              </ul>
              <h2 class="proj-summary__head">Needs attention</h2>
              <ul class="proj-summary__list">
                <For each={shownRows()}>
                  {(r) => (
                    <li class="proj-summary__row">
                      <span class="proj-summary__name" title={r.id}>{nameOf(r.id)}</span>
                      <RowChip state={rowState(r)} />
                      <span class="proj-summary__why">{whyRow(r)}</span>
                      <Button size="sm" onClick={() => openReview(r.id)}>
                        Review
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <div class="proj-summary__actions">
              <Show when={countUpdates(lock().rows) > 0}>
                <Button
                  variant="obsidian"
                  disabled={!!pending()}
                  title="Brings the stack’s changes into every import that has an update waiting"
                  onClick={() => void runGuarded('update-all', requestUpdateAll)}
                >
                  {busyText('update all', LABEL.updateAll)}
                </Button>
              </Show>
              <Show when={syncable()}>
                <Button
                  disabled={!!pending()}
                  title="Restores imported files that are missing, from the stack; edits are never touched"
                  onClick={() => void runGuarded('sync-missing', async () => void (await run(sync)))}
                >
                  {busyText('sync', `Restore ${allMissing()} missing ${allMissing() === 1 ? 'file' : 'files'}`)}
                </Button>
              </Show>
            </div>
            {/* Worktrees: the project-level view of where imports are tracked, with the one
                action that spans them. The sidebar keeps the switcher; this is the overview. */}
            <Show when={worktrees().length > 1}>
              <h2 class="proj-summary__head">Worktrees</h2>
              <ul class="proj-summary__list wtlist" aria-label="Worktrees">
                <For each={worktrees()}>
                  {(w) => {
                    const word = () => wordFor(w.hasLock ? 'Tracked' : 'No lock');
                    return (
                      <li class="proj-summary__row">
                        <Icon name="branch" size={14} />
                        <span class="proj-summary__name">{w.branch ?? (w.detached ? 'detached' : worktreeLabel(w))}</span>
                        <Show when={w.isCurrent}>
                          <span class="dimtxt">{LABEL.importingHere}</span>
                        </Show>
                        <span class="chip proj-summary__state" data-tone={toneOf(word())} title={hintOf(word())}>{word()}</span>
                      </li>
                    );
                  }}
                </For>
              </ul>
              <Show when={lockedWorktrees() > 0}>
                <div class="proj-summary__actions">
                  <Button
                    disabled={syncing()}
                    title="Run the same update in every worktree that holds a lock entry"
                    onClick={() => void runSyncAllWorktrees()}
                  >
                    {syncing() ? 'Updating…' : LABEL.updateAllWorktrees}
                  </Button>
                  <Show when={syncRes()}>
                    {(r) => (
                      <span class="dimtxt" role="status" title={r().rows.map((x) => `${nameOf(x.label)}: ${x.status === 'error' ? oneSentence(humanizeCliError(x.detail)) : x.detail}`).join('\n')}>
                        Updated {r().synced}
                        {r().skipped ? ` · ${r().skipped} not set up` : ''}
                        {r().failed ? ` · ${r().failed} failed` : ''}
                      </span>
                    )}
                  </Show>
                </div>
              </Show>
            </Show>
            {/* T3 Code threads for this project: a compact list next to the worktrees; a row opens its thread in T3 Code. */}
            <Show when={t3Info()?.t3Available}>
              <h2 class="proj-summary__head">
                <img class="navgroup__logo" src={t3Logo} alt="" width="14" height="14" aria-hidden="true" />
                T3 threads
              </h2>
              <Show
                when={(t3Info()?.threads ?? []).length}
                fallback={<p class="dimtxt">{t3Info()?.registered ? 'No threads for this project yet.' : 'Add this project in T3 Code to list its threads.'}</p>}
              >
                <ul class="proj-summary__list wtlist" aria-label="T3 threads">
                  <For each={t3Info()?.threads ?? []}>
                    {(t) => {
                      const word = () => threadWord(t.status);
                      const tip = () => [t.branch ?? (t.worktreePath ? 'worktree' : 'main'), t.model, t.provider].filter(Boolean).join(' · ');
                      return (
                        <li class="proj-summary__row">
                          <Icon name="terminal" size={14} />
                          <Show when={t.link} fallback={<span class="proj-summary__name" title={tip()}>{t.title}</span>}>
                            {(l) => (
                              <a class="proj-summary__name" href={l()} target="_blank" rel="noopener noreferrer" title={`${tip()} · opens the thread in T3 Code`}>
                                {t.title}
                              </a>
                            )}
                          </Show>
                          <span class="chip proj-summary__state" data-tone={toneOf(word())}>{word()}</span>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            </Show>
          </section>
        </Show>
        <>
        {/*
          Empty project: one helpful empty state. Adopt a folder… is the
          call to action (files already here that look like stack entries
          get recorded without being changed); Browse the catalog is the
          other way in. Until per-worker setup lands (part B of #1, waiting
          on escacs/stack#14 worker preselect and #15 `init --worker`), a
          project without stack.toml also gets the plain init action; its
          explanation lives in the tooltip.
        */}
        <Show when={!lock().rows.length} fallback={<Show when={lockError()}><Empty>Nothing imported.</Empty></Show>}>
          <section class="firstrun" aria-labelledby="firstrun-title">
            <h2 id="firstrun-title" class="firstrun__title">Nothing imported here yet</h2>
            <Show
              when={needsInit()}
              fallback={
                <p class="firstrun__text">
                  <code class="mono">stack.toml</code> is here; once an entry lands, the sidebar lists it and this page opens its detail.
                </p>
              }
            >
              <p class="firstrun__text">
                The <b>stack</b> is a shared catalog of skills, styles and components. Importing an entry copies its files into this
                project. Your <b>worker</b> is the profile whose skills and style come along. <code class="mono">stack.toml</code> is the
                small file in this project that remembers what you imported and from where.
              </p>
            </Show>
            <p class="firstrun__cta">Already have skills in this repo?</p>
            <div class="firstrun__actions">
              <Button
                variant="obsidian"
                title="pick a folder in this project to adopt: the entry is inferred from the folder name"
                disabled={!!pending() || picking()}
                onClick={() => void pickFlow()}
              >
                {picking() ? 'Picking…' : 'Adopt a folder…'}
              </Button>
              <LinkButton href={href(props.scenario, 'browse')}>Browse the catalog</LinkButton>
              <Show when={needsInit()}>
                <Button
                  size="sm"
                  title="no stack.toml here yet: init creates it so imports have somewhere to live. Also adds the managed .gitignore block and migrates a legacy stack.lock.json"
                  disabled={!!pending()}
                  onClick={() => void run(init)}
                >
                  {busyText('init', 'Create stack.toml')}
                </Button>
              </Show>
            </div>
          </section>
        </Show>
        {/*
          Adopt candidates: folders that look like stack entries this project
          never imported — one line each with its adopt button. The picker
          resolves the entry from the folder name, so no id is typed; the
          plain `Adopt a folder…` trigger lives in the header's "⋯" and the
          empty state above.
        */}
        <div class="adopt-block">
          <Show when={candidates().length}>
            <p
              class="dimtxt found"
              title="these folders look like stack entries that were never imported: adopting records identical files in stack.toml, and lists differing files without writing anything"
            >
              found in project: {adoptCountText(candidates().length)}
            </p>
            <div class="adopt-list">
              <For each={candidates()}>
                {(c) => (
                  <div class="adopt-row">
                    <span title={c.to ? `adopts into ${c.to}` : 'adopts into its default place'}>
                      {c.folder} → {c.id}
                    </span>
                    <Show when={hints()[c.id]}>
                      <span class="dimtxt">({hints()[c.id]})</span>
                    </Show>
                    <Button size="sm"
                      
                      title={
                        hints()[c.id] === 'differs'
                          ? 'the files differ, so this lists them and writes nothing'
                          : 'records these files in stack.toml without changing them'
                      }
                      disabled={!!pending()}
                      onClick={() => adoptCandidate(c)}
                    >
                      {busyText(`adopt ${c.id}`, 'Adopt')}
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>


        </>

        </Show>
        {/*
          Adopt picker panel: it belongs to the whole page, so adopting from
          the empty state's call to action and from a detail header's "⋯"
          both land here. The folder is resolved to an entry after picking;
          the header "⋯" and the empty state own the trigger.
        */}
        <>
            <Show when={pickOpen()}>
              <div class="adopt-picked" id="adopt-panel">
              <Show when={pickError()}>
                {(e) => (
                  <Alert tone="error" icon="alert" role="alert">
                    {e()}
                  </Alert>
                )}
              </Show>
              <Show when={picked() && !pickError()}>
                <Show when={pickedCands().length === 1 ? pickedCands()[0] : undefined}>
                  {(cand) => {
                    const hint = () => pickedHints()[pickedHintKey(cand())];
                    return (
                      <div class="adopt-row">
                        <span
                          title={
                            cand().to ? `adopts into ${cand().to}` : 'adopts into its default place'
                          }
                        >
                          {cand().folder} → {cand().id}
                        </span>
                        <Show when={hint()}>
                          <span class="dimtxt">({hint()})</span>
                        </Show>
                        <Button size="sm"
                        
                          title={
                            hint() === 'differs'
                              ? 'the files differ, so this lists them and writes nothing'
                              : 'records these files in stack.toml without changing them'
                          }
                          disabled={!!pending()}
                          onClick={() => adoptPicked(cand())}
                        >
                          {busyText(`adopt ${cand().id}`, 'Adopt')}
                        </Button>
                      </div>
                    );
                  }}
                </Show>
                <Show when={pickedCands().length > 1}>
                  <p class="dimtxt">{picked()} — several entries match this folder:</p>
                  <div class="adopt-list">
                    <For each={pickedCands()}>
                      {(cand) => {
                        const hint = () => pickedHints()[pickedHintKey(cand)];
                        return (
                          <div class="adopt-row">
                            <span title={cand.to ? `adopts into ${cand.to}` : 'adopts into its default place'}>
                              {cand.folder} → {cand.id}
                            </span>
                            <Show when={hint()}>
                              <span class="dimtxt">({hint()})</span>
                            </Show>
                            <Button size="sm"
                            
                              title={
                                hint() === 'differs'
                                  ? 'the files differ, so this lists them and writes nothing'
                                  : 'records these files in stack.toml without changing them'
                              }
                              disabled={!!pending()}
                              onClick={() => adoptPicked(cand)}
                            >
                              {busyText(`adopt ${cand.id}`, 'Adopt')}
                            </Button>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
                <Show when={picked() && pickedCands().length === 0}>
                  <p class="dimtxt">{picked()} — no stack entry matches this folder</p>
                  <form
                    class="adopt"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitManual();
                    }}
                  >
                    <input
                      type="text"
                      ref={(el) => (manualRef = el)}
                      value={manualId()}
                      onInput={(e) => setManualId(e.currentTarget.value)}
                      placeholder="entry id, e.g. skills/file-pr"
                      aria-label="entry id to adopt"
                      list="adopt-id-list"
                      size={30}
                    />
                    <datalist id="adopt-id-list">
                      <For each={suggestIds()}>{(id) => <option value={id} />}</For>
                    </datalist>
                    <Button size="sm"
                      type="submit"
                    
                      disabled={!!pending() || !manualId().trim()}
                    >
                      {busyText('adopt', 'Adopt')}
                    </Button>
                  </form>
                </Show>
              </Show>
              <Button size="sm"  title="dismiss this pick" onClick={closePick}>
                close
              </Button>
              </div>
            </Show>
        </>

        <Show when={failed()}>
          <h2>{nameIds(logLabel())}</h2>
          <Show
            when={lookalikes().length}
            fallback={<CliErr text={failed() as string} />}
          >
            <CliErr text={failed() as string} />
          </Show>
        </Show>
        <Show when={sections()}>
          <OpResult sections={sections() as OpSection[]} label={sectionsHeading()} />
        </Show>

      </Show>
      <Show when={preview()}>
        {(p) => (
          <UpdatePreview
            id={p().id}
            choices={p().choices}
            onClose={() => setPreview(null)}
            onConfirm={() => {
              const { id, choices } = p();
              setPreview(null);
              void runGuarded('update-entry', () => doUpdate(id, choices));
            }}
          />
        )}
      </Show>
    </div>
  );
}
