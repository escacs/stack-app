// Shared app state: bridge config, node probe, workers, lock status, stack
// validation. Views keep their own local state (search text, form fields,
// op results).
import { createSignal } from 'solid-js';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import {
  addRecentProject,
  errText,
  getConfig,
  linkStackCli,
  nodeStatus,
  pickFolder,
  readProjectFile,
  provisionStack,
  saveConfig,
  stackCliStatus,
  stackRun,
  validateProject,
  validateStack,
  type AppConfig,
  type NodeStatus,
  type ProjectReport,
  type ProvisionReport,
  type StackReport,
} from './bridge';
import {
  fromStackOut,
  type JsonEntry,
  type ListJson,
  type StatusJson,
} from './json';
import { lacksMissing, toStatusRows, withMissing } from './json';
import { href, parseHash } from './router';
import { rowState, type LockStatus } from './parse';
import { clearT3Workspace, refreshT3Workspace, t3Info } from './t3';
import { reconcileRemembered } from './onboard';
import { pushToast } from './toast';
import { humanizeCliError, oneSentence, cliStatusText, provisionText } from './humanize';
import { retargetToast } from './undo';

export const [config, setConfig] = createSignal<AppConfig | null>(null);
export const [node, setNode] = createSignal<NodeStatus | null>(null);
export const [bootError, setBootError] = createSignal<string | null>(null);
// One-line notice when get_config recovered from a corrupt config.json
// (renamed aside to config.json.bad). Rendered once by App.
export const [configNotice, setConfigNotice] = createSignal<string | null>(null);
export const [report, setReport] = createSignal<ProjectReport | null>(null);
export const [workers, setWorkers] = createSignal<JsonEntry[]>([]);
// False until the first worker list settles (or fails): the who screen must
// not read "no workers" before the stack has been asked.
export const [workersLoaded, setWorkersLoaded] = createSignal(false);
export const [workersError, setWorkersError] = createSignal<string | null>(null);
export const [lock, setLock] = createSignal<LockStatus>(emptyLock());
// Why the last `status` read failed (null when it worked). The project page
// shows it instead of a misleading "nothing imported".
export const [lockError, setLockError] = createSignal<string | null>(null);
export const [busy, setBusy] = createSignal<string | null>(null);
export const [stack, setStack] = createSignal<StackReport | null>(null);
// Release version from tauri.conf (matches the GitHub release tag minus
// the `v`). Null until boot resolves it (or when the bridge lacks it).
export const [appVersion, setAppVersion] = createSignal<string | null>(null);
// Newer release found by the startup check (event name must match
// UPDATE_AVAILABLE_EVENT in src-tauri/src/lib.rs). Null when up to date.
export const [appUpdate, setAppUpdate] = createSignal<string | null>(null);
// First-run onboarding: set when the user continues past "who" without a
// worker (empty stack or failed list). Session-only.
export const [workerSkipped, setWorkerSkipped] = createSignal(false);
// The worker and project are remembered across launches (config.json), so
// these start true once boot has reconciled them; they go false only while
// the user switches (the remembered answer stays preselected, and cancel
// just flips them back).
export const [whoDone, setWhoDone] = createSignal(true);
export const [projectDone, setProjectDone] = createSignal(true);
// Last failed user action (a save, a bad project path, a stack re-check).
// Rendered once by App as a conflict line; cleared by the next action.
export const [actionError, setActionError] = createSignal<string | null>(null);
// One quiet dismissible line about the `stack` terminal command: set after
// provisioning/picking (what the auto-link did) and at boot when a valid
// stack's command is not linked. offerLink adds the [add stack command]
// button; conflicts and plain reports dismiss with [x] only.
export type CliNote = { text: string; offerLink: boolean };
export const [cliNote, setCliNote] = createSignal<CliNote | null>(null);

export function dismissCliNote(): void {
  setCliNote(null);
}

let linkingCli = false;

