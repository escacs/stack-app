// Presets: named import bundles. The section is built for a long list: its
// heading carries the count, only a handful of rows show until `+N more`,
// past a few more a type-to-filter input joins the heading, and on a project
// that already has imports a long list starts folded to the heading. An open
// preview keeps its row visible whatever the filter or the cut. One line each: name, dim description
// (truncated, full text on hover), compact counts against the lock, then a
// preview toggle (a `preset apply --dry-run` that opens a tree of what would
// land where, right under its own row) and an apply button. Apply goes through the project page's op runner (so its busy
// state and output are shared with the import rows); preview runs locally,
// since a dry run writes nothing. The list reloads when the project or the
// stack checkout changes, and not on unrelated config saves.
import { For, Show, createEffect, createResource, createSignal, on } from 'solid-js';
import { errText, stackRun } from '../bridge';
import {
  describePresetPreview,
  fromStackOut,
  matchPresets,
  presetApplyArgs,
  PRESET_ROWS,
  presetCountText,
  presetCountTitle,
  presetImportsHint,
  presetListArgs,
  presetsFilterable,
  presetsStartOpen,
  previewFresh,
  visiblePresets,
  type PreviewLine,
  type PresetApplyJson,
  type PresetListItem,
  type PresetListJson,
} from '../json';
import { config, lock } from '../store';
import { CliErr } from '../ui';

/** Busy key for one preset's apply, shared with the project page. */
export const presetKey = (name: string): string => `preset ${name}`;

