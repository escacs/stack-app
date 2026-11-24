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

/**
 * Adopt picker: native dialog starting in the project, confined to it. The
 * shell returns the project-relative folder, null on cancel, or a short
 * rejection (outside the project, not a folder).
 */
export const pickAdoptFolder = (projectDir: string): Promise<string | null> =>
  invoke('pick_adopt_folder', { projectDir });

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

/** One project file for the review-changes diff (read-only, confined to the project). */
export type ProjectFile = {
  exists: boolean;
  size: number;
  binary: boolean;
  /** Over the read cap: size only, no text. */
  truncated: boolean;
  text: string | null;
};

export const readProjectFile = (projectDir: string, path: string): Promise<ProjectFile> =>
  invoke('read_project_file', { projectDir, path });

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

export type T3Status = {
  available: boolean;
  version: string | null;
  error: string | null;
};

export type WorktreeInfo = {
  path: string;
  branch: string | null;
  detached: boolean;
  isMain: boolean;
  isT3: boolean;
  hasLock: boolean;
  isCurrent: boolean;
};

export type T3ThreadInfo = {
  threadId: string;
  title: string;
  status: string;
  provider: string | null;
  model: string | null;
  branch: string | null;
  worktreePath: string | null;
  link: string | null;
  updatedAt: string | null;
};

export type T3WorkspaceReport = {
  t3Available: boolean;
  t3Version: string | null;
  t3Error: string | null;
  registered: boolean;
  mainRoot: string;
  worktrees: WorktreeInfo[];
  threads: T3ThreadInfo[];
};

export type T3ThreadActionResult = {
  threadId: string;
  title: string | null;
  link: string | null;
  status: string | null;
};

export const t3Workspace = (projectDir: string): Promise<T3WorkspaceReport> =>
  invoke('t3_workspace', { projectDir });

export const t3SendThread = (threadId: string, message: string): Promise<T3ThreadActionResult> =>
  invoke('t3_send_thread', { threadId, message });

export function t3StartThread(opts: {
  projectDir: string;
  message: string;
  title?: string | null;
  worktree?: string | null;
  branch?: string | null;
}): Promise<T3ThreadActionResult> {
  return invoke('t3_start_thread', {
    projectDir: opts.projectDir,
    message: opts.message,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.worktree ? { worktree: opts.worktree } : {}),
    ...(opts.branch ? { branch: opts.branch } : {}),
  });
}

// Bridge errors arrive as rejected strings (real shell) or nulls (mock
// miss). Normalize to a displayable message.
export function errText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return String(err ?? 'unknown bridge error');
}
