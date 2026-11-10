// Tests for the onboarding gate (src/onboard.ts): which screen shows for
// a config, and cursor movement over the pick rows.
import { describe, expect, it } from 'vitest';
import { moveSel, onboardStep } from './onboard';

describe('onboardStep', () => {
  it('asks who first, then which project', () => {
    expect(onboardStep(null, null, false)).toBe('who');
    expect(onboardStep(null, '/p', false)).toBe('who');
    expect(onboardStep('mel', null, false)).toBe('project');
    expect(onboardStep('mel', '/p', false)).toBe(null);
  });

  it('a skipped worker counts as answered', () => {
    expect(onboardStep(null, null, true)).toBe('project');
    expect(onboardStep(null, '/p', true)).toBe(null);
  });
});

describe('moveSel', () => {
  it('walks the rows and stops at the ends', () => {
    expect(moveSel(0, 1, 3)).toBe(1);
    expect(moveSel(2, 1, 3)).toBe(2);
    expect(moveSel(0, -1, 3)).toBe(0);
    expect(moveSel(1, -1, 3)).toBe(0);
  });

  it('starts from the nearest end and handles empties', () => {
    expect(moveSel(-1, 1, 3)).toBe(0);
    expect(moveSel(-1, -1, 3)).toBe(2);
    expect(moveSel(-1, 1, 0)).toBe(-1);
    expect(moveSel(0, 1, 0)).toBe(-1);
  });
});
