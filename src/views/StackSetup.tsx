// First-run gate: when the stack checkout does not validate, every
// stack_run would fail — explain why and offer the folder picker instead
// of the views. Rendered by App above the router.
import { Show, createSignal } from 'solid-js';
import { chooseStackPath, revalidateStack, stack } from '../store';

export default function StackSetup() {
  const [notice, setNotice] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function pick() {
    setBusy(true);
    setNotice(await chooseStackPath());
    setBusy(false);
  }

  return (
    <Show when={stack() && !stack()?.valid}>
      <div>
        <p class="lede">point the app at your escacs/stack clone to begin.</p>
        <p class="conflict" role="alert">{stack()?.error ?? 'stack checkout not found.'}</p>
        <Show when={notice()}>
          <p class="conflict" role="alert">{notice()}</p>
        </Show>
        <dl>
          <dt>tried</dt>
          <dd>{stack()?.path || <span class="dimtxt">automatic lookup found nothing</span>}</dd>
          <dt>checks</dt>
          <dd class="dimtxt">
            git {stack()?.git ? 'ok' : 'MISSING'} · cli {stack()?.cli ? 'ok' : 'MISSING'} · node{' '}
            {stack()?.node.ok ? (stack()?.node.version ?? 'ok') : 'MISSING'}
          </dd>
        </dl>
        <p>
          <button class="btn" disabled={busy()} onClick={() => void pick()}>
            {busy() ? 'picking' : 'pick stack folder'}
          </button>{' '}
          <button class="linklike" onClick={() => void revalidateStack()}>re-check</button>
        </p>
        <p class="dimtxt">
          pick the folder containing tools/stack/cli.mjs — the app shells out to that CLI for
          every stack operation and never runs project code.
        </p>
      </div>
    </Show>
  );
}
