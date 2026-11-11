import { Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js';
import { actionError, appUpdate, appVersion, boot, bootError, config, configNotice, lock, projectDone, stack, whoDone, workerSkipped } from './store';
import { countUpdates } from './parse';
import { href, parseHash, resolveView } from './router';
import TitleBar from './views/TitleBar';
import TopBar from './views/TopBar';
import Browse from './views/Browse';
import Project from './views/Project';
import { StackPath } from './views/StackPath';
import { Updates } from './views/Updates';
import StackSetup from './views/StackSetup';
import { onboardStep } from './onboard';
import { ProjectScreen, WhoScreen } from './views/Onboard';

export default function App() {
  const [hash, setHash] = createSignal(parseHash(location.hash));
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const onHash = () => setHash(parseHash(location.hash));
  onMount(() => {
    addEventListener('hashchange', onHash);
    void boot();
  });
  onCleanup(() => removeEventListener('hashchange', onHash));

  const segs = () => hash().segs;
  const view = () => resolveView(segs());
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
            <Match when={view() === 'project'}>
              <Project scenario={hash().scenario} />
            </Match>
            <Match when={view() === 'browse'}>
              <Browse scenario={hash().scenario} segs={segs()} />
            </Match>
            <Match when={true}>
              <p class="empty">(o_O) not found</p>
            </Match>
          </Switch>
        </Show>
      </main>
      <Show when={!step()}>
        <footer class="appfoot">
          <Show when={settingsOpen()}>
            <StackPath />
            <Updates />
          </Show>
          <span class="dimtxt">
            <Show when={appVersion()}>{(v) => <span>{v()}</span>}</Show>
            <Show when={appUpdate()}>
              {(v) => (
                <span>
                  {' · '}
                  <a href={href(hash().scenario, 'project')}>→ {v()} available</a>
                </span>
              )}
            </Show>
            <Show when={updates() > 0}>
              <span>
                {' · '}
                <a href={href(hash().scenario, 'project')}>
                  {updates()} update{updates() === 1 ? '' : 's'}
                </a>
              </span>
            </Show>
            {' · '}
            <button
              class="linklike"
              aria-expanded={settingsOpen()}
              onClick={() => setSettingsOpen(!settingsOpen())}
            >
              settings
            </button>
          </span>
        </footer>
      </Show>
    </div>
  );
}
