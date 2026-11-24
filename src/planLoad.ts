// Loads an import plan: one dry run per entry (or one preset apply dry run),
// then each imported entry's file list from `show`, folded into the file-level
// Plan (plan.ts). Reads only; nothing is written. File lists are cached per
// stack checkout so re-opening a plan does not spawn `show` again.
import { stackRun } from './bridge';
import { fromStackOut, importDryRunArgs, toShowDoc, type ShowJson } from './json';
import { buildTarget, importedFiles, planCounts, type DryJson, type Plan, type PlanTarget } from './plan';

export { mergePlans } from './plan';

type Ctx = { project: string; stackPath: string | null };
type Listing = { files: { path: string; size: number }[]; payload: string | null };

const listings = new Map<string, Promise<Listing | null>>();

/** Drop cached file lists (a catalog refresh). */
export const clearListings = (): void => listings.clear();

function listingOf(ctx: Ctx, id: string): Promise<Listing | null> {
  const key = `${ctx.stackPath ?? ''}\n${id}`;
  let hit = listings.get(key);
  if (!hit) {
    hit = stackRun('show', [id, '--json'], ctx.project, ctx.stackPath).then(
      (out) => {
        const d = toShowDoc(fromStackOut<ShowJson>(out));
        const p = d.manifest['payload'];
        return { files: d.files, payload: typeof p === 'string' && p ? p : null };
      },
      () => null,
    );
    listings.set(key, hit);
  }
  return hit;
}

/** Turn a dry run's answer into a Plan, reading each imported entry's files. */
export async function planFromDry(ctx: Ctx, dry: DryJson): Promise<Plan> {
  const conflicts = dry.conflicts ?? [];
  const targets: PlanTarget[] = await Promise.all(
    dry.imported.map(async (i) => {
      const l = await listingOf(ctx, i.id);
      // An entry whose files cannot be listed still shows its destination and collisions.
      const files = l ? importedFiles(l.files, l.payload) : [];
      // The entry's own count (docs and manifest included) travels with the
      // target, so the plan header can say `4 files · 2 copied` instead of
      // contradicting the entry's page with `2 files`.
      return buildTarget({ id: i.id, dest: i.path, requiredBy: i.requiredBy, entryFiles: l?.files.length }, files, conflicts);
    }),
  );
  const counts = planCounts(targets);
  return {
    targets,
    already: [...dry.already],
    gitignore: dry.gitignore === 'updated',
    selectedCount: counts.selected,
    requiredCount: counts.required,
  };
}

/**
 * The plan for importing one entry (optionally into `dest`), including its
 * dependencies. `dest` comes from `resolveDestination` (json.ts), the one
 * place a folder is decided, so this plan and the entry's own page agree.
 */
export async function planImport(ctx: Ctx, id: string, dest: string): Promise<Plan> {
  const out = await stackRun('import', importDryRunArgs(id, dest), ctx.project, ctx.stackPath);
  return planFromDry(ctx, fromStackOut<DryJson>(out));
}
