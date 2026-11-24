// The titlebar's two slots. Center: the Project | Browse switcher
// (a link per view; the hash router stays the source of truth). Right: busy
// text, the command-palette button (Cmd/Ctrl+K; `/` stays the catalog
// search), the project | user split pill (each half opens a small menu to
// switch: recents or workers, plus the full onboarding step), the node face
// only when node is broken, and the theme button.
import { placeFixed } from '../menuPlace';
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { attentionCount, busy, chooseProject, chooseWorker, config, node, project, switchProject, switchWorker, workerName, workers } from '../store';
import { href, resolveView } from '../router';
import { Icon } from '../icons';
import { mac } from '../commands';
import { openPalette } from '../overlays';
import { theme, toggleTheme } from '../theme';
import { Badge, IconButton, Kbd, SegmentedNav } from '../ui';
import { Keys } from './Palette';

const leaf = (p: string): string => p.split(/[\\/]+/).filter(Boolean).pop() ?? p;

const VIEWS = [
  { key: 'project', label: 'Project' },
  { key: 'browse', label: 'Browse' },
] as const;

export function ViewSwitch(props: { scenario: string; segs: string[] }) {
  const view = () => resolveView(props.segs);
  return (
    <SegmentedNav
      label="views"
      current={view()}
      items={VIEWS.map((v) => ({
        key: v.key,
        label: v.label,
        href: href(props.scenario, v.key),
        ...(v.key === 'project' && attentionCount() > 0
          ? { badge: attentionCount(), badgeLabel: `Project, ${attentionCount()} ${attentionCount() === 1 ? 'needs' : 'need'} attention` }
          : {}),
      }))}
    />
  );
}

type MenuKind = 'project' | 'worker';

export function TitleTools(_props: { scenario: string; segs: string[] }) {
  const [open, setOpen] = createSignal<MenuKind | null>(null);
  const [pos, setPos] = createSignal({ top: 0, right: 0 });
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const onDoc = (ev: PointerEvent) => {
    const t = ev.target as Node;
    if (!menu?.contains(t) && !trigger?.contains(t)) close(false);
  };
  function show(kind: MenuKind, btn: HTMLButtonElement) {
    if (open() === kind) return close(true);
    trigger = btn;
    const r = btn.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(kind);
    document.addEventListener('pointerdown', onDoc, true);
    queueMicrotask(() => {
      if (menu) placeFixed(menu, r);
      items()[0]?.focus();
    });
  }
  function close(refocus: boolean) {
    setOpen(null);
    document.removeEventListener('pointerdown', onDoc, true);
    if (refocus) trigger?.focus();
  }
  onCleanup(() => document.removeEventListener('pointerdown', onDoc, true));

  const items = (): HTMLButtonElement[] => [...(menu?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
  const onMenuKey = (ev: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const k = ev.key;
    if (k === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (k === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (k === 'Home') list[0]?.focus();
    else if (k === 'End') list[list.length - 1]?.focus();
    else if (k === 'Escape') close(true);
    else if (k === 'Tab') {
      close(true);
      return;
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  const recents = () => (config()?.recentProjects ?? []).filter((p) => p !== project()).slice(0, 5);

  const pick = (fn: () => void) => () => {
    close(false);
    fn();
  };

  return (
    <>
      <Show when={busy()}>
        <span class="busytxt" role="status">
          {busy()}…
        </span>
      </Show>
      <Show when={node()?.ok === false}>
        <Badge tone="error" title={node()?.error ?? 'node missing'}>
          node missing
        </Badge>
      </Show>
      <button
        type="button"
        class="searchwell"
        onClick={openPalette}
        aria-label="open the command palette"
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
        title={`commands and search (${mac ? '⌘K' : 'Ctrl+K'})`}
      >
        <span class="searchwell__l">
          <Icon name="command" size={13} />
          <span>Commands</span>
        </span>
        <Kbd>{mac ? '⌘K' : 'Ctrl K'}</Kbd>
      </button>
      <Show when={config()}>
        <div class="sa-split-pill" role="group" aria-label="project and user">
          <button
            type="button"
            class="sa-split-pill__segment sa-split-pill__segment--left"
            title={project() ?? 'choose a project'}
            aria-haspopup="menu"
            aria-expanded={open() === 'project'}
            onClick={(e) => show('project', e.currentTarget)}
          >
            <span class="sa-split-pill__icon" aria-hidden="true">
              <Icon name="folder" size={13} />
            </span>
            <span class="sa-split-pill__label">{project() ? leaf(project() as string) : 'project'}</span>
          </button>
          <span class="sa-split-pill__divider" aria-hidden="true" />
          <button
            type="button"
            class="sa-split-pill__segment sa-split-pill__segment--right"
            title="switch worker"
            aria-haspopup="menu"
            aria-expanded={open() === 'worker'}
            onClick={(e) => show('worker', e.currentTarget)}
          >
            <span class="sa-split-pill__icon" aria-hidden="true">
              <Icon name="user" size={12} />
            </span>
            <span class="sa-split-pill__label">{workerName() ?? 'who'}</span>
          </button>
        </div>
      </Show>
      <IconButton label="Toggle theme" onClick={toggleTheme}>
        <Icon name={theme() === 'dark' ? 'moon' : 'sun'} size={15} />
      </IconButton>
      <Show when={open()}>
        <div
          ref={menu}
          class="pillmenu"
          role="menu"
          aria-label={open() === 'project' ? 'project' : 'worker'}
          style={{ top: `${pos().top}px`, right: `${pos().right}px` }}
          onKeyDown={onMenuKey}
        >
          <Show when={open() === 'project'}>
            <p class="pillmenu__cur" title={project() ?? ''}>{project() ?? 'No project open'}</p>
            <For each={recents()}>
              {(p) => (
                <button type="button" role="menuitem" class="pillmenu__item" title={p} onClick={pick(() => void chooseProject(p))}>
                  <Icon name="folder" size={14} />
                  <span class="pillmenu__label">{leaf(p)}</span>
                  <span class="pillmenu__meta">{p.split(/[\\/]+/).filter(Boolean).slice(-3, -1).join('/')}</span>
                </button>
              )}
            </For>
            <div class="pillmenu__sep" role="separator" />
            <button type="button" role="menuitem" class="pillmenu__item" onClick={pick(switchProject)}>
              <Icon name="search" size={14} />
              <span class="pillmenu__label">Switch project…</span>
              <Keys combo={{ mod: true, key: 'o' }} />
            </button>
          </Show>
          <Show when={open() === 'worker'}>
            <p class="pillmenu__cur">Working as <strong>{workerName() ?? 'nobody'}</strong></p>
            <For each={workers()}>
              {(w) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={w.name === workerName()}
                  class="pillmenu__item"
                  onClick={pick(() => w.name !== workerName() && void chooseWorker(w.name))}
                >
                  <Icon name={w.name === workerName() ? 'check' : 'user'} size={14} />
                  <span class="pillmenu__label">{w.name}</span>
                </button>
              )}
            </For>
            <div class="pillmenu__sep" role="separator" />
            <button type="button" role="menuitem" class="pillmenu__item" onClick={pick(switchWorker)}>
              <Icon name="search" size={14} />
              <span class="pillmenu__label">Switch worker…</span>
              <Keys combo={{ mod: true, shift: true, key: 'o' }} />
            </button>
          </Show>
        </div>
      </Show>
    </>
  );
}
