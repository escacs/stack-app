// Browse + import, ported from the website's browse (stack/web/app.js): kind
// rows with ascii bars, entry rows with dotted leaders, search, file tree
// and rendered docs. Data comes through stack_run as --json; file bodies
// and images arrive via `show --file` (the web fetches them as URLs).
// Desktop additions, kept visually quiet: the import section, git-state
// markers on rows, inline row imports ([import] on hover/selection, `i`),
// batch imports ([import all N] per list and library group, multi-select
// with a shared action bar, one dry-run confirm and one summary), the /all
// route (the site links * all at #/search/), and click-only meta/preview
// links (the keyboard walks the tree files).
// Pure logic (routes, crumbs, catalog index, fetch cache) is in ../browseData.
import type { JSX } from 'solid-js';
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
import { errText, stackRun, type AppConfig } from '../bridge';
import { href } from '../router';
import { fmtBytes, kindOf, pluralOf } from '../parse';
import { moveSel } from '../onboard';
import { scrollByPage, scrollRowIntoView, scrollToTop } from '../smooth';
import {
  batchConfirmText,
  batchDest,
  batchSummary,
  defaultImportDest,
  describeImport,
  entryMarkers,
  fromStackOut,
  importArgs,
  importDestHint,
  importDryRunArgs,
  needsImportDest,
  planBatch,
  previewFresh,
  quickImportError,
  quickImportLine,
  refusalFiles,
  showFileArgs,
  toShowDoc,
  toShowFile,
  type BatchCounts,
  type BatchPlan,
  type ImportDryRunJson,
  type ImportJson,
  type JsonEntry,
  type ListJson,
  type OpSection,
  type ShowFile,
  type ShowFileJson,
  type ShowJson,
} from '../json';
import { config, lock, refreshLock, refreshReport } from '../store';
import { CliErr, Empty, Markers, OpResult } from '../ui';
import {
  applyRange,
  catalogs,
  buildIndex,
  byKindOrder,
  crumbParts,
  notImportedIds,
  previewCache,
  previewKey,
  rangeIds,
  resolveRoute,
  sameRoute,
  sourceKey,
  toggleSelected,
  whenVisible,
  type CatalogData,
  type CatalogIndex,
  type CrumbTarget,
  type Route,
} from '../browseData';
import {
  Bar,
  Face,
  FileTree,
  IMG_RE,
  Legend,
  Markdown,
  Sprite,
  fileRowOrder,
  groupComponents,
  kindAgg,
  libraryMeta,
  mimeFor,
  scoreEntries,
  type LibraryGroup,
} from '../site';

type Agg = ReturnType<typeof kindAgg>;
type Doc = ReturnType<typeof toShowDoc>;
type FileBody = ReturnType<typeof toShowFile>;

/**
 * One inline row import at a time, keyed by entry id. `done` keeps the full
 * sections for the click-to-expand log (no → project link: that stays on the
 * entry page); `error` keeps the stderr plus its look-alike list, if any.
 */
type QiState =
  | { id: string; phase: 'working' }
  | { id: string; phase: 'done'; line: string; sections: OpSection[]; expanded: boolean }
  | { id: string; phase: 'error'; line: string; err: string; lookalikes: string[]; expanded: boolean };

/** One planned batch import: '' dest means the CLI default. */
type BatchTarget = { id: string; dest: string };

/** A per-entry dry-run outcome: its collisions, or the dry-run's own error. */
type DryOutcome = { conflicts: string[] } | { error: string };
const dryConflicts = (d: DryOutcome): string[] => ('conflicts' in d ? d.conflicts : []);

/** A refused batch entry, with the same details as a failed row import. */
type BatchRefusal = { id: string; line: string; err: string; lookalikes: string[] };

/**
 * Batch import state: a dry-run confirm line first (nothing written yet),
 * then the sequential run, then the summary. `label` names the scope
 * (`components/react`, or `3 selected`). Only one batch runs at a time, and
 * never beside a row import.
 */
type BatchState =
  | {
      phase: 'confirm';
      label: string;
      plan: BatchPlan;
      base: string;
      targets: BatchTarget[];
      dry: Map<string, DryOutcome>;
      checking: boolean;
      expanded: boolean;
    }
  | { phase: 'running'; label: string; targets: BatchTarget[]; at: number; counts: BatchCounts; cancel: boolean }
  | { phase: 'done'; label: string; counts: BatchCounts; refusals: BatchRefusal[]; expanded: boolean };

/** Per-row batch results, rendered exactly like the row-import results. */
type BatchRowRes =
  | { phase: 'working' }
  | { phase: 'done'; line: string; sections: OpSection[]; expanded: boolean }
  | { phase: 'error'; line: string; err: string; lookalikes: string[]; expanded: boolean };

const batchConfirm = (b: BatchState | null) => (b?.phase === 'confirm' ? b : null);
const batchRunning = (b: BatchState | null) => (b?.phase === 'running' ? b : null);
const batchDone = (b: BatchState | null) => (b?.phase === 'done' ? b : null);
/** A batch holds the op lock while it confirms or runs; a summary does not. */
const batchBusyState = (b: BatchState | null): boolean => b?.phase === 'confirm' || b?.phase === 'running';

