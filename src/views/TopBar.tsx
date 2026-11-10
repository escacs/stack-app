// Top chrome: two views on the left; on the right the busy text, the user
// and project (each a button that sends you back to its onboarding screen),
// and the node face only when node is broken.
import { For, Show } from 'solid-js';
import { busy, chooseProject, config, node, project, switchWorker, workerName } from '../store';
import { href } from '../router';
import { shortPath } from '../onboard';

const NAV = ['browse', 'installed'] as const;

export default function TopBar(props: { scenario: string; segs: string[] }) {
  const view = () => props.segs[0] ?? '';
  const cur = (seg: string) => (seg === 'browse' ? view() === '' || view() === 'browse' : view() === seg);
  return (
    <header id="topbar">
      <nav aria-label="views">
        <For each={NAV}>
          {(seg, i) => (
            <>
              <Show when={i() > 0}>
                <span class="sep">/</span>
              </Show>
              <a href={href(props.scenario, seg)} class={cur(seg) ? 'cur' : ''}>
                {seg}
              </a>
            </>
          )}
        </For>
      </nav>
      <div class="switchers">
        <Show when={busy()}>
          <span class="dimtxt">{busy()}…</span>
        </Show>
        <Show when={config()}>
          <button class="linklike" title="switch user" onClick={() => void switchWorker()}>
            {workerName() ?? 'who'}
          </button>
        </Show>
        <Show when={project()}>
          {(p) => (
            <button
              class="linklike"
              title={p()}
              onClick={() => void chooseProject(null)}
            >
              {shortPath(p())}
            </button>
          )}
        </Show>
        <Show when={node()?.ok === false}>
          <span class="node bad" title={node()?.error ?? 'node missing'}>
            (x_x)
          </span>
        </Show>
      </div>
    </header>
  );
}
