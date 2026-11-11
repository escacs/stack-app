// Presets: named import bundles. Each row shows its description, import
// counts against the lock, a preview button (a `preset apply --dry-run`
// that names what would land where and what is already imported), and an
// apply button. Apply goes through the project page's op runner (so its busy
// state and output are shared with the import rows); preview runs locally,
// since a dry run writes nothing. The list reloads when the project or the
// stack checkout changes, and not on unrelated config saves.
import { For, Show, createEffect, createResource, createSignal, on } from 'solid-js';
import { errText, stackRun } from '../bridge';
import {
  describePresetPreview,
  fromStackOut,
  presetApplyArgs,
  presetImportsHint,
  presetListArgs,
  type OpSection,
  type PresetApplyJson,
  type PresetImport,
  type PresetListItem,
  type PresetListJson,
} from '../json';
import { config, lock } from '../store';
import { CliErr, OpResult } from '../ui';

/** Busy key for one preset's apply, shared with the project page. */
export const presetKey = (name: string): string => `preset ${name}`;

type Loaded = { presets: PresetListItem[]; error: string | null };
type Preview = { name: string; sections: OpSection[]; error: string | null };

export function Presets(props: { pending: string | null; onApply: (name: string) => void }) {
  // A string key: a config save that leaves project and stack alone yields
  // the same key, so the resource does not refetch.
  const source = () => {
    const c = config();
    return c?.project ? `${c.project}\n${c.stackPath ?? ''}` : null;
  };
  const [loaded] = createResource(source, async (): Promise<Loaded> => {
    const c = config();
    if (!c?.project) return { presets: [], error: null };
    try {
      const out = await stackRun('preset', presetListArgs(), c.project, c.stackPath);
      return { presets: fromStackOut<PresetListJson>(out).presets, error: null };
    } catch (err) {
      return { presets: [], error: errText(err) };
    }
  });

  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [previewing, setPreviewing] = createSignal<string | null>(null);

  async function runPreview(name: string) {
    const c = config();
    if (!c?.project || props.pending || previewing()) return;
    setPreviewing(name);
    setPreview(null);
    try {
      const out = await stackRun('preset', presetApplyArgs(name, true), c.project, c.stackPath);
      setPreview({ name, sections: describePresetPreview(fromStackOut<PresetApplyJson>(out)), error: null });
    } catch (err) {
      setPreview({ name, sections: [], error: errText(err) });
    } finally {
      setPreviewing(null);
    }
  }

  // A preview names lock state: a new project, or any op starting, voids it.
  createEffect(
    on(source, () => setPreview(null), { defer: true }),
  );
  createEffect(
    on(
      () => props.pending,
      (p) => {
        if (p) setPreview(null);
      },
      { defer: true },
    ),
  );

  // "3 imports, 1 new" against the lock ("all here" when nothing is new).
  const counts = (imports: PresetImport[]): string => {
    const ids = new Set(lock().rows.map((r) => r.id));
    const fresh = imports.filter((i) => !ids.has(i.id)).length;
    const n = `${imports.length} import${imports.length === 1 ? '' : 's'}`;
    return fresh ? `${n}, ${fresh} new` : `${n}, all here`;
  };

  return (
    <Show when={loaded()}>
      {(l) => (
        <>
          <Show when={l().error}>{(e) => <CliErr text={e()} />}</Show>
          <Show when={l().presets.length}>
            <h2>presets</h2>
            <div class="rows">
              <For each={l().presets}>
                {(p) => (
                  <div>
                    <div class="row pick">
                      <span>{p.name}</span>
                      <span class="dimtxt">{p.description}</span>
                      <span class="lead" aria-hidden="true" />
                      <span class="dimtxt">{counts(p.imports)}</span>
                      <button
                        class="btn"
                        title={`dry run: what ${p.name} would import and what is already here (nothing is written)`}
                        disabled={!!props.pending || !!previewing()}
                        onClick={() => void runPreview(p.name)}
                      >
                        {previewing() === p.name ? 'working' : 'preview'}
                      </button>
                      <button
                        class="btn"
                        title={presetImportsHint(p.imports)}
                        disabled={!!props.pending || !!previewing()}
                        onClick={() => {
                          setPreview(null);
                          props.onApply(p.name);
                        }}
                      >
                        {props.pending === presetKey(p.name) ? 'working' : 'apply'}
                      </button>
                    </div>
                    <Show when={preview() && preview()?.name === p.name}>
                      <Show when={preview()?.error} fallback={<OpResult sections={(preview() as Preview).sections} label={`preview ${p.name}`} />}>
                        {(e) => <CliErr text={e()} />}
                      </Show>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </>
      )}
    </Show>
  );
}
