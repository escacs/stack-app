import { describe, expect, it } from 'vitest';
import { FALLBACK, describeId, humanizeCliError, humanizeOp, importLine, nameIds, nameOf, setActionRunner } from './humanize';

// Raw text the CLI and the shell really produce → the table row that must catch it.
const CASES: [string, string][] = [
  ['node was not found on PATH. Install Node.js 22 or newer, then relaunch the app.', 'node-missing'],
  ['node 22+ is required (fixture: no-node scenario)', 'node-missing'],
  ['no escacs/stack checkout found: looked upward from the app for tools/stack/cli.mjs.', 'cli-not-found'],
  ['spawn stack ENOENT', 'cli-not-found'],
  ['/home/dev/x is not a usable stack checkout.', 'bad-stack-path'],
  ['stack ref "v9" not found in /home/dev/stack', 'bad-stack-path'],
  ['~/.local/bin/stack is not linked yet.', 'command-not-linked'],
  ['git is not installed or not on PATH; install git to use remote component libraries', 'git-missing'],
  ['git@github.com: Permission denied (publickey).', 'auth'],
  ['could not fetch the stack: no GitHub auth was found. run gh auth login, then retry.', 'auth'],
  ["fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com", 'offline'],
  ['timed out waiting for the background refresh', 'offline'],
  ['fatal: not a git repository (or any of the parent directories): .git', 'not-git-repo'],
  ['No stack imports here (no stack.toml).', 'not-initialised'],
  ["fatal: Unable to create '/p/.git/index.lock': File exists.", 'worktree-locked'],
  ['error: Your local changes to the following files would be overwritten', 'worktree-dirty'],
  ['import was interrupted before it finished', 'interrupted'],
  ['AGENTS.md has a half-written escacs block; delete the "<!-- escacs:start -->" line and re-run', 'half-block'],
  ['these files already exist with other content; move them or choose --to:\n  .agents/skills/pony/SKILL.md', 'collision'],
  ['these project files are imported twice; give each entry its own "to":\n  a/b', 'imported-twice'],
  ['--to works with one id at a time', 'to-multi'],
  ['no entry "skills/nope"; search first, or list with `stack list`', 'no-entry'],
  ['skills/draft is not an entry at stack commit abc1234 (new entries must be committed to the stack before importing)', 'not-committed'],
  ['skills/pony is not imported here', 'not-imported'],
  ['no preset "frontend"; list them with `stack preset list`', 'no-preset'],
  ['preset: "imports" must be a non-empty array', 'bad-preset'],
  ['/etc/passwd escapes the project', 'outside-project'],
  ['project not found: /home/dev/gone', 'project-missing'],
  ['skills/x is a remote skill but its cache is not ready; run `stack remote sync x` first', 'remote-cache'],
  ['skills/y: commit abcdef1 is not in the stack clone (fetch first)', 'remote-pin'],
  ['stack.toml line 3: "stack" must be a string', 'toml-damaged'],
  ["EACCES: permission denied, open '/p/.agents/x'", 'permission'],
  ['write failed: ENOSPC: no space left on device', 'disk-full'],
  ["no such file 'README.md' in skills/pony", 'file-missing'],
  ['CONFLICT  .agents/skills/pony/SKILL.md <<<<<<< ours', 'conflicts'],
  ['unknown flag --frobnicate', 'unknown-kind'],
  ['skills/x is not a worker in the stack', 'worker-unknown'],
  ['could not parse the stack reply as JSON', 'unreadable-reply'],
  ['--dry-run is only supported by import and preset apply', 'dry-run'],
  ['t3 was not found on PATH', 't3-missing'],
  ['the update check timed out', 'update-check'],
];

describe('humanizeCliError', () => {
  it.each(CASES)('%s', (raw, id) => {
    const h = humanizeCliError(raw);
    expect(h.pattern).toBe(id);
    expect(h.known).toBe(true);
    expect(h.title.length).toBeGreaterThan(5);
    expect(h.detail.length).toBeGreaterThan(10);
    expect(h.next.length).toBeGreaterThan(5);
    expect(h.raw).toBe(raw.trim());
  });

  it('covers at least 25 distinct patterns', () => {
    expect(new Set(CASES.map(([, id]) => id)).size).toBeGreaterThanOrEqual(25);
  });

  it('never lets command lines, flags or exit noise into the sentence', () => {
    const bad = /stack\b.*--|ERR|exit code|ENOENT|at .*\.mjs|Traceback|--to|stack (?:list|preset)/;
    for (const [raw] of CASES) {
      const h = humanizeCliError(raw);
      expect(`${h.title} ${h.detail} ${h.next}`).not.toMatch(bad);
    }
  });

  it('falls back to Something went wrong and keeps the raw text for the disclosure', () => {
    const raw = 'Traceback (most recent call last):\n  at /x/cli.mjs:12\nboom';
    const h = humanizeCliError(raw);
    expect(h.known).toBe(false);
    expect(h.pattern).toBe('fallback');
    expect(h.title).toBe(FALLBACK.title);
    expect(h.raw).toBe(raw);
    expect(`${h.title}${h.detail}${h.next}`).not.toMatch(/Traceback|\.mjs/);
  });

  it('handles empty input', () => {
    expect(humanizeCliError('').known).toBe(false);
  });

  it('lists the colliding files as code, not as raw lines', () => {
    const h = humanizeCliError(CASES.find(([, id]) => id === 'collision')![0]);
    expect(h.detail).toContain('`.agents/skills/pony/SKILL.md`');
  });

  it('names entries by their name, not their id', () => {
    const h = humanizeCliError('no entry "skills/nope"; search first');
    expect(h.title).toBe('nope is not in the stack');
  });

  it('carries an action whose run goes to ctx.run, then the global runner', () => {
    const seen: string[] = [];
    const a = humanizeCliError('node was not found', { run: (id) => seen.push(`ctx:${id}`) }).action;
    expect(a?.label).toBe('Get Node.js');
    a?.run();
    setActionRunner((id) => seen.push(`global:${id}`));
    humanizeCliError('project not found: /x').action?.run();
    expect(seen).toEqual(['ctx:get-node', 'global:open-project']);
  });
});

