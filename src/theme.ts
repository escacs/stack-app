// Light / dark: follows the system until the theme button picks one; the
// pick is remembered per machine in localStorage (every access guarded:
// it can be blocked or empty). The choice lives on <html data-theme>, which
// styles/stack-alabaster/tokens-dark.css reads.
import { createSignal } from 'solid-js';

export type Theme = 'light' | 'dark';
const KEY = 'stack-app.theme';

function system(): Theme {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const [theme, setThemeSignal] = createSignal<Theme>(stored() ?? system());
export { theme };

function apply(t: Theme | null): void {
  if (typeof document === 'undefined') return;
  if (t) document.documentElement.dataset['theme'] = t;
  else delete document.documentElement.dataset['theme'];
}

/** Apply the remembered choice (if any) and follow system changes until one is made. */
export function initTheme(): void {
  const s = stored();
  apply(s);
  setThemeSignal(s ?? system());
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!stored()) setThemeSignal(system());
    });
  } catch {
    /* no matchMedia: stay on the initial value */
  }
}

export function toggleTheme(): void {
  const next: Theme = theme() === 'dark' ? 'light' : 'dark';
  setThemeSignal(next);
  apply(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* not persisted */
  }
}
