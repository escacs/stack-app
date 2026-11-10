# Stack desktop client

Desktop client for the [escacs/stack](https://github.com/escacs/stack)
library: a Tauri 2 app with a SolidJS + Vite renderer. Pitch black, mono,
minimal.

The stack lives in its own repo; this app shells out to its CLI
(`node <stack>/tools/stack/cli.mjs …`) and never reimplements the import
logic. You need both checkouts (anywhere — the app asks where the stack is
on first run).

## Prerequisites

- Node.js 22+ (`node --version`)
- Rust stable (`cargo --version`)
- An escacs/stack checkout (private repo; this app never bundles it)
- Linux webview deps (names as pkg-config sees them): `webkit2gtk-4.1`,
  `librsvg-2.0`, plus `patchelf` for bundling. On Debian/Ubuntu:
  `libwebkit2gtk-4.1-dev librsvg2-dev patchelf`
  (`libayatana-appindicator3-dev` only if a tray icon is added later).

## Run

```sh
npm install
npm run dev:app     # Tauri dev window (Vite on :1430)
```

Other scripts: `npm run dev` (Vite only), `npm run build`,
`npm run check` (`tsc --noEmit`), `npm test` (Rust unit tests),
`npm run build:app` (`tauri build --no-bundle`; never ship release bundles
from here).

On first run the app asks for the stack checkout (folder picker, remembered
in settings). It also honours the `ESCACS_STACK` env var — the same
convention as the stack repo's own setup docs.

## Tests

- `npm run test:ui` — vitest: CLI JSON shapes, parsers, router, flows.
- `npm run check` — `tsc --noEmit`.
- `npm test` — Rust unit tests (`cargo test --lib`).
- Full Rust suite, including the end-to-end shell-out test against a temp
  stack repo and temp project:
  `STACK_E2E_REPO=<stack-checkout> cargo test --manifest-path src-tauri/Cargo.toml`
  Without the var the e2e test skips itself (CI cannot reach the private
  stack repo, so it runs the lib tests only).

## Decision: shell out to the node CLI, not a sidecar

Stack ops (`import`, `status`, `update`, …) run as
`node <stack>/tools/stack/cli.mjs … --project <dir>` from Rust. Considered
alternative: a Tauri sidecar (bundled binary) or a Rust reimplementation of
the import logic.

Shell-out wins because:

1. Single source of truth. Import/status/update/remove plus the three-way
   merge live in the stack checkout's `tools/stack/*.mjs`. A sidecar or Rust
   port would fork that logic and drift; every CLI fix would need a matching
   app release.
2. Dependency-free tooling rule. The stack keeps tooling dependency-free; a
   sidecar means bundling a runtime or duplicating the logic in Rust.
   Shell-out reuses the user's node, which the stack already requires
   (`engines: node >= 22`).
3. The CLI already owns git and the import record (`stack.toml`). The app
   itself never runs git, never commits/pushes, and never executes project
   code.

Cost: node must be on PATH at runtime. Mitigated by the `node_status` probe
(call it at startup and show the error, which names the fix) — every
`stack_run` re-probes and fails with the same clear message.

Revisit if the app must run where node is absent (offline installs): the
fallback is packaging `tools/stack/` as a Node single-executable sidecar,
still without forking the logic.

## Bridge command surface

Call via `invoke` from `@tauri-apps/api/core`. All names are camelCase;
`stack_run`/`node_status` snake_case names are the command names, their
payloads are camelCase. Errors arrive as rejected strings — show them
verbatim, they are written for users.

| Command | Args | Returns |
|---|---|---|
| `pick_folder` | — | `string \| null` (null = cancelled) |
| `get_config` | — | `AppConfig` |
| `save_config` | `{ config: AppConfig }` | `null` |
| `add_recent_project` | `{ path: string }` | `AppConfig` (updated) |
| `validate_project` | `{ path: string }` | `ProjectReport` |
| `scan_projects` | `{ root?, roots?, stackDir? }` | `ScanOut` |
| `default_scan_roots` | `{ stackDir? }` | `ScanRoots` |
| `node_status` | — | `NodeStatus` |
| `stack_location` | `{ stackDir? }` | `StackLocation` |
| `validate_stack` | `{ stackDir? }` | `StackReport` |
| `stack_run` | `{ subcommand, args, projectDir, stackDir? }` | `{ stdout, stderr, code, truncated }` |

```ts
type AppConfig = {
  recentProjects: string[];   // most recent first, capped at 10
  stackPath: string | null;   // escacs/stack checkout; folder-picked
  scanRoot: string | null;    // where to look for projects
  worker: string | null;      // e.g. "mel"
  project: string | null;     // currently selected project dir
};
type ProjectReport = { path: string; valid: boolean; markers: string[]; errors: string[] };
type NodeStatus = { ok: boolean; version: string | null; major: number | null; error: string | null };
type ScanRepo = { path: string; name: string; hasLock: boolean; markers: string[] };
type ScanOut = { root: string; roots: string[]; repos: ScanRepo[]; capped: boolean };
type ScanRoots = { roots: string[]; stackPath: string | null };
type StackLocation = { path: string | null; source: 'settings' | 'env' | 'auto' | 'missing' };
type StackReport = { path: string; valid: boolean; source: string; git: boolean; cli: boolean; node: NodeStatus; error: string | null };
```

`stack_run` allowlist (enforced in Rust before any subprocess starts):

- Subcommands: `list`, `search`, `show`, `import`, `status`, `update`,
  `remove`, `sync` (restore ignored imports from the lock), `gitignore`
  (rewrite the managed escacs block), `init` (create `stack.toml`, adopting a
  legacy `stack.lock.json`). `sync`/`gitignore`/`init` take no args.
  Everything else (`serve`, `catalog`, `check`, `link-skills`, `path`, …) is
  rejected, so the UI cannot reach repo-maintenance commands.
- Flags: only `--kind <kind>`, `--to <project-relative-dir>` (single-entry
  `import` only), `--ref <rev>`. `--project` is always set by Rust itself and
  cannot be overridden.
- Entry ids are charset-checked; `--to` must be project-relative and is
  confined (traversal and symlink escapes rejected).
- `stackDir` resolution order: the settings override (persist in
  `config.stackPath`, folder-picked), the `ESCACS_STACK` env var, then an
  upward walk for `tools/stack/cli.mjs` (finds nothing in a normal install —
  first run must pick a folder or export the var).
- Output is capped at 4 MiB per stream (truncation marked via `truncated`).

Startup sequence suggestion: `node_status` → `get_config` → if
`config.project`, `validate_project` (+ `add_recent_project` on success).

Security contract (enforced in `src-tauri/src/`): operate only inside the
selected project dir + the stack dir; canonicalize and reject traversal and
symlinks escaping the project; never run project code; never git
commit/push; never put credentials anywhere (none are handled, none logged).

Capabilities (`src-tauri/capabilities/default.json`) grant only
`core:default` and `dialog:allow-open`. Custom `invoke` commands need no
capability entries; adding a plugin call later means adding its permission.

## Vendored web style (snapshot, not shared source)

`web-vendor/style.css` is a point-in-time copy of the stack website's
`web/style.css` (source commit in its header). The two repos split, so the
old live alias is gone: re-copy the file to re-sync, never edit the
snapshot in place. The website's `web/app.js` stays a read-only behavior
reference; catalog data reaches the desktop through `stack_run`
(`list`/`search`/`show --json`), never by importing website code.

## UI verification without the native shell

Per the stack repo's `skills/mock-bridge-ui-verification`:

```sh
npm run build
mkdir -p /tmp/stack-app-verify && cp -r dist/* /tmp/stack-app-verify/
# inject the mock before the app bundle, then serve from the temp dir:
cd /tmp/stack-app-verify && python3 -I -m http.server 8137 --bind 127.0.0.1
```

Open `http://127.0.0.1:8137/#populated` (`#empty`, `#no-node`, `#fresh` for
other scenarios). `dev/mock-bridge.js` and `dev/mock-app-bridge.js` mirror
the wire types above; when they change, update both in the same change. Label
results "fixture check" — a mock never proves the real runtime. Screenshots
and scratch stay in `/tmp`, never the repo.

## Layout

```text
package.json vite.config.ts tsconfig.json index.html
web-vendor/style.css            # snapshot of the stack website's stylesheet
dev/mock-bridge.js dev/mock-app-bridge.js
src/                             # SolidJS renderer
src-tauri/
  Cargo.toml build.rs tauri.conf.json Cargo.lock
  capabilities/default.json
  src/{main,lib,config,paths,project,scan,stack}.rs
  tests/stack_e2e.rs
.github/workflows/check.yml
```

Pinned versions follow the stack's `libraries/tauri` and
`libraries/solid-js` entries; config adapted from its
`templates/solid-tauri-vite` (single entry, normal window, no android mode).
`Cargo.lock` is committed — it is what pins the crates.

## App icon regeneration

The icons in `src-tauri/icons/` were rasterized from the stack checkout's
`assets/escacs-mark/escacs-app-icon.svg` and generated with the Tauri CLI.
Verbatim commands (scratch lives in `/tmp`, never the repo):

```sh
node /tmp/escacs-icon/rasterize.mjs
./node_modules/.bin/tauri icon /tmp/escacs-icon/icon-1024.png
```

Key chrome args inside `rasterize.mjs` (generate.mjs pattern +
transparency):

```text
--no-sandbox --disable-gpu --hide-scrollbars --font-render-hinting=none --default-background-color=00000000 --force-device-scale-factor=1 --window-size=1024,1024 --screenshot=/tmp/escacs-icon/icon-1024.png file:///tmp/escacs-icon/icon.html
```

(`icon.html` wraps the SVG full-bleed 1024x1024; chrome binary:
`~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`.)
NOTE: without `--default-background-color=00000000` the screenshot flattens
to RGB with white corners — the flag is required.

## First-run manual smoke checklist (needs a display)

Run `npm run dev:app` from the repo root on a machine with a display, then:

1. Pick a worker: open `worker`, choose a profile, confirm the top-bar `who`
   switcher shows it after a relaunch.
2. Pick a project: open `project`, browse to a folder with a `.git` dir,
   confirm the markers row lists it.
3. Init a plain folder: pick a folder with no `stack.toml`, open `status`,
   confirm the setup section offers `init stack.toml`, press it, confirm
   `stack.toml` plus the managed `.gitignore` block appear.
4. Import a skill: open `browse`, search `file-pr`, open the entry, press
   `import`, confirm the result lists the new `.agents/skills/…` path.
5. Check the `.gitignore` block: open the project's `.gitignore`, confirm a
   managed escacs block covers the imported paths.
6. Edit a file, then status: change one line in the imported skill, open
   `status`, confirm the row reads `edited` with the file named.
7. Update: commit a change to that entry in the stack checkout, press
   `update` in `status`, confirm the row returns to `imported` (or shows a
   `CONFLICT` section naming the file when both sides changed it).
