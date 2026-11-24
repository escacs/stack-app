// The humanize layer: raw CLI stderr / stdout / JSON refusals become plain
// sentences. Every failure has a title (what went wrong), a detail (why, in
// plain words) and a next step (what to do), plus an optional action. The raw
// text is kept for a collapsed "Show technical details" disclosure and is
// never part of the sentence. Pure: no store or view imports, so it is
// unit-tested in node. Sentences may carry `code` spans in backticks (folders,
// file names); views render them with <Rich>.
import type { OpSection, UpdateFile, UpdateFileOutcome, UpdateJson } from './json';

export type ActionId =
  | 'open-setup'
  | 'recheck'
  | 'run-init'
  | 'retry'
  | 'restore'
  | 'open-project'
  | 'add-command'
  | 'get-node';

export type HumanAction = { id: ActionId; label: string; run: () => void };

export type Human = {
  title: string;
  detail: string;
  next: string;
  action?: HumanAction;
  /** The untouched raw text: only ever shown inside the technical-details disclosure. */
  raw: string;
  /** False for the "Something went wrong" fallback. */
  known: boolean;
  /** Which table row matched (tests, probes). */
  pattern: string;
};

export type HumanCtx = {
  /** The entry or preset the operation was about (`skills/pony`). */
  subject?: string | null;
  /** Overrides what an action does (a view knows better than the global runner). */
  run?: (id: ActionId) => void;
};

// The app registers what each action does once (navigation, store calls), so
// this module stays free of them.
let runner: (id: ActionId) => void = () => {};
export function setActionRunner(fn: (id: ActionId) => void): void {
  runner = fn;
}

const ACTION_LABEL: Record<ActionId, string> = {
  'open-setup': 'Open stack setup',
  recheck: 'Check again',
  'run-init': 'Set up this project',
  retry: 'Try again',
  restore: 'Restore files',
  'open-project': 'Open the project page',
  'add-command': 'Add stack command',
  'get-node': 'Get Node.js',
};

const KIND_WORD: Record<string, string> = {
  skills: 'a skill',
  styles: 'a style',
  systems: 'a system',
  components: 'a component',
  libraries: 'a library',
  assets: 'an asset',
  templates: 'a template',
  workers: 'a worker',
  agents: 'an agent',
  presets: 'a preset',
};

/** `skills/pony` → `pony`; `components/react/button` → `button`. */
export const nameOf = (id: string): string => id.split('/').filter(Boolean).pop() ?? id;

/** `skills/pony` → `pony (a skill)`. */
export function describeId(id: string): string {
  const kind = KIND_WORD[id.split('/')[0]];
  return kind ? `${nameOf(id)} (${kind})` : nameOf(id);
}

/** Replace every `kind/name` id inside a sentence with the bare name. */
export function nameIds(text: string): string {
  return text.replace(/\b(skills|styles|systems|components|libraries|assets|templates|workers|agents|presets)\/([\w./-]+)/g, (_m, _k: string, rest: string) => nameOf(rest));
}

const listAfter = (raw: string): string[] => {
  const lines = raw.split('\n');
  const i = lines.findIndex((l) => /:\s*$/.test(l.trim()) || /already exist|imported twice/.test(l));
  return (i < 0 ? [] : lines.slice(i + 1)).map((l) => l.trim()).filter(Boolean);
};
const some = (items: string[], max = 3): string => {
  const shown = items.slice(0, max).map((f) => `\`${f}\``).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
};

type Made = { title: string; detail: string; next: string; action?: ActionId };
type Row = { id: string; test: RegExp; make: (m: RegExpExecArray, raw: string, ctx: HumanCtx) => Made };

const subj = (ctx: HumanCtx, fallback = 'This'): string => (ctx.subject ? nameOf(ctx.subject) : fallback);

