// Toasts for stack mutations, with Undo that really runs. Pure planning lives
// in undo.ts; this wires an Outcome to a toast and, when the outcome has an
// inverse, to the stack commands that perform it. Undo runs against the
// project the action ran in (captured), however the user navigated since.
import { errText, stackRun } from './bridge';
import { fromStackOut } from './json';
import { humanizeCliError, nameIds, oneSentence } from './humanize';
import { config, refreshLock, refreshReport } from './store';
import { pushToast } from './toast';
import type { Outcome, UndoStep } from './undo';
import { listIds } from './undo';

type Ctx = { project: string; stackPath: string | null };

/** The project and stack the next operation runs against, or null with no project. */
export function opCtx(): Ctx | null {
  const c = config();
  return c?.project ? { project: c.project, stackPath: c.stackPath } : null;
}

/** Run undo steps in order. Stops at the first failure and reports what was and was not undone. */
export async function runUndo(ctx: Ctx, steps: readonly UndoStep[], doneTitle: string): Promise<boolean> {
  const done: string[] = [];
  try {
    for (const s of steps) {
      fromStackOut(await stackRun(s.sub, s.args, ctx.project, ctx.stackPath));
      done.push(s.id);
    }
  } catch (err) {
    pushToast({
      tone: 'error',
      title: 'Could not undo',
      description: `${oneSentence(humanizeCliError(errText(err)))}${done.length ? ` Undone so far: ${nameIds(listIds(done))}.` : ''}`,
    });
    return false;
  } finally {
    // Same project still open: rows and the set-up slot must catch up.
    if (config()?.project === ctx.project) {
      await refreshLock();
      await refreshReport();
    }
  }
  pushToast({ tone: 'success', title: doneTitle });
  return true;
}

/** Show an operation's outcome; its Undo button exists only when the outcome planned one. */
export function toastOutcome(o: Outcome, ctx: Ctx | null = opCtx()): number {
  const steps = o.undo;
  return pushToast({
    tone: o.tone,
    title: nameIds(o.title),
    description: o.description ? nameIds(o.description) : o.description,
    action:
      steps && ctx
        ? {
            label: 'Undo',
            run: async () => {
              await runUndo(ctx, steps, o.undone ?? `Undid: ${o.title}`);
            },
          }
        : undefined,
  });
}

/**
 * A failed operation: one error toast in plain words (what went wrong, then the
 * next step). The raw text never reaches a toast; the page's error panel keeps
 * it behind "Show technical details". An unknown cause keeps the caller's title.
 */
export function toastFailure(title: string, err: unknown, subject?: string | null): number {
  const h = humanizeCliError(errText(err), { subject });
  return pushToast({
    tone: 'error',
    title: h.known ? h.title : nameIds(title),
    description: h.known ? h.next : 'Open the details on the page, or try again.',
  });
}
