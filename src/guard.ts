// In-flight guard for non-idempotent actions (no DOM, no Solid): an id that
// is running refuses a second start, and for a short settle window after it
// finishes too, so a held or mashed shortcut cannot fire it twice. Tested in
// guard.test.ts.
export type Guard = {
  /** Claim the id; false while it runs or is settling. Pair with finish(). */
  start: (id: string) => boolean;
  finish: (id: string) => void;
  /** True while the id is in flight (not during the settle window). */
  running: (id: string) => boolean;
  /** start → fn → finish; resolves false when refused. Errors propagate after finish. */
  run: (id: string, fn: () => unknown) => Promise<boolean>;
};

export const SETTLE_MS = 700;

export function createGuard(opts: { now?: () => number; settleMs?: number; onChange?: (running: ReadonlySet<string>) => void } = {}): Guard {
  const now = opts.now ?? Date.now;
  const settleMs = opts.settleMs ?? SETTLE_MS;
  const inflight = new Set<string>();
  const doneAt = new Map<string, number>();
  const emit = () => opts.onChange?.(new Set(inflight));

  const start = (id: string): boolean => {
    if (inflight.has(id)) return false;
    const t = doneAt.get(id);
    if (t !== undefined && now() - t < settleMs) return false;
    inflight.add(id);
    emit();
    return true;
  };
  const finish = (id: string): void => {
    if (!inflight.delete(id)) return;
    doneAt.set(id, now());
    emit();
  };
  const run: Guard['run'] = async (id, fn) => {
    if (!start(id)) return false;
    try {
      await fn();
    } finally {
      finish(id);
    }
    return true;
  };
  return { start, finish, running: (id) => inflight.has(id), run };
}
