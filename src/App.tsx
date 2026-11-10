import { Match, Show, Switch, createEffect, createSignal, onCleanup } from 'solid-js';
import { boot, bootError, config, node, stack } from './store';
import { parseHash } from './router';
import TopBar from './views/TopBar';
import Home from './views/Home';
import Worker from './views/Worker';
import Project from './views/Project';
import Browse from './views/Browse';
import Status from './views/Status';
import StackSetup from './views/StackSetup';

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
  const entryId = () => (view() === 'browse' && segs().length > 1 ? segs().slice(1).join('/') : null);
  const blocked = () => stack() != null && !stack()?.valid;

  return (
    <div id="shell">
      <TopBar scenario={hash().scenario} segs={segs()} />
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
        <Show when={config() && !blocked()}>
          <Switch>
            <Match when={view() === ''}>
              <Home scenario={hash().scenario} />
            </Match>
            <Match when={view() === 'worker'}>
              <Worker scenario={hash().scenario} />
            </Match>
            <Match when={view() === 'project'}>
              <Project />
            </Match>
            <Match when={view() === 'browse'}>
              <Browse scenario={hash().scenario} id={entryId()} />
            </Match>
            <Match when={view() === 'status'}>
              <Status scenario={hash().scenario} />
            </Match>
            <Match when={true}>
              <p class="empty">(o_O) not found</p>
            </Match>
          </Switch>
        </Show>
      </main>
      <footer class="appfoot">
        <span class="dimtxt">
          {node()?.version ?? 'node?'} · {hash().scenario}
        </span>
      </footer>
    </div>
  );
}
