// The state words the UI shows, and the ONE tone each carries. Rows, the
// preview, the sidebar, thread rows and the palette all read a word's tone
// from here, so a word never turns up in two colours and two concepts never
// share a word. The test in vocab.test.ts walks every producer.
//
// One verb, one plan, one state. Bringing a stack entry into a project is
// always "Import" (never "Install" or "Apply"), the preview of it is the
// "Import plan" (the button that opens one says "Preview plan", never "Dry
// run"), and a row whose files match the stack says "Up to date" (never
// "Synced" or "In sync"). Changing imported files is still "Update" (the verb)
// and a row waiting for one says "Update available" (the state).
//
// The older spellings ("Synced", "In sync", "Tracked", "Target", "Installing
// here", "Stack edits", "Merge all upstream", "Review & merge", "Sync missing",
// "Restore missing files", "No lock") stay resolvable through WORD_ALIAS so a
// view, a stored preference or the shell can still hand one over and get the
// current words back; nothing new should show them.
export type Tone = 'success' | 'warning' | 'error' | 'info' | 'muted';

/** The word for each tracked-import state (states only; actions never reuse them). */
export const STATE_WORD: Record<string, string> = {
  imported: 'Up to date',
  update: 'Update available',
  edited: 'Edited',
  gone: 'Gone',
  missing: 'Missing files',
};

export const WORD_TONE: Readonly<Record<string, Tone>> = {
  // Catalog rows: where an entry stands in the stack and in this project.
  'Not in stack': 'error',
  'Update available': 'warning',
  Imported: 'success',
  // Tracked imports: how a lock row compares with the stack and the files.
  'Up to date': 'success',
  Edited: 'warning',
  Gone: 'error',
  'Missing files': 'warning',
  // Worktrees and T3 threads. A worktree holding a lock entry that matches the
  // stack is "Up to date" too: one word for one state, wherever it is shown.
  'Importing here': 'info',
  'Not set up': 'warning',
  Idle: 'muted',
  Running: 'info',
  Error: 'error',
  // Superseded spellings: same concept, same tone, kept so an older string
  // still colours correctly. Views display `wordFor()` instead.
  Synced: 'success',
  'In sync': 'success',
  'Installing here': 'info',
  'Stack edits': 'warning',
  Tracked: 'success',
  Update: 'warning',
  Target: 'info',
  'No lock': 'warning',
};

/** A word's tone; unknown words (a thread status the CLI invents) stay quiet. */
export const toneOf = (word: string): Tone => WORD_TONE[word] ?? 'muted';

/**
 * The one word each superseded spelling now uses. `wordFor` maps a string
 * still carrying an old spelling to the word the UI shows today.
 */
export const WORD_ALIAS: Readonly<Record<string, string>> = {
  'Stack edits': 'Update available',
  // The worktree switch badge: imports land here, so the verb is Import.
  Target: 'Importing here',
  'Installing here': 'Importing here',
  // The up-to-date state, under its three earlier spellings.
  Tracked: 'Up to date',
  'In sync': 'Up to date',
  Synced: 'Up to date',
  'No lock': 'Not set up',
  'Sync missing': 'Restore files',
  'Restore missing files': 'Restore files',
  'Merge all upstream': 'Update all',
  'Sync all worktrees': 'Update all worktrees',
  'Review & merge': 'Review changes',
  'Review changes before merging': 'Review changes',
  'Review update': 'Review changes',
  'Check for updates': 'Check for app updates',
};

/** The current spelling of `word` (`Update available` for `Stack edits`). */
export const wordFor = (word: string): string => WORD_ALIAS[word] ?? word;

/**
 * What each word means in one sentence, for `title` and tooltips. Look words
 * up through `hintOf` so a superseded spelling still finds its definition.
 */
