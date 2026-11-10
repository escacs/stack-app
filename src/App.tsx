import { Match, Show, Switch, createEffect, createSignal, onCleanup } from 'solid-js';
import { appVersion, boot, bootError, config, lock, node, stack, workerSkipped } from './store';
import { countUpdates } from './parse';
import { href, parseHash } from './router';
import TitleBar from './views/TitleBar';
import TopBar from './views/TopBar';
import Worker from './views/Worker';
import Project from './views/Project';
import Browse from './views/Browse';
import Status from './views/Status';
import StackSetup from './views/StackSetup';
import { onboardStep } from './onboard';
import { ProjectScreen, WhoScreen } from './views/Onboard';

export default function App() {
  const [hash, setHash] = createSignal(parseHash(location.hash));
  const onHash = () => setHash(parseHash(location.hash));
  addEventListener('hashchange', onHash);
  onCleanup(() => removeEventListener('hashchange', onHash));

  createEffect(() => {
    void boot();
  });

  const segs = () => hash().segs;
  const view = () => segs()[0] ?? '';
  const blocked = () => stack() != null && !stack()?.valid;
  // First run: one question per screen (who, then which project) instead
  // of the router. The shell chrome hides until both are answered.
  const step = () => {
    const c = config();
    return c ? onboardStep(c.worker, c.project, workerSkipped()) : null;
  };

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
            <Match when={view() === 'worker'}>
              <Worker scenario={hash().scenario} />
            </Match>
            <Match when={view() === 'project'}>
              <Project />
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
            <Show when={appVersion()} fallback="?">
              {(v) => <span>{v()}</span>}
            </Show>
            {' · '}
            <Show
              when={countUpdates(lock().rows) > 0}
              fallback={<span>up to date</span>}
            >
              <a href={href(hash().scenario, 'installed')}>
                {countUpdates(lock().rows)} update{countUpdates(lock().rows) === 1 ? '' : 's'}
              </a>
            </Show>
            {' · '}
            <span>{node()?.version ?? 'node?'}</span>
          </span>
        </footer>
      </Show>
    </div>
  );
}
