// First-run gate: when the stack checkout does not validate, every
// stack_run would fail — show the one actionable error and the way out
// instead of the views. Rendered by App above the router.
import { Show, createSignal } from 'solid-js';
import { chooseStackPath, provisionCheckout, revalidateStack, stack } from '../store';

export default function StackSetup() {
  const [notice, setNotice] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<'get' | 'pick' | null>(null);

  async function get() {
    setBusy('get');
    setNotice(null);
    setNotice(await provisionCheckout());
    setBusy(null);
  }

  async function pick() {
    setBusy('pick');
    setNotice(await chooseStackPath());
    setBusy(null);
  }

  return (
    <div>
      <p class="conflict" role="alert">{stack()?.error ?? 'stack checkout not found.'}</p>
      <Show when={notice()}>
        <p class="conflict" role="alert">{notice()}</p>
      </Show>
      <p>
        <button class="btn" disabled={busy() !== null} onClick={() => void get()}>
          {busy() === 'get' ? 'getting…' : 'get stack'}
        </button>{' '}
        <button class="linklike" disabled={busy() !== null} onClick={() => void pick()}>
          {busy() === 'pick' ? 'picking…' : 'pick stack folder'}
        </button>{' '}
        <button class="linklike" onClick={() => void revalidateStack()}>re-check</button>
      </p>
    </div>
  );
}
