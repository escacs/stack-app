// Pure onboarding and top-bar logic (no DOM): which first-run screen shows
// for a config, cursor movement over the pick rows, and the short project
// path shown in the top bar. Tested in onboard.test.ts.
export type OnboardStep = 'who' | 'project' | null;

/**
 * Gate: worker first, then project, every launch. Nothing is remembered; the
 * shell opens once both were answered this session (whoDone / projectDone),
 * and a new user re-asks the project. A skipped worker counts as set.
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
