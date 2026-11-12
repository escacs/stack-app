// Tests for the pure adopt helpers (src/adopt.ts): default destinations,
// folder-to-entry matching, dry-run conflict attribution and arg shapes.
import { describe, expect, it } from 'vitest';
import {
  adoptArgs,
  adoptCountText,
  adoptDryRunArgs,
  conflictsFor,
  defaultDestFor,
  mapPooled,
  matchAdoptCandidates,
} from './adopt';
import type { JsonEntry } from './json';

const entry = (id: string, over: Partial<JsonEntry> = {}): JsonEntry =>
  ({
    id,
    kind: id.split('/')[0].replace(/s$/, ''),
    name: id.split('/').pop() ?? id,
    committed: true,
    ...over,
  }) as JsonEntry;

const CATALOG = [
  entry('skills/file-pr'),
  entry('skills/ponytail'),
  entry('styles/folio-light'),
  entry('systems/engineering-conventions'),
  entry('components/react/button', { library: { name: 'react', extends: null, default: true } }),
  entry('components/react/icon-button', { library: { name: 'react', extends: null, default: true } }),
  entry('components/legacy/button', { library: { name: 'legacy', extends: null, default: false } }),
  entry('templates/agents-md', { payload: 'files' }),
  entry('workers/mel'),
  entry('skills/draft-entry', { committed: false }),
];

describe('defaultDestFor', () => {
  it('puts skills and styles in the shared skills folder', () => {
    expect(defaultDestFor(entry('skills/file-pr'))).toBe('.agents/skills/file-pr');
    expect(defaultDestFor(entry('styles/folio-light'))).toBe('.agents/skills/folio-light');
  });
  it('puts payload entries at the project root', () => {
    expect(defaultDestFor(entry('templates/agents-md', { payload: 'files' }))).toBe('.');
  });
  it('puts everything else under .stack/<id>', () => {
    expect(defaultDestFor(entry('systems/engineering-conventions'))).toBe(
      '.stack/systems/engineering-conventions',
    );
    expect(defaultDestFor(entry('components/react/button'))).toBe('.stack/components/react/button');
    expect(defaultDestFor(entry('workers/mel'))).toBe('.stack/workers/mel');
  });
});

describe('matchAdoptCandidates', () => {
  it('matches skills folders on the default path with no --to', () => {
    expect(matchAdoptCandidates(['.agents/skills/file-pr'], CATALOG, new Set())).toEqual([
      { folder: '.agents/skills/file-pr', id: 'skills/file-pr', to: null },
    ]);
  });
  it('matches styles in the same shared folder', () => {
    expect(matchAdoptCandidates(['.agents/skills/folio-light'], CATALOG, new Set())).toEqual([
      { folder: '.agents/skills/folio-light', id: 'styles/folio-light', to: null },
    ]);
  });
  it('matches a .claude link folder with --to, preferring the .agents twin', () => {
    expect(matchAdoptCandidates(['.claude/skills/ponytail'], CATALOG, new Set())).toEqual([
      { folder: '.claude/skills/ponytail', id: 'skills/ponytail', to: '.claude/skills/ponytail' },
    ]);
    // Both the folder and its link: one candidate, the default destination.
    expect(
      matchAdoptCandidates(
        ['.claude/skills/ponytail', '.agents/skills/ponytail'],
        CATALOG,
        new Set(),
      ),
    ).toEqual([{ folder: '.agents/skills/ponytail', id: 'skills/ponytail', to: null }]);
  });
  it('matches .stack/<id> exactly, including nested components', () => {
    expect(
      matchAdoptCandidates(
        ['.stack/systems/engineering-conventions', '.stack/components/react/button'],
        CATALOG,
        new Set(),
      ),
    ).toEqual([
      { folder: '.stack/components/react/button', id: 'components/react/button', to: null },
      {
        folder: '.stack/systems/engineering-conventions',
        id: 'systems/engineering-conventions',
        to: null,
      },
    ]);
  });
  it('matches hand-placed components in src/components with --to', () => {
    expect(matchAdoptCandidates(['src/components/icon-button'], CATALOG, new Set())).toEqual([
      {
        folder: 'src/components/icon-button',
        id: 'components/react/icon-button',
        to: 'src/components/icon-button',
      },
    ]);
  });
  it('resolves same-named components to the default library only', () => {
    // button exists in react (default) and legacy: the default wins.
    expect(matchAdoptCandidates(['src/components/button'], CATALOG, new Set())).toEqual([
      { folder: 'src/components/button', id: 'components/react/button', to: 'src/components/button' },
    ]);
    const noDefault = CATALOG.map((e) =>
      e.id === 'components/react/button'
        ? entry('components/react/button', { library: { name: 'react', extends: null, default: false } })
        : e,
    );
    expect(matchAdoptCandidates(['src/components/button'], noDefault, new Set())).toEqual([]);
  });
  it('skips imported ids and entries missing from the stack HEAD', () => {
    expect(
      matchAdoptCandidates(
        ['.agents/skills/file-pr', '.agents/skills/ponytail'],
        CATALOG,
        new Set(['skills/file-pr']),
      ),
    ).toEqual([{ folder: '.agents/skills/ponytail', id: 'skills/ponytail', to: null }]);
    expect(matchAdoptCandidates(['.agents/skills/draft-entry'], CATALOG, new Set())).toEqual([]);
  });
  it('ignores folders that name no entry and unsafe paths', () => {
    expect(
      matchAdoptCandidates(
        [
          '.stack/systems',
          '.stack/components/react',
          '.agents/skills/unknown-thing',
          'src/components/unknown-thing',
          'src/components/nested/too-deep',
          '.agents/skills/a/b',
          'other/place',
          '',
          '.',
          '..',
          '/abs/path',
          '.agents/skills/../escape',
        ],
        CATALOG,
        new Set(),
      ),
    ).toEqual([]);
  });
  it('tolerates trailing slashes and sorts by folder', () => {
    expect(
      matchAdoptCandidates(
        ['.stack/workers/mel/', '.agents/skills/file-pr'],
        CATALOG,
        new Set(),
      ),
    ).toEqual([
      { folder: '.agents/skills/file-pr', id: 'skills/file-pr', to: null },
      { folder: '.stack/workers/mel', id: 'workers/mel', to: null },
    ]);
  });
});

