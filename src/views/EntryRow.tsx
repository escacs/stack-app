// One catalog row in the Browse list, laid out like a table row: kind icon | name with the quiet
// kind/status text under it | summary, which takes the free width | the row's
// actions, right-aligned: a ghost Open and a small raised Import (or a
// disabled Imported). The row is a container: when it is narrow (list beside
// the open detail, or a small window) the summary drops under the name and
// Open becomes an icon-only chevron. The file and byte counts live only in
// the row tooltip. The cursor is the listbox's aria-activedescendant;
// `aria-selected` means the row is in the selection (a tinted row).
import { For, Show, createMemo } from 'solid-js';
import { highlightRanges, markSegments, rowKindText, rowStatus } from '../browseList';
import type { JsonEntry } from '../json';
import { fmtBytes } from '../parse';
import { fileCountLabel } from '../plan';
import { Icon } from '../icons';
import { Sprite } from '../site';
import { Badge, Button } from '../ui';

function Marked(props: { text: string; query: string }) {
  const segs = createMemo(() => markSegments(props.text, highlightRanges(props.query, props.text)));
  return <For each={segs()}>{(s) => (s.mark ? <mark>{s.text}</mark> : <>{s.text}</>)}</For>;
}

export function EntryRow(props: {
  e: JsonEntry;
  id: string;
  index: number;
  total: number;
  cursor: boolean;
  /** In the selection: a tinted row, `aria-selected`. */
  selected: boolean;
  query: string;
  /** Rows show the full id (search, mixed kinds) or just the name. */
  showId: boolean;
  /** The list is scoped to one component library, so rows skip its name. */
  inLibrary?: boolean;
  /** Already imported into the current target: Import becomes a quiet `Imported ✓` label. */
  imported: boolean;
  /** Another operation is running: Import waits. */
  busy: boolean;
  onPick: (ev: MouseEvent) => void;
  onOpen: () => void;
  onImport: () => void;
}) {
  const status = () => rowStatus(props.e);
  const kindText = () => rowKindText(props.e, props.showId, props.inLibrary);
  const tip = () => {
    const s = status();
    return `${props.e.name ?? props.e.id} · ${fileCountLabel(props.e.files)} · ${fmtBytes(props.e.bytes)}${s ? ` · ${s.text}` : ''}`;
  };
  return (
    <div
      id={props.id}
      class="erow"
      role="option"
      aria-selected={props.selected}
      aria-posinset={props.index + 1}
      aria-setsize={props.total}
      data-row={props.index}
      data-cursor={props.cursor ? '' : undefined}
      data-selected={props.selected ? '' : undefined}
      title={tip()}
      onClick={(ev) => props.onPick(ev)}
      onDblClick={() => props.onOpen()}
    >
      <span class="erow__lead">
        <Sprite kind={props.e.kind} origin={props.e.origin} />
      </span>
      <span class="erow__main">
        <span class="erow__name">
          <span class="erow__nm"><Marked text={props.e.name ?? props.e.id} query={props.query} /></span>
          <Show when={status()}>
            {(s) => (
              <span class="erow__badge">
                <Badge tone={s().tone} size="xs" title={s().title}>{s().text}</Badge>
              </span>
            )}
          </Show>
        </span>
        <Show when={kindText()}>
          <span class="erow__lib" title={kindText()}>
            {kindText().split(' · ')[0]}
            <Show when={kindText().includes(' · ')}>
              <span class="erow__lib-x"> · {kindText().split(' · ').slice(1).join(' · ')}</span>
            </Show>
          </span>
        </Show>
      </span>
      <span class="erow__sum"><Marked text={props.e.summary} query={props.query} /></span>
      <span class="erow__acts" onClick={(ev) => ev.stopPropagation()} onDblClick={(ev) => ev.stopPropagation()}>
          <Button class="erow__open" size="sm" variant="ghost" tabindex={props.cursor ? 0 : -1} aria-label={`Open ${props.e.name ?? props.e.id}`} title="Open the details (Enter)" onClick={() => props.onOpen()}>
            <span class="erow__open-t">Open</span>
            <Icon name="chevronDown" size={14} class="erow__open-i" />
          </Button>
          <Show
            when={!props.imported}
            fallback={
              <span class="erow__imported" title="Already in this project">
                Imported ✓
              </span>
            }
          >
            <Button
              size="sm"
              tabindex={props.cursor ? 0 : -1}
              disabled={!props.e.committed || props.busy}
              aria-label={`Import ${props.e.name ?? props.e.id}`}
              title={!props.e.committed ? 'Not in the stack, so it cannot be imported' : props.busy ? 'Another operation is running' : 'Import into the project (i)'}
              onClick={() => props.onImport()}
            >
              Import
            </Button>
          </Show>
        </span>
    </div>
  );
}
