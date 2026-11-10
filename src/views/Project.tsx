// Project picker: folder dialog, remembered recents, repo scan of the
// configured roots, and the stack-checkout settings override.
import { For, Show, createSignal } from 'solid-js';
import {
  defaultScanRoots,
  errText,
  pickFolder,
  scanProjects,
  type ScanOut,
} from '../bridge';
import {
  chooseProject,
  chooseStackPath,
  clearStackPath,
  config,
  report,
  revalidateStack,
  saveScanRoot,
  saveScanRoots,
  stack,
} from '../store';

export default function Project() {
  const [scanRoot, setScanRootState] = createSignal(config()?.scanRoot ?? '');
  const [extraRoot, setExtraRoot] = createSignal('');
  const [scanRes, setScanRes] = createSignal<ScanOut | null>(null);
  const [scanNote, setScanNote] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [defaults, setDefaults] = createSignal<string[] | null>(null);
  const [stackNotice, setStackNotice] = createSignal<string | null>(null);

  async function browse() {
    setNotice(null);
    try {
      const dir = await pickFolder();
      if (dir) await chooseProject(dir);
    } catch (err) {
      setNotice(errText(err));
    }
  }

  async function saveRoot() {
    const v = scanRoot().trim();
    await saveScanRoot(v || null);
    const c = config();
    if (c) setScanRootState(c.scanRoot ?? '');
  }

  async function addExtraRoot() {
    const v = extraRoot().trim();
    if (!v) return;
    const cur = config()?.scanRoots ?? [];
    if (cur.includes(v)) return;
    await saveScanRoots([...cur, v]);
    setExtraRoot('');
  }

  async function dropExtraRoot(v: string) {
    await saveScanRoots((config()?.scanRoots ?? []).filter((r) => r !== v));
  }

  async function showDefaults() {
    try {
      const d = await defaultScanRoots(config()?.stackPath);
      setDefaults(d.roots);
    } catch (err) {
      setScanNote(errText(err));
    }
  }

  async function scan() {
    const c = config();
    const roots = [...(c?.scanRoot?.trim() ? [c.scanRoot.trim()] : []), ...(c?.scanRoots ?? [])];
    setScanning(true);
    setScanNote(null);
    setScanRes(null);
    try {
      // No roots configured: the shell scans its defaults (stack parent
      // plus ~/Projects, ~/dev, ~/code when they exist).
      const out = await scanProjects(
        roots.length ? { roots, stackDir: c?.stackPath } : { stackDir: c?.stackPath },
      );
      setScanRes(out);
      if (!out.repos.length) setScanNote(`no project folders directly inside ${out.roots.join(', ') || 'the default roots'}.`);
    } catch (err) {
      setScanNote(errText(err));
    } finally {
      setScanning(false);
    }
  }

  async function pickStack() {
    setStackNotice(await chooseStackPath());
  }

  return (
    <div>
      <p class="lede">where imports land. nothing is created or changed by picking.</p>
      <p>
        <button class="btn" onClick={() => void browse()}>browse for a folder</button>{' '}
        <Show when={config()?.project}>
          <span class="dimtxt">current: {config()?.project}</span>
        </Show>
      </p>
      <Show when={notice()}>
        <p class="conflict" role="alert">{notice()}</p>
      </Show>

      <Show when={report()}>
        {(r) => (
          <dl>
            <dt>markers</dt>
            <dd>{r().markers.length ? r().markers.join(' ') : <span class="dimtxt">none — plain folder</span>}</dd>
            <Show when={r().errors.length}>
              <dt>errors</dt>
              <dd>{r().errors.join('; ')}</dd>
            </Show>
          </dl>
        )}
      </Show>

      <h2>recent</h2>
      <Show when={(config()?.recentProjects ?? []).length} fallback={<p class="empty">(._.) none yet</p>}>
        <div class="rows">
          <For each={config()?.recentProjects ?? []}>
            {(p) => (
              <div class={`row pick ${config()?.project === p ? 'cur' : ''}`}>
                <button class="btn" disabled={config()?.project === p} onClick={() => void chooseProject(p)}>
                  open
                </button>
                <span class="nm" title={p}>{p}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <h2>scan folders</h2>
      <p class="dimtxt">list project folders directly inside these roots (stack.toml holders first). empty? the shell scans its defaults instead.</p>
      <p>
        <input
          type="text"
          value={scanRoot()}
          onInput={(e) => setScanRootState(e.currentTarget.value)}
          placeholder="~/Arch"
          aria-label="scan folder"
          size={28}
        />{' '}
        <button class="btn" onClick={() => void saveRoot()}>save</button>{' '}
        <button class="btn" disabled={scanning()} onClick={() => void scan()}>
          {scanning() ? 'scanning' : 'scan'}
        </button>{' '}
        <button class="linklike" onClick={() => void showDefaults()}>show defaults</button>
      </p>
      <Show when={(config()?.scanRoots ?? []).length}>
        <div class="rows">
          <For each={config()?.scanRoots ?? []}>
            {(r) => (
              <div class="row pick">
                <button class="btn danger" onClick={() => void dropExtraRoot(r)}>drop</button>
                <span class="nm" title={r}>{r}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <p>
        <input
          type="text"
          value={extraRoot()}
          onInput={(e) => setExtraRoot(e.currentTarget.value)}
          placeholder="another root (optional)"
          aria-label="add another scan root"
          size={28}
        />{' '}
        <button class="btn" disabled={!extraRoot().trim()} onClick={() => void addExtraRoot()}>add root</button>
      </p>
      <Show when={defaults()}>
        <p class="dimtxt">defaults: {(defaults() as string[]).join(', ') || 'none found'}</p>
      </Show>
      <Show when={scanNote()}>
        <p class="dimtxt">{scanNote()}</p>
      </Show>
      <Show when={scanRes()}>
        {(s) => (
          <div>
            <p class="dimtxt">
              {s().roots.join(', ') || 'defaults'}
              <Show when={s().capped}> · showing 200 of more — narrow the roots</Show>
            </p>
            <div class="rows">
              <For each={s().repos}>
                {(r) => (
                  <div class="row pick">
                    <button class="btn" onClick={() => void chooseProject(r.path)}>open</button>
                    <span class="nm" title={r.path}>{r.name}</span>
                    <span class="lead" aria-hidden="true" />
                    <span class="dimtxt" title={r.markers.join(' ') || 'no markers'}>
                      {r.hasLock ? 'has imports' : r.markers.length ? r.markers.join(' ') : 'plain folder'}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      <h2>stack checkout</h2>
      <Show when={stack()} fallback={<p class="dimtxt">checking…</p>}>
        {(st) => (
          <div>
            <dl>
              <dt>path</dt>
              <dd>{st().path || <span class="dimtxt">not found</span>}</dd>
              <dt>source</dt>
              <dd>{st().source === 'settings' ? 'settings override' : st().source === 'env' ? 'ESCACS_STACK' : st().source === 'auto' ? 'automatic' : 'missing'}</dd>
              <dt>checks</dt>
              <dd class="dimtxt">
                git {st().git ? 'ok' : 'MISSING'} · cli {st().cli ? 'ok' : 'MISSING'} · node {st().node.ok ? (st().node.version ?? 'ok') : 'MISSING'}
              </dd>
            </dl>
            <Show when={!st().valid}>
              <p class="conflict" role="alert">{st().error}</p>
            </Show>
            <Show when={stackNotice()}>
              <p class="conflict" role="alert">{stackNotice()}</p>
            </Show>
            <p>
              <button class="btn" onClick={() => void pickStack()}>pick stack folder</button>{' '}
              <Show when={config()?.stackPath}>
                <button class="btn" onClick={() => void clearStackPath()}>use automatic</button>{' '}
              </Show>
              <button class="linklike" onClick={() => void revalidateStack()}>re-check</button>
            </p>
            <p class="dimtxt">the override is the escacs/stack clone (the folder containing tools/stack/cli.mjs).</p>
          </div>
        )}
      </Show>
    </div>
  );
}
