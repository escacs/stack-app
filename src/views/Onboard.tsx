// First-run onboarding: who, then which project. Rendered by App instead of
// the views until both are set. One question per screen, `>` cursor rows,
// arrows/j/k + enter + 1-9. Escape on the project screen goes back to who.
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { errText, pickFolder, scanProjects, type ScanOut } from '../bridge';
import { moveSel } from '../onboard';
import {
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

const MARK = [
  '  ▄██▄',
  '▄██████▄',
  '███▄▄▄▀',
  ' ▀▀▀████',
  '▀███▄▄▄',
  '   ▀█▀',
].join('\n');

function Shell(props: { children: unknown }) {
  return (
    <div class="onboard">
      <pre class="art" aria-hidden="true">{MARK}</pre>
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
  items: () => string[];
  pick: (i: number) => void;
}) {
  const [sel, setSel] = createSignal(0);
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
            <span class="cur-mark" aria-hidden="true">&gt;</span>
            <span class="dimtxt">{i() + 1}</span>
            <span class="nm">{name}</span>
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

  return (
    <Shell>
      <h1 class="prompt">who?</h1>
      <Switch>
        <Match when={!workersLoaded()}>
          <p class="empty">(._.) asking the stack…</p>
        </Match>
        <Match when={workersError()}>
          <p class="conflict" role="alert">{workersError()}</p>
          <p>
            <button class="btn" ref={focusSoon} onClick={() => void refreshWorkers()}>
              retry
            </button>{' '}
            <button class="linklike" onClick={() => skipWorker()}>
              continue without one
            </button>
          </p>
        </Match>
        <Match when={names().length === 0}>
          <p class="empty">(._.) none</p>
          <p>
            <button class="btn" ref={focusSoon} onClick={() => skipWorker()}>
              continue without one
            </button>
          </p>
        </Match>
        <Match when={true}>
          <PickList label="workers" items={names} pick={pick} />
          <p class="hint">↑↓ enter</p>
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

  // Escape anywhere on this screen goes back to who.
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') void switchWorker();
  };
  onMount(() => addEventListener('keydown', onEscape));
  onCleanup(() => removeEventListener('keydown', onEscape));

  return (
    <Shell>
      <h1 class="prompt">project</h1>
      <Show when={notice()}>
        <p class="conflict" role="alert">{notice()}</p>
      </Show>
      <p>
        <button
          class="btn primary"
          ref={(el) => {
            if (recentPaths().length === 0) focusSoon(el);
          }}
          onClick={() => void browse()}
        >
          browse folder
        </button>
      </p>
      <Show when={recentPaths().length > 0}>
        <h2>recent</h2>
        <PickList label="recent projects" items={recentPaths} pick={pickRecent} />
        <p class="hint">↑↓ enter</p>
      </Show>
      <p>
        <button class="btn" disabled={scanning()} onClick={() => void scan()}>
          {scanning() ? 'scanning' : 'scan'}
        </button>
      </p>
      <Show when={scanRes()}>
        {(s) => (
          <Show when={s().repos.length > 0} fallback={<p class="empty">(._.) none</p>}>
            <div class="rows">
              <For each={s().repos}>
                {(r) => (
                  <div class="row pick">
                    <button class="btn" onClick={() => void chooseProject(r.path)}>open</button>
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
        <button class="linklike" onClick={() => void switchWorker()}>
          ‹ {workerName() ?? 'who'}
        </button>
      </p>
    </Shell>
  );
}
