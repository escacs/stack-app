// Tests for the palette's pure logic (src/palette.ts): fuzzy matching and
// highlight ranges, ranking, grouping, cursor movement, and which commands a
// route is allowed to see.
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { PAGE_ACTIONS, actionFor, isLive, isPageAction, pageOf, useAction } from './actions';
import {
  CATALOG_GROUP,
  EMPTY_ACTIONS,
  ENTRY_CAP,
  GROUP_CAP,
  GROUP_ORDER,
  IMPORTS_GROUP,
  SHOWS_WHEN_DISABLED,
  fuzzy,
  fuzzyTerm,
  groupRanked,
  isListed,
  rankCommands,
  resultRows,
  segments,
  step,
  titleQuality,
  type Rankable,
} from './palette';
import { href } from './router';
import { LABEL } from './vocab';

const cmd = (id: string, title: string, group = 'App', extra: Partial<Rankable> = {}): Rankable => ({ id, title, group, ...extra });

describe('fuzzy', () => {
  it('matches a substring and reports its range', () => {
    expect(fuzzy('brow', 'Go to Browse')?.ranges).toEqual([[6, 10]]);
  });

  it('is case-insensitive and needs every whitespace term', () => {
    expect(fuzzy('GO browse', 'Go to Browse')?.ranges).toEqual([[0, 2], [6, 12]]);
    expect(fuzzy('go zzz', 'Go to Browse')).toBeNull();
  });

  it('falls back to an in-order subsequence', () => {
    const m = fuzzy('gtb', 'Go to Browse');
    expect(m).not.toBeNull();
    expect(m!.ranges.map(([a, b]) => 'Go to Browse'.slice(a, b)).join('')).toBe('GtB');
  });

  it('rejects letters out of order', () => {
    expect(fuzzy('bg', 'Go to Browse')).toBeNull();
  });

  it('an empty query matches everything with no highlight', () => {
    expect(fuzzy('  ', 'x')).toEqual({ score: 0, ranges: [] });
  });

  it('prefers a word start and a prefix over a mid-word hit', () => {
    const start = fuzzyTerm('sw', 'Switch worker')!.score;
    const mid = fuzzyTerm('sw', 'Twist words')!.score;
    expect(start).toBeGreaterThan(mid);
    expect(fuzzyTerm('up', 'Update all')!.score).toBeGreaterThan(fuzzyTerm('up', 'Sync up')!.score);
  });
});

