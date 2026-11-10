// Shared app state: bridge config, node probe, workers, lock status, stack
// validation. Views keep their own local state (search text, form fields,
// op results).
import { createMemo, createSignal } from 'solid-js';
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
export const [workersUncommitted, setWorkersUncommitted] = createSignal<Set<string>>(new Set());
export const [workersError, setWorkersError] = createSignal<string | null>(null);
export const [lock, setLock] = createSignal<LockStatus>({ commit: null, rows: [] });
export const [busy, setBusy] = createSignal<string | null>(null);
export const [stack, setStack] = createSignal<StackReport | null>(null);

export const project = createMemo(() => config()?.project ?? null);
export const workerName = createMemo(() => config()?.worker ?? null);

async function guard<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  setBusy(label);
  try {
    return await fn();
  } finally {
    setBusy(null);
  }
}

// Startup: node_status → get_config → validate_stack → validate selected
// project → workers → lock. An unusable stack blocks the views (see
// StackSetup): every stack_run would fail without it.
export async function boot(): Promise<void> {
  try {
    const n = await nodeStatus();
    setNode(n);
    const c = await getConfig();
    // Older configs predate scanRoots; normalize so views can rely on it.
    if (!Array.isArray(c.scanRoots)) c.scanRoots = [];
    setConfig(c);
    setStack(await validateStack(c.stackPath));
    if (c.project) {
      try {
        setReport(await validateProject(c.project));
      } catch (err) {
        setReport({ path: c.project, valid: false, markers: [], errors: [errText(err)] });
      }
    }
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
  const proj = c.project ?? '.';
  let out: Awaited<ReturnType<typeof stackRun>> | null = null;
  try {
    out = await guard('workers', () =>
      stackRun('list', ['worker', '--json'], proj, c.stackPath),
    );
  } catch (err) {
    setWorkers([]);
    setWorkersError(errText(err));
    return;
  }
  if (!out) return;
  try {
    const data = fromStackOut<ListJson>(out);
    // Data-driven: worker names come from the stack, never hardcoded here.
    setWorkers(data.entries);
    setWorkersUncommitted(new Set<string>(data.uncommitted ?? []));
  } catch (err) {
    setWorkers([]);
    setWorkersUncommitted(new Set<string>());
    setWorkersError(errText(err));
  }
}

/** Re-validate the selected project (markers change after init). */
export async function refreshReport(): Promise<void> {
  const c = config();
  if (!c?.project) {
    setReport(null);
    return;
  }
  try {
    setReport(await validateProject(c.project));
  } catch (err) {
    setReport({ path: c.project, valid: false, markers: [], errors: [errText(err)] });
  }
}

export async function refreshLock(): Promise<void> {
  const c = config();
  if (!c?.project) {
    setLock({ commit: null, rows: [] });
    return;
  }
  let out: Awaited<ReturnType<typeof stackRun>> | null = null;
  try {
    out = await guard('status', () =>
      stackRun('status', ['--json'], c.project as string, c.stackPath),
    );
  } catch {
    setLock({ commit: null, rows: [] });
    return;
  }
  if (!out) return;
  try {
    setLock(toStatusRows(fromStackOut<StatusJson>(out)));
  } catch {
    setLock({ commit: null, rows: [] });
  }
}

/** Re-run stack validation (after the override changes) and refresh data. */
export async function revalidateStack(): Promise<void> {
  const c = config();
  if (!c) return;
  setStack(await validateStack(c.stackPath));
  await refreshWorkers();
  if (c.project) await refreshLock();
}

/** Folder-pick a stack checkout override, persist it, revalidate. */
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
  const next = { ...c, stackPath: dir };
  try {
    await guard('stack', () => saveConfig(next));
  } catch (err) {
    return errText(err);
  }
  setConfig(next);
  await revalidateStack();
  return null;
}

/** Clear the override (back to automatic lookup) and revalidate. */
export async function clearStackPath(): Promise<void> {
  const c = config();
  if (!c) return;
  const next = { ...c, stackPath: null };
  await guard('stack', () => saveConfig(next));
  setConfig(next);
  await revalidateStack();
}

export async function chooseWorker(name: string | null): Promise<void> {
  const c = config();
  if (!c) return;
  const next = { ...c, worker: name };
  await guard('worker', () => saveConfig(next));
  setConfig(next);
}

export async function chooseProject(path: string | null): Promise<void> {
  const c = config();
  if (!c) return;
  const next = { ...c, project: path };
  await guard('project', () => saveConfig(next));
  setConfig(next);
  if (path) {
    const [rep, cfg] = await Promise.all([
      validateProject(path).catch(
        (err): ProjectReport => ({ path, valid: false, markers: [], errors: [errText(err)] }),
      ),
      addRecentProject(path).catch(() => next),
    ]);
    setReport(rep);
    setConfig({ ...cfg, project: path });
    await refreshLock();
  } else {
    setReport(null);
    setLock({ commit: null, rows: [] });
  }
}

export async function saveScanRoot(scanRoot: string | null): Promise<void> {
  const c = config();
  if (!c) return;
  const next = { ...c, scanRoot };
  await guard('scan-root', () => saveConfig(next));
  setConfig(next);
}

export async function saveScanRoots(scanRoots: string[]): Promise<void> {
  const c = config();
  if (!c) return;
  const next = { ...c, scanRoots };
  await guard('scan-roots', () => saveConfig(next));
  setConfig(next);
}
