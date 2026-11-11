// Smooth scrolling via Lenis, matching Mel's other app Chair
// (dc/apps/desktop/src/components/smooth-scroll.tsx): same lerp 0.075,
// nested scroll allowed, automatic frames, skipped under
// prefers-reduced-motion, destroyed on cleanup. This replaces the
// hand-rolled wheel interpolator (glide.ts). stack-app scrolls the
// document, so Lenis runs on the default window scroller.
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

let lenis: Lenis | null = null;

/** Attach Lenis to the window scroller; returns a detach function. */
export function attachSmooth(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  lenis = new Lenis({ lerp: 0.075, allowNestedScroll: true, autoRaf: true });
  return () => {
    lenis?.destroy();
    lenis = null;
  };
}

/** Route changes jump to the top at once instead of fighting the glide. */
export function scrollToTop(): void {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else window.scrollTo({ top: 0, behavior: 'instant' });
}

/** Page-by keys glide through Lenis so the smooth scroll stays in one driver. */
export function scrollByPage(dy: number): void {
  if (lenis) lenis.scrollTo(window.scrollY + dy);
  else window.scrollBy({ top: dy, behavior: 'smooth' });
}

/**
 * Keyboard-cursor follow with `block: 'nearest'` semantics: rows above the
 * viewport align their top, rows below align their bottom, visible rows stay
 * put. Immediate either way, like before.
 */
export function scrollRowIntoView(el: Element): void {
  const rect = el.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
  const target = rect.top < 0 ? window.scrollY + rect.top : window.scrollY + (rect.bottom - window.innerHeight);
  if (lenis) lenis.scrollTo(target, { immediate: true });
  else window.scrollTo({ top: target, behavior: 'instant' });
}
