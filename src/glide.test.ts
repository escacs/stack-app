// Tests for the glide helpers (src/glide.ts): lerp convergence and the
// trackpad-vs-mouse delta split. attachGlide itself is DOM-bound.
import { describe, expect, it } from 'vitest';
import { glideStep, isSmoothDelta } from './glide';

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
