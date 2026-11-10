// Browse + import, ported from the website's browse (stack/web/app.js): kind
// rows with ascii bars, entry rows with dotted leaders, search, file tree
// and rendered docs. Data comes through stack_run as --json; file bodies
// and images arrive via `show --file` (the web fetches them as URLs).
// Desktop additions, kept visually quiet: the import section, git-state
// markers on rows, the /all route (the site links * all at #/search/), and
// click-only meta/preview links (the keyboard walks the tree files).
// Route shape inside #browse: [] home, [kind] kind view, [all] everything,
// [id...] entry detail, [id..., file...] entry file.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { errText, stackRun } from '../bridge';
import { href } from '../router';
import { KINDS, fmtBytes, kindOf, pluralOf } from '../parse';
import { moveSel } from '../onboard';
import {
  describeImport,
  entryMarkers,
  fromStackOut,
  importArgs,
  refusalFiles,
  showFileArgs,
  toShowDoc,
  toShowFile,
  type JsonEntry,
  type ListJson,
  type OpSection,
  type ShowFile,
  type ShowFileJson,
  type ShowJson,
} from '../json';
import { config, lock, refreshLock } from '../store';
import { CliErr, Empty, Markers, OpResult } from '../ui';
import {
  Bar,
  Face,
  FileTree,
  IMG_RE,
  Legend,
  Markdown,
  Sprite,
  citedBy,
  fileRowOrder,
  groupComponents,
  kindAgg,
  libraryMeta,
  mimeFor,
  scoreEntries,
  type LibraryGroup,
} from '../site';

type Route =
  | { kind: 'home' }
  | { kind: 'all' }
  | { kind: 'kind'; kindSingular: string }
  | { kind: 'entry'; id: string; file: string | null }
  | { kind: 'missing' };

/** Resolve browse sub-segments: longest entry-id prefix wins (web parse). */
export function resolveRoute(segs: string[], entries: JsonEntry[]): Route {
  const rest = segs.slice(1);
  if (!rest.length) return { kind: 'home' };
  for (let n = rest.length; n >= 1; n--) {
    const id = rest.slice(0, n).join('/');
    if (entries.some((e) => e.id === id)) {
      const tail = rest.slice(n).join('/');
      return { kind: 'entry', id, file: tail || null };
    }
  }
  if (rest.length === 1) {
    if (rest[0] === 'all') return { kind: 'all' };
    const k = KINDS.find((x) => x === rest[0] || pluralOf(x) === rest[0]);
    if (k) return { kind: 'kind', kindSingular: k };
  }
  return { kind: 'missing' };
}

