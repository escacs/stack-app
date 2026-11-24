// Action registry: the one place a view hands the palette (and the shortcuts)
// the exact function its button calls, so there is no second copy of any
// logic. A view registers while it is mounted and disposes on cleanup; the
// most recently registered handler for an id wins (an open entry page takes
// `import-selected` from the list behind it, and hands it back on close).
//
// Non-idempotent actions (send to T3, restore missing files, update, plan
// open) also share one in-flight guard per id: a shortcut, palette entry or
// button that fires while the same action runs (or in the instant after) is
// ignored. Buttons call `runGuarded` with the same id, so every path shares one
// lock. What a guard does NOT do is decide availability: a reason must come
// from the page ("Already running", a view's own rule), never from the palette
// being open over it.
import { createSignal, onCleanup } from 'solid-js';
import { createGuard } from './guard';

export type ActionHandler = {
  run: () => unknown;
  /** Why it cannot run right now; null or absent when it can. */
  reason?: () => string | null;
  /** The palette title naming what it acts on (`Import ponytail`); absent: the command's own title. */
  title?: () => string | null;
  /** Not safe to repeat: guard it against a double fire (button, shortcut, palette). */
  guard?: boolean;
};

const [registry, setRegistry] = createSignal<Record<string, ActionHandler[]>>({});
const [runningIds, setRunningIds] = createSignal<ReadonlySet<string>>(new Set());
const guard = createGuard({ onChange: setRunningIds });

/** Reactive: true while the id's guarded action is in flight (drive a button's pending state). */
export const isRunning = (id: string): boolean => runningIds().has(id);

/** Run `fn` under the id's lock; resolves false (and does nothing) when it is already running or just ran. */
export const runGuarded = (id: string, fn: () => unknown): Promise<boolean> => guard.run(id, fn);

/** Register for the current component's lifetime (call during setup). */
export function useAction(id: string, handler: ActionHandler): void {
  const h: ActionHandler = handler.guard
    ? {
        ...handler,
        run: () => void runGuarded(id, handler.run),
        // Availability is judged against the page underneath, never against an
        // open overlay: the palette and the shortcuts sheet are themselves
        // modals (modal.ts), so asking `modalOpen()` here would report every
        // guarded command as unavailable for the sole reason that the palette
        // listing it is open. A real dialog makes the page inert and keeps the
        // palette shut (overlays.ts), so it never needs a reason here.
        reason: () => (isRunning(id) ? 'Already running' : handler.reason?.() ?? null),
      }
    : handler;
  setRegistry((r) => ({ ...r, [id]: [...(r[id] ?? []), h] }));
  onCleanup(() =>
    setRegistry((r) => {
      const rest = (r[id] ?? []).filter((x) => x !== h);
      return { ...r, [id]: rest };
    }),
  );
}

/** The live handler for an id, if any view currently offers it. */
export function actionFor(id: string): ActionHandler | undefined {
  const list = registry()[id];
  return list && list.length ? list[list.length - 1] : undefined;
}

/**
 * The actions only one page can run, and the page that offers them. A
 * command built from one of these has no meaning anywhere else: the palette
 * hides it instead of listing it dimmed with "Open Browse first" beside it.
 * The registry is the source of truth — a view registers on mount and
 * disposes on cleanup, so a live handler *is* "this page is the current one".
 */
export const PAGE_ACTIONS: Readonly<Record<string, string>> = {
  'import-selected': 'Browse',
  'dry-run': 'Browse',
  'browse-clear-filters': 'Browse',
  'browse-cycle-sort': 'Browse',
  'send-thread': 'Entry',
  'update-all': 'Project',
  'review-changes': 'Project',
  'sync-missing': 'Project',
  'check-updates': 'Updates',
};

/** The page an action belongs to (a global action has none). */
export const pageOf = (id: string): string | undefined => PAGE_ACTIONS[id];

/** True when the id is a page action: it exists only while its page is open. */
export const isPageAction = (id: string): boolean => Object.prototype.hasOwnProperty.call(PAGE_ACTIONS, id);

/**
 * True when the id can be offered right now: a global action always, a page
 * action only while a view has registered it (its page is the current route).
 */
export const isLive = (id: string): boolean => !isPageAction(id) || !!actionFor(id);
