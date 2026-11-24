// The app's decoders against REAL `stack` output. The fixtures in
// src/__fixtures__ were recorded by driving the actual CLI (tools/stack, the
// upgraded one) through init, import, edits, a deletion and upstream changes
// in a throwaway project: see src/__fixtures__/README.md for how to re-record.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliHint, humanizeCliError, updateResultSentences } from './humanize';
import {
  fromStackOut,
  lacksMissing,
  refusalFiles,
  restoreArgs,
  toStatusRows,
  updateArgs,
  withMissing,
  type StatusJson,
  type SyncJson,
  type UpdateJson,
} from './json';
import { CLI_STATE, missingOf, editedOf, rowState } from './parse';
import { updateOutcome } from './undo';

const dir = new URL('./__fixtures__/', import.meta.url);
const raw = (n: string): string => readFileSync(new URL(n, dir), 'utf8');
const json = <T,>(n: string): T => fromStackOut<T>({ code: 0, stdout: raw(`${n}.json`), stderr: '', truncated: false } as never);
const meta = JSON.parse(raw('meta.json')) as { runs: Record<string, { argv: string[] }> };

describe('status --json (real)', () => {
  const st = json<StatusJson>('status');
  const { rows } = toStatusRows(st);

  it('carries missing and state on every row', () => {
    for (const r of st.rows) {
      expect(Array.isArray(r.missing)).toBe(true);
      expect(typeof r.state).toBe('string');
    }
    expect(lacksMissing(rows)).toBe(false);
  });

  it('the app derives the same state word as the CLI for every row, in every fixture', () => {
    for (const name of ['status-clean', 'status', 'status-after-restore', 'status-after-update']) {
      const { rows: rs } = toStatusRows(json<StatusJson>(name));
      for (const r of rs) expect(CLI_STATE[rowState(r)], `${name} ${r.id}`).toBe(r.state);
    }
    expect(rows.map((r) => `${r.id}:${r.state}`)).toEqual([
      'skills/agent-chain:update-available',
      'skills/agent-lanes:update-available',
      'skills/coss:edited',
      'skills/create-agents-md:missing',
    ]);
  });

  it('missing files are the CLI’s list; edited ones are local minus missing', () => {
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(missingOf(by['skills/create-agents-md'])).toEqual(['references/template.md']);
    expect(editedOf(by['skills/create-agents-md'])).toEqual([]);
    expect(editedOf(by['skills/agent-chain'])).toEqual(['SKILL.md', 'references/roles.md']);
    expect(by['skills/coss'].upstreamCount).toBe(0);
  });

  it('withMissing is never asked to read a file when the CLI sent `missing`', async () => {
    let reads = 0;
    const out = await withMissing(rows, async () => {
      reads++;
      return true;
    });
    expect(reads).toBe(0);
    expect(out).toEqual(rows);
  });

  it('older CLI (no missing/state): the file check runs, and only then', async () => {
    const old = toStatusRows({ ...st, rows: st.rows.map(({ missing: _m, state: _s, ...r }) => r) }).rows;
    expect(lacksMissing(old)).toBe(true);
    const out = await withMissing(old, async (p) => !p.endsWith('references/template.md'));
    expect(out.find((r) => r.id === 'skills/create-agents-md')?.missing).toEqual(['references/template.md']);
    expect(out.find((r) => r.id === 'skills/coss')?.missing).toEqual([]);
  });
});

