// First-run gate: when the stack checkout does not validate, every
// stack_run would fail — show the one actionable error and the folder picker
// instead of the views. Rendered by App above the router.
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
    <div>
      <p class="conflict" role="alert">{stack()?.error ?? 'stack checkout not found.'}</p>
      <Show when={notice()}>
        <p class="conflict" role="alert">{notice()}</p>
      </Show>
      <p>
        <button class="btn" disabled={busy()} onClick={() => void pick()}>
          {busy() ? 'picking' : 'pick stack folder'}
        </button>{' '}
        <button class="linklike" onClick={() => void revalidateStack()}>re-check</button>
      </p>
    </div>
  );
}