export default function Browse(props: { scenario: string; segs: string[] }) {
  const [entries, setEntries] = createSignal<JsonEntry[]>([]);
  const [uncommitted, setUncommitted] = createSignal<Set<string>>(new Set());
  const [note, setNote] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [q, setQ] = createSignal('');
  const [sel, setSel] = createSignal(-1);
  const [entryFiles, setEntryFiles] = createSignal<ShowFile[]>([]);
  const [qi, setQi] = createSignal<QiState | null>(null);
  const [qiAsk, setQiAsk] = createSignal<{ id: string; value: string } | null>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [batch, setBatch] = createSignal<BatchState | null>(null);
  const [batchRes, setBatchRes] = createSignal<Map<string, BatchRowRes>>(new Map());
  // Ids this batch run imported, until the lock refresh makes them official.
  const [landed, setLanded] = createSignal<Set<string>>(new Set());
  let inputEl: HTMLInputElement | undefined;
  let listGen = 0;
  // Row-import generation, bumped on navigation and project switch: an
  // import resolving afterwards is stale and must not land (see previewFresh).
  // The batch loop and the dry runs carry it too, for the same reason.
  let qiGen = 0;
  // Shift-select anchor (last toggled or cursor row) and the gutter drag flag.
  let anchor: string | null = null;
  let dragging = false;
  // Dry-run generation: a base edit restarts the dry runs, older answers drop.
  let dryGen = 0;
  let qiTimer: ReturnType<typeof setTimeout> | undefined;
  const clearQiTimer = (): void => {
    if (qiTimer !== undefined) {
      clearTimeout(qiTimer);
      qiTimer = undefined;
    }
  };
  onCleanup(clearQiTimer);
  let dryTimer: ReturnType<typeof setTimeout> | undefined;
  const clearDryTimer = (): void => {
    if (dryTimer !== undefined) {
      clearTimeout(dryTimer);
      dryTimer = undefined;
    }
  };
  onCleanup(clearDryTimer);
  // Leaving Browse mid-batch (or mid-row-import) stops the run after the
  // current entry: the generations invalidate every later answer, like a
  // route or project change does through clearBatchState. Without this the
  // loop would keep importing with no UI and no cancel.
  onCleanup(() => {
    qiGen++;
    dryGen++;
  });

  // Changes only when the project or stack checkout does, never on config edits.
  const source = createMemo(() => sourceKey(config()));
  // Identity holds while the route is the same, so route-keyed views survive list refreshes.
  const route = createMemo<Route>(() => resolveRoute(props.segs, entries()), { kind: 'home' }, { equals: sameRoute });
  const searching = createMemo(() => q().trim().length > 0);
  const index = createMemo<CatalogIndex>(() => buildIndex(entries()));
  const agg = createMemo<Agg>(() => kindAgg(entries()));
  const allSorted = createMemo(() => [...entries()].sort(byKindOrder));
  const found = createMemo(() => scoreEntries(entries(), q()));
  const kindList = createMemo(() => {
    const r = route();
    return r.kind === 'kind' ? entries().filter((e) => e.kind === r.kindSingular) : [];
  });
  const grouped = createMemo(() => {
    const r = route();
    return r.kind === 'kind' && r.kindSingular === 'component' ? groupComponents(kindList()) : null;
  });
  // The flat list shown for search, `all` and non-component kinds. One list
  // view serves all three, so rows that stay in view survive a switch.
  const listed = createMemo<JsonEntry[] | null>(() => {
    if (searching()) return found();
    const r = route();
    if (r.kind === 'all') return allSorted();
    if (r.kind === 'kind' && !grouped()) return kindList();
    return null;
  });
  const byId = (): boolean => searching() || route().kind === 'all';
  const entryId = (): string => {
    const r = route();
    return r.kind === 'entry' ? r.id : '';
  };
  const entryFile = (): string | null => {
    const r = route();
    return r.kind === 'entry' ? r.file : null;
  };

  const entryHref = (id: string): string => href(props.scenario, 'browse', ...id.split('/'));
  const kindHref = (kind: string): string =>
    kind ? href(props.scenario, 'browse', pluralOf(kind)) : href(props.scenario, 'browse');
  const allHref = (): string => href(props.scenario, 'browse', 'all');
  const fileHref = (id: string, file: string): string =>
    href(props.scenario, 'browse', ...id.split('/'), ...file.split('/'));
  const targetHref = (t: CrumbTarget | null): string | null => {
    if (!t) return null;
    if (t.to === 'home') return kindHref('');
    if (t.to === 'kind') return kindHref(t.kindSingular);
    return entryHref(t.id);
  };

  // Navigable rows for the keyboard cursor, like the web's [data-nav].
  const navRows = createMemo<{ href: string }[]>(() => {
    if (searching()) return found().map((e) => ({ href: entryHref(e.id) }));
    const r = route();
    if (r.kind === 'home') {
      return [...agg().stats.map((s) => ({ href: kindHref(s.kind) })), { href: allHref() }];
    }
    if (r.kind === 'all') return allSorted().map((e) => ({ href: entryHref(e.id) }));
    if (r.kind === 'kind') {
      // Components render grouped by library; the keyboard walks the same order.
      const g = grouped();
      const ordered = g ? [...g.groups.flatMap((x) => x.members), ...g.ungrouped] : kindList();
      return ordered.map((e) => ({ href: entryHref(e.id) }));
    }
    if (r.kind === 'entry') return fileRowOrder(entryFiles()).map((p) => ({ href: fileHref(r.id, p) }));
    return [];
  });

  const crumbs = createMemo(() =>
    crumbParts(route(), searching()).map((p) => ({ label: p.label, href: targetHref(p.target) })),
  );

  const importedIds = createMemo(() => new Set(lock().rows.map((r) => r.id)));

  /** Listed entries in row order, for the cursor, selection and batch runs. Empty off the lists. */
  const orderedEntries = (): JsonEntry[] => {
    if (searching()) return found();
    const r = route();
    if (r.kind === 'all') return allSorted();
    if (r.kind === 'kind') {
      const g = grouped();
      return g ? [...g.groups.flatMap((x) => x.members), ...g.ungrouped] : kindList();
    }
    return [];
  };

  /** The entry under the keyboard cursor, when the cursor is on an entry row. */
  const selEntry = (): JsonEntry | null => {
    const i = sel();
    return i < 0 ? null : (orderedEntries()[i] ?? null);
  };

  /** A result line clears itself after a few seconds, unless expanded. */
  const armQiTimer = (ms: number): void => {
    clearQiTimer();
    qiTimer = setTimeout(() => {
      const s = qi();
      if (s && s.phase !== 'working' && !s.expanded) setQi(null);
    }, ms);
  };

  const toggleQiFull = (): void => {
    const s = qi();
    if (!s || s.phase === 'working') return;
    clearQiTimer();
    setQi({ ...s, expanded: !s.expanded });
    if (s.expanded) armQiTimer(8000);
  };

  /**
   * Import straight from a row: one click with the default destination, no
   * navigation. Entries needing a destination open the inline `to` field
   * instead; `dest` set means that field was confirmed. Like the entry
   * page, a success refreshes the lock, the report and the catalog.
   */
  async function quickImport(e: JsonEntry, dest?: string): Promise<void> {
    if (qi()?.phase === 'working' || batchBusyState(batch())) return;
    const c = config();
    if (!c?.project) return;
    if (importedIds().has(e.id) || !e.committed) return;
    // A fresh row import retires a finished batch summary and its row lines.
    if (batchDone(batch())) {
      setBatch(null);
      setBatchRes(new Map());
    }
    if (dest === undefined && needsImportDest(e)) {
      if (qiAsk()?.id !== e.id) {
        clearQiTimer();
        setQi(null);
        setQiAsk({ id: e.id, value: importDestHint(e) ?? '' });
      }
      return;
    }
    clearQiTimer();
    setQiAsk(null);
    const gen = qiGen;
    setQi({ id: e.id, phase: 'working' });
    try {
      const out = await stackRun('import', importArgs(e.id, dest ?? ''), c.project, c.stackPath);
      if (!previewFresh(gen, qiGen)) return;
      const r = fromStackOut<ImportJson>(out);
      setQi({ id: e.id, phase: 'done', line: quickImportLine(r, e.id), sections: describeImport(r), expanded: false });
      // A single-row bar import delegates here: the row is imported, so it
      // leaves the selection instead of stranding `1 selected`.
      setSelected((prev) => {
        if (!prev.has(e.id)) return prev;
        const next = new Set(prev);
        next.delete(e.id);
        return next;
      });
      await refreshLock();
      // Import creates stack.toml implicitly: the project page's set-up slot
      // must re-check on the next visit.
      await refreshReport();
      void load();
      armQiTimer(8000);
    } catch (err) {
      if (!previewFresh(gen, qiGen)) return;
      const text = errText(err);
      const lookalikes = refusalFiles(text);
      setQi({
        id: e.id,
        phase: 'error',
        line: quickImportError(text),
        err: text,
        lookalikes,
        expanded: false,
      });
      // A look-alike refusal on a skill or style is a dead end without a
      // destination field, so offer the same inline `to` the row opens for
      // components, prefilled with the default destination.
      if (lookalikes.length && (e.kind === 'skill' || e.kind === 'style')) {
        setQiAsk({ id: e.id, value: defaultImportDest(e) });
      }
      armQiTimer(15000);
    }
  }

  const confirmQiAsk = (): void => {
    const a = qiAsk();
    if (!a) return;
    const dest = a.value.trim();
    if (!dest) return;
    const e = index().byId.get(a.id);
    if (e) void quickImport(e, dest);
  };

  // ------------------------------------------------------------------ selection

  /** Selection edits are ignored while a batch confirms or runs (its plan is a snapshot). */
  const canSelect = (): boolean => !batchBusyState(batch());

  /** A selection change over a finished summary dismisses it for the action bar. */
  const editSelection = (next: Set<string>): void => {
    if (!canSelect()) return;
    if (batchDone(batch())) setBatch(null);
    setSelected(next);
  };

  const toggleRow = (id: string): void => {
    if (!canSelect()) return;
    anchor = id;
    editSelection(toggleSelected(selected(), id));
  };

  const extendTo = (id: string, additive: boolean): void => {
    if (!canSelect()) return;
    const order = orderedEntries().map((e) => e.id);
    if (!order.includes(id)) return;
    anchor ??= id;
    editSelection(applyRange(selected(), rangeIds(order, anchor, id), additive));
  };

  const selectAllNotImported = (): void => {
    if (!canSelect()) return;
    anchor = null;
    editSelection(new Set<string>(notImportedIds(orderedEntries(), importedIds())));
  };

  const clearSelection = (): void => {
    if (!canSelect()) return;
    anchor = null;
    editSelection(new Set<string>());
  };

  /** Click on a row link: modifiers select instead of navigating. */
  const onRowClick = (e: JsonEntry, ev: MouseEvent): void => {
    if (ev.shiftKey) {
      ev.preventDefault();
      extendTo(e.id, ev.ctrlKey || ev.metaKey);
    } else if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      toggleRow(e.id);
    }
  };

  /** Gutter press: toggle (or range with Shift) and start a drag-select. */
  const onGutterDown = (e: JsonEntry, ev: MouseEvent): void => {
    if (ev.button !== 0 || !canSelect()) return;
    ev.preventDefault();
    if (ev.shiftKey) extendTo(e.id, ev.ctrlKey || ev.metaKey);
    else toggleRow(e.id);
    dragging = true;
  };

  /** Gutter hover mid-drag: the selection follows the dragged range. */
  const onGutterOver = (e: JsonEntry): void => {
    if (dragging) extendTo(e.id, false);
  };

  // ------------------------------------------------------------------ batch import

  /** Targets for a confirm: ready entries plus needs-dest ones under the base (skipped when empty). */
  const confirmTargets = (plan: BatchPlan, base: string): BatchTarget[] => [
    ...plan.ready.map((e) => ({ id: e.id, dest: '' })),
    ...(base.trim() ? plan.needDest.map((e) => ({ id: e.id, dest: batchDest(base, e.name) })) : []),
  ];

  const confirmSkipped = (plan: BatchPlan, base: string): number =>
    plan.already.length + plan.unimportable.length + (base.trim() ? 0 : plan.needDest.length);

  /**
   * Open a batch over candidates: one candidate behaves like its row import
   * (the ask field included); several targets get the dry-run confirm line;
   * nothing importable lands straight on the summary.
   */
  function startBatch(label: string, candidates: JsonEntry[]): void {
    if (qi()?.phase === 'working' || batchBusyState(batch())) return;
    const c = config();
    if (!c?.project || !candidates.length) return;
    clearQiTimer();
    setQi(null);
    setQiAsk(null);
    const plan = planBatch(candidates, importedIds());
    if (candidates.length === 1) {
      const only = candidates[0];
      if (plan.ready.length === 1 || plan.needDest.length === 1) {
        void quickImport(only);
        return;
      }
      setBatch({
        phase: 'done',
        label,
        counts: {
          imported: 0,
          already: plan.already.length,
          refused: 0,
          skipped: plan.unimportable.length,
          stopped: false,
        },
        refusals: [],
        expanded: false,
      });
      return;
    }
    // Component batches start with the source-tree convention as the shared
    // base, so one confirm imports them; anything else asks for a base.
    const base = plan.needDest.length && plan.needDest.every((e) => e.kind === 'component') ? 'src/components' : '';
    const targets = confirmTargets(plan, base);
    if (targets.length < 2) {
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
      setBatch({ phase: 'confirm', label, plan, base, targets, dry: new Map(), checking: false, expanded: false });
      void runBatch();
      return;
    }
    setBatch({ phase: 'confirm', label, plan, base, targets, dry: new Map(), checking: true, expanded: false });
    void dryRunAll(plan, base, ++dryGen, qiGen);
  }

  /** Dry-run every target in turn; the confirm line shows the collisions. Writes nothing. */
  async function dryRunAll(plan: BatchPlan, base: string, gen: number, qgen: number): Promise<void> {
    const c = config();
    const targets = confirmTargets(plan, base);
    const dry = new Map<string, DryOutcome>();
    for (const t of targets) {
      try {
        const out = await stackRun('import', importDryRunArgs(t.id, t.dest), c?.project ?? '.', c?.stackPath);
        if (gen !== dryGen || !previewFresh(qgen, qiGen)) return;
        dry.set(t.id, { conflicts: fromStackOut<ImportDryRunJson>(out).conflicts ?? [] });
      } catch (err) {
        if (gen !== dryGen || !previewFresh(qgen, qiGen)) return;
        dry.set(t.id, { error: errText(err) });
      }
    }
    if (gen !== dryGen || !previewFresh(qgen, qiGen)) return;
    const b = batchConfirm(batch());
    if (b && b.plan === plan && b.base === base) setBatch({ ...b, dry, checking: false });
  }

  /** A base edit re-plans the targets and re-runs the dry runs (debounced). */
  const onBatchBase = (value: string): void => {
    const b = batchConfirm(batch());
    if (!b) return;
    const targets = confirmTargets(b.plan, value);
    setBatch({ ...b, base: value, targets, dry: new Map(), checking: true });
    clearDryTimer();
    const gen = ++dryGen;
    const qgen = qiGen;
    const plan = b.plan;
    dryTimer = setTimeout(() => void dryRunAll(plan, value, gen, qgen), 400);
  };

  const cancelBatch = (): void => {
    const b = batch();
    if (b?.phase === 'confirm') {
      clearDryTimer();
      dryGen++;
      setBatch(null);
      focusList();
    } else if (b?.phase === 'running') {
      setBatch({ ...b, cancel: true });
    }
  };

  /** Entries needing no destination import blindly; the base covers the rest. Never atomic. */
  async function runBatch(): Promise<void> {
    const b = batchConfirm(batch());
    const c = config();
    if (!b || b.checking || !c?.project || qi()?.phase === 'working') return;
    clearDryTimer();
    dryGen++;
    const gen = qiGen;
    const counts: BatchCounts = {
      imported: 0,
      already: b.plan.already.length,
      refused: 0,
      skipped: confirmSkipped(b.plan, b.base) - b.plan.already.length,
      stopped: false,
    };
    const refusals: BatchRefusal[] = [];
    // Imports attempted so far: a route change or unmount mid-run still
    // lands the lock/report refresh, so the project page shows the imports.
    let attempted = 0;
    /** A stale early return still refreshes once anything was attempted. */
    const refreshAfterStale = async (): Promise<void> => {
      if (!attempted) return;
      await refreshLock();
      await refreshReport();
    };
    setBatchRes(new Map());
    setBatch({ phase: 'running', label: b.label, targets: b.targets, at: 0, counts, cancel: false });
    for (let i = 0; i < b.targets.length; i++) {
      const t = b.targets[i];
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
      setBatchRes((prev) => new Map(prev).set(t.id, { phase: 'working' }));
      attempted++;
      try {
        const out = await stackRun('import', importArgs(t.id, t.dest), c.project, c.stackPath);
        if (!previewFresh(gen, qiGen)) {
          await refreshAfterStale();
          return;
        }
        const r = fromStackOut<ImportJson>(out);
        const e = index().byId.get(t.id);
        if (r.imported.some((p) => p.id === t.id)) {
          counts.imported++;
          setLanded((prev) => new Set<string>(prev).add(t.id));
        } else if (r.already.includes(t.id)) {
          counts.already++;
        } else {
          counts.imported++;
          if (e) setLanded((prev) => new Set<string>(prev).add(t.id));
        }
        const line = quickImportLine(r, t.id);
        const sections = describeImport(r);
        setBatchRes((prev) => new Map(prev).set(t.id, { phase: 'done', line, sections, expanded: false }));
      } catch (err) {
        if (!previewFresh(gen, qiGen)) {
          await refreshAfterStale();
          return;
        }
        const text = errText(err);
        counts.refused++;
        refusals.push({ id: t.id, line: quickImportError(text), err: text, lookalikes: refusalFiles(text) });
        setBatchRes((prev) =>
          new Map(prev).set(t.id, { phase: 'error', line: quickImportError(text), err: text, lookalikes: refusalFiles(text), expanded: false }),
        );
      }
    }
    if (!previewFresh(gen, qiGen)) {
      await refreshAfterStale();
      return;
    }
    await refreshLock();
    // The lock is authoritative again: landed rows flip through it from here.
    if (!previewFresh(gen, qiGen)) {
      await refreshReport();
      return;
    }
    setLanded(new Set<string>());
    await refreshReport();
    void load();
    setSelected(new Set<string>());
    anchor = null;
    setBatch({ phase: 'done', label: b.label, counts, refusals, expanded: false });
  }

  const toggleBatchRow = (id: string): void => {
    setBatchRes((prev) => {
      const cur = prev.get(id);
      if (!cur || cur.phase === 'working') return prev;
      return new Map(prev).set(id, { ...cur, expanded: !cur.expanded });
    });
  };

  /** Selection imports run in list order; stray ids follow in catalog order. */
  const selectionCandidates = (): JsonEntry[] => {
    const ids = selected();
    if (!ids.size) return [];
    const pos = new Map(orderedEntries().map((e, i) => [e.id, i]));
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

  const up = (): void => {
    const r = route();
    if (r.kind === 'entry') location.hash = r.file ? entryHref(r.id) : kindHref(kindOf(r.id));
    else if (r.kind === 'kind' || r.kind === 'all' || r.kind === 'missing') location.hash = kindHref('');
  };

  const clearQuery = (): void => {
    setQ('');
    if (inputEl) inputEl.value = '';
  };

  /** After the bar closes (dismiss/cancel), focus returns to the list: the cursor row, else the prompt. */
  const focusList = (): void => {
    const i = sel();
    const row = i >= 0 ? (document.querySelector(`[data-row="${i}"]`) as HTMLElement | null) : null;
    if (row) row.focus();
    else if (matchMedia('(hover: hover)').matches) inputEl?.focus();
  };

  /**
   * Stale-while-revalidate: a cached catalog renders at once and refreshes in
   * the background; `loading…` shows only when this source has no cache yet.
   */
  async function load(): Promise<void> {
    const c = config();
    const key = sourceKey(c);
    const gen = ++listGen;
    const cached = catalogs.get(key);
    if (cached) {
      setEntries(cached.entries);
      setUncommitted(cached.uncommitted);
      setLoaded(true);
    } else {
      setEntries([]);
      setUncommitted(new Set<string>());
      setLoaded(false);
      setNote(null);
    }
    try {
      const out = await stackRun('list', ['--json'], c?.project ?? '.', c?.stackPath);
      if (gen !== listGen) return;
      if (cached && cached.raw === out.stdout) {
        setNote(null);
        return;
      }
      const data = fromStackOut<ListJson>(out);
      const next: CatalogData = {
        raw: out.stdout,
        entries: data.entries,
        uncommitted: new Set<string>(data.uncommitted ?? []),
      };
      catalogs.set(key, next);
      setEntries(next.entries);
      setUncommitted(next.uncommitted);
      setNote(null);
    } catch (err) {
      if (gen !== listGen) return;
      setNote(errText(err));
    } finally {
      if (gen === listGen) setLoaded(true);
    }
  }

  onMount(() => {
    if (matchMedia('(hover: hover)').matches) inputEl?.focus();

    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      // The search box is ours; other fields (the --to input) keep their keys.
      if (t && t !== inputEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return;
      // Buttons and links keep Enter and Space for their own activation.
      if (t && ['BUTTON', 'A'].includes(t.tagName) && (ev.key === 'Enter' || ev.key === ' ')) return;
      // Shift+arrows extend the selection from the anchor over entry rows.
      if (ev.shiftKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (!canSelect()) return;
        const order = orderedEntries().map((e) => e.id);
        if (!order.length) {
          setSel((s) => moveSel(s, ev.key === 'ArrowDown' ? 1 : -1, navRows().length));
          return;
        }
        const from = order[sel()] ?? null;
        if (from) anchor ??= from;
        setSel((s) => moveSel(s, ev.key === 'ArrowDown' ? 1 : -1, navRows().length));
        const to = order[sel()] ?? null;
        if (to) {
          anchor ??= to;
          editSelection(applyRange(selected(), rangeIds(order, anchor, to), false));
        }
        return;
      }
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          setSel((s) => moveSel(s, 1, navRows().length));
          return;
        case 'ArrowUp':
          ev.preventDefault();
          setSel((s) => moveSel(s, -1, navRows().length));
          return;
        case 'Enter': {
          const list = navRows();
          const pick = sel() >= 0 ? list[sel()] : q().trim() ? list[0] : undefined;
          if (pick) {
            ev.preventDefault();
            location.hash = pick.href;
          }
          return;
        }
        case 'Escape': {
          ev.preventDefault();
          const b = batch();
          if (b?.phase === 'confirm' || b?.phase === 'running') cancelBatch();
          else if (b?.phase === 'done') {
            setBatch(null);
            focusList();
          }
          else if (selected().size) clearSelection();
          else if (q()) clearQuery();
          else up();
          return;
        }
      }
      // `i` imports the cursor row in place. Text fields keep it (the
      // early return above, plus the search box here); with no cursor row it
      // falls through and lands in the search like any other letter.
      if (ev.key === 'i' && t !== inputEl) {
        const e = selEntry();
        if (e) {
          ev.preventDefault();
          void quickImport(e);
          return;
        }
      }
      // `a` selects every not-imported row in the list whenever one is
      // showing, no cursor needed. Text fields keep the key (the early
      // return above) and the search box keeps it here, so typing `a`
      // still works everywhere it should.
      if (ev.key === 'a' && t !== inputEl) {
        if (orderedEntries().length) {
          ev.preventDefault();
          selectAllNotImported();
          return;
        }
      }
      // Space toggles the cursor row; with no cursor row it keeps scrolling.
      if (ev.key === ' ') {
        const e = t !== inputEl ? selEntry() : null;
        if (e) {
          ev.preventDefault();
          toggleRow(e.id);
          return;
        }
        if (!q()) {
          ev.preventDefault();
          scrollByPage(window.innerHeight * 0.8);
          return;
        }
      }
      if (ev.key.length === 1 && t !== inputEl) inputEl?.focus();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
    // A gutter drag-select ends on any mouse release.
    const onUp = () => {
      dragging = false;
    };
    window.addEventListener('mouseup', onUp);
    onCleanup(() => window.removeEventListener('mouseup', onUp));
  });

  // Catalog loads for this source; a project or stack switch reloads, nothing else does.
  createEffect(() => {
    source();
    untrack(() => void load());
  });

  /** Selection, batch and row results belong to the route and project they ran against. */
  const clearBatchState = (): void => {
    qiGen++;
    dryGen++;
    dragging = false;
    anchor = null;
    clearQiTimer();
    clearDryTimer();
    setQi(null);
    setQiAsk(null);
    setSelected(new Set<string>());
    setBatch(null);
    setBatchRes(new Map());
    setLanded(new Set<string>());
  };

  // A new route clears the prompt, the cursor and any inline import, like the web hashchange.
  createEffect(
    on(
      () => props.segs.join('/'),
      () => {
        untrack(clearQuery);
        setSel(-1);
        untrack(clearBatchState);
        scrollToTop();
      },
      { defer: true },
    ),
  );

  // A project switch clears the inline import state, like Project.tsx: the
  // result and the ask field belong to the project they ran against.
  createEffect(
    on(
      () => config()?.project ?? null,
      () => {
        untrack(clearBatchState);
      },
      { defer: true },
    ),
  );

  createEffect(on(q, () => setSel(-1), { defer: true }));

  createEffect(
    on(
      sel,
      (i) => {
        if (i >= 0) {
          const row = document.querySelector(`[data-row="${i}"]`);
          if (row) scrollRowIntoView(row);
        }
      },
      { defer: true },
    ),
  );

  return (
    <>
      <div id="prompt">
        <nav id="crumbs" aria-label="path">
          <For each={crumbs()}>
            {(c, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="sep">/</span>
                </Show>
                <Show when={c.href} fallback={<span>{c.label}</span>}>
                  {(h) => <a href={h()}>{c.label}</a>}
                </Show>
              </>
            )}
          </For>
        </nav>
        <span class="ps" aria-hidden="true">
          ›
        </span>
        <input
          id="q"
          ref={inputEl}
          type="text"
          role="searchbox"
          aria-label="search entries"
          placeholder="type to search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
      </div>
      <BatchBar
        batch={batch()}
        selectedCount={selected().size}
        onImportSelection={importSelection}
        onClearSelection={clearSelection}
        onBase={onBatchBase}
        onRun={() => void runBatch()}
        onCancel={cancelBatch}
        onToggleConfirm={() => setBatch((b) => (b?.phase === 'confirm' ? { ...b, expanded: !b.expanded } : b))}
        onToggleDone={() => setBatch((b) => (b?.phase === 'done' ? { ...b, expanded: !b.expanded } : b))}
        onDismiss={() => {
          setBatch(null);
          focusList();
        }}
      />
      <Show when={!note()} fallback={<CliErr text={note() as string} />}>
        <Switch>
          <Match when={!loaded()}>
            <Empty>(._.) loading…</Empty>
          </Match>
          <Match when={!entries().length}>
            <Empty>(._.) none</Empty>
          </Match>
          <Match when={listed() !== null}>
            <EntryList
              byId={byId()}
              entries={listed() ?? []}
              uncommitted={uncommitted()}
              sel={sel()}
              entryHref={entryHref}
              qi={qi()}
              ask={qiAsk()}
              importedIds={importedIds()}
              onImport={(e) => void quickImport(e)}
              onAskInput={(value) => setQiAsk((a) => (a ? { ...a, value } : a))}
              onAskConfirm={confirmQiAsk}
              onAskClose={() => setQiAsk(null)}
              onToggleFull={toggleQiFull}
              batchRes={batchRes()}
              landed={landed()}
              selected={selected()}
              batchBusy={batchBusyState(batch())}
              onRowClick={onRowClick}
              onGutterDown={onGutterDown}
              onGutterOver={onGutterOver}
              onBatchToggle={toggleBatchRow}
              onImportAll={searching() ? null : (label, members) => startBatch(label, members)}
              batchLabel={(() => {
                const r = route();
                return r.kind === 'kind' ? pluralOf(r.kindSingular) : 'all';
              })()}
            />
          </Match>
          <Match when={route().kind === 'home' && !searching()}>
            <KindHome agg={agg()} entries={entries()} sel={sel()} kindHref={kindHref} allHref={allHref()} />
          </Match>
          <Match when={grouped()}>
            {(g) => (
              <ComponentKindView
                groups={g().groups}
                ungrouped={g().ungrouped}
                uncommitted={uncommitted()}
                sel={sel()}
                entryHref={entryHref}
                qi={qi()}
                ask={qiAsk()}
                importedIds={importedIds()}
                onImport={(e) => void quickImport(e)}
                onAskInput={(value) => setQiAsk((a) => (a ? { ...a, value } : a))}
                onAskConfirm={confirmQiAsk}
                onAskClose={() => setQiAsk(null)}
                onToggleFull={toggleQiFull}
                batchRes={batchRes()}
                landed={landed()}
                selected={selected()}
                batchBusy={batchBusyState(batch())}
                onRowClick={onRowClick}
                onGutterDown={onGutterDown}
                onGutterOver={onGutterOver}
                onBatchToggle={toggleBatchRow}
                onImportAll={(label, members) => startBatch(label, members)}
              />
            )}
          </Match>
          <Match when={route().kind === 'entry'}>
            <EntryDetail
              scenario={props.scenario}
              id={entryId()}
              file={entryFile()}
              source={source()}
              entries={entries()}
              index={index()}
              sel={sel()}
              entryHref={entryHref}
              fileHref={fileHref}
              onFiles={setEntryFiles}
              onImported={() => void load()}
            />
          </Match>
          <Match when={route().kind === 'missing'}>
            <Empty>(o_O) not found</Empty>
          </Match>
        </Switch>
      </Show>
    </>
  );
}