describe('adoptArgs', () => {
  it('passes --to only off the default path', () => {
    expect(adoptArgs({ folder: '.agents/skills/file-pr', id: 'skills/file-pr', to: null })).toEqual([
      'skills/file-pr',
      '--json',
    ]);
    expect(
      adoptArgs({ folder: 'src/components/x', id: 'components/react/x', to: 'src/components/x' }),
    ).toEqual(['components/react/x', '--to', 'src/components/x', '--json']);
  });
});

describe('adoptDryRunArgs', () => {
  it('dry-runs the same import the button would run', () => {
    expect(
      adoptDryRunArgs({ folder: '.agents/skills/file-pr', id: 'skills/file-pr', to: null }),
    ).toEqual(['skills/file-pr', '--dry-run', '--json']);
    expect(
      adoptDryRunArgs({ folder: 'src/components/x', id: 'components/react/x', to: 'src/components/x' }),
    ).toEqual(['components/react/x', '--to', 'src/components/x', '--dry-run', '--json']);
  });
});

describe('conflictsFor', () => {
  it('keeps only the collisions under the candidate destination', () => {
    expect(
      conflictsFor(
        ['.agents/skills/file-pr/SKILL.md', '.stack/other/entry/x.md'],
        '.agents/skills/file-pr',
      ),
    ).toEqual(['.agents/skills/file-pr/SKILL.md']);
  });
  it('keeps everything for a root destination', () => {
    expect(conflictsFor(['AGENTS.md', 'x.md'], '.')).toEqual(['AGENTS.md', 'x.md']);
  });
});

describe('adoptCountText', () => {
  it('counts entries', () => {
    expect(adoptCountText(1)).toBe('1 look-alike entry');
    expect(adoptCountText(3)).toBe('3 look-alike entries');
  });
});

describe('mapPooled', () => {
  it('keeps result order when later items settle first', async () => {
    const out = await mapPooled([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });
  it('caps the promises in flight at the limit', async () => {
    let live = 0;
    let peak = 0;
    await mapPooled(Array.from({ length: 10 }, (_, i) => i), 4, async (i) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return i;
    });
    expect(peak).toBe(4);
  });
  it('runs serially at limit 1 and handles the edges', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapPooled([1, 2, 3], 1, async (i) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return i * 2;
    });
    expect(out).toEqual([2, 4, 6]);
    expect(peak).toBe(1);
    expect(await mapPooled([], 4, async (i: number) => i)).toEqual([]);
    expect(await mapPooled([7], 99, async (i) => i)).toEqual([7]);
  });
});
