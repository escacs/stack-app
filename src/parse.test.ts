// Tests for the live parse.ts helpers (kinds, manifests, row state).
import { describe, expect, it } from 'vitest';
import {
  KINDS,
  countUpdates,
  editedOf,
  hasMissing,
  rowFacts,
  rowWord,
  kindOf,
  manifestList,
  manifestName,
  parseList,
  parseShow,
  pluralOf,
  rowState,
  type StatusRow,
} from './parse';

describe('kinds', () => {
  it('maps both directions and lists all eight', () => {
    expect(KINDS).toEqual(['skill', 'style', 'system', 'component', 'library', 'asset', 'template', 'worker']);
    expect(kindOf('skills/file-pr')).toBe('skill');
    expect(kindOf('components/react/button')).toBe('component');
    expect(pluralOf('skill')).toBe('skills');
    expect(pluralOf('component')).toBe('components');
  });
});

describe('manifests', () => {
  it('reads names and string lists defensively', () => {
    expect(manifestName({ name: 'x' })).toBe('x');
    expect(manifestName({})).toBe('');
    expect(manifestList({ requires: ['a', 1, 'b'] }, 'requires')).toEqual(['a', 'b']);
    expect(manifestList({}, 'requires')).toEqual([]);
  });
});

describe('rowState', () => {
  const row = (o: object): StatusRow => ({ id: 'a', commit: 'c', path: 'p', local: [], upstreamCount: null, gone: false, ...o });
  it('orders gone > update > edited > imported', () => {
    expect(rowState(row({}))).toBe('imported');
    expect(rowState(row({ local: ['f'] }))).toBe('edited');
    expect(rowState(row({ upstreamCount: 2 }))).toBe('update');
    expect(rowState(row({ local: ['f'], upstreamCount: 1 }))).toBe('update');
    expect(rowState(row({ gone: true, local: ['f'], upstreamCount: 3 }))).toBe('gone');
  });
  it('countUpdates counts update rows only', () => {
    expect(countUpdates([])).toBe(0);
    expect(
      countUpdates([
        row({}),
        row({ local: ['f'] }),
        row({ upstreamCount: 2 }),
        row({ local: ['f'], upstreamCount: 1 }),
        row({ gone: true, upstreamCount: 3 }),
      ]),
    ).toBe(2);
  });
});

describe('missing files', () => {
  const row = (o: object): StatusRow => ({ id: 'a', commit: 'c', path: 'p', local: [], upstreamCount: null, gone: false, ...o });
  it('a deleted file is missing, not edited', () => {
    const r = row({ local: ['SKILL.md'], missing: ['SKILL.md'] });
    expect(rowState(r)).toBe('missing');
    expect(editedOf(r)).toEqual([]);
    expect(rowFacts(r)).toEqual(['missing']);
  });
  it('a row can be missing, updated and edited at once; the chip shows missing', () => {
    const r = row({ local: ['a', 'b'], missing: ['a'], upstreamCount: 2 });
    expect(rowState(r)).toBe('missing');
    expect(rowFacts(r)).toEqual(['missing', 'update', 'edited']);
    expect(editedOf(r)).toEqual(['b']);
  });
  it('a gone row is not also missing', () => {
    expect(rowFacts(row({ gone: true, missing: ['a'], local: ['a'] }))).toEqual(['gone']);
  });
  it('hasMissing is true only when some row has missing files', () => {
    expect(hasMissing([])).toBe(false);
    expect(hasMissing([row({ local: ['f'] }), row({ upstreamCount: 1 })])).toBe(false);
    expect(hasMissing([row({ local: ['f'], missing: [] }), row({ local: ['g'], missing: ['g'] })])).toBe(true);
  });
  it('countUpdates still counts an updated row that is also missing files', () => {
    expect(countUpdates([row({ upstreamCount: 1, missing: ['x'], local: ['x'] })])).toBe(1);
  });
  it('words come from the shared vocabulary', () => {
    expect(rowWord('imported')).toBe('Up to date');
    expect(rowWord('missing')).toBe('Missing files');
    expect(rowWord('update')).toBe('Update available');
  });
});

describe('superseded text parsers (documented formats)', () => {
  it('parseList reads `- id [usage(, status)]: summary`', () => {
    const rows = parseList('- skills/a [link]: Does a.\n- skills/b [link, experimental]: Does b.\nNo matching entries.');
    expect(rows).toEqual([
      { id: 'skills/a', kind: 'skill', name: 'a', usage: 'link', status: null, summary: 'Does a.' },
      { id: 'skills/b', kind: 'skill', name: 'b', usage: 'link', status: 'experimental', summary: 'Does b.' },
    ]);
  });

  it('parseShow keeps the doc tail past nested ## headings', () => {
    const doc = parseShow('# skills/a\n\nUsage: link\n\n## Manifest\n```json\n{"name":"a"}\n```\n\n## Files\n- SKILL.md\n\n## SKILL.md\n\n# A\n\n## Notes\n\ntail\n');
    expect(doc.id).toBe('skills/a');
    expect(doc.usage).toBe('link');
    expect(doc.manifest).toEqual({ name: 'a' });
    expect(doc.files).toEqual(['SKILL.md']);
    expect(doc.docPath).toBe('SKILL.md');
    expect(doc.docBody).toContain('## Notes');
    expect(doc.docBody).toContain('tail');
  });
});
