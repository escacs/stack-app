# Using stack

Contents: [what it is](#1-what-it-is) · [before you start](#2-before-you-start) ·
[first run](#3-first-run) · [browse](#4-browse) · [installed](#5-installed) ·
[where things are stored](#6-where-things-are-stored) ·
[troubleshooting](#7-troubleshooting) · [preview without the app](#8-preview-without-the-native-shell)

Sketches are the app's rendered text, with the layout simplified. Names such
as `file-pr` come from the sample stack used for previews.

## 1. What it is

Stack is the desktop client for the escacs/stack library. It lists the
entries the stack holds (skills, styles, components and so on), imports the
ones you pick into a project folder, and keeps track of what it imported so
you can update, remove or re-sync them later. Every stack operation runs the
stack's own CLI with `--json`; the app contains no import logic.

It never runs `git commit` or `git push`, never runs code from your project,
and never writes project files itself. The stack CLI writes them, inside the
project folder you picked. The app writes only its own settings file.

## 2. Before you start

- Node.js 22 or newer on `PATH`. The app checks at startup and shows a
  message if node is missing or too old.
- An escacs/stack checkout: a git clone with a `HEAD` commit and
  `tools/stack/cli.mjs`. The stack repo is private; the app never bundles it.
- The install docs cover Linux. The AppImage also needs FUSE 2 and the
  WebKitGTK 4.1 runtime.

Install, provisioning and uninstall: [docs/INSTALL.md](INSTALL.md).
Update channel and release process: [docs/UPDATES.md](UPDATES.md).

## 3. First run

The app asks two questions before it shows the views:

```
open → choose who → choose project → browse + installed
```

If no usable stack checkout is found, the setup screen comes first.
See [stack checkout](#stack-checkout).

### who

Lists the workers in the stack (its `worker` entries). Pick one.

```
who?

> 1 mel
  2 yuno

↑↓ enter
```

| key | does |
|---|---|
| `↑` `↓` or `j` `k` | move the cursor |
| `Enter` | pick the row under the cursor |
| `1`–`9` | pick that row at once |

If the stack lists no workers, the screen shows `(._.) none` and
`continue without one`. If the list fails, it shows the error with `retry`
and `continue without one`. Skipping lasts for this session only.

The user is only a label. The top bar shows it; the stack commands never
receive it.

### project

```
project

browse folder

recent
> 1 /home/dev/projects/folio
  2 /home/dev/projects/sandbox

↑↓ enter

scan

‹ mel
```

| control | does |
|---|---|
| `browse folder` | opens the system folder picker |
| `recent` rows | open a project; same keys as who. Up to 10, newest first |
| `scan` | lists the folders one level down in the scan roots (see below) |
| `open` (scan result) | selects that folder as the project |
| `Escape` or `‹ <name>` | back to who |

A path that does not exist or is not a folder is refused, and the message
stays on this screen. The markers in scan results and in the project
(`stack.toml`, `.git`, `package.json` and so on) are existence checks. The app
reads and runs nothing inside the project.

Scan roots are the `scanRoot` and `scanRoots` settings if set. Otherwise
they are the parent of the stack checkout plus `~/Projects`, `~/dev` and
`~/code`, when those exist. A scan result says `has imports` when the folder
has a `stack.toml`, `plain folder` when it has no markers, and otherwise lists
the markers it has.

### Switching later

- Click the user name in the top bar: back to who.
- Click the project path in the top bar: back to project. The project is
  unset until you pick another one.

### Stack checkout

When the stack cannot be used, the views are replaced by this screen:

```
no escacs/stack checkout found: looked upward from the app, its install
folder and the working folder for tools/stack/cli.mjs. Pick your stack clone
in settings (the folder containing tools/stack/cli.mjs).

pick stack folder   re-check
```

The app looks for the checkout in this order:

1. The folder saved in settings (`stackPath`). Set by `pick stack folder`
   here, or `change` in installed.
2. The `ESCACS_STACK` environment variable.
3. A search upward from the app's executable, from the folder it was built
   in, and from the working folder, for `tools/stack/cli.mjs`. A normal
   install finds nothing this way.

`pick stack folder` takes the folder that contains `tools/stack/cli.mjs`.
`re-check` runs the checks again. A saved folder wins over `ESCACS_STACK`.

A picked folder is checked before it is saved. An invalid pick is refused
with the reason shown on this screen and is not remembered, so the app never
blocks on a bad folder at the next launch. This screen has no `auto` button;
`auto` in installed only appears once the app is usable.

### Top bar and footer

```
browse / installed                        mel  …/projects/folio
```

- `browse` and `installed` switch views. The current one is marked.
- While an operation runs, its name and `…` appear before the user name.
- `(x_x)` appears when node is not usable. Hover it for the message.
- The user and project buttons go back to who and project (see above).

Footer, bottom of the window: the app version, then `→ <version> available`
when the startup check found a newer release, then `N update` or
`N updates` when installed imports have changes waiting. The last two link
to installed.

Any other route shows `(o_O) not found`.

## 4. Browse

Browse is the stack's catalog. The prompt line shows where you are, and the
search box follows it.

```
~/skills/file-pr  ›  type to search
```

### Home

```
~ ›

★ skills        ████████████████████   3
● styles        ███████·············   1
■ systems       ███████·············   1
◆ components    █████████████·······   2
▶ libraries     ███████·············   1
♥ assets        ███████·············   1
▲ templates     ███████·············   1
☻ workers       █████████████·······   2
~ all                                 12

(^_^) stable 6   (o_O) experimental 6   (x_x) deprecated 0
★ custom 12      ☆ imported 0
```

Each kind row opens that kind. `all` lists every entry.

The sprite marks the kind: `★` skill, `●` style, `■` system, `◆` component,
`▶` library, `♥` asset, `▲` template, `☻` worker. A filled sprite means the
entry's origin is `custom`, a hollow one means `imported`. That is the
entry's origin in the stack, not what your project imported.

### Kind views

```
~/skills ›

★ file-pr      (^_^)  2f 219b
★ ponytail     (o_O)  2f 219b
```

Each row shows the name, the status face, and the file count and size. A
`not-committed` or `uncommitted-in-stack` marker may follow the name (see
[import](#import)). Components are grouped by library, as
`components/react`, with a member count and `default` if it is the default
library.

### all

Every entry, in kind order. Rows show full ids (`skills/file-pr`).

### Search

Type anywhere: the first letter focuses the search box. A search matches
substrings of the name, tags, id, summary and targets, across all kinds.
Words are matched separately. An entry needs at least one match, and more
matches rank it higher. A name match counts most.

```
~ › pr

★ skills/file-pr       (^_^)  2f 219b
▲ templates/agents-md  (^_^)  4f 451b      ← "project" in the summary
```

Search runs in the app over the catalog list; it does not call the CLI's
`search`.

### Entry page

```
★ ponytail  (o_O)

Lazy senior dev mode: the smallest change that fully solves the task.

usage    link
size     2 files, 219b
targets  any
tags     ponytail, fixture

files
ponytail/
├─ README.md  109b
└─ stack.json 110b
```

From top to bottom, the page shows:

1. Title, status face and the summary.
2. `not committed in the stack: can't import` when the entry is not in the
   stack's HEAD commit.
3. `imported → <path>` when this project already imported it.
4. Details: usage, size, targets, tags, `requires`, `related`, `cited by`
   and `upstream` (source URL, ref, license, `modified`) when present.
5. The import row, when the entry is committed and not imported yet.
6. The result of the last import or a refusal.
7. Up to four image previews.
8. The file tree, then the open file.

### Files and docs

Click a file in the tree, or move to it with the arrows and press `Enter`.
Its body appears under its path:

- Markdown is rendered. Links to other entries open in the app. External
  links open in a browser window.
- Other text files are shown as they are.
- Images are shown inline.
- Binary files show their size and `binary … — open it from the checkout.`

### Import

```
import
[--to                    ]  [import]
```

- Leave `--to` empty and the CLI chooses the place. Skills and styles go to
  `.agents/skills/<name>`, with a `.claude/skills` link. Other entries go to
  `.stack/<id>`. Components go to `.stack/components/<library>/<name>`.
- Fill `--to` with a folder inside the project, such as `src/components/ui`.
  Absolute paths and paths that leave the project are refused, including
  through symlinks.
- An import writes nothing if a target file already exists with different
  content. The app then shows the files and says so:

  ```
  untracked look-alikes, nothing written:

  .agents/skills/file-pr/SKILL.md
  .agents/skills/file-pr/helpers.mjs
  ```

  Move those files, pick another `--to`, or delete them if they are yours to
  drop. A file with identical content is not a conflict.
- An entry that is not in the stack's HEAD commit cannot be imported.
  Commit it in the stack checkout first.
- `uncommitted-in-stack` means the stack's working tree has changes for the
  entry. Imports read the committed version, not the working tree.
- Each import is recorded in `stack.toml`. A successful import lists what
  landed:

  ```
  imported 1 entry

  skills/ponytail → vendored/ponytail
  ```

  Entries pulled in by `requires` show `(required by …)`. Entries already
  here show under `already here`. A `.gitignore` line shows when the managed
  block changed.

### Keys in Browse

| key | does |
|---|---|
| `↑` `↓` | move the cursor over rows: home rows, list rows, file tree |
| `Enter` | open the cursor row. With a search and no cursor, open the first result |
| `Escape` | clear the search. Otherwise go up one level: file → entry → kind → home |
| `Space` | scroll down about 80% of a page, when the search box is empty |
| letter or digit | focus the search box and type into it |

Clicking a row or link does the same as moving to it and pressing `Enter`.
`j` and `k` are not bound in browse.

## 5. Installed

Shows what this project imported from the stack. It needs a project.

```
imported  skills/file-pr        @b51359b → .agents/skills/file-pr        remove
imported  styles/folio-light    @b51359b → .agents/skills/folio-light    remove
imported  workers/mel           @b51359b → .stack/workers/mel            remove

sync @b51359b

adopt…

presets
web   React starter: button plus the file-pr skill.       apply
docs  Docs setup: conventions plus the agents-md scaffold. apply

stack /home/dev/escacs/stack   change   auto
app 0.1.0   check
0.1.0
```

Rows with upstream changes look like this:

```
update    skills/file-pr        @a1b2c3d → .agents/skills/file-pr        update  remove
          2 files changed upstream
          edited: SKILL.md

update    templates/agents-md   @a1b2c3d → .                             update  remove
          1 file changed upstream

update all   sync @b51359b
```

The `@…` value is the stack commit the import was made from.

### Row states

| state | when | sub-line |
|---|---|---|
| `imported` | the files match the import and the stack has no newer content for them | none |
| `edited` | at least one file differs from the import, or is missing | `edited: <files>` |
| `update` | the stack's HEAD has different content for at least one file | `N files changed upstream` |
| `gone` | the entry no longer exists at the stack's HEAD | `removed from stack` |

The chip shows the first matching state in this order: `gone`, `update`,
`edited`, `imported`. A row can be `update` and still list `edited:` files.
A deleted file counts as edited; `sync` restores it.

### Actions

| control | shows when | does | does not |
|---|---|---|---|
| `update` | row is `update` | three-way merge of the row's files to the stack's HEAD. Overlapping edits get `<<<<<<<` markers, and the file is listed under `conflicts` | does not drop your edits; does not run for `gone` rows |
| `update all` | any row is `update` | the same for every row | |
| `remove` | every row | deletes the import's unedited files and its entry in `stack.toml` | does not delete edited files; they are listed as `kept (edited here)` |
| `sync` | any row | restores imported files that are missing, at the commit recorded in `stack.toml` | never overwrites an edit; does not move to newer content (that is `update`) |
| `init stack.toml` | no rows, and no `stack.toml` in the project | creates `stack.toml` and the managed `.gitignore` block. A legacy `stack.lock.json` is migrated and removed | imports nothing |
| `adopt…` | always | a form for an entry id, such as `skills/file-pr`, and an optional `--to`. It runs the same import as Browse | differing files are listed and nothing is written |
| preset `apply` | a preset exists | imports every row of that preset, each with its `--to` | refuses like import when files differ |
| `change` | always | picks another stack checkout and saves it | |
| `auto` | a folder is saved | clears the saved folder: back to automatic lookup | |

Use `adopt…` for a folder that holds an entry's files but was never
imported. Identical files join the record. If any file differs, the app
lists it and writes nothing.

Each action shows its result under the rows, as titled sections. A failed
action shows the CLI's error text as it is. Only one action runs at a time;
the other buttons are disabled meanwhile. Every action re-reads the rows when
it ends.

### Presets

Presets are named import plans. The stack defines them in its
`presets/*.toml` files. Each row here is one preset. Its `apply` imports all
of the preset's rows, the same way `import` does. Hover `apply` to see what
it imports. Rows do not expand.

### Stack checkout

The line under the rows shows the checkout in use. `change` picks another
folder and saves it as the override. `auto` appears only when an override is
saved, and removes it.

### App updates

- At startup the app checks the release feed once, in the background. A
  newer version shows in the footer as `→ <version> available`. A failed
  startup check is written to the terminal only.
- `check` runs a check now. It shows `up to date`, or the error text.
- `install` appears when a newer version is known. It downloads with
  progress, checks the signature, and installs. Then `relaunch` appears.
- Self-update on Linux works for the AppImage. Development builds can check
  but cannot install over themselves. See [docs/UPDATES.md](UPDATES.md).

## 6. Where things are stored

### App settings

One file: `config.json`, in the app's config folder. On Linux that is
`~/.config/codes.escacs.stack/config.json`, or under `$XDG_CONFIG_HOME` when
that is set.

| key | holds |
|---|---|
| `worker` | the user picked in who (`null` when skipped) |
| `project` | the selected project folder |
| `recentProjects` | up to 10 project folders, newest first |
| `stackPath` | the saved stack checkout. `null` means automatic lookup |
| `scanRoot`, `scanRoots` | extra folders for `scan`. The app has no control for these; edit the file |

The file holds no credentials and no catalog data.

To reset:

- Everything: quit the app and delete `config.json`. The next launch starts
  at who, with automatic stack lookup.
- Only the stack folder: `auto` in installed, or set `stackPath` to `null`.
- `scripts/uninstall-stack-app.sh --config` also forgets the stack path and
  recent projects. See [docs/INSTALL.md](INSTALL.md#appimage).

### Project files

The CLI writes into the project: `stack.toml` (the record of what was
imported, and at which commit), the managed escacs block in `.gitignore`,
the imported files, and the `.claude/skills` link for skills.

You decide what to commit. The app does not run git.

### Caches and session state

- Remote component libraries are cached by the stack CLI, in
  `$ESCACS_STACK_CACHE`, or else `$XDG_CACHE_HOME/escacs-stack/remotes`
  (default `~/.cache/escacs-stack/remotes`).
- The catalog list, previews and the last operation's output live in memory
  for the session. The app writes none of them to disk.

### Where the data comes from

Every view decodes the CLI's `--json` output:

| view | stack command |
|---|---|
| who | `list worker` |
| browse: list | `list` (online, so new remote members appear) |
| browse: entry | `show <id>`, and `show <id> --file <path>` for file bodies |
| installed rows | `status` |
| presets | `preset list`; `preset apply <name>` |
| import, adopt | `import` |
| update, update all | `update` |
| remove, sync, init | `remove`, `sync`, `init` |

The app adds `--offline` to `show` and `status`, which never need the
network. `list` stays online. A failed command shows its error text: the
CLI's stderr, or its stdout if stderr is empty.

## 7. Troubleshooting

| symptom | cause | what to do |
|---|---|---|
| `node was not found on PATH` | node is not installed, or not on the app's `PATH` | install Node.js 22+ from nodejs.org or a version manager, then relaunch |
| `node 22+ is required, found vX` | node is too old | install a newer node, then relaunch |
| `node --version printed nothing (exit N): …` | node starts but dies before printing a version. Typical cause: an AppImage that was relaunched from another instance (the updater, or starting it from inside the app) inherits the previous instance's `/tmp/.mount_*` library dirs, whose bundled `libffi` shadows the system one. The message carries node's first stderr line and which `node` was tried | the app drops AppImage mount entries from `LD_LIBRARY_PATH` up front. If node still prints nothing it retries once with the same entries also dropped from `LD_PRELOAD`, `LD_AUDIT` and `PATH` and the AppImage's own variables removed; your own entries stay. `re-check` and picking a folder probe node again. A persistent message means the `node` on `PATH` is broken itself: reinstall it, or fix the version-manager shim. Quitting every running instance and starting one fresh also clears an inherited mount |
| setup screen shows only a node message (no folder named) | node fails while the checkout itself is fine | fix node, then `re-check`. The folder is not the problem |
| `no escacs/stack checkout found` | no saved folder, no `ESCACS_STACK`, nothing found upward | `pick stack folder`, or export `ESCACS_STACK` and `re-check` |
| `… is not a usable stack checkout: tools/stack/cli.mjs is missing` | the saved or env folder is not the clone | pick the folder that contains `tools/stack/cli.mjs` |
| a picked folder is refused with `… is not a usable stack checkout` | the app validates a folder before saving it, so a bad pick is never remembered | pick the clone instead |
| `… it is not a git checkout with a HEAD commit` | the folder has no `.git` with a `HEAD` | clone the stack, or pick the clone |
| component libraries missing from browse | the CLI could not sync a remote library and has no cache. It prints a `warning:` line to stderr, and the app drops stderr on success. Not verified in the app: this row comes from reading the CLI source | in the stack checkout: `node tools/stack/cli.mjs remote sync <library>` |
| offline | network down | `show` and `status` do not need the network. `list` syncs remote libraries first and falls back to their cache when the sync fails |
| `check` shows an error | no network, or the release feed is not reachable (the repo must be public) | read the message; retry later. Startup failures show only in the terminal |
| `nothing listed`, `(._.) none` | the stack has no entries of that kind, or the list is empty | check the checkout: `node tools/stack/cli.mjs list` in the stack folder |
| `untracked look-alikes, nothing written:` | target files exist with different content | move them, pick another `--to`, or delete them. Identical files are fine |
| `not committed in the stack: can't import` | the entry is only in the stack's working tree | commit it in the stack checkout, then retry |
| `cannot resolve path` or `path is not a directory` | the project path is gone or is a file | pick the folder again |
| `(o_O) not found` | a route the app does not have | use `browse` or `installed` in the top bar |

## 8. Preview without the native shell

For UI work in a browser, the app can run on a mock of its native bridge.
Each mock scenario is a fixture stack, project and user. Fixture data is
invented. The mock cannot show the folder picker, the update feed, or
persistent settings. Details and build steps are in the README:
[UI verification without the native shell](../README.md#ui-verification-without-the-native-shell).

Open the built app with the scenario in the hash: `#<scenario>,/<route>`.
Routes are `browse`, `browse/<kind>`, `browse/all`, `browse/<id>`,
`browse/<id>/<file>` and `installed`.

| scenario | what it shows |
|---|---|
| `populated` (default) | a project with three imports; one entry not committed; one with uncommitted stack changes |
| `empty` | who, with two workers |
| `noworker` | who, with no workers: `continue without one` leads to browse |
| `noproject` | project, with recent projects |
| `scan` | project, with a scan root set. Press `scan` to list |
| `conflicts` | installed with `update` rows and a conflict |
| `missing` | installed with rows whose files are missing (shown as `edited`) |
| `lookalike` | an import refused for `skills/file-pr` |
| `fresh` | installed in a plain folder: `init stack.toml` |
| `bad-stack` | the stack checkout setup screen; get stack clones and the gate lifts |
| `no-node` | the setup screen with node missing |
| `no-auth` | the setup screen with no GitHub auth: get stack fails with the one actionable error |
| `no-cli` | a valid stack whose command is not linked: the quiet [add stack command] line |
| `cli-foreign` | the quiet line when something else owns the `stack` name (no offer) |
| `no-path` | the quiet line when the bin dir is off PATH (no offer) |