describe('ids as names', () => {
  it('nameOf / describeId / nameIds', () => {
    expect(nameOf('components/react/button')).toBe('button');
    expect(describeId('skills/pony')).toBe('pony (a skill)');
    expect(nameIds('Could not import skills/pony and styles/folio-light')).toBe('Could not import pony and folio-light');
  });
});

describe('humanizeOp', () => {
  it('turns an import line into a sentence with the folder as code', () => {
    expect(importLine('skills/pony → .agents/skills/pony')).toBe('Imported pony (a skill) into `.agents/skills/pony`');
    expect(importLine('skills/a → .agents/skills/a (required by skills/b)')).toContain('needed by b');
  });

  it('rewrites section titles', () => {
    const out = humanizeOp([
      { title: 'imported 2 entries', lines: ['skills/pony → .agents/skills/pony'] },
      { title: 'already here', lines: ['skills/old'], tone: 'dim' },
      { title: '.gitignore', lines: ['managed escacs block updated'], tone: 'dim' },
      { title: 'conflicts — open each file, keep one side, delete the <<<<<<< markers', lines: ['a.md'], tone: 'bad' },
      { title: 'remove skills/pony', lines: [] },
      { title: 'restored 2 files', lines: ['a', 'b'] },
    ]);
    expect(out.map((s) => s.title)).toEqual([
      'Imported 2 items',
      'Already in your project',
      'Updated `.gitignore`',
      'Some files need you to choose',
      'Removed pony (a skill)',
      'Restored 2 files',
    ]);
    expect(out[0].lines[0]).toContain('`.agents/skills/pony`');
    expect(out[3].tone).toBe('bad');
    expect(JSON.stringify(out)).not.toMatch(/escacs|<<<<<<</);
  });

  it('keeps unknown titles but swaps ids for names', () => {
    expect(humanizeOp([{ title: 'something about skills/x', lines: [] }])[0].title).toBe('something about x');
  });
});

describe('update outcome sentences', () => {
  it('each outcome has its own words, the backup named for a replaced file', async () => {
    const { updateFileSentence } = await import('./humanize');
    expect(updateFileSentence({ path: 'SKILL.md', outcome: 'kept-mine' })).toBe('Kept yours');
    expect(updateFileSentence({ path: 'SKILL.md', outcome: 'took-upstream' })).toBe('Replaced with the stack’s version (yours saved as SKILL.md.mine)');
    expect(updateFileSentence({ path: 'references/a.md', outcome: 'took-upstream' })).toContain('references/a.md.mine');
    expect(updateFileSentence({ path: 'SKILL.md', outcome: 'took-upstream' }, { backup: false })).toBe('Replaced with the stack’s version');
    expect(updateFileSentence({ path: 'SKILL.md', outcome: 'conflict-markers' })).toBe('Conflict markers written');
    expect(updateFileSentence({ path: 'SKILL.md', outcome: 'updated' })).toBe('Updated to the stack’s version');
    expect(updateFileSentence({ path: 'SKILL.md', outcome: 'unchanged' })).toBe('Already the same');
  });
  it('a result lists the decided files, counts the rest and notes unmatched choices', async () => {
    const { updateResultSentences } = await import('./humanize');
    expect(
      updateResultSentences({
        updated: [{ id: 'skills/a', changed: 4, files: [
          { path: 'SKILL.md', outcome: 'kept-mine' },
          { path: 'b.md', outcome: 'took-upstream' },
          { path: 'c.md', outcome: 'conflict-markers' },
          { path: 'd.md', outcome: 'updated' },
        ] }],
        unmatched: ['zz.md'],
      }),
    ).toEqual([
      'SKILL.md: Kept yours.',
      'b.md: Replaced with the stack’s version (yours saved as b.md.mine).',
      'c.md: Conflict markers written.',
      '1 other file was brought up to date.',
      'Nothing to settle for zz.md: only one side changed it.',
    ]);
    expect(updateResultSentences({ updated: [{ id: 'skills/a', changed: 1 }] })).toEqual([]);
  });
  it('with several entries each file is prefixed by the entry name', async () => {
    const { updateResultSentences } = await import('./humanize');
    expect(
      updateResultSentences({ updated: [{ id: 'skills/a', changed: 1, files: [{ path: 'x.md', outcome: 'kept-mine' }] }, { id: 'skills/b', changed: 1, files: [{ path: 'y.md', outcome: 'conflict-markers' }] }] }),
    ).toEqual(['a/x.md: Kept yours.', 'b/y.md: Conflict markers written.']);
  });
});
