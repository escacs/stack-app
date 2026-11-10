// Status: one row per imported entry (imported / edited / update-available /
// removed), with init for plain folders, update, remove, sync, and adopt for
// untracked look-alikes. Nothing here overwrites: update merges or leaves
// <<<<<<< markers, remove keeps edited files, sync only restores missing
// files.
import { For, Show, createSignal } from 'solid-js';
import { errText, stackRun } from '../bridge';
import { href } from '../router';
import {
  describeImport,
  describeInit,
  describeRemove,
  describeSync,
  describeUpdate,
  fromStackOut,
  refusalFiles,
  type ImportJson,
  type InitJson,
  type OpSection,
  type RemoveJson,
  type SyncJson,
  type UpdateJson,
} from '../json';
import { rowState } from '../parse';
import { config, lock, refreshLock, refreshReport, report } from '../store';
import { Chip, CliErr, Empty, OpResult } from '../ui';

export default function Status(props: { scenario: string }) {
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [logLabel, setLogLabel] = createSignal('');
  const [pending, setPending] = createSignal<string | null>(null);
  const [adoptId, setAdoptId] = createSignal('');
  const [adoptTo, setAdoptTo] = createSignal('');
  const [lookalikes, setLookalikes] = createSignal<string[]>([]);

  async function run(label: string, sub: string, args: string[]) {
    const c = config();
    if (!c?.project) return;
    setPending(label);
    setSections(null);
    setFailed(null);
    setLookalikes([]);
    try {
      const out = await stackRun(sub, [...args, '--json'], c.project, c.stackPath);
      setLogLabel(label);
      if (sub === 'import') setSections(describeImport(fromStackOut<ImportJson>(out)));
      else if (sub === 'update') setSections(describeUpdate(fromStackOut<UpdateJson>(out)));
      else if (sub === 'remove') setSections(describeRemove(fromStackOut<RemoveJson>(out)));
      else if (sub === 'init') setSections(describeInit(fromStackOut<InitJson>(out)));
      else setSections(describeSync(fromStackOut<SyncJson>(out)));
      await refreshLock();
      if (sub === 'init') await refreshReport();
    } catch (err) {
      setLogLabel(label);
      const text = errText(err);
      setFailed(text);
      if (sub === 'import') setLookalikes(refusalFiles(text));
    } finally {
      setPending(null);
    }
  }

  const anyEdited = () => lock().rows.some((r) => r.local.length > 0);
  const anyUpdate = () => lock().rows.some((r) => (r.upstreamCount ?? 0) > 0);
  // No imports and no record file of either generation: offer init, which
  // creates stack.toml (or migrates a legacy stack.lock.json).
  const needsInit = () => {
    const markers = report()?.markers ?? [];
    return (
      lock().rows.length === 0 &&
      !markers.includes('stack.toml') &&
      !markers.includes('stack.lock.json')
    );
  };

  return (
    <div>
      <p class="lede">
        <Show when={config()?.project} fallback="pick a project first.">
          {(p) => <span title={p()}>{lock().rows.length} imports in {p()}</span>}
        </Show>
        <Show when={lock().commit}> · stack at {(lock().commit ?? '').slice(0, 7)}</Show>
      </p>
      <Show when={config()?.project} fallback={
        <p><a href={href(props.scenario, 'project')}>pick a project</a></p>
      }>
        <Show when={needsInit()}>
          <h2>set up imports</h2>
          <p class="dimtxt">
            no stack.toml here yet — init creates it plus the managed .gitignore block
            (and adopts a legacy stack.lock.json when one exists).
          </p>
          <p>
            <button class="btn" disabled={!!pending()} onClick={() => void run('init', 'init', [])}>
              {pending() ? 'working' : 'init stack.toml'}
            </button>
          </p>
        </Show>
        <Show when={lock().rows.length} fallback={<Empty>(._.) no imports here</Empty>}>
          <div class="rows">
            <For each={lock().rows}>
              {(r) => (
                <div class="statusrow">
                  <div class="row">
                    <Chip state={rowState(r)} />
                    <a class="nm" href={href(props.scenario, 'browse', r.id)} title={`${r.id} @${r.commit} → ${r.path}`}>
                      {r.id}
                    </a>
                    <span class="lead" aria-hidden="true" />
                    <span class="dimtxt">@{r.commit.slice(0, 7)} → {r.path}</span>
                  </div>
                  <div class="sub">
                    <Show when={r.gone}>
                      <span class="dimtxt">removed from the stack; kept as is.</span>
                    </Show>
                    <Show when={(r.upstreamCount ?? 0) > 0}>
                      <span>{r.upstreamCount} file{r.upstreamCount === 1 ? '' : 's'} changed upstream.</span>
                    </Show>
                    <Show when={r.local.length}>
                      <span class="dimtxt">edited here: {r.local.join(', ')}</span>
                    </Show>
                    <span class="acts">
                      <Show when={!r.gone && (r.upstreamCount ?? 0) > 0}>
                        <button class="btn" disabled={!!pending()} onClick={() => void run(`update ${r.id}`, 'update', [r.id])}>
                          update
                        </button>{' '}
                      </Show>
                      <button class="btn danger" disabled={!!pending()} onClick={() => void run(`remove ${r.id}`, 'remove', [r.id])}>
                        remove
                      </button>
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={anyUpdate()}>
          <p>
            <button class="btn" disabled={!!pending()} onClick={() => void run('update all', 'update', [])}>
              {pending() ? 'working' : 'update all'}
            </button>
          </p>
        </Show>

        <h2>sync</h2>
        <p class="dimtxt">
          imported files missing (fresh clone, wiped dir)? sync restores them from stack.toml. it never
          touches your edits.
        </p>
        <Show when={anyEdited()}>
          <p class="dimtxt">some rows differ from stack.toml — if files are missing rather than edited, sync brings them back.</p>
        </Show>
        <p>
          <button class="btn" disabled={!!pending()} onClick={() => void run('sync', 'sync', [])}>
            {pending() ? 'working' : 'sync missing files'}
          </button>
        </p>

        <h2>adopt</h2>
        <p class="dimtxt">
          a folder that looks like a stack entry but was never imported? name it: identical files
          join stack.toml, differing files are listed and nothing is written.
        </p>
        <p>
          <input
            type="text"
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
            class="btn"
            disabled={!!pending() || !adoptId().trim()}
            onClick={() => {
              const t = adoptTo().trim();
              const id = adoptId().trim();
              void run(`adopt ${id}`, 'import', t ? [id, '--to', t] : [id]);
            }}
          >
            adopt
          </button>
        </p>
        <Show when={lookalikes().length > 0}>
          <p class="conflict" role="alert">
            untracked look-alike — nothing was written. move these aside, or adopt with --to:
          </p>
          <pre class="raw">{lookalikes().join('\n')}</pre>
        </Show>

        <Show when={failed() && !lookalikes().length}>
          <CliErr text={failed() as string} />
        </Show>
        <Show when={sections()}>
          <OpResult sections={sections() as OpSection[]} label={logLabel()} />
        </Show>
      </Show>
    </div>
  );
}
