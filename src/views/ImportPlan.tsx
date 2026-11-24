// The import plan, shown before anything is written: which files land where,
// as a compact folder tree with `+` new / `~` overwrite / `!` collision marks
// (a glyph and a spoken label, never colour alone), sizes, and the
// destination in plain words. One component serves a single entry, a batch
// and a preset; the caller owns Confirm (it runs the real import) and clears
// the plan afterwards. Logic lives in ../plan (tested).
import { For, Show, createEffect, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import { fmtBytes } from '../parse';
import { destLabel } from '../json';
import {
  buildTree,
  collidingTargets,
  fileCountLabel,
  importCounts,
  intoWords,
  markGlyph,
  markLabel,
  type Plan,
  type PlanMark,
  type PlanTarget,
  type TreeNode,
} from '../plan';
import { Alert, Button, CliErr } from '../ui';
import { Icon } from '../icons';

/** `idle`: nothing to check yet (a destination is still to be chosen). */
export type PlanView = { phase: 'idle'; text: string } | { phase: 'loading' } | { phase: 'error'; text: string } | { phase: 'ready'; plan: Plan };

type Row = { depth: number; node: TreeNode };

/** Tree flattened to rows with depth, so a long plan can be cut at a row count. */
function flatten(nodes: readonly TreeNode[], depth = 0): Row[] {
  const out: Row[] = [];
  for (const n of nodes) {
    out.push({ depth, node: n });
    if (n.kind === 'dir') out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

/** Rows a target shows before `Show all N files`. */
export const PLAN_ROWS = 14;

/** Batch: how a colliding entry is resolved, inline, next to its own alert. */
export type PlanResolve = {
  /** Folder typed for an entry (absent: the default). */
  dests: ReadonlyMap<string, string>;
  skipped: ReadonlySet<string>;
  /** Entries the controls apply to (the requested ones, not their dependencies). */
  editable: (id: string) => boolean;
  onDest: (id: string, value: string) => void;
  onSkip: (id: string, skip: boolean) => void;
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const clashCount = (t: PlanTarget): number => t.files.filter((f) => f.mark === 'collision').length;

function TargetBlock(props: { t: PlanTarget; skipColliding: boolean; off?: boolean; resolve?: PlanResolve }) {
  const [all, setAll] = createSignal(false);
  const rows = createMemo(() => flatten(buildTree(props.t.files)));
  const shown = () => (all() ? rows() : rows().slice(0, PLAN_ROWS));
  const clash = () => clashCount(props.t);
  const controls = () => !!props.resolve && props.resolve.editable(props.t.id) && (clash() > 0 || props.resolve.dests.has(props.t.id) || props.resolve.skipped.has(props.t.id));
  const skipped = () => !!props.resolve?.skipped.has(props.t.id);
  const left = () => props.skipColliding && clash() > 0;
  /** A colliding entry is skipped until another folder frees it, so its box is checked and locked. */
  const locked = () => left();
  const at = () => {
    const d = props.t.dest.replace(/\\/g, '/');
    return d && d !== '.' ? ` at ${d}` : ' in the project root';
  };
  const bytes = () => props.t.files.reduce((n, f) => n + f.size, 0);
  return (
    <section class="plan__target" data-off={props.off ? '' : undefined} aria-label={`${props.t.id} ${intoWords(props.t.dest)}`}>
      <h3 class="plan__target-head">
        <span class="plan__id" title={props.t.id}>{props.t.id}</span>
        <Show when={props.t.dependency}>
          <span class="plan__req" title={`Required by ${props.t.requiredBy ?? 'another selected entry'}; it follows the selection`}>required</span>
        </Show>
        <span class="plan__into" title={intoWords(props.t.dest)}>{intoWords(props.t.dest)}</span>
        <Show when={props.t.files.length}>
          <span class="plan__count">{fileCountLabel(props.t.files.length)} · {fmtBytes(bytes())}</span>
        </Show>
      </h3>
      <Show when={props.t.requiredBy}>
        {(by) => <p class="plan__dep">Needed by {by()}</p>}
      </Show>
      <Show when={clash()}>
        {(n) => (
          <Alert tone="warning" role="alert" class="plan__clash">
            {plural(n(), 'file')} already {n() === 1 ? 'exists' : 'exist'}{at()}
            {controls() ? (locked() || skipped() ? '. This entry is skipped; pick another folder to import it.' : '. Pick another folder or skip this entry.') : left() ? '. This entry is skipped.' : ''}
          </Alert>
        )}
      </Show>
      <Show when={controls()}>
        <div class="plan__resolve">
          <label class="plan__resolve-dest">
            <span class="plan__dest-label">Folder for {props.t.id}</span>
            <input
              type="text"
              value={props.resolve?.dests.get(props.t.id) ?? ''}
              placeholder={destLabel(props.t.dest)}
              spellcheck={false}
              autocomplete="off"
              aria-label={`Destination folder for ${props.t.id}`}
              onInput={(e) => props.resolve?.onDest(props.t.id, e.currentTarget.value)}
            />
          </label>
          <label class="plan__resolve-skip">
            <input
              type="checkbox"
              checked={skipped() || locked()}
              disabled={locked()}
              aria-label={`Skip ${props.t.id}`}
              onChange={(e) => props.resolve?.onSkip(props.t.id, e.currentTarget.checked)}
            />
            <span>Skip</span>
          </label>
        </div>
      </Show>
      <Show when={!props.off && !skipped()}>
      <Show when={rows().length} fallback={<p class="plan__none">The file list is not available; the import still writes into this folder.</p>}>
        <ul class="plan__tree" role="list">
          <For each={shown()}>
            {(r) => (
              <Show
                when={r.node.kind === 'file' ? (r.node as Extract<TreeNode, { kind: 'file' }>) : null}
                fallback={
                  <li class="plan__dir" style={{ '--d': String(r.depth) }}>
                    <Icon name="folder" size={13} />
                    <span class="plan__name">{(r.node as Extract<TreeNode, { kind: 'dir' }>).name}/</span>
                    <span class="plan__meta">
                      {(r.node as Extract<TreeNode, { kind: 'dir' }>).files} {(r.node as Extract<TreeNode, { kind: 'dir' }>).files === 1 ? 'file' : 'files'}
                    </span>
                  </li>
                }
              >
                {(f) => (
                  <li class="plan__file" data-mark={f().mark} style={{ '--d': String(r.depth) }}>
                    <span class="plan__mark" role="img" aria-label={markLabel(f().mark)}>{markGlyph(f().mark)}</span>
                    <span class="plan__name" title={f().path}>{f().name}</span>
                    <span class="plan__meta">{f().size ? fmtBytes(f().size) : ''}</span>
                  </li>
                )}
              </Show>
            )}
          </For>
        </ul>
        <Show when={rows().length > PLAN_ROWS}>
          <button type="button" class="plan__more" aria-expanded={all()} onClick={() => setAll(!all())}>
            {all() ? 'Show fewer' : `Show all ${props.t.files.length} files`}
          </button>
        </Show>
      </Show>
      </Show>
    </section>
  );
}

/** Legend for the marks that appear in this plan, spoken the same way as the rows. */
function Legend(props: { marks: PlanMark[] }) {
  return (
    <p class="plan__legend">
      <For each={props.marks}>
        {(m) => (
          <span data-mark={m}>
            <span class="plan__mark" aria-hidden="true">{markGlyph(m)}</span> {m === 'new' ? 'new' : m === 'overwrite' ? 'overwrite' : 'collision'}
          </span>
        )}
      </For>
    </p>
  );
}

export function ImportPlan(props: {
  title: string;
  /** What is being imported: an entry id, `3 selected`, a preset name. */
  subject: string;
  view: PlanView;
  /** Destination field for a single entry. */
  dest?: { value: string; placeholder: string; required?: boolean; onInput: (v: string) => void };
  confirmLabel: string;
  /** Append the count of entries that will be written: `Import 2`. */
  counted?: boolean;
  /** Already-imported ids the caller filtered out before the plan was made. */
  already?: readonly string[];
  /** The real import is running. */
  busy: boolean;
  /** Why Confirm cannot be pressed beyond the plan itself (an empty destination). */
  blocked?: string | null;
  /** Batch: entries with collisions are left out instead of blocking the rest. */
  skipColliding?: boolean;
  /** Batch: inline folder + Skip controls for colliding entries. */
  resolve?: PlanResolve;
  /** An import that failed after Confirm; shown above the footer. */
  failure?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children?: JSX.Element;
}) {
  let root: HTMLElement | undefined;
  let confirmBtn: HTMLButtonElement | undefined;
  const ready = () => (props.view.phase === 'ready' ? props.view.plan : null);
  const clashing = createMemo(() => (ready() ? collidingTargets(ready() as Plan) : []));
  const marks = createMemo<PlanMark[]>(() => {
    const p = ready();
    if (!p) return [];
    const have = new Set(p.targets.flatMap((t) => t.files.map((f) => f.mark)));
    return (['new', 'overwrite', 'collision'] as PlanMark[]).filter((m) => have.has(m));
  });
  /** One rule for header, button and list: what is written, what is left out. */
  const counts = createMemo(() => (ready() ? importCounts(ready() as Plan, { skipColliding: props.skipColliding, skipped: props.resolve?.skipped, alreadyExtra: props.already }) : null));
  const kept = () => counts()?.kept ?? [];
  const writable = () => kept().length;
  const headSum = (): string => {
    const c = counts();
    return c ? `${plural(c.entries, 'entry', 'entries')} · ${plural(c.files, 'file')}` : '';
  };
  const confirmText = (): string => (props.busy ? 'Importing…' : props.counted && counts() ? `Import ${writable()}` : props.confirmLabel);
  const reason = (): string | null => {
    if (props.view.phase === 'idle') return props.view.text;
    if (props.view.phase === 'loading') return 'Checking what would be written…';
    if (props.view.phase === 'error') return null;
    if (props.blocked) return props.blocked;
    if (!props.skipColliding && clashing().length) return 'Choose another folder or keep the files that are already there.';
    if (!writable()) return 'Nothing here can be imported.';
    return null;
  };
  const canConfirm = () => props.view.phase === 'ready' && !props.busy && !reason();

  onMount(() => root?.focus({ preventScroll: true }));
  // Once the plan is ready and still untouched, Enter on the dialog region confirms nothing,
  // but Tab reaches Confirm first: move focus there unless the user is typing a destination.
  createEffect(() => {
    if (props.view.phase !== 'ready' || !canConfirm() || !confirmBtn) return;
    if (document.activeElement === root) confirmBtn.focus({ preventScroll: true });
  });

  return (
    <section
      ref={root}
      class="plan"
      tabindex="-1"
      aria-label={`${props.title}: ${props.subject}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onCancel();
        }
      }}
    >
      <header class="plan__head">
        <div class="plan__headtext">
          <h2 class="plan__title">
            {props.title}
            <Show when={ready()}>
              <span class="plan__titlesum"> · {headSum()}</span>
            </Show>
          </h2>
          <p class="plan__subject">{props.subject}</p>
          <Show when={counts()?.skippedTotal}>
            {(n) => <p class="plan__skipsum">{n()} skipped</p>}
          </Show>
        </div>
      </header>

      <Show when={props.dest}>
        {(d) => (
          <label class="plan__dest">
            <span class="plan__dest-label">
              Destination folder{d().required ? '' : ' (optional)'}
            </span>
            <input
              type="text"
              value={d().value}
              placeholder={destLabel(d().placeholder)}
              spellcheck={false}
              autocomplete="off"
              aria-label="Destination folder inside the project"
              onInput={(e) => d().onInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canConfirm()) props.onConfirm();
                }
              }}
            />
            <Show when={!d().required && d().placeholder}>
              <span class="plan__dest-hint">Leave empty to use {destLabel(d().placeholder)}, or type another folder inside the project.</span>
            </Show>
          </label>
        )}
      </Show>

      <Show when={props.view.phase === 'idle'}>
        <p class="plan__loading">{(props.view as { text: string }).text}</p>
      </Show>
      <Show when={props.view.phase === 'loading'}>
        <p class="plan__loading" role="status">Checking what would be written…</p>
      </Show>
      <Show when={props.view.phase === 'error' ? (props.view as { text: string }).text : null}>
        {(text) => (
          <CliErr text={text()} />
        )}
      </Show>

      <Show when={ready()}>
        {(plan) => (
          <>
            <Show when={marks().length}>
              <Legend marks={marks()} />
            </Show>
            <div class="plan__targets">
              <For each={kept()}>
                {(t) => <TargetBlock t={t} skipColliding={!!props.skipColliding} resolve={props.resolve} />}
              </For>
              <Show when={counts()?.skippedTotal}>
                <h3 class="plan__skiphead">Skipped ({counts()?.skippedTotal})</h3>
                <For each={counts()?.skipped ?? []}>
                  {(s) => <TargetBlock t={s.target} off skipColliding={!!props.skipColliding} resolve={props.resolve} />}
                </For>
                <For each={counts()?.already ?? []}>
                  {(id) => <p class="plan__already"><span class="plan__id">{id}</span> <span class="plan__meta">already imported</span></p>}
                </For>
              </Show>
              <Show when={!plan().targets.length && !counts()?.already.length}>
                <p class="plan__none">Nothing new to import{plan().already.length ? ' — everything here is already imported.' : '.'}</p>
              </Show>
            </div>
            <Show when={plan().gitignore}>
              <Alert tone="info" class="plan__note">The managed block in .gitignore will be updated.</Alert>
            </Show>
          </>
        )}
      </Show>

      {props.children}
      <Show when={props.failure}>
        {(f) => (
          <CliErr text={f()} />
        )}
      </Show>

      <div class="plan__foot">
        <Show when={reason()}>
          {(r) => <p class="plan__reason">{r()}</p>}
        </Show>
        <span class="plan__actions">
          <Button onClick={() => props.onCancel()}>{props.busy ? 'Close' : 'Cancel'}</Button>
          <Button ref={confirmBtn} variant="obsidian" disabled={!canConfirm()} loading={props.busy} onClick={() => props.onConfirm()}>
            {confirmText()}
          </Button>
        </span>
      </div>
    </section>
  );
}
