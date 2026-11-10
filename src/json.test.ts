// Tests for the typed --json layer (src/json.ts): decoding, markers,
// arg building, and op summaries. No DOM, no bridge.
import { describe, expect, it } from 'vitest';
import {
  CliError,
  cliText,
  describeImport,
  describeInit,
  describePresetApply,
  describeRemove,
  describeSync,
  describeUpdate,
  docNameFor,
  entryMarkers,
  fromStackOut,
  importArgs,
  parseJsonOut,
  presetApplyArgs,
  presetListArgs,
  presetShowArgs,
  refusalFiles,
  searchArgs,
  showFileArgs,
  toShowDoc,
  toShowFile,
  toStatusRows,
  type ImportJson,
  type InitJson,
  type JsonEntry,
  type ListJson,
  type PresetApplyJson,
  type PresetListJson,
  type PresetShowJson,
  type RemoveJson,
  type ShowJson,
  type StatusJson,
  type SyncJson,
  type UpdateJson,
} from './json';

const out = (stdout: string, code = 0, stderr = '', truncated = false) => ({
  stdout,
  stderr,
  code,
  truncated,
});

const entry = (id: string, committed = true): JsonEntry => ({
  id,
  kind: 'skill',
  name: id.split('/').pop() as string,
  summary: 's',
  status: 'stable',
  origin: 'custom',
  usage: 'link',
  doc: `${id}/SKILL.md`,
  tags: [],
  targets: [],
  committed,
  files: 2,
  bytes: 2048,
  preview: null,
});

describe('cliText', () => {
  it('prefers stderr, then stdout, then the exit code', () => {
    expect(cliText(out('out', 1, 'err'))).toBe('err');
    expect(cliText(out('out', 1))).toBe('out');
    expect(cliText(out('', 3))).toBe('stack exited 3');
  });
});

