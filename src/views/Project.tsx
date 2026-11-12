// Project page: everything about the open project — the set-up slot, this
// project's imports (update, remove, sync, adopt), then presets. App-wide
// state (app version, updater) lives in the footer line, not here. One
// op runs at a time; the lock is re-read after every op, failed or not, so
// the rows never lag what the CLI last did. Update merges or leaves
// <<<<<<< markers, remove keeps edited files, sync only restores missing
// files, adopt never overwrites.
import { For, Show, createEffect, createMemo, createSignal, on, onMount, untrack } from 'solid-js';
import { errText, projectFolders, stackRun, type StackOut } from '../bridge';
import {
  adoptArgs,
  adoptCountText,
  adoptDryRunArgs,
  conflictsFor,
  matchAdoptCandidates,
  type AdoptCandidate,
} from '../adopt';
import { catalogs, sourceKey, type CatalogData } from '../browseData';
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
  type ImportDryRunJson,
  type ImportJson,
  type InitJson,
  type JsonEntry,
  type ListJson,
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

export default function Project(props: { scenario: string }) {
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [logLabel, setLogLabel] = createSignal('');
  const [pending, setPending] = createSignal<string | null>(null);
  // Op sequence, bumped on every op start: a preset preview that resolves
  // after the bump names pre-op lock state and must be dropped, not shown.
  const [opSeq, setOpSeq] = createSignal(0);
  const [lookalikes, setLookalikes] = createSignal<string[]>([]);
  const [otherOpen, setOtherOpen] = createSignal(false);
  const [otherId, setOtherId] = createSignal('');
  const [otherTo, setOtherTo] = createSignal('');
  let otherRef: HTMLInputElement | undefined;
  // Adopt suggestions: the catalog plus the project's folders, matched by
  // name (see adopt.ts). Hints arrive later, one dry run per candidate.
  const [entries, setEntries] = createSignal<JsonEntry[]>([]);
  const [folders, setFolders] = createSignal<string[]>([]);
  const [hints, setHints] = createSignal<Record<string, 'identical' | 'differs'>>({});
  let adoptGen = 0;
  let hintGen = 0;
  let hintedKey = '';

  onMount(() => void refreshLock());

  // Output and adopt fields belong to the project they ran against.
  createEffect(
    on(
      () => config()?.project ?? null,
      () => {
        clearOutput();
        setOtherOpen(false);
        setOtherId('');
        setOtherTo('');
        setEntries([]);
        setFolders([]);
        setHints({});
        hintedKey = '';
      },
      { defer: true },
    ),
  );

  const candidates = createMemo((): AdoptCandidate[] => {
    const ids = new Set(lock().rows.map((r) => r.id));
    return matchAdoptCandidates(folders(), entries(), ids);
  });
  const candidatesKey = createMemo(() =>
    candidates()
      .map((c) => `${c.folder}|${c.id}|${c.to ?? ''}`)
      .join('\n'),
  );
  // Manual-form autocomplete: committed entries this project never imported.
  const suggestIds = createMemo(() => {
    const ids = new Set(lock().rows.map((r) => r.id));
    return entries()
      .filter((e) => e.committed && !ids.has(e.id))
      .map((e) => e.id);
  });

  // Stale-while-revalidate catalog (shared with Browse through `catalogs`)
  // plus a fresh folder listing; a failure just means no suggestions.
  async function loadAdopt(): Promise<void> {
    const c = config();
    const proj = c?.project ?? null;
    if (!proj) return;
    const key = sourceKey(c);
    const gen = ++adoptGen;
    const cached = catalogs.get(key);
    setEntries(cached?.entries ?? []);
    setFolders([]);
    setHints({});
    hintedKey = '';
    const foldersP = projectFolders(proj).then(
      (r) => r.folders,
      () => [] as string[],
    );
    const listP = stackRun('list', ['--json'], proj, c?.stackPath).then(
      (out) => out,
      () => null,
    );
    const [found, out] = await Promise.all([foldersP, listP]);
    if (gen !== adoptGen) return;
    setFolders(found);
    if (out && !(cached && cached.raw === out.stdout)) {
      try {
        const data = fromStackOut<ListJson>(out);
        const next: CatalogData = {
          raw: out.stdout,
          entries: data.entries,
          uncommitted: new Set<string>(data.uncommitted ?? []),
        };
        catalogs.set(key, next);
        setEntries(next.entries);
      } catch {
        // Keep the cached (or empty) catalog: the page works without hints.
      }
    }
  }

  // One dry run per candidate: collisions under its destination mean its
  // files differ, none mean they match the stack entry. Skipped while an op
  // runs; the lock refresh after it re-triggers this through candidatesKey.
  async function loadHints(key: string, busy: string | null): Promise<void> {
    if (busy || !key || key === hintedKey) return;
    const gen = ++hintGen;
    const c = config();
    if (!c?.project) return;
    const proj = c.project;
    const stackPath = c.stackPath;
    const found: Record<string, 'identical' | 'differs'> = {};
    await Promise.all(
      candidates().map(async (cand) => {
        try {
          const out = await stackRun('import', adoptDryRunArgs(cand), proj, stackPath);
          const data = fromStackOut<ImportDryRunJson>(out);
          const mine = conflictsFor(data.conflicts ?? [], cand.to ?? cand.folder);
          found[cand.id] = mine.length ? 'differs' : 'identical';
        } catch {
          // No hint for this one; the adopt button still works.
        }
      }),
    );
    if (gen !== hintGen) return;
    hintedKey = key;
    setHints(found);
  }

  // Suggestions load for this source; a project or stack switch reloads.
  createEffect(() => {
    sourceKey(config());
    untrack(() => void loadAdopt());
  });

  createEffect(() => {
    const key = candidatesKey();
    const busy = pending();
    untrack(() => void loadHints(key, busy));
  });

  function clearOutput() {
    setSections(null);
    setFailed(null);
    setLookalikes([]);
    setLogLabel('');
  }

  async function run(op: Op): Promise<boolean> {
    const c = config();
    if (!c?.project || pending()) return false;
    setPending(op.key);
    setOpSeq((n) => n + 1);
    clearOutput();
    try {
      const out = await stackRun(op.sub, op.args, c.project, c.stackPath);
      setLogLabel(op.label);
      setSections(op.describe(out));
      return true;
    } catch (err) {
      const text = errText(err);
      setLogLabel(op.label);
      setFailed(text);
      // Preset apply runs through the same import plan as import, so its
      // collisions print the same "already exist with other content" text.
      if (op.sub === 'import' || op.sub === 'preset') setLookalikes(refusalFiles(text));
      return false;
    } finally {
      await refreshLock();
      // Import, adopt (an import) and preset apply create stack.toml
      // implicitly, so the set-up slot must re-check after them, not just
      // after init.
      if (op.sub === 'init' || op.sub === 'import' || op.sub === 'preset') await refreshReport();
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

  function toggleOther() {
    const open = !otherOpen();
    setOtherOpen(open);
    if (open) queueMicrotask(() => otherRef?.focus());
  }

  function submitOther() {
    const id = otherId().trim();
    if (!id || pending()) return;
    // On success the form closes cleared, leaving the shared output above;
    // on failure it stays open so the id can be fixed and retried.
    void run({
      key: 'adopt',
      label: `adopt ${id}`,
      sub: 'import',
      args: importArgs(id, otherTo()),
      describe: decode<ImportJson>(describeImport),
    }).then((ok) => {
      if (ok) {
        setOtherId('');
        setOtherTo('');
        setOtherOpen(false);
      }
    });
  }

  function adoptCandidate(c: AdoptCandidate) {
    if (pending()) return;
    // The destination is implied by the folder; a differing candidate shows
    // the same look-alike refusal as a manual adopt.
    void run({
      key: `adopt ${c.id}`,
      label: `adopt ${c.id}`,
      sub: 'import',
      args: adoptArgs(c),
      describe: decode<ImportJson>(describeImport),
    });
  }

  return (
    <div class="project">
      <Show when={report()?.errors?.[0]}>
        {(e) => <p class="conflict" role="alert">{e()}</p>}
      </Show>
      <Show when={config()?.project} fallback={<Empty>(._.) no project</Empty>}>
        <Show when={lockError()}>
          {(e) => <CliErr text={e()} />}
        </Show>
        {/*
          Set-up slot: one line, no heading, so it sits in the normal section
          rhythm. Until per-worker setup lands (part B of #1, waiting on
          escacs/stack#14 worker preselect and #15 `init --worker`), a project
          without stack.toml gets the plain init action here, at the top; the
          explanation lives in its tooltip. Part B replaces the button with:
          working-as pick, start-from preset choice, preview, then
          `init --worker`.
        */}
        <Show when={needsInit()}>
          <div class="setup">
            <button
              class="btn"
              title="no stack.toml here yet: init creates it so imports have somewhere to live. Also adds the managed .gitignore block and migrates a legacy stack.lock.json"
              disabled={!!pending()}
              onClick={() => void run(init)}
            >
              {busyText('init', 'init stack.toml')}
            </button>
          </div>
        </Show>
        {/*
          Adopt sits next to the set-up slot: both are about things not in
          stack.toml yet. With candidates, one line each with its adopt
          button; with none, only the quiet other… link for the manual case.
        */}
        <div class="adopt-block">
          <Show when={candidates().length}>
            <p
              class="dimtxt found"
              title="these folders look like stack entries that were never imported: adopting records identical files in stack.toml, and lists differing files without writing anything"
            >
              found in project: {adoptCountText(candidates().length)}
            </p>
            <div class="adopt-list">
              <For each={candidates()}>
                {(c) => (
                  <div class="adopt-row">
                    <span title={c.to ? `adopts into ${c.to}` : 'adopts into its default place'}>
                      {c.folder} → {c.id}
                    </span>
                    <Show when={hints()[c.id]}>
                      <span class="dimtxt">({hints()[c.id]})</span>
                    </Show>
                    <button
                      class="btn"
                      title={
                        hints()[c.id] === 'differs'
                          ? 'the files differ, so this lists them and writes nothing'
                          : 'records these files in stack.toml without changing them'
                      }
                      disabled={!!pending()}
                      onClick={() => adoptCandidate(c)}
                    >
                      {busyText(`adopt ${c.id}`, 'adopt')}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <button
            class="linklike"
            title="adopt a folder the list missed: name the entry and the folder by hand"
            aria-expanded={otherOpen()}
            onClick={toggleOther}
          >
            other…
          </button>
          <Show when={otherOpen()}>
            <form
              class="adopt"
              onSubmit={(e) => {
                e.preventDefault();
                submitOther();
              }}
            >
              <input
                type="text"
                ref={(el) => (otherRef = el)}
                value={otherId()}
                onInput={(e) => setOtherId(e.currentTarget.value)}
                placeholder="entry id, e.g. skills/file-pr"
                aria-label="entry id to adopt"
                list="adopt-id-list"
                size={30}
              />
              <datalist id="adopt-id-list">
                <For each={suggestIds()}>{(id) => <option value={id} />}</For>
              </datalist>
              <input
                type="text"
                value={otherTo()}
                onInput={(e) => setOtherTo(e.currentTarget.value)}
                placeholder="folder in this project (optional)"
                aria-label="folder in this project"
                size={30}
              />
              <button
                type="submit"
                class="btn"
                disabled={!!pending() || !otherId().trim()}
              >
                {busyText('adopt', 'adopt')}
              </button>
            </form>
          </Show>
        </div>
        <Show when={lock().rows.length} fallback={<Show when={!lockError() && !needsInit()}><Empty>(._.) nothing imported</Empty></Show>}>
          <h2>imports</h2>
          <div class="rows">
            <For each={lock().rows}>
              {(r) => {
                const upstream = r.upstreamCount ?? 0;
                const canUpdate = !r.gone && upstream > 0;
                const where = `@${r.commit.slice(0, 7)} → ${r.path}`;
                return (
                  <div class="statusrow">
                    <div class="row">
                      <Chip state={rowState(r)} />
                      <a class="nm" href={href(props.scenario, 'browse', r.id)} title={r.id}>
                        {r.id}
                      </a>
                      <span class="lead" aria-hidden="true" />
                      <span class="meta dimtxt" title={where}>{where}</span>
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
                    <Show when={r.gone || canUpdate || r.local.length}>
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
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>

        <div class="tools">
          <Show when={lock().rows.length}>
            <Show when={countUpdates(lock().rows) > 0}>
              <button class="btn" disabled={!!pending()} onClick={() => void run(updateAll)}>
                {busyText('update all', 'update all')}
              </button>
            </Show>
            <button
              class="btn"
              title="restores imported files that are missing, from stack.toml; edits are never touched"
              disabled={!!pending()}
              onClick={() => void run(sync)}
            >
              {busyText('sync', 'sync')}
            </button>
          </Show>
          <Show when={lock().rows.length && lock().commit}>
            <span class="dimtxt rev" title="stack commit the lock was last synced to">@{(lock().commit ?? '').slice(0, 7)}</span>
          </Show>
        </div>

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

        <Presets pending={pending()} opSeq={opSeq} onApply={(name) => void run(preset(name))} />
      </Show>
    </div>
  );
}
