// First-run onboarding: who, then which project. Rendered by App instead of
// the views until both are set. One question per screen, highlighted rows,
// arrows/j/k + enter + 1-9. The remembered worker and project are preselected
// when a screen is reopened to switch; Escape then cancels (keeps what was
// set). On a first run Escape on the project screen goes back to who.
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { errText, pickFolder, scanProjects, type ScanOut } from '../bridge';
import { moveSel } from '../onboard';
import { BrandMark, Icon } from '../icons';
import { Alert, Button, CliErr, HumanBody, Kbd } from '../ui';
import { humanizeCliError } from '../humanize';
import {
  cancelSwitchProject,
  cancelSwitchWorker,
  chooseProject,
  chooseWorker,
  config,
  refreshWorkers,
  skipWorker,
  switchWorker,
  workerName,
  workers,
  workersError,
  workersLoaded,
} from '../store';

/** Focus once the element is attached (a ref runs before insertion). */
const focusSoon = (el: HTMLElement) => queueMicrotask(() => el.focus());

/** One first-run question on a centred sheet: brand mark, step, title, lead. */
function Shell(props: { step: 1 | 2; title: string; lead?: string; children: unknown }) {
  return (
    <div class="onboard">
      <div class="onboard__mark">
        <BrandMark />
      </div>
      <p class="onboard__step">Step {props.step} of 2</p>
      <h1 class="prompt">{props.title}</h1>
      <Show when={props.lead}>
        <p class="onboard__lead">{props.lead}</p>
      </Show>
      {props.children as never}
    </div>
  );
}

/**
 * Cursor list: arrows/j/k move, enter picks, 1-9 jump. Mounts only once it
 * has rows, so focusing on mount covers rows that load late. Keys act only
 * when the list itself is focused, never a button beside it.
 */
