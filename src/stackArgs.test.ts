import { describe, expect, it } from 'vitest';
import { withOffline } from './stackArgs';

describe('withOffline', () => {
  it('adds --offline to status and show', () => {
    expect(withOffline('status', ['--json'])).toEqual(['--json', '--offline']);
    expect(withOffline('show', ['a/b', '--json'])).toEqual(['a/b', '--json', '--offline']);
  });
  it('asks the worker list offline, the catalog list online', () => {
    expect(withOffline('list', ['worker', '--json'])).toEqual(['worker', '--json', '--offline']);
    expect(withOffline('list', ['--json'])).toEqual(['--json']);
  });
  it('leaves list and writes online', () => {
    for (const s of ['list', 'search', 'import', 'update', 'remove', 'sync', 'init', 'preset'])
      expect(withOffline(s, ['--json'])).toEqual(['--json']);
  });
  it('is idempotent and stays before the -- separator', () => {
    expect(withOffline('status', ['--offline'])).toEqual(['--offline']);
    expect(withOffline('show', ['--json', '--', 'a/b'])).toEqual(['--json', '--offline', '--', 'a/b']);
  });
});
