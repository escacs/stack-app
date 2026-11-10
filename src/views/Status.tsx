// Installed: this project's imports (update, remove, sync, init, adopt),
// presets, then the stack checkout and app version. One op runs at a time;
// the lock is re-read after every op, failed or not, so the rows never lag
// what the CLI last did. Update merges or leaves <<<<<<< markers, remove
// keeps edited files, sync only restores missing files, adopt never
// overwrites.
import { For, Show, createEffect, createSignal, on, onMount } from 'solid-js';
import { errText, stackRun, type StackOut } from '../bridge';
import {
  describeImport,
  describeInit,
  describePresetApply,
  describeRemove,
  describeSync,
  describeUpdate,
  fromStackOut,
  importArgs,
  presetApplyArgs,
  refusalFiles,
  type ImportJson,
  type InitJson,
  type OpSection,
  type PresetApplyJson,
  type RemoveJson,
  type SyncJson,
  type UpdateJson,
} from '../json';
import { countUpdates, rowState } from '../parse';
import { href } from '../router';
import { config, lock, lockError, refreshLock, refreshReport, report } from '../store';
import { Chip, CliErr, Empty, OpResult } from '../ui';
import { Presets, presetKey } from './Presets';
import { StackPath } from './StackPath';
import { Updates } from './Updates';

// One stack command. `key` names the control that shows `working` while it
// runs (every other control is disabled); `label` heads its output.
type Op = {
  key: string;
  label: string;
  sub: string;
  args: string[];
  describe: (out: StackOut) => OpSection[];
};

function decode<T>(describe: (j: T) => OpSection[]): (out: StackOut) => OpSection[] {
  return (out) => describe(fromStackOut<T>(out));
}

