// Keyboard combos (no DOM beyond the event shape): matching a keydown against
// a combo and rendering it as keycaps. `mod` is Cmd on macOS and Ctrl
// elsewhere. Tested in shortcuts.test.ts.
export type Combo = {
  mod?: boolean;
  shift?: boolean;
  /** Option/Alt; matched on the physical key (`code`), since Option+letter types another character on a Mac. */
  alt?: boolean;
  key: string;
};

export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & { code?: string };

/**
 * Combos that are no longer bound to anything: Alt+T (it used to focus the
 * notifications stack) and Cmd/Ctrl+Shift+L (it used to toggle the theme).
 * Both actions stay in the palette, without a key. Retiring a combo here is
 * the whole change: `matchCombo` never matches a retired combo and
 * `formatCombo` prints no keycaps for it, so no view can keep advertising a
 * key that does nothing.
 */
export const RETIRED_SHORTCUTS: readonly Combo[] = [
  { alt: true, key: 't' },
  { mod: true, shift: true, key: 'l' },
];

/** True when the combo has been retired (same flags and key). */
export function isRetiredShortcut(combo: Combo): boolean {
  return RETIRED_SHORTCUTS.some(
    (r) =>
      r.key.toLowerCase() === combo.key.toLowerCase() &&
      !!r.mod === !!combo.mod &&
      !!r.alt === !!combo.alt &&
      !!r.shift === !!combo.shift,
  );
}

/** Platform guess for keycap labels and which modifier `mod` means. */
export function detectMac(platform: string | undefined = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent): boolean {
  return /mac|iphone|ipad/i.test(platform ?? '');
}

export function matchCombo(ev: KeyLike, combo: Combo, mac: boolean): boolean {
  if (isRetiredShortcut(combo)) return false;
  if (!!combo.alt !== ev.altKey) return false;
  if (combo.alt) {
    if (ev.metaKey || ev.ctrlKey || !!combo.shift !== ev.shiftKey || combo.mod) return false;
    const k = combo.key.toLowerCase();
    return ev.code ? ev.code.toLowerCase() === `key${k}` || ev.code.toLowerCase() === `digit${k}` : ev.key.toLowerCase() === k;
  }
  const mod = mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
  if (!!combo.mod !== mod) return false;
  // A plain combo must not fire under the other platform's modifier either.
  if (!combo.mod && (ev.metaKey || ev.ctrlKey)) return false;
  // Shift is part of the key for symbols like `?`, so only letters/Enter compare it.
  const symbol = combo.key.length === 1 && !/[a-z0-9]/i.test(combo.key);
  if (!symbol && !!combo.shift !== ev.shiftKey) return false;
  return ev.key.toLowerCase() === combo.key.toLowerCase();
}

const GLYPH: Record<string, string> = { Enter: '↵', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓' };

/** Keycap labels for a combo: ['⌘', '⇧', 'K'] on macOS, ['Ctrl', 'Shift', 'K'] elsewhere. A retired combo has no keycaps. */
export function formatCombo(combo: Combo, mac: boolean): string[] {
  if (isRetiredShortcut(combo)) return [];
  const out: string[] = [];
  if (combo.mod) out.push(mac ? '⌘' : 'Ctrl');
  if (combo.alt) out.push(mac ? '⌥' : 'Alt');
  if (combo.shift) out.push(mac ? '⇧' : 'Shift');
  out.push(GLYPH[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key));
  return out;
}

/**
 * The combo's shortcut if it is still bound, else undefined: a command built
 * with `shortcut: boundShortcut({ alt: true, key: 't' })` ends up with no
 * `shortcut` at all, so a shortcut sheet lists the action without a key
 * instead of with an empty keycap.
 */
export function boundShortcut(combo: Combo | undefined | null): Combo | undefined {
  return combo && !isRetiredShortcut(combo) ? combo : undefined;
}

/** True when a key event comes from somewhere text is typed. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}
