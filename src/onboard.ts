// Pure onboarding logic (no DOM): which first-run screen shows for a
// config, and cursor movement over the pick rows. Tested in onboard.test.ts.
export type OnboardStep = 'who' | 'project' | null;

/** Gate: worker first, then project. A skipped worker counts as set. */
export function onboardStep(
  worker: string | null,
  project: string | null,
  skipped: boolean,
): OnboardStep {
  if (!worker && !skipped) return 'who';
  if (!project) return 'project';
  return null;
}

/** Clamp a cursor move over len rows (-1 when empty). */
export function moveSel(sel: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  const next = sel < 0 ? (delta > 0 ? 0 : len - 1) : sel + delta;
  return Math.max(0, Math.min(len - 1, next));
}
