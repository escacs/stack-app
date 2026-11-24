// First-run gate: when the stack checkout does not validate, every
// stack_run would fail — show the one actionable error and the way out
// instead of the views. Rendered by App above the router. The only place
// that names the stack folder in normal use (the version tooltip aside):
// `auto` drops a saved override back to the automatic lookup.
import { Show, createSignal } from 'solid-js';
import { Alert, Button, CliErr, HumanBody, Rich } from '../ui';
import { humanizeCliError } from '../humanize';
import { BrandMark } from '../icons';
import { chooseStackPath, clearStackPath, config, provisionCheckout, revalidateStack, setShowSetup, stack } from '../store';

export default function StackSetup() {
  const [notice, setNotice] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<'get' | 'pick' | 'auto' | null>(null);

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

  async function auto() {
    setBusy('auto');
    setNotice(null);
    await clearStackPath();
    setBusy(null);
  }

  // Which check actually failed decides the heading, the message and the
  // primary action: Node missing -> the Node fix; otherwise -> Get stack.
  const nodeBroken = () => stack()?.node?.ok === false;
  const reason = () => {
    const e = stack()?.error?.trim();
    if (e && e !== '.') return e;
    return nodeBroken()
      ? (stack()?.node?.error ?? 'Node.js 22 or newer was not found.')
      : 'No usable escacs/stack checkout was found.';
  };

  return (
    <div class="onboard">
      <div class="onboard__mark">
        <BrandMark />
      </div>
      <h1 class="prompt">{nodeBroken() ? 'Install Node.js' : 'Set up the stack'}</h1>
      <p class="onboard__lead">
        {nodeBroken()
          ? 'The app runs the stack CLI with Node.js 22 or newer.'
          : 'The app needs an escacs/stack checkout to read the catalog from.'}
      </p>
      <Show
        when={!stack()?.valid}
        fallback={
          <Alert
            tone="success"
            role="status"
            actions={<Button variant="obsidian" size="sm" onClick={() => setShowSetup(false)}>Back to the app</Button>}
          >
            The stack was found and works. Pick another folder below only if you want to use a different copy.
          </Alert>
        }
      >
        <Alert tone="error" icon="alert" role="alert" class="humanerr">
          <HumanBody human={humanizeCliError(reason(), { run: () => {} })} />
        </Alert>
      </Show>
      <Show when={stack()?.path}>
        {(p) => <p class="dimtxt"><Rich text={`Looked for the stack in \`${p()}\`${stack()?.source === 'settings' ? ' (the folder you picked)' : ''}.`} /></p>}
      </Show>
      <Show when={notice()}>
        <CliErr text={notice() ?? ''} />
      </Show>
      <p class="actions">
        <Show
          when={nodeBroken()}
          fallback={
            <>
              <Button variant="obsidian" disabled={busy() !== null} onClick={() => void get()}>
                {busy() === 'get' ? 'Getting…' : 'Get stack'}
              </Button>
              <Button disabled={busy() !== null} onClick={() => void pick()}>
                {busy() === 'pick' ? 'Picking…' : 'Pick stack folder'}
              </Button>
              <Button onClick={() => void revalidateStack()}>Re-check</Button>
            </>
          }
        >
          <a
            class="sa-button sa-button--obsidian sa-button--md"
            href="https://nodejs.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get Node.js
          </a>
          <Button onClick={() => void revalidateStack()}>Re-check</Button>
          <Button variant="ghost" disabled={busy() !== null} onClick={() => void pick()}>
            {busy() === 'pick' ? 'Picking…' : 'Pick stack folder'}
          </Button>
        </Show>
        <Show when={config()?.stackPath}>
          <Button
            variant="ghost"
            title="forget the saved folder, back to the automatic lookup"
            disabled={busy() !== null}
            onClick={() => void auto()}
          >
            {busy() === 'auto' ? 'Auto…' : 'Use automatic lookup'}
          </Button>
        </Show>
      </p>
    </div>
  );
}
