// Footer updater: one quiet segment of the footer line. Idle it is just
// `check for updates`; every state stays on that same line: `checking…`,
// `up to date` (fades back to the link after a few seconds),
// `→ <version> available [install]`, download progress, `[relaunch]`.
// Errors show short and dim with the full text in a tooltip; `[retry]`
// re-runs the failed step. A newer build found by the startup check
// (store.appUpdate) offers install without a click. About the app, not
// the project — hence the footer.
import { Match, Switch, createSignal, onCleanup } from 'solid-js';
import { errText } from '../bridge';
import { appUpdate, setAppUpdate } from '../store';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  formatUpdateProgress,
  relaunchApp,
  shortenError,
  type Update,
  type UpdateProgress,
} from '../updater';

export function Updates() {
  const [checking, setChecking] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [progress, setProgress] = createSignal<UpdateProgress | null>(null);
  const [installed, setInstalled] = createSignal(false);
  const [fresh, setFresh] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [failedOp, setFailedOp] = createSignal<'check' | 'install' | 'relaunch'>('check');

  // Version on offer: a manual check's handle, else the startup check's.
  const offered = () => update()?.version ?? appUpdate();
  const busy = () => checking() || installing();

  // `up to date` lingers, then fades back to the link.
  let freshTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (freshTimer) clearTimeout(freshTimer);
  });
  function showFresh() {
    setFresh(true);
    if (freshTimer) clearTimeout(freshTimer);
    freshTimer = setTimeout(() => setFresh(false), 4000);
  }

  async function check() {
    if (busy()) return;
    setChecking(true);
    setError(null);
    setFresh(false);
    setProgress(null);
    setInstalled(false);
    try {
      const u = await checkForUpdate();
      setUpdate(u);
      if (!u) {
        // A fresh "nothing" supersedes the startup check's offer, if any.
        setAppUpdate(null);
        showFresh();
      }
    } catch (err) {
      setError(errText(err));
      setFailedOp('check');
    } finally {
      setChecking(false);
    }
  }

  async function install() {
    if (busy()) return;
    setInstalling(true);
    setError(null);
    setFresh(false);
    setProgress(null);
    try {
      let u: Update | null = update();
      if (!u) {
        // The startup check reports a version but no install handle; a
        // fresh check yields one.
        u = await checkForUpdate();
        if (!u) {
          setAppUpdate(null);
          showFresh();
          return;
        }
        setUpdate(u);
      }
      await downloadAndInstallUpdate(u, (p) => setProgress({ ...p }));
      setInstalled(true);
    } catch (err) {
      setError(errText(err));
      setFailedOp('install');
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
      setFailedOp('relaunch');
    }
  }

  function retry() {
    const op = failedOp();
    if (op === 'install') void install();
    else if (op === 'relaunch') void relaunch();
    else void check();
  }

  return (
    <Switch>
      <Match when={error()}>
        {(full) => (
          <span>
            <span class="fadein" role="alert" title={full()}>
              {shortenError(full())}
            </span>{' '}
            <button class="btn" onClick={retry}>
              retry
            </button>
          </span>
        )}
      </Match>
      <Match when={installing()}>
        <span class="fadein">{formatUpdateProgress(progress()) ?? 'installing…'}</span>
      </Match>
      <Match when={installed()}>
        <button
          class="btn fadein"
          title={offered() ? `relaunch to use ${offered()}` : 'relaunch to use the installed update'}
          onClick={() => void relaunch()}
        >
          relaunch
        </button>
      </Match>
      <Match when={checking()}>
        <span class="fadein">checking…</span>
      </Match>
      <Match when={fresh()}>
        <span class="fadein">up to date</span>
      </Match>
      <Match when={offered()}>
        {(v) => (
          <span>
            <span class="fadein">→ {v()} available</span>{' '}
            <button
              class="btn"
              title={update()?.body ?? 'download and install'}
              onClick={() => void install()}
            >
              install
            </button>
          </span>
        )}
      </Match>
      <Match when={true}>
        <button class="linklike fadein" onClick={() => void check()}>
          check for updates
        </button>
      </Match>
    </Switch>
  );
}
