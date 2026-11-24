// The command list behind the palette and the global shortcuts. Every command
// routes through the function its button already uses: store actions for the
// shell, and the handlers views register (actions.ts) for page operations.
// `reason` is why a command cannot run right now; the palette lists only the
// few that say why instead of hiding them (palette.ts SHOWS_WHEN_DISABLED).
//
// Groups are drawn in one fixed order (palette.ts GROUP_ORDER): what the query
// found (Catalog, Imports), Navigate, what the open page offers (Entry,
// Project), Workspace, then App. Two kinds of row appear only while a query is
// typed, so the default list stays short enough to read without scrolling: the
// per-worktree switch (one per worktree) and the results — catalog entries, and
// on the Project route the tracked imports. Results are links: Enter opens the
// entry, it never starts an import, so a query naming an entry can no longer
// run whatever command the cursor happened to sit on.
import { actionFor } from './actions';
import { catalogEntries, ensureCatalog } from './catalog';
import { go, goPresets, goSearch } from './nav';
import { openHelp } from './overlays';
import { IMPORTS_GROUP, resultRows, type PaletteRow, type Rankable } from './palette';
import type { IconName } from './icons';
import { href, parseHash, resolveView } from './router';
import { detectMac, isTyping, matchCombo, type Combo } from './shortcuts';
import { config, lock, switchProject, switchTargetDir, switchWorker } from './store';
import { t3Info, worktreeLabel } from './t3';
import { toggleTheme, theme } from './theme';
import { focusToasts, toastCount } from './toast';
import { kindOf } from './parse';
import { LABEL } from './vocab';

export type Command = Rankable & {
  icon: IconName;
  shortcut?: Combo;
  run: () => void;
  disabled: string | null;
};

export const mac = detectMac();

const NEED_PROJECT = 'Open a project first';

/** The last segment of an id (`skills/pony` → `pony`), for a row's title. */
const nameOf = (id: string): string => id.slice(id.lastIndexOf('/') + 1);

/**
 * A result row as a command. Enter goes to `route`: the row is a link, so it
 * carries no action and no reason not to run — the palette can never turn a
 * search hit into an import.
 */
function rowCommand(row: PaletteRow): Command {
  return {
    ...row,
    icon: row.group === IMPORTS_GROUP ? 'box' : 'layers',
    disabled: null,
    run: () => {
      location.hash = row.route;
    },
  };
}

/** Page operations come from whichever view registered them; none registered means that view is not open. */
function viaView(id: string, whenAbsent: string): { disabled: string | null; run: () => void; title?: string } {
  const h = actionFor(id);
  if (!h) return { disabled: whenAbsent, run: () => {} };
  const title = h.title?.();
  return { disabled: h.reason?.() ?? null, run: () => void h.run(), ...(title ? { title } : {}) };
}

