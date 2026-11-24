// The Browse preview pane: the entry card (breadcrumb, title, description,
// Overview / Files tabs, facts, the entry doc excerpt) with the T3 tray pinned
// to the bottom and Preview plan / Import top right. It follows the list
// cursor without navigating. An import plan, when one is open, replaces the
// facts under the header (single entry) or the whole card (batch).
import type { JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { errText, stackRun, type AppConfig } from '../bridge';
import { fmtBytes, pluralOf, rowState } from '../parse';
import {
  fromStackOut,
  destLabel,
  resolveDestination,
  showFileArgs,
  toShowDoc,
  toShowFile,
  type JsonEntry,
  type ShowFileJson,
  type ShowJson,
} from '../json';
import { previewCache, previewKey, type CatalogIndex } from '../browseData';
import { config, lock, switchTargetDir } from '../store';
import { fileCountLabel } from '../plan';
import { t3Info, worktreeLabel } from '../t3';
import { Alert, Badge, Button, CliErr, Empty, LinkButton, Picker } from '../ui';
import { LABEL } from '../vocab';
import { Icon } from '../icons';
import { Face, FileTree, IMG_RE, Markdown, Sprite, mimeFor } from '../site';
import { href } from '../router';
import { T3Inject } from './T3Inject';

type Doc = ReturnType<typeof toShowDoc>;
type FileBody = ReturnType<typeof toShowFile>;

/** Image bytes as a data URL for a preview; undefined when the fetch failed. */
async function fetchImageUrl(c: AppConfig | null, id: string, file: string): Promise<string | null | undefined> {
  try {
    const out = await stackRun('show', showFileArgs(id, file), c?.project ?? '.', c?.stackPath);
    const b = toShowFile(fromStackOut<ShowFileJson>(out));
    return b.base64 ? `data:${mimeFor(file)};base64,${b.base64}` : null;
  } catch {
    return undefined;
  }
}

async function showFile(c: AppConfig | null, id: string, file: string): Promise<FileBody> {
  const out = await stackRun('show', showFileArgs(id, file), c?.project ?? '.', c?.stackPath);
  return toShowFile(fromStackOut<ShowFileJson>(out));
}

export function EntryPreview(props: {
  scenario: string;
  /** The open entry. */
  entry: JsonEntry;
  /** The route's open file, for the entry the route names. */
  file: string | null;
  /** project + stack checkout key: a change here refetches. */
  source: string;
  entries: JsonEntry[];
  index: CatalogIndex;
  entryHref: (id: string) => string;
  fileHref: (id: string, file: string) => string;
  /** Another operation is running. */
  busy: boolean;
  narrow: boolean;
  /** Narrow: the detail fills the sheet and this returns to the list. */
  onBack: () => void;
  /** Close the detail (the list goes full width again). */
  onClose: () => void;
  onPlan: (e: JsonEntry) => void;
  onImported: () => void;
  /** The open plan for this entry, shown under the header. */
  entryPlan: JSX.Element | null;
}) {
  const [doc, setDoc] = createSignal<Doc | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [fileBody, setFileBody] = createSignal<FileBody | null>(null);
  const [fileNote, setFileNote] = createSignal<string | null>(null);
  const [previews, setPreviews] = createSignal<{ path: string; url: string }[]>([]);
  const [tab, setTab] = createSignal<'overview' | 'files'>('overview');
  let docGen = 0;
  let bodyGen = 0;

  const id = () => props.entry?.id ?? '';
  const e = () => props.entry;
  const locked = createMemo(() => lock().rows.find((r) => r.id === id()) ?? null);
  const citedBy = (): string[] => props.index.citedBy.get(id()) ?? [];
  const linked = (ids: string[] | undefined): string[] => (ids ?? []).filter((x) => props.index.byId.has(x));
  const bodyPath = createMemo(() => props.file ?? e()?.doc.slice(id().length + 1) ?? null);
  const upstream = createMemo(() => {
    const s = doc()?.manifest['source'];
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
  });
  const upstreamUrl = (): string | null => {
    const u = upstream()?.['url'];
    return typeof u === 'string' ? u : null;
  };
  const targetBranch = (): string => t3Info()?.worktrees.find((w) => w.isCurrent)?.branch ?? 'project';
  const worktrees = () => t3Info()?.worktrees ?? [];
  /** Where an import lands: a plain text with one worktree, a ghost picker with several. */
  const installInto = (): JSX.Element => (
    <Show when={worktrees().length > 1} fallback={<span>{LABEL.importInto(targetBranch())}</span>}>
      <Picker
        variant="ghost"
        placement="down"
        label="Import target"
        prefix="Import into"
        title="Choose the worktree this import lands in"
        value={worktrees().find((w) => w.isCurrent)?.path ?? ''}
        options={worktrees().map((w) => ({ value: w.path, label: w.branch ?? worktreeLabel(w), title: w.path }))}
        onChange={(p) => void switchTargetDir(p)}
      />
    </Show>
  );
  const showFiles = () => tab() === 'files' || props.file !== null;
  /** The link names a file the entry does not have (the doc has loaded and does not list it). */
  const fileMissing = (): string | null => {
    const f = props.file;
    const d = doc();
    return f && d && !d.files.some((x) => x.path === f) ? f : null;
  };

  createEffect(on([id, () => props.file], ([, f]) => setTab(f ? 'files' : 'overview')));

  // The doc and its image previews: only for this id and source, never for config edits.
  createEffect(
    on([id, () => props.source], ([entryId, source]) => {
      const c = config();
      const gen = ++docGen;
      setDoc(null);
      setError(null);
      setPreviews([]);
      if (!entryId) return;
      stackRun('show', [entryId, '--json'], c?.project ?? '.', c?.stackPath).then(
        (out) => {
          if (gen !== docGen) return;
          try {
            const d = toShowDoc(fromStackOut<ShowJson>(out));
            setDoc(d);
            const imgs = d.files.filter((f) => IMG_RE.test(f.path)).slice(0, 4);
            void Promise.all(
              imgs.map((f) =>
                previewCache
                  .load(previewKey(source, entryId, f.path), () => fetchImageUrl(c, entryId, f.path), () => gen === docGen)
                  .then((url) => (url ? { path: f.path, url } : null)),
              ),
            ).then((got) => {
              if (gen === docGen) setPreviews(got.filter((g): g is { path: string; url: string } => g !== null));
            });
          } catch (err) {
            setError(errText(err));
          }
        },
        (err) => {
          if (gen === docGen) setError(errText(err));
        },
      );
    }),
  );

  createEffect(
    on([bodyPath, id, () => props.source], ([p, entryId]) => {
      const gen = ++bodyGen;
      setFileBody(null);
      setFileNote(null);
      if (!p || !entryId) return;
      showFile(config(), entryId, p).then(
        (b) => {
          if (gen === bodyGen) setFileBody(b);
        },
        (err) => {
          if (gen === bodyGen) setFileNote(errText(err));
        },
      );
    }),
  );

  const factsRow = (label: string, body: JSX.Element, wide = false) => (
    <div class={`fact${wide ? ' fact--wide' : ''}`}>
      <div class="fact__label">{label}</div>
      <div class="fact__value">{body}</div>
    </div>
  );

  const fileView = (b: FileBody) => (
    <FileView body={b} entries={props.entries} entryId={id()} entryHref={props.entryHref} fileHref={props.fileHref} />
  );

  return (
    <section id="entry-preview" class="epv" tabindex="-1" aria-label="Entry details" data-lenis-prevent="">
      <div class="epv__scroll">
        <Show
          when={props.narrow}
          fallback={
            <div class="epv__bar">
              <Button size="sm" variant="ghost" class="epv__close" title="Close the details (Esc)" onClick={() => props.onClose()}>
                <Icon name="x" size={14} /> Close
              </Button>
            </div>
          }
        >
          <button type="button" class="epv__back" onClick={() => props.onBack()}>
            <Icon name="chevronDown" size={14} class="epv__back-icon" /> Back to list
          </button>
        </Show>
        <Show when={e()}>
          <Show when={true}>
            <Show when={error()}>{(msg) => <CliErr text={msg()} />}</Show>
            <Show when={!doc() && !error()}>
              <div class="epv__loading" role="status" aria-label={`Loading ${e()?.name ?? 'entry'}`}>
                <span class="skel skel--title" />
                <span class="skel skel--line" />
                <span class="skel skel--line skel--short" />
              </div>
            </Show>
            <Show when={doc()}>
              {(d) => {
                const size = d().files.reduce((a, f) => a + f.size, 0);
                const available = () => !locked() && d().committed;
                return (
                  <>
                    <header class="doc-head epv__head">
                      <div class="doc-head__main">
                        <div class="doc-crumb">
                          <a href={href(props.scenario, 'browse', pluralOf(e()?.kind ?? ''))}>{pluralOf(e()?.kind ?? '').replace(/^./, (c) => c.toUpperCase())}</a>
                          <span>·</span>
                          <span>{fileCountLabel(d().files.length)}</span>
                          <Show when={!locked()}>
                            <span>·</span>
                            {installInto()}
                          </Show>
                        </div>
                        <h1 class="doc-title" id="stack-entry">
                          <Sprite kind={e()?.kind ?? ''} origin={e()?.origin ?? ''} />
                          <span>{e()?.name ?? id()}</span>
                          <Face status={e()?.status ?? ''} />
                        </h1>
                        <Show when={e()?.summary}>
                          <p class="doc-lead">{e()?.summary}</p>
                        </Show>
                      </div>
                      <div class="doc-actions">
                        <Show when={true}>
                            <Show
                              when={available()}
                              fallback={
                                <Show when={locked()}>
                                  {(l) => (
                                    <>
                                      <Badge tone="success" title={`Already imported in this project at ${destLabel(l().path)}`}>
                                        Imported ✓
                                      </Badge>
                                      <LinkButton class="epv__inproject" href={href(props.scenario, 'project', ...id().split('/'))}>
                                        {rowState(l()) === 'update' ? 'Update available · View in Project' : 'View in Project'}
                                      </LinkButton>
                                    </>
                                  )}
                                </Show>
                              }
                            >
                              <Button disabled={props.busy} onClick={() => props.onPlan(e() as JsonEntry)} title="See the files this import would write, without writing anything">
                                {LABEL.previewPlan}
                              </Button>
                              <Button variant="obsidian" disabled={props.busy} onClick={() => props.onPlan(e() as JsonEntry)}>
                                {props.busy ? 'Working…' : LABEL.importAction}
                              </Button>
                            </Show>
                        </Show>
                      </div>
                      <Show when={!props.entryPlan}>
                        <div class="sub-bar epv__subbar">
                          <div class="sa-segmented-control sa-segmented-control--sub" role="group" aria-label="entry sections">
                            <button type="button" class="sa-segmented-control__item" aria-pressed={!showFiles()} data-checked={!showFiles() ? '' : undefined} onClick={() => setTab('overview')}>
                              Overview
                            </button>
                            <button type="button" class="sa-segmented-control__item" aria-pressed={showFiles()} data-checked={showFiles() ? '' : undefined} onClick={() => setTab('files')}>
                              Files ({d().files.length})
                            </button>
                          </div>
                        </div>
                      </Show>
                    </header>

                    <Show when={!d().committed}>
                      <Alert tone="error">Not in the stack, so it can't be imported</Alert>
                    </Show>

                    <Show
                      when={!props.entryPlan}
                      fallback={props.entryPlan}
                    >
                      <Show when={!showFiles()}>
                        <div class="facts">
                          <Show
                            when={available()}
                            fallback={<Show when={locked()}>{(l) => factsRow('Destination', <span class="fact__dest" title={l().path}>{destLabel(l().path)}</span>, true)}</Show>}
                          >
                            {factsRow('Destination', <span class="fact__dest" title="the import plan lets you pick another folder">{e() ? resolveDestination(e() as JsonEntry).label : ''}</span>, true)}
                          </Show>
                          <Show when={e()?.targets?.length}>{factsRow('Targets', (e()?.targets ?? []).join(' · '))}</Show>
                          <Show when={e()?.tags?.length}>
                            {factsRow('Tags', <div class="chips"><For each={e()?.tags ?? []}>{(t) => <span>{t}</span>}</For></div>)}
                          </Show>
                          <Show when={linked(e()?.requires).length}>
                            {factsRow('Requires', <div class="rlinks"><For each={linked(e()?.requires)}>{(r) => <a href={props.entryHref(r)}>{props.index.byId.get(r)?.name ?? r}</a>}</For></div>)}
                          </Show>
                          <Show when={linked(e()?.related).length}>
                            {factsRow('Related', <div class="rlinks"><For each={linked(e()?.related)}>{(r) => <a href={props.entryHref(r)}>{props.index.byId.get(r)?.name ?? r}</a>}</For></div>)}
                          </Show>
                          <Show when={citedBy().length}>
                            {factsRow('Cited by', <div class="rlinks"><For each={citedBy()}>{(r) => <a href={props.entryHref(r)}>{props.index.byId.get(r)?.name ?? r}</a>}</For></div>)}
                          </Show>
                          <Show when={upstream()}>
                            {factsRow(
                              'Upstream',
                              <>
                                <Show when={upstreamUrl() && /^https?:/.test(upstreamUrl() as string)} fallback={upstreamUrl() ?? ''}>
                                  <a href={upstreamUrl() as string} target="_blank" rel="noopener noreferrer">
                                    {(upstreamUrl() as string).replace(/^https?:\/\/(www\.)?/, '')}
                                  </a>
                                </Show>
                                <Show when={typeof upstream()?.['ref'] === 'string'}>
                                  <span class="dim">{` @ ${String(upstream()?.['ref']).slice(0, 7)}`}</span>
                                </Show>
                                <Show when={typeof upstream()?.['license'] === 'string'}>
                                  <span class="dim">{` ${upstream()?.['license']}`}</span>
                                </Show>
                                <Show when={upstream()?.['modified']}>
                                  <span class="dim"> modified</span>
                                </Show>
                              </>,
                            )}
                          </Show>
                        </div>
                        <Show when={bodyPath()}>
                          {(p) => (
                            <div class="doc-preview">
                              <p class="doc-preview__file">{p()}</p>
                              <Show when={fileNote()}>{(msg) => <CliErr text={msg()} />}</Show>
                              <Show when={fileBody()}>{(b) => fileView(b())}</Show>
                            </div>
                          )}
                        </Show>
                      </Show>

                      <Show when={showFiles()}>
                        <Show when={previews().length}>
                          <div>
                            <h2>preview</h2>
                            <div class="previews">
                              <For each={previews()}>
                                {(p) => (
                                  <a href={props.fileHref(id(), p.path)}>
                                    <img src={p.url} alt={p.path} />
                                  </a>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                        <p class="epv__filemeta">{fileCountLabel(d().files.length)} · {fmtBytes(size)}<Show when={d().usage}> · {d().usage}</Show></p>
                        <h2>files</h2>
                        <Show when={d().files.length} fallback={<Empty>No files.</Empty>}>
                          <FileTree
                            files={d().files}
                            name={e()?.name ?? id()}
                            cur={bodyPath()}
                            sel={-1}
                            selBase={0}
                            fileHref={(p) => props.fileHref(id(), p)}
                            fmtSize={fmtBytes}
                          />
                        </Show>
                        <Show
                          when={fileMissing()}
                          fallback={
                            <Show when={bodyPath()}>
                              {(p) => (
                                <>
                                  <h2>{p()}</h2>
                                  <Show when={fileNote()}>{(msg) => <CliErr text={msg()} />}</Show>
                                  <Show when={fileBody()}>{(b) => fileView(b())}</Show>
                                </>
                              )}
                            </Show>
                          }
                        >
                          {(f) => (
                            <Alert tone="info">
                              <b>{f()}</b> is not a file in {e()?.name ?? id()}. Pick one from the list above, or{' '}
                              <a href={props.entryHref(id())}>open the overview</a>.
                            </Alert>
                          )}
                        </Show>
                      </Show>
                    </Show>
                  </>
                );
              }}
            </Show>
          </Show>
        </Show>
      </div>
      {/* The T3 tray needs an importable entry: one that is in the stack. */}
      <Show when={e() && doc()?.committed}>
        <div class="epv__foot">
          <T3Inject entry={e()} id={id()} committed={doc()?.committed ?? false} docText={doc()?.docBody || null} onImported={() => props.onImported()} />
        </div>
      </Show>
    </section>
  );
}

function FileView(props: {
  body: FileBody;
  entries: JsonEntry[];
  entryId: string;
  entryHref: (id: string) => string;
  fileHref: (id: string, file: string) => string;
}) {
  const b = () => props.body;
  return (
    <Show
      when={!b().base64}
      fallback={
        <div class="preview">
          <img src={`data:${mimeFor(b().file)};base64,${b().base64}`} alt={b().file} />
        </div>
      }
    >
      <Show when={!b().binary} fallback={<Empty>binary {fmtBytes(b().size)} — open it from the checkout.</Empty>}>
        <Show when={b().markdown} fallback={<pre class="raw">{b().text}</pre>}>
          <Markdown
            text={b().text}
            entryId={props.entryId}
            file={b().file}
            entries={props.entries}
            entryHref={props.entryHref}
            fileHref={props.fileHref}
          />
        </Show>
      </Show>
    </Show>
  );
}
