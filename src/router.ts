// Hash routing. The mock bridge reads its scenario from the same hash, so
// both share one shape: `#<scenario>,<route…>` — e.g. `#populated,/browse`
// or `#conflicts,/status`. A bare `#empty` (or no hash) means scenario-only
// with the home route; a bare `#/browse` means route-only.
export type Hash = { scenario: string; segs: string[] };

export const DEFAULT_SCENARIO = 'populated';

export function parseHash(hash: string): Hash {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const ci = h.indexOf(',');
  if (ci < 0) {
    if (!h) return { scenario: DEFAULT_SCENARIO, segs: [] };
    if (h.startsWith('/')) return { scenario: DEFAULT_SCENARIO, segs: segsOf(h) };
    return { scenario: h.split('/')[0] || DEFAULT_SCENARIO, segs: segsOf(h) };
  }
  return {
    scenario: h.slice(0, ci) || DEFAULT_SCENARIO,
    segs: segsOf(h.slice(ci + 1)),
  };
}

// `#/browse/skills/foo` (no scenario): the first segment after the leading
// slash is the route; a scenario-looking first segment without a leading
// slash (e.g. `#empty`) is scenario-only, home route.
function segsOf(h: string): string[] {
  const parts = h.split('/').filter(Boolean);
  if (!h.startsWith('/') && parts.length) parts.shift();
  return parts.map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
}

export function href(scenario: string, ...segs: string[]): string {
  const enc = segs.map((s) => s.split('/').map(encodeURIComponent).join('/')).join('/');
  return `#${scenario},/${enc}`;
}