export const WORD_HINT: Readonly<Record<string, string>> = {
  'Up to date': 'These files match the version in the stack, so nothing is waiting for this import.',
  'Importing here': 'This is the worktree where imports and updates land.',
  'Not set up': 'Nothing has been imported into this worktree yet, so there is no lock to update.',
  'Update available': 'The stack has a newer version of this entry than the one in this project.',
  'Missing files': 'Files this import wrote are gone from the project, so the entry is incomplete here.',
  Edited: 'The files here were changed by hand since they were imported.',
  Gone: 'This entry is no longer in the stack, but its files are still in the project.',
  Imported: 'This entry is already in the project, so importing it again would only overwrite its own files.',
  'Not in stack': 'The stack checkout does not have this entry committed yet, so it cannot be imported.',
  // The verbs and the plan, so a tooltip can explain a button by naming it.
  Update: 'Replace this entry\'s files with the version in the stack.',
  'Update all': 'Replace every entry that has an update waiting, in this project.',
  'Update all worktrees': 'Run the same update in every worktree that holds a lock entry.',
  'Review changes': 'Read the difference between your files and the stack\'s before updating.',
  'Restore files': 'Put back the imported files you deleted, without touching anything you edited.',
  'Check for app updates': 'Look for a newer version of this desktop app; catalog updates are separate.',
  Import: 'Copy this entry from the stack into the project.',
  'Import entry': 'Copy the entry in front of you from the stack into the project.',
  'Import plan': 'The files an import would write, laid out before anything is written.',
  'Preview plan': 'Open the import plan without writing a single file.',
};

/** The definition of a word (a superseded spelling resolves to its current one). */
export const hintOf = (word: string): string | undefined => WORD_HINT[word] ?? WORD_HINT[wordFor(word)];

/**
 * The labels that are not states: verbs, the plan, the worktree badge and the
 * one worktree switch. `Import` brings an entry into the project (`Import into
 * <branch>` moves where imports land; `Import plan` is the preview, opened by
 * `Preview plan`), `Update`, `Update all`, `Update all worktrees` and `Review
 * changes` change what is already imported, and `Restore files` puts back what
 * was deleted here. No label says Install, Apply or Dry run.
 */
export const LABEL = {
  /** Changes one entry to the stack's version. */
  update: 'Update',
  /** Changes every entry that has an update waiting. */
  updateAll: 'Update all',
  /** The same update, run across every worktree holding a lock entry (was "Sync all worktrees"). */
  updateAllWorktrees: 'Update all worktrees',
  /** Opens the diff first, then updates (was "Review update"). */
  reviewChanges: 'Review changes',
  /** Superseded key for `reviewChanges`, kept so views keep compiling. */
  reviewUpdate: 'Review changes',
  /** Puts back files missing from this project. */
  restoreMissing: 'Restore files',
  /** The desktop app's own updater (was "Check for updates", which read as a catalog update). */
  checkAppUpdates: 'Check for app updates',
  /** The badge on the worktree where imports land (was "Target", "Installing here"). */
  importingHere: 'Importing here',
  /** Superseded key for `importingHere`, kept so a view that names it keeps compiling. */
  installingHere: 'Importing here',
  /** The switch to another worktree (was "Retarget to <branch>"): `Import into main`. */
  installInto: (branch: string): string => `Import into ${branch}`,
  /** The switch to another worktree, under the one verb. */
  importInto: (branch: string): string => `Import into ${branch}`,
  /** The one verb for bringing a stack entry into a project. */
  importAction: 'Import',
  /** The preview of an import, before anything is written: the plan itself. */
  importPlan: 'Import plan',
  /** The button that opens the plan (was "Dry run", "Preview import plan"). */
  previewPlan: 'Preview plan',
  /** The up-to-date state word (was "Synced", "In sync"). */
  upToDate: 'Up to date',
  /** The state word for imported files that are gone from the project. */
  missingFiles: 'Missing files',
  /** Puts back the imported files that are missing (was "Restore missing files"). */
  restoreFiles: 'Restore files',
  /** The palette's name for the import of the entry in front of the user (was "Import selected entry"). */
  importEntry: 'Import entry',
} as const;

/** The target badge text, for `NavItem`'s `targetLabel`. */
export const TARGET_LABEL: string = LABEL.installingHere;

/** A T3 thread status as a state word: `running` becomes `Running`. */
export const threadWord = (status: string | null | undefined): string => {
  const s = (status || 'idle').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

/** The sidebar's spelling of a tone (its quiet tone is called `default`). */
export const navTone = (word: string): 'default' | 'warning' | 'success' | 'info' | 'error' => {
  const t = toneOf(word);
  return t === 'muted' ? 'default' : t;
};
