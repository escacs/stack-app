// Browse: the catalog as a full-width list. Each row carries an Open and an
// Import button; the list is dominant and nothing is previewed until asked.
// Open (button, double-click, Enter, `o`) puts the entry in the route
// (#…/browse/<kind>/<id>) and the view becomes list + detail; Close or Esc
// returns to the full list. Selection is the file-list model, with no mode: a
// click selects a row, Ctrl/Shift extend it, and 2+ selected rows turn the
// filter row into an Import N bar. Importing always goes through the file-level
// import plan (ImportPlan): inside the detail when that entry is open, in a
// dialog otherwise. Confirm writes, and the plan is cleared afterwards with
// the Undo toast left in place. Hotkeys (/ j k o i a r space Esc, Ctrl+A) keep
// working; under 900px the detail takes over the sheet with a back button.
// Pure logic: ../browseData (routes, cache), ../browseList (filter, sort,
// match marks), ../plan (the plan tree).
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import { errText, stackRun } from '../bridge';
import { href } from '../router';
import { Portal } from 'solid-js/web';
import { Modal } from '../dialog';
import { pluralOf } from '../parse';
import { moveSel } from '../onboard';
import { scrollByPage, scrollToTop } from '../smooth';
import {
  batchDest,
  batchSummary,
  defaultImportDest,
  fromStackOut,
  importArgs,
  importDestHint,
  needsImportDest,
  planBatch,
  previewFresh,
  type BatchCounts,
  type BatchPlan,
  type ImportJson,
  type JsonEntry,
  type ListJson,
} from '../json';
import { config, lock, refreshLock, refreshReport } from '../store';
import { t3Info } from '../t3';
import { LABEL } from '../vocab';
import { Alert, Button, CliErr, FilterMenu, IconButton, LinkButton, TechDetails } from '../ui';
import { Icon } from '../icons';
import { rovingBar } from '../roving';
import { useAction } from '../actions';
import { toastFailure, toastOutcome } from '../mutations';
import { pushToast } from '../toast';
import { batchOutcome, importOutcome } from '../undo';
import { mapPooled } from '../adopt';
import {
  buildIndex,
  catalogs,
  clearCatalogs,
  clearPreviews,
  notImportedIds,
  pruneSelection,
  selectClick,
  refreshLine,
  resolveRoute,
  sameRoute,
  sourceKey,
  type CatalogData,
  type CatalogIndex,
  type Route,
  crumbParts,
  librarySeg,
  upRoute,
} from '../browseData';
import {
  CHIPS,
  chipCounts,
  filterEntries,
  indexOfEntry,
  inKind,
  inLibrary,
  matchesOutsideScope,
  searchEscape,
  searchPlaceholder,
  routeSelection,
  sortEntries,
  toggleChip,
  type ChipKey,
} from '../browseList';
import { collidingTargets, mergePlans, runnable, type Plan } from '../plan';
import { humanizeCliError, nameOf, oneSentence } from '../humanize';
import { clearListings, planImport } from '../planLoad';
import { readImportedAt, recordImported } from '../remember';
import { publishCatalog, publishQuery, publishScope } from '../catalog';
import { scoreEntries } from '../site';
import { refreshErrorText, RefreshButton, type RefreshState } from './BrowseRefresh';
import { EntryRow } from './EntryRow';
import { FolderRow } from './FolderRow';
import { expandFolder, folderChecked, folderImport, folderKey, foldersTouched, listRows, rowIds, selectionLabel, type Folder, type ListRow } from '../folders';
import { EntryPreview } from './EntryPreview';
import { ImportPlan, type PlanView } from './ImportPlan';
import { PresetList } from './PresetList';
import { ensurePresets } from '../presets';

/** One planned batch import: '' dest means the CLI default. */
type BatchTarget = { id: string; dest: string };

/** A refused batch entry, with the same details as a failed single import. */
type BatchRefusal = { id: string; line: string; err: string };

/**
 * Batch import state: the file plan first (nothing written yet), then the
 * sequential run, then the summary. `label` names the scope (`skills`, or
 * `3 selected`). Only one batch runs at a time, and never beside a single
 * import.
 */
type BatchState =
  | {
      phase: 'confirm';
      label: string;
      plan: BatchPlan;
      base: string;
      targets: BatchTarget[];
      /** Each requested entry's own plan (with its dependencies), for the skip rule. */
      per: Map<string, Plan>;
      /** Entries whose dry run failed, with the reason in plain words. */
      errs: Map<string, string>;
      /** A folder typed for one colliding entry (key present: its controls stay up). */
      dests: Map<string, string>;
      /** Entries the user chose to skip. */
      skip: Set<string>;
      view: PlanView;
    }
  | { phase: 'running'; label: string; targets: BatchTarget[]; at: number; counts: BatchCounts; cancel: boolean }
  | { phase: 'done'; label: string; counts: BatchCounts; refusals: BatchRefusal[]; expanded: boolean };

/** A single-entry import plan: the destination being edited, what the dry run found, a failed attempt. */
type Single = { id: string; dest: string; view: PlanView; failure: string | null; running: boolean };

const batchConfirm = (b: BatchState | null) => (b?.phase === 'confirm' ? b : null);
const batchRunning = (b: BatchState | null) => (b?.phase === 'running' ? b : null);
const batchDone = (b: BatchState | null) => (b?.phase === 'done' ? b : null);
const batchBusyState = (b: BatchState | null): boolean => b?.phase === 'confirm' || b?.phase === 'running';

/** The entries of a batch that would really be written: no failed dry run, no collision. */
const runnableTargets = (b: Pick<Extract<BatchState, { phase: 'confirm' }>, 'targets' | 'per' | 'errs' | 'skip'>): BatchTarget[] =>
  runnable(b.targets, b.per, b.errs).filter((t) => !b.skip.has(t.id));

/**
 * In-flight import ops, across navigation: a route change clears the plan and
 * batch UI state but not the CLI call in flight, so the one-op-at-a-time
 * guard needs a counter that survives both navigation and remounts.
 */
let opsInFlight = 0;
const [opsBusy, setOpsBusy] = createSignal(false);
const beginOp = (): void => {
  opsInFlight += 1;
  setOpsBusy(true);
};
const endOp = (): void => {
  opsInFlight = Math.max(0, opsInFlight - 1);
  if (!opsInFlight) setOpsBusy(false);
};

const NARROW = '(max-width: 899.98px)';
const SINGLE_DEBOUNCE_MS = 350;

