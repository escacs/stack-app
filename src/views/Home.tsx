// Home: where am i — worker, project, imports at a glance.
import { Show } from 'solid-js';
import { href } from '../router';
import { config, lock, node, report, stack, workerName, workers } from '../store';
import { rowState } from '../parse';

export default function Home(props: { scenario: string }) {
  const attention = () =>
    lock().rows.filter((r) => rowState(r) !== 'imported').length;
  return (
    <div>
      <p class="lede">stack imports, without the terminal.</p>
      <dl>
        <dt>worker</dt>
        <dd>
          <Show when={workerName()} fallback={<span class="dimtxt">none — </span>}>
            {(w) => <span>{w()} </span>}
          </Show>
          <a href={href(props.scenario, 'worker')}>pick</a>
          <Show when={workers().length === 0}>
            <span class="dimtxt"> (no worker entries in this stack)</span>
          </Show>
        </dd>
        <dt>project</dt>
        <dd>
          <Show when={config()?.project} fallback={<span class="dimtxt">none — </span>}>
            {(p) => <span title={p()}>{p()} </span>}
          </Show>
          <a href={href(props.scenario, 'project')}>pick</a>
          <Show when={report() && !report()?.valid}>
            <span class="dimtxt"> (not a readable dir)</span>
          </Show>
        </dd>
        <dt>imports</dt>
        <dd>
          <Show when={config()?.project} fallback={<span class="dimtxt">pick a project first</span>}>
            <span>
              {lock().rows.length} imports
              <Show when={attention() > 0}> · {attention()} need attention</Show>{' '}
            </span>
            <a href={href(props.scenario, 'status')}>status</a>
          </Show>
        </dd>
        <dt>browse</dt>
        <dd>
          <a href={href(props.scenario, 'browse')}>all entries</a>
          <span class="dimtxt"> — import from here</span>
        </dd>
        <dt>stack</dt>
        <dd>
          <Show when={stack()} fallback={<span class="dimtxt">checking…</span>}>
            <span title={stack()?.path ?? ''}>
              {stack()?.path ?? 'missing'} ({stack()?.source === 'settings' ? 'settings' : stack()?.source === 'env' ? 'env' : stack()?.source === 'auto' ? 'auto' : 'missing'})
            </span>{' '}
          </Show>
          <a href={href(props.scenario, 'project')}>settings</a>
        </dd>
      </dl>
      <Show when={node() && !node()?.ok}>
        <p class="conflict" role="alert">
          {node()?.error ?? 'node 22+ is required.'} stack commands are disabled until node is found.
        </p>
      </Show>
    </div>
  );
}
