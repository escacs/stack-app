import { describe, expect, it } from 'vitest';
import { createGuard } from './guard';

describe('createGuard', () => {
  it('refuses a second start while the first is in flight', async () => {
    const g = createGuard({ now: () => 0, settleMs: 0 });
    let release!: () => void;
    let runs = 0;
    const first = g.run('send', () => new Promise<void>((r) => { runs++; release = r; }));
    expect(g.running('send')).toBe(true);
    expect(await g.run('send', () => { runs++; })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
    expect(g.running('send')).toBe(false);
  });

  it('keeps ids independent', async () => {
    const g = createGuard({ now: () => 0, settleMs: 0 });
    expect(g.start('a')).toBe(true);
    expect(g.start('b')).toBe(true);
    g.finish('a');
    expect(g.running('b')).toBe(true);
  });

  it('ignores repeats during the settle window, then allows again', async () => {
    let t = 1000;
    const g = createGuard({ now: () => t, settleMs: 500 });
    expect(await g.run('sync', () => {})).toBe(true);
    t += 100;
    expect(await g.run('sync', () => {})).toBe(false);
    t += 450;
    expect(await g.run('sync', () => {})).toBe(true);
  });

  it('releases after a failure and still settles', async () => {
    let t = 0;
    const g = createGuard({ now: () => t, settleMs: 300 });
    await expect(g.run('x', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(g.running('x')).toBe(false);
    expect(g.start('x')).toBe(false);
    t = 400;
    expect(g.start('x')).toBe(true);
  });

  it('reports the running set to onChange', () => {
    const seen: string[][] = [];
    const g = createGuard({ now: () => 0, settleMs: 0, onChange: (s) => seen.push([...s]) });
    g.start('a');
    g.start('b');
    g.finish('a');
    g.finish('a');
    g.finish('b');
    expect(seen).toEqual([['a'], ['a', 'b'], ['b'], []]);
  });
});
