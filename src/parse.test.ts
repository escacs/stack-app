// Tests for the live parse.ts helpers (kinds, manifests, row state) plus
// pins on the superseded text parsers' documented formats.
import { describe, expect, it } from 'vitest';
import {
  KINDS,
  countUpdates,
  kindOf,
  manifestList,
  manifestName,
  parseList,
  parseOpLog,
  parseShow,
  parseStatus,
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

describe('superseded text parsers (documented formats)', () => {
  it('parseList reads `- id [usage(, status)]: summary`', () => {
    const rows = parseList('- skills/a [link]: Does a.\n- skills/b [link, experimental]: Does b.\nNo matching entries.');
    expect(rows).toEqual([
      { id: 'skills/a', kind: 'skill', name: 'a', usage: 'link', status: null, summary: 'Does a.' },
      { id: 'skills/b', kind: 'skill', name: 'b', usage: 'link', status: 'experimental', summary: 'Does b.' },
    ]);
  });

  it('parseStatus reads the lock table with bits', () => {
    const st = parseStatus(
      'stack at b51359b\n  skills/a @abc1234 -> .agents/skills/a  (update: 2 files; edited here: SKILL.md)\n* skills/b @abc1234 -> .agents/skills/b  (removed from stack)',
    );
    expect(st.commit).toBe('b51359b');
    expect(st.rows).toEqual([
      { id: 'skills/a', commit: 'abc1234', path: '.agents/skills/a', local: ['SKILL.md'], upstreamCount: 2, gone: false },
      { id: 'skills/b', commit: 'abc1234', path: '.agents/skills/b', local: [], upstreamCount: null, gone: true },
    ]);
    expect(parseStatus('No stack imports here (no stack.toml).')).toEqual({ commit: null, rows: [] });
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

  it('parseOpLog tags op lines and keeps bare lines', () => {
    expect(parseOpLog('import  a -> .stack/a\nCONFLICT .stack/a/f (1 conflict)\nbare line')).toEqual([
      { tag: 'import', text: 'a -> .stack/a' },
      { tag: 'CONFLICT', text: '.stack/a/f (1 conflict)' },
      { tag: '', text: 'bare line' },
    ]);
  });
});