describe('rankCommands', () => {
  const list: Rankable[] = [
    cmd('a', 'Go to Project', 'Navigate'),
    cmd('b', 'Go to Browse', 'Navigate'),
    cmd('c', 'Switch project…', 'Project'),
    cmd('d', 'Toggle theme', 'App', { keywords: 'dark light appearance' }),
  ];

  it('no query keeps the given order', () => {
    expect(rankCommands(list, '').map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters and ranks, best first', () => {
    const r = rankCommands(list, 'proj');
    expect(r.map((x) => x.item.id)).toEqual(['a', 'c']);
    expect(r[0].ranges.length).toBe(1);
  });

  it('finds a command by a hidden keyword without highlighting the title', () => {
    const r = rankCommands(list, 'dark');
    expect(r.map((x) => x.item.id)).toEqual(['d']);
    expect(r[0].ranges).toEqual([]);
  });

  it('hidden words match only as substrings, never as scattered letters', () => {
    const l = [cmd('u', 'Merge all upstream', 'Project', { keywords: 'upgrade upstream' }), cmd('r', 'Retarget to main', 'Worktrees')];
    expect(rankCommands(l, 'retarget').map((r) => r.item.id)).toEqual(['r']);
    expect(rankCommands(l, 'upstream').map((r) => r.item.id)).toEqual(['u']);
  });

  it('never lists a command that cannot run now', () => {
    const l = [cmd('x', LABEL.restoreFiles, 'Project', { disabled: 'Nothing imported yet' }), cmd('y', `${LABEL.restoreFiles} here`, 'Project')];
    expect(rankCommands(l, 'restore').map((r) => r.item.id)).toEqual(['y']);
    expect(rankCommands([l[0]], '')).toEqual([]);
    expect(rankCommands([l[0]], 'restore')).toEqual([]);
  });

  it('keeps the "Go to" rows while no project is open, reason and all', () => {
    const l = [
      cmd('go-project', 'Go to Project', 'Navigate', { disabled: 'Open a project first' }),
      cmd('search-catalog', 'Search the catalog', 'Navigate', { disabled: 'Open a project first' }),
      cmd('toggle-theme', 'Switch to dark theme', 'App'),
    ];
    for (const id of SHOWS_WHEN_DISABLED) expect(['go-project', 'go-browse', 'go-presets']).toContain(id);
    const rows = rankCommands(l, '');
    expect(rows.map((r) => r.item.id)).toEqual(['go-project', 'toggle-theme']);
    expect(rows[0].item.disabled).toBe('Open a project first');
    // Only the navigation family may be listed while disabled.
    expect(rankCommands(l, 'catalog')).toEqual([]);
  });

  it('lists a per-worktree command only while a query matches it', () => {
    const l = [
      cmd('import-into:/p/x', 'Import into feat/x', 'Workspace', { onlyWhenSearching: true, keywords: 'switch worktree branch import into target /p/x' }),
      cmd('switch-project', 'Switch project…', 'Workspace'),
    ];
    expect(rankCommands(l, '').map((r) => r.item.id)).toEqual(['switch-project']);
    expect(rankCommands(l, 'feat').map((r) => r.item.id)).toEqual(['import-into:/p/x']);
    // "switch" is in both: the title match ranks above the keyword-only hit.
    expect(rankCommands(l, 'switch').map((r) => r.item.id)).toEqual(['switch-project', 'import-into:/p/x']);
    expect(isListed(l[0], '')).toBe(false);
    expect(isListed(l[0], 'x')).toBe(true);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(rankCommands(list, 'qqq')).toEqual([]);
  });
});

describe('page scope', () => {
  const pageCmd = (id: string, title: string, reason: string): Rankable => cmd(id, title, 'Entry', { disabled: reason });
  const list: Rankable[] = [
    cmd('go-project', 'Go to Project', 'Navigate'),
    pageCmd('browse-clear-filters', 'Clear Browse filters', 'Open Browse first'),
    pageCmd('browse-cycle-sort', 'Change Browse sort order', 'Open Browse first'),
    cmd('toggle-theme', 'Switch to dark theme', 'App'),
  ];

  it('knows which commands belong to a page', () => {
    expect(pageOf('browse-clear-filters')).toBe('Browse');
    expect(pageOf('update-all')).toBe('Project');
    expect(pageOf('toggle-theme')).toBeUndefined();
    expect([isPageAction('browse-cycle-sort'), isPageAction('toggle-theme')]).toEqual([true, false]);
  });

  it('hides a page command the current route cannot run instead of dimming it', () => {
    const noneOpen = { live: (id: string) => !isPageAction(id) };
    const hidden = rankCommands(list, '', noneOpen).map((r) => r.item.id);
    expect(hidden).toEqual(['go-project', 'toggle-theme']);
    expect(rankCommands(list, '').map((r) => r.item.id)).not.toContain('browse-clear-filters');
  });

  it('shows a page command once its page is open, with no reason beside it', () => {
    const ready = [cmd('browse-clear-filters', 'Clear Browse filters', 'Entry'), cmd('go-project', 'Go to Project', 'Navigate')];
    const shown = rankCommands(ready, '', { live: () => true });
    expect(shown.map((r) => r.item.id)).toEqual(['browse-clear-filters', 'go-project']);
    // A view that reports why it cannot run right now is hidden, not dimmed.
    expect(rankCommands(list, '', { live: () => true }).map((r) => r.item.id)).toEqual(['go-project', 'toggle-theme']);
  });

  it('never lists a hidden command for a query that names it', () => {
    expect(rankCommands(list, 'clear browse', { live: (id: string) => !isPageAction(id) })).toEqual([]);
    const ready = [cmd('browse-clear-filters', 'Clear Browse filters', 'Entry')];
    expect(rankCommands(ready, 'clear browse', { live: () => true }).map((r) => r.item.id)).toEqual(['browse-clear-filters']);
  });

  it('hides a global command that cannot run right now instead of dimming it', () => {
    const l = [cmd('x', 'Focus notifications', 'App', { disabled: 'No notifications' }), cmd('y', 'Focus notifications now', 'App')];
    expect(rankCommands(l, 'focus').map((r) => r.item.id)).toEqual(['y']);
    expect(isLive('x')).toBe(true);
  });

  it('hides a command with nothing to act on instead of dimming it', () => {
    const empty = cmd('focus-toasts', 'Focus notifications', 'App', { disabled: 'No notifications' });
    const full = cmd('focus-toasts', 'Focus notifications', 'App');
    expect(EMPTY_ACTIONS.has('focus-toasts')).toBe(true);
    expect(rankCommands([empty], '')).toEqual([]);
    expect(rankCommands([empty], 'notifications')).toEqual([]);
    expect(rankCommands([full], '').map((r) => r.item.id)).toEqual(['focus-toasts']);
  });

  it('judges a guarded action against the page, never against the open palette', () => {
    // The palette itself is a modal; asking "is a dialog open?" would report
    // every guarded command as unavailable for as long as it is listed.
    const dispose = createRoot((d) => {
      useAction('update-all', { run: () => {}, guard: true });
      useAction('sync-missing', { run: () => {}, guard: true, reason: () => 'Nothing is missing' });
      return d;
    });
    try {
      const l = [
        cmd('update-all', 'Update all', 'Project', { disabled: actionFor('update-all')!.reason?.() ?? null }),
        cmd('sync-missing', LABEL.restoreFiles, 'Project', { disabled: actionFor('sync-missing')!.reason?.() ?? null }),
      ];
      expect(l.map((c) => c.disabled)).toEqual([null, 'Nothing is missing']);
      expect(rankCommands(l, '').map((r) => r.item.id)).toEqual(['update-all']);
    } finally {
      dispose();
    }
  });

  it('follows the registry by default: a mounted view makes its own command available', () => {
    expect(rankCommands(list, '').map((r) => r.item.id)).toEqual(['go-project', 'toggle-theme']);
    // A view registers while it is mounted (actions.ts) and disposes on cleanup.
    const dispose = createRoot((d) => {
      useAction('browse-clear-filters', { run: () => {} });
      return d;
    });
    // The command as the view builds it: no reason of its own, so it lists.
    const ready = [cmd('go-project', 'Go to Project', 'Navigate'), cmd('browse-clear-filters', 'Clear Browse filters', 'Entry')];
    try {
      expect(rankCommands(ready, '').map((r) => r.item.id)).toEqual(['go-project', 'browse-clear-filters']);
      expect(isLive('browse-clear-filters')).toBe(true);
    } finally {
      dispose();
    }
    expect(rankCommands(ready, '').map((r) => r.item.id)).toEqual(['go-project']);
  });

  it('the shipped page actions are exactly the view-registered ones', () => {
    // A global command gains a page entry only when a view owns it.
    expect(Object.keys(PAGE_ACTIONS).sort()).toEqual([
      'browse-clear-filters',
      'browse-cycle-sort',
      'check-updates',
      'dry-run',
      'import-selected',
      'review-changes',
      'send-thread',
      'sync-missing',
      'update-all',
    ]);
  });
});

describe('groupRanked', () => {
  it('buckets by group, keeping each group\'s rank order', () => {
    const r = rankCommands([cmd('a', 'x1', 'App'), cmd('b', 'x2', 'Navigate'), cmd('c', 'x3', 'App')], '');
    const g = groupRanked(r);
    expect(g.map((x) => x.group)).toEqual(['Navigate', 'App']);
    expect(g[1].entries.map((e) => e.item.id)).toEqual(['a', 'c']);
  });

  it('draws the groups in one fixed order, whatever ranked best', () => {
    const l = [
      cmd('theme', 'Switch to dark theme', 'App'),
      cmd('worker', 'Switch worker…', 'Workspace'),
      cmd('update', 'Update all', 'Project'),
      cmd('import', LABEL.importEntry, 'Entry'),
      cmd('browse', 'Go to Browse', 'Navigate'),
    ];
    expect(groupRanked(rankCommands(l, '')).map((g) => g.group)).toEqual(['Navigate', 'Entry', 'Project', 'Workspace', 'App']);
    // A query that ranks App first still draws Navigate on top.
    expect(groupRanked(rankCommands(l, 'switch')).map((g) => g.group)).toEqual(['Workspace', 'App']);
    // What the query found is drawn above the commands, so Enter lands on it.
    expect(GROUP_ORDER).toEqual(['Catalog', 'Imports', 'Navigate', 'Entry', 'Project', 'Workspace', 'App']);
  });

  it('puts an unknown group after the known ones', () => {
    const g = groupRanked(rankCommands([cmd('a', 'x1', 'Zed'), cmd('b', 'x2', 'App')], ''));
    expect(g.map((x) => x.group)).toEqual(['App', 'Zed']);
  });

  it('a single result is one group (the label hides while filtering)', () => {
    expect(groupRanked(rankCommands([cmd('a', 'Restore missing', 'Project'), cmd('b', 'Dark', 'App')], 'restore'))).toHaveLength(1);
  });
});

describe('segments', () => {
  it('splits text around ranges', () => {
    expect(segments('Go to Browse', [[6, 10]])).toEqual([
      { text: 'Go to ', mark: false },
      { text: 'Brow', mark: true },
      { text: 'se', mark: false },
    ]);
    expect(segments('abc', [])).toEqual([{ text: 'abc', mark: false }]);
  });
});

describe('step', () => {
  it('wraps both ways and handles empties', () => {
    expect(step(0, -1, 3)).toBe(2);
    expect(step(2, 1, 3)).toBe(0);
    expect(step(-1, 1, 3)).toBe(0);
    expect(step(-1, -1, 3)).toBe(2);
    expect(step(0, 1, 0)).toBe(-1);
  });
});

// The palette only ever listed commands, so typing an entry's name and pressing
// Enter ran whatever command sat under the cursor — the import plan of an
// unrelated row. Results fix that: catalog entries (and, on the Project route,
// the tracked imports) are rows that *open* the entry.
describe('results', () => {
  const entries = [
    { id: 'skills/pony', name: 'pony', kind: 'skill', summary: 'Make a pony dance.', tags: ['fun'] },
    { id: 'skills/pony-tricks', name: 'pony-tricks', kind: 'skill', summary: 'More pony, fewer rules.' },
    { id: 'styles/abacus', name: 'abacus', kind: 'style', summary: 'Counting-house calm.' },
  ];
  const routes = {
    catalog: (id: string) => href('populated', 'browse', ...id.split('/')),
    project: (id: string) => href('populated', 'project', ...id.split('/')),
  };
  // The command as commands.ts builds it (same title, same keywords).
  const importCmd = cmd('import-selected', LABEL.importEntry, 'Entry', { keywords: 'add entry into project' });
  const browseCmd = cmd('go-browse', 'Go to Browse', 'Navigate');
  // `import-selected` is a page action: with no view mounted it is filtered
  // out before matching, so these tests say every row is live; otherwise "the
  // command does not match" would pass for the wrong reason.
  const allLive = { live: () => true };

  it('finds an entry by name, and never the import command', () => {
    const rows = rankCommands([importCmd, browseCmd, ...resultRows({ entries }, routes)], 'pony', allLive);
    expect(rows[0].item.id).toBe('entry:skills/pony');
    expect(rows.map((r) => r.item.id)).not.toContain('import-selected');
    // Both entries are found; the exact name beats the prefix.
    expect(rows.map((r) => r.item.id)).toEqual(['entry:skills/pony', 'entry:skills/pony-tricks']);
  });

  it('lists no entry until a query is typed', () => {
    const all = resultRows({ entries, imports: [{ id: 'skills/pony', name: 'pony', kind: 'skill' }] }, routes);
    expect(all.length).toBe(4);
    expect(rankCommands(all, '').map((r) => r.item.id)).toEqual([]);
    expect(rankCommands(all, '   ').map((r) => r.item.id)).toEqual([]);
    expect(isListed(all[0], '')).toBe(false);
    expect(isListed(all[0], 'p')).toBe(true);
  });

  it('makes Enter a navigation, never an import', () => {
    const [row] = resultRows({ entries }, routes);
    // The row carries the hash Enter goes to and no action of its own.
    expect(row.route).toBe('#populated,/browse/skills/pony');
    expect(row.id).toBe('entry:skills/pony');
    // Not a page action: nothing can make it run the import.
    expect(pageOf(row.id)).toBeUndefined();
    expect(rankCommands([row], 'pony', { live: () => true }).map((r) => r.item.id)).toEqual(['entry:skills/pony']);
    expect(row.disabled).toBeNull();
    expect(row.hint).toBe('skill');
  });

  it('finds an entry by its kind, summary or a tag, below a name match', () => {
    const rows = rankCommands(resultRows({ entries }, routes), 'pony');
    expect(rows[0].item.id).toBe('entry:skills/pony');
    // A hidden word still finds the row, with no highlight.
    const byTag = rankCommands(resultRows({ entries }, routes), 'fun');
    expect(byTag.map((r) => r.item.id)).toEqual(['entry:skills/pony']);
    expect(byTag[0].ranges).toEqual([]);
    // The name match is highlighted.
    expect(rows[0].ranges).toEqual([[0, 4]]);
    expect(rankCommands(resultRows({ entries }, routes), 'abacus').map((r) => r.item.id)).toEqual(['entry:styles/abacus']);
  });

  it('adds the tracked imports on the project route, linking into the project', () => {
    const imports = [{ id: 'skills/pony', name: 'pony', kind: 'skill', summary: '.agents/skills/pony' }];
    const rows = resultRows({ entries, imports }, routes);
    const imported = rows.filter((r) => r.group === IMPORTS_GROUP);
    expect(imported.map((r) => r.id)).toEqual(['import:skills/pony']);
    expect(imported.map((r) => r.route)).toEqual(['#populated,/project/skills/pony']);
    expect(imported[0].hint).toBe('skill');
    // Without the project's lock rows there is nothing to list: catalog only.
    expect(resultRows({ entries }, routes).some((r) => r.group === IMPORTS_GROUP)).toBe(false);
    expect(rows.filter((r) => r.group === CATALOG_GROUP)).toHaveLength(entries.length);
  });

  it('ranks a result above a command that only matched a hidden word', () => {
    const weak = cmd('weak', 'Something else', 'App', { keywords: 'pony parade' });
    const rows = rankCommands([weak, ...resultRows({ entries }, routes)], 'pony', allLive);
    expect(rows[0].item.id).toBe('entry:skills/pony');
    expect(rows.map((r) => r.item.id)).toContain('weak');
    // ...but a command whose own title names the query still comes first.
    const strong = cmd('strong', 'pony', 'App');
    expect(rankCommands([strong, ...resultRows({ entries }, routes)], 'pony', allLive)[0].item.id).toBe('strong');
  });

  it('caps a result group at eight rows, best first', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `skills/pony-${i}`, name: `pony-${i}`, kind: 'skill' }));
    const rows = rankCommands(resultRows({ entries: many }, routes), 'pony');
    expect(ENTRY_CAP).toBe(8);
    expect(GROUP_CAP[CATALOG_GROUP]).toBe(ENTRY_CAP);
    expect(rows).toHaveLength(ENTRY_CAP);
    // The exact name is never pushed out by the prefix matches.
    const withExact = rankCommands(resultRows({ entries: [...many, { id: 'skills/pony', name: 'pony', kind: 'skill' }] }, routes), 'pony');
    expect(withExact).toHaveLength(ENTRY_CAP);
    expect(withExact[0].item.id).toBe('entry:skills/pony');
    // The cap is per group, and a group without one is untouched.
    const both = rankCommands([...resultRows({ entries: many, imports: many.slice(0, 9) }, routes)], 'pony');
    expect(both.filter((r) => r.item.group === CATALOG_GROUP)).toHaveLength(ENTRY_CAP);
    expect(both.filter((r) => r.item.group === IMPORTS_GROUP)).toHaveLength(ENTRY_CAP);
  });
});