// First match wins: specific refusals come before the broad network and
// "usage" ones. Each row's regex is tested on the whole raw text.
export const PATTERNS: readonly Row[] = [
  {
    id: 'node-missing',
    test: /node (?:22\+? )?(?:is required|was not found)|node\.js 22|node: command not found|requires node/i,
    make: () => ({
      title: 'Node.js is missing',
      detail: 'The app needs Node.js 22 or newer to read the stack, and could not find it.',
      next: 'Install Node.js, then check again.',
      action: 'get-node',
    }),
  },
  {
    id: 'cli-not-found',
    test: /no escacs\/stack checkout|no usable escacs\/stack|cannot find .*cli\.mjs|tools\/stack\/cli\.mjs|stack command not found|spawn .*(?:ENOENT|not found)|failed to run (?:the )?stack/i,
    make: () => ({
      title: 'The stack was not found',
      detail: 'The app could not find a copy of the stack on this computer, so it cannot read the catalog.',
      next: 'Open stack setup and get the stack, or point the app at the folder you already have.',
      action: 'open-setup',
    }),
  },
  {
    id: 'bad-ref',
    test: /has no commit, tag or branch called "([^"]+)"/i,
    make: (m) => ({
      title: `The stack has no version called ${m[1]}`,
      detail: 'That commit, tag or branch is not in the copy of the stack on this computer.',
      next: 'Check the spelling, or refresh the stack to get newer versions, then try again.',
      action: 'open-setup',
    }),
  },
  {
    id: 'bad-stack-path',
    test: /not a usable stack|not a git checkout|has no commits|stack ref .* not found|not a stack checkout/i,
    make: () => ({
      title: 'That folder is not a usable stack',
      detail: 'The folder is missing the stack tools, or it is not a git copy of the stack.',
      next: 'Pick the folder that holds the stack, or let the app find it automatically.',
      action: 'open-setup',
    }),
  },
  {
    id: 'command-not-linked',
    test: /is not linked yet|not linked at|stack command is not/i,
    make: () => ({
      title: 'The stack command is not set up',
      detail: 'The app works without it, but the terminal cannot run `stack` yet.',
      next: 'Add the stack command to use it from a terminal.',
      action: 'add-command',
    }),
  },
  {
    id: 'git-missing',
    test: /git is not installed|git: command not found|spawn git ENOENT/i,
    make: () => ({
      title: 'Git is missing',
      detail: 'Importing needs Git to read the stack, and it was not found on this computer.',
      next: 'Install Git, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'auth',
    test: /permission denied \(publickey\)|authentication failed|could not read username|no github auth|gh auth login|repository not found/i,
    make: () => ({
      title: 'GitHub did not let the app in',
      detail: 'The stack is private and this computer is not signed in to GitHub.',
      next: 'Sign in to GitHub in a terminal, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'offline',
    test: /could not resolve host|unable to access|network is unreachable|enotfound|econnrefused|econnreset|etimedout|fetch failed|failed to connect|connection (?:timed out|refused|reset)|timed out waiting for the background refresh|you are offline|no network/i,
    make: () => ({
      title: 'No internet connection',
      detail: 'The catalog could not be refreshed because the computer is offline. Imports that are already in your project are not affected.',
      next: 'Check the connection and try again.',
      action: 'retry',
    }),
  },
  {
    id: 'not-git-repo',
    test: /not a git repository|not inside a git|no \.git|not a git repo/i,
    make: () => ({
      title: 'This folder is not a git project',
      detail: 'Imports are tracked with git, and this folder has no git history yet.',
      next: 'Open a project folder that is a git repository, or run git init in this one.',
      action: 'open-project',
    }),
  },
  {
    id: 'not-initialised',
    test: /no stack\.toml|not initiali[sz]ed|stack\.toml not found|nothing is tracked|no stack imports here|run init first/i,
    make: () => ({
      title: 'This project is not set up yet',
      detail: 'Nothing has been imported here, so there is no list of imports to read.',
      next: 'Set the project up, then import what you need.',
      action: 'run-init',
    }),
  },
  {
    id: 'worktree-locked',
    test: /index\.lock|unable to create .*\.lock|another git process|worktree .*locked|is locked|\blocked\b.*worktree/i,
    make: () => ({
      title: 'The project is locked by another git process',
      detail: 'Git is busy in this folder (another app, a terminal or a sync is using it), so nothing was written.',
      next: 'Wait for the other process to finish, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'worktree-dirty',
    test: /uncommitted changes|working tree is dirty|worktree is dirty|local changes would be overwritten|your local changes|commit or stash/i,
    make: () => ({
      title: 'This folder has changes that are not saved in git',
      detail: 'Importing now could mix your changes with the imported files.',
      next: 'Commit or stash your changes, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'interrupted',
    test: /interrupted|import was cut short|partially (?:written|imported)|incomplete import|left .* half|killed|sigterm|sigint/i,
    make: (_m, raw) => {
      const at = raw.search(/not written:/i);
      const wrote = (/wrote:\s*\n([\s\S]*?)(?:\n\s*not written:|$)/i.exec(raw)?.[1] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      const left = at < 0 ? [] : raw.slice(at).split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
      const parts = [
        wrote.length ? `These files landed: ${some(wrote)}.` : '',
        left.length ? `These did not: ${some(left)}.` : '',
      ].filter(Boolean);
      return {
        title: 'The import stopped halfway',
        detail: parts.join(' ') || 'Some of the files were written before it stopped, so the project holds a partial import.',
        next: 'Restore the files to finish it, or remove the entry to start over.',
        action: 'restore',
      };
    },
  },
  {
    id: 'half-block',
    test: /half-written escacs block/i,
    make: () => ({
      title: 'A managed section is half written',
      detail: 'A file the stack manages (like `.gitignore` or `AGENTS.md`) contains a section that was cut off.',
      next: 'Delete the line that starts the stack section in that file, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'collision',
    test: /already exist with (?:other|different) content|would not overwrite \d+ files?/i,
    make: (_m, raw) => {
      const files = listAfter(raw);
      return {
        title: 'Some files are already there',
        detail: files.length ? `These files exist with different content: ${some(files)}. Nothing was written.` : 'Files with different content are already in the way. Nothing was written.',
        next: 'Move or rename those files, or choose a different folder.',
      };
    },
  },
  {
    id: 'imported-twice',
    test: /imported twice|would write the same project file/i,
    make: (_m, raw) => ({
      title: 'Two imports want the same files',
      detail: `Two entries would write to the same place: ${some(listAfter(raw)) || 'the same folder'}.`,
      next: 'Give each entry its own folder.',
    }),
  },
  {
    id: 'to-multi',
    test: /--to works with one id|--to and per-entry|--to puts one entry in one folder|--to cannot be combined with a preset/i,
    make: () => ({
      title: 'A custom folder works for one entry at a time',
      detail: 'Several entries were picked together with one destination folder.',
      next: 'Import them one by one, or leave the folder on its default.',
    }),
  },
  {
    id: 'no-entry-named',
    test: /nothing to import: name at least one entry/i,
    make: () => ({
      title: 'Nothing was picked to import',
      detail: 'The import was asked to run without naming any entry.',
      next: 'Pick at least one entry from the catalog.',
    }),
  },
  {
    id: 'already-imported',
    test: /already imported: (\S+?)\.(?:\s|$)/i,
    make: (m) => ({
      title: `${nameOf(m[1])} is already imported`,
      detail: 'This project already has it, so there is nothing to add.',
      next: 'Use Update on its page to bring in newer versions.',
      action: 'open-project',
    }),
  },
  {
    id: 'no-entry',
    test: /no entry "([^"]+)"/i,
    make: (m) => ({
      title: `${nameOf(m[1])} is not in the stack`,
      detail: 'The stack has no entry by that name. It may have been renamed or removed.',
      next: 'Search the catalog for the current name.',
    }),
  },
  {
    id: 'not-committed',
    test: /(\S+) (?:is not an entry at stack commit|is not an entry in the stack's latest commit|is a remote skill that exists in the stack folder but not in its latest commit|is a component library with no committed entries)|new entries must be committed/i,
    make: (m, _r, ctx) => ({
      title: `${m[1] && m[1] !== 'is' ? nameOf(m[1]) : subj(ctx)} is not in the stack yet`,
      detail: 'It exists only as a draft in the stack folder, so it cannot be imported.',
      next: 'Commit it to the stack first, then refresh the catalog.',
    }),
  },
  {
    id: 'not-imported',
    test: /(\S+) is not imported (?:here|in this project)/i,
    make: (m) => ({
      title: `${nameOf(m[1])} is not imported in this project`,
      detail: 'There is nothing to remove or update for it.',
      next: 'Refresh the project page to see what is actually imported.',
      action: 'recheck',
    }),
  },
  {
    id: 'no-preset',
    test: /no preset "([^"]+)"/i,
    make: (m) => ({
      title: `The preset ${m[1]} was not found`,
      detail: 'It may have been renamed or removed from the stack.',
      next: 'Open the preset list and pick one that is there.',
    }),
  },
  {
    id: 'bad-preset',
    test: /preset: |\[preset\]|preset has no|preset names must|\[\[import\]\]/i,
    make: () => ({
      title: 'A preset in the stack is broken',
      detail: 'Its file is missing a required part or has one that is not recognised.',
      next: 'Pick another preset, and tell whoever looks after the stack.',
    }),
  },
  {
    id: 'outside-project',
    test: /escapes the project|is outside the project|use a project-relative path|must be a relative path|absolute paths/i,
    make: () => ({
      title: 'That folder is outside the project',
      detail: 'Imports can only go to a folder inside the project.',
      next: 'Choose a folder inside the project.',
    }),
  },
  {
    id: 'project-missing',
    test: /project (?:folder )?not found|project folder .*(?:missing|does not exist)|no such file or directory.*project/i,
    make: () => ({
      title: 'The project folder is missing',
      detail: 'The folder was moved, renamed or deleted since it was opened.',
      next: 'Open the project again from its new place.',
      action: 'open-project',
    }),
  },
  {
    id: 'remote-cache',
    test: /remote skill but its cache is not ready|has not been downloaded yet|cache clone|no remote component libraries|no remote library|invalid remote library|remote: /i,
    make: () => ({
      title: 'A shared library could not be reached',
      detail: 'The stack takes this entry from another repository, and its saved copy is not ready.',
      next: 'Refresh the catalog while online, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'remote-pin',
    test: /not at stack commit|not an entry in remote|is not in the remote library|does not have the commit it was imported from|checkout is missing its content|blob .* is missing|is not in .* \(fetch first\)|fetch first/i,
    make: () => ({
      title: 'The stack copy is out of date',
      detail: 'This entry needs a newer version of the stack than the one on this computer.',
      next: 'Refresh the catalog, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'toml-damaged',
    test: /stack\.toml(?: line \d+)?:|stack\.lock\.json|lock (?:id|"entries"|"remotes")|\[\[?entries?\]\]/i,
    make: () => ({
      title: 'The import list in this project is damaged',
      detail: 'The file that records what was imported (`stack.toml`) has something the app cannot read.',
      next: 'Open that file and fix or remove the line named in the technical details.',
    }),
  },
  {
    id: 'permission',
    test: /eacces|eperm|permission denied|read-only file system|erofs/i,
    make: () => ({
      title: 'The app is not allowed to write there',
      detail: 'The folder is read-only or belongs to another user.',
      next: 'Fix the folder permissions, or choose another folder.',
      action: 'retry',
    }),
  },
  {
    id: 'disk-full',
    test: /enospc|no space left/i,
    make: () => ({
      title: 'The disk is full',
      detail: 'There was no room to write the files.',
      next: 'Free some space, then try again.',
      action: 'retry',
    }),
  },
  {
    id: 'file-missing',
    test: /no such file '([^']+)'|no file (\S+) in|no such file or directory|enoent/i,
    make: () => ({
      title: 'A file was not found',
      detail: 'Something the app expected on disk is gone.',
      next: 'Refresh and try again.',
      action: 'recheck',
    }),
  },
  {
    id: 'conflicts',
    test: /<<<<<<<|merge conflict|conflicts? in/i,
    make: () => ({
      title: 'Your edits and the stack changed the same lines',
      detail: 'The files now hold both versions, marked so you can choose.',
      next: 'Open each file, keep the side you want and delete the marker lines.',
    }),
  },
  {
    id: 'bad-choice',
    test: /--(?:resolve|keep-mine|take-upstream|no-backup)\b.*(?:needs|only work)|is listed for both "mine" and "upstream"/i,
    make: () => ({
      title: 'That choice for a file was not accepted',
      detail: 'The stack did not understand how to settle one of the files you both changed.',
      next: 'Pick Keep mine, Take upstream or Merge for each file again, then update.',
    }),
  },
  {
    id: 'unknown-kind',
    test: /unknown kind "([^"]+)"|unknown command|there is no command called|unknown option|unknown flag|unknown (?:preset|remote|worker) action|needs exactly one entry id|usage: /i,
    make: () => ({
      title: 'The app and the stack do not match',
      detail: 'The stack on this computer does not understand what the app asked for. It is probably older or newer than the app.',
      next: 'Update the stack (or the app) so the two versions agree.',
      action: 'open-setup',
    }),
  },
  {
    id: 'worker-unknown',
    test: /is not a worker in the stack|takes a worker name|--worker needs a value|init --worker/i,
    make: () => ({
      title: 'That worker is not in the stack',
      detail: 'The name does not match any worker the stack knows.',
      next: 'Pick your name from the list of workers.',
    }),
  },
  {
    id: 'unreadable-reply',
    test: /could not parse the stack reply|reply was truncated|expected a JSON object/i,
    make: () => ({
      title: 'The answer from the stack was unreadable',
      detail: 'The stack replied, but not in a form the app could understand. It may be a version mismatch.',
      next: 'Try again, and update the stack if it keeps happening.',
      action: 'retry',
    }),
  },
  {
    id: 'dry-run',
    test: /--dry-run is only supported|does not support --dry-run/i,
    make: () => ({
      title: 'A preview is not available for that',
      detail: 'Only imports, updates, restores and presets can be previewed before they run.',
      next: 'Run it directly instead.',
    }),
  },
  {
    id: 't3-missing',
    test: /\bt3\b.*(?:not found|not installed|unavailable|enoent)|t3 code is not|t3 (?:cli|app) /i,
    make: () => ({
      title: 'T3 Code is not available',
      detail: 'The app could not talk to T3 Code, so threads and worktrees cannot be listed.',
      next: 'Start T3 Code, then check again.',
      action: 'recheck',
    }),
  },
  {
    id: 't3-thread',
    test: /\bthread\b.*(?:not found|failed|rejected|cannot)|could not (?:send|start) (?:the )?thread/i,
    make: () => ({
      title: 'T3 Code did not take the message',
      detail: 'The thread could not be started or written to.',
      next: 'Check that T3 Code is running, then send it again.',
      action: 'retry',
    }),
  },
  {
    id: 'update-check',
    test: /updater|update check|latest\.json|could not fetch a valid release/i,
    make: () => ({
      title: 'Could not check for a new app version',
      detail: 'The release server did not answer properly.',
      next: 'Try again later.',
      action: 'retry',
    }),
  },
  {
    id: 'timeout',
    test: /timed out|timeout/i,
    make: () => ({
      title: 'That took too long',
      detail: 'The stack did not answer in time.',
      next: 'Try again.',
      action: 'retry',
    }),
  },
];

/** The fallback for text no row recognises. */
export const FALLBACK = {
  title: 'Something went wrong',
  detail: 'The app could not finish this, and the cause is not one it knows.',
  next: 'Try again. If it keeps happening, open the technical details and share them.',
} as const;

/** Turn raw CLI / bridge text into a title, detail, next step and optional action. */
export function humanizeCliError(raw: string, ctx: HumanCtx = {}): Human {
  const text = (raw ?? '').trim();
  for (const row of PATTERNS) {
    const m = row.test.exec(text);
    if (!m) continue;
    const made = row.make(m, text, ctx);
    return {
      title: made.title,
      detail: made.detail,
      next: made.next,
      action: made.action ? mkAction(made.action, ctx) : undefined,
      raw: text,
      known: true,
      pattern: row.id,
    };
  }
  // The rewritten CLI words its own messages for people: keep its first sentence and any hint free of commands.
  const hint = cliHint(text);
  const lead = hint && !/\n\s+at /.test(text) ? firstSentence(text) : null;
  return {
    ...FALLBACK,
    ...(lead && lead.length <= 160 ? { detail: lead } : {}),
    ...(hint ? { next: hint } : {}),
    action: mkAction('retry', ctx),
    raw: text,
    known: false,
    pattern: 'fallback',
  };
}

const flatText = (raw: string): string => raw.split('\n').filter((l) => !/^\s/.test(l)).join(' ').trim();
const sentences = (raw: string): string[] => flatText(raw).split(/(?<=[.!?])\s+/).filter(Boolean);
const firstSentence = (raw: string): string | null => sentences(raw)[0] ?? null;

/**
 * The CLI's own next-step sentence(s) (everything after its first sentence),
 * only when they read well to someone not at a terminal: no backticked
 * command, no --flag, no <placeholder>, no `stack ...` command.
 */
export function cliHint(raw: string): string | null {
  const rest = sentences(raw).slice(1).join(' ');
  if (!rest || /`|--|<|\bstack \w+/.test(rest)) return null;
  return rest;
}

function mkAction(id: ActionId, ctx: HumanCtx): HumanAction {
  return { id, label: ACTION_LABEL[id], run: () => (ctx.run ?? runner)(id) };
}


// ---------------------------------------------------------------- op results

export type HumanSection = { title: string; lines: string[]; tone?: 'bad' | 'dim'; next?: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const arrow = /^(\S+) → (.+?)(?: \(required by (\S+)\))?$/;

/** One `id → path` import line as a sentence with the folder as code. */
export function importLine(line: string): string {
  const m = arrow.exec(line);
  if (!m) return nameIds(line);
  const dep = m[3] ? `, needed by ${nameOf(m[3])}` : '';
  return `Imported ${describeId(m[1])} into \`${m[2]}\`${dep}`;
}

/** Op section titles and lines the app builds (json.ts describe*) as plain sentences. */
export function humanizeOp(sections: readonly OpSection[]): HumanSection[] {
  return sections.map((s): HumanSection => {
    const t = s.title;
    let m: RegExpExecArray | null;
    const out = (title: string, lines: string[] = s.lines.map(nameIds), next?: string): HumanSection => ({ title, lines, tone: s.tone, ...(next ? { next } : {}) });
    if ((m = /^imported (\d+) entr(?:y|ies)$/.exec(t))) {
      return out(m[1] === '1' ? 'Imported 1 item' : `Imported ${m[1]} items`, s.lines.map(importLine));
    }
    if (t === 'already here') return out('Already in your project', s.lines.map((l) => `${describeId(l)} was already imported`));
    if (t === '.gitignore') return out('Updated `.gitignore`', ['Imported files stay out of git.']);
    if (t === 'nothing to do') return out('Nothing to do: everything is already in place');
    if ((m = /^up to date with (\w+)$/.exec(t))) return out('Everything is up to date');
    if ((m = /^update (\S+) → (\w+) \((\d+) files? changed upstream\)$/.exec(t))) {
      return out(`Updated ${describeId(m[1])}`, [`${plural(Number(m[3]), 'file')} changed in the stack.`]);
    }
    if (t.startsWith('conflicts — ') || t.startsWith('conflicts (dry run')) {
      return out(
        t.includes('dry run') ? 'These files are in the way (nothing was written)' : 'Some files need you to choose',
        s.lines.map((f) => `\`${f}\``),
        t.includes('dry run') ? 'Move or rename them, or choose another folder.' : 'Open each file, keep the side you want and delete the marker lines.',
      );
    }
    if (t === 'merged (your edits kept)') return out('Merged, and your edits are kept', s.lines.map((l) => nameIds(l)));
    if (t === 'kept (edited here)') return out('Left alone because you edited them', s.lines.map((f) => `\`${f}\``));
    if (t.startsWith('skipped (deleted here')) return out('Skipped: you deleted them here', s.lines.map((f) => `\`${f}\``));
    if (t.startsWith('skipped (not an entry')) return out('Skipped: not in the stack at that version', s.lines.map(nameIds));
    if (t === 'removed from the stack; kept as is') return out('No longer in the stack, kept as they are', s.lines.map(nameIds));
    if (t === 'newly required (auto-imported)') return out('Also imported, because something needs it', s.lines.map(importLine));
    if ((m = /^remove (\S+)$/.exec(t))) return out(`Removed ${describeId(m[1])}`);
    if ((m = /^note: (.+) requires? (\S+)$/.exec(t))) return out(`${nameIds(m[1])} still needs ${nameOf(m[2])}`);
    if ((m = /^migrated stack\.lock\.json → stack\.toml \((.+)\)$/.exec(t))) return out(`Brought the old import list up to date (${m[1]})`);
    if (t === 'created stack.toml') return out('Set this project up for imports');
    if ((m = /^restored (\d+) files?$/.exec(t))) return out(`Restored ${plural(Number(m[1]), 'file')}`, s.lines.map((f) => `\`${f}\``));
    if (t.startsWith('sync done')) return out('Everything is already in place');
    return out(nameIds(t));
  });
}

/** Title and next step as one line, for a toast or a list row. */
export function oneSentence(h: Human): string {
  const t = h.title.replace(/[.!?]$/, '');
  return `${t}. ${h.next}`;
}

// ------------------------------------------------------------ update outcomes

/** The words one file's update outcome gets, in the review preview and the result toast. */
export function updateFileSentence(f: Pick<UpdateFile, 'path' | 'outcome'>, opts: { backup?: boolean } = {}): string {
  switch (f.outcome) {
    case 'kept-mine':
      return 'Kept yours';
    case 'took-upstream':
      return opts.backup === false
        ? 'Replaced with the stack\u2019s version'
        : `Replaced with the stack\u2019s version (yours saved as ${f.path}.mine)`;
    case 'conflict-markers':
      return 'Conflict markers written';
    case 'unchanged':
      return 'Already the same';
    default:
      return 'Updated to the stack\u2019s version';
  }
}

/** Outcomes the user decided or must act on; plain `updated`/`unchanged` are only counted. */
const NOTABLE: readonly UpdateFileOutcome[] = ['kept-mine', 'took-upstream', 'conflict-markers'];

/**
 * An update result as readable sentences, one per file that needed a decision
 * (`SKILL.md: Kept yours.`), a count for the rest, and a note for any
 * --keep-mine/--take-upstream file that matched nothing both sides changed.
 */
export function updateResultSentences(r: Pick<UpdateJson, 'updated' | 'unmatched'>, opts: { backup?: boolean } = {}): string[] {
  const out: string[] = [];
  let plain = 0;
  const entries = r.updated.length;
  for (const u of r.updated) {
    for (const f of u.files ?? []) {
      if (NOTABLE.includes(f.outcome)) out.push(`${entries > 1 ? `${nameOf(u.id)}/` : ''}${f.path}: ${updateFileSentence(f, opts)}.`);
      else if (f.outcome === 'updated') plain++;
    }
  }
  if (plain) out.push(`${plain} other ${plain === 1 ? 'file was' : 'files were'} brought up to date.`);
  if (r.unmatched?.length) out.push(`Nothing to settle for ${r.unmatched.join(', ')}: only one side changed ${r.unmatched.length === 1 ? 'it' : 'them'}.`);
  return out;
}

// ------------------------------------------------------------ stack command

export type CliLink = { status: string; link: string; message: string };

/** The state of the `stack` terminal command as one plain sentence (code spans in backticks). */
export function cliStatusText(l: CliLink): string {
  switch (l.status) {
    case 'missing':
      return 'The `stack` command is not set up in your terminal yet. The app works without it.';
    case 'foreign-file':
      return 'Something else already uses the name `stack` in your terminal folder, so the app left it alone.';
    case 'points-elsewhere':
      return 'The `stack` command points at a different copy of the stack, so the app left it alone.';
    case 'bin-not-on-PATH':
      return 'The `stack` command is linked, but your terminal cannot see it yet. Add `~/.local/bin` to your PATH and open a new terminal.';
    case 'linked-ok':
      return 'The `stack` command is set up.';
    default:
      return humanizeCliError(l.message).title;
  }
}

/** The provisioning report ("cloned with gh to ~/escacs/stack") as a sentence. */
export function provisionText(message: string): string {
  const m = /(?:cloned|clone) .* to (\S+)/i.exec(message) ?? /already at (\S+)/i.exec(message);
  if (m) return /already/i.test(message) ? `Using the stack that is already in \`${m[1]}\`.` : `Got the stack and saved it in \`${m[1]}\`.`;
  return humanizeCliError(message).known ? humanizeCliError(message).title : 'The stack is ready.';
}