/** Link the stack command from the quiet line's [add stack command] button. */
export async function addStackCommand(): Promise<void> {
  // Double-click guard: the first call owns the link (the shell also maps
  // a lost link race to a fresh status re-read, never a raw error).
  if (linkingCli) return;
  const c = config();
  if (!c) return;
  linkingCli = true;
  try {
    const l = await guard('stack command', () => linkStackCli(c.stackPath));
    setCliNote(l.status === 'linked-ok' ? null : { text: cliStatusText(l), offerLink: false });
  } catch (err) {
    setCliNote({ text: oneSentence(humanizeCliError(errText(err))), offerLink: false });
  } finally {
    linkingCli = false;
  }
}

/** Force the stack setup screen over a working stack (the "Open stack setup" action). */
export const [showSetup, setShowSetup] = createSignal(false);

/** Imports that need a look: update available, edited or missing files. */
export const attentionCount = (): number => lock().rows.filter((r) => rowState(r) !== 'imported').length;

export const project = (): string | null => config()?.project ?? null;
export const workerName = (): string | null => config()?.worker ?? null;

function emptyLock(): LockStatus {
  return { commit: null, rows: [] };
}

// Labels of the operations in flight; the newest one names the busy text.
// A stack, not a single label, so a finishing op never clears another's.
const inflight: string[] = [];

async function guard<T>(label: string, fn: () => Promise<T>): Promise<T> {
  inflight.push(label);
  setBusy(label);
  try {
    return await fn();
  } finally {
    inflight.splice(inflight.lastIndexOf(label), 1);
    setBusy(inflight[inflight.length - 1] ?? null);
  }
}

/**
 * Save the config. Returns the error text on failure (the caller keeps its
 * previous config and decides where the message shows), null on success.
 */
async function persist(label: string, next: AppConfig): Promise<string | null> {
  try {
    // The worker and the project are remembered. A retargeted worktree is a
    // temporary target, so the project saved is the one the user opened.
    await guard(label, () => saveConfig({ ...next, project: homeProject }));
    return null;
  } catch (err) {
    return errText(err);
  }
}

/** Validate a project path; a bridge failure becomes an invalid report. */
async function checkProject(path: string): Promise<ProjectReport> {
  try {
    return await validateProject(path);
  } catch (err) {
    return { path, valid: false, markers: [], errors: [errText(err)] };
  }
}

// The project the user opened (what is remembered); the active target can
// differ while a worktree is retargeted.
let homeProject: string | null = null;

let booted = false;

// Startup: node_status → get_config → validate_stack → validate selected
// project → workers → lock. An unusable stack blocks the views (see
// StackSetup): every stack_run would fail without it. Runs once per session:
// the update listener must not be registered twice.
export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    const n = await nodeStatus();
    setNode(n);
    try {
      setAppVersion(await getVersion());
    } catch {
      setAppVersion(null);
    }
    try {
      await listen<{ version: string }>('stack://update-available', (e) => {
        setAppUpdate(e.payload.version);
      });
    } catch {
      // Plain-browser fixture has no event bridge; the badge just never fires.
    }
    const c = await getConfig();
    // Older configs predate scanRoots; normalize so views can rely on it.
    if (!Array.isArray(c.scanRoots)) c.scanRoots = [];
    setConfigNotice(c.notice ?? null);
    // Stack, report and workers land before the config: the shell gates on
    // config, so it must never render against a half-loaded state. The
    // remembered worker and project are checked here, so a stale one shows
    // only its own onboarding step and the rest opens straight in.
    const s = await validateStack(c.stackPath);
    setStack(s);
    let workerNames: string[] | null = null;
    if (s.valid) {
      await refreshWorkers(c);
      if (!workersError()) workerNames = workers().map((w) => w.name);
    }
    const rep = c.project ? await checkProject(c.project) : null;
    const kept = reconcileRemembered({
      worker: c.worker,
      project: c.project,
      workerNames,
      projectValid: rep ? rep.valid : null,
    });
    c.worker = kept.worker;
    c.project = kept.project;
    homeProject = c.project;
    if (kept.droppedWorker || kept.droppedProject) {
      void persist('config', c);
      if (kept.droppedProject) {
        pushToast({ tone: 'warning', title: 'Last project is unavailable', description: kept.droppedProject });
      } else if (kept.droppedWorker) {
        pushToast({ tone: 'warning', title: `Worker ${kept.droppedWorker} is no longer in this stack`, description: 'Pick a worker to continue.' });
      }
    }
    setReport(c.project && rep?.valid ? rep : null);
    setConfig(c);
    if (!s.valid) return;
    // A valid stack whose `stack` command is not linked gets one quiet line
    // offering to add it. Advisory only: never blocks boot.
    try {
      const cli = await stackCliStatus(c.stackPath);
      if (cli.status !== 'linked-ok') {
        // Only a missing link is fixable in-app; conflicts just explain.
        setCliNote({ text: cliStatusText(cli), offerLink: cli.status === 'missing' });
      }
    } catch {
      // No cli state (older shell, odd checkout): stay quiet.
    }
    if (c.project && n.ok) await refreshLock();
    if (c.project) void refreshT3Workspace(c.project);
  } catch (err) {
    setBootError(errText(err));
  }
}

