// A component library as a folder row in the Browse list. It wears the entry
// row's look and columns (folder icon in the lead column, name with a quiet
// count under it, summary,
// right-aligned actions) so folders and members line up. Open drills into the
// folder; Import all runs the batch import over its members.
import { Show } from 'solid-js';
import { folderSummary, memberCountLabel, type Folder, type FolderImport } from '../folders';
import { Icon } from '../icons';
import { Button } from '../ui';

export function FolderRow(props: {
  folder: Folder;
  id: string;
  index: number;
  total: number;
  cursor: boolean;
  /** All its pickable members are in the selection: a tinted row, `aria-selected`. */
  selected: boolean;
  imp: FolderImport;
  busy: boolean;
  onPick: (ev: MouseEvent) => void;
  onOpen: () => void;
  onImport: () => void;
}) {
  const f = () => props.folder;
  const tip = () => {
    const i = props.imp;
    const bits = [`${f().name} library · ${memberCountLabel(f().members.length)}`];
    if (i.already) bits.push(`${i.already} imported`);
    if (i.skipped) bits.push(`${i.skipped} not in the stack`);
    return bits.join(' · ');
  };
  const sub = () => {
    const i = props.imp;
    const bits = [memberCountLabel(f().members.length)];
    if (i.state === 'import' && i.skipped) bits.push(`${i.skipped} not in the stack`);
    return bits.join(' · ');
  };
  return (
    <div
      id={props.id}
      class="erow erow--folder"
      role="option"
      aria-selected={props.selected}
      aria-posinset={props.index + 1}
      aria-setsize={props.total}
      data-row={props.index}
      data-folder={f().name}
      data-cursor={props.cursor ? '' : undefined}
      data-selected={props.selected ? '' : undefined}
      title={tip()}
      onClick={(ev) => props.onPick(ev)}
      onDblClick={() => props.onOpen()}
    >
      <span class="erow__lead">
        <Icon name="folder" size={18} class="erow__fold" />
      </span>
      <span class="erow__main">
        <span class="erow__name">
          <span class="erow__nm">{f().name}</span>
        </span>
        <span class="erow__lib" title={sub()}>{sub()}</span>
      </span>
      <span class="erow__sum">{folderSummary(f())}</span>
      <span class="erow__acts" onClick={(ev) => ev.stopPropagation()} onDblClick={(ev) => ev.stopPropagation()}>
          <Button class="erow__open" size="sm" variant="ghost" tabindex={props.cursor ? 0 : -1} aria-label={`Open the ${f().name} folder`} title="Show its components (Enter)" onClick={() => props.onOpen()}>
            <span class="erow__open-t">Open</span>
            <Icon name="chevronDown" size={14} class="erow__open-i" />
          </Button>
          <Show
            when={props.imp.state !== 'imported'}
            fallback={
              <span class="erow__imported" title={props.imp.reason ?? undefined}>
                Imported ✓
              </span>
            }
          >
            <Button
              size="sm"
              tabindex={props.cursor ? 0 : -1}
              disabled={props.imp.state === 'none' || props.busy}
              aria-label={`Import all ${f().name} components`}
              title={props.imp.reason ?? (props.busy ? 'Another operation is running' : `Review the files ${props.imp.ready.length} components would write, then import them (i)`)}
              onClick={() => props.onImport()}
            >
              Import all
            </Button>
          </Show>
        </span>
    </div>
  );
}
