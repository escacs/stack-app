// Dev-only mock of the Tauri bridge for app/. Loaded before the app bundle
// when verifying the UI in a plain browser (see ../README.md). Never imported
// by app code, never bundled. Invented fixture data only.
//
// Scenarios via location.hash: #empty, #populated (default), #no-node.
// (The richer app/dev/mock-app-bridge.js covers more scenarios and the full
// CLI surface; this one stays minimal but must match the same wire types.)
(() => {
  "use strict";
  const scenario = (location.hash || "#populated").slice(1).split(",")[0];

  const FULL = "b51359bfffffffffffffffffffffffffffffffff";

  const baseConfig = {
    recentProjects: [],
    stackPath: "/home/dev/escacs/stack",
    scanRoot: "/home/dev/projects",
    scanRoots: [],
    worker: "mel",
    project: null,
    notice: null,
  };

  const okStack = {
    path: "/home/dev/escacs/stack",
    valid: true,
    source: "settings",
    git: true,
    cli: true,
    node: { ok: true, version: "v22.14.0", major: 22, error: null },
    error: null,
  };

  const fixtures = {
    empty: {
      config: { ...baseConfig, scanRoot: null, worker: null },
      report: (path) => ({ path, valid: true, markers: [], errors: [] }),
      node: { ok: true, version: "v22.0.0", major: 22, error: null },
      stack: structuredClone(okStack),
      lock: [],
    },
    populated: {
      config: {
        ...baseConfig,
        recentProjects: ["/home/dev/projects/folio", "/home/dev/projects/auralis"],
        project: "/home/dev/projects/folio",
      },
      report: (path) => ({
        path,
        valid: true,
        markers: ["stack.toml", ".agents/skills", "package.json", ".git"],
        errors: [],
      }),
      node: { ok: true, version: "v22.14.0", major: 22, error: null },
      stack: structuredClone(okStack),
      lock: [
        { id: "skills/file-pr", commit: FULL, path: ".agents/skills/file-pr", local: [], upstream: [], gone: false },
      ],
    },
    noproject: {
      config: {
        ...baseConfig,
        recentProjects: ["/home/dev/projects/folio", "/home/dev/projects/sandbox"],
      },
      report: (path) => ({ path, valid: true, markers: [".git"], errors: [] }),
      node: { ok: true, version: "v22.14.0", major: 22, error: null },
      stack: structuredClone(okStack),
      lock: [],
    },
    "no-node": {
      config: { ...baseConfig },
      report: (path) => ({ path, valid: false, markers: [], errors: ["cannot resolve path"] }),
      node: {
        ok: false,
        version: null,
        major: null,
        error: "node was not found on PATH. Install Node.js 22 or newer, then relaunch the app.",
      },
      stack: {
        path: "/home/dev/escacs/stack", valid: false, source: "settings",
        git: true, cli: true,
        node: { ok: false, version: null, major: null, error: "node was not found on PATH." },
        error: "node was not found on PATH. Install Node.js 22 or newer, then relaunch the app.",
      },
      lock: [],
    },
  };

  const fx = fixtures[scenario] ?? fixtures.populated;
  const json = (v) => ({ stdout: JSON.stringify(v, null, 2), stderr: "", code: 0, truncated: false });
  const err = (stderr) => ({ stdout: "", stderr, code: 1, truncated: false });

  const stackRouter = ({ subcommand: sub, args = [] }) => {
    if (!fx.node.ok) return err("node 22+ is required (fixture: no-node scenario)");
    const positional = args.filter((a) => a !== "--json" && a !== "--");
    if (sub === "list" || sub === "search") {
      return json({ command: sub, kind: null, count: 0, entries: [], uncommitted: [] });
    }
    if (sub === "show") return err(`no entry "${positional[0]}"; search first, or list with \`stack list\``);
    if (sub === "preset") {
      const [action, name] = positional;
      if (action === "list") return json({ command: "preset", action: "list", count: 0, presets: [] });
      if (action === "show") return err(`no preset "${name}" (minimal fixture mock)`);
      if (action === "apply") return err(`cannot apply preset "${name}" (minimal fixture mock)`);
      return err(`unknown preset action "${action}" (minimal fixture mock)`);
    }
    if (sub === "status") return json({ command: "status", commit: FULL, rows: structuredClone(fx.lock) });
    if (sub === "init") {
      if (fx.lock.length) return err("stack.toml already tracks imports; nothing to do");
      return json({ command: "init", migrated: false, entries: 0, gitignore: "unchanged" });
    }
    if (sub === "sync") return json({ command: "sync", restored: [], kept: [], skipped: [] });
    if (sub === "gitignore") {
      return { stdout: "gitignore: managed block up to date (fixture)", stderr: "", code: 0, truncated: false };
    }
    return err(`unknown subcommand "${sub}" (minimal fixture mock)`);
  };

  const handlers = {
    pick_folder: async () => "/home/dev/projects/folio",
    get_config: async () => structuredClone(fx.config),
    save_config: async ({ config }) => {
      fx.config = structuredClone(config);
      return null;
    },
    add_recent_project: async ({ path }) => {
      fx.config.recentProjects = [path, ...fx.config.recentProjects.filter((p) => p !== path)].slice(0, 10);
      return structuredClone(fx.config);
    },
    validate_project: async ({ path }) => fx.report(path),
    project_folders: async () => ({ folders: [] }),
    node_status: async () => ({ ...fx.node }),
    // Release version the footer shows (mirrors tauri.conf in the real app).
    "plugin:app|version": async () => "0.1.0",
    stack_run: async (a) => stackRouter(a),
    scan_projects: async ({ root, roots } = {}) => {
      const picked = roots?.length ? roots : root ? [root] : ["/home/dev/projects"];
      return { root: picked[0], roots: picked, repos: [], capped: false };
    },
    default_scan_roots: async () => ({ roots: ["/home/dev/projects"], stackPath: "/home/dev/escacs/stack" }),
    stack_location: async () => fx.stack.valid
      ? { path: fx.stack.path, source: fx.stack.source }
      : { path: null, source: "missing" },
    validate_stack: async () => structuredClone(fx.stack),
    // Provisioning fixtures stay settled: the old mock has no setup screen.
    provision_stack: async () => ({ status: "kept", path: "/home/dev/escacs/stack", message: "already at ~/escacs/stack" }),
    stack_cli_status: async () => ({ status: "linked-ok", link: "~/.local/bin/stack", expected: "~/escacs/stack/bin/stack", actual: "~/escacs/stack/bin/stack", onPath: true, message: "the stack command is linked." }),
    link_stack_cli: async () => ({ status: "linked-ok", link: "~/.local/bin/stack", expected: "~/escacs/stack/bin/stack", actual: "~/escacs/stack/bin/stack", onPath: true, message: "the stack command is linked." }),
  };

  // Deterministic reloads per scenario.
  try {
    localStorage.setItem("stack:mock-scenario", scenario);
  } catch {
    /* private mode: ignore */
  }

  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      const fn = handlers[cmd];
      if (!fn) {
        console.warn(`[mock-bridge] unknown command: ${cmd}`);
        return null;
      }
      return fn(args);
    },
    // No-op event surface; the shell currently emits no events.
    listen: async () => () => {},
    emit: async () => {},
  };
})();
