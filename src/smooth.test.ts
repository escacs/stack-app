// Tests for the smooth-scroll helpers (src/smooth.ts): external-scroll
// detection that rebases a Lenis glide instead of yanking it back.
// attachSmooth itself is DOM-bound.
import { describe, expect, it } from 'vitest';
import { isExternalScroll } from './smooth';

describe('isExternalScroll', () => {
  it('treats Lenis writes as internal', () => {
    expect(isExternalScroll(120, 120)).toBe(false);
    // Lenis lerps a float; the browser stores whole pixels.
    expect(isExternalScroll(121, 120.4)).toBe(false);
    expect(isExternalScroll(120.4, 121)).toBe(false);
  });

  it('flags drags, keys and clamps as external', () => {
    expect(isExternalScroll(480, 120)).toBe(true);
    expect(isExternalScroll(0, 120)).toBe(true);
    expect(isExternalScroll(118, 120)).toBe(true);
  });
});
