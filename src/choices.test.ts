import { describe, expect, it } from 'vitest';
import { bothFiles, choiceOf, clearChoices, liveChoices, mergeFiles, setChoice } from './choices';
import { updateArgs, restoreArgs } from './json';

describe('updateArgs (choices -> CLI args)', () => {
  it('no choices: just the id and --json', () => {
    expect(updateArgs('skills/a')).toEqual(['skills/a', '--json']);
    expect(updateArgs('skills/a', { 'SKILL.md': 'merge' })).toEqual(['skills/a', '--json']);
  });
  it('mine and upstream become one flag per file, in a stable order', () => {
    expect(updateArgs('skills/a', { 'b.md': 'upstream', 'SKILL.md': 'mine', 'a.md': 'upstream', 'c.md': 'merge' })).toEqual([
      'skills/a',
      '--keep-mine', 'SKILL.md',
      '--take-upstream', 'a.md',
      '--take-upstream', 'b.md',
      '--json',
    ]);
  });
  it('--dry-run comes before --json; --no-backup only with a taken file', () => {
    expect(updateArgs('skills/a', { 'SKILL.md': 'mine' }, { dryRun: true, noBackup: true })).toEqual(['skills/a', '--keep-mine', 'SKILL.md', '--dry-run', '--json']);
    expect(updateArgs('skills/a', { 'SKILL.md': 'upstream' }, { noBackup: true })).toEqual(['skills/a', '--take-upstream', 'SKILL.md', '--no-backup', '--json']);
  });
});

describe('restoreArgs', () => {
  it('one entry, several, or the whole project', () => {
    expect(restoreArgs(['skills/a'])).toEqual(['skills/a', '--json']);
    expect(restoreArgs(['skills/a', 'skills/b'])).toEqual(['skills/a', 'skills/b', '--json']);
    expect(restoreArgs()).toEqual(['--json']);
  });
});

describe('per-file choices', () => {
  it('both-changed files are the intersection of upstream and edited', () => {
    expect(bothFiles(['SKILL.md', 'x.md'], ['SKILL.md', 'y.md'])).toEqual(['SKILL.md']);
    expect(bothFiles([], ['SKILL.md'])).toEqual([]);
  });
  it('default is Merge; a choice is remembered per entry and file, and cleared', () => {
    expect(choiceOf('skills/zz', 'SKILL.md')).toBe('merge');
    setChoice('skills/zz', 'SKILL.md', 'mine');
    expect(choiceOf('skills/zz', 'SKILL.md')).toBe('mine');
    expect(choiceOf('skills/zz', 'other.md')).toBe('merge');
    expect(choiceOf('skills/other', 'SKILL.md')).toBe('merge');
    clearChoices('skills/zz');
    expect(choiceOf('skills/zz', 'SKILL.md')).toBe('merge');
  });
  it('stale choices (file no longer both-changed) never reach the CLI', () => {
    expect(liveChoices({ 'a.md': 'mine', 'gone.md': 'upstream', 'm.md': 'merge' }, ['a.md', 'm.md'])).toEqual({ 'a.md': 'mine' });
  });
  it('conflict markers are a prospect only while some file is still on Merge', () => {
    expect(mergeFiles(['a.md', 'b.md'], { 'a.md': 'mine' })).toEqual(['b.md']);
    expect(mergeFiles(['a.md', 'b.md'], { 'a.md': 'mine', 'b.md': 'upstream' })).toEqual([]);
    expect(mergeFiles([], {})).toEqual([]);
  });
});
