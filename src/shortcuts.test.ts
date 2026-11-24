// Tests for keyboard combos (src/shortcuts.ts): matching per platform and
// keycap labels, and the combos that are no longer bound.
import { describe, expect, it } from 'vitest';
import { RETIRED_SHORTCUTS, boundShortcut, detectMac, formatCombo, isRetiredShortcut, matchCombo, type Combo, type KeyLike } from './shortcuts';

const ev = (key: string, over: Partial<KeyLike> = {}): KeyLike => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe('matchCombo', () => {
  it('mod is Cmd on a Mac and Ctrl elsewhere', () => {
    const k = { mod: true, key: 'k' };
    expect(matchCombo(ev('k', { metaKey: true }), k, true)).toBe(true);
    expect(matchCombo(ev('k', { ctrlKey: true }), k, true)).toBe(false);
    expect(matchCombo(ev('k', { ctrlKey: true }), k, false)).toBe(true);
    expect(matchCombo(ev('k', { metaKey: true }), k, false)).toBe(false);
  });

  it('is case-insensitive on the key and rejects Alt', () => {
    expect(matchCombo(ev('K', { ctrlKey: true }), { mod: true, key: 'k' }, false)).toBe(true);
    expect(matchCombo(ev('k', { ctrlKey: true, altKey: true }), { mod: true, key: 'k' }, false)).toBe(false);
  });

  it('shift must agree for letters', () => {
    const c = { mod: true, shift: true, key: 'u' };
    expect(matchCombo(ev('U', { ctrlKey: true, shiftKey: true }), c, false)).toBe(true);
    expect(matchCombo(ev('u', { ctrlKey: true }), c, false)).toBe(false);
    expect(matchCombo(ev('u', { ctrlKey: true, shiftKey: true }), { mod: true, key: 'u' }, false)).toBe(false);
  });

  it('a symbol key like ? ignores shift but never fires under a modifier', () => {
    expect(matchCombo(ev('?', { shiftKey: true }), { key: '?' }, false)).toBe(true);
    expect(matchCombo(ev('?', { ctrlKey: true, shiftKey: true }), { key: '?' }, false)).toBe(false);
  });

  it('a plain combo does not fire under Cmd or Ctrl', () => {
    expect(matchCombo(ev('1', { ctrlKey: true }), { key: '1' }, false)).toBe(false);
    expect(matchCombo(ev('1'), { key: '1' }, false)).toBe(true);
  });
});

describe('formatCombo', () => {
  it('uses glyphs on a Mac and words elsewhere', () => {
    expect(formatCombo({ mod: true, shift: true, key: 'u' }, true)).toEqual(['⌘', '⇧', 'U']);
    expect(formatCombo({ mod: true, shift: true, key: 'u' }, false)).toEqual(['Ctrl', 'Shift', 'U']);
    expect(formatCombo({ mod: true, key: 'Enter' }, true)).toEqual(['⌘', '↵']);
    expect(formatCombo({ key: '?' }, false)).toEqual(['?']);
  });
});

describe('detectMac', () => {
  it('reads the platform string', () => {
    expect(detectMac('MacIntel')).toBe(true);
    expect(detectMac('Linux x86_64')).toBe(false);
    expect(detectMac('')).toBe(false);
  });
});

describe('alt combos', () => {
  const c = { alt: true, key: 'y' };
  it('match the physical key, so Option+Y on a Mac (typing another glyph) still counts', () => {
    expect(matchCombo(ev('y', { altKey: true, code: 'KeyY' }), c, false)).toBe(true);
    expect(matchCombo(ev('¥', { altKey: true, code: 'KeyY' }), c, true)).toBe(true);
    expect(matchCombo(ev('y', { altKey: true, code: 'KeyT' }), c, false)).toBe(false);
  });
  it('need Alt and nothing else', () => {
    expect(matchCombo(ev('y', { code: 'KeyY' }), c, false)).toBe(false);
    expect(matchCombo(ev('y', { altKey: true, ctrlKey: true, code: 'KeyY' }), c, false)).toBe(false);
    expect(matchCombo(ev('y', { altKey: true, shiftKey: true, code: 'KeyY' }), c, false)).toBe(false);
  });
  it('are labelled with the platform key', () => {
    expect(formatCombo(c, false)).toEqual(['Alt', 'Y']);
    expect(formatCombo(c, true)).toEqual(['⌥', 'Y']);
  });
});

describe('retired combos', () => {
  it('lists the two keys that were taken back', () => {
    expect(RETIRED_SHORTCUTS).toEqual([
      { alt: true, key: 't' },
      { mod: true, shift: true, key: 'l' },
    ]);
  });

  it('never matches, whichever command still carries the combo', () => {
    expect(matchCombo(ev('t', { altKey: true, code: 'KeyT' }), { alt: true, key: 't' }, false)).toBe(false);
    expect(matchCombo(ev('l', { metaKey: true, shiftKey: true }), { mod: true, shift: true, key: 'l' }, true)).toBe(false);
    expect(matchCombo(ev('L', { ctrlKey: true, shiftKey: true }), { mod: true, shift: true, key: 'l' }, false)).toBe(false);
  });

  it('prints no keycaps, so a palette row cannot advertise a dead key', () => {
    expect(formatCombo({ alt: true, key: 't' }, true)).toEqual([]);
    expect(formatCombo({ mod: true, shift: true, key: 'l' }, false)).toEqual([]);
  });

  it('drops the combo from a command, leaving the action reachable from the palette', () => {
    expect(boundShortcut({ alt: true, key: 't' })).toBeUndefined();
    expect(boundShortcut(null)).toBeUndefined();
    expect(boundShortcut({ mod: true, key: 'k' })).toEqual({ mod: true, key: 'k' });
  });

  it('leaves the shortcuts the app keeps working', () => {
    const kept: Combo[] = [
      { mod: true, key: '1' },
      { mod: true, key: '2' },
      { mod: true, key: '3' },
      { key: '/' },
      { key: '?' },
      { mod: true, key: 'k' },
      { mod: true, key: 'Enter' },
      { mod: true, shift: true, key: 'Enter' },
      { mod: true, shift: true, key: 'u' },
      { mod: true, shift: true, key: 's' },
      { mod: true, key: 'o' },
      { mod: true, shift: true, key: 'o' },
      { mod: true, key: 'd' },
    ];
    for (const c of kept) expect([c, isRetiredShortcut(c)]).toEqual([c, false]);
    // Alt+Shift+T is a different combo, not the retired one.
    expect(isRetiredShortcut({ alt: true, shift: true, key: 't' })).toBe(false);
  });
});