type Loaded = { presets: PresetListItem[]; error: string | null };
type Preview = { name: string; lines: PreviewLine[]; error: string | null };

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
  // row agrees with the preview total ("1 new · 1 dep").
  const [depCounts, setDepCounts] = createSignal<Record<string, number>>({});

  function clearPreview() {
    setPreview(null);
    setDepCounts({});
  }

  async function runPreview(name: string) {
    const c = config();
    if (!c?.project || props.pending || previewing()) return;
    // The toggle: a second click on the open preview folds it away.
    if (preview()?.name === name) {
      setPreview(null);
      return;
    }
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
      setPreview({ name, lines: describePresetPreview(json), error: null });
    } catch (err) {
      if (!previewFresh(seq, props.opSeq())) return;
      setPreview({ name, lines: [], error: errText(err) });
    } finally {
      setPreviewing(null);
    }
  }

  // Section view state: folded or open, the filter text, and whether the
  // `+N more` toggle has revealed everything. Until the user folds or opens
  // it by hand, the fold follows the list size and the project's imports
  // (the lock may land after the list). Starting an op freezes it as drawn,
  // so an apply that adds imports does not fold the list under the user.
  const [userOpen, setUserOpen] = createSignal<boolean | null>(null);
  const [query, setQuery] = createSignal('');
  const [all, setAll] = createSignal(false);
  const open = () =>
    userOpen() ?? presetsStartOpen(loaded()?.presets.length ?? 0, lock().rows.length);

  function toggleOpen() {
    const next = !open();
    setUserOpen(next);
    // A preview folded away with its row must not linger invisible.
    if (!next) setPreview(null);
  }

  // A preview names lock state: a new project, or any op starting, voids it.
  createEffect(
    on(source, () => {
      clearPreview();
      setQuery('');
      setAll(false);
      setUserOpen(null);
    }, { defer: true }),
  );
  createEffect(
    on(
      () => props.pending,
      (p) => {
        if (!p) return;
        clearPreview();
        if (userOpen() === null) setUserOpen(open());
      },
      { defer: true },
    ),
  );

  const haveIds = () => new Set(lock().rows.map((r) => r.id));
  const isOpen = (name: string) => preview()?.name === name;

  return (
    <Show when={loaded()}>
      {(l) => (
        <>
          <Show when={l().error}>{(e) => <CliErr text={e()} />}</Show>
          <Show when={l().presets.length}>
            {(_) => {
              const total = () => l().presets.length;
              const filterable = () => presetsFilterable(total());
              const foldable = () => total() > PRESET_ROWS;
              const view = () => visiblePresets(l().presets, query(), all(), preview()?.name ?? null);
              const matched = () => matchPresets(l().presets, query()).length;
              const filtering = () => query().trim() !== '';
              return (
                <>
                  <h2 class="phead">
                    <Show
                      when={foldable()}
                      fallback={
                        <>
                          <span>presets</span>
                          <span class="dimtxt n">{total()}</span>
                        </>
                      }
                    >
                      <button
                        type="button"
                        class="fold"
                        aria-expanded={open()}
                        title={open() ? 'fold the presets list to its heading' : 'show the presets list'}
                        onClick={toggleOpen}
                      >
                        presets{' '}
                        <span class="dimtxt n" title={`${total()} presets in the stack`}>
                          {open() && filtering() ? `${matched()}/${total()}` : total()}
                        </span>{' '}
                        <span class="dimtxt">· {open() ? 'collapse' : 'expand'}</span>
                      </button>
                    </Show>
                    <Show when={open() && filterable()}>
                      <input
                        type="text"
                        class="pfilter"
                        value={query()}
                        placeholder="filter…"
                        aria-label="filter presets by name or description"
                        size={22}
                        onInput={(e) => {
                          setQuery(e.currentTarget.value);
                          setAll(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Escape') return;
                          // First Esc clears the text, the next leaves the field.
                          if (query()) setQuery('');
                          else e.currentTarget.blur();
                          e.stopPropagation();
                        }}
                      />
                    </Show>
                  </h2>
                  <Show when={open()}>
                    <div
                      class="rows presets"
                      style={{ '--pw': `${Math.min(20, Math.max(...l().presets.map((p) => p.name.length)))}ch` }}
                    >
                      <For each={view().rows}>
                        {(p) => (
                          <div class="preset">
                            <div class="row pick">
                              <span class="nm" title={p.name}>{p.name}</span>
                              <span class="desc dimtxt" title={p.description}>{p.description}</span>
                              <span class="lead" aria-hidden="true" />
                              <span class="cnt dimtxt" title={presetCountTitle(p.imports, haveIds(), depCounts()[p.name] ?? 0)}>
                                {presetCountText(p.imports, haveIds(), depCounts()[p.name] ?? 0)}
                              </span>
                              <span class="acts">
                                <button
                                  class="btn fix"
                                  title={`dry run: what ${p.name} would import and what is already here (nothing is written)`}
                                  aria-expanded={isOpen(p.name)}
                                  disabled={!!props.pending || !!previewing()}
                                  onClick={() => void runPreview(p.name)}
                                >
                                  {previewing() === p.name ? 'working' : isOpen(p.name) ? 'hide' : 'preview'}
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
                              </span>
                            </div>
                            <Show when={isOpen(p.name)}>
                              <Show
                                when={preview()?.error}
                                fallback={<PreviewTree lines={(preview() as Preview).lines} />}
                              >
                                {(e) => <CliErr text={e()} />}
                              </Show>
                            </Show>
                          </div>
                        )}
                      </For>
                      <Show when={filtering() && matched() === 0}>
                        <p class="dimtxt none">no preset matches “{query().trim()}”</p>
                      </Show>
                      <Show when={view().hidden > 0}>
                        <button type="button" class="more" onClick={() => setAll(true)}>
                          +{view().hidden} more
                        </button>
                      </Show>
                      <Show when={all() && matched() > PRESET_ROWS}>
                        <button type="button" class="more" onClick={() => setAll(false)}>
                          − fewer
                        </button>
                      </Show>
                    </div>
                  </Show>
                </>
              );
            }}
          </Show>
        </>
      )}
    </Show>
  );
}

/** A preview as a small tree under its row: one line per entry. */
function PreviewTree(props: { lines: PreviewLine[] }) {
  return (
    <div class="pv" role="list">
      <For each={props.lines}>
        {(ln, i) => (
          <div class={`pl k-${ln.kind}`} role="listitem">
            <span class="br" aria-hidden="true">{i() === props.lines.length - 1 ? '└' : '├'}</span>
            <span class="pt" title={ln.title}>
              {ln.id}
              <Show when={ln.path}>
                <span class="dest">{ln.kind === 'note' ? ' · ' : ' → '}{ln.path}</span>
              </Show>
            </span>
            <Show when={ln.tag}>
              <span class="lead" aria-hidden="true" />
              <span class="ptag" title={ln.title}>{ln.tag}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
