// Typed wrapper over the Tauri bridge (see README.md "Bridge command
// surface"). In a plain browser the dev mock (dev/mock-app-bridge.js)
// provides window.__TAURI_INTERNALS__, so invoke() works unchanged.
import { invoke } from '@tauri-apps/api/core';
import { withOffline } from './stackArgs';

export type AppConfig = {
  recentProjects: string[];
  stackPath: string | null;
  scanRoot: string | null;
  /** Extra scan roots beyond scanRoot; round-tripped verbatim by save_config. */
  scanRoots: string[];
  worker: string | null;
  project: string | null;
  /** One-line notice when get_config recovered from a corrupt file, else null. Never persisted. */
  notice: string | null;
};

export type ProjectReport = {
  path: string;
  valid: boolean;
  markers: string[];
  errors: string[];
};

/** Project-relative folders that could be unimported stack entries. */
export type ProjectFolders = { folders: string[] };

export type NodeStatus = {
  ok: boolean;
  version: string | null;
  major: number | null;
  error: string | null;
};

export type StackOut = { stdout: string; stderr: string; code: number; truncated: boolean };

export type ScanRepo = { path: string; name: string; hasLock: boolean; markers: string[] };

export type ScanOut = { root: string; roots: string[]; repos: ScanRepo[]; capped: boolean };

export type ScanRoots = { roots: string[]; stackPath: string | null };

export type StackLocation = { path: string | null; source: 'settings' | 'env' | 'auto' | 'missing' };

export type StackReport = {
  path: string;
  valid: boolean;
  source: string;
  git: boolean;
  cli: boolean;
  node: NodeStatus;
  /** Exactly one actionable message when valid is false, else null. */
  error: string | null;
};

/** Outcome of in-app provisioning: kept / cloned-gh / cloned-ssh, or manual with the one actionable error. */
export type ProvisionReport = {
  status: 'kept' | 'cloned-gh' | 'cloned-ssh' | 'manual';
  path: string | null;
  message: string;
};

/** State of the ~/.local/bin/stack link. bin-not-on-PATH means linked but off PATH. */
export type CliStatus = {
  status: 'linked-ok' | 'missing' | 'points-elsewhere' | 'foreign-file' | 'bin-not-on-PATH';
  link: string;
  expected: string;
  actual: string | null;
  onPath: boolean;
  message: string;
};

export const pickFolder = (): Promise<string | null> => invoke('pick_folder');

export const getConfig = (): Promise<AppConfig> => invoke('get_config');

export const saveConfig = (config: AppConfig): Promise<null> =>
  invoke('save_config', { config });

export const addRecentProject = (path: string): Promise<AppConfig> =>
  invoke('add_recent_project', { path });

export const validateProject = (path: string): Promise<ProjectReport> =>
  invoke('validate_project', { path });

/** Folders that could be stack entries imported by hand (adopt suggestions). */
export const projectFolders = (path: string): Promise<ProjectFolders> =>
  invoke('project_folders', { path });

export const nodeStatus = (): Promise<NodeStatus> => invoke('node_status');

export function stackRun(
  subcommand: string,
  args: string[],
  projectDir: string,
  stackDir?: string | null,
): Promise<StackOut> {
  return invoke('stack_run', {
    subcommand,
    args: withOffline(subcommand, args),
    projectDir,
    ...(stackDir ? { stackDir } : {}),
  });
}

/**
 * Scan configured roots for project folders (depth 1, stack.toml holders
 * first, 200-result cap). Explicit roots win; with neither, the shell scans its
 * defaults (stack parent plus ~/Projects, ~/dev, ~/code when they exist).
 * Explicit roots fail loudly; default roots are best-effort.
 */
export function scanProjects(opts: {
  root?: string | null;
  roots?: string[];
  stackDir?: string | null;
}): Promise<ScanOut> {
  return invoke('scan_projects', {
    ...(opts.root ? { root: opts.root } : {}),
    ...(opts.roots?.length ? { roots: opts.roots } : {}),
    ...(opts.stackDir ? { stackDir: opts.stackDir } : {}),
  });
}

/** Default scan roots without scanning (for the settings UI). */
export function defaultScanRoots(stackDir?: string | null): Promise<ScanRoots> {
  return invoke('default_scan_roots', { ...(stackDir ? { stackDir } : {}) });
}

/** Where the stack checkout resolves from (never throws). */
export function stackLocation(stackDir?: string | null): Promise<StackLocation> {
  return invoke('stack_location', { ...(stackDir ? { stackDir } : {}) });
}

/**
 * First-run validation: the dir must be a git checkout with HEAD, contain
 * tools/stack/cli.mjs, and node 22+ must be present.
 */
export function validateStack(stackDir?: string | null): Promise<StackReport> {
  return invoke('validate_stack', { ...(stackDir ? { stackDir } : {}) });
}

/**
 * Provision the stack checkout from the app (same steps as
 * scripts/provision-stack.sh): keep an existing checkout, else gh clone,
 * else batch-mode ssh clone. Never throws: failure is status manual.
 */
export const provisionStack = (): Promise<ProvisionReport> => invoke('provision_stack');

/** Where the stack command link stands (never changes anything). */
export function stackCliStatus(stackDir?: string | null): Promise<CliStatus> {
  return invoke('stack_cli_status', { ...(stackDir ? { stackDir } : {}) });
}

/**
 * Link ~/.local/bin/stack at the checkout's bin/stack. Never replaces a
 * non-symlink or a link to something else (reports instead).
 */
export function linkStackCli(stackDir?: string | null): Promise<CliStatus> {
  return invoke('link_stack_cli', { ...(stackDir ? { stackDir } : {}) });
}

// Bridge errors arrive as rejected strings (real shell) or nulls (mock
// miss). Normalize to a displayable message.
export function errText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return String(err ?? 'unknown bridge error');
}
