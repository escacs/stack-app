// Remembered shell state that is not part of the saved config: the last
// route. The worker and project themselves live in config.json (the shell
// stores them); this is the one per-machine convenience kept in localStorage,
// every access guarded (it can be blocked or empty).
import { resolveView } from './router';

const KEY = 'stack-app.route';

/** Views worth coming back to; `missing` routes are never remembered. */
export function routeToRemember(segs: string[]): string | null {
  if (resolveView(segs) === 'missing') return null;
  // The bare home route carries nothing to restore.
  if (segs.length === 0) return null;
  return segs.map((s) => encodeURIComponent(s)).join('/');
}

/**
 * The segments to land on at launch. An explicit route in the URL always wins;
 * with none, the saved one is used when it still resolves to a real view.
 */
export function restoreRoute(segs: string[], saved: string | null): string[] | null {
  if (segs.length > 0 || !saved) return null;
  const parts = saved
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  return parts.length && resolveView(parts) !== 'missing' ? parts : null;
}

export function readSavedRoute(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveRoute(segs: string[]): void {
  const r = routeToRemember(segs);
  if (!r) return;
  try {
    localStorage.setItem(KEY, r);
  } catch {
    /* not remembered */
  }
}

// ------------------------------------------------------------------ recent imports

const IMPORTED_KEY = 'stack-app.imported-at';

/** Parse the stored map defensively: anything odd reads as empty. */
export function parseImportedAt(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (typeof t === 'number' && Number.isFinite(t)) out[k] = t;
    return out;
  } catch {
    return {};
  }
}

/** When this app last imported each entry in a project (entry id → ms), for the Recently imported sort. */
export function readImportedAt(project: string | null): Map<string, number> {
  if (!project) return new Map();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(IMPORTED_KEY);
  } catch {
    return new Map();
  }
  const all = parseImportedAt(raw);
  const prefix = `${project}\n`;
  return new Map(Object.entries(all).filter(([k]) => k.startsWith(prefix)).map(([k, t]) => [k.slice(prefix.length), t]));
}

export function recordImported(project: string | null, ids: readonly string[], at = Date.now()): void {
  if (!project || !ids.length) return;
  try {
    const all = parseImportedAt(localStorage.getItem(IMPORTED_KEY));
    for (const id of ids) all[`${project}\n${id}`] = at;
    localStorage.setItem(IMPORTED_KEY, JSON.stringify(all));
  } catch {
    /* not remembered */
  }
}
