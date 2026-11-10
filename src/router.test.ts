// Tests for hash routing (src/router.ts): scenario/route splitting.
import { describe, expect, it } from 'vitest';
import { href, parseHash } from './router';

describe('parseHash', () => {
  it('defaults an empty hash to populated + home', () => {
    expect(parseHash('')).toEqual({ scenario: 'populated', segs: [] });
    expect(parseHash('#')).toEqual({ scenario: 'populated', segs: [] });
  });

  it('splits scenario,route', () => {
    expect(parseHash('#conflicts,/status')).toEqual({ scenario: 'conflicts', segs: ['status'] });
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
