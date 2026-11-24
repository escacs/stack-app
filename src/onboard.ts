// Pure onboarding and top-bar logic (no DOM): which first-run screen shows
// for a config, what a launch keeps of the remembered answers, cursor movement over the pick rows, and the short project
// path shown in the top bar. Tested in onboard.test.ts.
export type OnboardStep = 'who' | 'project' | null;

/**
 * Gate: worker first, then project. Both are remembered across launches
 * (the shell reconciles them at boot, see reconcileRemembered), so the shell
 * opens straight away when both are set and still valid. whoDone /
 * projectDone are false only while the user is switching (the remembered
 * answer stays preselected); a skipped worker counts as set.
 */
export function onboardStep(
  worker: string | null,
  project: string | null,
  skipped: boolean,
  whoDone = true,
  projectDone = true,
): OnboardStep {
  if (!whoDone || (!worker && !skipped)) return 'who';
  if (!projectDone || !project) return 'project';
  return null;
}

export type Remembered = { worker: string | null; project: string | null };

/**
 * What survives from the remembered worker and project at launch. A worker
 * the stack no longer lists, or a project folder that is gone or no longer
 * valid, is dropped (so only that step shows again). `workerNames` null means
 * the list could not be read: the worker is kept, unverifiable is not wrong.
 * `projectValid` null means the project was not checked (none remembered).
 */
export function reconcileRemembered(input: {
  worker: string | null;
  project: string | null;
  workerNames: readonly string[] | null;
  projectValid: boolean | null;
}): Remembered & { droppedWorker: string | null; droppedProject: string | null } {
  const workerOk = !input.worker || !input.workerNames || input.workerNames.includes(input.worker);
  const projectOk = !input.project || input.projectValid !== false;
  return {
    worker: workerOk ? input.worker : null,
    project: projectOk ? input.project : null,
    droppedWorker: workerOk ? null : input.worker,
    droppedProject: projectOk ? null : input.project,
  };
}

/** Clamp a cursor move over len rows (-1 when empty). */
export function moveSel(sel: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  const next = sel < 0 ? (delta > 0 ? 0 : len - 1) : sel + delta;
  return Math.max(0, Math.min(len - 1, next));
}

/**
 * Top-bar path: the last two segments behind an ellipsis when the path is
 * deeper than two levels, otherwise the path itself. Trailing slashes are
 * dropped; the root stays `/`.
 */
export function shortPath(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length > 2) return `…/${parts.slice(-2).join('/')}`;
  const lead = /^[\\/]/.test(p) ? '/' : '';
  return lead + parts.join('/');
}
