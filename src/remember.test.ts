// Tests for the remembered route (src/remember.ts): what is worth saving and
// when a saved route is restored at launch.
import { describe, expect, it } from 'vitest';
import { restoreRoute, routeToRemember } from './remember';

describe('routeToRemember', () => {
  it('remembers the real views and their deep paths', () => {
    expect(routeToRemember(['project'])).toBe('project');
    expect(routeToRemember(['browse', 'skills', 'file-pr'])).toBe('browse/skills/file-pr');
    expect(routeToRemember(['presets'])).toBe('presets');
  });

  it('skips the bare home route and unknown routes', () => {
    expect(routeToRemember([])).toBe(null);
    expect(routeToRemember(['nope'])).toBe(null);
  });
});

describe('restoreRoute', () => {
  it('restores the saved route when the URL names none', () => {
    expect(restoreRoute([], 'browse/skills')).toEqual(['browse', 'skills']);
  });

  it('an explicit route in the URL wins', () => {
    expect(restoreRoute(['project'], 'browse')).toBe(null);
  });

  it('ignores nothing saved, and saved routes that no longer resolve', () => {
    expect(restoreRoute([], null)).toBe(null);
    expect(restoreRoute([], 'gone/forever')).toBe(null);
    expect(restoreRoute([], '')).toBe(null);
  });

  it('round-trips encoded segments', () => {
    const saved = routeToRemember(['browse', 'a b'])!;
    expect(restoreRoute([], saved)).toEqual(['browse', 'a b']);
  });
});

import { parseImportedAt } from './remember';

describe('parseImportedAt', () => {
  it('reads a stored map and ignores junk', () => {
    expect(parseImportedAt(null)).toEqual({});
    expect(parseImportedAt('nope')).toEqual({});
    expect(parseImportedAt('[1]')).toEqual({});
    expect(parseImportedAt('{"p\\nskills/a":5,"p\\nb":"x"}')).toEqual({ 'p\nskills/a': 5 });
  });
});
