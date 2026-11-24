// Modal bookkeeping shared by the confirm dialog, the palette and the help
// overlay: while any is open the shell is inert (no focus, no clicks, hidden
// from assistive tech) and page-level hotkeys stay quiet. Each modal also
// stops its own keydowns at its root, so window listeners (Browse's single
// letter keys, the `/` search) never see keys typed inside a modal.
import { createSignal } from 'solid-js';

const [count, setCount] = createSignal(0);

/** True while any modal is open. */
export const modalOpen = (): boolean => count() > 0;

/** Lock the page behind a modal; returns the unlock function (idempotent). */
export function lockPage(): () => void {
  setCount((n) => n + 1);
  document.getElementById('shell')?.setAttribute('inert', '');
  let done = false;
  return () => {
    if (done) return;
    done = true;
    setCount((n) => n - 1);
    if (count() === 0) document.getElementById('shell')?.removeAttribute('inert');
  };
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Keep Tab inside `root`: wraps from the last focusable to the first and back. */
export function trapTab(root: HTMLElement, ev: KeyboardEvent): void {
  if (ev.key !== 'Tab') return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) {
    ev.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (ev.shiftKey && (active === first || !root.contains(active))) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && (active === last || !root.contains(active))) {
    ev.preventDefault();
    first.focus();
  }
}

/** Hand focus back to the opener; if it is gone (its row was removed) land on the page sheet instead. */
export function returnFocus(el: Element | null): void {
  if (el instanceof HTMLElement && el.isConnected && !el.hasAttribute('disabled')) {
    el.focus();
    return;
  }
  const main = document.getElementById('app');
  if (main) {
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
  }
}