function PickList(props: {
  label: string;
  icon?: 'user' | 'folder';
  items: () => string[];
  pick: (i: number) => void;
  /** Row to start on (the remembered answer when switching). */
  initial?: () => number;
}) {
  const [sel, setSel] = createSignal(Math.max(0, props.initial?.() ?? 0));
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const len = props.items().length;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setSel(moveSel(sel(), 1, len));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setSel(moveSel(sel(), -1, len));
    } else if (e.key === 'Enter') {
      const i = sel() < 0 ? 0 : sel();
      if (i < len) {
        e.preventDefault();
        props.pick(i);
      }
    } else if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < len) props.pick(i);
    }
  };
  return (
    <div
      class="cursor-list"
      ref={focusSoon}
      tabIndex={0}
      role="listbox"
      aria-label={props.label}
      onKeyDown={onKey}
    >
      <For each={props.items()}>
        {(name, i) => (
          <div
            class={`prow${sel() === i() ? ' sel' : ''}`}
            role="option"
            aria-selected={sel() === i()}
            onClick={() => props.pick(i())}
            onMouseEnter={() => setSel(i())}
          >
            <span class="prow__icon" aria-hidden="true">
              <Icon name={props.icon ?? 'user'} size={15} />
            </span>
            <span class="nm">{name}</span>
            <Show when={i() < 9}>
              <Kbd>{String(i() + 1)}</Kbd>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

export function WhoScreen() {
  const names = createMemo(() => workers().map((w) => w.name));
  const pick = (i: number) => {
    const w = workers()[i];
    if (w) void chooseWorker(w.name);
  };
  // Escape cancels a switch (the current worker stays); nothing to cancel on a first run.
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && cancelSwitchWorker()) e.preventDefault();
  };
  onMount(() => addEventListener('keydown', onEscape));
  onCleanup(() => removeEventListener('keydown', onEscape));

  return (
    <Shell step={1} title="Who is working?" lead="Pick the worker profile this machine uses. Its skills and style are imported into your projects.">
      <Switch>
        <Match when={!workersLoaded()}>
          <p class="empty">Asking the stack…</p>
        </Match>
        <Match when={workersError()}>
          <Alert
            tone="error"
            icon="alert"
            role="alert"
            actions={
              <Button size="sm" ref={focusSoon} onClick={() => void refreshWorkers()}>
                Retry
              </Button>
            }
          >
            <HumanBody human={humanizeCliError(workersError() ?? '')} />
          </Alert>
          <p>
            <button class="linklike" onClick={() => skipWorker()}>
              continue without one
            </button>
          </p>
        </Match>
        <Match when={names().length === 0}>
          <p class="empty">No workers in this stack.</p>
          <p>
            <Button ref={focusSoon} onClick={() => skipWorker()}>
              Continue without one
            </Button>
          </p>
        </Match>
        <Match when={true}>
          <PickList label="workers" items={names} pick={pick} initial={() => names().indexOf(config()?.worker ?? '')} />
          <p class="hint">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> choose · <Kbd>1</Kbd>–<Kbd>9</Kbd> jump
            <Show when={config()?.worker}> · <Kbd>Esc</Kbd> keep {config()?.worker}</Show>
          </p>
        </Match>
      </Switch>
    </Shell>
  );
}

export function ProjectScreen() {
  // Browse and scan failures stay on this screen; a failed pick from the list
  // reaches the top-level banner through the store's actionError.
  const [notice, setNotice] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal(false);
  const [scanRes, setScanRes] = createSignal<ScanOut | null>(null);

  const recentPaths = createMemo(() => config()?.recentProjects ?? []);

  const pickRecent = (i: number) => {
    const p = recentPaths()[i];
    if (p) void chooseProject(p);
  };

  async function browse() {
    setNotice(null);
    let dir: string | null = null;
    try {
      dir = await pickFolder();
    } catch (err) {
      setNotice(errText(err));
      return;
    }
    if (dir) await chooseProject(dir);
  }

  async function scan() {
    const c = config();
    setScanning(true);
    setNotice(null);
    setScanRes(null);
    try {
      const roots = [
        ...(c?.scanRoot?.trim() ? [c.scanRoot.trim()] : []),
        ...(c?.scanRoots ?? []),
      ];
      const out = await scanProjects(
        roots.length ? { roots, stackDir: c?.stackPath } : { stackDir: c?.stackPath },
      );
      setScanRes(out);
    } catch (err) {
      setNotice(errText(err));
    } finally {
      setScanning(false);
    }
  }

  // Escape cancels a project switch (the open project stays); on a first
  // run it goes back to who.
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!cancelSwitchProject()) switchWorker();
  };
  onMount(() => addEventListener('keydown', onEscape));
  onCleanup(() => removeEventListener('keydown', onEscape));

  return (
    <Shell step={2} title="Choose a project" lead="The folder stack imports into. Recent projects are one key away.">
      <Show when={notice()}>
        <CliErr text={notice() ?? ''} />
      </Show>
      <p>
        <Button
          variant="obsidian"
          ref={(el) => {
            if (recentPaths().length === 0) focusSoon(el);
          }}
          onClick={() => void browse()}
        >
          <Icon name="folder" size={14} /> Browse folder
        </Button>{' '}
        <Button disabled={scanning()} onClick={() => void scan()}>
          <Icon name="search" size={14} /> {scanning() ? 'Scanning…' : 'Scan for projects'}
        </Button>
      </p>
      <Show when={recentPaths().length > 0}>
        <h2>Recent</h2>
        <PickList
          label="recent projects"
          icon="folder"
          items={recentPaths}
          pick={pickRecent}
          initial={() => recentPaths().indexOf(config()?.project ?? '')}
        />
        <p class="hint">
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>Esc</Kbd> {config()?.project ? 'cancel' : 'back'}
        </p>
      </Show>
      <Show when={scanRes()}>
        {(s) => (
          <Show when={s().repos.length > 0} fallback={<p class="empty">No projects found.</p>}>
            <div class="rows">
              <For each={s().repos}>
                {(r) => (
                  <div class="row pick">
                    <Button size="sm" onClick={() => void chooseProject(r.path)}>Open</Button>
                    <span class="nm" title={r.path}>{r.name}</span>
                    <span class="lead" aria-hidden="true" />
                    <span class="dimtxt">
                      {r.hasLock ? 'has imports' : r.markers.length ? r.markers.join(' ') : 'plain folder'}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
      <p class="dimtxt">
        <Show
          when={config()?.project}
          fallback={
            <button class="linklike" onClick={() => switchWorker()}>
              ‹ Back to {workerName() ?? 'who'}
            </button>
          }
        >
          <button class="linklike" onClick={() => cancelSwitchProject()}>
            ‹ Cancel, stay on {(config()?.project ?? '').split(/[\\/]+/).filter(Boolean).pop()}
          </button>
        </Show>
      </p>
    </Shell>
  );
}
