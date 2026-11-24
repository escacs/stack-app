// The 288px source list: catalog kinds (with counts once Browse has loaded
// the catalog) and the project's git worktrees (the active target is marked;
// click another to retarget the app; T3 threads live on the project summary),
// and the footer well with the app version and the updater. Shown on every
// view once onboarding is done. Tracked imports show next to the project
// routes only. Presets show as a catalog kind next to the entry kinds.
import { placeFixed } from '../menuPlace';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { WorktreeInfo } from '../bridge';
import { KINDS, pluralOf } from '../parse';
import { href } from '../router';
import { appVersion, config, stack, switchTargetDir } from '../store';
import { catalogEntries, catalogQuery, catalogScope, ensureCatalog, kindCount } from '../catalog';
import { countByKind } from '../browseList';
import { ensurePresets, presetCount, presetsState } from '../presets';
import { scoreEntries } from '../site';
import { t3Info, worktreeLabel } from '../t3';
import { Icon, type IconName } from '../icons';
import { roving } from '../roving';
import { NavItem, Well } from '../ui';
import { LABEL, TARGET_LABEL, navTone, wordFor } from '../vocab';
import { Updates } from './Updates';
import { kindOf, rowState } from '../parse';
import { lock } from '../store';
import { lockedWorktrees, runSyncAllWorktrees, syncing } from '../worktreeSync';
import { countUpdates, hasMissing, rowTone, rowWord } from '../parse';
import { actionFor, isRunning } from '../actions';

// The live handler for one of the project page's registered actions (see
// actions.ts): calling its `run` goes through the same guarded path the
// page's own buttons use.
const runAction = (id: string): void => {
  actionFor(id)?.run();
};

export type OverflowItem = {
  key: string;
  label: string;
  title?: string;
  danger?: boolean;
  onPick: () => void;
};

/**
 * The "⋯" overflow in a section heading (the project-level actions next to
 * "Tracked imports"): the shared pill-menu surface (.pillmenu in app.css).
 * Escape and an outside click close it, focus returns to the trigger.action
 * (the trigger keeps running whatever ops the project page registered). Only
 * items that can run right now are offered.
 */
