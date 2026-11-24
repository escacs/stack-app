// Smooth scrolling via Lenis, set up like Mel's other app Chair
// (dc/apps/desktop/src/components/smooth-scroll.tsx): lerp 0.075, nested scroll
// allowed, automatic frames, skipped under prefers-reduced-motion. The shell's
// sheet (`main#app`) is the page scroller here, not the window, so Lenis drives
// that element as its wrapper. Lenis's lerp is time-corrected, so the glide
// follows the display's refresh rate.
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

let lenis: Lenis | null = null;
let current: HTMLElement | null = null;

const sheet = (): HTMLElement | null => document.getElementById('app');

/** Attach Lenis to the sheet once it exists (App calls this after first render); returns a detach function. */
export function attachSmooth(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  let raf = 0;
  const attach = () => {
    const el = sheet();
    if (!el) {
      raf = requestAnimationFrame(attach);
      return;
    }
    // The sheet has a fixed, window-derived height while its content changes with
    // every route and load, and Lenis's ResizeObservers only see the sheet's own
    // box: naiveDimensions reads the live scrollHeight instead, so the scroll
    // limit never goes stale (a stale limit of 0 would swallow every wheel).
    lenis = new Lenis({ wrapper: el, content: el, lerp: 0.075, allowNestedScroll: true, autoRaf: true, naiveDimensions: true });
    current = el;
  };
  attach();
  return () => {
    cancelAnimationFrame(raf);
    lenis?.destroy();
    lenis = null;
    current = null;
  };
}

/** Route changes and narrow-screen jumps go to the top at once, without gliding. */
export function scrollToTop(): void {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else sheet()?.scrollTo({ top: 0, behavior: 'instant' });
}

/** Page-by keys glide through Lenis so the smooth scroll stays in one driver. */
export function scrollByPage(dy: number): void {
  if (lenis && current) lenis.scrollTo(current.scrollTop + dy);
  else sheet()?.scrollBy({ top: dy, behavior: 'smooth' });
}