export async function refreshWorkers(from?: AppConfig): Promise<void> {
  const c = from ?? config();
  if (!c) return;
  setWorkersError(null);
  setWorkersLoaded(false);
  try {
    const out = await guard('workers', () =>
      stackRun('list', ['worker', '--json'], c.project ?? '.', c.stackPath),
    );
    // Data-driven: worker names come from the stack, never hardcoded here.
    setWorkers(fromStackOut<ListJson>(out).entries);
  } catch (err) {
    setWorkers([]);
    setWorkersError(errText(err));
  } finally {
    setWorkersLoaded(true);
  }
}

/** Re-validate the selected project (markers change after init). */
export async function refreshReport(): Promise<void> {
  const proj = config()?.project ?? null;
  if (!proj) {
    setReport(null);
    return;
  }
  const rep = await checkProject(proj);
  // Ignore the answer if the project changed while validating.
  if (config()?.project === proj) setReport(rep);
}

let lockSeq = 0;

/**
 * Quiet refresh for the Project tab badge: on focus / visibility and every few
 * minutes. Skips while any operation runs (a read mid-import would lie) and
 * never shows the busy text.
 */
export async function backgroundRefresh(): Promise<void> {
  if (busy() !== null || inflight.length || !config()?.project || stack()?.valid === false) return;
  await refreshLock({ silent: true });
}

export async function refreshLock(opts: { silent?: boolean } = {}): Promise<void> {
  const c = config();
  const seq = ++lockSeq;
  const proj = c?.project ?? null;
  if (!c || !proj) {
    setLock(emptyLock());
    setLockError(null);
    return;
  }
  let rows: LockStatus;
  let err: string | null = null;
  try {
    const read = () => stackRun('status', ['--json'], proj, c.stackPath);
    const out = await (opts.silent ? read() : guard('status', read));
    const parsed = toStatusRows(fromStackOut<StatusJson>(out));
    // An older CLI counts a deleted file as a local change only; those rows are checked on disk.
    // Newer CLIs name each row's missing files; only an older CLI (no `missing` field) needs the file check.
    rows = lacksMissing(parsed.rows)
      ? { ...parsed, rows: await withMissing(parsed.rows, async (p) => (await readProjectFile(proj, p)).exists) }
      : parsed;
  } catch (e) {
    rows = emptyLock();
    err = errText(e);
  }
  // Drop the answer if a newer refresh started or the project changed.
  if (seq === lockSeq && config()?.project === proj) {
    setLock(rows);
    setLockError(err);
  }
}