/** One keyboard-cursor target: `data-row` index plus the selected attribute. */
function Krow(props: { index: number; sel: number; href: string; zero: boolean; children: JSX.Element }) {
  const selected = createMemo(() => props.sel === props.index);
  return (
    <a
      class={`krow${props.zero ? ' zero' : ''}`}
      href={props.href}
      data-row={props.index}
      data-nav=""
      data-sel={selected() ? '' : undefined}
    >
      {props.children}
    </a>
  );
}

/** Inline-import plumbing threaded from Browse into every entry row. */
type QiProps = {
  qi: QiState | null;
  ask: { id: string; value: string } | null;
  importedIds: Set<string>;
  onImport: (e: JsonEntry) => void;
  onAskInput: (value: string) => void;
  onAskConfirm: () => void;
  onAskClose: () => void;
  onToggleFull: () => void;
};

/** Batch plumbing threaded from Browse into every entry row and list header. */
type BatchListProps = {
  batchRes: Map<string, BatchRowRes>;
  landed: Set<string>;
  selected: Set<string>;
  batchBusy: boolean;
  onRowClick: (e: JsonEntry, ev: MouseEvent) => void;
  onGutterDown: (e: JsonEntry, ev: MouseEvent) => void;
  onGutterOver: (e: JsonEntry) => void;
  onBatchToggle: (id: string) => void;
  /** Null on search results, which get selection but no import-all. */
  onImportAll: ((label: string, members: JsonEntry[]) => void) | null;
};

