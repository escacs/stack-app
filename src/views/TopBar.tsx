// Top chrome: crumbs-style nav plus the worker/project switchers.
import { For, Show } from 'solid-js';
import { busy, config, node, workerName, workers, project, chooseWorker } from '../store';
import { href } from '../router';

export default function TopBar(props: { scenario: string; segs: string[] }) {
  const view = () => props.segs[0] ?? '';
  const nav = () => [
    ['worker', 'worker'],
    ['project', 'project'],
    ['browse', 'browse'],
    ['status', 'status'],
  ];
  return (
    <header id="topbar">
      <nav aria-label="views">
        <a href={href(props.scenario)} class={view() === '' ? 'cur' : ''}>~</a>
        <For each={nav()}>
          {([seg, label]) => (
            <>
              <span class="sep">/</span>
              <a href={href(props.scenario, seg)} class={view() === seg ? 'cur' : ''}>
                {label}
              </a>
            </>
          )}
        </For>
      </nav>
      <div class="switchers">
        <Show when={busy()}>
          <span class="dimtxt">{busy()}…</span>
        </Show>
        <label title="worker profile">
          <span class="dimtxt">who</span>{' '}
          <select
            value={workerName() ?? ''}
            onChange={(e) => void chooseWorker(e.currentTarget.value || null)}
            aria-label="worker profile"
          >
            {/* selected per option: the value prop alone does not re-apply
                once the async worker list populates the options. */}
            <option value="" selected={workerName() == null}>none</option>
            <For each={workers()}>
              {(w) => <option value={w.name} selected={workerName() === w.name}>{w.name}</option>}
            </For>
          </select>
        </label>
        <Show when={project()}>
          <span class="dimtxt" title={project() ?? ''}>
            {shortPath(project() ?? '')}
          </span>
        </Show>
        <span
          class={`node ${node()?.ok === false ? 'bad' : ''}`}
          title={node()?.ok === false ? (node()?.error ?? 'node missing') : (node()?.version ?? 'node?')}
        >
          {node()?.ok === false ? '(x_x)' : '(^_^)'}
        </span>
        <Show when={!config()}>
          <span class="dimtxt">loading…</span>
        </Show>
      </div>
    </header>
  );
}

function shortPath(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}
