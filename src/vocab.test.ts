import { describe, expect, it } from 'vitest';
import { rowStatus } from './browseList';
import type { JsonEntry } from './json';
import { LABEL, STATE_WORD, TARGET_LABEL, WORD_ALIAS, WORD_HINT, WORD_TONE, hintOf, navTone, threadWord, toneOf, wordFor } from './vocab';

const TONES = ['success', 'warning', 'error', 'info', 'muted'];

/** LABEL's text entries (one of them is the worktree switch, a function). */
const stringLabels = (): string[] => Object.values(LABEL).filter((v) => typeof v === 'string') as string[];
const entry = (committed: boolean): JsonEntry => ({ id: 'skills/x', committed }) as JsonEntry;

/** Every (word, tone) pair a producer can put on screen. */
function pairs(): [string, string][] {
  const out: [string, string][] = [];
  for (const w of Object.values(STATE_WORD)) out.push([w, toneOf(w)]);
  for (const e of [entry(false), entry(true)]) {
    const s = rowStatus(e);
    if (s) out.push([s.text, s.tone]);
  }
  for (const st of ['idle', 'running', 'error', 'IDLE']) out.push([threadWord(st), toneOf(threadWord(st))]);
  // The current words and the superseded spellings that still reach them.
  for (const w of ['Up to date', 'Missing files', 'Importing here', 'Not set up', 'Synced', 'In sync', 'Tracked', 'Installing here']) {
    out.push([w, toneOf(w)]);
  }
  out.push([LABEL.importingHere, toneOf(LABEL.importingHere)]);
  return out;
}

