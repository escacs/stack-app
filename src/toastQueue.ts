// Pure toast queue and stack geometry (no DOM): newest first, capped, and the
// per-card offsets the stack-alabaster toast CSS reads (--toast-index,
// --toast-offset, ...). Tested in toastQueue.test.ts.
export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type ToastItem = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; run: () => void | Promise<void> };
  /** ms before it dismisses itself; hover/focus pauses it. */
  ttl: number;
};

/** Newest first. Over the cap, the oldest cards drop off (returned so callers can clean up). */
export function enqueue(list: readonly ToastItem[], item: ToastItem, cap = 5): { list: ToastItem[]; dropped: ToastItem[] } {
  const next = [item, ...list];
  return { list: next.slice(0, cap), dropped: next.slice(cap) };
}

export function remove(list: readonly ToastItem[], id: number): ToastItem[] {
  return list.filter((t) => t.id !== id);
}

export type Geometry = {
  /** Per toast (same order): sum of the heights of the cards in front of it. */
  offsets: number[];
  frontHeight: number;
  stackHeight: number;
};

/** Heights are the cards' natural heights, front card first; a missing height counts as 0. */
export function geometry(heights: readonly (number | undefined)[]): Geometry {
  const offsets: number[] = [];
  let sum = 0;
  for (const h of heights) {
    offsets.push(sum);
    sum += h ?? 0;
  }
  return { offsets, frontHeight: heights[0] ?? 0, stackHeight: sum };
}
