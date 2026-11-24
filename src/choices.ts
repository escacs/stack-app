// Per-file choices for files both sides changed, remembered for the review of
// one import (cleared once its update ran). The pure helpers are tested in
// choices.test.ts; the argument builder itself is json.ts `updateArgs`.
import { createSignal } from 'solid-js';
import type { FileChoice } from './json';

export type EntryChoices = Readonly<Record<string, FileChoice>>;

const [all, setAll] = createSignal<Readonly<Record<string, EntryChoices>>>({});

/** The choices made for one import (an empty object when none were). */
export const choicesFor = (id: string): EntryChoices => all()[id] ?? {};

/** The choice for one file; `merge` (conflict markers) unless the user picked another. */
export const choiceOf = (id: string, file: string): FileChoice => choicesFor(id)[file] ?? 'merge';

export function setChoice(id: string, file: string, choice: FileChoice): void {
  setAll((m) => ({ ...m, [id]: { ...(m[id] ?? {}), [file]: choice } }));
}

/** Forget one import's choices (after its update ran, or when it is no longer both-changed). */
export function clearChoices(id: string): void {
  setAll((m) => {
    if (!(id in m)) return m;
    const { [id]: _gone, ...rest } = m;
    return rest;
  });
}

/** Files the stack and the user both changed: the only ones a choice applies to. */
export const bothFiles = (upstream: readonly string[], edited: readonly string[]): string[] => {
  const e = new Set(edited);
  return upstream.filter((f) => e.has(f));
};

/** Choices limited to the files that are still both-changed (a stale choice never reaches the CLI). */
export function liveChoices(choices: EntryChoices, both: readonly string[]): Record<string, FileChoice> {
  const out: Record<string, FileChoice> = {};
  for (const f of both) if (choices[f] && choices[f] !== 'merge') out[f] = choices[f];
  return out;
}

/** Files that would still get conflict markers: both-changed files left on Merge. */
export const mergeFiles = (both: readonly string[], choices: EntryChoices): string[] => both.filter((f) => (choices[f] ?? 'merge') === 'merge');