describe('state vocabulary', () => {
  it('maps every word the UI shows to exactly one known tone', () => {
    const seen = new Map<string, Set<string>>();
    for (const [w, t] of pairs()) seen.set(w, (seen.get(w) ?? new Set()).add(t));
    for (const [w, tones] of seen) {
      expect([w, [...tones]]).toEqual([w, [[...tones][0]]]);
      expect(TONES).toContain([...tones][0]);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it('declares every word it can show (an old spelling resolves through wordFor)', () => {
    for (const [w] of pairs()) expect(Object.keys(WORD_TONE)).toContain(wordFor(w));
  });

  it('shows only the catalog blocker on a Browse row', () => {
    expect(rowStatus(entry(false))).toMatchObject({ text: 'Not in stack', tone: 'error' });
    expect(rowStatus(entry(true))).toBeNull();
  });

  it('keeps the worktree badge blue everywhere', () => {
    expect(toneOf('Importing here')).toBe('info');
    expect(navTone('Importing here')).toBe('info');
    expect(TARGET_LABEL).toBe('Importing here');
    expect(navTone('Up to date')).toBe('success');
    expect(navTone('Synced')).toBe('success');
    expect(navTone('Not set up')).toBe('warning');
  });

  it('says Up to date for anything that matches the stack', () => {
    // One state, one word: the worktree's word and the import's word agree.
    expect(STATE_WORD.imported).toBe('Up to date');
    expect(LABEL.upToDate).toBe('Up to date');
    expect(wordFor('Tracked')).toBe('Up to date');
    expect(wordFor('In sync')).toBe('Up to date');
    expect(wordFor('Synced')).toBe('Up to date');
    expect(wordFor('Target')).toBe('Importing here');
  });

  it('names the missing-files state apart from the up-to-date one', () => {
    expect(STATE_WORD.missing).toBe('Missing files');
    expect(toneOf('Missing files')).toBe('warning');
    expect(toneOf('Missing files')).not.toBe(toneOf('Up to date'));
    expect(WORD_HINT['Missing files']).toBeTruthy();
  });

  it('never reuses a word across concepts (aliases included)', () => {
    const words = Object.keys(WORD_TONE);
    expect(new Set(words.map((w) => w.toLowerCase())).size).toBe(words.length);
  });
});

describe('update wording', () => {
  it('keeps one verb family and one state word', () => {
    expect(STATE_WORD.update).toBe('Update available');
    expect(LABEL).toEqual({
      update: 'Update',
      updateAll: 'Update all',
      updateAllWorktrees: 'Update all worktrees',
      reviewChanges: 'Review changes',
      reviewUpdate: 'Review changes',
      restoreMissing: 'Restore files',
      restoreFiles: 'Restore files',
      checkAppUpdates: 'Check for app updates',
      installingHere: 'Importing here',
      importingHere: 'Importing here',
      installInto: LABEL.installInto,
      importInto: LABEL.importInto,
      importAction: 'Import',
      importPlan: 'Import plan',
      previewPlan: 'Preview plan',
      importEntry: 'Import entry',
      upToDate: 'Up to date',
      missingFiles: 'Missing files',
    });
    // No path still says the old verbs.
    for (const text of [...stringLabels(), ...Object.values(STATE_WORD)]) {
      expect(text).not.toMatch(/merge|retarget|sync missing|sync all|target|no lock|stack edits/i);
    }
  });

  it('every update label carries the verb, so the family reads as one', () => {
    for (const label of [LABEL.update, LABEL.updateAll, LABEL.updateAllWorktrees]) expect(label).toMatch(/^Update/);
    // The diff-first verb keeps the noun ("changes") instead of repeating "update".
    expect(LABEL.reviewChanges).toBe('Review changes');
    expect(LABEL.reviewUpdate).toBe(LABEL.reviewChanges);
  });

  it('one verb for bringing entries in: import into <branch>', () => {
    expect(LABEL.importInto('main')).toBe('Import into main');
    expect(LABEL.importInto('feat/x')).toBe('Import into feat/x');
    // The superseded key says the same thing, so an older view keeps compiling.
    expect(LABEL.installInto('main')).toBe(LABEL.importInto('main'));
    expect(LABEL.importingHere).toBe('Importing here');
    expect(LABEL.installingHere).toBe(LABEL.importingHere);
  });

  it('says Import, never Install or Apply, and a plan is never a dry run', () => {
    expect(LABEL.importAction).toBe('Import');
    expect(LABEL.importPlan).toBe('Import plan');
    expect(LABEL.importEntry).toBe('Import entry');
    // The preview is a button, the plan is what it opens.
    expect(LABEL.previewPlan).toBe('Preview plan');
    const shown = [...stringLabels(), LABEL.importInto('main'), LABEL.previewPlan, ...Object.values(STATE_WORD)];
    for (const text of shown) expect(text).not.toMatch(/install|apply|dry[ -]?run/i);
    // A plan is always called the same thing, wherever it is named.
    expect(hintOf(LABEL.importPlan)).toBeTruthy();
    expect(hintOf(LABEL.previewPlan)).toBeTruthy();
  });

  it('the app updater is named apart from catalog updates', () => {
    expect(LABEL.checkAppUpdates).toBe('Check for app updates');
    expect(LABEL.checkAppUpdates).not.toBe(LABEL.update);
    expect(wordFor('Check for updates')).toBe(LABEL.checkAppUpdates);
  });
});

describe('superseded spellings', () => {
  it('resolve to the current words', () => {
    expect(wordFor('Stack edits')).toBe('Update available');
    expect(wordFor('Target')).toBe('Importing here');
    expect(wordFor('Installing here')).toBe('Importing here');
    expect(wordFor('No lock')).toBe('Not set up');
    expect(wordFor('Sync missing')).toBe('Restore files');
    expect(wordFor('Restore missing files')).toBe('Restore files');
    expect(wordFor('Merge all upstream')).toBe('Update all');
    expect(wordFor('Sync all worktrees')).toBe('Update all worktrees');
    expect(wordFor('Review & merge')).toBe('Review changes');
    expect(wordFor('Review update')).toBe('Review changes');
    expect(wordFor('Synced')).toBe('Up to date');
    expect(wordFor('In sync')).toBe('Up to date');
    expect(wordFor('Tracked')).toBe('Up to date');
  });

  it('keep the canonical tone, so an old string never turns up a second colour', () => {
    for (const [old, now] of Object.entries(WORD_ALIAS)) {
      if (!(old in WORD_TONE)) continue;
      expect([old, toneOf(old)]).toEqual([old, toneOf(now)]);
    }
    expect(toneOf('Stack edits')).toBe(toneOf('Update available'));
    expect(toneOf('No lock')).toBe(toneOf('Not set up'));
  });

  it('carry no legacy verb into a new definition', () => {
    for (const old of Object.keys(WORD_ALIAS)) expect(Object.values(WORD_HINT)).not.toContain(old);
  });
});

describe('definitions', () => {
  it('define the words a view shows as a tooltip', () => {
    for (const w of ['Up to date', 'Missing files', 'Importing here', 'Not set up', 'Update available', 'Not in stack', 'Imported', 'Import plan', 'Preview plan']) {
      const h = hintOf(w);
      expect(h, w).toBeTruthy();
      expect(h!).toMatch(/\.$/);
      expect(h!.length).toBeGreaterThan(20);
      expect(h!).not.toMatch(/--|\.stack\/|stack\.toml|lockfile/i);
    }
  });

  it('resolve a superseded spelling to its definition', () => {
    expect(hintOf('Stack edits')).toBe(WORD_HINT['Update available']);
    expect(hintOf('Target')).toBe(WORD_HINT['Importing here']);
    expect(hintOf('Installing here')).toBe(WORD_HINT['Importing here']);
    expect(hintOf('Tracked')).toBe(WORD_HINT['Up to date']);
    expect(hintOf('In sync')).toBe(WORD_HINT['Up to date']);
    expect(hintOf('Synced')).toBe(WORD_HINT['Up to date']);
    expect(hintOf('Restore missing files')).toBe(WORD_HINT['Restore files']);
    expect(hintOf('Review update')).toBe(WORD_HINT['Review changes']);
    expect(hintOf('No lock')).toBe(WORD_HINT['Not set up']);
    expect(hintOf('In flight')).toBeUndefined();
  });

  it('keep every definition distinct', () => {
    const hints = Object.values(WORD_HINT);
    expect(new Set(hints).size).toBe(hints.length);
  });
});
