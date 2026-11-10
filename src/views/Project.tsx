// Project picker: folder dialog, remembered recents, repo scan of the
// configured roots, and the stack-checkout settings override.
import { For, Show, createSignal, onMount } from 'solid-js';
import {
  defaultScanRoots,
  errText,
  pickFolder,
  scanProjects,
  stackRun,
  type ScanOut,
} from '../bridge';
import {
  describePresetApply,
  fromStackOut,
  presetApplyArgs,
  presetListArgs,
  type OpSection,
  type PresetApplyJson,
  type PresetListItem,
  type PresetListJson,
} from '../json';
import { fmtBytes } from '../parse';
import {
  chooseProject,
  chooseStackPath,
  clearStackPath,
  config,
  refreshLock,
  report,
  revalidateStack,
  saveScanRoot,
  saveScanRoots,
  stack,
} from '../store';
import { CliErr, OpResult } from '../ui';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  relaunchApp,
  type Update,
  type UpdateProgress,
} from '../updater';

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

      <PresetsSection />

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

      <UpdateSection />
    </div>
  );
}



// Named import bundles for setting a project up in one step. Each row
// expands to its imports (id plus --to each); apply runs `preset apply`
// and renders the result like an import log, then refreshes the lock.
function PresetsSection() {
  const [presets, setPresets] = createSignal<PresetListItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [note, setNote] = createSignal<string | null>(null);
  const [open, setOpen] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<{ name: string; sections: OpSection[] } | null>(null);
  const [failed, setFailed] = createSignal<{ name: string; text: string } | null>(null);

  onMount(() => void load());

  async function load() {
    const c = config();
    setLoading(true);
    setNote(null);
    try {
      const out = await stackRun('preset', presetListArgs(), c?.project ?? '.', c?.stackPath);
      setPresets(fromStackOut<PresetListJson>(out).presets);
    } catch (err) {
      setNote(errText(err));
    } finally {
      setLoading(false);
    }
  }

  async function apply(name: string) {
    const c = config();
    if (!c?.project) return;
    setPending(name);
    setResult(null);
    setFailed(null);
    try {
      const out = await stackRun('preset', presetApplyArgs(name), c.project, c.stackPath);
      setResult({ name, sections: describePresetApply(fromStackOut<PresetApplyJson>(out)) });
      await refreshLock();
    } catch (err) {
      setFailed({ name, text: errText(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <h2>presets</h2>
      <Show when={loading()}>
        <p class="dimtxt">loading…</p>
      </Show>
      <Show when={note()}>
        <CliErr text={note() as string} />
      </Show>
      <Show when={!loading() && !note()}>
        <Show when={presets().length} fallback={<p class="empty">(._.) none</p>}>
          <div class="rows">
            <For each={presets()}>
              {(p) => (
                <>
                  <div class="row pick">
                    <button class="linklike" onClick={() => setOpen(open() === p.name ? null : p.name)}>
                      {p.name}
                    </button>
                    <span class="dimtxt">{p.description}</span>
                    <span class="lead" aria-hidden="true" />
                    <button
                      class="btn"
                      disabled={pending() !== null || !config()?.project}
                      onClick={() => void apply(p.name)}
                    >
                      {pending() === p.name ? 'applying' : 'apply'}
                    </button>
                  </div>
                  <Show when={open() === p.name}>
                    <Show
                      when={p.imports.length}
                      fallback={<p class="empty">(._.) no imports</p>}
                    >
                      <div class="rows preset-imports">
                        <For each={p.imports}>
                          {(imp) => (
                            <div class="row pick">
                              <span class="nm">{imp.id}</span>
                              <Show when={imp.to}>
                                <span class="dimtxt">→ {imp.to}</span>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <Show when={failed()}>
        {(f) => <CliErr text={f().text} />}
      </Show>
      <Show when={result()}>
        {(r) => <OpResult sections={r().sections} label={`preset ${r().name}`} />}
      </Show>
    </div>
  );
}

// Manual update check / download / install / relaunch against the GitHub
// releases page. Errors surface verbatim; the silent startup check runs
// Rust-side in src-tauri/src/lib.rs.
function UpdateSection() {
  const [checking, setChecking] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [progress, setProgress] = createSignal<UpdateProgress | null>(null);
  const [installed, setInstalled] = createSignal(false);

  async function checkNow() {
    setChecking(true);
    setError(null);
    setStatus(null);
    setProgress(null);
    setInstalled(false);
    try {
      const u = await checkForUpdate();
      setUpdate(u);
      setStatus(u ? `update available: ${u.currentVersion} → ${u.version}` : 'up to date');
    } catch (err) {
      setError(errText(err));
    } finally {
      setChecking(false);
    }
  }

  async function installNow() {
    const u = update();
    if (!u) return;
    setInstalling(true);
    setError(null);
    try {
      await downloadAndInstallUpdate(u, (p) => setProgress({ ...p }));
      setInstalled(true);
      setStatus(`installed ${u.version} — relaunch to run it`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setInstalling(false);
    }
  }

  async function relaunchNow() {
    setError(null);
    try {
      await relaunchApp();
    } catch (err) {
      setError(errText(err));
    }
  }

  const progressText = () => {
    const p = progress();
    if (!p) return null;
    if (p.done) return `downloaded ${fmtBytes(p.downloaded)}`;
    if (p.total) {
      const pct = Math.round((p.downloaded / p.total) * 100);
      return `${fmtBytes(p.downloaded)} / ${fmtBytes(p.total)} (${pct}%)`;
    }
    return `${fmtBytes(p.downloaded)}…`;
  };

  return (
    <div>
      <h2>updates</h2>
      <p class="dimtxt">checks the github releases page for a newer build.</p>
      <p>
        <button class="btn" disabled={checking() || installing()} onClick={() => void checkNow()}>
          {checking() ? 'checking' : 'check for updates'}
        </button>{' '}
        <Show when={update() && !installed()}>
          <button class="btn" disabled={checking() || installing()} onClick={() => void installNow()}>
            {installing() ? 'installing' : `download & install ${update()?.version}`}
          </button>{' '}
        </Show>
        <Show when={installed()}>
          <button class="btn" onClick={() => void relaunchNow()}>relaunch</button>
        </Show>
      </p>
      <Show when={status()}>
        <p class="dimtxt">{status()}</p>
      </Show>
      <Show when={update()?.body}>
        <p class="dimtxt">{update()?.body}</p>
      </Show>
      <Show when={progressText()}>
        <p class="dimtxt">{progressText()}</p>
      </Show>
      <Show when={error()}>
        <p class="conflict" role="alert">{error()}</p>
      </Show>
    </div>
  );
}
