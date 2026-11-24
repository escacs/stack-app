// Catalog kind counts shared with the sidebar. Browse owns the full catalog
// load (markers, refresh, cache) and publishes its entries here; the sidebar
// only reads counts. On views other than Browse nothing has loaded the
// catalog yet, so `ensureCatalog` fetches one plain `list --json` for the
// counts, once per project / stack checkout.
import { createSignal } from 'solid-js';
import { stackRun, type AppConfig } from './bridge';
import { fromStackOut, type JsonEntry, type ListJson } from './json';

const [entries, setEntries] = createSignal<readonly JsonEntry[]>([]);

export const catalogEntries = entries;

// The Browse search text, so the sidebar can show matches per kind.
const [query, setQuery] = createSignal('');
export const catalogQuery = query;
export const publishQuery = setQuery;

// The kind the Browse list is really scoped to (plural, '' for all), so the
// sidebar highlights what the list shows even when an entry is open.
const [scope, setScope] = createSignal<string | undefined>(undefined);
export const catalogScope = scope;
export const publishScope = setScope;

export function publishCatalog(list: readonly JsonEntry[]): void {
  setEntries(list);
}

/** Entries of one kind (singular `skill`, `style`, ...). */
export const kindCount = (kind: string): number => entries().filter((e) => e.kind === kind).length;

let asked = '';

/** Load the counts once per project + stack path; a new key replaces whatever was shown. */
export async function ensureCatalog(c: AppConfig | null): Promise<void> {
  if (!c) return;
  const key = `${c.project ?? ''}\n${c.stackPath ?? ''}`;
  if (key === asked) return;
  asked = key;
  try {
    const out = await stackRun('list', ['--json'], c.project ?? '.', c.stackPath);
    if (key !== asked) return;
    // Always replace: a changed stack path must not keep the old checkout's counts.
    setEntries(fromStackOut<ListJson>(out).entries);
  } catch {
    asked = '';
  }
}
