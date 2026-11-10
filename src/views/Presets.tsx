// Presets: named import bundles. Apply goes through the installed view's op
// runner (so its busy state and output are shared with the import rows); this
// component only lists them. The list reloads when the project or the stack
// checkout changes, and not on unrelated config saves.
import { For, Show, createResource } from 'solid-js';
import { errText, stackRun } from '../bridge';
import {
  fromStackOut,
  presetImportsHint,
  presetListArgs,
  type PresetListItem,
  type PresetListJson,
} from '../json';
import { config } from '../store';
import { CliErr } from '../ui';

/** Busy key for one preset's apply, shared with the installed view. */
export const presetKey = (name: string): string => `preset ${name}`;

type Loaded = { presets: PresetListItem[]; error: string | null };

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
                  <div class="row pick">
                    <span>{p.name}</span>
                    <span class="dimtxt">{p.description}</span>
                    <span class="lead" aria-hidden="true" />
                    <button
                      class="btn"
                      title={presetImportsHint(p.imports)}
                      disabled={!!props.pending}
                      onClick={() => props.onApply(p.name)}
                    >
                      {props.pending === presetKey(p.name) ? 'working' : 'apply'}
                    </button>
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
