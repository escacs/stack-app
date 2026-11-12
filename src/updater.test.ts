// Tests for the footer's pure update formatters (progress line, short
// error). The check/install/relaunch calls themselves need the native
// updater plugin and are not covered here.
import { describe, expect, it } from 'vitest';
import { formatUpdateProgress, shortenError } from './updater';

describe('formatUpdateProgress', () => {
  it('is null until the first event', () => {
    expect(formatUpdateProgress(null)).toBeNull();
  });

  it('names the total once downloaded', () => {
    expect(formatUpdateProgress({ downloaded: 173000, total: 173000, done: true })).toBe(
      'downloaded 169k',
    );
  });

  it('shows downloaded / total with percent', () => {
    expect(formatUpdateProgress({ downloaded: 512, total: 1024, done: false })).toBe(
      '512b / 1.0k (50%)',
    );
  });

  it('shows a trailing ellipsis without a total', () => {
    expect(formatUpdateProgress({ downloaded: 512, total: null, done: false })).toBe('512b…');
  });
});

describe('shortenError', () => {
  it('passes short errors through', () => {
    expect(shortenError('network unreachable')).toBe('network unreachable');
  });

  it('keeps the first non-blank line', () => {
    expect(shortenError('\n  failed to fetch\nsecond line')).toBe('failed to fetch');
  });

  it('caps long lines with an ellipsis', () => {
    expect(shortenError('x'.repeat(100))).toBe(`${'x'.repeat(59)}…`);
    expect(shortenError('y'.repeat(60))).toBe('y'.repeat(60));
  });
});