describe('command matching', () => {
  it('matches a word of the title or a deliberate keyword, never scattered letters', () => {
    const l = [cmd('import-selected', LABEL.importEntry, 'Entry', { keywords: 'add entry into project' })];
    const live = { live: () => true };
    // 'pony' and 'ientr' used to reach "Import entry" as a subsequence.
    expect(rankCommands(l, 'pony', live)).toEqual([]);
    expect(rankCommands(l, 'ientr', live)).toEqual([]);
    // A whole word of the title, or a word someone wrote down on purpose, still finds it.
    expect(rankCommands(l, 'import', live).map((r) => r.item.id)).toEqual(['import-selected']);
    expect(rankCommands(l, 'add', live).map((r) => r.item.id)).toEqual(['import-selected']);
  });

  it('orders by how well the query names the row', () => {
    expect(titleQuality('pony', 'pony')).toBe(3);
    expect(titleQuality('brow', 'Go to Browse')).toBe(2);
    expect(titleQuality('ort', 'Import entry')).toBe(1);
    // An exact name beats a word start, whatever the raw score says.
    const l = [cmd('a', 'Update all the things', 'App'), cmd('b', 'Update', 'App')];
    expect(rankCommands(l, 'update').map((r) => r.item.id)).toEqual(['b', 'a']);
  });
});
