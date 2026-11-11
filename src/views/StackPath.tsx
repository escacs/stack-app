// Stack line: which escacs/stack checkout imports come from. `change` picks a
// folder (saved as the settings override); `auto` clears it back to the
// automatic lookup. Lives in the footer settings: it is about the app, not
// the project. An invalid stack never gets here (StackSetup blocks it).
import { Show, createSignal } from 'solid-js';
import { errText } from '../bridge';
import { chooseStackPath, clearStackPath, config, stack } from '../store';

export function StackPath() {
  const [notice, setNotice] = createSignal<string | null>(null);
  const [working, setWorking] = createSignal<'change' | 'auto' | null>(null);

  async function change() {
    setWorking('change');
    setNotice(null);
    try {
      setNotice(await chooseStackPath());
    } catch (err) {
      setNotice(errText(err));
    } finally {
      setWorking(null);
    }
  }

  async function auto() {
    setWorking('auto');
    setNotice(null);
    try {
      await clearStackPath();
    } catch (err) {
      setNotice(errText(err));
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <Show when={stack()?.error}>
        {(e) => <p class="conflict" role="alert">{e()}</p>}
      </Show>
      <Show when={notice()}>
        {(n) => <p class="conflict" role="alert">{n()}</p>}
      </Show>
      <p class="dimtxt">
        stack {stack()?.path ?? ''}{' '}
        <button
          class="btn"
          title="pick the escacs/stack clone (the folder containing tools/stack/cli.mjs)"
          disabled={working() !== null}
          onClick={() => void change()}
        >
          {working() === 'change' ? 'working' : 'change'}
        </button>
        <Show when={config()?.stackPath}>
          {' '}
          <button
            class="btn"
            title="back to the automatic lookup"
            disabled={working() !== null}
            onClick={() => void auto()}
          >
            {working() === 'auto' ? 'working' : 'auto'}
          </button>
        </Show>
      </p>
    </>
  );
}
