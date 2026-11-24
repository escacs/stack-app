// Presets as a catalog kind. A preset is a named bundle of stack entries, so
// Browse lists them beside the entry kinds and the sidebar counts them. This
// module owns the one `preset list --json` read (cached per project + stack
// checkout) and the preset import: its plan (a `preset apply --dry-run`,
// folded into the file-level Plan like any import) and the real apply. It
// reuses the CLI argument builders in json.ts and the plan loader in
// planLoad.ts; nothing here knows about Solid views.
import { createSignal } from 'solid-js';
import { errText, stackRun, type AppConfig } from './bridge';
import {
  fromStackOut,
  presetApplyArgs,
  presetListArgs,
  type PresetApplyJson,
  type PresetListItem,
  type PresetListJson,
} from './json';
import { planFromDry } from './planLoad';
import type { Plan } from './plan';

export type PresetsState = { key: string; presets: PresetListItem[]; error: string | null; loaded: boolean };

const keyOf = (c: AppConfig | null | undefined): string => `${c?.project ?? ''}\n${c?.stackPath ?? ''}`;

const [state, setState] = createSignal<PresetsState>({ key: '', presets: [], error: null, loaded: false });

export const presetsState = state;
export const presetCount = (): number => state().presets.length;

let asked = '';

/** Load the preset list once per project + stack path; `force` re-reads it (a catalog refresh). */
export async function ensurePresets(c: AppConfig | null | undefined, force = false): Promise<void> {
  if (!c?.project) return;
  const key = keyOf(c);
  if (key === asked && !force) return;
  asked = key;
  try {
    const out = await stackRun('preset', presetListArgs(), c.project, c.stackPath);
    if (key !== asked) return;
    setState({ key, presets: fromStackOut<PresetListJson>(out).presets, error: null, loaded: true });
  } catch (err) {
    if (key !== asked) return;
    setState({ key, presets: [], error: errText(err), loaded: true });
  }
}

/** The one-line summary a preset row shows: what it bundles (`5 entries`). */
export function presetSummary(p: Pick<PresetListItem, 'imports'>): string {
  const n = p.imports.length;
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/** Rows matching a typed query (name, description, member ids), every term required. */
export function filterPresets(list: readonly PresetListItem[], query: string): PresetListItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...list];
  return list.filter((p) => {
    const hay = `${p.name} ${p.description} ${p.imports.map((i) => i.id).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** The plan for importing a preset: its dry run, with each entry's files read. */
export async function planPreset(c: { project: string; stackPath: string | null }, name: string): Promise<Plan> {
  const out = await stackRun('preset', presetApplyArgs(name, true), c.project, c.stackPath);
  return planFromDry(c, fromStackOut<PresetApplyJson>(out));
}

/** Really import a preset (the plan was confirmed). */
export async function applyPreset(c: { project: string; stackPath: string | null }, name: string): Promise<PresetApplyJson> {
  const out = await stackRun('preset', presetApplyArgs(name), c.project, c.stackPath);
  return fromStackOut<PresetApplyJson>(out);
}