export default function Browse(props: { scenario: string; segs: string[] }) {
  const [entries, setEntries] = createSignal<JsonEntry[]>([]);
  const [note, setNote] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [q, setQ] = createSignal('');
  const [chips, setChips] = createSignal<ReadonlySet<ChipKey>>(new Set<ChipKey>());
  // The cursor is an entry id, so filters and sorts that move rows keep it on the same entry.
  const [curId, setCurId] = createSignal<string | null>(null);
  // Ids of the selected rows (a folder row stands for its pickable members); `anchor` is the row key ranges start from.
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [batch, setBatch] = createSignal<BatchState | null>(null);
  const [single, setSingle] = createSignal<Single | null>(null);
  // Ids this run imported, until the lock refresh makes them official.
  const [landed, setLanded] = createSignal<Set<string>>(new Set());
  const [rs, setRs] = createSignal<RefreshState | null>(null);
  const [narrow, setNarrow] = createSignal(typeof matchMedia === 'function' && matchMedia(NARROW).matches);
  const [announce, setAnnounce] = createSignal('');
  const [importedAt, setImportedAt] = createSignal<Map<string, number>>(new Map());
  let inputEl: HTMLInputElement | undefined;
  let listEl: HTMLDivElement | undefined;
  let listGen = 0;
  // Import generation, bumped on navigation and project switch: an import
  // resolving afterwards is stale and must not land (see previewFresh).
  let qiGen = 0;
  // Plan generation: an edit or a new plan restarts the dry runs, older answers drop.
  let planGen = 0;
  let anchor: string | null = null;
  let planTimer: ReturnType<typeof setTimeout> | undefined;
  const clearPlanTimer = (): void => {
    if (planTimer !== undefined) {
      clearTimeout(planTimer);
      planTimer = undefined;
    }
  };
  onCleanup(clearPlanTimer);
  let rsTimer: ReturnType<typeof setTimeout> | undefined;
  const clearRsTimer = (): void => {
    if (rsTimer !== undefined) {
      clearTimeout(rsTimer);
      rsTimer = undefined;
    }
  };
  onCleanup(clearRsTimer);
  // Leaving Browse mid-batch stops the run after the current entry.
  onCleanup(() => {
    qiGen++;
    planGen++;
  });

  onMount(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    onCleanup(() => mq.removeEventListener('change', on));
  });

  // Changes only when the project or stack checkout does, never on config edits.
  const source = createMemo(() => sourceKey(config()));
  const project = (): string | null => config()?.project ?? null;
  createEffect(() => setImportedAt(readImportedAt(project())));
  const route = createMemo<Route>(() => resolveRoute(props.segs, entries()), { kind: 'home' }, { equals: sameRoute });
  /** The Presets kind: bundles of entries, listed in the same full-width list. */
  const presetsMode = createMemo(() => route().kind === 'presets');
  const routeSel = createMemo(() => routeSelection(route(), entries()));
  const routeKey = createMemo(() => `${routeSel().kind ?? ''}|${routeSel().library ?? ''}|${routeSel().entryId ?? ''}`);
  const index = createMemo<CatalogIndex>(() => buildIndex(entries()));
  /** The entry whose detail is open: the one the route names. */
  const openEntry = createMemo((): JsonEntry | null => (routeSel().entryId && !routeSel().missing ? (index().byId.get(routeSel().entryId as string) ?? null) : null));
  /**
   * The kind the list is scoped to. Opening an entry keeps the scope the list
   * had (All stays All); a deep link to an entry scopes to its kind.
   */
  const listKind = createMemo<string | null | undefined>(
    (prev) => (routeSel().entryId ? (prev === undefined ? (routeSel().kind ?? undefined) : prev) : routeSel().kind),
    undefined,
  );
  /** The component library folder the list is scoped to (kept while an entry is open, like the kind). */
  const listLibrary = createMemo<string | null>((prev) => (routeSel().entryId ? (listKind() === 'component' ? prev : null) : routeSel().library), null);
  const kind = (): string | null => listKind() ?? null;
  const library = (): string | null => (kind() === 'component' ? listLibrary() : null);
  createEffect(() => publishCatalog(entries()));
  createEffect(() => publishQuery(q()));
  onCleanup(() => publishQuery(''));
  createEffect(() => publishScope(presetsMode() ? 'presets' : listKind() === undefined ? undefined : listKind() ? pluralOf(listKind() as string) : ''));
  createEffect(() => void ensurePresets(config()));
  onCleanup(() => publishScope(undefined));
  const searching = createMemo(() => q().trim().length > 0);
  const importedIds = createMemo(() => new Set(lock().rows.map((r) => r.id)));
  const isImported = (id: string): boolean => importedIds().has(id) || landed().has(id);

  /** The catalog narrowed by the sidebar's kind, before chips, search and sort. */
  const scoped = createMemo(() => (presetsMode() ? [] : inLibrary(inKind(entries(), kind()), library())));
  const allMatches = createMemo(() => (searching() ? scoreEntries(entries(), q()) : []));
  const elsewhere = createMemo(() => matchesOutsideScope(allMatches(), kind(), library()));
  const base = createMemo(() => (searching() ? scoreEntries(scoped(), q()) : sortEntries(scoped(), 'name', importedAt())));
  const visible = createMemo(() => filterEntries(base(), chips()));
  const counts = createMemo(() => chipCounts(base()));
  /**
   * Components at the root, with nothing searched, list their libraries as
   * folders; everything else (a library's members, search results, All
   * entries, other kinds) is a flat list of entries.
   */
  const folderMode = createMemo(() => !presetsMode() && kind() === 'component' && !library() && !searching());
  const rows = createMemo<ListRow[]>(() => listRows(visible(), folderMode()));
  const folderRows = createMemo<Folder[]>(() => rows().flatMap((r) => (r.kind === 'folder' ? [r.folder] : [])));
  const selIdx = createMemo(() => {
    const key = curId();
    const i = key ? rows().findIndex((r) => r.key === key) : -1;
    return i >= 0 ? i : rows().length ? 0 : -1;
  });
  const cursorRow = (): ListRow | null => rows()[selIdx()] ?? null;
  const cursorEntry = (): JsonEntry | null => {
    const r = cursorRow();
    return r?.kind === 'entry' ? r.entry : null;
  };
  const cursorFolder = (): Folder | null => {
    const r = cursorRow();
    return r?.kind === 'folder' ? r.folder : null;
  };
  /** The open folder's members, as the Import all in the list header sees them. */
  const openImport = createMemo(() => folderImport(visible(), isImported));
  /** What the single-entry actions (palette, `i`) act on: the open entry, else the cursor row. */
  const targetEntry = (): JsonEntry | null => openEntry() ?? cursorEntry();
  const routeFile = (): string | null => {
    const r = route();
    return r.kind === 'entry' && r.id === openEntry()?.id ? r.file : null;
  };
  const filtering = () => chips().size > 0 || searching();

  const entryHref = (id: string): string => href(props.scenario, 'browse', ...id.split('/'));
  const kindHref = (kind: string, lib: string | null = null): string =>
    kind ? href(props.scenario, 'browse', pluralOf(kind), ...(lib ? [librarySeg(lib)] : [])) : href(props.scenario, 'browse');
  const fileHref = (id: string, file: string): string =>
    href(props.scenario, 'browse', ...id.split('/'), ...file.split('/'));

  const importBusy = (): boolean => opsBusy() || batchBusyState(batch()) || !!single()?.running;

  const focusList = (): void => listEl?.focus({ preventScroll: true });
  /** Open an entry's detail: a route change, so Back and reload work. */
  const openDetail = (e: JsonEntry): void => {
    setCurId(e.id);
    if (openEntry()?.id === e.id) return;
    location.hash = entryHref(e.id);
  };
  /** Back to the full-width list, in the scope it had. */
  const closeDetail = (): void => {
    location.hash = kindHref(kind() ? (kind() as string) : '', library());
    focusList();
  };

  // ------------------------------------------------------------------ cursor

  const setCursor = (i: number): void => {
    const r = rows()[i];
    if (r) setCurId(r.key);
  };
  /**
   * Move the cursor to row `i`. `follow` selects just that row (single-select
   * follows focus, like Finder); `extend` / `add` grow a range from the anchor
   * (Shift, Ctrl+Shift); `keep` leaves the selection alone (Ctrl+Arrow).
   */
  const moveTo = (i: number, how: 'follow' | 'extend' | 'add' | 'keep'): void => {
    const before = curKey();
    setCursor(i);
    const to = rows()[i]?.key;
    if (to && how !== 'keep') selectRow(to, how === 'follow' ? { shift: false, ctrl: false } : { shift: true, ctrl: how === 'add' }, before);
    // With a detail open it follows the cursor (same history slot).
    const e = cursorEntry();
    if (openEntry() && e && e.id !== openEntry()?.id) location.replace(entryHref(e.id));
  };
  const move = (delta: number, how: 'follow' | 'extend' | 'add' | 'keep' = 'follow'): void => moveTo(moveSel(selIdx(), delta, rows().length), how);

  // Keep the cursor row in view inside the list pane.
  createEffect(
    on(selIdx, (i) => {
      if (i < 0) return;
      document.getElementById(`opt-${i}`)?.scrollIntoView({ block: 'nearest' });
    }, { defer: true }),
  );

  // One calm announcement per pause of the cursor, not one per keypress.
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => announceTimer && clearTimeout(announceTimer));
  createEffect(
    on(
      () => cursorRow()?.key ?? null,
      (id) => {
        if (announceTimer) clearTimeout(announceTimer);
        announceTimer = setTimeout(() => {
          const e = untrack(cursorEntry);
          const f = untrack(cursorFolder);
          const n = untrack(rows).length;
          if (id && f) return setAnnounce(`${f.name}, folder, ${f.members.length} components. ${untrack(selIdx) + 1} of ${n}.`);
          if (!id || !e) return setAnnounce('');
          setAnnounce(`${e.name}, ${e.kind}${isImported(e.id) ? ', imported' : ''}. ${untrack(selIdx) + 1} of ${n}.`);
        }, 400);
      },
    ),
  );

  // Moving the cursor off an entry closes its open plan: the plan is for that entry.
  createEffect(
    on(
      () => cursorEntry()?.id ?? null,
      (id) => {
        const s = untrack(single);
        if (s && s.id !== id && !s.running) cancelSingle(false);
      },
      { defer: true },
    ),
  );

  // ------------------------------------------------------------------ single import plan

  const entryOf = (id: string): JsonEntry | undefined => index().byId.get(id);

  async function loadSinglePlan(): Promise<void> {
    const s = single();
    const c = config();
    if (!s || !c?.project) return;
    const e = entryOf(s.id);
    const dest = s.dest.trim();
    if (e && needsImportDest(e) && !dest) {
      setSingle({ ...s, view: { phase: 'idle', text: 'Choose a folder inside the project to import into.' } });
      return;
    }
    const gen = ++planGen;
    const qgen = qiGen;
    setSingle({ ...s, view: { phase: 'loading' } });
    try {
      const plan = await planImport({ project: c.project, stackPath: c.stackPath }, s.id, dest);
      if (gen !== planGen || !previewFresh(qgen, qiGen)) return;
      setSingle((cur) => (cur && cur.id === s.id ? { ...cur, view: { phase: 'ready', plan } } : cur));
    } catch (err) {
      if (gen !== planGen || !previewFresh(qgen, qiGen)) return;
      setSingle((cur) => (cur && cur.id === s.id ? { ...cur, view: { phase: 'error', text: errText(err) } } : cur));
    }
  }

  /** Open the plan for one entry: what an import writes, and where. */
  function openPlan(e: JsonEntry, dest?: string): void {
    if (importBusy() || !config()?.project) return;
    if (isImported(e.id) || !e.committed) return;
    if (batchDone(batch())) setBatch(null);
    clearPlanTimer();
    setCurId(e.id);
    setSingle({
      id: e.id,
      dest: dest ?? (needsImportDest(e) ? (importDestHint(e) ?? '') : ''),
      view: { phase: 'loading' },
      failure: null,
      running: false,
    });
    void loadSinglePlan();
  }

  const onSingleDest = (value: string): void => {
    const s = single();
    if (!s || s.running) return;
    setSingle({ ...s, dest: value, failure: null });
    clearPlanTimer();
    planTimer = setTimeout(() => void loadSinglePlan(), SINGLE_DEBOUNCE_MS);
  };

  function cancelSingle(refocus = true): void {
    clearPlanTimer();
    planGen++;
    setSingle(null);
    if (refocus) focusList();
  }

  async function confirmSingle(): Promise<void> {
    const s = single();
    const c = config();
    if (!s || !c?.project || s.running || opsBusy()) return;
    const e = entryOf(s.id);
    clearPlanTimer();
    planGen++;
    const gen = qiGen;
    setSingle({ ...s, running: true, failure: null });
    beginOp();
    try {
      const out = await stackRun('import', importArgs(s.id, s.dest), c.project, c.stackPath);
      if (!previewFresh(gen, qiGen)) return endOp();
      const r = fromStackOut<ImportJson>(out);
      toastOutcome(importOutcome(r, s.id), { project: c.project, stackPath: c.stackPath });
      recordImported(c.project, r.imported.map((p) => p.id));
      setImportedAt(readImportedAt(c.project));
      // Cleared at once: the plan was for this import.
      setSingle(null);
      // A finished plan clears the selection.
      setSelected(new Set<string>());
      anchor = null;
      if (e) setLanded((prev) => new Set<string>(prev).add(s.id));
      await refreshLock();
      // Import creates stack.toml implicitly: the project page's set-up slot must re-check.
      await refreshReport();
      setLanded(new Set<string>());
      if (!previewFresh(gen, qiGen)) return endOp();
      void load();
      endOp();
      focusList();
    } catch (err) {
      toastFailure(`Could not import ${s.id}`, err);
      endOp();
      if (!previewFresh(gen, qiGen)) return;
      setSingle((cur) => (cur && cur.id === s.id ? { ...cur, running: false, failure: errText(err) } : cur));
      // A collision refusal: re-read the plan so the colliding files show.
      void loadSinglePlan();
    }
  }

  // Palette / Cmd+Enter / Cmd+D: the same plan the buttons and the `i` key open.
  const importReason = (): string | null => {
    const e = targetEntry();
    if (!e) return 'Select an entry first (j / k)';
    if (isImported(e.id)) return `${e.name} is already imported`;
    if (!e.committed) return `${e.name} is not in the stack`;
    return importBusy() ? 'Another operation is running' : null;
  };
  // A multi-selection imports as a batch; the cursor row stands in otherwise.
  const planOpenFor = (id: string): boolean => single()?.id === id && single()?.view.phase !== 'error';
  const selectionReason = (): string | null => {
    if (importBusy()) return 'Another operation is running';
    if (batchConfirm(batch())) return 'The import plan is already open';
    const p = planBatch(selectionCandidates(), importedIds());
    return p.ready.length + p.needDest.length ? null : 'Nothing selected can be imported';
  };
  const actionName = (): string | null => {
    const e = targetEntry();
    return e ? e.name ?? e.id : null;
  };
  /** The folder under the cursor when no detail is open: the single-entry actions then mean Import all. */
  const folderTarget = (): Folder | null => (openEntry() ? null : cursorFolder());
  const folderReason = (f: Folder): string | null => {
    if (importBusy()) return 'Another operation is running';
    if (batchConfirm(batch())) return 'The import plan is already open';
    return folderImport(f.members, isImported).reason;
  };
  useAction('import-selected', {
    guard: true,
    title: () => (batchSelected() ? `Import ${selected().size} selected` : folderTarget() ? `Import all ${folderTarget()?.name}` : actionName() ? `Import ${actionName()}` : null),
    run: () => {
      if (batchSelected()) return importSelection();
      const f = folderTarget();
      if (f) return importFolder(f);
      const e = targetEntry();
      if (e) openPlan(e);
    },
    reason: () => {
      if (batchSelected()) return selectionReason();
      const f = folderTarget();
      if (f) return folderReason(f);
      const e = targetEntry();
      return importReason() ?? (e && planOpenFor(e.id) ? 'The import plan is already open' : null);
    },
  });
  useAction('dry-run', {
    guard: true,
    title: () => (batchSelected() ? `Preview plan for ${selected().size} selected` : folderTarget() ? `Preview plan for all ${folderTarget()?.name}` : actionName() ? `Preview plan for ${actionName()}` : null),
    run: () => {
      // A selection of 2+ plans the selection; the same button the selection bar shows.
      if (batchSelected()) return importSelection();
      const f = folderTarget();
      if (f) return importFolder(f);
      const e = targetEntry();
      if (e) openPlan(e);
    },
    reason: () => {
      if (batchSelected()) return selectionReason();
      const f = folderTarget();
      if (f) return folderReason(f);
      const e = targetEntry();
      return importReason() ?? (e && planOpenFor(e.id) ? 'The import plan is already open' : null);
    },
  });
  useAction('browse-clear-filters', {
    run: () => clearFilters(),
    reason: () => (filtering() ? null : 'No filters are on'),
  });

  // ------------------------------------------------------------------ selection

  /** Selection edits are ignored while a batch confirms or runs (its plan is a snapshot). */
  const canSelect = (): boolean => !batchBusyState(batch());

  const editSelection = (next: Set<string>): void => {
    if (!canSelect()) return;
    if (batchDone(batch())) setBatch(null);
    setSelected(next);
  };
  /** Row keys in list order, and the ids a row stands for (uncommitted entries stand for none: they cannot be imported). */
  const rowMap = createMemo(() => new Map(rows().map((r) => [r.key, r])));
  const idsOfKey = (key: string): string[] => {
    const r = rowMap().get(key);
    return r ? rowIds(r) : [];
  };
  const curKey = (): string | null => cursorRow()?.key ?? null;
  /** Apply a click or a key to the selection: plain replaces, Ctrl toggles, Shift ranges from the anchor, both add a range. */
  const selectRow = (key: string, mods: { shift: boolean; ctrl: boolean }, cursor: string | null = curKey()): void => {
    if (!canSelect()) return;
    const next = selectClick({ selected: selected(), anchor }, rows().map((r) => r.key), cursor, key, mods, idsOfKey);
    anchor = next.anchor;
    editSelection(next.selected);
  };
  /** `a` and Ctrl/Cmd+A: every listed row not imported yet (the plan skips not-committed ones with a count). */
  const selectAllNotImported = (): void => {
    if (!canSelect()) return;
    anchor = null;
    editSelection(new Set<string>(notImportedIds(visible(), importedIds())));
  };
  const clearSelection = (): void => {
    if (!canSelect()) return;
    anchor = null;
    editSelection(new Set<string>());
  };
  /** Two or more picked rows are a batch; one is just a highlighted row with its own Import. */
  const batchSelected = (): boolean => selected().size > 1;

  /** A click on a row: plain selects only it, Ctrl/Cmd toggles, Shift ranges from the anchor, Ctrl+Shift adds the range. The row's own buttons stop the click before here. */
  const pickRow = (key: string, ev: MouseEvent): void => {
    if (ev.shiftKey) ev.preventDefault();
    selectRow(key, { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey });
    setCurId(key);
    focusList();
  };
  const onRowPick = (e: JsonEntry, ev: MouseEvent): void => pickRow(e.id, ev);
  const onFolderPick = (f: Folder, ev: MouseEvent): void => pickRow(folderKey(f.name), ev);
  const selectionText = (): string => selectionLabel(selected().size, folderMode() ? foldersTouched(folderRows(), selected()) : 0);

  // ------------------------------------------------------------------ folders

  /** Drill into a library folder: a route change, so Back, Forward and reload work. */
  const openFolder = (f: Folder): void => {
    setCurId(folderKey(f.name));
    location.hash = kindHref('component', f.name);
  };
  /** Leave the open folder for the components list, with the cursor back on it. */
  const upOne = (): void => {
    const up = upRoute(route());
    if (up?.kind !== 'kind') return;
    location.hash = kindHref(up.kindSingular);
    focusList();
  };
  /** Import all: the folder expands to its members, which run through the batch import. */
  const importFolder = (f: Folder): void => startBatch(`${f.name} library`, expandFolder(f));
  const importOpenFolder = (): void => {
    const lib = library();
    if (lib) importFolder({ name: lib, members: visible(), extends: null, isDefault: false });
  };

  // ------------------------------------------------------------------ batch import

  const confirmTargets = (plan: BatchPlan, base: string, dests: ReadonlyMap<string, string> = new Map()): BatchTarget[] =>
    [
      ...plan.ready.map((e) => ({ id: e.id, dest: '' })),
      ...(base.trim() ? plan.needDest.map((e) => ({ id: e.id, dest: batchDest(base, e.name) })) : []),
    ].map((t) => ({ id: t.id, dest: dests.get(t.id)?.trim() || t.dest }));
  const confirmSkipped = (plan: BatchPlan, base: string): number =>
    plan.already.length + plan.unimportable.length + (base.trim() ? 0 : plan.needDest.length);

  /**
   * Open a batch over candidates: one candidate behaves like its single
   * import (the plan with a destination field); several get the combined
   * file plan; nothing importable lands straight on the summary.
   */
  function startBatch(label: string, candidates: JsonEntry[]): void {
    if (importBusy()) return;
    const c = config();
    if (!c?.project || !candidates.length) return;
    clearPlanTimer();
    setSingle(null);
    const plan = planBatch(candidates, importedIds());
    if (candidates.length === 1) {
      const only = candidates[0];
      if (plan.ready.length === 1 || plan.needDest.length === 1) {
        openPlan(only);
        return;
      }
      setBatch({
        phase: 'done',
        label,
        counts: { imported: 0, already: plan.already.length, refused: 0, skipped: plan.unimportable.length, stopped: false },
        refusals: [],
        expanded: false,
      });
      return;
    }
    // Component batches start with the source-tree convention as the shared
    // base, so one confirm imports them; anything else asks for a base.
    const base = batchBase(plan);
    const targets = confirmTargets(plan, base);
    if (!targets.length) {
      setBatch({
        phase: 'done',
        label,
        counts: { imported: 0, already: plan.already.length, refused: 0, skipped: confirmSkipped(plan, base), stopped: false },
        refusals: [],
        expanded: false,
      });
      return;
    }
    const dests = new Map<string, string>();
    setBatch({ phase: 'confirm', label, plan, base, targets, per: new Map(), errs: new Map(), dests, skip: new Set<string>(), view: { phase: 'loading' } });
    void loadBatchPlan(plan, base, ++planGen, qiGen, dests);
  }

  /** One dry run per target (a few at a time), merged into the file plan. Writes nothing. */
  async function loadBatchPlan(plan: BatchPlan, base: string, gen: number, qgen: number, dests: Map<string, string>): Promise<void> {
    const c = config();
    if (!c?.project) return;
    const ctx = { project: c.project, stackPath: c.stackPath };
    const targets = confirmTargets(plan, base, dests);
    const per = new Map<string, Plan>();
    const errs = new Map<string, string>();
    await mapPooled(targets, 4, async (t) => {
      try {
        per.set(t.id, await planImport(ctx, t.id, t.dest));
      } catch (err) {
        errs.set(t.id, oneSentence(humanizeCliError(errText(err), { subject: t.id })));
      }
    });
    if (gen !== planGen || !previewFresh(qgen, qiGen)) return;
    const b = batchConfirm(batch());
    if (!b || b.plan !== plan || b.base !== base || b.dests !== dests) return;
    const merged = mergePlans(targets.map((t) => per.get(t.id)).filter((p): p is Plan => !!p));
    // Colliding entries start skipped (their box checked); one a new folder frees is unskipped.
    const skip = new Set(b.skip);
    for (const t of targets) {
      const p = per.get(t.id);
      if (p && collidingTargets(p).length) skip.add(t.id);
      else if (dests.has(t.id)) skip.delete(t.id);
    }
    setBatch({ ...b, targets, per, errs, skip, view: { phase: 'ready', plan: merged } });
  }

  /** A base edit re-plans the targets and re-runs the dry runs (debounced). */
  const onBatchBase = (value: string): void => {
    const b = batchConfirm(batch());
    if (!b) return;
    const targets = confirmTargets(b.plan, value, b.dests);
    setBatch({ ...b, base: value, targets, per: new Map(), errs: new Map(), view: { phase: 'loading' } });
    clearPlanTimer();
    const gen = ++planGen;
    const qgen = qiGen;
    const plan = b.plan;
    const dests = b.dests;
    planTimer = setTimeout(() => void loadBatchPlan(plan, value, gen, qgen, dests), 400);
  };

  /** A folder typed for one colliding entry: only that plan is re-checked (debounced); the list stays up so the field keeps focus. */
  const onBatchEntryDest = (id: string, value: string): void => {
    const b = batchConfirm(batch());
    if (!b) return;
    const dests = new Map(b.dests).set(id, value);
    setBatch({ ...b, dests, targets: confirmTargets(b.plan, b.base, dests) });
    clearPlanTimer();
    const gen = ++planGen;
    const qgen = qiGen;
    const plan = b.plan;
    const base = b.base;
    planTimer = setTimeout(() => void loadBatchPlan(plan, base, gen, qgen, dests), 400);
  };
  const onBatchSkip = (id: string, skip: boolean): void => {
    const b = batchConfirm(batch());
    if (!b) return;
    const next = new Set(b.skip);
    if (skip) next.add(id);
    else next.delete(id);
    setBatch({ ...b, skip: next });
  };

  const cancelBatch = (): void => {
    const b = batch();
    if (b?.phase === 'confirm') {
      clearPlanTimer();
      planGen++;
      setBatch(null);
      focusList();
    } else if (b?.phase === 'running') {
      setBatch({ ...b, cancel: true });
    }
  };

  /** Entries without collisions import in turn; the rest are skipped up front. Never atomic. */
  async function runBatch(): Promise<void> {
    const b = batchConfirm(batch());
    const c = config();
    if (!b || b.view.phase !== 'ready' || !c?.project || single()?.running || opsBusy()) return;
    const targets = runnableTargets(b);
    if (!targets.length) return;
    clearPlanTimer();
    planGen++;
    const gen = qiGen;
    beginOp();
    const counts: BatchCounts = {
      imported: 0,
      already: b.plan.already.length,
      refused: 0,
      skipped: confirmSkipped(b.plan, b.base) - b.plan.already.length + (b.targets.length - targets.length),
      stopped: false,
    };
    const refusals: BatchRefusal[] = [];
    const landedIds: string[] = [];
    const batchCtx = { project: c.project, stackPath: c.stackPath };
    /** One toast for the whole run, with an Undo that removes what landed. */
    const toastBatch = (): void => {
      if (landedIds.length || counts.refused || counts.stopped) {
        toastOutcome(batchOutcome({ imported: landedIds, already: counts.already, refused: counts.refused, stopped: counts.stopped }), batchCtx);
      }
      if (landedIds.length) {
        recordImported(c.project, landedIds);
        setImportedAt(readImportedAt(c.project));
      }
    };
    // Imports attempted so far: a route change or unmount mid-run still
    // lands the lock/report refresh, so the project page shows the imports.
    let attempted = 0;
    const refreshAfterStale = async (): Promise<void> => {
      endOp();
      if (!attempted) return;
      toastBatch();
      await refreshLock();
      await refreshReport();
    };
    setBatch({ phase: 'running', label: b.label, targets, at: 0, counts, cancel: false });
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const cur = batchRunning(batch());
      if (!cur) {
        await refreshAfterStale();
        return;
      }
      if (cur.cancel) {
        counts.stopped = true;
        break;
      }
      setBatch({ ...cur, at: i });
      attempted++;
      try {
        const out = await stackRun('import', importArgs(t.id, t.dest), c.project, c.stackPath);
        if (!previewFresh(gen, qiGen)) {
          await refreshAfterStale();
          return;
        }
        const r = fromStackOut<ImportJson>(out);
        // Dependencies pulled in with a member land too (and are undone with it).
        for (const p of r.imported) if (!landedIds.includes(p.id)) landedIds.push(p.id);
        if (r.imported.some((p) => p.id === t.id)) {
          counts.imported++;
          setLanded((prev) => new Set<string>(prev).add(t.id));
        } else if (r.already.includes(t.id)) {
          counts.already++;
        } else {
          counts.imported++;
          if (entryOf(t.id)) setLanded((prev) => new Set<string>(prev).add(t.id));
        }
      } catch (err) {
        if (!previewFresh(gen, qiGen)) {
          await refreshAfterStale();
          return;
        }
        counts.refused++;
        refusals.push({ id: t.id, line: oneSentence(humanizeCliError(errText(err), { subject: t.id })), err: errText(err) });
      }
    }
    if (!previewFresh(gen, qiGen)) {
      await refreshAfterStale();
      return;
    }
    await refreshLock();
    if (!previewFresh(gen, qiGen)) {
      endOp();
      await refreshReport();
      return;
    }
    setLanded(new Set<string>());
    await refreshReport();
    if (!previewFresh(gen, qiGen)) {
      endOp();
      return;
    }
    void load();
    setSelected(new Set<string>());
    anchor = null;
    endOp();
    toastBatch();
    // The plan is cleared; the summary replaces it.
    setBatch({ phase: 'done', label: b.label, counts, refusals, expanded: false });
    focusList();
  }

  /** Selection imports run in list order; stray ids follow in catalog order. */
  const selectionCandidates = (): JsonEntry[] => {
    const ids = selected();
    if (!ids.size) return [];
    const pos = new Map(visible().map((e, i) => [e.id, i]));
    return [...ids]
      .map((id) => index().byId.get(id))
      .filter((e): e is JsonEntry => !!e)
      .sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9) || a.id.localeCompare(b.id));
  };
  const importSelection = (): void => {
    const cands = selectionCandidates();
    if (!cands.length) {
      setSelected(new Set<string>());
      return;
    }
    startBatch(`${cands.length} selected`, cands);
  };

  /** Shared base a multi-entry batch starts with (component batches use the source-tree convention). */
  const batchBase = (plan: BatchPlan): string =>
    plan.needDest.length && plan.needDest.every((e) => e.kind === 'component') ? 'src/components' : '';
  /** The plural kind word the list is scoped to (`skills`, `presets`), or null for everything. */
  const scopeWord = (): string | null => (presetsMode() ? 'presets' : kind() ? pluralOf(kind() as string) : null);

  // ------------------------------------------------------------------ search, filters

  const clearQuery = (): void => {
    setQ('');
    if (inputEl) inputEl.value = '';
  };
  const clearFilters = (): void => {
    clearQuery();
    setChips(new Set<ChipKey>());
  };

  /**
   * Stale-while-revalidate: a cached catalog renders at once and refreshes in
   * the background; the loading skeleton shows only when this source has no
   * cache yet. Returns the outcome for the refresh button (null when a newer
   * load superseded this one).
   */
  async function load(
    opts?: { silent?: boolean; keepStale?: boolean },
  ): Promise<{ ok: true; count: number } | { ok: false; err: string } | null> {
    const c = config();
    const key = sourceKey(c);
    const gen = ++listGen;
    const cached = catalogs.get(key);
    if (cached) {
      setEntries(cached.entries);
      setLoaded(true);
    } else if (!opts?.keepStale) {
      setEntries([]);
      setLoaded(false);
      setNote(null);
    }
    try {
      const out = await stackRun('list', ['--json'], c?.project ?? '.', c?.stackPath);
      if (gen !== listGen) return null;
      if (cached && cached.raw === out.stdout) {
        setNote(null);
        return { ok: true, count: cached.entries.length };
      }
      const data = fromStackOut<ListJson>(out);
      const next: CatalogData = {
        raw: out.stdout,
        entries: data.entries,
        uncommitted: new Set<string>(data.uncommitted ?? []),
      };
      catalogs.set(key, next);
      setEntries(next.entries);
      setNote(null);
      return { ok: true, count: next.entries.length };
    } catch (err) {
      if (gen !== listGen) return null;
      const text = errText(err);
      if (!opts?.silent) setNote(text);
      return { ok: false, err: text };
    } finally {
      if (gen === listGen) setLoaded(true);
    }
  }

  /** Re-read the catalog from the checkout from scratch: cached list, previews and file lists dropped. */
  async function refresh(): Promise<void> {
    if (rs()?.phase === 'working' || importBusy()) return;
    clearRsTimer();
    setRs({ phase: 'working' });
    clearCatalogs(sourceKey(config()));
    clearPreviews();
    clearListings();
    const r = await load({ silent: true, keepStale: true });
    if (!r) {
      setRs(null);
      return;
    }
    if (r.ok) {
      await refreshLock();
      const line = refreshLine(r.count);
      setRs({ phase: 'done', line });
      // The bar stays put: the result goes to the live region and a quiet toast.
      pushToast({ tone: 'success', title: 'Catalog refreshed', description: `${r.count} ${r.count === 1 ? 'entry' : 'entries'}`, ttl: 3000 });
      rsTimer = setTimeout(() => setRs(null), 8000);
    } else {
      // Stays until the next refresh: the Retry button lives with it.
      setRs({ phase: 'error', err: r.err });
    }
  }

  // ------------------------------------------------------------------ keys

  /** A folder is open with nothing in front of it: Esc, Backspace and Alt+Left go up a level. */
  const canGoUp = (): boolean => !!upRoute(route()) && !single() && !batchBusyState(batch());
  /** Esc, innermost first: an open plan, a summary, the open detail, a query, then the open folder. A selection is cleared before the detail, query and folder. */
  const escape = (inPreview: boolean): void => {
    const b = batch();
    if (single() && !single()!.running) return cancelSingle();
    if (b?.phase === 'confirm' || b?.phase === 'running') return cancelBatch();
    if (b?.phase === 'done') {
      setBatch(null);
      return focusList();
    }
    if (selected().size) return clearSelection();
    if (openEntry()) return closeDetail();
    if (q()) return clearQuery();
    if (canGoUp()) return upOne();
    if (inPreview) return focusList();
  };

  onMount(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      // The search box is ours; other fields (the destination input, the sort select) keep their keys.
      if (t && t !== inputEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      // Inside the search box only the cursor keys act; every letter, space
      // included, is text (never i / a / r / j / k hotkeys).
      if (t === inputEl && !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(ev.key)) return;
      // Buttons and links keep Enter and Space for their own activation.
      if (t && ['BUTTON', 'A', 'SUMMARY'].includes(t.tagName) && (ev.key === 'Enter' || ev.key === ' ')) return;
      // Keys typed inside the diff or the plan belong to them.
      if (t?.closest('.plan, .review')) return;
      // Shift+arrows / Home / End extend the selection from the anchor; with Ctrl/Cmd the range is added to it.
      if (ev.shiftKey && !ev.altKey && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key) && t !== inputEl) {
        ev.preventDefault();
        const how = ev.ctrlKey || ev.metaKey ? 'add' : 'extend';
        if (ev.key === 'Home') moveTo(rows().length ? 0 : -1, how);
        else if (ev.key === 'End') moveTo(rows().length - 1, how);
        else move(ev.key === 'ArrowDown' ? 1 : -1, how);
        return;
      }
      // Ctrl/Cmd+Arrow moves the cursor and leaves the selection alone.
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && t !== inputEl) {
        ev.preventDefault();
        move(ev.key === 'ArrowDown' ? 1 : -1, 'keep');
        return;
      }
      // Ctrl/Cmd+A selects like `a` (the field keeps its own select-all).
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'a' && t !== inputEl && visible().length) {
        ev.preventDefault();
        selectAllNotImported();
        return;
      }
      // Alt+Left goes up one folder, like Back in a file explorer.
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.key === 'ArrowLeft' && t !== inputEl && canGoUp()) {
        ev.preventDefault();
        upOne();
        return;
      }
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return;
      switch (ev.key) {
        case 'Backspace':
          if (t !== inputEl && canGoUp()) {
            ev.preventDefault();
            upOne();
          }
          return;
        case 'ArrowDown':
          ev.preventDefault();
          move(1);
          return;
        case 'ArrowUp':
          ev.preventDefault();
          move(-1);
          return;
        case 'Home':
        case 'End':
          if (t === inputEl) return;
          ev.preventDefault();
          moveTo(ev.key === 'Home' ? (rows().length ? 0 : -1) : rows().length - 1, 'follow');
          return;
        case 'Enter': {
          // Enter opens the cursor row (a folder, or an entry's detail).
          const e = cursorEntry();
          const f = cursorFolder();
          if (e || f) {
            ev.preventDefault();
            if (t === inputEl) inputEl?.blur();
            if (f) openFolder(f);
            else if (e) openDetail(e);
          }
          return;
        }
        case 'Escape':
          ev.preventDefault();
          // Esc in the search box clears a typed query (focus stays); in an empty box it leaves the box.
          if (t === inputEl) {
            if (searchEscape(inputEl?.value ?? '') === 'clear') clearQuery();
            else {
              inputEl?.blur();
              focusList();
            }
            return;
          }
          escape(!!t?.closest('#entry-preview'));
          return;
      }
      // `j` / `k` walk the list like the arrows.
      if (ev.key === 'j' || ev.key === 'k') {
        ev.preventDefault();
        move(ev.key === 'j' ? 1 : -1);
        return;
      }
      // `o` opens the cursor row's detail.
      if (ev.key === 'o') {
        const e = cursorEntry();
        const f = cursorFolder();
        if (f) {
          ev.preventDefault();
          openFolder(f);
          return;
        }
        if (e) {
          ev.preventDefault();
          openDetail(e);
          return;
        }
      }
      // `i` imports the selection when 2+ rows are picked, else the open entry or the cursor row.
      if (ev.key === 'i') {
        if (batchSelected()) {
          ev.preventDefault();
          if (!selectionReason()) importSelection();
          return;
        }
        const f = folderTarget();
        if (f) {
          ev.preventDefault();
          if (!folderReason(f)) importFolder(f);
          return;
        }
        const e = targetEntry();
        if (e) {
          ev.preventDefault();
          openPlan(e);
          return;
        }
      }
      // `a` selects every not-imported row of the list in view.
      if (ev.key === 'a') {
        if (visible().length) {
          ev.preventDefault();
          selectAllNotImported();
          return;
        }
      }
      // `r` re-reads the catalog from the checkout; no cursor row needed.
      if (ev.key === 'r') {
        ev.preventDefault();
        void refresh();
        return;
      }
      // Space toggles the cursor row in the selection; with no row it scrolls the page.
      if (ev.key === ' ') {
        ev.preventDefault();
        const key = curKey();
        if (key) selectRow(key, { shift: false, ctrl: true });
        else scrollByPage((document.querySelector('.sa-shell__sheet')?.clientHeight ?? window.innerHeight) * 0.8);
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  // ------------------------------------------------------------------ effects

  // Catalog loads for this source; a project or stack switch reloads, nothing else does.
  createEffect(() => {
    source();
    untrack(() => void load());
  });

  let leftFolder: string | null = null;
  /** Selection, plans and results belong to the route and project they ran against. */
  const clearOpState = (keepSelection = false): void => {
    qiGen++;
    planGen++;
    clearPlanTimer();
    setSingle(null);
    if (!keepSelection) {
      anchor = null;
      setSelected(new Set<string>());
    }
    setBatch(null);
    setLanded(new Set<string>());
  };

  // A route to another kind or entry clears the query and any plan. A route that only
  // opens a file of the same entry keeps everything. The list follows what the route names.
  createEffect(
    on(
      [routeKey, loaded],
      ([, isLoaded], prev) => {
        if (!isLoaded) return;
        untrack(() => {
          const rsel = routeSel();
          // The query survives a kind switch (it just scopes to the new kind).
          if (prev && prev[0] !== routeKey()) {
            // The cursor-following detail changes the route per row; only a new scope drops the selection (below).
            clearOpState(true);
            if (narrow()) scrollToTop();
          }
          if (rsel.entryId) {
            if (indexOfEntry(visible(), rsel.entryId) < 0) clearFilters();
            setCurId(rsel.entryId);
          }
          // Back up from a folder: the cursor lands on the folder just left.
          if (leftFolder && !rsel.library && !rsel.entryId && rsel.kind === 'component') setCurId(folderKey(leftFolder));
          leftFolder = rsel.library ?? (rsel.entryId ? leftFolder : null);
          if (!prev || prev[0] !== routeKey()) queueMicrotask(() => listEl?.focus({ preventScroll: true }));
        });
      },
    ),
  );

  // A project switch clears plans and results, like Project.tsx.
  createEffect(
    on(
      () => config()?.project ?? null,
      () => {
        untrack(() => clearOpState());
        clearRsTimer();
        setRs(null);
      },
      { defer: true },
    ),
  );

  // A new search puts the cursor on the best match, and drops the selection with the old results.
  createEffect(
    on(
      q,
      () => {
        setCurId(null);
        anchor = null;
        setSelected(new Set<string>());
      },
      { defer: true },
    ),
  );
  // Another kind or library is another list: the selection does not travel.
  createEffect(
    on(
      () => `${kind() ?? ''}|${library() ?? ''}`,
      () => {
        anchor = null;
        setSelected(new Set<string>());
      },
      { defer: true },
    ),
  );
  // A sort, chip or refresh that hides rows drops them from the selection.
  createEffect(on(visible, (v) => setSelected((prev) => pruneSelection(prev, v.map((e) => e.id))), { defer: true }));
  // Leaving Browse drops the selection (the signal dies with the view; the anchor goes with it).
  onCleanup(() => {
    anchor = null;
    setSelected(new Set<string>());
  });

  // ------------------------------------------------------------------ view

  const targetBranch = (): string => t3Info()?.worktrees.find((w) => w.isCurrent)?.branch ?? 'project';

  const entryPlanNode = () => {
    const s = single();
    const e = s ? entryOf(s.id) : undefined;
    if (!s || !e) return null;
    const ent = e;
    return (
      <ImportPlan
        title={LABEL.importPlan}
        subject={`${e.name} · ${LABEL.importInto(targetBranch())}`}
        view={s.view}
        dest={{ value: s.dest, placeholder: ent ? defaultImportDest(ent) : '', required: !!ent && needsImportDest(ent), onInput: onSingleDest }}
        confirmLabel="Import"
        busy={s.running}
        failure={s.failure}
        onConfirm={() => void confirmSingle()}
        onCancel={() => cancelSingle()}
      />
    );
  };

  const batchPlanNode = () => {
    const b = batchConfirm(batch());
    if (!b) return null;
    const uncovered = b.base.trim() ? 0 : b.plan.needDest.length;
    // `3 selected · +2 required` once the dry runs land; the plan's own entries
    // never count their dependencies as picks (planCountLabel).
    // Already-imported picks are skipped silently by the batch; say so, and
    // let the button read `Import 1 of 2` when the counts differ.
    return (
      <ImportPlan
        title={LABEL.importPlan}
        subject={LABEL.importInto(targetBranch())}
        view={b.view}
        confirmLabel="Import"
        counted
        already={b.plan.already}
        resolve={{ dests: b.dests, skipped: b.skip, editable: (id) => b.targets.some((t) => t.id === id), onDest: onBatchEntryDest, onSkip: onBatchSkip }}
        busy={false}
        skipColliding
        blocked={null}
        onConfirm={() => void runBatch()}
        onCancel={cancelBatch}
      >
        <Show when={b.plan.needDest.length > 0}>
          <label class="plan__dest">
            <span class="plan__dest-label">Folder for entries that need one</span>
            <input
              type="text"
              value={b.base}
              placeholder="src/components"
              spellcheck={false}
              autocomplete="off"
              aria-label="Shared destination folder for entries that need one; each lands in its own folder inside it"
              onInput={(ev) => onBatchBase(ev.currentTarget.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  void runBatch();
                }
              }}
            />
          </label>
          <Show when={uncovered}>
            <Alert tone="warning" class="plan__note">{uncovered} {uncovered === 1 ? 'entry needs' : 'entries need'} a folder and will be skipped without one.</Alert>
          </Show>
        </Show>
        <Show when={b.errs.size}>
          <ul class="plan__skips">
            <For each={[...b.errs]}>{([id, why]) => <li><b>{nameOf(id)}</b> will be skipped: {why}</li>}</For>
          </ul>
        </Show>
        <Show when={b.plan.unimportable.length}>
          <Alert tone="warning" class="plan__note">Not in the stack, skipped: {b.plan.unimportable.join(', ')}.</Alert>
        </Show>
      </ImportPlan>
    );
  };

  return (
    <div class="browse" data-narrow={narrow() ? '' : undefined} data-open={openEntry() ? '' : undefined}>
      <p class="visually-hidden" role="status" aria-live="polite">{announce()}</p>
      <p class="visually-hidden" role="status" aria-live="polite">{rs()?.phase === 'done' ? (rs() as { line: string }).line : ''}</p>
      <div class="browse__list" data-lenis-prevent="">
        <div class="browse__head" role="toolbar" aria-label="Search and filter" ref={rovingBar}>
          <div class="browse__bar">
            <div class="browse__search">
              <Icon name="search" size={14} />
              <input
                id="q"
                ref={inputEl}
                type="text"
                role="searchbox"
                aria-label={scopeWord() ? `Search ${scopeWord()}` : 'Search the catalog'}
                aria-controls="entry-list"
                placeholder={searchPlaceholder(scopeWord(), library())}
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                onInput={(e) => setQ(e.currentTarget.value)}
              />
            </div>
            <RefreshButton state={rs()} disabled={importBusy()} onRefresh={() => void refresh()} />
          </div>
          <RefreshError
            state={rs()}
            disabled={importBusy() || rs()?.phase === 'working'}
            onRefresh={() => void refresh()}
            onDismiss={() => setRs(null)}
          />
          <Show when={!presetsMode()}>
          <div class="browse__filters" role="group" aria-label={batchSelected() ? 'Selection' : 'Filter entries'}>
            <Show
              when={batchSelected()}
              fallback={
                <FilterMenu
                  label="Filter"
                  options={CHIPS.map((c) => ({ key: c.key, label: c.label, count: counts()[c.key] }))}
                  on={chips()}
                  onToggle={(k) => setChips((cur) => toggleChip(cur, k as ChipKey))}
                  onClear={() => setChips(new Set<ChipKey>())}
                />
              }
            >
              <span class="browse__selcount" role="status">{selectionText()}</span>
              <Button
                size="sm"
                variant="obsidian"
                disabled={!!selectionReason()}
                title={selectionReason() ?? `Review the Import plan for the ${selected().size} selected entries, then import them (i)`}
                onClick={importSelection}
              >
                {`Import ${selected().size}`}
              </Button>
              <Button size="sm" title="Clear the selection (Esc)" onClick={clearSelection}>
                Clear
              </Button>
            </Show>
          </div>
          </Show>
          <div class="browse__slot">
            <BatchBar
              batch={batch()}
              onCancel={cancelBatch}
              onToggleDone={() => setBatch((b) => (b?.phase === 'done' ? { ...b, expanded: !b.expanded } : b))}
              onDismiss={() => {
                setBatch(null);
                focusList();
              }}
            />
          </div>
          <Show when={library() && !presetsMode() && !routeSel().missing}>
            <nav class="browse__path" aria-label="Folder path">
              <IconButton label="Back to Components (Esc)" variant="ghost" onClick={upOne}>
                <Icon name="chevronDown" size={14} class="browse__back" />
              </IconButton>
              <ol class="browse__crumbs">
                <For each={crumbParts({ kind: 'kind', kindSingular: 'component', library: library() as string }, false).slice(1)}>
                  {(p, i) => (
                    <>
                      <Show when={i() > 0}>
                        <li class="browse__crumb-sep" aria-hidden="true">›</li>
                      </Show>
                      <li>
                        <Show when={p.target?.to === 'kind' ? p.target : null} fallback={<span class="browse__crumb" aria-current="page">{i() === 0 ? p.label.replace(/^./, (c) => c.toUpperCase()) : p.label}</span>}>
                          {(t) => <a class="browse__crumb" href={kindHref(t().kindSingular)}>{i() === 0 ? p.label.replace(/^./, (c) => c.toUpperCase()) : p.label}</a>}
                        </Show>
                      </li>
                    </>
                  )}
                </For>
              </ol>
              <Show
                when={openImport().state !== 'imported'}
                fallback={<span class="erow__imported" title={openImport().reason ?? undefined}>Imported ✓</span>}
              >
                <Button
                  size="sm"
                  variant="obsidian"
                  disabled={openImport().state === 'none' || importBusy()}
                  title={openImport().reason ?? (importBusy() ? 'Another operation is running' : `Review the files ${openImport().ready.length} components would write, then import them`)}
                  onClick={importOpenFolder}
                >
                  {openImport().state === 'none' ? 'Import all' : `Import all ${openImport().ready.length}`}
                </Button>
              </Show>
            </nav>
          </Show>
        </div>
        <Show when={note() && entries().length}>
          <Alert
            tone="warning"
            icon="alert"
            role="alert"
            class="browse__stale"
            actions={<Button size="sm" onClick={() => void load()}>Retry</Button>}
          >
            <span class="sa-alert__title">Showing saved catalog</span>
            <span class="humanerr__next">{oneSentence(humanizeCliError(note() ?? ''))}</span>
            <TechDetails raw={note() ?? ''} />
          </Alert>
        </Show>
        <Show when={!(note() && !entries().length)} fallback={<ListError text={note() as string} onRetry={() => void load()} />}>
          <Switch>
            <Match when={!loaded()}>
              <div class="browse__skeleton" role="status" aria-label="Loading the catalog">
                <For each={[0, 1, 2, 3, 4, 5]}>{() => <span class="skel skel--row" />}</For>
              </div>
            </Match>
            <Match when={!entries().length}>
              <div class="browse__empty">
                <p class="browse__empty-title">The stack has no entries yet</p>
                <p class="dimtxt">Add entries to the stack checkout, then refresh.</p>
              </div>
            </Match>
            <Match when={routeSel().missing}>
              <div class="browse__empty">
                <p class="browse__empty-title">That link does not match an entry</p>
                <LinkButton href={kindHref('')}>Show the whole catalog</LinkButton>
              </div>
            </Match>
            <Match when={presetsMode()}>
              <PresetList query={q()} busy={importBusy()} onBegin={beginOp} onEnd={endOp} />
            </Match>
            <Match when={!visible().length}>
              <div class="browse__empty">
                <p class="browse__empty-title">{searching() ? `No entries match “${q().trim()}”` : 'No entries match these filters'}</p>
                <Show when={searching() && kind() && elsewhere() > 0}>
                  <p class="dimtxt">{elsewhere()} {elsewhere() === 1 ? 'match' : 'matches'} in {library() ? 'other libraries and kinds' : 'other kinds'}</p>
                </Show>
                <div class="browse__empty-actions">
                  <Show when={searching() && kind()}>
                    <LinkButton href={kindHref('')}>{library() ? 'Search all components' : 'Search all kinds'}</LinkButton>
                  </Show>
                  <Button onClick={clearFilters}>{searching() && !chips().size ? 'Clear search' : 'Clear filters'}</Button>
                </div>
              </div>
            </Match>
            <Match when={true}>
              <div
                id="entry-list"
                ref={listEl}
                class="browse__rows"
                role="listbox"
                tabindex="0"
                aria-label={folderMode() ? `Component libraries, ${rows().length}` : `Catalog entries, ${visible().length}`}
                aria-multiselectable="true"
                aria-activedescendant={selIdx() >= 0 ? `opt-${selIdx()}` : undefined}
              >
                <For each={rows()}>
                  {(r, i) =>
                    r.kind === 'folder' ? (
                      <FolderRow
                        folder={r.folder}
                        id={`opt-${i()}`}
                        index={i()}
                        total={rows().length}
                        cursor={selIdx() === i()}
                        selected={folderChecked(r.folder, selected())}
                        imp={folderImport(r.folder.members, isImported)}
                        busy={importBusy()}
                        onPick={(ev) => onFolderPick(r.folder, ev)}
                        onOpen={() => openFolder(r.folder)}
                        onImport={() => importFolder(r.folder)}
                      />
                    ) : (
                      <EntryRow
                        e={r.entry}
                        id={`opt-${i()}`}
                        index={i()}
                        total={rows().length}
                        cursor={selIdx() === i()}
                        selected={selected().has(r.entry.id)}
                        query={q()}
                        showId={searching() || !kind()}
                        inLibrary={!!library()}
                        imported={isImported(r.entry.id)}
                        busy={importBusy()}
                        onPick={(ev) => onRowPick(r.entry, ev)}
                        onOpen={() => openDetail(r.entry)}
                        onImport={() => openPlan(r.entry)}
                      />
                    )
                  }
                </For>
              </div>
            </Match>
          </Switch>
        </Show>
      </div>
      <Show when={openEntry()}>
        {(oe) => (
          <EntryPreview
            scenario={props.scenario}
            entry={oe()}
            file={routeFile()}
            source={source()}
            entries={entries()}
            index={index()}
            entryHref={entryHref}
            fileHref={fileHref}
            busy={importBusy()}
            narrow
            onBack={closeDetail}
            onClose={closeDetail}
            onPlan={(e) => openPlan(e)}
            onImported={() => void load()}
            entryPlan={entryPlanNode()}
          />
        )}
      </Show>
      {/* A plan for an entry that is not open, and every batch plan, shows in a dialog. */}
      <Show when={!!single() && openEntry()?.id !== single()?.id}>
        <Portal><Modal onClose={() => !single()?.running && cancelSingle()}>
          <div class="sa-dialog__content browse__plandlg" role="dialog" aria-modal="true" aria-label="Import plan" tabindex="-1" data-modal-content>
            {entryPlanNode()}
          </div>
        </Modal></Portal>
      </Show>
      <Show when={!!batchConfirm(batch())}>
        <Portal><Modal onClose={cancelBatch}>
          <div class="sa-dialog__content browse__plandlg" role="dialog" aria-modal="true" aria-label="Import plan" tabindex="-1" data-modal-content>
            {batchPlanNode()}
          </div>
        </Modal></Portal>
      </Show>
    </div>
  );
}