describe('parseJsonOut / fromStackOut', () => {
  it('parses one JSON object from stdout', () => {
    expect(parseJsonOut<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('rejects malformed JSON and non-objects', () => {
    expect(() => parseJsonOut('nope')).toThrow(/parse.*JSON/);
    expect(() => parseJsonOut('[1]')).toThrow(/JSON object/);
  });

  it('turns nonzero exits into CliError carrying the stderr text', () => {
    let err: unknown;
    try {
      fromStackOut(out('partial', 1, 'no entry "x"'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toBe('no entry "x"');
    expect((err as CliError).code).toBe(1);
  });

  it('refuses truncated output instead of parsing half a payload', () => {
    expect(() => fromStackOut(out('{"a":1}', 0, '', true))).toThrow(/truncated/);
  });

  it('decodes a list payload', () => {
    const data = fromStackOut<{ entries: { id: string }[] }>(
      out('{"command":"list","entries":[{"id":"a"}]}'),
    );
    expect(data.entries).toEqual([{ id: 'a' }]);
  });
});

describe('toStatusRows', () => {
  it('passes the commit through even with no rows', () => {
    expect(toStatusRows({ command: 'status', commit: 'abc123', rows: [] })).toEqual({
      commit: 'abc123',
      rows: [],
    });
  });

  it('maps upstream arrays to counts and keeps commit/flags', () => {
    const s: StatusJson = {
      command: 'status',
      commit: 'abc123',
      rows: [
        { id: 'a', path: '.stack/a', commit: 'abc123', local: ['f'], upstream: ['f', 'g'], gone: false },
        { id: 'b', path: '.stack/b', commit: 'abc123', local: [], upstream: [], gone: true },
      ],
    };
    expect(toStatusRows(s)).toEqual({
      commit: 'abc123',
      rows: [
        { id: 'a', commit: 'abc123', path: '.stack/a', local: ['f'], upstreamCount: 2, gone: false },
        { id: 'b', commit: 'abc123', path: '.stack/b', local: [], upstreamCount: 0, gone: true },
      ],
    });
  });
});

describe('toShowDoc / docNameFor', () => {
  const show: ShowJson = {
    command: 'show',
    id: 'skills/x',
    committed: true,
    usage: 'link',
    manifest: { name: 'x', kind: 'skill' },
    files: [{ path: 'SKILL.md', size: 10 }, { path: 'stack.json', size: 5 }],
    doc: '\n# body\n',
  };

  it('keeps file sizes and trims the doc body', () => {
    expect(toShowDoc(show)).toEqual({
      id: 'skills/x',
      committed: true,
      usage: 'link',
      manifest: { name: 'x', kind: 'skill' },
      files: [
        { path: 'SKILL.md', size: 10 },
        { path: 'stack.json', size: 5 },
      ],
      docBody: '# body',
    });
  });

  it('toShowFile maps bodies and binaries', () => {
    const base = { command: 'show', id: 'skills/x', file: 'SKILL.md', size: 10 } as const;
    expect(toShowFile({ ...base, binary: false, markdown: true, text: '# t', base64: null })).toEqual({
      id: 'skills/x',
      file: 'SKILL.md',
      size: 10,
      binary: false,
      markdown: true,
      text: '# t',
      base64: null,
    });
    expect(toShowFile({ ...base, binary: true, markdown: false, text: null, base64: null }).binary).toBe(true);
    expect(showFileArgs('skills/x', 'a/b.md')).toEqual(['skills/x', '--file', 'a/b.md', '--json']);
  });

  it('treats a missing doc as empty', () => {
    expect(toShowDoc({ ...show, doc: null }).docBody).toBe('');
  });

  it('picks the doc name from manifest entry, else the kind default', () => {
    expect(docNameFor({ entry: 'NOTES.md' })).toBe('NOTES.md');
    expect(docNameFor({ kind: 'skill' })).toBe('SKILL.md');
    expect(docNameFor({ kind: 'style' })).toBe('SKILL.md');
    expect(docNameFor({ kind: 'system' })).toBe('README.md');
    expect(docNameFor({})).toBe('README.md');
  });
});

describe('entryMarkers', () => {
  it('flags not-committed entries', () => {
    expect(entryMarkers(entry('a', false), new Set())).toEqual({
      notCommitted: true,
      uncommittedInStack: false,
    });
  });

  it('flags uncommitted-in-stack entries', () => {
    expect(entryMarkers(entry('a'), new Set(['a']))).toEqual({
      notCommitted: false,
      uncommittedInStack: true,
    });
  });

  it('allows both markers at once (new entries also show in git status)', () => {
    expect(entryMarkers(entry('a', false), new Set(['a']))).toEqual({
      notCommitted: true,
      uncommittedInStack: true,
    });
  });

  it('is quiet for clean committed entries', () => {
    expect(entryMarkers(entry('a'), new Set(['b']))).toEqual({
      notCommitted: false,
      uncommittedInStack: false,
    });
  });
});

describe('searchArgs / importArgs', () => {
  it('builds a plain query with --kind and --json', () => {
    expect(searchArgs('pull request', 'skill')).toEqual(['--kind', 'skill', '--json', 'pull request']);
    expect(searchArgs('x', '')).toEqual(['--json', 'x']);
  });

  it('shields dash-led queries behind -- (flags stay before it)', () => {
    expect(searchArgs('-foo', 'skill')).toEqual(['--kind', 'skill', '--json', '--', '-foo']);
  });

  it('adds --to only when set', () => {
    expect(importArgs('skills/a', '')).toEqual(['skills/a', '--json']);
    expect(importArgs('skills/a', '  vendor ')).toEqual(['skills/a', '--to', 'vendor', '--json']);
  });
});

describe('describeImport', () => {
  it('lists imports with requiredBy and the gitignore touch', () => {
    const r: ImportJson = {
      command: 'import',
      commit: 'c',
      imported: [
        { id: 'a', path: '.stack/a' },
        { id: 'b', path: '.stack/b', requiredBy: 'a' },
      ],
      already: ['c'],
      gitignore: 'updated',
    };
    const secs = describeImport(r);
    expect(secs[0].title).toBe('imported 2 entries');
    expect(secs[0].lines).toEqual(['a → .stack/a', 'b → .stack/b (required by a)']);
    expect(secs[1]).toEqual({ title: 'already here', lines: ['c'], tone: 'dim' });
    expect(secs[2].title).toBe('.gitignore');
  });
});

describe('describeUpdate', () => {
  const base: UpdateJson = {
    command: 'update',
    commit: 'abcdef123',
    updated: [],
    conflicts: [],
    merged: [],
    kept: [],
    skipped: [],
    gone: [],
    imported: [],
    upToDate: true,
  };

  it('reports up-to-date with the short commit', () => {
    expect(describeUpdate(base)).toEqual([
      { title: 'up to date with abcdef1', lines: [], tone: 'dim' },
    ]);
  });

  it('orders conflicts first with a bad tone', () => {
    const secs = describeUpdate({
      ...base,
      upToDate: false,
      updated: [{ id: 'a', changed: 2 }],
      conflicts: ['.stack/a/f'],
      merged: ['.stack/a/g'],
      gone: ['b'],
      imported: [{ id: 'c', path: '.stack/c' }],
    });
    expect(secs[0].title).toContain('update a → abcdef1 (2 files changed upstream)');
    const bad = secs.find((s) => s.tone === 'bad');
    expect(bad?.title).toContain('conflicts');
    expect(bad?.lines).toEqual(['.stack/a/f']);
    expect(secs.map((s) => s.title)).toContain('merged (your edits kept)');
    expect(secs.map((s) => s.title)).toContain('removed from the stack; kept as is');
    expect(secs.map((s) => s.title)).toContain('newly required (auto-imported)');
  });
});

describe('describeRemove', () => {
  it('names kept files, requirers and the gitignore touch', () => {
    const r: RemoveJson = {
      command: 'remove',
      removed: 'a',
      kept: ['.stack/a/edited.md'],
      requiredBy: ['b', 'c'],
      gitignore: 'updated',
    };
    const titles = describeRemove(r).map((s) => s.title);
    expect(titles[0]).toBe('remove a');
    expect(titles[1]).toBe('note: b, c require a');
    expect(titles[2]).toBe('kept (edited here)');
  });
});

describe('describeSync', () => {
  it('reports the quiet case and the restored case', () => {
    const quiet: SyncJson = { command: 'sync', restored: [], kept: [], skipped: [] };
    expect(describeSync(quiet)[0].title).toBe('sync done: everything already in place');
    const busy: SyncJson = { command: 'sync', restored: ['a'], kept: ['b'], skipped: ['c'] };
    expect(describeSync(busy).map((s) => s.title)).toEqual([
      'restored 1 file',
      'kept (edited here)',
      'skipped (not an entry at the recorded commit)',
    ]);
  });
});

describe('library blocks', () => {
  it('decodes list rows carrying a library block, markers unaffected', () => {
    const data = fromStackOut<ListJson>(
      out(
        JSON.stringify({
          command: 'list',
          kind: null,
          count: 1,
          entries: [
            {
              ...entry('components/react/button'),
              kind: 'component',
              library: { name: 'react', extends: null, default: true },
            },
          ],
          uncommitted: [],
        }),
      ),
    );
    expect(data.entries[0].library).toEqual({ name: 'react', extends: null, default: true });
    expect(entryMarkers(data.entries[0], new Set())).toEqual({
      notCommitted: false,
      uncommittedInStack: false,
    });
  });

  it('leaves library absent for other kinds', () => {
    expect(entry('skills/a').library).toBeUndefined();
  });
});

describe('describeInit', () => {
  it('reports a fresh stack.toml plus the gitignore touch', () => {
    const r: InitJson = { command: 'init', migrated: false, entries: 0, gitignore: 'updated' };
    expect(describeInit(r)).toEqual([
      { title: 'created stack.toml', lines: [] },
      { title: '.gitignore', lines: ['managed escacs block updated'], tone: 'dim' },
    ]);
  });

  it('reports a legacy migration with the entry count', () => {
    const r: InitJson = { command: 'init', migrated: true, entries: 2, gitignore: 'unchanged' };
    const secs = describeInit(r);
    expect(secs[0].title).toBe('migrated stack.lock.json → stack.toml (2 entries)');
    expect(secs).toHaveLength(1);
  });
});

describe('preset args', () => {
  it('builds list/show/apply argvs, --dry-run for dry runs only', () => {
    expect(presetListArgs()).toEqual(['list', '--json']);
    expect(presetShowArgs('web')).toEqual(['show', 'web', '--json']);
    expect(presetApplyArgs('web')).toEqual(['apply', 'web', '--json']);
    expect(presetApplyArgs('web', true)).toEqual(['apply', 'web', '--dry-run', '--json']);
  });
});

describe('preset payloads', () => {
  it('decodes list/show/apply shapes', () => {
    const list = fromStackOut<PresetListJson>(
      out(
        JSON.stringify({
          command: 'preset',
          action: 'list',
          count: 1,
          presets: [
            {
              name: 'web',
              description: 'd',
              imports: [
                { id: 'a', to: 'x' },
                { id: 'b', to: null },
              ],
            },
          ],
        }),
      ),
    );
    expect(list.presets).toEqual([
      {
        name: 'web',
        description: 'd',
        imports: [
          { id: 'a', to: 'x' },
          { id: 'b', to: null },
        ],
      },
    ]);
    const show = fromStackOut<PresetShowJson>(
      out(
        JSON.stringify({
          command: 'preset',
          action: 'show',
          preset: { name: 'web', description: 'd', source: 'presets/web.json', imports: [] },
        }),
      ),
    );
    expect(show.preset.source).toBe('presets/web.json');
    const apply = fromStackOut<PresetApplyJson>(
      out(
        JSON.stringify({
          command: 'preset',
          action: 'apply',
          preset: 'web',
          commit: 'c',
          imported: [{ id: 'a', path: 'x' }],
          already: [],
          gitignore: 'unchanged',
        }),
      ),
    );
    expect(apply.preset).toBe('web');
    expect(apply.conflicts).toBeUndefined();
  });
});

describe('describePresetApply', () => {
  const base: PresetApplyJson = {
    command: 'preset',
    action: 'apply',
    preset: 'web',
    commit: 'c',
    imported: [{ id: 'a', path: '.stack/a' }],
    already: ['b'],
    gitignore: 'unchanged',
  };

  it('renders like an import result', () => {
    const secs = describePresetApply(base);
    expect(secs[0].title).toBe('imported 1 entry');
    expect(secs[0].lines).toEqual(['a → .stack/a']);
    expect(secs[1]).toEqual({ title: 'already here', lines: ['b'], tone: 'dim' });
  });

  it('reports the quiet case', () => {
    const secs = describePresetApply({ ...base, imported: [], already: [] });
    expect(secs).toEqual([{ title: 'nothing to do', lines: [], tone: 'dim' }]);
  });

  it('leads with dry-run conflicts in a bad tone', () => {
    const secs = describePresetApply({ ...base, conflicts: ['x/y.md'] });
    expect(secs[0].tone).toBe('bad');
    expect(secs[0].title).toContain('conflicts');
    expect(secs[0].lines).toEqual(['x/y.md']);
    expect(secs[1].title).toBe('imported 1 entry');
  });

  it('replaces nothing-to-do when only conflicts remain', () => {
    const secs = describePresetApply({ ...base, imported: [], already: [], conflicts: ['x'] });
    expect(secs).toHaveLength(1);
    expect(secs[0].tone).toBe('bad');
  });
});

describe('refusalFiles', () => {
  it('collects the files after the refusal line', () => {
    const text = 'these files already exist with other content; move them or choose --to:\n  a.md\n  b/c.md\n';
    expect(refusalFiles(text)).toEqual(['a.md', 'b/c.md']);
  });

  it('returns [] for other errors', () => {
    expect(refusalFiles('no entry "x"')).toEqual([]);
    expect(refusalFiles('')).toEqual([]);
  });
});
