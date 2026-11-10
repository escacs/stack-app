// Tests for the onboarding gate and top-bar path (src/onboard.ts): which
// screen shows for a config, cursor movement over the pick rows, and how a
// project path is shortened in the top bar.
import { describe, expect, it } from 'vitest';
import { moveSel, onboardStep, shortPath } from './onboard';

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

describe('onboardStep per launch', () => {
  it('asks again each launch even when both are remembered', () => {
    expect(onboardStep('mel', '/p', false, false, false)).toBe('who');
    expect(onboardStep('mel', '/p', false, true, false)).toBe('project');
    expect(onboardStep('mel', '/p', false, true, true)).toBe(null);
  });

  it('a skipped worker still asks the project', () => {
    expect(onboardStep(null, '/p', true, true, false)).toBe('project');
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

describe('shortPath', () => {
  it('keeps the last two segments of a deep path', () => {
    expect(shortPath('/home/dev/projects/folio')).toBe('…/projects/folio');
    expect(shortPath('/a/b/c')).toBe('…/b/c');
  });

  it('drops trailing slashes before shortening', () => {
    expect(shortPath('/home/dev/projects/folio/')).toBe('…/projects/folio');
    expect(shortPath('/home/dev///')).toBe('/home/dev');
  });

  it('leaves a short path as it is', () => {
    expect(shortPath('/home/dev')).toBe('/home/dev');
    expect(shortPath('/home/')).toBe('/home');
    expect(shortPath('projects/folio')).toBe('projects/folio');
  });

  it('keeps the root and handles the empty string', () => {
    expect(shortPath('/')).toBe('/');
    expect(shortPath('///')).toBe('/');
    expect(shortPath('')).toBe('');
  });

  it('accepts Windows separators', () => {
    expect(shortPath('C:\\Users\\mel\\proj\\')).toBe('…/mel/proj');
  });
});
