// First-run gate: when the stack checkout does not validate, every
// stack_run would fail — show the one actionable error and the folder picker
// instead of the views. Rendered by App above the router. The only place
// that names the stack folder in normal use (the version tooltip aside):
// `auto` drops a saved override back to the automatic lookup.
import { Show, createSignal } from 'solid-js';
import { chooseStackPath, clearStackPath, config, revalidateStack, stack } from '../store';

export default function StackSetup() {
  const [notice, setNotice] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function pick() {
    setBusy(true);
    setNotice(await chooseStackPath());
    setBusy(false);
  }

  async function auto() {
    setBusy(true);
    setNotice(null);
    await clearStackPath();
    setBusy(false);
  }

  return (
    <div>
      <p class="conflict" role="alert">{stack()?.error ?? 'stack checkout not found.'}</p>
      <Show when={stack()?.path}>
        {(p) => <p class="dimtxt">stack {p()} ({stack()?.source ?? 'auto'})</p>}
      </Show>
      <Show when={notice()}>
        <p class="conflict" role="alert">{notice()}</p>
      </Show>
      <p>
        <button class="btn" disabled={busy()} onClick={() => void pick()}>
          {busy() ? 'picking' : 'pick stack folder'}
        </button>{' '}
        <button class="linklike" onClick={() => void revalidateStack()}>re-check</button>
        <Show when={config()?.stackPath}>
          {' '}
          <button
            class="linklike"
            title="forget the saved folder, back to the automatic lookup"
            disabled={busy()}
            onClick={() => void auto()}
          >
            auto
          </button>
        </Show>
      </p>
    </div>
  );
}
