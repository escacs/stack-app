import { Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js';
import { actionError, addStackCommand, appUpdate, appVersion, boot, bootError, cliNote, config, configNotice, dismissCliNote, lock, projectDone, stack, whoDone, workerSkipped } from './store';
import { countUpdates } from './parse';
import { href, parseHash } from './router';
import TitleBar from './views/TitleBar';
import TopBar from './views/TopBar';
import Browse from './views/Browse';
import Status from './views/Status';
import StackSetup from './views/StackSetup';
import { onboardStep } from './onboard';
import { ProjectScreen, WhoScreen } from './views/Onboard';

export default function App() {
  const [hash, setHash] = createSignal(parseHash(location.hash));
  const onHash = () => setHash(parseHash(location.hash));
  onMount(() => {
    addEventListener('hashchange', onHash);
    void boot();
  });
  onCleanup(() => removeEventListener('hashchange', onHash));

  const segs = () => hash().segs;
  const view = () => segs()[0] ?? '';
  const blocked = () => stack() != null && !stack()?.valid;
  // First run: one question per screen (who, then which project) instead
  // of the router. The shell chrome hides until both are answered.
  const step = () => {
    const c = config();
    return c ? onboardStep(c.worker, c.project, workerSkipped(), whoDone(), projectDone()) : null;
  };
  const updates = () => countUpdates(lock().rows);

  return (
    <div id="shell">
      <TitleBar />
      <Show when={!step()}>
        <TopBar scenario={hash().scenario} segs={segs()} />
      </Show>
      <main id="app">
        <Show when={bootError()}>
          <p class="conflict" role="alert">{bootError()}</p>
        </Show>
        <Show when={actionError()}>
          <p class="conflict" role="alert">{actionError()}</p>
        </Show>
        <Show when={configNotice()}>
          <p class="empty">{configNotice()}</p>
        </Show>
        <Show when={cliNote()}>
          {(n) => (
            <p class="empty">
              {n().text}{' '}
              <Show when={n().offerLink}>
                <button class="linklike" onClick={() => void addStackCommand()}>[add stack command]</button>{' '}
              </Show>
              <button class="linklike" onClick={dismissCliNote}>[x]</button>
            </p>
          )}
        </Show>
        <Show when={!config() && !bootError()}>
          <p class="empty">(._.) starting…</p>
        </Show>
        <Show when={config() && blocked()}>
          <StackSetup />
        </Show>
        <Show when={config() && !blocked() && step() === 'who'}>
          <WhoScreen />
        </Show>
        <Show when={config() && !blocked() && step() === 'project'}>
          <ProjectScreen />
        </Show>
        <Show when={config() && !blocked() && !step()}>
          <Switch>
            <Match when={view() === '' || view() === 'browse'}>
              <Browse scenario={hash().scenario} segs={view() === '' ? ['browse'] : segs()} />
            </Match>
            <Match when={view() === 'installed'}>
              <Status scenario={hash().scenario} />
            </Match>
            <Match when={true}>
              <p class="empty">(o_O) not found</p>
            </Match>
          </Switch>
        </Show>
      </main>
      <Show when={!step()}>
        <footer class="appfoot">
          <span class="dimtxt">
            <Show when={appVersion()}>{(v) => <span>{v()}</span>}</Show>
            <Show when={appUpdate()}>
              {(v) => (
                <span>
                  {' · '}
                  <a href={href(hash().scenario, 'installed')}>→ {v()} available</a>
                </span>
              )}
            </Show>
            <Show when={updates() > 0}>
              <span>
                {' · '}
                <a href={href(hash().scenario, 'installed')}>
                  {updates()} update{updates() === 1 ? '' : 's'}
                </a>
              </span>
            </Show>
          </span>
        </footer>
      </Show>
    </div>
  );
}
