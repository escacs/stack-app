// Tests for the dev-only mock bridge (dev/mock-app-bridge.js): it is never
// bundled, but every UI walk runs against it, so its CLI fidelity needs
// pinning — the import dry-run must plan the same auto-imports (requires
// included) as the real import path, without writing anything.
import { describe, expect, it, vi } from 'vitest';

type StackOut = { stdout: string; stderr: string; code: number };
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<StackOut>;

/** Load a fresh bridge for one scenario: the IIFE reads location.hash once and hangs invoke off window. */
async function loadBridge(scenario: string): Promise<Invoke> {
  vi.resetModules();
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {};
  g.location = { hash: `#${scenario},/browse` };
  g.localStorage = { setItem: () => {} };
  await import('./mock-app-bridge.js');
  const internals = (g.window as Record<string, unknown>).__TAURI_INTERNALS__ as { invoke: Invoke };
  return internals.invoke;
}

const PROJ = '/home/dev/projects/folio';

describe('mock import dry-run', () => {
  it('lists requires auto-imports like a real import, and writes nothing', async () => {
    const invoke = await loadBridge('batchimport');
    // button requires icon-button; neither is imported in this fixture.
    const dry = await invoke('stack_run', {
      subcommand: 'import',
      args: ['components/react/button', '--dry-run', '--json'],
      projectDir: PROJ,
    });
    expect(dry.code).toBe(0);
    const plan = JSON.parse(dry.stdout) as {
      dryRun: boolean;
      imported: { id: string; path: string; requiredBy?: string }[];
    };
    expect(plan.dryRun).toBe(true);
    expect(plan.imported).toEqual([
      { id: 'components/react/button', path: '.stack/components/react/button' },
      {
        id: 'components/react/icon-button',
        path: '.stack/components/react/icon-button',
        requiredBy: 'components/react/button',
      },
    ]);
    // A dry run writes nothing: the lock still holds only the fixture rows.
    const status = await invoke('stack_run', { subcommand: 'status', args: ['--json'], projectDir: PROJ });
    const rows = (JSON.parse(status.stdout) as { rows: { id: string }[] }).rows;
    expect(rows.map((r) => r.id).sort()).toEqual(['components/batch/avatar', 'skills/file-pr']);
  });

  it('counts a shared dep once across ids, like the real import', async () => {
    const invoke = await loadBridge('batchimport');
    const dry = await invoke('stack_run', {
      subcommand: 'import',
      args: ['components/react/button', 'components/react/icon-button', '--dry-run', '--json'],
      projectDir: PROJ,
    });
    expect(dry.code).toBe(0);
    const plan = JSON.parse(dry.stdout) as { imported: { id: string }[]; already: string[] };
    expect(plan.imported.filter((p) => p.id === 'components/react/icon-button')).toHaveLength(1);
    expect(plan.already).toEqual(['components/react/icon-button']);
  });
});