export function OverflowMenu(props: { disabled?: boolean; items: () => OverflowItem[]; label?: string }) {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ top: 0, right: 0 });
  let btn: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  const label = () => props.label ?? 'More actions';
  const onDoc = (ev: PointerEvent) => {
    const t = ev.target as Node;
    if (!menu?.contains(t) && !btn?.contains(t)) close();
  };
  const onKey = (ev: KeyboardEvent) => {
    // While open, Escape closes wherever focus is (menu, trigger, page).
    if (open() && ev.key === 'Escape') {
      ev.stopPropagation();
      close();
      btn?.focus();
    }
  };
  function close(): void {
    setOpen(false);
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus, true);
  }
  // Clicking or tabbing into page chrome outside the menu closes it.
  const onFocus = (ev: FocusEvent) => {
    const t = ev.target as Node;
    if (!menu?.contains(t) && !btn?.contains(t)) close();
  };
  function show(): void {
    if (props.disabled || !props.items().length) return;
    const r = btn?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    setOpen(true);
    queueMicrotask(() => menu && placeFixed(menu, r));
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
  }
  onCleanup(() => {
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus, true);
  });
  return (
    <>
      <button
        type="button"
        class="sa-button sa-button--ghost sa-button--md ovmenu__btn"
        title={label()}
        aria-label={label()}
        aria-haspopup="menu"
        aria-expanded={open()}
        disabled={props.disabled}
        ref={btn}
        onClick={() => (open() ? close() : show())}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <Show when={open()}>
        <div
          ref={menu}
          class="pillmenu"
          role="menu"
          aria-label={label()}
          style={{ top: `${pos().top}px`, right: `${pos().right}px` }}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') {
              close();
              btn?.focus();
            }
          }}
        >
          <For each={props.items()}>
            {(it) => (
              <button
                type="button"
                role="menuitem"
                class="pillmenu__item"
                data-danger={it.danger ? '' : undefined}
                title={it.title}
                onClick={() => {
                  close();
                  btn?.focus();
                  it.onPick();
                }}
              >
                <span class="pillmenu__label">{it.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

const KIND_ICON: Record<string, IconName> = {
  skill: 'terminal',
  style: 'palette',
  component: 'layers',
  system: 'server',
  library: 'folder',
  asset: 'image',
  template: 'file',
  worker: 'user',
};

// The three kinds the concept lists, then the rest in catalog order — only
// those that exist in the loaded catalog (all of them while it is loading).
const LEAD = ['skill', 'style', 'component'];

function stackTip(): string {
  const s = stack();
  if (!s?.path) return 'stack checkout not found';
  return `stack ${s.path} (${s.source})`;
}

export default function Sidebar(props: { scenario: string; segs: string[] }) {
  const kinds = () => {
    const have = new Set(catalogEntries().map((e) => e.kind));
    const rest = KINDS.filter((k) => !LEAD.includes(k) && have.has(k));
    return [...LEAD, ...rest];
  };
  const curKind = () => (props.segs[0] === 'browse' ? (catalogScope() ?? props.segs[1] ?? '') : '');
  const onBrowse = () => props.segs[0] === 'browse';
  // While a query is on, each kind shows how many of its entries match.
  const searching = () => onBrowse() && catalogQuery().trim().length > 0;
  const matchCounts = createMemo(() => (searching() ? countByKind(scoreEntries([...catalogEntries()], catalogQuery())) : new Map<string, number>()));
  const kindMeta = (k: string): string | undefined => (loaded() ? String(searching() ? matchCounts().get(k) ?? 0 : kindCount(k)) : undefined);
  const allMeta = (): string | undefined => (loaded() ? String(searching() ? [...matchCounts().values()].reduce((a, b) => a + b, 0) : catalogEntries().length) : undefined);
  // Tracked imports sit next to the project routes only.
  const onProject = () => ['project', 'installed', 'missing'].includes(props.segs[0] ?? '');
  const loaded = () => catalogEntries().length > 0;
  const worktrees = (): WorktreeInfo[] => t3Info()?.worktrees ?? [];
    const curImport = () => (props.segs[0] === 'project' || props.segs[0] === 'installed' ? props.segs.slice(1).join('/') : '');
  createEffect(() => {
    if (stack()?.valid) {
      void ensureCatalog(config());
      void ensurePresets(config());
    }
  });

  // The project-level actions that can run for the whole project right now
  // (the sidebar sits next to the project page, which owns the op runners
  // through the shared action registry). Items that cannot run are hidden.
  const projectOverflow = (): OverflowItem[] => {
    const items: OverflowItem[] = [];
    if (countUpdates(lock().rows) > 0)
      items.push({
        key: 'update all',
        label: 'Update all',
        title: 'Brings the stack\u2019s changes into every import that has an update waiting',
        onPick: () => runAction('update-all'),
      });
    if (hasMissing(lock().rows))
      items.push({
        key: 'sync',
        label: LABEL.restoreFiles,
        title: 'Restores imported files that are missing, from stack.toml; edits are never touched',
        onPick: () => runAction('sync-missing'),
      });
    if (lockedWorktrees() > 0 && worktrees().length > 1)
      items.push({
        key: 'update worktrees',
        label: 'Update all worktrees',
        title: 'Run the same update in every worktree that holds a lock entry',
        onPick: () => void runSyncAllWorktrees(),
      });
    items.push({
      key: 'adopt',
      label: 'Adopt a folder…',
      title: 'Pick a folder in this project to adopt: the entry is inferred from the folder name',
      onPick: () => runAction('adopt-folder'),
    });
    return items;
  };

  return (
    <aside class="sa-shell__sidebar" aria-label={onBrowse() ? 'Catalog kinds' : onProject() ? 'Tracked imports and worktrees' : 'Worktrees'}>
      <div class="sa-shell__sidebar-body">
        <Show when={onBrowse()} fallback={
        <Show when={onProject()}>
        <section class="navgroup" aria-labelledby="ng-imp" ref={roving}>
          <h2 class="navgroup__head" id="ng-imp">
            <span>Tracked imports</span>
            <span class="num">{lock().rows.length}</span>
            {/* The project-level "⋯": the whole-project ops live here, next
                to the list they act on, so they stay reachable from every
                project route (detail pages included). */}
            <OverflowMenu
              disabled={syncing() || isRunning('update-all') || isRunning('sync-missing')}
              label="Project actions"
              items={projectOverflow}
            />
          </h2>
          <div class="navgroup__list">
            <NavItem
              label="Summary"
              icon={<Icon name="compass" size={15} />}
              state={curImport() === '' && props.segs[0] === 'project' ? 'selected' : 'default'}
              href={href(props.scenario, 'project')}
              title="Project summary: what needs attention and the project-level actions"
            />
            <For each={lock().rows}>
              {(r) => {
                const st = () => rowState(r);
                return (
                  <NavItem
                    label={r.id}
                    icon={<Icon name={KIND_ICON[kindOf(r.id)] ?? 'list'} size={15} />}
                    tone={rowTone(st())}
                    meta={rowWord(st())}
                    state={curImport() === r.id ? 'selected' : 'default'}
                    href={href(props.scenario, 'project', ...r.id.split('/'))}
                    title={r.path}
                  />
                );
              }}
            </For>
          </div>
        </section>
        </Show>
        }>
        <section class="navgroup" aria-labelledby="ng-kinds" ref={roving}>
          <h2 class="navgroup__head" id="ng-kinds">
            <span>Catalog kinds</span>
          </h2>
          <div class="navgroup__list">
            <NavItem
              label="All entries"
              icon={<Icon name="list" size={15} />}
              meta={allMeta()}
              state={curKind() === '' || curKind() === 'all' ? 'selected' : 'default'}
              href={href(props.scenario, 'browse')}
            />
            <For each={kinds()}>
              {(k) => (
                <div class="navgroup__kind" data-empty={searching() && !(matchCounts().get(k) ?? 0) ? '' : undefined}>
                <NavItem
                  label={pluralOf(k).replace(/^./, (c) => c.toUpperCase())}
                  icon={<Icon name={KIND_ICON[k] ?? 'list'} size={15} />}
                  meta={kindMeta(k)}
                  state={curKind() === pluralOf(k) ? 'selected' : 'default'}
                  href={href(props.scenario, 'browse', pluralOf(k))}
                />
                </div>
              )}
            </For>
            {/* Presets are bundles of entries, not a kind of entry: a quiet sub-label sets them apart. */}
            <Show when={presetsState().loaded && presetCount() > 0}>
              <div class="navgroup__sub" role="presentation">Bundles</div>
              <NavItem
                label="Presets"
                icon={<Icon name="box" size={15} />}
                meta={String(presetCount())}
                state={curKind() === 'presets' ? 'selected' : 'default'}
                href={href(props.scenario, 'browse', 'presets')}
                title="Named bundles of entries: Open shows what a preset bundles, Import brings them all in"
              />
            </Show>
          </div>
        </section>

        </Show>

        <Show when={!onBrowse() && config()?.project}>
          <section class="navgroup" aria-labelledby="ng-wt" ref={roving}>
            <h2 class="navgroup__head" id="ng-wt">
              <span>Worktrees</span>
              <Show when={worktrees().length}>
                <span class="num">{worktrees().length}</span>
              </Show>
            </h2>
            <div class="navgroup__list">
              <For each={worktrees()}>
                {(w) => (
                  <NavItem
                    label={w.branch ?? (w.detached ? 'detached' : worktreeLabel(w))}
                    icon={<Icon name="branch" size={15} />}
                    state={w.isCurrent ? 'target' : 'default'}
                    targetLabel={TARGET_LABEL}
                    tone={navTone(w.hasLock ? wordFor('Tracked') : wordFor('No lock'))}
                    meta={w.isCurrent ? undefined : w.hasLock ? wordFor('Tracked') : wordFor('No lock')}
                    title={w.path}
                    onClick={() => {
                      if (!w.isCurrent) void switchTargetDir(w.path);
                    }}
                  />
                )}
              </For>
              <Show when={!worktrees().length}>
                <p class="navgroup__none">No git worktrees found.</p>
              </Show>
            </div>
            {/* Updating every worktree lives on the project summary (and the project menu above). */}
          </section>
        </Show>
      </div>

      <div class="sa-shell__sidebar-footer">
        <Well variant="footer" class="footcard">
          <Updates version={appVersion()} tip={stackTip()} />
        </Well>
      </div>
    </aside>
  );
}