/**
 * A failed refresh as one compact row in the toolbar, under the search: the
 * first line in plain words (the raw stderr in the tooltip), Retry and
 * Dismiss to its right. It rides with the sticky toolbar instead of a
 * full-width block above the list.
 */
function RefreshError(props: {
  state: RefreshState | null;
  disabled: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  const text = (): string | null => {
    const s = props.state;
    return s?.phase === 'error' ? s.err : null;
  };
  return (
    <Show when={text()}>
      {(raw) => (
        <Alert
          tone="error"
          icon="alert"
          role="alert"
          class="refresherr-inline"
          actions={
            <>
              <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => props.onRefresh()}>
                Retry
              </Button>
              <IconButton label="Dismiss the refresh error" variant="ghost" disabled={props.disabled} onClick={() => props.onDismiss()}>
                <Icon name="x" size={14} />
              </IconButton>
            </>
          }
        >
          <span class="refresherr-inline__text">
            <span class="sa-alert__title">Showing saved catalog</span>
            <span class="humanerr__next">{refreshErrorText(raw())}</span>
            <TechDetails raw={raw()} />
          </span>
        </Alert>
      )}
    </Show>
  );
}

function ListError(props: { text: string; onRetry: () => void }) {
  return (
    <div class="browse__empty">
      <p class="browse__empty-title">The catalog did not load</p>
      <CliErr text={props.text} />
      <Button onClick={() => props.onRetry()}>Try again</Button>
    </div>
  );
}