/** Entries an import-all button would attempt: committed and not imported. */
const importAllCount = (members: JsonEntry[], imported: Set<string>): number => {
  const p = planBatch(members, imported);
  return p.ready.length + p.needDest.length;
};

/** One finished inline result under a row, shared by row imports and batch rows. */
type RowRes =
  | { phase: 'done'; line: string; sections: OpSection[]; expanded: boolean }
  | { phase: 'error'; line: string; err: string; lookalikes: string[]; expanded: boolean };

function RowResult(props: { res: RowRes; onToggle: () => void }) {
  return (
    <div class="qires">
      <Show
        when={props.res.phase === 'done'}
        fallback={
          <>
            <span class="conflict">{(props.res as { line: string }).line}</span>
            <button
              class="btn"
              title="show the full error"
              aria-expanded={props.res.expanded}
              onClick={() => props.onToggle()}
            >
              details
            </button>
            <Show when={props.res.expanded}>
              <Show
                when={(props.res as { lookalikes: string[] }).lookalikes.length}
                fallback={<CliErr text={(props.res as { err: string }).err} />}
              >
                <p class="conflict" role="alert">
                  untracked look-alikes, nothing written:
                </p>
                <pre class="raw">{(props.res as { lookalikes: string[] }).lookalikes.join('\n')}</pre>
              </Show>
            </Show>
          </>
        }
      >
        <button
          class="qiline"
          title="show the full import log"
          aria-expanded={props.res.expanded}
          onClick={() => props.onToggle()}
        >
          {props.res.line}
        </button>
        <Show when={props.res.expanded}>
          <OpResult sections={(props.res as { sections: OpSection[] }).sections} />
        </Show>
      </Show>
    </div>
  );
}

