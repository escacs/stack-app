# Stack desktop client

Desktop client for the [escacs/stack](https://github.com/escacs/stack)
library: a Tauri 2 app with a SolidJS + Vite renderer. Pitch black, mono,
minimal.

The stack lives in its own repo; this app shells out to its CLI
(`node <stack>/tools/stack/cli.mjs …`) and never reimplements the import
logic. You need both checkouts (anywhere — the app asks where the stack is
when it cannot find one).

## Using the app

- [docs/USAGE.md](docs/USAGE.md): the screens, keys, row states, actions,
  where settings live, troubleshooting, and the browser preview.
- [docs/INSTALL.md](docs/INSTALL.md): installing the AppImage, webview and
  node prerequisites, stack provisioning, uninstalling.
- [docs/UPDATES.md](docs/UPDATES.md): how the app updates itself and how a
  release is cut.
- [docs/PORTABILITY.md](docs/PORTABILITY.md): distro and glibc support.

## Prerequisites

- Node.js 22+ (`node --version`)
- Rust stable (`cargo --version`)
- An escacs/stack checkout (private repo; this app never bundles it)
- Linux webview deps (names as pkg-config sees them): `webkit2gtk-4.1`,
  `librsvg-2.0`, plus `patchelf` for bundling. Per-distro install lines
  (Debian/Ubuntu, Fedora, Arch) are in
  [docs/INSTALL.md](docs/INSTALL.md#prerequisites).

## Run

```sh
npm install
npm run dev:app     # Tauri dev window (Vite on :1430)
```

Other scripts: `npm run dev` (Vite only), `npm run build`,
`npm run check` (`tsc --noEmit`), `npm test` (Rust unit tests),
`npm run build:app` (`tauri build --no-bundle`; never ship release bundles
from here).

On first run the app asks who you are and which project to open. It asks for
the stack checkout only when it cannot find one; the folder picker saves the
choice in settings. The `ESCACS_STACK` env var is honoured too, the same
convention as the stack repo's own setup docs. See
[docs/USAGE.md](docs/USAGE.md#stack-checkout).

## Tests

- `npm run test:ui` — vitest (node environment): CLI JSON shapes, parsers,
  router, onboarding, browse data, argument building, site helpers.
- `npm run check` — `tsc --noEmit`.
- `npm test` — Rust unit tests (`cargo test --lib`).
- Full Rust suite, including the end-to-end shell-out test against a temp
  stack repo and temp project:
  `STACK_E2E_REPO=<stack-checkout> cargo test --manifest-path src-tauri/Cargo.toml`
  Without the var the e2e test skips itself (CI cannot reach the private
  stack repo, so it runs the lib tests only).

## Decision: shell out to the node CLI, not a sidecar

Stack ops (`list`, `show`, `import`, `status`, `update`, …) run as
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
(called at startup; the setup screen shows its error, which names the fix) —
every `stack_run` re-probes and fails with the same clear message.

Revisit if the app must run where node is absent (offline installs): the
fallback is packaging `tools/stack/` as a Node single-executable sidecar,
still without forking the logic.

## Bridge command surface

Call via `invoke` from `@tauri-apps/api/core`. All names are camelCase;
`stack_run`/`node_status` snake_case names are the command names, their
payloads are camelCase. Errors arrive as rejected strings — show them
verbatim, they are written for users. The typed wrappers live in
`src/bridge.ts`.

| Command | Args | Returns |
|---|---|---|
| `pick_folder` | — | `string \| null` (null = cancelled) |
| `get_config` | — | `AppConfig` |
| `save_config` | `{ config: AppConfig }` | `null` |
| `add_recent_project` | `{ path: string }` | `AppConfig` (updated) |
| `validate_project` | `{ path: string }` | `ProjectReport` |
| `scan_projects` | `{ root?, roots?, stackDir? }` | `ScanOut` |
| `default_scan_roots` | `{ stackDir? }` | `ScanRoots` (wrapper exists; no current view calls it) |
| `node_status` | — | `NodeStatus` |
| `stack_location` | `{ stackDir? }` | `StackLocation` (wrapper exists; no current view calls it) |
| `validate_stack` | `{ stackDir? }` | `StackReport` |
| `stack_run` | `{ subcommand, args, projectDir, stackDir? }` | `{ stdout, stderr, code, truncated }` |

```ts
type AppConfig = {
  recentProjects: string[];   // most recent first, capped at 10
  stackPath: string | null;   // escacs/stack checkout override (folder-picked)
  scanRoot: string | null;    // extra scan root; no UI control, edit config.json
  scanRoots: string[];        // more scan roots; save_config stores them verbatim
  worker: string | null;      // e.g. "mel"; a label only, never sent to the stack
  project: string | null;     // currently selected project dir
  notice: string | null;      // set when get_config quarantined a corrupt config.json to config.json.bad; never persisted
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
  `remove`, `sync`, `gitignore`, `init`, `preset` (`list`, `show <name>`,
  `apply <name>`). `sync` and `gitignore` take no args; `init` takes only
  `--json`. Everything else (`serve`, `catalog`, `check`, `remote`,
  `link-skills`, `path`, …) is rejected, so the UI cannot reach
  repo-maintenance commands.
- Flags: `--kind` (search), `--to <project-relative-dir>` (single-entry
  import), `--ref` (import, status, update), `--file` (show), `--dry-run`
  (preset apply), `--offline` (list, search, show, status; the app appends it
  to `show` and `status`), `--json` (passed through). `--project` is always
  set by Rust itself and cannot be overridden.
- Entry ids are charset-checked; `--to` is joined onto the project and
  confined (traversal, absolute paths and symlink escapes rejected).
- `stackDir` resolution order: the settings override (`config.stackPath`,
  folder-picked), the `ESCACS_STACK` env var, then an upward walk for
  `tools/stack/cli.mjs` from the app's executable, the folder it was built in,
  and the working folder (finds nothing in a normal install — first run must
  pick a folder or export the var).
- Output is capped at 4 MiB per stream (truncation marked via `truncated`).

Startup sequence (`boot()` in `src/store.ts`): `node_status` → app version →
`get_config` → `validate_stack` → `validate_project` (if `config.project`) →
`stack_run list worker` → `stack_run status` (if a project is set and node is
ok). An unusable stack blocks the views until it is fixed (setup screen).

Security contract (enforced in `src-tauri/src/`): operate only inside the
selected project dir + the stack dir; canonicalize and reject traversal and
symlinks escaping the project; never run project code; never git
commit/push; never put credentials anywhere (none are handled, none logged).

Capabilities (`src-tauri/capabilities/default.json`) grant `core:default`,
window minimize / toggle-maximize / close, `dialog:allow-open`,
`updater:default` and `process:allow-restart`. App-defined `invoke` commands
need no capability entries; each plugin call needs its permission.

## Presets

Presets are named import plans that the stack keeps in `presets/*.toml`. They
live at the bottom of the project page (`src/views/Presets.tsx`), one row
per preset: name, description, import counts against the lock, and `preview`
/ `apply` buttons. `preview` runs `preset apply <name> --dry-run --json`
and expands what would land where and what is already imported, without
writing anything. `apply` runs `preset apply <name> --json` through the
project page's op runner (`src/views/Project.tsx`), so its busy state and
result share the rows' log. Apply refuses exactly like import: nothing is
written when a target file differs.

Wire shapes (`--json`):

- `preset list`: `{command:'preset', action:'list', count, presets:[{name, description, imports:[{id, to}]}]}`
- `preset apply <name>`: `{command:'preset', action:'apply', preset, commit, imported:[{id, path, requiredBy?}], already, gitignore}`, plus `dryRun:true` and `conflicts` on a `--dry-run` only. A real apply renders through `describePresetApply`, a preview through `describePresetPreview` (`src/json.ts`).
- `preset show <name>` is allowlisted but no current view calls it.

## Vendored web style (snapshot, not shared source)

`web-vendor/style.css` is a point-in-time copy of the stack website's
`web/style.css` (source commit in its header). The two repos split, so the
old live alias is gone: re-copy the file to re-sync, never edit the
snapshot in place. The website's `web/app.js` stays a read-only behavior
reference; catalog data reaches the desktop through `stack_run`
(`list`/`show --json`), never by importing website code.

## UI verification without the native shell

Plain browser checks against the mock bridge: POSIX sh and `python3`, no
bash script. The mock is invented fixture data, so a pass proves the UI
logic, not the native runtime.

```sh
npm run build
out=$(mktemp -d)
cp -r dist/. "$out/"
cp dev/mock-app-bridge.js "$out/mock-bridge.js"
python3 -c 'import sys; p=sys.argv[1]; s=open(p,encoding="utf-8").read(); open(p,"w",encoding="utf-8").write(s.replace("<head>","<head><script src=\"/mock-bridge.js\"></script>",1))' "$out/index.html"
python3 -I -m http.server 8137 --bind 127.0.0.1 --directory "$out"
```

Open `http://127.0.0.1:8137/#<scenario>,/<route>`, for example
`#conflicts,/project`. `dev/mock-app-bridge.js` reads the scenario from the
hash: `populated` (default), `empty`, `noworker`, `noproject`, `scan`,
`conflicts`, `missing`, `lookalike`, `fresh`, `bad-stack`, `no-node`. A
`+update-available` or `+update-error` suffix on any scenario drives the
footer updater fixture (invented 0.1.9, emulated startup event and
download progress). Reload the page to switch scenario; a hash-only change
keeps the old fixture. `docs/USAGE.md` §8 lists what each one shows.

The mock cannot exercise the native folder picker or real file writes, its
`plugin:app|version` answer (0.1.0) is not the release version, and relaunch
is a silent no-op. Label results "fixture check".

`dev/mock-bridge.js` is an older, minimal mock with three scenarios. When a
wire type changes, update both mocks in the same change.

## Layout

```text
package.json vite.config.ts tsconfig.json index.html
web-vendor/style.css            # snapshot of the stack website's stylesheet
dev/mock-bridge.js dev/mock-app-bridge.js
src/                             # SolidJS renderer
  index.tsx App.tsx app.css ui.tsx site.tsx glide.ts
  bridge.ts store.ts updater.ts router.ts onboard.ts
  browseData.ts stackArgs.ts json.ts parse.ts
  views/
    Onboard.tsx StackSetup.tsx TopBar.tsx TitleBar.tsx
    Browse.tsx Project.tsx Presets.tsx Updates.tsx
  *.test.ts                      # vitest, node environment
src-tauri/
  Cargo.toml build.rs tauri.conf.json Cargo.lock
  capabilities/default.json
  src/{main,lib,config,paths,project,scan,stack}.rs
  tests/stack_e2e.rs
docs/                            # INSTALL, UPDATES, PORTABILITY, USAGE
scripts/                         # install, provision, uninstall (AppImage)
flatpak/                         # draft manifest, not validated
.github/workflows/check.yml release.yml flatpak.yml
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

Use a stack checkout with a committed entry such as `skills/file-pr`. Run
`npm run dev:app` on a machine with a display, then (screens are described in
[docs/USAGE.md](docs/USAGE.md)):

1. Who: with no saved user (delete `config.json`, see
   [USAGE §6](docs/USAGE.md#6-where-things-are-stored)), pick a worker from
   the who screen, relaunch, and confirm the top bar shows it.
2. Project: `browse folder` on the project screen, pick a folder with a `.git`
   dir, and confirm the top bar shows its path.
3. Project set-up: in a folder with no `stack.toml`, confirm the project
   page opens with the set-up slot on top, press `init stack.toml`, and
   confirm `stack.toml` and the managed `.gitignore` block exist.
4. Browse import: search `file-pr`, open the entry, leave `--to` empty, press
   `import`, and confirm `.agents/skills/file-pr` is listed and gains a row
   on the project page. The project's `.gitignore` covers it.
5. Edited row: change one line in the imported `SKILL.md`; the row reads
   `edited` with `SKILL.md` named.
6. Update: commit a change to that entry in the stack, press `update`, and
   confirm the row returns to `imported`. If both sides changed the same
   file, it has `<<<<<<<` markers and is listed under `conflicts`.
7. Remove keeps edits: press `remove` on the edited row, confirm
   `kept (edited here)` and that the file is still on disk.
