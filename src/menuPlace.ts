// Keeps popup menus inside the window. A menu is first dropped below its trigger,
// right-aligned; this then measures it and shifts it back inside the viewport,
// flips it above the trigger when there is more room there, and caps its height
// (scrolling inside) when neither side fits it.
const EDGE = 8;

/** Place a `position: fixed` menu under (or over) `anchor`, aligned to its right edge. */
export function placeFixed(menu: HTMLElement, anchor: DOMRect, gap = 6): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.maxHeight = '';
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.min(Math.max(EDGE, anchor.right - w), Math.max(EDGE, vw - w - EDGE));
  const below = vh - anchor.bottom - gap - EDGE;
  const above = anchor.top - gap - EDGE;
  const useAbove = h > below && above > below;
  const room = useAbove ? above : below;
  const height = Math.min(h, Math.max(room, 120));
  menu.style.right = 'auto';
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(useAbove ? anchor.top - gap - height : anchor.bottom + gap)}px`;
  if (h > room) {
    menu.style.maxHeight = `${Math.round(height)}px`;
    menu.style.overflowY = 'auto';
  }
}

/** Nudge an absolutely positioned picker list (opens up or down from its trigger) back inside the window. */
export function placePicker(list: HTMLElement, trigger: HTMLElement): void {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const t = trigger.getBoundingClientRect();
  const r = list.getBoundingClientRect();
  const wantsDown = r.bottom > vh - EDGE && t.top - r.height - 4 >= EDGE;
  const wantsUp = r.top < EDGE && vh - t.bottom - 4 - r.height >= EDGE;
  if (wantsDown || wantsUp) {
    const down = wantsUp;
    list.style.bottom = down ? 'auto' : `calc(100% + 4px)`;
    list.style.top = down ? 'calc(100% + 4px)' : 'auto';
  }
  const r2 = list.getBoundingClientRect();
  if (r2.left < EDGE) {
    list.style.right = 'auto';
    list.style.left = `${EDGE - t.left}px`;
  } else if (r2.right > vw - EDGE) {
    list.style.left = 'auto';
    list.style.right = `${t.right - (vw - EDGE)}px`;
  }
  const r3 = list.getBoundingClientRect();
  const room = Math.max(120, Math.min(r3.bottom, vh - EDGE) - Math.max(r3.top, EDGE));
  if (r3.height > room) list.style.maxHeight = `${Math.round(room)}px`;
}
