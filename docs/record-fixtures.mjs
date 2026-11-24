// Builds a throwaway git project + a throwaway copy of the stack, drives the REAL stack CLI through
// init / import / edits / deletions / upstream changes, and records the --json outputs as fixtures.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [, , realStack, outDir, workDir] = process.argv;
const work = workDir;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const stackCopy = join(work, 'stack');
cpSync(realStack, stackCopy, { recursive: true });
const proj = join(work, 'proj');
mkdirSync(proj);

const env = { ...process.env, ESCACS_STACK: stackCopy, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });
const cli = join(stackCopy, 'tools/stack/cli.mjs');
const meta = { runs: {} };
function stack(name, args, { json = true, allowFail = false } = {}) {
  const argv = [...args, ...(json ? ['--json'] : [])];
  try {
    const stdout = execFileSync('node', [cli, ...argv, '--project', proj], { cwd: proj, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (name) { writeFileSync(join(outDir, `${name}.json`), stdout); meta.runs[name] = { argv }; }
    return stdout;
  } catch (e) {
    if (!allowFail) throw e;
    const text = String(e.stderr ?? '').trim();
    if (name) { writeFileSync(join(outDir, `${name}.txt`), text + '\n'); meta.runs[name] = { argv, failed: true }; }
    return text;
  }
}
mkdirSync(outDir, { recursive: true });

git(proj, 'init', '-q');
git(proj, 'commit', '-q', '--allow-empty', '-m', 'init');
stack(null, ['init']);
stack('import', ['import', 'skills/agent-chain', 'skills/agent-lanes', 'skills/create-agents-md', 'skills/coss']);
stack('status-clean', ['status']);

const read = (p) => readFileSync(join(proj, p), 'utf8');
const write = (p, t) => writeFileSync(join(proj, p), t);

// Both sides change agent-chain: SKILL.md (same line -> real conflict) and references/roles.md (different parts).
const chain = '.agents/skills/agent-chain';
write(`${chain}/SKILL.md`, read(`${chain}/SKILL.md`).replace(/^# .*$/m, '# Agent chain (my wording)'));
write(`${chain}/references/roles.md`, read(`${chain}/references/roles.md`) + '\nMy own note at the end.\n');
// User edits one file only (coss/LICENSE) and deletes one (create-agents-md template).
appendFileSync(join(proj, '.agents/skills/coss/LICENSE'), '\nMy change.\n');
rmSync(join(proj, '.agents/skills/create-agents-md/references/template.md'));

// The stack moves on: agent-chain (both files), agent-lanes (SKILL.md only), create-agents-md SKILL.md.
const up = (rel, fn) => { const f = join(stackCopy, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); };
up('skills/agent-chain/SKILL.md', (t) => t.replace(/^# .*$/m, '# Agent chain (upstream wording)'));
up('skills/agent-chain/references/roles.md', (t) => '# Upstream heading line\n' + t);
up('skills/agent-lanes/SKILL.md', (t) => t + '\nUpstream addition.\n');
up('skills/create-agents-md/SKILL.md', (t) => t + '\nUpstream addition.\n');
git(stackCopy, 'add', '-A', 'skills');
git(stackCopy, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'upstream changes');

stack('status', ['status']);
stack('update-dry-merge', ['update', 'skills/agent-chain', '--dry-run']);
stack('update-dry-keep-take', ['update', 'skills/agent-chain', '--keep-mine', 'SKILL.md', '--take-upstream', 'references/roles.md', '--dry-run']);
stack('update-dry-unmatched', ['update', 'skills/agent-lanes', '--keep-mine', 'nope.md', '--dry-run']);
stack('restore-dry', ['restore', '--dry-run']);
stack('restore-entry', ['restore', 'skills/create-agents-md']);
stack('status-after-restore', ['status']);
stack('update-keep-take', ['update', 'skills/agent-chain', '--keep-mine', 'SKILL.md', '--take-upstream', 'references/roles.md']);
stack('update-all', ['update']);
stack('status-after-update', ['status']);

// Failures (plain text on stderr).
stack('err-no-entry', ['import', 'nope/x'], { json: false, allowFail: true });
stack('err-collision', ['import', 'skills/coss', '--to', '.agents/skills/agent-lanes'], { json: false, allowFail: true });
stack('err-bad-resolve', ['update', 'skills/agent-chain', '--resolve', 'a=bad'], { json: false, allowFail: true });
stack('err-not-imported', ['restore', 'skills/nope'], { json: false, allowFail: true });
stack('err-already', ['import', 'skills/coss'], { json: false, allowFail: true });
writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log('ok', Object.keys(meta.runs).join(' '));
