// One custom tooltip for the whole app, in place of the webview's native `title` bubble (slow, unstyled, never
// themed, and absent for keyboard focus). Every `title` is moved to `data-tip` the moment it is set, whether by
// markup or by Solid calling setAttribute/removeAttribute, so the native bubble can never appear (not even while
// the pointer rests on an element after a click) and a cleared title clears its tip. An icon-only control keeps its
// accessible name through aria-label. The bubble shows after a short delay on hover and on keyboard focus; a click,
// scrolling and a key press hide it (Esc is never swallowed).
const SHOW_MS = 800;
const WARM_MS = 300;
const GAP = 8;
const EDGE = 8;
/** Targets bigger than this (a whole row, a wide bar) get the bubble beside the pointer, not centred on them. */
const BIG_W = 220;
const BIG_H = 44;

let tip: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let timer = 0;
let lastHidden = 0;
let pointer = { x: 0, y: 0 };

const proto = Element.prototype;
const nativeSet = proto.setAttribute;
const nativeRemove = proto.removeAttribute;

const ensure = (): HTMLDivElement => {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.id = 'app-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
};

const titled = (el: EventTarget | null): HTMLElement | null =>
  el instanceof Element ? el.closest<HTMLElement>('[data-tip]:not([data-tip=""])') : null;

/** Give `el` a tip (replacing any title). aria-label is filled in only for controls with no other name, and kept in step. */
function setTip(el: Element, text: string) {
  const h = el as HTMLElement;
  nativeRemove.call(el, 'title');
  if (!text.trim()) return clearTip(el);
  h.dataset.tip = text;
  if (h.dataset.tipAria === '1' || (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !(el.textContent ?? '').trim())) {
    nativeSet.call(el, 'aria-label', text);
    h.dataset.tipAria = '1';
  }
}

function clearTip(el: Element) {
  const h = el as HTMLElement;
  if (!h.dataset) return;
  delete h.dataset.tip;
  if (h.dataset.tipAria === '1') {
    nativeRemove.call(el, 'aria-label');
    delete h.dataset.tipAria;
  }
  if (el === target) hideTip();
}

function adoptTree(root: Element) {
  if (root.hasAttribute('title')) setTip(root, root.getAttribute('title') ?? '');
  root.querySelectorAll('[title]').forEach((el) => setTip(el, el.getAttribute('title') ?? ''));
}

function place(el: HTMLElement, box: HTMLElement) {
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const big = r.width > BIG_W || r.height > BIG_H;
  let left: number;
  let top: number;
  if (big) {
    // Beside the pointer, below-right, so it neither covers the neighbours nor floats far away.
    left = pointer.x + 12;
    top = pointer.y + 18;
    if (left + w > vw - EDGE) left = pointer.x - w - 12;
    if (top + h > vh - EDGE) top = pointer.y - h - 12;
    box.dataset.side = 'pointer';
  } else {
    left = r.left + r.width / 2 - w / 2;
    const above = r.top - h - GAP >= EDGE;
    top = above ? r.top - h - GAP : r.bottom + GAP;
    box.dataset.side = above ? 'top' : 'bottom';
  }
  box.style.left = `${Math.round(Math.min(Math.max(EDGE, left), vw - w - EDGE))}px`;
  box.style.top = `${Math.round(Math.min(Math.max(EDGE, top), vh - h - EDGE))}px`;
}

/** Point the target's aria-describedby at the bubble, keeping whatever ids it already had. */
function describe(el: HTMLElement, on: boolean) {
  const id = 'app-tooltip';
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== id);
  if (on) ids.push(id);
  if (ids.length) nativeSet.call(el, 'aria-describedby', ids.join(' '));
  else nativeRemove.call(el, 'aria-describedby');
}

export function hideTip() {
  clearTimeout(timer);
  if (tip && !tip.hidden) {
    tip.hidden = true;
    lastHidden = Date.now();
  }
  if (target) describe(target, false);
  target = null;
}

function show(el: HTMLElement) {
  const text = el.dataset.tip;
  if (!text || target !== el || !el.isConnected) return;
  const box = ensure();
  describe(el, true);
  box.textContent = text;
  box.hidden = false;
  place(el, box);
}

function arm(el: HTMLElement, instant = false) {
  if (el === target) return;
  hideTip();
  target = el;
  const warm = Date.now() - lastHidden < WARM_MS;
  timer = window.setTimeout(() => show(el), instant ? 0 : warm ? 150 : SHOW_MS);
}

/** Install the delegated listeners once; returns a cleanup. */
export function initTooltips(): () => void {
  // Titles are redirected at the source: Solid's setAttribute('title', …) / removeAttribute('title') never reach the DOM.
  proto.setAttribute = function (this: Element, name: string, value: string) {
    if (name.toLowerCase() === 'title') return setTip(this, String(value));
    return nativeSet.call(this, name, value);
  };
  proto.removeAttribute = function (this: Element, name: string) {
    if (name.toLowerCase() === 'title') clearTip(this);
    return nativeRemove.call(this, name);
  };
  adoptTree(document.documentElement);
  // Titles that arrive in markup (templates, innerHTML) rather than through setAttribute.
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        const el = r.target as Element;
        if (el.hasAttribute('title')) setTip(el, el.getAttribute('title') ?? '');
      } else {
        r.addedNodes.forEach((n) => n instanceof Element && adoptTree(n));
      }
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  const over = (ev: PointerEvent) => {
    pointer = { x: ev.clientX, y: ev.clientY };
    if (target && !target.isConnected) hideTip();
    if (ev.pointerType === 'touch') return;
    const el = titled(ev.target);
    if (!el) {
      if (target) hideTip();
      return;
    }
    arm(el);
  };
  const out = (ev: PointerEvent) => {
    const to = ev.relatedTarget;
    if (target && to instanceof Node && target.contains(to)) return;
    if (target) hideTip();
  };
  const focus = (ev: FocusEvent) => {
    // Only keyboard focus: a mouse click already shows the pointer's bubble.
    const el = titled(ev.target);
    if (el && (ev.target as HTMLElement).matches?.(':focus-visible')) arm(el);
  };
  const hide = () => hideTip();
  document.addEventListener('pointerover', over, true);
  document.addEventListener('pointerout', out, true);
  document.addEventListener('focusin', focus, true);
  document.addEventListener('focusout', hide, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  return () => {
    proto.setAttribute = nativeSet;
    proto.removeAttribute = nativeRemove;
    mo.disconnect();
    document.removeEventListener('pointerover', over, true);
    document.removeEventListener('pointerout', out, true);
    document.removeEventListener('focusin', focus, true);
    document.removeEventListener('focusout', hide, true);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('keydown', hide, true);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    hideTip();
    tip?.remove();
    tip = null;
  };
}
