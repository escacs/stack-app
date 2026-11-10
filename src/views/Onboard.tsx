// First-run onboarding: who are you, then open a project. Rendered by App
// instead of the router until both are set; switching later stays in the
// worker/project views. Terminal-native: one question per screen, `>` cursor
// rows, arrows/j/k + enter + 1-9.
import { For, Show, createSignal, onMount } from 'solid-js';
import { errText, pickFolder, scanProjects, type ScanOut } from '../bridge';
import { moveSel } from '../onboard';
import {
  busy,
  chooseProject,
  chooseWorker,
  config,
  refreshWorkers,
  workerName,
  workers,
  workersError,
  setWorkerSkipped,
} from '../store';

/** Shared list keys: arrows/j/k move, enter picks, 1-9 jump. */
function listKey(
  e: KeyboardEvent,
  sel: number,
  setSel: (n: number) => void,
  len: number,
  pick: (i: number) => void,
): void {
  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault();
    setSel(moveSel(sel, 1, len));
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault();
    setSel(moveSel(sel, -1, len));
  } else if (e.key === 'Enter') {
    const i = sel < 0 ? 0 : sel;
    if (i < len) {
      e.preventDefault();
      pick(i);
    }
  } else if (/^[1-9]$/.test(e.key)) {
    const i = Number(e.key) - 1;
    if (i < len) pick(i);
  }
}

const MARK = [
  '  ▄██▄',
  '▄██████▄',
  '███▄▄▄▀',
  ' ▀▀▀████',
  '▀███▄▄▄',
  '   ▀█▀',
].join('\n');

function Shell(props: { step: string; children: unknown }) {
  return (
    <div class="onboard">
      <pre class="art" aria-hidden="true">{MARK}</pre>
      <p class="dimtxt">{props.step}</p>
      {props.children as never}
    </div>
  );
}

export function WhoScreen() {
  const [sel, setSel] = createSignal(0);
  let listEl: HTMLDivElement | undefined;
  onMount(() => listEl?.focus());

  const pick = (i: number) => {
    const w = workers()[i];
    if (w) void chooseWorker(w.name);
  };

  return (
    <Shell step="step 1 of 2">
      <h1 class="prompt">who are you?</h1>
      <Show when={workersError()}>
        <p class="conflict" role="alert">{workersError()}</p>
        <p>
          <button class="btn" onClick={() => void refreshWorkers()}>retry</button>{' '}
          <button class="linklike" onClick={() => setWorkerSkipped(true)}>continue without one</button>
        </p>
      </Show>
      <Show when={!workersError() && workers().length === 0 && busy() === 'workers'}>
        <p class="empty">(._.) asking the stack…</p>
      </Show>
      <Show when={!workersError() && workers().length === 0 && busy() !== 'workers'}>
        <p class="empty">(._.) no workers in this stack</p>
        <p>
          <button class="btn" onClick={() => setWorkerSkipped(true)}>continue without one</button>
        </p>
      </Show>
      <Show when={!workersError() && workers().length > 0}>
        <div
          class="cursor-list"
          ref={listEl}
          tabIndex={0}
          role="listbox"
          aria-label="workers"
          onKeyDown={(e) => listKey(e, sel(), setSel, workers().length, pick)}
        >
          <For each={workers()}>
            {(w, i) => (
              <div
                class={`prow${sel() === i() ? ' sel' : ''}`}
                role="option"
                aria-selected={sel() === i()}
                onClick={() => pick(i())}
                onMouseEnter={() => setSel(i())}
              >
                <span class="cur-mark" aria-hidden="true">&gt;</span>
                <span class="dimtxt">{i() + 1}</span>
                <span>
                  <span class="nm">{w.name}</span>
                  <Show when={w.summary}>
                    <br />
                    <span class="dimtxt">{w.summary}</span>
                  </Show>
                </span>
              </div>
            )}
          </For>
        </div>
        <p class="hint">up/down move · enter use · 1-9 jump</p>
      </Show>
    </Shell>
  );
}

export function ProjectScreen() {
  const [sel, setSel] = createSignal(0);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal(false);
  const [scanRes, setScanRes] = createSignal<ScanOut | null>(null);
  const [scanNote, setScanNote] = createSignal<string | null>(null);
  let listEl: HTMLDivElement | undefined;
  onMount(() => listEl?.focus());

  const recents = () => config()?.recentProjects ?? [];

  const pickRecent = (i: number) => {
    const p = recents()[i];
    if (p) void chooseProject(p);
  };

  async function browse() {
    setNotice(null);
    try {
      const dir = await pickFolder();
      if (dir) await chooseProject(dir);
    } catch (err) {
      setNotice(errText(err));
    }
  }

  async function scan() {
    const c = config();
    setScanning(true);
    setScanNote(null);
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
      if (!out.repos.length) {
        setScanNote(`nothing directly inside ${out.roots.join(', ') || 'the default roots'}.`);
      }
    } catch (err) {
      setScanNote(errText(err));
    } finally {
      setScanning(false);
    }
  }

  return (
    <Shell step="step 2 of 2">
      <h1 class="prompt">open a project{workerName() ? `, ${workerName()}` : ''}</h1>
      <p>
        <button class="btn primary" onClick={() => void browse()}>
          browse for a folder
        </button>
      </p>
      <Show when={notice()}>
        <p class="conflict" role="alert">{notice()}</p>
      </Show>
      <Show when={recents().length > 0}>
        <h2>recent</h2>
        <div
          class="cursor-list"
          ref={listEl}
          tabIndex={0}
          role="listbox"
          aria-label="recent projects"
          onKeyDown={(e) => listKey(e, sel(), setSel, recents().length, pickRecent)}
        >
          <For each={recents()}>
            {(p, i) => (
              <div
                class={`prow${sel() === i() ? ' sel' : ''}`}
                role="option"
                aria-selected={sel() === i()}
                onClick={() => pickRecent(i())}
                onMouseEnter={() => setSel(i())}
              >
                <span class="cur-mark" aria-hidden="true">&gt;</span>
                <span class="dimtxt">{i() + 1}</span>
                <span class="nm" title={p}>{p}</span>
              </div>
            )}
          </For>
        </div>
        <p class="hint">up/down move · enter open · 1-9 jump</p>
      </Show>
      <h2>or find one</h2>
      <p>
        <button class="btn" disabled={scanning()} onClick={() => void scan()}>
          {scanning() ? 'scanning' : 'scan nearby folders'}
        </button>
      </p>
      <Show when={scanNote()}>
        <p class="dimtxt">{scanNote()}</p>
      </Show>
      <Show when={scanRes()}>
        {(s) => (
          <div class="rows">
            <For each={s().repos}>
              {(r) => (
                <div class="row pick">
                  <button class="btn" onClick={() => void chooseProject(r.path)}>open</button>
                  <span class="nm" title={r.path}>{r.name}</span>
                  <span class="lead" aria-hidden="true" />
                  <span class="dimtxt">{r.hasLock ? 'has imports' : r.markers.length ? r.markers.join(' ') : 'plain folder'}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <p class="dimtxt">
        somebody else?{' '}
        <button
          class="linklike"
          onClick={() => {
            setWorkerSkipped(false);
            void chooseWorker(null);
          }}
        >
          switch worker
        </button>
      </p>
    </Shell>
  );
}
