// Navigation the shell and the palette share: go to a view, and the `/`
// catalog search (Browse owns the one search box; elsewhere it lands there
// first, then focuses it).
import { href, parseHash } from './router';

export const currentScenario = (): string => parseHash(location.hash).scenario;

export function go(view: 'project' | 'browse'): void {
  location.hash = href(currentScenario(), view);
}

/** Browse, scoped to the Presets kind. */
export function goPresets(): void {
  location.hash = href(currentScenario(), 'browse', 'presets');
}

export function goSearch(): void {
  const focus = (): boolean => {
    const el = document.getElementById('q');
    if (el) el.focus();
    return !!el;
  };
  if (parseHash(location.hash).segs[0] === 'browse') {
    focus();
    return;
  }
  go('browse');
  // Browse mounts on the hash change; the prompt exists a tick later.
  setTimeout(focus, 60);
}
