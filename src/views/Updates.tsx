// App line: running version, a manual update check, then install with
// progress and relaunch. A newer build found by the startup check is offered
// here too (the footer links to this line). Errors surface verbatim.
import { Show, createSignal } from 'solid-js';
import { errText } from '../bridge';
import { fmtBytes } from '../parse';
import { appUpdate, appVersion } from '../store';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  relaunchApp,
  type Update,
  type UpdateProgress,
} from '../updater';

export function Updates() {
  const [checking, setChecking] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [progress, setProgress] = createSignal<UpdateProgress | null>(null);
  const [installed, setInstalled] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Version on offer: a manual check's handle, else the startup check's.
  const offered = () => update()?.version ?? appUpdate();
  const busy = () => checking() || installing();

  async function check() {
    setChecking(true);
    setError(null);
    setStatus(null);
    setProgress(null);
    setInstalled(false);
    try {
      const u = await checkForUpdate();
      setUpdate(u);
      if (!u) setStatus('up to date');
    } catch (err) {
      setError(errText(err));
    } finally {
      setChecking(false);
    }
  }

  async function install() {
    setInstalling(true);
    setError(null);
    setProgress(null);
    try {
      let u: Update | null = update();
      if (!u) {
        // The startup check reports a version but no install handle; a
        // fresh check yields one.
        u = await checkForUpdate();
        if (!u) {
          setStatus('up to date');
          return;
        }
        setUpdate(u);
      }
      await downloadAndInstallUpdate(u, (p) => setProgress({ ...p }));
      setInstalled(true);
      setStatus(`installed ${u.version}`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setInstalling(false);
    }
  }

  async function relaunch() {
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
    <>
      <p class="dimtxt">
        app {appVersion() ?? '?'}
        <Show when={offered()}>
          <span> → {offered()}</span>
        </Show>{' '}
        <button class="btn" disabled={busy()} onClick={() => void check()}>
          {checking() ? 'working' : 'check'}
        </button>
        <Show when={offered() && !installed()}>
          {' '}
          <button
            class="btn"
            title={update()?.body ?? 'download and install'}
            disabled={busy()}
            onClick={() => void install()}
          >
            {installing() ? 'working' : 'install'}
          </button>
        </Show>
        <Show when={installed()}>
          {' '}
          <button class="btn" onClick={() => void relaunch()}>relaunch</button>
        </Show>
      </p>
      <Show when={installing() ? progressText() : status()}>
        {(t) => <p class="dimtxt">{t()}</p>}
      </Show>
      <Show when={error()}>
        <p class="conflict" role="alert">{error()}</p>
      </Show>
    </>
  );
}
