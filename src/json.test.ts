// Tests for the typed --json layer (src/json.ts): decoding, markers,
// arg building, and op summaries. No DOM, no bridge.
import { describe, expect, it } from 'vitest';
import {
  CliError,
  batchConfirmText,
  batchDest,
  batchSummary,
  cliText,
  describeImport,
  describeInit,
  describePresetApply,
  describePresetPreview,
  describeRemove,
  describeSync,
  describeUpdate,
  docNameFor,
  defaultImportDest,
  entryMarkers,
  fromStackOut,
  importArgs,
  importDestHint,
  importDryRunArgs,
  matchPresets,
  needsImportDest,
  parseJsonOut,
  planBatch,
  presetApplyArgs,
  presetCountText,
  presetCountTitle,
  presetImportsHint,
  presetListArgs,
  presetsFilterable,
  presetsStartOpen,
  presetShowArgs,
  previewFresh,
  quickImportError,
  quickImportLine,
  refusalFiles,
  searchArgs,
  showFileArgs,
  toShowDoc,
  toShowFile,
  visiblePresets,
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

describe('quick import destinations', () => {
  it('mirrors the CLI fallback: skills, payloads, then .stack/', () => {
    expect(defaultImportDest({ id: 'skills/file-pr', kind: 'skill', name: 'file-pr' })).toBe('.agents/skills/file-pr');
    expect(defaultImportDest({ id: 'styles/x', kind: 'style', name: 'x' })).toBe('.agents/skills/x');
    expect(defaultImportDest({ id: 'templates/agents-md', kind: 'template', name: 'agents-md', payload: 'files' })).toBe(
      '.',
    );
    expect(defaultImportDest({ id: 'components/react/button', kind: 'component', name: 'button' })).toBe(
      '.stack/components/react/button',
    );
    expect(defaultImportDest({ id: 'workers/mel', kind: 'worker', name: 'mel' })).toBe('.stack/workers/mel');
  });

  it('asks for a destination only for copy entries without a payload', () => {
    expect(needsImportDest({ usage: 'copy' })).toBe(true);
    expect(needsImportDest({ usage: 'link' })).toBe(false);
    expect(needsImportDest({ usage: 'reference' })).toBe(false);
    expect(needsImportDest({ usage: 'package' })).toBe(false);
    expect(needsImportDest({ usage: 'copy', payload: 'files' })).toBe(false);
  });

  it('prefills components with src/components/<name>, nothing otherwise', () => {
    expect(importDestHint({ kind: 'component', name: 'button' })).toBe('src/components/button');
    expect(importDestHint({ kind: 'asset', name: 'escacs-mark' })).toBeNull();
  });
});

describe('batch planning', () => {
  const skill = (id: string): JsonEntry => entry(id);
  const comp = (id: string): JsonEntry => ({ ...entry(id), kind: 'component', usage: 'copy' });

  it('splits candidates into ready, need-dest, already and unimportable', () => {
    const p = planBatch(
      [skill('skills/a'), comp('components/x/b'), skill('skills/c'), { ...skill('skills/d'), committed: false }],
      new Set(['skills/c']),
    );
    expect(p.ready.map((e) => e.id)).toEqual(['skills/a']);
    expect(p.needDest.map((e) => e.id)).toEqual(['components/x/b']);
    expect(p.already).toEqual(['skills/c']);
    expect(p.unimportable).toEqual(['skills/d']);
  });

  it('an already-imported row counts as already even when not committed', () => {
    const p = planBatch([{ ...skill('skills/a'), committed: false }], new Set(['skills/a']));
    expect(p.already).toEqual(['skills/a']);
    expect(p.unimportable).toEqual([]);
  });

  it('dry-run args mirror import args with --dry-run before --json', () => {
    expect(importDryRunArgs('skills/a', '')).toEqual(['skills/a', '--dry-run', '--json']);
    expect(importDryRunArgs('skills/a', 'vendor')).toEqual(['skills/a', '--to', 'vendor', '--dry-run', '--json']);
  });

  it('a shared base becomes <base>/<name>; an empty base skips', () => {
    expect(batchDest('src/components', 'button')).toBe('src/components/button');
    expect(batchDest('src/components/', 'button')).toBe('src/components/button');
    expect(batchDest('  ', 'button')).toBe('');
  });

  it('the confirm line names the count, needs-dest, collisions and skips', () => {
    expect(batchConfirmText({ count: 5, needDest: 0, conflicts: 0, skipped: 0 })).toBe('import 5');
    expect(batchConfirmText({ count: 5, needDest: 2, conflicts: 1, skipped: 1 })).toBe(
      'import 5 · 2 need a destination · 1 would collide · 1 skipped',
    );
  });

  it('the summary always names the imported count, then the nonzero buckets', () => {
    expect(batchSummary({ imported: 5, already: 1, refused: 1, skipped: 0, stopped: false })).toBe(
      'imported 5 · 1 already here · 1 refused',
    );
    expect(batchSummary({ imported: 0, already: 0, refused: 2, skipped: 1, stopped: true })).toBe(
      'imported 0 · 2 refused · 1 skipped · stopped',
    );
    expect(batchSummary({ imported: 3, already: 0, refused: 0, skipped: 0, stopped: false })).toBe('imported 3');
  });
});

describe('quickImportLine / quickImportError', () => {
  const res = (imported: ImportJson['imported'], already: string[] = []): ImportJson => ({
    command: 'import',
    commit: 'c',
    imported,
    already,
    gitignore: 'unchanged',
  });

  it('reads imported → path, with +N dep for required entries', () => {
    expect(quickImportLine(res([{ id: 'skills/a', path: '.agents/skills/a' }]), 'skills/a')).toBe(
      'imported → .agents/skills/a',
    );
    expect(
      quickImportLine(
        res([
          { id: 'components/react/button', path: 'src/components/ui' },
          { id: 'components/react/icon-button', path: '.stack/components/react/icon-button', requiredBy: 'components/react/button' },
        ]),
        'components/react/button',
      ),
    ).toBe('imported → src/components/ui +1 dep');
  });

  it('names already-here rows instead of a path', () => {
    expect(quickImportLine(res([], ['skills/a']), 'skills/a')).toBe('already here');
  });

  it('keeps the first stderr line, capped, for failures', () => {
    expect(quickImportError('these files already exist with other content; move them or choose --to:\n  a\n  b')).toBe(
      'these files already exist with other content; move them or choose --to:',
    );
    expect(quickImportError('')).toBe('import failed');
    expect(quickImportError(`${'x'.repeat(200)}\nsecond`)).toBe(`${'x'.repeat(99)}…`);
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

describe('preset hint', () => {
  it('lists each import id, with its destination when it has one', () => {
    expect(
      presetImportsHint([
        { id: 'components/react/button', to: 'src/components/ui' },
        { id: 'skills/file-pr', to: null },
      ]),
    ).toBe('components/react/button → src/components/ui, skills/file-pr');
  });

  it('says so when a preset imports nothing', () => {
    expect(presetImportsHint([])).toBe('no imports');
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

describe('describePresetPreview', () => {
  // Shape verified against the real CLI: `preset apply react-app --dry-run
  // --json` returns PresetApplyJson plus dryRun:true, with `imported` naming
  // what would land where and `already` naming what is already imported.
  const dryRun: PresetApplyJson = {
    command: 'preset',
    action: 'apply',
    preset: 'react-app',
    dryRun: true,
    commit: 'c',
    imported: [
      { id: 'templates/react-vite-tooling', path: '.' },
      { id: 'components/base/button', path: 'src/components/button', requiredBy: 'x' },
    ],
    already: ['libraries/tailwindcss'],
    conflicts: [],
    gitignore: 'unchanged',
  };

  it('gives one line per entry: what lands where, deps tagged, what is here', () => {
    expect(describePresetPreview(dryRun)).toEqual([
      { kind: 'new', id: 'templates/react-vite-tooling', path: '.' },
      {
        kind: 'dep',
        id: 'components/base/button',
        path: 'src/components/button',
        tag: 'dep',
        title: 'required by x',
      },
      { kind: 'here', id: 'libraries/tailwindcss', tag: '✓ here', title: 'already imported' },
    ]);
  });

  it('keeps the full reason out of the line: only the tooltip names the requirer', () => {
    const dep = describePresetPreview(dryRun).find((l) => l.kind === 'dep');
    expect(dep?.tag).toBe('dep');
    expect(dep?.id).not.toContain('required by');
    expect(dep?.title).toBe('required by x');
  });

  it('leads with collisions and never claims a write', () => {
    const lines = describePresetPreview({ ...dryRun, conflicts: ['src/x.md', 'src/y.md'] });
    expect(lines.slice(0, 2).map((l) => [l.kind, l.id, l.tag])).toEqual([
      ['conflict', 'src/x.md', 'exists'],
      ['conflict', 'src/y.md', 'exists'],
    ]);
    expect(lines[0].title).toContain('would collide');
    for (const l of lines) {
      expect(l.id).not.toMatch(/^imported /);
      expect(`${l.tag ?? ''}${l.title ?? ''}`).not.toMatch(/\bwrote\b/);
    }
  });

  it('marks every dependency, however many a preview pulled in', () => {
    const lines = describePresetPreview({
      ...dryRun,
      imported: [
        { id: 'a', path: 'a' },
        { id: 'b', path: 'b', requiredBy: 'a' },
        { id: 'c', path: 'c', requiredBy: 'a' },
      ],
    });
    expect(lines.filter((l) => l.kind === 'dep').map((l) => l.id)).toEqual(['b', 'c']);
    expect(lines.filter((l) => l.kind === 'new').map((l) => l.id)).toEqual(['a']);
  });

  it('reports the quiet case and the gitignore touch', () => {
    expect(describePresetPreview({ ...dryRun, imported: [], already: [] })).toEqual([
      { kind: 'note', id: 'nothing new: everything already here' },
    ]);
    expect(describePresetPreview({ ...dryRun, gitignore: 'updated' }).at(-1)).toEqual({
      kind: 'note',
      id: '.gitignore',
      path: 'managed escacs block updates',
    });
  });
});

describe('previewFresh', () => {
  it('keeps a preview when no op started since its request', () => {
    expect(previewFresh(3, 3)).toBe(true);
  });

  it('drops a preview that resolves after any op started', () => {
    // The op may still be running or long finished: either way the lock
    // state the dry run named is gone.
    expect(previewFresh(3, 4)).toBe(false);
    expect(previewFresh(3, 5)).toBe(false);
  });
});

describe('presetCountText', () => {
  const imports = [
    { id: 'components/react/button', to: 'src/components/ui' },
    { id: 'skills/file-pr', to: null },
  ];
  const here = new Set(['skills/file-pr']);

  it('counts what is new against the lock', () => {
    expect(presetCountText(imports, here, 0)).toBe('1 new');
    expect(presetCountText(imports, new Set(), 0)).toBe('2 new');
  });

  it('reads all here when nothing is new', () => {
    expect(
      presetCountText(imports, new Set(['components/react/button', 'skills/file-pr']), 0),
    ).toBe('all here');
  });

  it('appends the preview-named dependencies so the row matches the preview', () => {
    expect(presetCountText(imports, here, 1)).toBe('1 new · 1 dep');
    expect(presetCountText(imports, here, 2)).toBe('1 new · 2 dep');
  });
});

describe('presetCountTitle', () => {
  const imports = [
    { id: 'components/react/button', to: 'src/components/ui' },
    { id: 'skills/file-pr', to: null },
  ];
  const here = new Set(['skills/file-pr']);

  it('spells the counts out for the tooltip', () => {
    expect(presetCountTitle(imports, here, 0)).toBe('2 imports, 1 new');
    expect(presetCountTitle(imports.slice(0, 1), new Set(), 0)).toBe('1 import, 1 new');
    expect(presetCountTitle(imports, new Set(['components/react/button', 'skills/file-pr']), 0)).toBe('2 imports, all here');
  });

  it('names dependencies once a preview has', () => {
    expect(presetCountTitle(imports, here, 1)).toContain('1 dependency');
    expect(presetCountTitle(imports, here, 2)).toContain('2 dependencies');
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

describe('presets at scale', () => {
  const mk = (name: string, description = '') => ({ name, description, imports: [] });
  const list = [
    mk('web', 'React starter'),
    mk('docs', 'Docs setup: conventions'),
    mk('api', 'Server starter'),
    mk('cli', 'Command line tool'),
    mk('desktop', 'Tauri app, React optional'),
    mk('mobile', 'Mobile shell'),
    mk('landing', 'Marketing page'),
    mk('lib', 'Library repo'),
  ];

  it('starts open for a short list or an empty project, folded otherwise', () => {
    expect(presetsStartOpen(3, 4)).toBe(true);
    expect(presetsStartOpen(5, 4)).toBe(true);
    expect(presetsStartOpen(12, 0)).toBe(true);
    expect(presetsStartOpen(12, 1)).toBe(false);
  });

  it('offers a filter only past eight presets', () => {
    expect(presetsFilterable(8)).toBe(false);
    expect(presetsFilterable(9)).toBe(true);
  });

  it('filters name and description, case-insensitive, every term must match', () => {
    expect(matchPresets(list, '').length).toBe(8);
    expect(matchPresets(list, '  ').length).toBe(8);
    expect(matchPresets(list, 'REACT').map((p) => p.name)).toEqual(['web', 'desktop']);
    expect(matchPresets(list, 'react start').map((p) => p.name)).toEqual(['web']);
    expect(matchPresets(list, 'zzz')).toEqual([]);
  });

  it('cuts to five rows with a hidden count, or shows all', () => {
    const cut = visiblePresets(list, '', false, null);
    expect(cut.rows.map((p) => p.name)).toEqual(['web', 'docs', 'api', 'cli', 'desktop']);
    expect(cut.hidden).toBe(3);
    const all = visiblePresets(list, '', true, null);
    expect(all.rows.length).toBe(8);
    expect(all.hidden).toBe(0);
  });

  it('counts the cut against the filter matches, not the whole list', () => {
    const r = visiblePresets(list, 'e', false, null, 2);
    expect(r.rows.length).toBe(2);
    expect(r.hidden).toBe(matchPresets(list, 'e').length - 2);
  });

  it('keeps the previewed preset in place, past the cut and past the filter', () => {
    const cut = visiblePresets(list, '', false, 'landing');
    expect(cut.rows.map((p) => p.name)).toEqual(['web', 'docs', 'api', 'cli', 'desktop', 'landing']);
    expect(cut.hidden).toBe(2);
    const filtered = visiblePresets(list, 'docs', false, 'mobile');
    expect(filtered.rows.map((p) => p.name)).toEqual(['docs', 'mobile']);
    expect(filtered.hidden).toBe(0);
  });
});
