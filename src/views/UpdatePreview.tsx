// Preview of one update: `update <id> --dry-run` with the per-file choices,
// listing each file the stack changed with what the real update would do to
// it, in words. Nothing is written until the user confirms; Confirm hands
// back to the page, which runs the real update with the same choices.
import { For, Show, createSignal, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { stackRun } from '../bridge';
import { Modal } from '../dialog';
import { nameOf, updateFileSentence } from '../humanize';
import { fromStackOut, updateArgs, type FileChoice, type UpdateFile, type UpdateJson } from '../json';
import { config } from '../store';
import { Alert, Button, CliErr } from '../ui';

const GLYPH: Record<UpdateFile['outcome'], string> = { updated: '+', 'kept-mine': '=', 'took-upstream': '~', 'conflict-markers': '!', unchanged: ' ' };
const SPOKEN: Record<UpdateFile['outcome'], string> = { updated: 'updated', 'kept-mine': 'kept yours', 'took-upstream': 'replaced', 'conflict-markers': 'conflict', unchanged: 'unchanged' };

type View = { phase: 'loading' } | { phase: 'error'; text: string } | { phase: 'ready'; files: UpdateFile[]; unmatched: string[]; legacy: string[] };

export function UpdatePreview(props: { id: string; choices: Readonly<Record<string, FileChoice>>; onConfirm: () => void; onClose: () => void }) {
  const [view, setView] = createSignal<View>({ phase: 'loading' });
  const [entered, setEntered] = createSignal(false);
  onMount(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    const c = config();
    if (!c?.project) return;
    stackRun('update', updateArgs(props.id, props.choices, { dryRun: true }), c.project, c.stackPath)
      .then((out) => {
        const r = fromStackOut<UpdateJson>(out);
        const u = r.updated.find((x) => x.id === props.id) ?? r.updated[0];
        // An older CLI sends no per-file list: fall back to the plain conflict list.
        const legacy = u?.files ? [] : r.conflicts;
        setView({ phase: 'ready', files: u?.files ?? [], unmatched: r.unmatched ?? [], legacy });
      })
      .catch((e) => setView({ phase: 'error', text: e instanceof Error ? e.message : String(e) }));
  });
  const ready = () => {
    const v = view();
    return v.phase === 'ready' ? v : null;
  };
  const markers = () => ready()?.files.filter((f) => f.outcome === 'conflict-markers').length ?? 0;
  const backups = () => ready()?.files.some((f) => f.outcome === 'took-upstream') ?? false;
  return (
    // Outside the page shell: the shell goes inert while a modal is open.
    <Portal>
    <Modal onClose={() => props.onClose()}>
      <div class="sa-dialog__content upreview" role="dialog" aria-modal="true" aria-labelledby="upreview-t" tabindex="-1" data-modal-content data-starting-style={entered() ? undefined : ''}>
        <div class="sa-dialog__header">
          <h2 class="sa-dialog__title" id="upreview-t">Preview the update to {nameOf(props.id)}</h2>
          <p class="sa-dialog__description">This is what updating would do, file by file. Nothing has been changed yet.</p>
        </div>
        <div class="upreview__body">
          <Show when={view().phase === 'loading'}>
            <p class="review__loading" role="status">Checking each file…</p>
          </Show>
          <Show when={view().phase === 'error' ? (view() as { text: string }).text : null}>
            {(t) => <CliErr text={t()} subject={props.id} />}
          </Show>
          <Show when={ready()}>
            {(v) => (
              <>
                <Show when={v().files.length} fallback={<Alert tone="neutral" role="status">Nothing would change.</Alert>}>
                  <ul class="upreview__list" aria-label="Files this update changes">
                    <For each={v().files}>
                      {(f) => (
                        <li class="upreview__row" data-outcome={f.outcome}>
                          <span class="upreview__glyph" aria-hidden="true">{GLYPH[f.outcome]}</span>
                          <span class="upreview__file">{f.path}</span>
                          <span class="upreview__word">
                            <span class="visually-hidden">{SPOKEN[f.outcome]}: </span>
                            {updateFileSentence(f)}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show when={v().legacy.length}>
                  <Alert tone="warning" role="status">This stack is too old to list each file. Conflict markers would be written to: {v().legacy.join(', ')}.</Alert>
                </Show>
                <Show when={v().unmatched.length}>
                  <Alert tone="neutral" role="status">Nothing to settle for {v().unmatched.join(', ')}: only one side changed {v().unmatched.length === 1 ? 'it' : 'them'}.</Alert>
                </Show>
                <Show when={markers() > 0}>
                  <Alert tone="warning" icon="alert" role="status">Conflict markers will be written to {markers() === 1 ? '1 file' : `${markers()} files`} you both changed. Fix them by hand afterwards.</Alert>
                </Show>
                <Show when={backups()}>
                  <Alert tone="info" icon="info" role="status">Where the stack’s version replaces yours, your version is saved next to it, with “.mine” added to its name.</Alert>
                </Show>
              </>
            )}
          </Show>
        </div>
        <div class="sa-dialog__footer">
          <Button onClick={() => props.onClose()}>Close</Button>
          <Button variant="obsidian" disabled={view().phase !== 'ready'} onClick={() => props.onConfirm()}>Update now</Button>
        </div>
      </div>
    </Modal>
    </Portal>
  );
}
