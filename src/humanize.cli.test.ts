// The stack CLI's rewritten plain-text messages (captured from the real CLI,
// tools/stack/*.mjs) must still map to the right title and next step; the
// older wording stays covered by humanize.test.ts.
import { describe, expect, it } from 'vitest';
import { cliHint, humanizeCliError } from './humanize';

const CASES: { name: string; raw: string; pattern: string; title?: RegExp; next?: RegExp }[] = [
  { name: 'unknown entry', raw: 'There is no entry "nope/x". Run `stack search <word>` to find the right id, or `stack list` to see everything.', pattern: 'no-entry', title: /x is not in the stack/ },
  { name: 'update before init', raw: 'nothing is not imported here: this folder has no stack.toml. Run `stack init` in your project first, then `stack import nothing`.', pattern: 'not-initialised' },
  { name: 'status before init', raw: 'This folder has no stack.toml, so nothing has been imported. Run `stack init` in your project first, then `stack import <id>`.', pattern: 'not-initialised' },
  { name: 'not imported (after init)', raw: 'skills/x is not imported in this project. Run `stack status` to see what is imported, or `stack import skills/x` to add it.', pattern: 'not-imported', title: /x is not imported/ },
  { name: 'import collision', raw: 'Would not overwrite 1 file that already exist with different content:\n  .agents/skills/agent-lanes/SKILL.md\nNothing was imported. Choose another folder with --to <dir>, or move or delete those files first, then run the import again.', pattern: 'collision', title: /already there/ },
  { name: 'import collision (several)', raw: 'Would not overwrite 2 files that already exist with different content:\n  a/SKILL.md\n  a/x.md\nNothing was imported. Choose another folder with --to <dir>.', pattern: 'collision' },
  { name: 'two entries one file', raw: 'Two entries would write the same project file:\n  .agents/skills/a/SKILL.md\nGive each entry its own "to" folder in the preset, then run it again.', pattern: 'imported-twice' },
  { name: '--to with several ids', raw: '--to puts one entry in one folder, so it works with a single id. Import the entries one at a time, e.g. `stack import <id> --to <dir>`.', pattern: 'to-multi' },
  { name: '--to with a preset', raw: "--to cannot be combined with a preset's own destinations. Drop --to.", pattern: 'to-multi' },
  { name: 'import without ids', raw: 'Nothing to import: name at least one entry. Usage: stack import <id...> [--to <dir>]. Run `stack search <word>` to find an id.', pattern: 'no-entry-named' },
  { name: 'already imported', raw: 'Already imported: skills/agent-lanes. Run `stack update skills/agent-lanes` to get newer versions.', pattern: 'already-imported', title: /agent-lanes is already imported/ },
  { name: 'unknown preset', raw: 'no preset "nope"; list them with `stack preset list`', pattern: 'no-preset' },
  { name: 'not at latest commit', raw: "skills/new is not an entry in the stack's latest commit (b107cea). Check the id with `stack search <word>`. If it is a new entry, commit it to the stack first, then import it.", pattern: 'not-committed', title: /new is not in the stack yet/ },
  { name: 'remote skill not at latest commit', raw: 'skills/taste is a remote skill that exists in the stack folder but not in its latest commit (b107cea). Commit its stack.json first, then import it.', pattern: 'not-committed' },
  { name: 'component library empty', raw: 'components/legacy is a component library with no committed entries at b107cea. Commit its components to the stack first, then try again.', pattern: 'not-committed' },
  { name: 'remote not downloaded', raw: 'skills/taste-skill comes from another git repository and has not been downloaded yet. Run `stack remote sync skills/taste-skill` first, then try again.', pattern: 'remote-cache' },
  { name: 'remote library not downloaded', raw: 'components/ui is a remote library that has not been downloaded yet. Run `stack remote sync ui` first, then try again.', pattern: 'remote-cache' },
  { name: 'not in remote library', raw: 'components/ui/x is not in the remote library components/ui (at abc1234). Check the id with `stack search`; if it is new there, commit it to that repo and run `stack remote sync`.', pattern: 'remote-pin' },
  { name: 'bad ref', raw: 'The stack has no commit, tag or branch called "v9" (looked in /home/a/stack). Check the spelling, or run `git -C /home/a/stack fetch` to get newer commits, then try again.', pattern: 'bad-ref' },
  { name: 'restore: commit missing', raw: 'Cannot restore skills/a: this clone does not have the commit it was imported from (abc1234). Run `git fetch` in the stack checkout (or `stack remote sync` for remote libraries), then try again.', pattern: 'remote-pin' },
  { name: 'restore: content missing', raw: 'Cannot restore .agents/skills/a/SKILL.md: the stack checkout is missing its content (abc1234). Run `git fetch` in the stack checkout, then try again.', pattern: 'remote-pin' },
  { name: 'project folder missing', raw: 'Project folder not found: /home/a/gone. Check the path, or run the command from inside your project.', pattern: 'project-missing' },
  { name: 'bad --resolve', raw: '--resolve needs <file>=mine or <file>=upstream, got "a=bad". Example: --resolve SKILL.md=mine', pattern: 'bad-choice' },
  { name: 'choice flag on wrong command', raw: '--keep-mine, --take-upstream, --resolve and --no-backup only work with `stack update`. Run `stack update --help` for examples.', pattern: 'bad-choice' },
  { name: 'both mine and upstream', raw: 'SKILL.md is listed for both "mine" and "upstream". Pick one, e.g. --keep-mine SKILL.md.', pattern: 'bad-choice' },
  { name: 'choice flag without value', raw: '--keep-mine needs a file name, e.g. --keep-mine SKILL.md. Run `stack update --help` for examples.', pattern: 'bad-choice' },
  { name: 'unknown command', raw: 'There is no command called "frobnicate". Run `stack --help` to see the commands.', pattern: 'unknown-kind' },
  { name: 'unknown option', raw: 'Unknown option --x. Run `stack --help` to see the commands, or `stack <command> --help` for that command\'s options.', pattern: 'unknown-kind' },
  { name: 'remove without id', raw: 'stack remove needs exactly one entry id. Run `stack status` to see what is imported.', pattern: 'unknown-kind' },
  { name: 'half-written block', raw: '.gitignore has a half-written escacs block; delete the "# >>> escacs stack" line and run `stack gitignore`', pattern: 'half-block' },
  { name: 'escapes project', raw: '--to "../x" escapes the project', pattern: 'outside-project' },
  { name: 'damaged stack.toml', raw: 'stack.toml line 4: expected a value', pattern: 'toml-damaged' },
  { name: 'worker not in stack', raw: 'workers/zed is not a worker in the stack', pattern: 'worker-unknown' },
  { name: 'dry-run unsupported', raw: 'worker use does not support --dry-run', pattern: 'dry-run' },
];

describe('humanizeCliError against the rewritten CLI messages', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const h = humanizeCliError(c.raw);
      expect(h.pattern).toBe(c.pattern);
      expect(h.known).toBe(true);
      if (c.title) expect(h.title).toMatch(c.title);
      if (c.next) expect(h.next).toMatch(c.next);
    });
  }
});

describe('cliHint', () => {
  it('reuses the CLI sentence only when it has no command or flag in it', () => {
    expect(cliHint('Project folder not found: /x. Check the path, or run the command from inside your project.')).toBe('Check the path, or run the command from inside your project.');
    expect(cliHint('Would not overwrite 1 file.\nNothing was imported. Choose another folder with --to <dir>.')).toBeNull();
    expect(cliHint('There is no entry "x". Run `stack search <word>` to find it.')).toBeNull();
    expect(cliHint('Plain message with one sentence')).toBeNull();
  });
  it('an unknown message keeps the CLI wording as its detail and its good hint as the next step', () => {
    const h = humanizeCliError('The widget is jammed. Wait a moment and try again.');
    expect(h.known).toBe(false);
    expect(h.detail).toBe('The widget is jammed.');
    expect(h.next).toBe('Wait a moment and try again.');
  });
});
