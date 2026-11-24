// Tests for the toast queue and stack geometry (src/toastQueue.ts).
import { describe, expect, it } from 'vitest';
import { enqueue, geometry, remove, type ToastItem } from './toastQueue';

const t = (id: number): ToastItem => ({ id, tone: 'info', title: `t${id}`, ttl: 1000 });

describe('enqueue', () => {
  it('puts the newest card in front', () => {
    const { list } = enqueue([t(1)], t(2));
    expect(list.map((x) => x.id)).toEqual([2, 1]);
  });

  it('drops the oldest beyond the cap and reports them', () => {
    let list: ToastItem[] = [];
    let dropped: ToastItem[] = [];
    for (let i = 1; i <= 7; i++) ({ list, dropped } = enqueue(list, t(i), 5));
    expect(list.map((x) => x.id)).toEqual([7, 6, 5, 4, 3]);
    expect(dropped.map((x) => x.id)).toEqual([2]);
  });
});

describe('remove', () => {
  it('removes by id and keeps the order', () => {
    expect(remove([t(3), t(2), t(1)], 2).map((x) => x.id)).toEqual([3, 1]);
  });
});

describe('geometry', () => {
  it('offsets each card by the heights in front of it', () => {
    expect(geometry([60, 80, 70])).toEqual({ offsets: [0, 60, 140], frontHeight: 60, stackHeight: 210 });
  });

  it('treats unmeasured cards as 0 and an empty stack as flat', () => {
    expect(geometry([60, undefined, 40]).offsets).toEqual([0, 60, 60]);
    expect(geometry([])).toEqual({ offsets: [], frontHeight: 0, stackHeight: 0 });
  });
});
