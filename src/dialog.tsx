// Modal pieces, the stack-alabaster look. `Modal` is the shared shell for the
// confirm dialog, the command palette and the shortcuts sheet: it locks the
// page (inert shell), traps Tab, closes on Esc or a backdrop press, keeps its
// keystrokes away from page hotkeys, and hands focus back to the opener.
// `confirmDialog()` is the imperative alert dialog: it resolves true on
// confirm, false on cancel / Esc / backdrop. Classes are the vendored
// `sa-dialog*` ones (src/styles/stack-alabaster/dialog.css), used unchanged.
import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { lockPage, returnFocus, trapTab } from './modal';
import { Button } from './ui';

/**
 * Backdrop plus a content slot. Keydowns are handled natively at the root and
 * stopped there, so write inner key handlers with `on:keydown` (Solid's
 * delegated `onKeyDown` would never see them).
 */
export function Modal(props: { onClose: () => void; children: JSX.Element; initialFocus?: () => HTMLElement | null | undefined }) {
  const [entered, setEntered] = createSignal(false);
  let root!: HTMLDivElement;
  const opener = document.activeElement;
  const unlock = lockPage();

  onMount(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        props.onClose();
      } else {
        const content = root.querySelector<HTMLElement>('[data-modal-content]');
        if (content) trapTab(content, ev);
      }
      ev.stopPropagation();
    };
    root.addEventListener('keydown', onKey);
    onCleanup(() => root.removeEventListener('keydown', onKey));
    // Focus lands after the shell is inert, so nothing behind can keep it.
    queueMicrotask(() => {
      const first = props.initialFocus?.() ?? root.querySelector<HTMLElement>('[data-modal-content]');
      first?.focus({ preventScroll: true });
    });
  });
  onCleanup(() => {
    unlock();
    returnFocus(opener);
  });

  return (
    <div ref={root} class="modal-root" data-entered={entered() ? '' : undefined}>
      <div class="sa-dialog__backdrop" data-starting-style={entered() ? undefined : ''} onPointerDown={() => props.onClose()} />
      {props.children}
    </div>
  );
}

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Bulleted detail under the description (for example the edited files that would be kept). */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const [pending, setPending] = createSignal<Pending | null>(null);

/** Ask before a destructive action. One dialog at a time; a second ask while one is open answers false. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (pending()) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => setPending({ ...opts, resolve }));
}

/** Mounted once by App, beside the shell. */
export function DialogHost() {
  return <Show when={pending()}>{(p) => <ConfirmSheet req={p()} />}</Show>;
}

function ConfirmSheet(props: { req: Pending }) {
  const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  const [entered, setEntered] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  let cancelBtn: HTMLButtonElement | undefined;
  onMount(() => requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true))));
  const finish = (ok: boolean) => {
    if (closing()) return;
    setClosing(true);
    props.req.resolve(ok);
    // Let the exit transition play, then unmount (which returns focus).
    setTimeout(() => setPending(null), 140);
  };
  const destructive = () => (props.req.tone ?? 'default') === 'destructive';
  return (
    <Modal onClose={() => finish(false)} initialFocus={() => cancelBtn}>
      <div
        class="sa-dialog__content"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        tabindex="-1"
        data-modal-content
        data-tone={destructive() ? 'destructive' : 'default'}
        data-starting-style={entered() ? undefined : ''}
        data-ending-style={closing() ? '' : undefined}
      >
        <div class="sa-dialog__header">
          <h2 class="sa-dialog__title" id={`${id}-t`}>{props.req.title}</h2>
          <div id={`${id}-d`}>
            <Show when={props.req.description}>
              <p class="sa-dialog__description">{props.req.description}</p>
            </Show>
            <Show when={props.req.details?.length}>
              <ul class="dialog-details">
                <For each={props.req.details}>{(d) => <li>{d}</li>}</For>
              </ul>
            </Show>
          </div>
        </div>
        <div class="sa-dialog__footer">
          <Button ref={cancelBtn} onClick={() => finish(false)}>{props.req.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={destructive() ? 'danger' : 'obsidian'} onClick={() => finish(true)}>
            {props.req.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
