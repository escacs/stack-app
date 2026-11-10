// Shared app state: bridge config, node probe, workers, lock status, stack
// validation. Views keep their own local state (search text, form fields,
// op results).
import { createMemo, createSignal } from 'solid-js';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import {
  addRecentProject,
  errText,
  getConfig,
  nodeStatus,
  pickFolder,
  saveConfig,
  stackRun,
  validateProject,
  validateStack,
  type AppConfig,
  type NodeStatus,
  type ProjectReport,
  type StackReport,
} from './bridge';
import {
  fromStackOut,
  type JsonEntry,
  type ListJson,
  type StatusJson,
} from './json';
import { toStatusRows } from './json';
import type { LockStatus } from './parse';

export const [config, setConfig] = createSignal<AppConfig | null>(null);
export const [node, setNode] = createSignal<NodeStatus | null>(null);
export const [bootError, setBootError] = createSignal<string | null>(null);
export const [report, setReport] = createSignal<ProjectReport | null>(null);
export const [workers, setWorkers] = createSignal<JsonEntry[]>([]);
// False until the first worker list settles (or fails): the who screen must
// not read "no workers" before the stack has been asked.
export const [workersLoaded, setWorkersLoaded] = createSignal(false);
export const [workersError, setWorkersError] = createSignal<string | null>(null);
export const [lock, setLock] = createSignal<LockStatus>(emptyLock());
// Why the last `status` read failed (null when it worked). The installed view
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
// Last failed user action (a save, a bad project path, a stack re-check).
// Rendered once by App as a conflict line; cleared by the next action.
export const [actionError, setActionError] = createSignal<string | null>(null);

export const project = createMemo(() => config()?.project ?? null);
export const workerName = createMemo(() => config()?.worker ?? null);

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
    await guard(label, () => saveConfig(next));
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
    // Stack, report and workers land before the config: the shell gates on
    // config, so it must never render against a half-loaded state.
    const s = await validateStack(c.stackPath);
    setStack(s);
    if (c.project) setReport(await checkProject(c.project));
    setConfig(c);
    if (!s.valid) return;
    await refreshWorkers();
    if (c.project && n.ok) await refreshLock();
  } catch (err) {
    setBootError(errText(err));
  }
}

export async function refreshWorkers(): Promise<void> {
  const c = config();
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

export async function refreshLock(): Promise<void> {
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
    const out = await guard('status', () => stackRun('status', ['--json'], proj, c.stackPath));
    rows = toStatusRows(fromStackOut<StatusJson>(out));
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
  return setStackOverride({ ...c, stackPath: dir });
}

/** Clear the override (back to automatic lookup) and revalidate. */
export async function clearStackPath(): Promise<void> {
  const c = config();
  if (!c) return;
  const err = await setStackOverride({ ...c, stackPath: null });
  if (err) setActionError(err);
}

/** Set (or clear) the remembered user. Failure keeps the previous user. */
export async function chooseWorker(name: string | null): Promise<void> {
  const c = config();
  if (!c) return;
  setActionError(null);
  const next = { ...c, worker: name };
  const err = await persist('worker', next);
  if (err) {
    setActionError(err);
    return;
  }
  setConfig(next);
}

/** Back to the who screen: forget the user, even a skipped one. */
export async function switchWorker(): Promise<void> {
  setWorkerSkipped(false);
  await chooseWorker(null);
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
    const err = await persist('project', next);
    if (err) {
      setActionError(err);
      return;
    }
    setReport(null);
    setLock(emptyLock());
    setConfig(next);
    return;
  }
  const rep = await checkProject(path);
  if (!rep.valid) {
    setActionError(rep.errors[0] ?? `${path} is not a usable project folder.`);
    return;
  }
  const next = { ...(config() ?? c), project: path };
  const err = await persist('project', next);
  if (err) {
    setActionError(err);
    return;
  }
  // The bridge returns the saved config with the path added to recents.
  const cfg = await addRecentProject(path).catch(() => next);
  setReport(rep);
  setLock(emptyLock());
  setConfig({ ...cfg, project: path });
  await refreshLock();
}
