// Wheel glide: momentum scrolling for the window. Mouse wheels scroll in
// discrete notches; this interpolates them into a glide. Trackpads (small
// fractional deltas), zoom gestures, reduced-motion users, page-mode deltas
// and wheels over a nested element that can still scroll are left alone.
// Keyboard and programmatic scrolls are not handled here.
//
// Writes use `behavior: 'instant'`: app.css sets `scroll-behavior: smooth` on
// html, so a plain `scrollTop = y` would start a new smooth animation every
// frame, which lags behind the lerp and fights it.

const LERP = 0.18;
/** Pixels per wheel "line" (deltaMode 1, e.g. Firefox on Linux). */
const LINE_PX = 16;
/** Movement we did not make ourselves beyond this counts as external. */
const EXTERNAL_TOLERANCE_PX = 1;

/** One lerp step toward the target (snaps inside half a pixel). */
export function glideStep(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return current;
  const next = current + (target - current) * LERP;
  return Math.abs(target - next) < 0.5 ? target : next;
}

/** True for deltas that are already smooth (trackpads): leave them be. */
export function isSmoothDelta(deltaY: number): boolean {
  return !Number.isFinite(deltaY) || deltaY === 0 || Math.abs(deltaY) < 4 || deltaY % 1 !== 0;
}

/** A wheel delta in CSS px; NaN for page-mode deltas (left to the browser). */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 0) return deltaY;
  if (deltaMode === 1) return deltaY * LINE_PX;
  return NaN;
}

/** Clamp a target into [0, max]; nothing scrollable pins it to 0. */
export function clampTarget(y: number, max: number): number {
  if (!(max > 0) || Number.isNaN(y)) return 0;
  return Math.min(max, Math.max(0, y));
}

/** Scrollable distance of the window: content height minus the viewport. */
export function scrollMax(scrollHeight: number, viewportHeight: number): number {
  return Math.max(0, scrollHeight - viewportHeight);
}

/**
 * True when the window is somewhere other than where we last wrote it: a
 * scrollbar drag, a keyboard or anchor scroll, a route change, or a clamp
 * after resize or shrink. Our own writes read back equal, so they never
 * count.
 */
export function isExternalScroll(actual: number, written: number): boolean {
  return Math.abs(actual - written) > EXTERNAL_TOLERANCE_PX;
}

/** Whether a scroller at this position can still move in the wheel's direction. */
export function canScrollFurther(deltaY: number, scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  if (deltaY < 0) return scrollTop > 0;
  return scrollTop + clientHeight < scrollHeight - 1;
}

/** Write an absolute window scroll that ignores CSS `scroll-behavior`. */
function writeScroll(y: number): void {
  try {
    window.scrollTo({ top: y, behavior: 'instant' });
  } catch {
    // Engines without 'instant': suspend the page's smooth scroll for this one write.
    const style = document.documentElement.style;
    const prev = style.scrollBehavior;
    style.scrollBehavior = 'auto';
    document.documentElement.scrollTop = y;
    style.scrollBehavior = prev;
  }
}

/**
 * True when the closest vertically scrollable ancestor of the wheel target
 * can still take this wheel, so the native scroll should win.
 */
function nestedScrollerTakes(start: EventTarget | null, deltaY: number): boolean {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.documentElement && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight) {
      return canScrollFurther(deltaY, el.scrollTop, el.clientHeight, el.scrollHeight);
    }
    el = el.parentElement;
  }
  return false;
}

/** Attach the wheel interceptor; returns a detach function. */
export function attachGlide(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const root = document.documentElement;
  const max = () => scrollMax(root.scrollHeight, window.innerHeight);
  let target = window.scrollY;
  // Fractional glide position. The browser stores scroll offsets as whole
  // pixels, so lerping on scrollY stalls short of the target; lerp here and
  // write the rounded value instead.
  let pos = window.scrollY;
  // The pixel we last wrote (or rebased to). Anything else is external.
  let written = window.scrollY;
  let raf = 0;

  const rebase = () => {
    pos = window.scrollY;
    target = pos;
    written = pos;
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const tick = () => {
    raf = 0;
    const y = window.scrollY;
    if (isExternalScroll(y, written)) {
      // Someone else moved the page: abandon the glide from where it is now.
      rebase();
      return;
    }
    target = clampTarget(target, max());
    pos = glideStep(pos, target);
    const px = Math.round(pos);
    if (px !== y) {
      writeScroll(px);
      written = window.scrollY;
    }
    if (pos !== target) raf = requestAnimationFrame(tick);
  };

  const onScroll = () => {
    // Our own writes echo back as scroll events while a glide runs; anything
    // else cancels the glide and rebases the target onto the new position.
    if (raf && !isExternalScroll(window.scrollY, written)) return;
    stop();
    rebase();
  };

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const dy = wheelPixels(e.deltaY, e.deltaMode);
    if (isSmoothDelta(dy)) return;
    if (max() <= 0) return;
    if (nestedScrollerTakes(e.target, dy)) return;
    e.preventDefault();
    if (!raf || isExternalScroll(window.scrollY, written)) rebase();
    target = clampTarget(target + dy, max());
    if (!raf) raf = requestAnimationFrame(tick);
  };

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('scroll', onScroll);
    stop();
  };
}