describe('update --dry-run / update (real)', () => {
  it('the argument builder reproduces the argv the fixtures were recorded with', () => {
    const args = (n: string): string[] => meta.runs[n].argv.slice(1); // without the command word
    expect(updateArgs('skills/agent-chain', {}, { dryRun: true })).toEqual(args('update-dry-merge'));
    expect(updateArgs('skills/agent-chain', { 'SKILL.md': 'mine', 'references/roles.md': 'upstream' }, { dryRun: true })).toEqual(args('update-dry-keep-take'));
    expect(updateArgs('skills/agent-chain', { 'SKILL.md': 'mine', 'references/roles.md': 'upstream' })).toEqual(args('update-keep-take'));
    expect(restoreArgs(['skills/create-agents-md'])).toEqual(args('restore-entry'));
    expect(restoreArgs()).toEqual(['--json']);
  });

  it('merge (no choice): the file both sides changed gets conflict markers, the clean one merges', () => {
    const r = json<UpdateJson>('update-dry-merge');
    expect(r.dryRun).toBe(true);
    expect(r.updated[0].files).toEqual([
      { path: 'SKILL.md', outcome: 'conflict-markers' },
      { path: 'references/roles.md', outcome: 'updated' },
    ]);
    expect(updateResultSentences(r)).toEqual(['SKILL.md: Conflict markers written.', '1 other file was brought up to date.']);
  });

  it('keep mine + take upstream: outcomes in words, the backup named', () => {
    const r = json<UpdateJson>('update-keep-take');
    expect(r.updated[0].files?.map((f) => f.outcome)).toEqual(['kept-mine', 'took-upstream']);
    expect(updateResultSentences(r)).toEqual(['SKILL.md: Kept yours.', 'references/roles.md: Replaced with the stack’s version (yours saved as references/roles.md.mine).']);
    const o = updateOutcome(r, 'skills/agent-chain');
    expect(o.tone).toBe('success');
    expect(o.undo).toBeNull();
    expect(o.description).toContain('Kept yours');
    expect(o.description).toContain('roles.md.mine');
  });

  it('a choice that matched nothing comes back in unmatched[]', () => {
    const r = json<UpdateJson>('update-dry-unmatched');
    expect(r.unmatched).toEqual(['nope.md']);
    expect(updateResultSentences(r).at(-1)).toBe('Nothing to settle for nope.md: only one side changed it.');
  });

  it('update with no ids: every entry with changes is reported with its files', () => {
    const r = json<UpdateJson>('update-all');
    expect(r.updated.map((u) => u.id)).toEqual(['skills/agent-lanes', 'skills/coss', 'skills/create-agents-md']);
    expect(updateOutcome(r).title).toBe('Updated 3 entries');
  });
});

describe('restore --json (real)', () => {
  it('dry run keeps edits and lists what would come back; command is restore', () => {
    const r = json<SyncJson>('restore-dry');
    expect(r.command).toBe('restore');
    expect(r.dryRun).toBe(true);
    expect(r.restored).toEqual(['.agents/skills/create-agents-md/references/template.md']);
    expect(r.kept.length).toBeGreaterThan(0);
  });
  it('restore <id> restores only that entry', () => {
    const r = json<SyncJson>('restore-entry');
    expect(r.command).toBe('restore');
    expect(r.restored).toEqual(['.agents/skills/create-agents-md/references/template.md']);
    expect(r.kept).toEqual([]);
    expect(r.worker).toBeNull();
  });
});

describe('plain-text failures (real)', () => {
  const text = (n: string) => raw(`${n}.txt`).trim();
  it('map to a title, a next step and a known pattern', () => {
    expect(humanizeCliError(text('err-no-entry')).pattern).toBe('no-entry');
    expect(humanizeCliError(text('err-not-imported')).pattern).toBe('not-imported');
    expect(humanizeCliError(text('err-bad-resolve')).pattern).toBe('bad-choice');
  });
  it('the new collision wording still yields the files, without the trailing instruction', () => {
    const t = 'Would not overwrite 2 files that already exist with different content:\n  a/SKILL.md\n  a/x.md\nNothing was imported. Choose another folder with --to <dir>, or move or delete those files first.';
    expect(refusalFiles(t)).toEqual(['a/SKILL.md', 'a/x.md']);
    expect(humanizeCliError(t).pattern).toBe('collision');
    // the old wording still works
    expect(refusalFiles('these files already exist with other content; move them:\n  a/SKILL.md')).toEqual(['a/SKILL.md']);
    expect(cliHint(t)).toBeNull();
  });
});