export default function Browse(props: { scenario: string; segs: string[] }) {
  const [entries, setEntries] = createSignal<JsonEntry[]>([]);
  const [uncommitted, setUncommitted] = createSignal<Set<string>>(new Set());
  const [note, setNote] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [q, setQ] = createSignal('');
  const [sel, setSel] = createSignal(-1);
  const [entryFiles, setEntryFiles] = createSignal<ShowFile[]>([]);
  let inputEl: HTMLInputElement | undefined;

  const route = (): Route => resolveRoute(props.segs, entries());
  const searching = () => q().trim().length > 0;

  async function load() {
    const c = config();
    setLoading(true);
    setNote(null);
    try {
      const out = await stackRun('list', ['--json'], c?.project ?? '.', c?.stackPath);
      const data = fromStackOut<ListJson>(out);
      setEntries(data.entries);
      setUncommitted(new Set<string>(data.uncommitted ?? []));
      if (!data.entries.length) setNote('no entries');
    } catch (err) {
      setEntries([]);
      setUncommitted(new Set<string>());
      setNote(errText(err));
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    void load();
    // Dotted leaders, exactly like the web.
    document.documentElement.style.setProperty('--dots', JSON.stringify('. '.repeat(120)));
    if (matchMedia('(hover: hover)').matches) inputEl?.focus();
  });

  const entryHref = (id: string): string => href(props.scenario, 'browse', ...id.split('/'));
  const kindHref = (kind: string): string =>
    kind ? href(props.scenario, 'browse', pluralOf(kind)) : href(props.scenario, 'browse');
  const fileHref = (id: string, file: string): string =>
    href(props.scenario, 'browse', ...id.split('/'), ...file.split('/'));

  // Navigable rows for the keyboard cursor, like the web's [data-nav].
  const rows = (): { href: string }[] => {
    const r = route();
    if (searching()) return scoreEntries(entries(), q()).map((e) => ({ href: entryHref(e.id) }));
    if (r.kind === 'home') {
      const kinds = kindAgg(entries()).stats.map((s) => ({ href: kindHref(s.kind) }));
      return [...kinds, { href: href(props.scenario, 'browse', 'all') }];
    }
    if (r.kind === 'kind') {
      const list = entries().filter((e) => e.kind === r.kindSingular);
      // Components render grouped by library; the keyboard walks the same
      // order (group members first, then ungrouped rows), skipping headers.
      const ordered =
        r.kindSingular === 'component'
          ? ((g) => [...g.groups.flatMap((x) => x.members), ...g.ungrouped])(groupComponents(list))
          : list;
      return ordered.map((e) => ({ href: entryHref(e.id) }));
    }
    if (r.kind === 'all') {
      return [...entries()]
        .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
        .map((e) => ({ href: entryHref(e.id) }));
    }
    if (r.kind === 'entry') {
      return fileRowOrder(entryFiles()).map((p) => ({ href: fileHref(r.id, p) }));
    }
    return [];
  };

  const up = (): void => {
    const r = route();
    if (r.kind === 'entry' && r.file) location.hash = entryHref(r.id);
    else if (r.kind === 'entry') location.hash = kindHref(kindOf(r.id));
    else if (r.kind === 'kind' || r.kind === 'all') location.hash = kindHref('');
  };

  createEffect(() => {
    // A new route clears the prompt and the cursor, like the web hashchange.
    void props.segs.join('/');
    void entries().length;
    void entryFiles().length;
    setQ('');
    if (inputEl) inputEl.value = '';
    setSel(-1);
    window.scrollTo(0, 0);
  });

  createEffect(() => {
    void q();
    setSel(-1);
  });

  createEffect(() => {
    const i = sel();
    if (i >= 0) {
      document.querySelector(`[data-row="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });

  onMount(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return;
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          setSel((s) => moveSel(s, 1, rows().length));
          return;
        case 'ArrowUp':
          ev.preventDefault();
          setSel((s) => moveSel(s, -1, rows().length));
          return;
        case 'Enter': {
          const list = rows();
          const pick = sel() >= 0 ? list[sel()] : q().trim() ? list[0] : null;
          if (pick) {
            ev.preventDefault();
            location.hash = pick.href;
          }
          return;
        }
        case 'Escape':
          ev.preventDefault();
          if (q()) {
            setQ('');
            if (inputEl) inputEl.value = '';
          } else up();
          return;
        case ' ':
          if (!q()) {
            ev.preventDefault();
            window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
          }
          return;
      }
      if (ev.key.length === 1) inputEl?.focus();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const crumbs = (): { label: string; href: string | null }[] => {
    const r = route();
    const home = { label: '~', href: searching() || r.kind !== 'home' ? kindHref('') : null };
    if (searching() || r.kind === 'home') return [home];
    if (r.kind === 'all') return [home, { label: '/all', href: null }];
    if (r.kind === 'kind') return [home, { label: `/${pluralOf(r.kindSingular)}`, href: null }];
    if (r.kind === 'entry') {
      const e = entries().find((x) => x.id === r.id);
      const segs = r.id.split('/');
      const mid = segs.length > 2 ? segs.slice(1).join('/') : (e?.name ?? r.id);
      const trail: { label: string; href: string | null }[] = [
        home,
        { label: `/${pluralOf(kindOf(r.id))}`, href: kindHref(kindOf(r.id)) },
        { label: mid, href: r.file ? entryHref(r.id) : null },
      ];
      if (r.file) trail.push({ label: r.file.split('/').pop() ?? r.file, href: null });
      return trail;
    }
    return [home, { label: 'missing', href: null }];
  };

  return (
    <>
      <div id="prompt">
        <nav id="crumbs" aria-label="path">
          <For each={crumbs()}>
            {(c, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="sep">/</span>
                </Show>
                <Show when={c.href} fallback={<span>{c.label}</span>}>
                  {(h) => <a href={h()}>{c.label}</a>}
                </Show>
              </>
            )}
          </For>
        </nav>
        <span class="ps" aria-hidden="true">
          ›
        </span>
        <input
          id="q"
          ref={inputEl}
          type="text"
          role="searchbox"
          aria-label="search entries"
          placeholder="type to search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
      </div>
      <Show when={loading()}>
        <Empty>(._.) loading…</Empty>
      </Show>
      <Show when={note()}>
        <CliErr text={note() as string} />
      </Show>
      <Show when={!loading() && !note()}>
        <Show when={searching()} fallback={<Routed route={route()} />}>
          <SearchView
            entries={scoreEntries(entries(), q())}
            uncommitted={uncommitted()}
            sel={sel()}
            entryHref={entryHref}
          />
        </Show>
      </Show>
    </>
  );

  function Routed(props2: { route: Route }) {
    const r = props2.route;
    if (r.kind === 'home') {
      return <KindHome entries={entries()} sel={sel()} kindHref={kindHref} allHref={href(props.scenario, 'browse', 'all')} />;
    }
    if (r.kind === 'all') {
      return (
        <KindView
          label="id"
          entries={[...entries()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))}
          uncommitted={uncommitted()}
          sel={sel()}
          entryHref={entryHref}
        />
      );
    }
    if (r.kind === 'kind') {
      const list = entries().filter((e) => e.kind === r.kindSingular);
      if (r.kindSingular === 'component') {
        const g = groupComponents(list);
        return (
          <ComponentKindView
            groups={g.groups}
            ungrouped={g.ungrouped}
            uncommitted={uncommitted()}
            sel={sel()}
            entryHref={entryHref}
          />
        );
      }
      return (
        <KindView
          label="name"
          entries={list}
          uncommitted={uncommitted()}
          sel={sel()}
          entryHref={entryHref}
        />
      );
    }
    if (r.kind === 'entry') {
      return (
        <EntryDetail
          scenario={props.scenario}
          id={r.id}
          file={r.file}
          entries={entries()}
          uncommitted={uncommitted()}
          sel={sel()}
          entryHref={entryHref}
          fileHref={fileHref}
          onFiles={setEntryFiles}
        />
      );
    }
    return <Empty>(o_O) not found</Empty>;
  }
}

/** Row thumbnail, fetched when it scrolls into view (list carries the name). */
function RowThumb(props: { id: string; file: string }) {
  const [src, setSrc] = createSignal<string | null>(null);
  let imgEl: HTMLImageElement | undefined;
  onMount(() => {
    const load = () => {
      const c = config();
      stackRun('show', showFileArgs(props.id, props.file), c?.project ?? '.', c?.stackPath).then(
        (out) => {
          try {
            const b = toShowFile(fromStackOut<ShowFileJson>(out));
            if (b.base64) setSrc(`data:${mimeFor(props.file)};base64,${b.base64}`);
          } catch {
            /* leave the thumbnail out */
          }
        },
        () => {},
      );
    };
    if (typeof IntersectionObserver === 'undefined' || !imgEl) {
      load();
      return;
    }
    const el = imgEl;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((x) => x.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    onCleanup(() => io.disconnect());
  });
  return (
    <Show when={src()}>
      <img ref={imgEl} class="rthumb" src={src() as string} alt="" loading="lazy" />
    </Show>
  );
}

/** One catalog row: sprite, name, dotted leader, thumb, face, size. */
function EntryRow(props: {
  e: JsonEntry;
  label: string;
  uncommitted: Set<string>;
  index: number;
  sel: boolean;
  entryHref: (id: string) => string;
}) {
  const m = entryMarkers(props.e, props.uncommitted);
  return (
    <a
      class="row"
      href={props.entryHref(props.e.id)}
      data-row={props.index}
      data-nav=""
      data-sel={props.sel ? '' : undefined}
    >
      <Sprite kind={props.e.kind} origin={props.e.origin} />
      <span class="nm">{props.label}</span>
      <Markers notCommitted={m.notCommitted} uncommittedInStack={m.uncommittedInStack} />
      <span class="lead" aria-hidden="true" />
      <Show when={props.e.preview}>
        <RowThumb id={props.e.id} file={props.e.preview as string} />
      </Show>
      <Face status={props.e.status} />
      <span class="num">{`${props.e.files}f ${fmtBytes(props.e.bytes)}`}</span>
    </a>
  );
}

function KindHome(props: {
  entries: JsonEntry[];
  sel: number;
  kindHref: (kind: string) => string;
  allHref: string;
}) {
  const agg = () => kindAgg(props.entries);
  const max = () => Math.max(1, ...agg().stats.map((s) => s.n));
  const tot = () => agg().stats.reduce((a, s) => a + s.bytes, 0);
  return (
    <>
      <p class="lede">
        {agg().total} things{tot() ? `, ${fmtBytes(tot())}` : ''} to import from.
      </p>
      <div class="krows">
        <For each={agg().stats}>
          {(s, i) => (
            <a
              class={`krow${s.n ? '' : ' zero'}`}
              href={props.kindHref(s.kind)}
              data-row={i()}
              data-nav=""
              data-sel={props.sel === i() ? '' : undefined}
            >
              <Sprite kind={s.kind} />
              <span class="nm">{pluralOf(s.kind)}</span>
              <Bar n={s.n} max={max()} />
              <span class="num">{s.n}</span>
            </a>
          )}
        </For>
        <a class="krow" href={props.allHref} data-row={agg().stats.length} data-nav="" data-sel={props.sel === agg().stats.length ? '' : undefined}>
          <span class="sp">~</span>
          <span class="nm">all</span>
          <span class="bar dimtxt">everything, one list</span>
          <span class="num">{agg().total}</span>
        </a>
      </div>
      <Legend entries={props.entries} />
    </>
  );
}

function KindView(props: {
  label: 'name' | 'id';
  entries: JsonEntry[];
  uncommitted: Set<string>;
  sel: number;
  entryHref: (id: string) => string;
}) {
  return (
    <Show when={props.entries.length} fallback={<Empty>(._.) none</Empty>}>
      <div class="rows">
        <For each={props.entries}>
          {(e, i) => (
            <EntryRow
              e={e}
              label={props.label === 'id' ? e.id : (e.name ?? e.id)}
              uncommitted={props.uncommitted}
              index={i()}
              sel={props.sel === i()}
              entryHref={props.entryHref}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

/**
 * Components kind view, grouped by library: one header per library
 * (`components/<lib>`, member count, extends/default markers), member rows
 * beneath, and a dim `stack import components/<lib>` hint. Headers carry no
 * data-row, so the keyboard cursor skips them; member indices continue the
 * rows() order across groups (then ungrouped rows).
 */
function ComponentKindView(props: {
  groups: LibraryGroup[];
  ungrouped: JsonEntry[];
  uncommitted: Set<string>;
  sel: number;
  entryHref: (id: string) => string;
}) {
  type Block =
    | { kind: 'lib'; lib: LibraryGroup['lib']; members: JsonEntry[]; start: number }
    | { kind: 'plain'; members: JsonEntry[]; start: number };
  const blocks = (): Block[] => {
    const out: Block[] = [];
    let at = 0;
    for (const g of props.groups) {
      out.push({ kind: 'lib', lib: g.lib, members: g.members, start: at });
      at += g.members.length;
    }
    if (props.ungrouped.length) out.push({ kind: 'plain', members: props.ungrouped, start: at });
    return out;
  };
  const total = () =>
    props.groups.reduce((a, g) => a + g.members.length, 0) + props.ungrouped.length;
  return (
    <Show when={total()} fallback={<Empty>(._.) none</Empty>}>
      <div>
        <For each={blocks()}>
          {(b) =>
            b.kind === 'lib' ? (
              <section class="libgroup">
                <div class="libhead">
                  <Sprite kind="library" />
                  <span class="nm">components/{b.lib.name}</span>
                  <span class="dimtxt">{libraryMeta(b.lib, b.members.length)}</span>
                </div>
                <p class="dimtxt libhint">stack import components/{b.lib.name}</p>
                <div class="rows">
                  <For each={b.members}>
                    {(e, i) => (
                      <EntryRow
                        e={e}
                        label={e.name ?? e.id}
                        uncommitted={props.uncommitted}
                        index={b.start + i()}
                        sel={props.sel === b.start + i()}
                        entryHref={props.entryHref}
                      />
                    )}
                  </For>
                </div>
              </section>
            ) : (
              <div class="rows">
                <For each={b.members}>
                  {(e, i) => (
                    <EntryRow
                      e={e}
                      label={e.name ?? e.id}
                      uncommitted={props.uncommitted}
                      index={b.start + i()}
                      sel={props.sel === b.start + i()}
                      entryHref={props.entryHref}
                    />
                  )}
                </For>
              </div>
            )
          }
        </For>
      </div>
    </Show>
  );
}

function SearchView(props: {
  entries: JsonEntry[];
  uncommitted: Set<string>;
  sel: number;
  entryHref: (id: string) => string;
}) {
  return (
    <Show when={props.entries.length} fallback={<Empty>(._.) none</Empty>}>
      <div class="rows">
        <For each={props.entries}>
          {(e, i) => (
            <EntryRow
              e={e}
              label={e.id}
              uncommitted={props.uncommitted}
              index={i()}
              sel={props.sel === i()}
              entryHref={props.entryHref}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

type Doc = ReturnType<typeof toShowDoc>;
type FileBody = ReturnType<typeof toShowFile>;

async function showFile(id: string, file: string): Promise<FileBody> {
  const c = config();
  const out = await stackRun('show', showFileArgs(id, file), c?.project ?? '.', c?.stackPath);
  return toShowFile(fromStackOut<ShowFileJson>(out));
}

function EntryDetail(props: {
  scenario: string;
  id: string;
  file: string | null;
  entries: JsonEntry[];
  uncommitted: Set<string>;
  sel: number;
  entryHref: (id: string) => string;
  fileHref: (id: string, file: string) => string;
  onFiles: (files: ShowFile[]) => void;
}) {
  const [doc, setDoc] = createSignal<Doc | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [to, setTo] = createSignal('');
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [fileBody, setFileBody] = createSignal<FileBody | null>(null);
  const [fileNote, setFileNote] = createSignal<string | null>(null);
  const [previews, setPreviews] = createSignal<{ path: string; base64: string }[]>([]);

  const e = () => props.entries.find((x) => x.id === props.id) ?? null;
  // The web shows the open file, defaulting to the entry doc, under h2.
  const bodyPath = () => props.file ?? e()?.doc.slice(props.id.length + 1) ?? null;

  createEffect(() => {
    const id = props.id;
    const c = config();
    setDoc(null);
    setError(null);
    setSections(null);
    setFailed(null);
    setPreviews([]);
    props.onFiles([]);
    stackRun('show', [id, '--json'], c?.project ?? '.', c?.stackPath).then(
      (out) => {
        try {
          const d = toShowDoc(fromStackOut<ShowJson>(out));
          setDoc(d);
          props.onFiles(d.files);
          const imgs = d.files.filter((f) => IMG_RE.test(f.path)).slice(0, 4);
          void Promise.all(
            imgs.map((f) =>
              showFile(id, f.path).then(
                (b) => (b.base64 ? { path: f.path, base64: b.base64 } : null),
                () => null,
              ),
            ),
          ).then((got) => setPreviews(got.filter((g): g is { path: string; base64: string } => !!g)));
        } catch (err) {
          setError(errText(err));
        }
      },
      (err) => setError(errText(err)),
    );
  });

  createEffect(() => {
    const p = bodyPath();
    setFileBody(null);
    setFileNote(null);
    if (!p) return;
    showFile(props.id, p).then(
      (b) => setFileBody(b),
      (err) => setFileNote(errText(err)),
    );
  });

  const locked = () => lock().rows.find((r) => r.id === props.id) ?? null;
  const byId = () => new Map(props.entries.map((x) => [x.id, x]));
  const knownLinks = (ids: string[]) => ids.filter((id) => byId().has(id));
  const source = () => {
    const s = doc()?.manifest['source'];
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
  };
  const sourceUrl = () => (typeof source()?.['url'] === 'string' ? (source()?.['url'] as string) : null);

  async function doImport() {
    const c = config();
    if (!c?.project) return;
    const dest = to().trim();
    setPending(true);
    setSections(null);
    setFailed(null);
    try {
      const out = await stackRun('import', importArgs(props.id, dest), c.project, c.stackPath);
      setSections(describeImport(fromStackOut(out)));
      await refreshLock();
    } catch (err) {
      setFailed(errText(err));
    } finally {
      setPending(false);
    }
  }

  const lookalikes = () => (failed() ? refusalFiles(failed() as string) : []);

  return (
    <div>
      <Show when={error()}>
        <CliErr text={error() as string} />
      </Show>
      <Show when={doc()}>
        {(d) => {
          const size = d().files.reduce((a, f) => a + f.size, 0);
          return (
            <div>
              <h1 class="title" id="stack-entry">
                <Sprite kind={e()?.kind ?? ''} origin={e()?.origin ?? ''} />
                <span>{e()?.name ?? props.id}</span>
                <Face status={e()?.status ?? ''} />
              </h1>
              <Show when={e()?.summary}>
                <p class="summary">{e()?.summary}</p>
              </Show>
              <Show when={!d().committed}>
                <p class="conflict" role="alert">
                  not-committed: this entry is not in the stack's HEAD commit, so it cannot be
                  imported yet — commit it to the stack first.
                </p>
              </Show>
              <Show when={locked()}>
                <p>
                  imported → {(locked() as { path: string }).path}{' '}
                  <a href={href(props.scenario, 'installed')}>installed</a>
                </p>
              </Show>
              <dl>
                <dt>status</dt>
                <dd>
                  <Face status={e()?.status ?? ''} /> {e()?.status ?? ''}
                </dd>
                <dt>origin</dt>
                <dd>
                  <Sprite kind={e()?.kind ?? ''} origin={e()?.origin ?? ''} /> {e()?.origin ?? ''}
                </dd>
                <Show when={d().usage}>
                  <dt>usage</dt>
                  <dd>{d().usage}</dd>
                </Show>
                <dt>size</dt>
                <dd>{`${d().files.length} files, ${fmtBytes(size)}`}</dd>
                <Show when={e()?.targets?.length}>
                  <dt>targets</dt>
                  <dd>{e()?.targets.join(' ')}</dd>
                </Show>
                <Show when={e()?.tags?.length}>
                  <dt>tags</dt>
                  <dd>
                    <div class="chips">
                      <For each={e()?.tags ?? []}>{(t) => <span>{t}</span>}</For>
                    </div>
                  </dd>
                </Show>
                <Show when={e()?.requires?.length}>
                  <dt>requires</dt>
                  <dd>
                    <div class="rlinks">
                      <For each={knownLinks(e()?.requires ?? [])}>
                        {(r) => <a href={props.entryHref(r)}>{byId().get(r)?.name ?? r}</a>}
                      </For>
                    </div>
                  </dd>
                </Show>
                <Show when={e()?.related?.length}>
                  <dt>related</dt>
                  <dd>
                    <div class="rlinks">
                      <For each={knownLinks(e()?.related ?? [])}>
                        {(r) => <a href={props.entryHref(r)}>{byId().get(r)?.name ?? r}</a>}
                      </For>
                    </div>
                  </dd>
                </Show>
                <Show when={citedBy(props.entries, props.id).length}>
                  <dt>cited by</dt>
                  <dd>
                    <div class="rlinks">
                      <For each={citedBy(props.entries, props.id)}>
                        {(r) => <a href={props.entryHref(r)}>{byId().get(r)?.name ?? r}</a>}
                      </For>
                    </div>
                  </dd>
                </Show>
                <Show when={source()}>
                  <dt>upstream</dt>
                  <dd>
                    <Show when={sourceUrl() && /^https?:/.test(sourceUrl() as string)} fallback={sourceUrl() ?? ''}>
                      <a href={sourceUrl() as string} target="_blank" rel="noopener noreferrer">
                        {(sourceUrl() as string).replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    </Show>
                    <Show when={typeof source()?.['ref'] === 'string'}>
                      <span class="dim">{` @ ${String(source()?.['ref']).slice(0, 7)}`}</span>
                    </Show>
                    <Show when={typeof source()?.['license'] === 'string'}>
                      <span class="dim">{` ${source()?.['license']}`}</span>
                    </Show>
                    <Show when={source()?.['modified']}>
                      <span class="dim"> modified</span>
                    </Show>
                  </dd>
                </Show>
              </dl>

              <h2>import</h2>
              <Show
                when={config()?.project}
                fallback={
                  <p class="dimtxt">
                    pick a <a href={href(props.scenario, 'project')}>project</a> first.
                  </p>
                }
              >
                <Show
                  when={!locked()}
                  fallback={
                    <p>
                      imported → {(locked() as { path: string }).path}{' '}
                      <a href={href(props.scenario, 'installed')}>installed</a>
                    </p>
                  }
                >
                  <Show
                    when={d().committed}
                    fallback={
                      <p class="dimtxt">import is disabled until this entry is committed to the stack.</p>
                    }
                  >
                    <p>
                      <input
                        type="text"
                        value={to()}
                        onInput={(ev) => setTo(ev.currentTarget.value)}
                        placeholder="--to dir (optional)"
                        aria-label="import destination inside the project"
                        size={24}
                      />{' '}
                      <button class="btn" disabled={pending()} onClick={() => void doImport()}>
                        {pending() ? 'importing' : 'import'}
                      </button>
                    </p>
                    <p class="dimtxt">refuses before writing anything if files differ — never overwrites.</p>
                  </Show>
                </Show>
              </Show>

              <Show when={lookalikes().length > 0}>
                <p class="conflict" role="alert">
                  untracked look-alike: these files already exist here with other content. move them
                  aside or import with --to instead — nothing was written.
                </p>
                <pre class="raw">{lookalikes().join('\n')}</pre>
              </Show>
              <Show when={failed() && !lookalikes().length}>
                <CliErr text={failed() as string} />
              </Show>
              <Show when={sections()}>
                <OpResult sections={sections() as OpSection[]} />
              </Show>

              <Show when={previews().length}>
                <div>
                  <h2>preview</h2>
                  <div class="previews">
                    <For each={previews()}>
                      {(p) => (
                        <a href={props.fileHref(props.id, p.path)}>
                          <img src={`data:${mimeFor(p.path)};base64,${p.base64}`} alt={p.path} loading="lazy" />
                        </a>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <h2>files</h2>
              <Show when={d().files.length} fallback={<Empty>(._.) none</Empty>}>
                <FileTree
                  files={d().files}
                  name={e()?.name ?? props.id}
                  cur={bodyPath()}
                  sel={props.sel}
                  selBase={0}
                  fileHref={(p) => props.fileHref(props.id, p)}
                  fmtSize={fmtBytes}
                />
              </Show>
              <Show when={bodyPath()}>
                <h2>{bodyPath()}</h2>
                <Show when={fileNote()}>
                  <p class="note">{fileNote()}</p>
                </Show>
                <Show when={fileBody()}>
                  {(b) => (
                    <FileView
                      body={b()}
                      entries={props.entries}
                      entryId={props.id}
                      entryHref={props.entryHref}
                      fileHref={(id, f) => props.fileHref(id, f)}
                    />
                  )}
                </Show>
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
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