/**
 * Quiet sticky bar under the prompt: the selection actions (`N selected
 * [import] [clear]`), the batch dry-run confirm, the running progress, or
 * the finished summary. Nothing renders while idle.
 */
function BatchBar(props: {
  batch: BatchState | null;
  selectedCount: number;
  onImportSelection: () => void;
  onClearSelection: () => void;
  onBase: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onToggleConfirm: () => void;
  onToggleDone: () => void;
  onDismiss: () => void;
}) {
  const confirm = () => batchConfirm(props.batch);
  const running = () => batchRunning(props.batch);
  const done = () => batchDone(props.batch);
  let confirmBar: HTMLDivElement | undefined;
  let importBtn: HTMLButtonElement | undefined;
  // Focus [import] once the confirm is actionable, unless the user already
  // moved into the bar (e.g. typing in `to:`). The button remounts with
  // every confirm, so the marker fires once per confirm.
  createEffect(() => {
    const b = confirm();
    if (!b || b.checking || !importBtn) return;
    if (importBtn.dataset.armed) return;
    importBtn.dataset.armed = '1';
    if (!confirmBar?.contains(document.activeElement)) importBtn.focus();
  });
  return (
    <>
      <Show when={confirm()}>
        {(b) => {
          const hits = () =>
            b().targets.filter((t) => dryConflicts(b().dry.get(t.id) ?? { conflicts: [] }).length > 0);
          const errors = () =>
            b().targets.filter((t) => {
              const d = b().dry.get(t.id);
              return d && 'error' in d;
            });
          const uncovered = () => (b().base.trim() ? 0 : b().plan.needDest.length);
          const skipped = () => b().plan.already.length + b().plan.unimportable.length + uncovered();
          const lines = () => [
            ...hits().flatMap((t) =>
              dryConflicts(b().dry.get(t.id) ?? { conflicts: [] }).map((f) => `${t.id} — ${f}`),
            ),
            ...errors().map((t) => `${t.id} — ${(b().dry.get(t.id) as { error: string }).error.split('\n')[0]}`),
          ];
          return (
            <div class="batchbar" ref={confirmBar}>
              <span role="status">{`${b().label}: ${batchConfirmText({ count: b().targets.length, needDest: uncovered(), conflicts: hits().length, skipped: skipped() })}`}</span>
              <Show when={b().checking} fallback={
                <Show when={lines().length > 0}>
                  <button
                    class="btn"
                    title="show what would collide"
                    aria-expanded={b().expanded}
                    onClick={() => props.onToggleConfirm()}
                  >
                    details
                  </button>
                </Show>
              }>
                <span class="dimtxt">checking…</span>
              </Show>
              <Show when={b().plan.needDest.length > 0}>
                <span class="dimtxt">to:</span>
                <input
                  type="text"
                  value={b().base}
                  size={16}
                  aria-label="shared destination folder for entries needing one"
                  title="one folder for every entry needing a destination (each lands in <folder>/<name>); empty skips them"
                  onInput={(ev) => props.onBase(ev.currentTarget.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault();
                      props.onRun();
                    } else if (ev.key === 'Escape') {
                      ev.preventDefault();
                      ev.stopPropagation();
                      props.onCancel();
                    }
                  }}
                />
              </Show>
              <button
                class="btn"
                ref={importBtn}
                disabled={b().checking || !b().targets.length}
                onClick={() => props.onRun()}
              >
                import
              </button>
              <button class="linklike" title="close without importing" onClick={() => props.onCancel()}>
                cancel
              </button>
              <Show when={b().expanded && lines().length > 0}>
                <pre class="raw conflict">{lines().join('\n')}</pre>
              </Show>
            </div>
          );
        }}
      </Show>
      <Show when={running()}>
        {(b) => (
          <div class="batchbar">
            <span>{`${b().label}: importing ${b().targets[b().at]?.id ?? ''} (${b().at + 1} of ${b().targets.length})`}</span>
            <button class="linklike" title="stop after the current entry" onClick={() => props.onCancel()}>
              cancel
            </button>
          </div>
        )}
      </Show>
      <Show when={done()}>
        {(b) => (
          <div class="batchbar">
            <span role="status">{`${b().label}: ${batchSummary(b().counts)}`}</span>
            <Show when={b().counts.refused > 0}>
              <button
                class="btn"
                title="show what was refused and why"
                aria-expanded={b().expanded}
                onClick={() => props.onToggleDone()}
              >
                details
              </button>
            </Show>
            <button class="linklike" title="dismiss" onClick={() => props.onDismiss()}>
              x
            </button>
            <Show when={b().expanded}>
              <For each={b().refusals}>
                {(r) => (
                  <div class="batchref">
                    <span class="conflict">{`${r.id}: ${r.line}`}</span>
                    <Show when={r.lookalikes.length} fallback={<CliErr text={r.err} />}>
                      <pre class="raw">{r.lookalikes.join('\n')}</pre>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        )}
      </Show>
      <Show when={!props.batch && props.selectedCount > 0}>
        <div class="batchbar">
          <span>{`${props.selectedCount} selected`}</span>
          <button class="btn" title="import every selected row in turn" onClick={() => props.onImportSelection()}>
            import
          </button>
          <button class="linklike" title="clear the selection" onClick={() => props.onClearSelection()}>
            clear
          </button>
        </div>
      </Show>
    </>
  );
}

/** One catalog row: sprite, name, dotted leader, preview, face, size, import slot. */
function EntryRow(
  props: {
    e: JsonEntry;
    byId: boolean;
    uncommitted: Set<string>;
    index: number;
    sel: number;
    entryHref: (id: string) => string;
    checked: boolean;
    bres: BatchRowRes | null;
    landed: boolean;
    batchBusy: boolean;
    onRowClick: (e: JsonEntry, ev: MouseEvent) => void;
    onGutterDown: (e: JsonEntry, ev: MouseEvent) => void;
    onGutterOver: (e: JsonEntry) => void;
    onBatchToggle: (id: string) => void;
  } & QiProps,
) {
  let rowEl: HTMLAnchorElement | undefined;
  const selected = createMemo(() => props.sel === props.index);
  const markers = () => entryMarkers(props.e, props.uncommitted);
  const [thumb, setThumb] = createSignal<string | null>(null);

  onMount(() => {
    const file = props.e.preview;
    if (!file || !rowEl) return;
    const id = props.e.id;
    const c = config();
    const key = previewKey(sourceKey(c), id, file);
    // Revisits render from the cache with no fetch at all.
    const hit = previewCache.peek(key);
    if (hit !== undefined) {
      setThumb(hit);
      return;
    }
    // Fetch only once the row is near the viewport; skip rows scrolled past before their turn.
    let alive = true;
    const stop = whenVisible(rowEl, () => {
      void previewCache
        .load(key, () => fetchImageUrl(c, id, file), () => alive)
        .then((url) => {
          if (alive && url) setThumb(url);
        });
    });
    onCleanup(() => {
      alive = false;
      stop();
    });
  });

  const active = (): QiState | null => {
    const s = props.qi;
    return s?.id === props.e.id ? s : null;
  };
  const asking = (): boolean => props.ask?.id === props.e.id;
  const imported = (): boolean => props.importedIds.has(props.e.id) || props.landed;
  const opBusy = (): boolean =>
    (props.qi?.phase === 'working' && props.qi.id !== props.e.id) || props.batchBusy;
  const importTitle = (): string =>
    needsImportDest(props.e)
      ? 'import to a folder you choose'
      : `import to ${defaultImportDest(props.e)}`;
  /** The finished inline result, if any: a row import and a batch never overlap. */
  const result = (): RowRes | null => {
    const s = active();
    if (s && s.phase !== 'working') return s;
    const b = props.bres;
    return b && b.phase !== 'working' ? b : null;
  };
  const resultIsQi = (): boolean => {
    const s = active();
    return !!s && s.phase !== 'working';
  };
  const working = (): boolean => active()?.phase === 'working' || props.bres?.phase === 'working';

  return (
    <div class="qi" data-checked={props.checked ? '' : undefined}>
      <div class="qirow">
        <span
          class="gut"
          data-lenis-prevent=""
          data-on={props.checked ? '' : undefined}
          title="select row (drag across rows to select several)"
          aria-hidden="true"
          onMouseDown={(ev) => props.onGutterDown(props.e, ev)}
          onMouseEnter={() => props.onGutterOver(props.e)}
        />
        <a
          ref={rowEl}
          class="row"
          href={props.entryHref(props.e.id)}
          data-row={props.index}
          data-nav=""
          data-sel={selected() ? '' : undefined}
          onClick={(ev) => props.onRowClick(props.e, ev)}
        >
          <Sprite kind={props.e.kind} origin={props.e.origin} />
          <span class="nm">{props.byId ? props.e.id : (props.e.name ?? props.e.id)}</span>
          <Markers notCommitted={markers().notCommitted} uncommittedInStack={markers().uncommittedInStack} />
          <span class="lead" aria-hidden="true" />
          <Show when={thumb()}>{(src) => <img class="rthumb" src={src()} alt="" />}</Show>
          <Face status={props.e.status} />
          <span class="num">{`${props.e.files}f ${fmtBytes(props.e.bytes)}`}</span>
        </a>
        <span class="qiact">
          <Show
            when={!imported() && props.e.committed}
            fallback={
              <Show when={imported()}>
                <span class="marker" title="already imported in this project">
                  imported
                </span>
              </Show>
            }
          >
            <Show when={working()} fallback={
              <button
                class="btn"
                disabled={opBusy()}
                title={importTitle()}
                aria-label={`import ${props.e.id}`}
                onClick={() => props.onImport(props.e)}
              >
                import
              </button>
            }>
              <span class="dimtxt">working</span>
            </Show>
          </Show>
        </span>
      </div>
      <Show when={asking()}>
        <QiAsk
          id={props.e.id}
          value={props.ask?.value ?? ''}
          opBusy={opBusy()}
          onInput={props.onAskInput}
          onConfirm={props.onAskConfirm}
          onClose={props.onAskClose}
        />
      </Show>
      <Show when={result()}>
        {(r) => (
          <RowResult
            res={r()}
            onToggle={() => (resultIsQi() ? props.onToggleFull() : props.onBatchToggle(props.e.id))}
          />
        )}
      </Show>
    </div>
  );
}

function KindHome(props: {
  agg: Agg;
  entries: JsonEntry[];
  sel: number;
  kindHref: (kind: string) => string;
  allHref: string;
}) {
  const max = () => Math.max(1, ...props.agg.stats.map((s) => s.n));
  return (
    <>
      <div class="krows">
        <For each={props.agg.stats}>
          {(s, i) => (
            <Krow index={i()} sel={props.sel} href={props.kindHref(s.kind)} zero={!s.n}>
              <Sprite kind={s.kind} />
              <span class="nm">{pluralOf(s.kind)}</span>
              <Bar n={s.n} max={max()} />
              <span class="num">{s.n}</span>
            </Krow>
          )}
        </For>
        <Krow index={props.agg.stats.length} sel={props.sel} href={props.allHref} zero={false}>
          <span class="sp">~</span>
          <span class="nm">all</span>
          <span class="bar" aria-hidden="true" />
          <span class="num">{props.agg.total}</span>
        </Krow>
      </div>
      <Legend entries={props.entries} />
    </>
  );
}

/**
 * The inline destination field for entries that must not import blindly.
 * Its own component so onMount (after insertion, unlike ref) can focus the
 * field and select the prefill.
 */
function QiAsk(props: {
  id: string;
  value: string;
  opBusy: boolean;
  onInput: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  let inputEl: HTMLInputElement | undefined;
  onMount(() => {
    inputEl?.focus();
    inputEl?.select();
  });
  return (
    <div class="qiask">
      <span class="dimtxt">to:</span>
      <input
        type="text"
        value={props.value}
        size={24}
        aria-label={`import destination for ${props.id}`}
        ref={inputEl}
        onInput={(ev) => props.onInput(ev.currentTarget.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            props.onConfirm();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            props.onClose();
          }
        }}
      />
      <button class="btn" disabled={!props.value.trim() || props.opBusy} onClick={() => props.onConfirm()}>
        import
      </button>
      <button class="linklike" title="close without importing" onClick={() => props.onClose()}>
        esc
      </button>
    </div>
  );
}

/** Dim key hint under every browse list (never in the entry detail). */
function ListHint() {
  return <p class="dimtxt listhint">↑↓ move · shift extend · i import · space select · a all</p>;
}

/** Flat entry list: the kind view, the `all` list and search results. */
function EntryList(
  props: {
    byId: boolean;
    entries: JsonEntry[];
    uncommitted: Set<string>;
    sel: number;
    entryHref: (id: string) => string;
    batchLabel: string;
  } & QiProps &
    BatchListProps,
) {
  const n = () => (props.onImportAll ? importAllCount(props.entries, props.importedIds) : 0);
  const opBusy = (): boolean => props.batchBusy || props.qi?.phase === 'working';
  return (
    <Show when={props.entries.length} fallback={<Empty>(._.) none</Empty>}>
      <Show when={n() > 0}>
        <div class="listhead">
          <span class="dimtxt">{`${props.entries.length} ${props.entries.length === 1 ? 'entry' : 'entries'}`}</span>
          <button
            class="btn"
            disabled={opBusy()}
            title={`import every not-imported entry below (${n()})`}
            onClick={() => props.onImportAll?.(props.batchLabel, props.entries)}
          >
            {`import all ${n()}`}
          </button>
        </div>
      </Show>
      <div class="rows">
        <For each={props.entries}>
          {(e, i) => (
            <EntryRow
              e={e}
              byId={props.byId}
              uncommitted={props.uncommitted}
              index={i()}
              sel={props.sel}
              entryHref={props.entryHref}
              qi={props.qi}
              ask={props.ask}
              importedIds={props.importedIds}
              onImport={props.onImport}
              onAskInput={props.onAskInput}
              onAskConfirm={props.onAskConfirm}
              onAskClose={props.onAskClose}
              onToggleFull={props.onToggleFull}
              checked={props.selected.has(e.id)}
              bres={props.batchRes.get(e.id) ?? null}
              landed={props.landed.has(e.id)}
              batchBusy={props.batchBusy}
              onRowClick={props.onRowClick}
              onGutterDown={props.onGutterDown}
              onGutterOver={props.onGutterOver}
              onBatchToggle={props.onBatchToggle}
            />
          )}
        </For>
      </div>
      <ListHint />
    </Show>
  );
}

/**
 * Components kind view, grouped by library: one header per library
 * (`components/<lib>`, member count, extends/default markers), member rows
 * beneath. Headers carry no data-row, so the keyboard cursor skips them;
 * member indices continue the rows() order across groups (then ungrouped rows).
 */
function ComponentKindView(
  props: {
    groups: LibraryGroup[];
    ungrouped: JsonEntry[];
    uncommitted: Set<string>;
    sel: number;
    entryHref: (id: string) => string;
  } & QiProps &
    BatchListProps,
) {
  type Block =
    | { kind: 'lib'; lib: LibraryGroup['lib']; members: JsonEntry[]; start: number }
    | { kind: 'plain'; members: JsonEntry[]; start: number };
  const blocks = createMemo((): Block[] => {
    const out: Block[] = [];
    let at = 0;
    for (const g of props.groups) {
      out.push({ kind: 'lib', lib: g.lib, members: g.members, start: at });
      at += g.members.length;
    }
    if (props.ungrouped.length) out.push({ kind: 'plain', members: props.ungrouped, start: at });
    return out;
  });
  const opBusy = (): boolean => props.batchBusy || props.qi?.phase === 'working';
  const rowProps = (e: JsonEntry) => ({
    checked: props.selected.has(e.id),
    bres: props.batchRes.get(e.id) ?? null,
    landed: props.landed.has(e.id),
  });
  return (
    <Show when={blocks().length} fallback={<Empty>(._.) none</Empty>}>
      <div>
        <For each={blocks()}>
          {(b) =>
            b.kind === 'lib' ? (
              <section class="libgroup">
                <div class="libhead">
                  <Sprite kind="library" />
                  <span class="nm">components/{b.lib.name}</span>
                  <span class="dimtxt">{libraryMeta(b.lib, b.members.length)}</span>
                  <Show when={props.onImportAll && importAllCount(b.members, props.importedIds) > 0}>
                    <button
                      class="btn libimport"
                      disabled={opBusy()}
                      title={`import every not-imported member below (${importAllCount(b.members, props.importedIds)})`}
                      onClick={() => props.onImportAll?.(`components/${b.lib.name}`, b.members)}
                    >
                      {`import all ${importAllCount(b.members, props.importedIds)}`}
                    </button>
                  </Show>
                </div>
                <div class="rows">
                  <For each={b.members}>
                    {(e, i) => (
                      <EntryRow
                        e={e}
                        byId={false}
                        uncommitted={props.uncommitted}
                        index={b.start + i()}
                        sel={props.sel}
                        entryHref={props.entryHref}
                        qi={props.qi}
                        ask={props.ask}
                        importedIds={props.importedIds}
                        onImport={props.onImport}
                        onAskInput={props.onAskInput}
                        onAskConfirm={props.onAskConfirm}
                        onAskClose={props.onAskClose}
                        onToggleFull={props.onToggleFull}
                        checked={rowProps(e).checked}
                        bres={rowProps(e).bres}
                        landed={rowProps(e).landed}
                        batchBusy={props.batchBusy}
                        onRowClick={props.onRowClick}
                        onGutterDown={props.onGutterDown}
                        onGutterOver={props.onGutterOver}
                        onBatchToggle={props.onBatchToggle}
                      />
                    )}
                  </For>
                </div>
              </section>
            ) : (
              <div>
                <Show when={props.onImportAll && importAllCount(b.members, props.importedIds) > 0}>
                  <div class="listhead">
                    <span class="dimtxt">{`${b.members.length} ${b.members.length === 1 ? 'entry' : 'entries'}`}</span>
                    <button
                      class="btn"
                      disabled={opBusy()}
                      title={`import every not-imported entry below (${importAllCount(b.members, props.importedIds)})`}
                      onClick={() => props.onImportAll?.('components', b.members)}
                    >
                      {`import all ${importAllCount(b.members, props.importedIds)}`}
                    </button>
                  </div>
                </Show>
                <div class="rows">
                  <For each={b.members}>
                    {(e, i) => (
                      <EntryRow
                        e={e}
                        byId={false}
                        uncommitted={props.uncommitted}
                        index={b.start + i()}
                        sel={props.sel}
                        entryHref={props.entryHref}
                        qi={props.qi}
                        ask={props.ask}
                        importedIds={props.importedIds}
                        onImport={props.onImport}
                        onAskInput={props.onAskInput}
                        onAskConfirm={props.onAskConfirm}
                        onAskClose={props.onAskClose}
                        onToggleFull={props.onToggleFull}
                        checked={rowProps(e).checked}
                        bres={rowProps(e).bres}
                        landed={rowProps(e).landed}
                        batchBusy={props.batchBusy}
                        onRowClick={props.onRowClick}
                        onGutterDown={props.onGutterDown}
                        onGutterOver={props.onGutterOver}
                        onBatchToggle={props.onBatchToggle}
                      />
                    )}
                  </For>
                </div>
              </div>
            )
          }
        </For>
      </div>
      <ListHint />
    </Show>
  );
}

/** Image bytes as a data URL for a row thumbnail or preview; undefined when the fetch failed. */
async function fetchImageUrl(c: AppConfig | null, id: string, file: string): Promise<string | null | undefined> {
  try {
    const out = await stackRun('show', showFileArgs(id, file), c?.project ?? '.', c?.stackPath);
    const b = toShowFile(fromStackOut<ShowFileJson>(out));
    return b.base64 ? `data:${mimeFor(file)};base64,${b.base64}` : null;
  } catch {
    return undefined;
  }
}

async function showFile(c: AppConfig | null, id: string, file: string): Promise<FileBody> {
  const out = await stackRun('show', showFileArgs(id, file), c?.project ?? '.', c?.stackPath);
  return toShowFile(fromStackOut<ShowFileJson>(out));
}

function EntryDetail(props: {
  scenario: string;
  id: string;
  file: string | null;
  /** project + stack checkout key: a change here refetches, anything else does not. */
  source: string;
  entries: JsonEntry[];
  index: CatalogIndex;
  sel: number;
  entryHref: (id: string) => string;
  fileHref: (id: string, file: string) => string;
  onFiles: (files: ShowFile[]) => void;
  onImported: () => void;
}) {
  const [doc, setDoc] = createSignal<Doc | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [to, setTo] = createSignal('');
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [fileBody, setFileBody] = createSignal<FileBody | null>(null);
  const [fileNote, setFileNote] = createSignal<string | null>(null);
  const [previews, setPreviews] = createSignal<{ path: string; url: string }[]>([]);
  let docGen = 0;
  let bodyGen = 0;

  const e = createMemo(() => props.index.byId.get(props.id) ?? null);
  // The open file, defaulting to the entry doc, under h2. Memoized so a list refresh does not refetch it.
  const bodyPath = createMemo(() => props.file ?? e()?.doc.slice(props.id.length + 1) ?? null);
  const locked = createMemo(() => lock().rows.find((r) => r.id === props.id) ?? null);
  const citedBy = (): string[] => props.index.citedBy.get(props.id) ?? [];
  const linked = (ids: string[] | undefined): string[] => (ids ?? []).filter((id) => props.index.byId.has(id));
  const upstream = createMemo(() => {
    const s = doc()?.manifest['source'];
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
  });
  const upstreamUrl = (): string | null => {
    const u = upstream()?.['url'];
    return typeof u === 'string' ? u : null;
  };

  // The destination belongs to the project it was typed for.
  createEffect(on(() => props.source, () => setTo(''), { defer: true }));

  // Doc and previews refetch for this id and source only, never for config edits.
  createEffect(
    on(
      [() => props.id, () => props.source],
      ([id, source]) => {
        const c = config();
        const gen = ++docGen;
        setDoc(null);
        setError(null);
        setSections(null);
        setFailed(null);
        setPreviews([]);
        props.onFiles([]);
        stackRun('show', [id, '--json'], c?.project ?? '.', c?.stackPath).then(
          (out) => {
            if (gen !== docGen) return;
            try {
              const d = toShowDoc(fromStackOut<ShowJson>(out));
              setDoc(d);
              props.onFiles(d.files);
              const imgs = d.files.filter((f) => IMG_RE.test(f.path)).slice(0, 4);
              void Promise.all(
                imgs.map((f) =>
                  previewCache
                    .load(previewKey(source, id, f.path), () => fetchImageUrl(c, id, f.path), () => gen === docGen)
                    .then((url) => (url ? { path: f.path, url } : null)),
                ),
              ).then((got) => {
                if (gen === docGen) setPreviews(got.filter((g): g is { path: string; url: string } => g !== null));
              });
            } catch (err) {
              setError(errText(err));
            }
          },
          (err) => {
            if (gen === docGen) setError(errText(err));
          },
        );
      },
    ),
  );

  createEffect(
    on(
      [bodyPath, () => props.id, () => props.source],
      ([p, id]) => {
        const gen = ++bodyGen;
        setFileBody(null);
        setFileNote(null);
        if (!p) return;
        showFile(config(), id, p).then(
          (b) => {
            if (gen === bodyGen) setFileBody(b);
          },
          (err) => {
            if (gen === bodyGen) setFileNote(errText(err));
          },
        );
      },
    ),
  );

  async function doImport() {
    const c = config();
    if (!c?.project) return;
    const dest = to().trim();
    setPending(true);
    setSections(null);
    setFailed(null);
    try {
      const out = await stackRun('import', importArgs(props.id, dest), c.project, c.stackPath);
      setSections(describeImport(fromStackOut(out)));
      await refreshLock();
      // Import creates stack.toml implicitly: the project page's set-up slot
      // must re-check on the next visit.
      await refreshReport();
      props.onImported();
    } catch (err) {
      setFailed(errText(err));
    } finally {
      setPending(false);
    }
  }

  const lookalikes = () => (failed() ? refusalFiles(failed() as string) : []);

  return (
    <div>
      <Show when={error()}>{(msg) => <CliErr text={msg()} />}</Show>
      <Show when={doc()}>
        {(d) => {
          const size = d().files.reduce((a, f) => a + f.size, 0);
          return (
            <div>
              <h1 class="title" id="stack-entry">
                <Sprite kind={e()?.kind ?? ''} origin={e()?.origin ?? ''} />
                <span>{e()?.name ?? props.id}</span>
                <Face status={e()?.status ?? ''} />
              </h1>
              <Show when={e()?.summary}>
                <p class="summary">{e()?.summary}</p>
              </Show>
              <Show when={!d().committed}>
                <p class="conflict" role="alert">
                  not committed in the stack: can't import
                </p>
              </Show>
              <Show when={locked()}>{(l) => <p>imported → {l().path}</p>}</Show>
              <dl>
                <Show when={d().usage}>
                  <dt>usage</dt>
                  <dd>{d().usage}</dd>
                </Show>
                <dt>size</dt>
                <dd>{`${d().files.length} files, ${fmtBytes(size)}`}</dd>
                <Show when={e()?.targets?.length}>
                  <dt>targets</dt>
                  <dd>{e()?.targets.join(' ')}</dd>
                </Show>
                <Show when={e()?.tags?.length}>
                  <dt>tags</dt>
                  <dd>
                    <div class="chips">
                      <For each={e()?.tags ?? []}>{(t) => <span>{t}</span>}</For>
                    </div>
                  </dd>
                </Show>
                <Show when={linked(e()?.requires).length}>
                  <dt>requires</dt>
                  <dd>
                    <div class="rlinks">
                      <For each={linked(e()?.requires)}>
                        {(r) => <a href={props.entryHref(r)}>{props.index.byId.get(r)?.name ?? r}</a>}
                      </For>
                    </div>
                  </dd>
                </Show>
                <Show when={linked(e()?.related).length}>
                  <dt>related</dt>
                  <dd>
                    <div class="rlinks">
                      <For each={linked(e()?.related)}>
                        {(r) => <a href={props.entryHref(r)}>{props.index.byId.get(r)?.name ?? r}</a>}
                      </For>
                    </div>
                  </dd>
                </Show>
                <Show when={citedBy().length}>
                  <dt>cited by</dt>
                  <dd>
                    <div class="rlinks">
                      <For each={citedBy()}>
                        {(r) => <a href={props.entryHref(r)}>{props.index.byId.get(r)?.name ?? r}</a>}
                      </For>
                    </div>
                  </dd>
                </Show>
                <Show when={upstream()}>
                  <dt>upstream</dt>
                  <dd>
                    <Show
                      when={upstreamUrl() && /^https?:/.test(upstreamUrl() as string)}
                      fallback={upstreamUrl() ?? ''}
                    >
                      <a href={upstreamUrl() as string} target="_blank" rel="noopener noreferrer">
                        {(upstreamUrl() as string).replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    </Show>
                    <Show when={typeof upstream()?.['ref'] === 'string'}>
                      <span class="dim">{` @ ${String(upstream()?.['ref']).slice(0, 7)}`}</span>
                    </Show>
                    <Show when={typeof upstream()?.['license'] === 'string'}>
                      <span class="dim">{` ${upstream()?.['license']}`}</span>
                    </Show>
                    <Show when={upstream()?.['modified']}>
                      <span class="dim"> modified</span>
                    </Show>
                  </dd>
                </Show>
              </dl>

              <Show when={!locked() && d().committed}>
                <h2>import</h2>
                <p>
                  <input
                    type="text"
                    value={to()}
                    onInput={(ev) => setTo(ev.currentTarget.value)}
                    placeholder="--to"
                    aria-label="import destination inside the project"
                    size={24}
                  />{' '}
                  <button class="btn" disabled={pending()} onClick={() => void doImport()}>
                    {pending() ? 'importing' : 'import'}
                  </button>
                </p>
              </Show>

              <Show when={lookalikes().length > 0}>
                <p class="conflict" role="alert">
                  untracked look-alikes, nothing written:
                </p>
                <pre class="raw">{lookalikes().join('\n')}</pre>
              </Show>
              <Show when={failed() && !lookalikes().length}>
                <CliErr text={failed() as string} />
              </Show>
              <Show when={sections()}>
                {(s) => (
                  <>
                    <OpResult sections={s()} />
                    <p class="dimtxt">
                      <a href={href(props.scenario, 'project')}>→ project</a>
                    </p>
                  </>
                )}
              </Show>

              <Show when={previews().length}>
                <div>
                  <h2>preview</h2>
                  <div class="previews">
                    <For each={previews()}>
                      {(p) => (
                        <a href={props.fileHref(props.id, p.path)}>
                          <img src={p.url} alt={p.path} />
                        </a>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <h2>files</h2>
              <Show when={d().files.length} fallback={<Empty>(._.) none</Empty>}>
                <FileTree
                  files={d().files}
                  name={e()?.name ?? props.id}
                  cur={bodyPath()}
                  sel={props.sel}
                  selBase={0}
                  fileHref={(p) => props.fileHref(props.id, p)}
                  fmtSize={fmtBytes}
                />
              </Show>
              <Show when={bodyPath()}>
                {(p) => (
                  <>
                    <h2>{p()}</h2>
                    <Show when={fileNote()}>{(msg) => <p class="note">{msg()}</p>}</Show>
                    <Show when={fileBody()}>
                      {(b) => (
                        <FileView
                          body={b()}
                          entries={props.entries}
                          entryId={props.id}
                          entryHref={props.entryHref}
                          fileHref={props.fileHref}
                        />
                      )}
                    </Show>
                  </>
                )}
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
}

function FileView(props: {
  body: FileBody;
  entries: JsonEntry[];
  entryId: string;
  entryHref: (id: string) => string;
  fileHref: (id: string, file: string) => string;
}) {
  const b = () => props.body;
  return (
    <Show
      when={!b().base64}
      fallback={
        <div class="preview">
          <img src={`data:${mimeFor(b().file)};base64,${b().base64}`} alt={b().file} />
        </div>
      }
    >
      <Show when={!b().binary} fallback={<Empty>binary {fmtBytes(b().size)} — open it from the checkout.</Empty>}>
        <Show when={b().markdown} fallback={<pre class="raw">{b().text}</pre>}>
          <Markdown
            text={b().text}
            entryId={props.entryId}
            file={b().file}
            entries={props.entries}
            entryHref={props.entryHref}
            fileHref={props.fileHref}
          />
        </Show>
      </Show>
    </Show>
  );
}
