// Browse + import. Mirrors the web/ browse UI (same rows, same prompt bar)
// but the data comes through stack_run as --json. Import honors requires
// (auto-imported), payload (installs at the project root), and --to.
import { For, Show, createEffect, createSignal } from 'solid-js';
import { errText, stackRun } from '../bridge';
import { href } from '../router';
import { KINDS, manifestList, pluralOf } from '../parse';
import {
  describeImport,
  docNameFor,
  entryMarkers,
  fromStackOut,
  importArgs,
  refusalFiles,
  searchArgs,
  toShowDoc,
  type JsonEntry,
  type ListJson,
  type OpSection,
  type SearchJson,
  type ShowJson,
} from '../json';
import { config, lock, refreshLock } from '../store';
import { CliErr, Empty, Markers, OpResult } from '../ui';

export default function Browse(props: { scenario: string; id: string | null }) {
  return (
    <Show when={props.id} fallback={<List scenario={props.scenario} />}>
      {(id) => <Detail scenario={props.scenario} id={id()} />}
    </Show>
  );
}

function List(props: { scenario: string }) {
  const [q, setQ] = createSignal('');
  const [kind, setKind] = createSignal('');
  const [rows, setRows] = createSignal<JsonEntry[]>([]);
  const [uncommitted, setUncommitted] = createSignal<Set<string>>(new Set());
  const [note, setNote] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  let timer = 0;

  async function run(query: string, k: string) {
    const c = config();
    setLoading(true);
    setNote(null);
    try {
      const sub = query ? 'search' : 'list';
      const args = query ? searchArgs(query, k) : [...(k ? [k] : []), '--json'];
      const out = await stackRun(sub, args, c?.project ?? '.', c?.stackPath);
      const data = fromStackOut<ListJson | SearchJson>(out);
      setRows(data.entries);
      setUncommitted(new Set<string>(data.uncommitted ?? []));
      if (!data.entries.length) setNote(query ? 'no matches' : 'no entries');
    } catch (err) {
      setRows([]);
      setUncommitted(new Set<string>());
      setNote(errText(err));
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    void config();
    void run('', '');
  });

  function onInput(v: string) {
    setQ(v);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(v.trim(), kind()), 250);
  }

  return (
    <div>
      <div id="prompt">
        <nav id="crumbs" aria-label="path">
          <span>browse</span>
        </nav>
        <span class="ps" aria-hidden="true">›</span>
        <input
          id="q"
          type="text"
          placeholder="type to search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          aria-label="search"
          value={q()}
          onInput={(e) => onInput(e.currentTarget.value)}
        />
        <select value={kind()} onChange={(e) => { setKind(e.currentTarget.value); void run(q().trim(), e.currentTarget.value); }} aria-label="kind">
          <option value="">all</option>
          <For each={KINDS}>{(k) => <option value={k}>{pluralOf(k)}</option>}</For>
        </select>
      </div>
      <Show when={loading()}>
        <p class="dimtxt">…</p>
      </Show>
      <Show when={note()}>
        <p class="empty">{note()}</p>
      </Show>
      <div class="rows">
        <For each={rows()}>
          {(e) => {
            const m = () => entryMarkers(e, uncommitted());
            return (
              <a class="row" href={href(props.scenario, 'browse', e.id)}>
                <span class="nm">{e.id}</span>
                <Markers notCommitted={m().notCommitted} uncommittedInStack={m().uncommittedInStack} />
                <span class="lead" aria-hidden="true" />
                <span class="dimtxt">{e.status ?? e.usage}</span>
              </a>
            );
          }}
        </For>
      </div>
      <Show when={!rows().length && !note() && !loading()}>
        <Empty />
      </Show>
    </div>
  );
}

type Doc = ReturnType<typeof toShowDoc>;

function Detail(props: { scenario: string; id: string }) {
  const [doc, setDoc] = createSignal<Doc | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [to, setTo] = createSignal('');
  const [sections, setSections] = createSignal<OpSection[] | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  createEffect(() => {
    const id = props.id;
    const c = config();
    setDoc(null);
    setError(null);
    setSections(null);
    setFailed(null);
    stackRun('show', [id, '--json'], c?.project ?? '.', c?.stackPath).then(
      (out) => {
        try {
          setDoc(toShowDoc(fromStackOut<ShowJson>(out)));
        } catch (err) {
          setError(errText(err));
        }
      },
      (err) => setError(errText(err)),
    );
  });

  const locked = () => lock().rows.find((r) => r.id === props.id) ?? null;
  const requires = () => manifestList(doc()?.manifest ?? {}, 'requires');
  const payload = () => {
    const p = doc()?.manifest['payload'];
    return typeof p === 'string' ? p : null;
  };

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
      <p class="dimtxt">
        <a href={href(props.scenario, 'browse')}>← back</a>
      </p>
      <Show when={error()}>
        <CliErr text={error() as string} />
      </Show>
      <Show when={doc()}>
        {(d) => (
          <div>
            <h1 class="title">
              <span>{String(d().manifest['name'] ?? props.id)}</span>
            </h1>
            <Show when={typeof d().manifest['summary'] === 'string'}>
              <p class="summary">{String(d().manifest['summary'])}</p>
            </Show>
            <Show when={!d().committed}>
              <p class="conflict" role="alert">
                not-committed: this entry is not in the stack's HEAD commit, so it cannot be
                imported yet — commit it to the stack first.
              </p>
            </Show>
            <dl>
              <dt>id</dt>
              <dd>{props.id}</dd>
              <Show when={d().usage}>
                <dt>usage</dt>
                <dd>{d().usage}</dd>
              </Show>
              <Show when={requires().length}>
                <dt>requires</dt>
                <dd>
                  <div class="rlinks">
                    <For each={requires()}>
                      {(r) => <a href={href(props.scenario, 'browse', r)}>{r}</a>}
                    </For>
                  </div>
                  <span class="dimtxt">auto-imported with this entry</span>
                </dd>
              </Show>
              <Show when={payload()}>
                <dt>payload</dt>
                <dd>
                  {payload()} <span class="dimtxt">— contents install at the project root</span>
                </dd>
              </Show>
              <Show when={d().files.length}>
                <dt>files</dt>
                <dd class="dimtxt">{d().files.length} files</dd>
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
                    <a href={href(props.scenario, 'status')}>status</a>
                  </p>
                }
              >
                <Show when={d().committed} fallback={
                  <p class="dimtxt">import is disabled until this entry is committed to the stack.</p>
                }>
                  <p>
                    <input
                      type="text"
                      value={to()}
                      onInput={(e) => setTo(e.currentTarget.value)}
                      placeholder="--to dir (optional)"
                      aria-label="import destination inside the project"
                      size={24}
                    />{' '}
                    <button class="btn" disabled={pending()} onClick={() => void doImport()}>
                      {pending() ? 'importing' : 'import'}
                    </button>
                  </p>
                  <p class="dimtxt">
                    refuses before writing anything if files differ — never overwrites.
                  </p>
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

            <Show when={d().docBody}>
              <h2>{docNameFor(d().manifest)}</h2>
              <pre class="raw">{d().docBody}</pre>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