function build(): Command[] {
  const c = config();
  const hasProject = !!c?.project;
  const list: Command[] = [];
  const add = (cmd: Omit<Command, 'disabled'> & { disabled?: string | null }) => list.push({ disabled: null, ...cmd });

  add({ id: 'go-project', title: 'Go to Project', group: 'Navigate', icon: 'folder', shortcut: { mod: true, key: '1' }, keywords: 'imports drift', run: () => go('project'), disabled: hasProject ? null : NEED_PROJECT });
  add({ id: 'go-browse', title: 'Go to Browse', group: 'Navigate', icon: 'layers', shortcut: { mod: true, key: '2' }, keywords: 'catalog skills styles components', run: () => go('browse'), disabled: hasProject ? null : NEED_PROJECT });
  add({ id: 'go-presets', title: 'Browse presets', group: 'Navigate', icon: 'list', shortcut: { mod: true, key: '3' }, keywords: 'bundles preset presets', run: goPresets, disabled: hasProject ? null : NEED_PROJECT });
  add({ id: 'search-catalog', title: 'Search the catalog', group: 'Navigate', icon: 'search', shortcut: { key: '/' }, keywords: 'find browse', run: goSearch, disabled: hasProject ? null : NEED_PROJECT });

  // What the entry or page in front of the user offers, before the app-level switches.
  const imp = viaView('import-selected', 'Open Browse and select an entry first');
  add({ id: 'import-selected', title: LABEL.importEntry, group: 'Entry', icon: 'download', shortcut: { mod: true, key: 'Enter' }, keywords: 'add entry into project', ...imp });
  const dry = viaView('dry-run', 'Open a catalog entry first');
  add({ id: 'dry-run', title: LABEL.previewPlan, group: 'Entry', icon: 'play', shortcut: { mod: true, key: 'd' }, keywords: 'preview plan files check', ...dry });
  const clr = viaView('browse-clear-filters', 'Open Browse first');
  add({ id: 'browse-clear-filters', title: 'Clear Browse filters', group: 'Entry', icon: 'x', keywords: 'reset search chips stable experimental imported', ...clr });
  if (t3Info()?.t3Available) {
    const send = viaView('send-thread', 'Open a catalog entry first');
    add({ id: 'send-thread', title: 'Send to T3 thread', group: 'Entry', icon: 'send', shortcut: { mod: true, shift: true, key: 'Enter' }, keywords: 't3 code inject prompt', ...send });
  }

  const upd = viaView('update-all', 'Open the Project page first');
  add({ id: 'update-all', title: LABEL.updateAll, group: 'Project', icon: 'refresh', shortcut: { mod: true, shift: true, key: 'u' }, keywords: 'update upgrade upstream all', ...upd });
  const rev = viaView('review-changes', 'Open the Project page first');
  add({ id: 'review-changes', title: LABEL.reviewChanges, group: 'Project', icon: 'list', keywords: 'diff upstream edits compare changes review', ...rev });
  const syn = viaView('sync-missing', 'Open the Project page first');
  add({ id: 'sync-missing', title: LABEL.restoreFiles, group: 'Project', icon: 'refresh', shortcut: { mod: true, shift: true, key: 's' }, keywords: 'restore repair missing files', ...syn });

  // What the query found: catalog entries, and the project's tracked imports.
  // Both are links (`run` sets the hash), never the import action.
  const view = resolveView(parseHash(location.hash).segs);
  const entries = catalogEntries();
  // Browse publishes the catalog; on another route nothing has loaded it yet,
  // so ask for the one plain `list --json` (catalog.ts caches per project).
  if (!entries.length) void ensureCatalog(c);
  const imports = view === 'project' ? lock().rows.map((r) => ({ id: r.id, name: nameOf(r.id), kind: kindOf(r.id), summary: r.path })) : [];
  const scenario = parseHash(location.hash).scenario;
  for (const row of resultRows({ entries, imports }, {
    catalog: (id) => href(scenario, 'browse', ...id.split('/')),
    project: (id) => href(scenario, 'project', ...id.split('/')),
  })) list.push(rowCommand(row));

  add({ id: 'switch-project', title: 'Switch project…', group: 'Workspace', icon: 'folder', shortcut: { mod: true, key: 'o' }, keywords: 'open folder change recent', run: switchProject });
  add({ id: 'switch-worker', title: 'Switch worker…', group: 'Workspace', icon: 'user', shortcut: { mod: true, shift: true, key: 'o' }, keywords: 'who user profile change', run: switchWorker });

  // One row per other worktree, too many to list up front: the query brings
  // them in (this worktree is already where imports land, so it has no row).
  for (const w of t3Info()?.worktrees ?? []) {
    if (w.isCurrent) continue;
    const label = worktreeLabel(w);
    add({
      id: `import-into:${w.path}`,
      title: LABEL.importInto(label),
      group: 'Workspace',
      icon: 'branch',
      keywords: `switch worktree branch import into target ${w.path}`,
      run: () => void switchTargetDir(w.path),
      onlyWhenSearching: true,
    });
  }

  add({ id: 'toggle-theme', title: theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'App', icon: theme() === 'dark' ? 'sun' : 'moon', keywords: 'appearance dark light mode', run: toggleTheme });
  const chk = viaView('check-updates', 'Updates are not available here');
  add({ id: 'check-updates', title: LABEL.checkAppUpdates, group: 'App', icon: 'download', keywords: 'upgrade app version release desktop', ...chk });
  add({ id: 'focus-toasts', title: 'Focus notifications', group: 'App', icon: 'info', keywords: 'toast undo messages stack', run: focusToasts, disabled: toastCount() ? null : 'No notifications' });
  add({ id: 'shortcuts', title: 'Keyboard shortcuts', group: 'App', icon: 'keyboard', shortcut: { key: '?' }, keywords: 'help keys hotkeys', run: openHelp });
  return list;
}

/** The command list. Reactive: call it inside an effect or JSX and it follows state and registered views. */
export const commands = (): Command[] => build();

/**
 * Global shortcuts. Returns true when the key was a command's shortcut (and
 * ran it, or ignored it for a stated reason). Plain-key combos stay quiet
 * while typing; modifier combos work from anywhere.
 */
export function runShortcut(ev: KeyboardEvent): boolean {
  if (ev.defaultPrevented || ev.isComposing) return false;
  for (const cmd of commands()) {
    if (!cmd.shortcut || !matchCombo(ev, cmd.shortcut, mac)) continue;
    if (!cmd.shortcut.mod && !cmd.shortcut.alt && isTyping(ev.target)) return false;
    if (cmd.disabled) return false;
    ev.preventDefault();
    cmd.run();
    return true;
  }
  return false;
}
