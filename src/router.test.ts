// Tests for hash routing (src/router.ts): scenario/route splitting.
import { describe, expect, it } from 'vitest';
import { href, parseHash, resolveView } from './router';

describe('parseHash', () => {
  it('defaults an empty hash to populated + home', () => {
    expect(parseHash('')).toEqual({ scenario: 'populated', segs: [] });
    expect(parseHash('#')).toEqual({ scenario: 'populated', segs: [] });
  });

  it('splits scenario,route', () => {
    expect(parseHash('#conflicts,/project')).toEqual({ scenario: 'conflicts', segs: ['project'] });
    expect(parseHash('#populated,/browse/skills/file-pr')).toEqual({
      scenario: 'populated',
      segs: ['browse', 'skills', 'file-pr'],
    });
  });

  it('treats a bare word as scenario-only (home route)', () => {
    expect(parseHash('#empty')).toEqual({ scenario: 'empty', segs: [] });
  });

  it('treats a bare /route as route-only', () => {
    expect(parseHash('#/browse')).toEqual({ scenario: 'populated', segs: ['browse'] });
  });

  it('decodes segments', () => {
    expect(parseHash('#populated,/browse/skills/a%20b')).toEqual({
      scenario: 'populated',
      segs: ['browse', 'skills', 'a b'],
    });
  });
});

describe('href', () => {
  it('encodes per segment and keeps entry slashes', () => {
    expect(href('populated', 'browse', 'skills/a b')).toBe('#populated,/browse/skills/a%20b');
    expect(href('empty')).toBe('#empty,/');
  });
});

describe('resolveView', () => {
  it('defaults an empty route to the project page', () => {
    expect(resolveView([])).toBe('project');
  });

  it('maps project and browse routes', () => {
    expect(resolveView(['project'])).toBe('project');
    expect(resolveView(['browse'])).toBe('browse');
    expect(resolveView(['browse', 'skills', 'file-pr'])).toBe('browse');
  });

  it('keeps the old installed route as a project alias', () => {
    expect(resolveView(['installed'])).toBe('project');
  });

  it('reports unknown routes as missing', () => {
    expect(resolveView(['nope'])).toBe('missing');
  });
});
