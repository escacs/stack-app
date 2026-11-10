// Worker picker: data-driven from `list worker` (names are never hardcoded),
// remembered in config, plus "import this profile into the project".
import { For, Show, createSignal } from 'solid-js';
import { errText, stackRun } from '../bridge';
import { href } from '../router';
import {
  describeImport,
  entryMarkers,
  fromStackOut,
  type ImportJson,
  type OpSection,
} from '../json';
import { config, lock, refreshLock, refreshWorkers, chooseWorker, workerName, workers, workersError, workersUncommitted } from '../store';
import { CliErr, OpResult, Empty, Markers } from '../ui';

export default function Worker(props: { scenario: string }) {
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const importedIds = () => new Set(lock().rows.map((r) => r.id));

  async function importProfile(id: string) {
    const c = config();
    if (!c?.project) return;
    setPending(true);
    setSections(null);
    setFailed(null);
    try {
      const out = await stackRun('import', [id, '--json'], c.project, c.stackPath);
      setSections(describeImport(fromStackOut<ImportJson>(out)));
      await refreshLock();
    } catch (err) {
      setFailed(errText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <p class="lede">who is driving. the profile is remembered; import it into a project so agents read it.</p>
      <Show when={workersError()}>
        <p class="conflict" role="alert">{workersError()}</p>
      </Show>
      <Show when={workers().length} fallback={<Empty>(._.) no workers in this stack</Empty>}>
        <div class="rows">
          <For each={workers()}>
            {(w) => {
              const m = () => entryMarkers(w, workersUncommitted());
              return (
                <div class={`row pick ${workerName() === w.name ? 'cur' : ''}`}>
                  <button
                    class="btn"
                    disabled={pending() || workerName() === w.name}
                    onClick={() => void chooseWorker(w.name)}
                  >
                    {workerName() === w.name ? 'using' : 'use'}
                  </button>
                  <span class="nm" title={w.summary}>
                    {w.name}
                  </span>
                  <Markers notCommitted={m().notCommitted} uncommittedInStack={m().uncommittedInStack} />
                  <span class="lead" aria-hidden="true" />
                  <span class="dimtxt">{w.status ?? ''}</span>
                  <Show when={config()?.project}>
                    <Show
                      when={!importedIds().has(w.id)}
                      fallback={<span class="dimtxt">in project</span>}
                    >
                      <Show when={w.committed} fallback={<span class="dimtxt">not-committed</span>}>
                        <button class="btn" disabled={pending()} onClick={() => void importProfile(w.id)}>
                          import
                        </button>
                      </Show>
                    </Show>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <p class="dimtxt">
        {workers().length} worker{workers().length === 1 ? '' : 's'} from the stack.{' '}
        <button class="linklike" onClick={() => void refreshWorkers()}>refresh</button>
        {' · '}
        <Show when={config()?.project} fallback={<span>pick a <a href={href(props.scenario, 'project')}>project</a> to import into</span>}>
          <span>imports land in .stack/ as a tracked copy</span>
        </Show>
      </p>
      <Show when={failed()}>
        <CliErr text={failed() as string} />
      </Show>
      <Show when={sections()}>
        <OpResult sections={sections() as OpSection[]} label="import" />
      </Show>
    </div>
  );
}
