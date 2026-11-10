// Wheel glide: momentum scrolling for the window. Mouse wheels scroll in
// discrete notches; this interpolates them into a glide. Trackpads (small
// fractional deltas), zoom gestures and reduced-motion users are left
// alone. Pair with `scroll-behavior: smooth` for keyboard/programmatic
// scrolls; this module only handles wheel input.

/** One lerp step toward the target (snaps inside half a pixel). */
export function glideStep(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return current;
  const next = current + (target - current) * 0.18;
  return Math.abs(target - next) < 0.5 ? target : next;
}

/** True for deltas that are already smooth (trackpads): leave them be. */
export function isSmoothDelta(deltaY: number): boolean {
  return !Number.isFinite(deltaY) || deltaY === 0 || Math.abs(deltaY) < 4 || deltaY % 1 !== 0;
}

/** Attach the wheel interceptor; returns a detach function. */
export function attachGlide(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const root = document.documentElement;
  let target = window.scrollY;
  let raf = 0;
  const tick = () => {
    raf = 0;
    const next = glideStep(window.scrollY, target);
    if (next !== window.scrollY) root.scrollTop = next;
    if (next !== target) raf = requestAnimationFrame(tick);
  };
  const onScroll = () => {
    // Keyboard/space scrolls move without us: rebase the target so the
    // next wheel gesture continues from here instead of jumping back.
    if (!raf) target = window.scrollY;
  };
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.deltaMode !== 0) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (isSmoothDelta(e.deltaY)) return;
    const max = root.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    e.preventDefault();
    target = Math.max(0, Math.min(max, target + e.deltaY));
    if (!raf) raf = requestAnimationFrame(tick);
  };
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('scroll', onScroll);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}
