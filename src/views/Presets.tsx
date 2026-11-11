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
  presetCountText,
  presetImportsHint,
  presetListArgs,
  previewFresh,
  type OpSection,
  type PresetApplyJson,
  type PresetListItem,
  type PresetListJson,
} from '../json';
import { config, lock } from '../store';
import { CliErr, OpResult } from '../ui';

/** Busy key for one preset's apply, shared with the project page. */
export const presetKey = (name: string): string => `preset ${name}`;

type Loaded = { presets: PresetListItem[]; error: string | null };
type Preview = { name: string; sections: OpSection[]; error: string | null };

export function Presets(props: {
  pending: string | null;
  /** Op sequence from the project page, bumped on every op start. */
  opSeq: () => number;
  onApply: (name: string) => void;
}) {
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
  // Auto-imported dependencies named by each preset's last preview, so its
  // row agrees with the preview total ("2 imports, 1 new +1 dep").
  const [depCounts, setDepCounts] = createSignal<Record<string, number>>({});

  function clearPreview() {
    setPreview(null);
    setDepCounts({});
  }

  async function runPreview(name: string) {
    const c = config();
    if (!c?.project || props.pending || previewing()) return;
    // The request's sequence: an op starting mid-flight voids the answer,
    // which must be dropped on resolve instead of re-appearing stale.
    const seq = props.opSeq();
    setPreviewing(name);
    clearPreview();
    try {
      const out = await stackRun('preset', presetApplyArgs(name, true), c.project, c.stackPath);
      const json = fromStackOut<PresetApplyJson>(out);
      if (!previewFresh(seq, props.opSeq())) return;
      setDepCounts((m) => ({ ...m, [name]: json.imported.filter((p) => p.requiredBy).length }));
      setPreview({ name, sections: describePresetPreview(json), error: null });
    } catch (err) {
      if (!previewFresh(seq, props.opSeq())) return;
      setPreview({ name, sections: [], error: errText(err) });
    } finally {
      setPreviewing(null);
    }
  }

  // A preview names lock state: a new project, or any op starting, voids it.
  createEffect(
    on(source, () => clearPreview(), { defer: true }),
  );
  createEffect(
    on(
      () => props.pending,
      (p) => {
        if (p) clearPreview();
      },
      { defer: true },
    ),
  );

  const haveIds = () => new Set(lock().rows.map((r) => r.id));

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
                      <span class="dimtxt">{presetCountText(p.imports, haveIds(), depCounts()[p.name] ?? 0)}</span>
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
                          clearPreview();
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