/**
 * Quiet bar under the filters: the running progress or the finished summary. The plan itself shows in the
 * preview, so nothing renders for it here.
 */
function BatchBar(props: {
  batch: BatchState | null;
  onCancel: () => void;
  onToggleDone: () => void;
  onDismiss: () => void;
}) {
  const running = () => batchRunning(props.batch);
  const done = () => batchDone(props.batch);
  return (
    <>
      <Show when={running()}>
        {(b) => (
          <div class="batchbar">
            <span role="status">{`${b().label}: importing ${b().targets[b().at]?.id ?? ''} (${b().at + 1} of ${b().targets.length})`}</span>
            <Button size="sm" title="Stop after the current entry" onClick={() => props.onCancel()}>
              Cancel
            </Button>
          </div>
        )}
      </Show>
      <Show when={done()}>
        {(b) => (
          <Alert
            class="batchdone"
            tone={b().counts.refused > 0 ? 'warning' : 'success'}
            icon={b().counts.refused > 0 ? 'alert' : 'check'}
            role="status"
            actions={
              <>
                <Show when={b().counts.refused > 0}>
                  <Button size="sm" title="Show what was refused and why" aria-expanded={b().expanded} onClick={() => props.onToggleDone()}>
                    Details
                  </Button>
                </Show>
                <IconButton label="Dismiss" variant="ghost" onClick={() => props.onDismiss()}>
                  <Icon name="x" size={14} />
                </IconButton>
              </>
            }
          >
            <span>{`${b().label}: ${batchSummary(b().counts)}`}</span>
            <Show when={b().expanded}>
              <For each={b().refusals}>
                {(r) => (
                  <div class="batchref">
                    <span class="batchref__line">{`${nameOf(r.id)}: ${r.line}`}</span>
                    <TechDetails raw={r.err} />
                  </div>
                )}
              </For>
            </Show>
          </Alert>
        )}
      </Show>
    </>
  );
}
