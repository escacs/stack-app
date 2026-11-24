// Footer updater: one quiet segment of the footer line. Idle it is just
// `check for updates`; every state stays on that same line: `checking…`,
// `up to date` (fades back to the link after a few seconds),
// `→ <version> available [install]`, download progress, `[relaunch]`.
// Errors show short and dim with the full text in a tooltip; `[retry]`
// re-runs the failed step. A newer build found by the startup check
// (store.appUpdate) offers install without a click. About the app, not
// the project — hence the footer.
import { Match, Show, Switch, createSignal, onCleanup } from 'solid-js';
import { Icon } from '../icons';
import { Button } from '../ui';
import { LABEL } from '../vocab';
import { errText } from '../bridge';
import { humanizeCliError, oneSentence } from '../humanize';
import { appUpdate, setAppUpdate } from '../store';
import { useAction } from '../actions';
import { pushToast } from '../toast';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  formatUpdateProgress,
  relaunchApp,
  type Update,
  type UpdateProgress,
} from '../updater';

export function Updates(props: { version?: string | null; tip?: string }) {
  const [checking, setChecking] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [progress, setProgress] = createSignal<UpdateProgress | null>(null);
  const [installed, setInstalled] = createSignal(false);
  const [fresh, setFresh] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [failedOp, setFailedOp] = createSignal<'check' | 'install' | 'relaunch'>('check');

  // Palette: the same check the footer link runs.
  useAction('check-updates', { run: () => void check(), reason: () => (busy() ? 'Already checking' : null) });

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
      pushToast(
        u
          ? { tone: 'info', title: `Version ${u.version} is available`, description: 'Install it from the sidebar footer.' }
          : { tone: 'success', title: 'You are up to date' },
      );
      if (!u) {
        // A fresh "nothing" supersedes the startup check's offer, if any.
        setAppUpdate(null);
        showFresh();
      }
    } catch (err) {
      setError(errText(err));
      setFailedOp('check');
      pushToast({ tone: 'error', title: 'Could not check for updates', description: oneSentence(humanizeCliError(errText(err))) });
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

  const pill = () => (
    <Show when={props.version}>
      {(v) => (
        <span class="footcard__ver" title={props.tip}>
          v{v()}
        </span>
      )}
    </Show>
  );
  return (
    <>
      <span class="footcard__status">
        <Switch>
          <Match when={error()}>
            {(full) => (
              <>
                <Icon name="alert" size={14} />
                <span class="fadein" role="alert" title={humanizeCliError(full()).next}>
                  {humanizeCliError(full()).title}
                </span>
                <Button size="sm" onClick={retry}>
                  Retry
                </Button>
              </>
            )}
          </Match>
          <Match when={installing()}>
            <span class="fadein">{formatUpdateProgress(progress()) ?? 'Installing…'}</span>
          </Match>
          <Match when={installed()}>
            <Button
              size="sm"
              variant="obsidian"
              class="fadein"
              title={offered() ? `Relaunch to use ${offered()}` : 'Relaunch to use the installed update'}
              onClick={() => void relaunch()}
            >
              Relaunch
            </Button>
          </Match>
          <Match when={checking()}>
            <Icon name="refresh" size={14} />
            <span class="fadein">Checking…</span>
          </Match>
          <Match when={fresh()}>
            <Icon name="check" size={14} />
            <span class="fadein">Up to date</span>
          </Match>
          <Match when={offered()}>
            {(v) => (
              <Button size="sm" variant="obsidian" title={`Install app version ${v()}${update()?.body ? `: ${update()?.body}` : ''}`} onClick={() => void install()}>
                App update available
              </Button>
            )}
          </Match>
          <Match when={true}>
            <Icon name="check" size={14} />
            <button class="linklike fadein" title={LABEL.checkAppUpdates} onClick={() => void check()}>
              App updates
            </button>
          </Match>
        </Switch>
      </span>
      {pill()}
    </>
  );
}
