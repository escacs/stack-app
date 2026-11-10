// Tests for the glide helpers (src/glide.ts): lerp convergence, the
// trackpad-vs-mouse delta split, target clamping, external-scroll detection
// and nested-scroller hand-off. attachGlide itself is DOM-bound.
import { describe, expect, it } from 'vitest';
import {
  canScrollFurther,
  clampTarget,
  glideStep,
  isExternalScroll,
  isSmoothDelta,
  scrollMax,
  wheelPixels,
} from './glide';

describe('glideStep timing', () => {
  it('closes the same share of the gap per second at any frame rate', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = glideStep(a, 1000, 1000 / 60);
    let b = 0;
    for (let i = 0; i < 20; i++) b = glideStep(b, 1000, 1000 / 20);
    expect(Math.abs(a - b)).toBeLessThan(2);
  });
  it('caps a long stall so one slow frame cannot teleport', () => {
    expect(glideStep(0, 1000, 5000)).toBeCloseTo(glideStep(0, 1000, 100), 5);
  });
});

describe('glideStep', () => {
  it('converges toward the target and snaps at the end', () => {
    let y = 0;
    for (let i = 0; i < 200; i++) y = glideStep(y, 100);
    expect(y).toBe(100);
    expect(glideStep(100, 100)).toBe(100);
    expect(glideStep(99.8, 100)).toBe(100);
  });

  it('moves monotonically in both directions', () => {
    expect(glideStep(0, 100)).toBeGreaterThan(0);
    expect(glideStep(100, 0)).toBeLessThan(100);
    expect(glideStep(0, -50)).toBeLessThan(0);
  });

  it('decays rather than moving at a constant speed', () => {
    const first = glideStep(0, 120) - 0;
    const second = glideStep(first, 120) - first;
    expect(second).toBeLessThan(first);
  });

  it('reaches the target in bounded frames when lerping a float position', () => {
    // attachGlide lerps a float and writes Math.round(pos); lerping the
    // rounded scroll position instead stalls 2px short, since 0.36px steps
    // round back to the same pixel.
    let pos = 0;
    let frames = 0;
    while (pos !== 120 && frames < 500) {
      pos = glideStep(pos, 120);
      frames++;
    }
    expect(pos).toBe(120);
    expect(frames).toBeLessThan(100);
    expect(Math.round(pos)).toBe(120);
  });

  it('passes non-finite input through untouched', () => {
    expect(glideStep(NaN, 100)).toBeNaN();
    expect(glideStep(0, Infinity)).toBe(0);
  });
});

describe('isSmoothDelta', () => {
  it('leaves trackpad-style deltas alone', () => {
    expect(isSmoothDelta(0)).toBe(true);
    expect(isSmoothDelta(2)).toBe(true);
    expect(isSmoothDelta(-3.5)).toBe(true);
    expect(isSmoothDelta(12.5)).toBe(true);
    expect(isSmoothDelta(NaN)).toBe(true);
  });

  it('catches mouse-wheel notches', () => {
    expect(isSmoothDelta(100)).toBe(false);
    expect(isSmoothDelta(-120)).toBe(false);
    expect(isSmoothDelta(50)).toBe(false);
  });
});

describe('wheelPixels', () => {
  it('keeps pixel deltas as they are', () => {
    expect(wheelPixels(120, 0)).toBe(120);
  });

  it('scales line deltas to pixels so notches still glide', () => {
    expect(wheelPixels(3, 1)).toBe(48);
    expect(isSmoothDelta(wheelPixels(3, 1))).toBe(false);
  });

  it('leaves page deltas to the browser', () => {
    expect(isSmoothDelta(wheelPixels(1, 2))).toBe(true);
  });
});

describe('clampTarget', () => {
  it('keeps targets inside [0, max]', () => {
    expect(clampTarget(50, 1000)).toBe(50);
    expect(clampTarget(-30, 1000)).toBe(0);
    expect(clampTarget(1400, 1000)).toBe(1000);
  });

  it('pins to 0 when nothing is scrollable', () => {
    expect(clampTarget(200, 0)).toBe(0);
    expect(clampTarget(200, -5)).toBe(0);
    expect(clampTarget(NaN, 1000)).toBe(0);
  });

  it('follows a shrinking page', () => {
    // A glide aimed at 900 must land at the new bottom after a route change.
    expect(clampTarget(900, scrollMax(1200, 800))).toBe(400);
  });
});

describe('scrollMax', () => {
  it('is content height minus the viewport, never negative', () => {
    expect(scrollMax(6800, 800)).toBe(6000);
    expect(scrollMax(600, 800)).toBe(0);
  });
});

describe('isExternalScroll', () => {
  it('treats our own writes as internal', () => {
    expect(isExternalScroll(120, 120)).toBe(false);
    expect(isExternalScroll(120.6, 120)).toBe(false);
  });

  it('flags drags, keys and clamps as external', () => {
    expect(isExternalScroll(480, 120)).toBe(true);
    expect(isExternalScroll(0, 120)).toBe(true);
    expect(isExternalScroll(118, 120)).toBe(true);
  });
});

describe('canScrollFurther', () => {
  it('lets a nested list take the wheel while it has room that way', () => {
    // 300px tall box showing 100px of 500px content.
    expect(canScrollFurther(120, 0, 300, 500)).toBe(true);
    expect(canScrollFurther(-120, 50, 300, 500)).toBe(true);
  });

  it('hands the wheel back at the edge it is pushing against', () => {
    expect(canScrollFurther(-120, 0, 300, 500)).toBe(false);
    expect(canScrollFurther(120, 200, 300, 500)).toBe(false);
  });
});