/** Re-run stack validation (after the override changes) and refresh data. */
export async function revalidateStack(): Promise<void> {
  const c = config();
  if (!c) return;
  let s: StackReport;
  try {
    s = await validateStack(c.stackPath);
  } catch (err) {
    setActionError(errText(err));
    return;
  }
  setStack(s);
  if (s.valid) setShowSetup(false);
  if (!s.valid) {
    // Nothing can be asked of an unusable stack: drop what the old one said.
    setWorkers([]);
    setWorkersError(null);
    setWorkersLoaded(false);
    setLock(emptyLock());
    return;
  }
  await refreshWorkers();
  await refreshLock();
}

/** Save a stack override and revalidate. Returns the error text, or null. */
async function setStackOverride(next: AppConfig): Promise<string | null> {
  // A picked folder is checked before it is remembered: saving a bad one
  // would block the app on every launch until another is picked.
  if (next.stackPath) {
    try {
      const s = await validateStack(next.stackPath);
      if (!s.valid) return s.error ?? `${next.stackPath} is not a usable stack checkout.`;
    } catch (e) {
      return errText(e);
    }
  }
  const err = await persist('stack', next);
  if (err) return err;
  setConfig(next);
  await revalidateStack();
  return null;
}

/**
 * Folder-pick a stack checkout override, persist it, revalidate. Returns the
 * error text for the caller's notice (StackSetup) instead of the top bar.
 */
export async function chooseStackPath(): Promise<string | null> {
  const c = config();
  if (!c) return null;
  let dir: string | null = null;
  try {
    dir = await pickFolder();
  } catch (err) {
    return errText(err);
  }
  if (!dir) return null;
  const err = await setStackOverride({ ...c, stackPath: dir });
  if (err) return err;
  await autoLinkCli(dir, null);
  return null;
}

/**
 * Link the `stack` command after provisioning or picking a folder. Quiet
 * when already linked; otherwise one dismissible line says what happened
 * (linked, left alone, or off PATH). Never throws.
 */
async function autoLinkCli(stackDir: string | null, prefix: string | null): Promise<void> {
  try {
    const l = await guard('stack command', () => linkStackCli(stackDir));
    if (l.status === 'linked-ok') {
      // A fresh link gets its one quiet line; an already-correct link
      // stays silent (a provision prefix still shows on its own).
      const linked = l.message.startsWith('linked ') ? 'The `stack` command is now set up.' : null;
      const text = prefix && linked ? `${provisionText(prefix)} ${linked}` : (prefix ? provisionText(prefix) : linked);
      if (text) setCliNote({ text, offerLink: false });
      return;
    }
    setCliNote({ text: prefix ? `${provisionText(prefix)} ${cliStatusText(l)}` : cliStatusText(l), offerLink: false });
  } catch (err) {
    const why = oneSentence(humanizeCliError(errText(err)));
    setCliNote({ text: prefix ? `${provisionText(prefix)} ${why}` : why, offerLink: false });
  }
}

/**
 * Fetch the stack checkout from the setup screen (get stack). Returns the
 * error text for the caller's notice on failure, null on success (the
 * provision + link report lands on the quiet cli line instead, since the
 * setup screen unmounts).
 */
export async function provisionCheckout(): Promise<string | null> {
  const c = config();
  if (!c) return null;
  let r: ProvisionReport;
  try {
    r = await guard('get stack', () => provisionStack());
  } catch (err) {
    return errText(err);
  }
  if (!r || typeof r.status !== 'string') return errText(r);
  if (r.status === 'manual' || !r.path) return r.message;
  // Rust already pinned the path in the settings; mirror it locally so the
  // revalidation below (and the session) uses this checkout.
  setConfig({ ...c, stackPath: r.path });
  await revalidateStack();
  await autoLinkCli(r.path, r.message);
  return null;
}

/** Clear the override (back to automatic lookup) and revalidate. */
export async function clearStackPath(): Promise<void> {
  const c = config();
  if (!c) return;
  const err = await setStackOverride({ ...c, stackPath: null });
  if (err) setActionError(err);
}