export default function Status(props: { scenario: string }) {
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [logLabel, setLogLabel] = createSignal('');
  const [pending, setPending] = createSignal<string | null>(null);
  const [lookalikes, setLookalikes] = createSignal<string[]>([]);
  const [adoptOpen, setAdoptOpen] = createSignal(false);
  const [adoptId, setAdoptId] = createSignal('');
  const [adoptTo, setAdoptTo] = createSignal('');
  let adoptRef: HTMLInputElement | undefined;

  onMount(() => void refreshLock());

  // Output and adopt fields belong to the project they ran against.
  createEffect(
    on(
      () => config()?.project ?? null,
      () => {
        clearOutput();
        setAdoptOpen(false);
        setAdoptId('');
        setAdoptTo('');
      },
      { defer: true },
    ),
  );

  function clearOutput() {
    setSections(null);
    setFailed(null);
    setLookalikes([]);
    setLogLabel('');
  }

  async function run(op: Op) {
    const c = config();
    if (!c?.project || pending()) return;
    setPending(op.key);
    clearOutput();
    try {
      const out = await stackRun(op.sub, op.args, c.project, c.stackPath);
      setLogLabel(op.label);
      setSections(op.describe(out));
    } catch (err) {
      const text = errText(err);
      setLogLabel(op.label);
      setFailed(text);
      if (op.sub === 'import') setLookalikes(refusalFiles(text));
    } finally {
      await refreshLock();
      if (op.sub === 'init') await refreshReport();
      setPending(null);
    }
  }

  const busyText = (key: string, text: string) => (pending() === key ? 'working' : text);

  // The op label heads the output unless the first section already names
  // the op (`remove x`, `update x → …`), which would print it twice.
  const sectionsHeading = () => {
    const first = sections()?.[0]?.title ?? '';
    return first.startsWith(logLabel()) ? '' : logLabel();
  };

  const needsInit = () => {
    const markers = report()?.markers ?? [];
    return (
      lock().rows.length === 0 &&
      !markers.includes('stack.toml') &&
      !markers.includes('stack.lock.json')
    );
  };

  const updateRow = (id: string): Op => ({
    key: `update ${id}`,
    label: `update ${id}`,
    sub: 'update',
    args: [id, '--json'],
    describe: decode<UpdateJson>(describeUpdate),
  });
  const removeRow = (id: string): Op => ({
    key: `remove ${id}`,
    label: `remove ${id}`,
    sub: 'remove',
    args: [id, '--json'],
    describe: decode<RemoveJson>(describeRemove),
  });
  const updateAll: Op = {
    key: 'update all',
    label: 'update all',
    sub: 'update',
    args: ['--json'],
    describe: decode<UpdateJson>(describeUpdate),
  };
  const sync: Op = {
    key: 'sync',
    label: 'sync',
    sub: 'sync',
    args: ['--json'],
    describe: decode<SyncJson>(describeSync),
  };
  const init: Op = {
    key: 'init',
    label: 'init',
    sub: 'init',
    args: ['--json'],
    describe: decode<InitJson>(describeInit),
  };
  const preset = (name: string): Op => ({
    key: presetKey(name),
    label: presetKey(name),
    sub: 'preset',
    args: presetApplyArgs(name),
    describe: decode<PresetApplyJson>(describePresetApply),
  });

  function toggleAdopt() {
    const open = !adoptOpen();
    setAdoptOpen(open);
    if (open) queueMicrotask(() => adoptRef?.focus());
  }

  function submitAdopt() {
    const id = adoptId().trim();
    if (!id || pending()) return;
    void run({
      key: 'adopt',
      label: `adopt ${id}`,
      sub: 'import',
      args: importArgs(id, adoptTo()),
      describe: decode<ImportJson>(describeImport),
    });
  }

  return (
    <div>
      <Show when={report()?.errors?.[0]}>
        {(e) => <p class="conflict" role="alert">{e()}</p>}
      </Show>
      <Show when={config()?.project} fallback={<Empty>(._.) no project</Empty>}>
        <Show when={lockError()}>
          {(e) => <CliErr text={e()} />}
        </Show>
        <Show when={lock().rows.length} fallback={<Show when={!lockError()}><Empty>(._.) nothing imported</Empty></Show>}>
          <div class="rows">
            <For each={lock().rows}>
              {(r) => {
                const upstream = r.upstreamCount ?? 0;
                const canUpdate = !r.gone && upstream > 0;
                return (
                  <div class="statusrow">
                    <div class="row">
                      <Chip state={rowState(r)} />
                      <a class="nm" href={href(props.scenario, 'browse', r.id)} title={r.id}>
                        {r.id}
                      </a>
                      <span class="lead" aria-hidden="true" />
                      <span class="dimtxt">@{r.commit.slice(0, 7)} → {r.path}</span>
                    </div>
                    <div class="sub">
                      <Show when={r.gone}>
                        <span class="dimtxt">removed from stack</span>
                      </Show>
                      <Show when={canUpdate}>
                        <span>
                          {upstream} file{upstream === 1 ? '' : 's'} changed upstream
                        </span>
                      </Show>
                      <Show when={r.local.length}>
                        <span class="dimtxt">edited: {r.local.join(', ')}</span>
                      </Show>
                      <span class="acts">
                        <Show when={canUpdate}>
                          <button
                            class="btn"
                            title="merges upstream changes; conflicts get <<<<<<< markers"
                            disabled={!!pending()}
                            onClick={() => void run(updateRow(r.id))}
                          >
                            {busyText(`update ${r.id}`, 'update')}
                          </button>
                        </Show>
                        <button
                          class="btn danger"
                          title="unimports this entry; files edited here are kept"
                          disabled={!!pending()}
                          onClick={() => void run(removeRow(r.id))}
                        >
                          {busyText(`remove ${r.id}`, 'remove')}
                        </button>
                      </span>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
          <p>
            <Show when={countUpdates(lock().rows) > 0}>
              <button class="btn" disabled={!!pending()} onClick={() => void run(updateAll)}>
                {busyText('update all', 'update all')}
              </button>{' '}
            </Show>
            <button
              class="btn"
              title="restores imported files that are missing, from stack.toml; edits are never touched"
              disabled={!!pending()}
              onClick={() => void run(sync)}
            >
              {busyText('sync', 'sync')}
            </button>
            <Show when={lock().commit}>
              {' '}
              <span class="dimtxt">@{(lock().commit ?? '').slice(0, 7)}</span>
            </Show>
          </p>
        </Show>

        <Show when={needsInit()}>
          <p>
            <button
              class="btn"
              title="creates stack.toml plus the managed .gitignore block; migrates a legacy stack.lock.json"
              disabled={!!pending()}
              onClick={() => void run(init)}
            >
              {busyText('init', 'init stack.toml')}
            </button>
          </p>
        </Show>

        <Show when={failed()}>
          <h2>{logLabel()}</h2>
          <Show
            when={lookalikes().length}
            fallback={<CliErr text={failed() as string} />}
          >
            <p class="conflict" role="alert">untracked look-alikes, nothing written:</p>
            <pre class="raw">{lookalikes().join('\n')}</pre>
          </Show>
        </Show>
        <Show when={sections()}>
          <OpResult sections={sections() as OpSection[]} label={sectionsHeading()} />
        </Show>

        <p>
          <button
            class="linklike"
            title="a folder that looks like a stack entry but was never imported: name it. identical files join stack.toml; differing files are listed and nothing is written"
            aria-expanded={adoptOpen()}
            onClick={toggleAdopt}
          >
            adopt…
          </button>
        </p>
        <Show when={adoptOpen()}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitAdopt();
            }}
          >
            <p>
              <input
                type="text"
                ref={(el) => (adoptRef = el)}
                value={adoptId()}
                onInput={(e) => setAdoptId(e.currentTarget.value)}
                placeholder="entry id, e.g. skills/file-pr"
                aria-label="entry id to adopt"
                size={26}
              />{' '}
              <input
                type="text"
                value={adoptTo()}
                onInput={(e) => setAdoptTo(e.currentTarget.value)}
                placeholder="--to dir (optional)"
                aria-label="adopt destination"
                size={16}
              />{' '}
              <button
                type="submit"
                class="btn"
                disabled={!!pending() || !adoptId().trim()}
              >
                {busyText('adopt', 'adopt')}
              </button>
            </p>
          </form>
        </Show>

        <Presets pending={pending()} onApply={(name) => void run(preset(name))} />

        <StackPath />
        <Updates />
      </Show>
    </div>
  );
}
