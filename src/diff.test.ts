import { describe, expect, it } from 'vitest';
import {
  bothSides,
  collapseDiff,
  diffLines,
  diffStats,
  installedPathOf,
  modeCaption,
  reviewFiles,
  reviewHeadline,
  reviewMode,
  sideRows,
  sideStats,
  splitLines,
  upstreamPathOf,
} from './diff';

describe('splitLines', () => {
  it('counts lines like an editor', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('diffLines', () => {
  const render = (a: string, b: string) => diffLines(a, b).map((o) => `${o.kind === 'eq' ? ' ' : o.kind === 'add' ? '+' : '-'}${o.text}`);
  it('is empty for equal text and all-eq with numbers', () => {
    expect(diffLines('', '')).toEqual([]);
    const ops = diffLines('a\nb\n', 'a\nb\n');
    expect(ops.map((o) => [o.kind, o.oldNo, o.newNo])).toEqual([['eq', 1, 1], ['eq', 2, 2]]);
  });
  it('finds a changed middle line', () => {
    expect(render('a\nb\nc\n', 'a\nB\nc\n')).toEqual([' a', '-b', '+B', ' c']);
  });
  it('handles insert, delete and whole-file add', () => {
    expect(render('a\nc\n', 'a\nb\nc\n')).toEqual([' a', '+b', ' c']);
    expect(render('a\nb\nc\n', 'a\nc\n')).toEqual([' a', '-b', ' c']);
    expect(render('', 'x\ny\n')).toEqual(['+x', '+y']);
    expect(render('x\ny\n', '')).toEqual(['-x', '-y']);
  });
  it('numbers each side independently', () => {
    const ops = diffLines('a\nb\n', 'a\nx\ny\n');
    expect(ops.map((o) => [o.kind, o.oldNo, o.newNo])).toEqual([
      ['eq', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
    ]);
  });
  it('reconstructs both sides from the script', () => {
    const a = 'one\ntwo\nthree\nfour\nfive\nsix\n';
    const b = 'one\n2\nthree\nfive\nsix\nseven\n';
    const ops = diffLines(a, b);
    expect(ops.filter((o) => o.kind !== 'add').map((o) => o.text)).toEqual(splitLines(a));
    expect(ops.filter((o) => o.kind !== 'del').map((o) => o.text)).toEqual(splitLines(b));
  });
  it('reads repeated lines without losing any', () => {
    const a = 'x\nx\nx\ny\n';
    const b = 'x\ny\nx\nx\n';
    const ops = diffLines(a, b);
    expect(ops.filter((o) => o.kind !== 'add').map((o) => o.text)).toEqual(splitLines(a));
    expect(ops.filter((o) => o.kind !== 'del').map((o) => o.text)).toEqual(splitLines(b));
  });
  it('stays fast on a large mostly-equal file', () => {
    const base = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
    const changed = [...base];
    changed[1500] = 'edited';
    const ops = diffLines(base.join('\n'), changed.join('\n'));
    expect(diffStats(ops)).toEqual({ added: 1, removed: 1 });
  });
});

describe('collapseDiff', () => {
  const lines = (n: number, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n') + '\n';
  it('folds a long unchanged run and keeps context beside changes', () => {
    const a = `${lines(30)}old\n${lines(30, 'm')}`;
    const b = `${lines(30)}new\n${lines(30, 'm')}`;
    const blocks = collapseDiff(diffLines(a, b), 3);
    expect(blocks.map((x) => x.type)).toEqual(['fold', 'lines', 'fold']);
    const mid = blocks[1];
    expect(mid.type === 'lines' && mid.lines.map((l) => l.text)).toEqual(['l27', 'l28', 'l29', 'old', 'new', 'm0', 'm1', 'm2']);
    const first = blocks[0];
    expect(first.type === 'fold' && first.lines.length).toBe(27);
  });
  it('does not fold short runs', () => {
    const blocks = collapseDiff(diffLines('a\nb\nc\nd\ne\n', 'a\nb\nX\nd\ne\n'), 3);
    expect(blocks.map((x) => x.type)).toEqual(['lines']);
  });
  it('shows an unchanged file as one fold', () => {
    const blocks = collapseDiff(diffLines(lines(20), lines(20)));
    expect(blocks.map((x) => x.type)).toEqual(['fold']);
  });
  it('is empty for no ops', () => {
    expect(collapseDiff([])).toEqual([]);
  });
});

describe('sideRows (both sides changed: two columns, no removal framing)', () => {
  const yours = 'intro\nold line\nshared tail\n';
  const upstream = 'intro\nnew line\nshared tail\n';
  it('gives every line to the side it came from, never as a removal', () => {
    const rows = sideRows(diffLines(yours, upstream));
    expect(rows.map((r) => r.kind)).toEqual(['same', 'yours', 'upstream', 'same']);
    expect(rows[1]).toMatchObject({ yours: 'old line', upstream: '', yoursNo: 2, upstreamNo: null });
    expect(rows[2]).toMatchObject({ yours: '', upstream: 'new line', yoursNo: null, upstreamNo: 2 });
  });
  it('reconstructs each column completely', () => {
    const a = 'one\ntwo\nthree\nfour\n';
    const b = 'one\n2\ntheee\nfour\nfive\n';
    const rows = sideRows(diffLines(a, b));
    expect(rows.map((r) => r.yours).filter(Boolean)).toEqual(splitLines(a));
    expect(rows.map((r) => r.upstream).filter(Boolean)).toEqual(splitLines(b));
  });
  it('numbers each column by its own side', () => {
    const rows = sideRows(diffLines('a\nb\nc\n', 'a\nc\nd\ne\n'));
    expect(rows.map((r) => [r.kind, r.yoursNo, r.upstreamNo])).toEqual([
      ['same', 1, 1],
      ['yours', 2, null],
      ['same', 3, 2],
      ['upstream', null, 3],
      ['upstream', null, 4],
    ]);
  });
  it('count one-sided lines per side for the quiet row stats', () => {
    expect(sideStats(sideRows(diffLines(yours, upstream)))).toEqual({ yours: 1, upstream: 1 });
    expect(sideStats(sideRows(diffLines('', 'x\ny\n')))).toEqual({ yours: 0, upstream: 2 });
    expect(sideStats(sideRows(diffLines('x\n', 'x\n')))).toEqual({ yours: 0, upstream: 0 });
  });
  it('keeps the collapsed unchanged runs (fold lines map 1:1 onto rows)', () => {
    const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`).join('\n') + '\n';
    const a = `${lines(30)}old\n`;
    const b = `${lines(30)}new\n`;
    const blocks = collapseDiff(diffLines(a, b), 3);
    // The change sits at the end, so there is no trailing fold.
    expect(blocks.map((x) => x.type)).toEqual(['fold', 'lines']);
    const rows = sideRows((blocks[1] as { lines: ReturnType<typeof diffLines> }).lines);
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same', 'same', 'yours', 'upstream']);
  });
});

describe('review labels', () => {
  it('names the side that changed each file', () => {
    expect(reviewMode('a', ['a'], [])).toBe('upstream');
    expect(reviewMode('a', [], ['a'])).toBe('local');
    expect(reviewMode('a', ['a'], ['a'])).toBe('both');
    expect(reviewMode('a', ['b'], ['c'])).toBeNull();
    // A deleted file is its own case, even when it is also in `local`/`upstream`.
    expect(reviewMode('a', [], ['a'], ['a'])).toBe('missing');
    expect(reviewMode('a', ['a'], ['a'], ['a'])).toBe('missing');
    expect(reviewMode('b', [], ['a', 'b'], ['a'])).toBe('local');
  });
  it('lists each file once, upstream first', () => {
    expect(reviewFiles(['SKILL.md', 'helpers.mjs'], ['SKILL.md', 'notes.md'])).toEqual(['SKILL.md', 'helpers.mjs', 'notes.md']);
  });
  it('writes the headlines', () => {
    expect(reviewHeadline(['SKILL.md', 'helpers.mjs'], ['SKILL.md'])).toEqual({ upstream: 'Upstream changed 2 files', local: 'You edited SKILL.md', missing: null });
    expect(reviewHeadline(['x'], [])).toEqual({ upstream: 'Upstream changed x', local: null, missing: null });
    expect(reviewHeadline([], ['a', 'b', 'c']).local).toBe('You edited 3 files');
    expect(reviewHeadline([], ['SKILL.md'], ['SKILL.md'])).toEqual({ upstream: null, local: null, missing: 'Deleted here: SKILL.md' });
    expect(reviewHeadline([], ['a', 'b'], ['a']).local).toBe('You edited b');
  });
  it('flags both sides', () => {
    expect(bothSides(['a'], ['b'])).toBe(true);
    expect(bothSides(['a'], [])).toBe(false);
    expect(bothSides([], ['a'])).toBe(false);
  });
  it('captions every mode without CLI jargon', () => {
    for (const m of ['upstream', 'local', 'both'] as const) expect(modeCaption(m)).not.toMatch(/--|refus/i);
  });
  it('says both columns, not removed lines, for a both-changed file', () => {
    expect(modeCaption('both')).toMatch(/yours.*upstream/i);
    expect(modeCaption('both')).not.toMatch(/removed/i);
  });
  it('maps paths', () => {
    expect(upstreamPathOf('AGENTS.md', 'files')).toBe('files/AGENTS.md');
    expect(upstreamPathOf('SKILL.md', null)).toBe('SKILL.md');
    expect(installedPathOf('.agents/skills/x', 'SKILL.md')).toBe('.agents/skills/x/SKILL.md');
    expect(installedPathOf('.', 'AGENTS.md')).toBe('AGENTS.md');
    expect(installedPathOf('a/b/', 'f')).toBe('a/b/f');
  });
});