/**
 * Set (or clear) the worker and remember it. The screen changes first; a
 * failed save surfaces as an error line and the worker still applies for
 * this session.
 */
export async function chooseWorker(name: string | null): Promise<void> {
  const c = config();
  if (!c) return;
  setActionError(null);
  const next = { ...c, worker: name };
  setWhoDone(name !== null);
  setWorkerSkipped(false);
  setConfig(next);
  const err = await persist('config', next);
  if (err) setActionError(err);
}

/** Continue past who without a user (empty stack or failed list). */
export function skipWorker(): void {
  setWorkerSkipped(true);
  setWhoDone(true);
}

/** Open the who step again (the pill, the palette). The current worker stays preselected and remembered until another is picked. */
export function switchWorker(): void {
  setWhoDone(false);
}

/** Leave the who step without changing the worker (Esc). Only when there is one to go back to. */
export function cancelSwitchWorker(): boolean {
  const c = config();
  if (!c?.worker && !workerSkipped()) return false;
  setWhoDone(true);
  return true;
}

/** Open the project step again; the current project stays remembered until another is picked. */
export function switchProject(): void {
  setProjectDone(false);
}

/** Leave the project step without changing the project (Esc). Only when there is one to go back to. */
export function cancelSwitchProject(): boolean {
  if (!config()?.project) return false;
  setProjectDone(true);
  return true;
}

/**
 * Select a project, or clear it with null (back to the project screen). An
 * invalid path is not selected: the validation error becomes actionError and
 * the current screen stays.
 */
export async function chooseProject(path: string | null): Promise<void> {
  const c = config();
  if (!c) return;
  setActionError(null);
  if (!path) {
    const next = { ...c, project: null };
    setReport(null);
    setLock(emptyLock());
    setProjectDone(false);
    clearT3Workspace();
    setConfig(next);
    return;
  }
  const rep = await checkProject(path);
  if (!rep.valid) {
    setActionError(rep.errors[0] ?? `${path} is not a usable project folder.`);
    return;
  }
  const next = { ...(config() ?? c), project: path };
  // The bridge returns the saved config with the path added to recents; the
  // session's worker stays, and the opened project is remembered below.
  const cfg = await addRecentProject(path).catch(() => next);
  homeProject = rep.path;
  void persist('config', { ...cfg, worker: next.worker, project: rep.path });
  // A mid-session config reset surfaces its notice here, as at boot.
  setConfigNotice(cfg.notice ?? null);
  setReport(rep);
  setLock(emptyLock());
  setProjectDone(true);
  setConfig({ ...cfg, worker: next.worker, project: rep.path });
  // Opening a project lands on the project page, whatever route was showing.
  location.hash = href(parseHash(location.hash).scenario, 'project');
  void refreshT3Workspace(rep.path);
  await refreshLock();
}

/**
 * Switch the active target folder to another worktree/branch of the current
 * repo without adding temporary worktree paths to recent projects or leaving
 * the current view.
 */
export async function switchTargetDir(path: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const c = config();
  if (!c || c.project === path) return;
  const from = c.project;
  setActionError(null);
  const rep = await checkProject(path);
  if (!rep.valid) {
    const msg = rep.errors[0] ?? `${path} is not a usable worktree folder.`;
    setActionError(msg);
    pushToast({ tone: 'error', title: 'Could not switch folders', description: oneSentence(humanizeCliError(msg)) });
    return;
  }
  const branch = t3Info()?.worktrees.find((w) => w.path === path || w.path === rep.path)?.branch ?? null;
  setReport(rep);
  setLock(emptyLock());
  setConfig({ ...(config() ?? c), project: rep.path });
  void refreshT3Workspace(rep.path);
  await refreshLock();
  if (opts.quiet) return;
  pushToast(retargetToast(branch ?? path, from, (back) => void switchTargetDir(back, { quiet: true })));
}
