# Using stack

Contents: [what it is](#1-what-it-is) · [before you start](#2-before-you-start) ·
[first run](#3-first-run) · [browse](#4-browse) · [project page](#5-project-page) ·
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
open → choose who → choose project → project page + browse
```

If no usable stack checkout is found, the setup screen comes first.
See [stack checkout](#stack-checkout).

Both answers are remembered. On the next launch the app opens straight into the
shell on the last route; a question only comes back for what is missing (the
worker is no longer in the stack, or the project folder is gone). To change
either, click the project or user half of the pill in the title bar (a small
menu offers recents, workers and "Switch…") or run **Switch project / Switch
worker** from the palette; Esc keeps what was set.

### Command palette, toasts and shortcuts

`Cmd/Ctrl+K` (or the **Commands** button in the title bar) opens the command
palette: type to filter, arrows and Enter to run, Esc to close. Commands that
cannot run right now stay listed, dimmed, with the reason. `?` lists every
shortcut; `/` still searches the catalog. Every change (import, remove,
update, sync, preset, retarget) shows a toast with the outcome; imports,
removes of clean rows, presets and retargets add **Undo**. Update, sync, init
and adopt have no true inverse, so their toasts carry no Undo. Removing,
updating or bulk-updating a row with local edits asks for confirmation first.

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

If the stack lists no workers, the screen shows `none` and
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
(the folder containing tools/stack/cli.mjs), or set ESCACS_STACK to it.

pick stack folder   re-check
```

The app looks for the checkout in this order:

1. The folder saved in settings (`stackPath`). Set by `pick stack folder`
   here.
2. The `ESCACS_STACK` environment variable.
3. A search upward from the app's executable, from the folder it was built
   in, and from the working folder, for `tools/stack/cli.mjs`. A normal
   install finds nothing this way.

`pick stack folder` takes the folder that contains `tools/stack/cli.mjs`.
`re-check` runs the checks again. A saved folder wins over `ESCACS_STACK`.

A picked folder is checked before it is saved. An invalid pick is refused
with the reason shown on this screen and is not remembered, so the app never
blocks on a bad folder at the next launch. When a folder is saved, `auto`
appears next to `re-check` and forgets it, back to the automatic lookup.
This screen is the only place that names the stack folder; everywhere else
it hides behind the version's tooltip in the footer.

### Title bar and sidebar

The title bar is the window frame (the OS frame is off): traffic-light
close, minimize and maximize buttons, the `stack` name, and, once first run
is done:

- **Project | Browse | Presets** in the centre switch views. The current one
  is raised. Opening a project lands on Project.
- On the right: a **Search** button (shown on every view except Browse, which
  has its own field; `/` does the same), the project and user split button
  (each half goes back to its first-run question), a `node missing` badge
  when node is not usable, and the **theme** button, which toggles light and
  dark. The choice is remembered on this machine; until you pick one the
  theme follows the system.
- While an operation runs, its name and `…` appear before the search.

The left sidebar lists the catalog kinds with counts on Browse, and the
project's tracked imports with their state on Project and Presets. Under it,
**Branches & worktrees** lists the project's git worktrees; the active
target is marked `Target`, and a click on another one retargets the app.
Narrow windows (under about 720px) fold the sidebar to a scrolling strip
of the first group.

The footer card at the bottom of the sidebar holds the app version and the
updater: `check for updates`, `checking…`, `up to date`, `<version>
available` with an install button, download progress, then relaunch.
Errors show short with the full text in a tooltip, plus retry. A line above
the card shows `N import updates` when project imports have changes waiting.
The version's tooltip names the stack checkout in use and where it came from
(settings, env or auto).

Any other route shows `not found`.

## 4. Browse

Browse is the stack's catalog as a **list** on the left and a **live preview**
on the right. The list has a **Search entries** field, a **refresh** button,
filter chips, a sort menu and one row per entry. The preview shows the entry
under the list cursor and follows it as you move (`j` `k`, arrows, a click):
nothing navigates. Nothing is focused when Browse opens: press `/` to search,
`Escape` to leave the field. Letters you type in the field are only text; the
single-key shortcuts below work everywhere else.

**refresh** (or `r`) re-reads the catalog from the stack checkout from
scratch, after the checkout changed out from under the app (a `git pull`, a
new skill, updated remotes), without restarting. It keeps the route, then says
`refreshed · 93 entries` (or shows the error inline, keeping the stale list).
It stays disabled while an import runs.

### The list

Each row shows the kind icon, the name over its one-line summary (search
matches are marked), the library or kind in small type, an `Imported` chip
when this project has it, a status chip (`stable`, `experimental`,
`deprecated`), and the file count and size. A `Not in stack` (red) or
`Stack edits` (amber) status may follow the name (see [import](#import)).
The list is a single listbox: `Tab` reaches it, the cursor row is announced
as the active option, and the preview is announced once when you pause (not
on every key).

- **Filter chips** — `Stable`, `Experimental`, `Custom` (the entry's origin in
  the stack), `Imported` and `Not imported` (this project). Each shows how many
  entries it would keep. Chips of the same kind widen each other (Stable +
  Experimental shows both); different kinds narrow (Stable + Custom).
- **Sort** — `Name`, `Size` (largest first), `Status` (stable first) or
  `Recently imported` (entries this app imported, newest first). While you
  search, results stay in relevance order and the menu is disabled.
- **Search** — `/` focuses the field. A search matches substrings of the name,
  tags, id, summary and targets, across the list in view. Words are matched
  separately; more matches rank higher, a name match counts most. `Escape`
  leaves the field and keeps the text; a second `Escape` clears it.
- **Kinds** — the sidebar's *Catalog kinds* narrow the list to one kind (a
  `Showing skills only · Show all kinds` line says so). A link to an entry
  (`#…/browse/skills/file-pr`) selects it among its kind; one that matches
  nothing says so and offers the whole catalog.
- **Import all N** above the list imports every not-imported entry in view
  (see [batch import](#batch-import)).

Empty, loading and error states are styled: a skeleton while the catalog
loads, `No entries match …` with **Clear filters**, and a retry on failure
(with the stale list kept when there is one).

### The preview

The preview is the entry card: a crumb line (kind, file count, and the target
branch while not imported), the title with its status chip, the summary, and
**Dry run** and **Import to &lt;branch&gt;** at the top right (or an
`Imported → <path>` pill once this project has it). Below:

1. `Not in the stack, so it can't be imported` when the entry is not in the
   stack's HEAD commit.
2. **Overview | Files (N)**, with the size and `in stack` (or `not in stack`) on the right.
   Overview shows the facts (Destination, Usage, Targets, Tags, Requires,
   Related, Cited by, Upstream) and the doc excerpt. Files shows up to four
   image previews, the file tree and the open file.
3. At the bottom, pinned, the
   [T3 Code tray](#t3-code-branches-and-thread-injection) when T3 Code is
   available.

`Enter` moves focus into the preview; `Escape` returns to the list. Under 900px
wide the preview becomes a full-screen detail with **Back to list**.

### Files and docs

Click a file in the tree. Its body appears under its path:

- Markdown is rendered. Links to other entries select them in the list.
  External links open in a browser window.
- Other text files are shown as they are.
- Images are shown inline.
- Binary files show their size and `binary … — open it from the checkout.`

### Import

**Import**, **Dry run**, the `i` key, the palette's *Preview import plan* and
Cmd/Ctrl+Enter all open the same **import plan** in the preview, and nothing
is written until you press **Import** there. The plan shows exactly what an
import would do:

- the files as a compact folder tree, grouped by folder, with a marker and a
  size on each: `+` a new file, `!` a file that already exists with different
  content (a collision), `~` a file that would be overwritten. The markers are
  a glyph and a spoken label, not colour alone. The `~` marker is part of the
  plan format but the stack's dry run does not report overwrites, so it does not
  appear today;
- where each entry goes in plain words (`into .agents/skills/taste-skill`,
  `into the project root`), including entries pulled in by `requires`
  (`needed by …`);
- a `.gitignore` line when the managed block would change, and the entries
  that are already imported;
- a collision as `2 files already exist at .agents/skills/x — choose another
  folder or keep them`. **Import** stays disabled until the folder is changed.

The **Destination folder** field is in the plan: leave it empty for the default
(skills and styles go to `.agents/skills/<name>` with a `.claude/skills` link,
other entries to `.stack/<id>`, components to
`.stack/components/<library>/<name>`), or type a folder inside the project such
as `src/components/ui`. Entries that belong in the source tree (components and
other `copy` entries) open the plan with the convention filled in
(`src/components/button`) and need a folder before **Import** is available.
Absolute paths and paths that leave the project are refused. Editing the folder
re-runs the plan.

**Import** writes, closes the plan, shows a toast with **Undo**, and the row
flips to `Imported`. Moving the cursor to another entry, `Escape` or **Cancel**
closes the plan without writing. A failed import keeps the plan open with the
reason in plain words.

- An entry that is not in the stack's HEAD commit cannot be imported. Commit it
  in the stack checkout first.
- `Stack edits` means the stack's working tree has uncommitted edits for the
  entry. Imports read the committed version, not the working tree.
- Each import is recorded in `stack.toml`.

### Batch import

Two ways to import several entries at once:

- **import all N** above the list imports every not-imported entry in view.
  `N` counts what would be attempted; already-imported and `not-committed`
  rows are left out.
- Select rows the way a file manager does, with no separate mode. A click
  selects only that row; `Ctrl`/`Cmd`-click adds or removes one; `Shift`-click
  selects the range from the last row clicked (`Ctrl`+`Shift` adds the range).
  From the keyboard, `↑` `↓` select the row they land on, `Shift`+`↑` `↓`
  extend, `Ctrl`+`↑` `↓` move without selecting, `Space` toggles the cursor
  row and `a` or `Ctrl`+`A` select every not-imported row in view. Folder
  rows select their components. Two or more selected rows turn the filter row
  into `N selected`, **Import N** and **Clear** (`Esc` also clears); one
  selected row is just highlighted and uses its own **Import**. The selection
  is dropped when you change kind, library or search.

More than one entry opens one combined plan in the preview: every entry's
files, the shared **folder for entries that need one** (each lands in
`<folder>/<name>`, `src/components` for component batches), entries that will be
skipped and why (a collision, `not-committed`, a failed check), and
**Import N**, which counts only what will really be written. Entries with
collisions are left out up front instead of being refused one by one.

The run imports the entries one at a time and ends with one summary
(`imported 6 · 1 skipped`) and one toast with **Undo** for everything that
landed. **details** lists every refusal; **x** dismisses it. **cancel** stops
after the current entry. Only one import runs at a time.

### Keys in Browse

| key | does |
|---|---|
| `/` | focus the search field (from any view) |
| `↑` `↓` or `j` `k` | move the list cursor and select that row; the preview follows |
| `Shift`+`↑` `↓` | extend the selection from the anchor row |
| `Ctrl`+`↑` `↓` | move the cursor without changing the selection |
| `Home` `End` | first / last row |
| `Enter` | open the cursor row (an entry's detail, or a folder) |
| `i` | open the import plan for the selection (2+ rows) or the cursor row |
| `Space` | add or remove the cursor row. With no list, scroll down about 80% of a page |
| `a`, `Ctrl`+`A` | select every not-imported row in view |
| `r` | refresh the catalog from the stack checkout |
| `Escape` | in the search field: leave it. Elsewhere, in order: close an open plan or batch, dismiss a summary, clear the selection, close the detail, clear the search, or move from the preview back to the list |

Only `↑` `↓`, `Enter` and `Escape` act while the search field has focus; every
other key, space included, is typed into it. The same goes for the destination
fields. The palette adds *Clear Browse filters* and *Change Browse sort order*.

## 5. Project page

The Project route covers the open project: the set-up slot, what this
project imported from the stack, worktrees and T3 threads. It needs a
project. The old `installed` route still opens this page, as an alias. A
header gives the project name, its path, the import count and the stack
commit the lock was last synced to, with **Sync missing** (and **Merge all
upstream** when imports have updates).

- The set-up slot: **init stack.toml** when the project has no `stack.toml`.
- `found in project`: folders that look like entries that were never
  imported, each with an **adopt** button, and **adopt a folder…** for the
  rest.
- **Imports**: one row per import: id, `@commit → path` (`project root` for a
  root template), its state word (`Synced`, `Update`, `Edited`, `Gone`) and
  **Merge upstream** (when the stack has newer content). **Review changes** and
  **Remove** appear on hover or focus without moving anything. **T3 threads**
  use the same columns, with `Target` in blue and **Set as target**.
  Rows with changes show a sub-line (`2 files changed upstream`,
  `edited: SKILL.md`, `removed from stack`).
- **Worktrees** and **T3 threads**, each with a **target** button to retarget
  the app, and **sync all worktrees** and **refresh** buttons.

Every action button sits in one right-aligned column. The app version and
updater live in the sidebar footer (see
[title bar and sidebar](#title-bar-and-sidebar)).

### Row states

| state | when | sub-line |
|---|---|---|
| `imported` (no marker) | the files match the import and the stack has no newer content for them | none |
| `edited` | at least one file differs from the import, or is missing | `edited: <files>` |
| `update` | the stack's HEAD has different content for at least one file | `N files changed upstream` |
| `gone` | the entry no longer exists at the stack's HEAD | `removed from stack` |

Clean rows leave the marker slot blank; only rows needing attention print
one, the first matching state in this order: `gone`, `update`, `edited`.
A row can be `update` and still list `edited:` files.
A deleted file is listed in the row's `missing` (the CLI's `status --json` sends it; for an older CLI the app checks the file on disk); `restore` brings it back.

### Actions

| control | shows when | does | does not |
|---|---|---|---|
| `review changes` | the row has upstream changes or local edits | opens a diff of each changed file under the row (see [Review changes](#review-changes)). Writes nothing | |
| `merge upstream` | row is `Update` | three-way merge of the row's files to the stack's HEAD. Overlapping edits get `<<<<<<<` markers, and the file is listed under `conflicts`. A row only upstream changed updates at once with a toast; a row **both** sides changed reads `review & merge` until its diff has been opened, then asks to confirm | does not drop your edits; does not run for `gone` rows |
| `merge all upstream` | any row is `Update` | the same for every row. If rows both sides changed have not been reviewed it opens their diffs and stops, with a toast; once reviewed it asks to confirm | |
| `remove` | every row | deletes the import's unedited files and its entry in `stack.toml` | does not delete edited files; they are listed as `kept (edited here)` |
| `restore <id>` | the entry has missing files | restores only that entry's missing files (`stack restore <id>`), at the commit recorded in `stack.toml` | never overwrites an edit; does not move to newer content (that is `update`) |
| `restore` | any row has missing files | the same for every entry (`stack restore`, no ids); the project summary and the palette run this | |
| per-file choice | a file both sides changed | under the file's header: **Keep mine** (`--keep-mine`), **Take upstream** (`--take-upstream`; yours is saved as `<file>.mine`) or **Merge (conflict markers)**, the default. **Preview** runs `update <id> --dry-run` with the choices and lists each file's outcome; **Update** runs it for real. The conflict-marker warning shows only while a file is still on Merge | `merge all upstream` keeps the default and its confirm says both-sides files get markers unless resolved per entry |
| `init stack.toml` | no rows, and no `stack.toml` in the project. Shows at the top, in the set-up slot: one line, with the explanation in its hover text | creates `stack.toml` and the managed `.gitignore` block. A legacy `stack.lock.json` is migrated and removed | imports nothing |
| `adopt` (one button per found folder) | a project folder looks like an entry that was never imported | records the folder's files in `stack.toml`: the same import as Browse, with the destination implied | differing files are listed and nothing is written |
| `adopt a folder…` | always | the manual fallback: a folder picker starting in the project. The entry is inferred from the folder name; several matches offer a choice, no match offers an entry-id field (autocompleted from the catalog) as the last resort | differing files are listed and nothing is written; a folder outside the project is refused |
| preset `plan` / `apply` | a preset exists | both open the preset's import plan (the same file tree as Browse). **Apply** in the plan imports every row of the preset, each with its own folder; nothing is written before | collisions block **Apply** and are listed |

Next to the set-up slot, `found in project: N look-alike entries` lists
folders that look like stack entries but were never imported: a skills
folder, a `.stack/<id>` folder, or a hand-placed component. Each line names
the folder and the entry it matches, with `(identical)` when its files
already match the entry or `(differs)` when any file differs, and one
`adopt` button that records it. `adopt a folder…` covers the rare folder the
list misses: a system folder picker starting in the project, confined to
it (an outside folder is refused). The entry is inferred from the folder
name and shown as the same one-line row with its dry-run hint; several
matches offer a short choice list, and `no stack entry matches this folder`
offers an entry-id field as the last resort. A refused adopt names the
differing files and the next step: move or delete them, then adopt again.

Each action shows its result under the rows, as titled sections. A failed
action shows the CLI's error text as it is. Only one action runs at a time;
the other buttons are disabled meanwhile. Every action re-reads the rows when
it ends.

### Review changes

**review changes** on a row shows, per changed file, a unified diff with line
numbers on both sides and a `+` / `−` column (spoken by screen readers, not
colour alone). Long unchanged runs fold behind **Show N unchanged lines**; long
lines scroll inside the diff only. The labels say which side changed:
`Upstream changed 2 files`, `You edited SKILL.md`, and when both did,
`Both sides changed — review first` with a warning that updating may overwrite
or conflict with your edits.

What the diff compares: the installed file against the stack's current copy.
The stack records only a hash of each file as imported, not its text, so a true
three-way diff is not available. For a file only upstream changed, the diff is
exactly what an update adds. For a file only you edited, it is your edits
against the (unchanged) stack copy. For a file both sides changed, it mixes the
two (your edits show as removed lines), and the panel says so. New upstream files
show as all-added, and files the stack dropped as all-removed.

### Presets

Presets are their own route (**Presets** in the title bar), with the same
sidebar as Project. They are named import plans that the stack defines in its
`presets/*.toml` files. The heading carries the count. Each row is one
preset: its name, description (cut to fit; hover for the full text), compact
counts against the lock (`M new`, or `all here`; `· N dep` once a plan has
named auto-imported dependencies; hover for the long form), and two buttons.
**plan** and **apply** both open the preset's import plan under the row: the
same file tree as Browse (`+` new, `!` collision, sizes, `into <folder>` per
entry, dependencies marked `needed by …`, entries already imported listed), with
**Apply &lt;name&gt;** inside it. Nothing is written until you press it, and the
plan clears when the import starts. **hide plan** folds it. Collisions block
**Apply** and name the folder to change.

A long list stays short on the page:

- **Five rows, then `+N more`.** More than five presets show the first five.
  `+N more` reveals the rest, `− fewer` goes back.
- **Filter.** With more than eight presets a `filter…` field sits in the
  heading line. Type to narrow by name or description; every word you type
  must match (any case). The heading shows `3/12` while filtering. `Esc`
  clears the text, a second `Esc` leaves the field.
- **Open preview stays.** A preview stays attached to its row, and that row
  stays visible whatever the filter or the cut says.
- **Collapse.** The heading is a toggle (`· collapse` / `· expand`) when
  there are more than five presets. On a project that already has imports, a
  list longer than five starts collapsed to its heading; in a project with
  nothing imported it starts open. Your choice sticks until you switch
  project.

### App updates

The updater lives in the footer line, not on this page (see
[top bar and footer](#top-bar-and-footer)).

- At startup the app checks the release feed once, in the background. A
  newer version shows in the footer as `→ <version> available [install]`.
  A failed startup check is written to the terminal only.
- `check for updates` runs a check now. It shows `up to date`, then fades
  back to the link — or the short error with `[retry]`.
- `[install]` appears when a newer version is known. It downloads with
  progress, checks the signature, and installs. Then `[relaunch]` appears.
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
- Only the stack folder: `auto` on the setup screen (when the app is
  blocked and a folder is saved), or set `stackPath` to `null`.
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
| project rows | `status` |
| presets | `preset list`; `preset apply <name>`; preview runs `preset apply <name> --dry-run` |
| import, adopt, `adopt a folder…` | `import`; each adopt hint is one `import --dry-run` |
| merge upstream, merge all upstream | `update` |
| remove, sync, init | `remove`, `sync`, `init` |

The app adds `--offline` to `show` and `status`, which never need the
network. `list` stays online. Adopt suggestions match a shell-side folder
listing (the skills dirs, `src/components`, `.stack`) against the catalog
by name; the `adopt a folder…` choice is confined to the project by the
shell and its entry inferred from the folder name the same way. A failed
command shows its error text: the CLI's stderr, or its stdout if stderr is
empty.

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
| footer check shows an error | no network, or the release feed is not reachable (the repo must be public) | hover for the full message; `[retry]` later. Startup failures show only in the terminal |
| `nothing listed`, `none` | the stack has no entries of that kind, or the list is empty | check the checkout: `node tools/stack/cli.mjs list` in the stack folder |
| `untracked look-alikes, nothing written:` | target files exist with different content | move them, pick another `--to`, or delete them. Identical files are fine |
| `Not in the stack, so it can't be imported` (`Not in stack` on its row) | the entry is only in the stack's working tree | commit it in the stack checkout, then retry |
| `cannot resolve path` or `path is not a directory` | the project path is gone or is a file | pick the folder again |
| `not found` | a route the app does not have | use Project, Browse or Presets in the title bar |

## 8. Preview without the native shell

For UI work in a browser, the app can run on a mock of its native bridge.
Each mock scenario is a fixture stack, project and user. Fixture data is
invented. The mock cannot show the folder picker or persistent settings;
the update feed is emulated (see the `+update-*` flags below). Details and
build steps are in the README:
[UI verification without the native shell](../README.md#ui-verification-without-the-native-shell).

Open the built app with the scenario in the hash: `#<scenario>,/<route>`.
Routes are `project`, `browse`, `browse/<kind>`, `browse/all`,
`browse/<id>` and `browse/<id>/<file>`. The old `installed` route still
opens the project page, as an alias.

| scenario | what it shows |
|---|---|
| `populated` (default) | a project with three imports; one entry `Not in stack`; one with `Stack edits` |
| `empty` | who, with two workers |
| `noworker` | who, with no workers: `continue without one` leads to the project screen, then the project page |
| `noproject` | project, with recent projects |
| `scan` | project, with a scan root set. Press `scan` to list |
| `conflicts` | project page with `update` rows and a conflict, with file bodies for **review changes**: `skills/file-pr` changed on both sides, `templates/agents-md` only upstream |
| `missing` | project page with rows whose files are missing (shown as `edited`) |
| `lookalike` | an import refused for `skills/file-pr` |
| `fresh` | project page in a plain folder: the set-up slot with `init stack.toml` |
| `many` | project page with three imports and 15 presets: the presets start collapsed |
| `manyfresh` | plain folder with 15 presets: the set-up slot, presets open |
| `lots` | three imports and 34 presets |
| `adopt0` | project page with no adoptable folders: only the quiet `adopt a folder…` link |
| `adopt1` | one adoptable folder next to `init stack.toml` |
| `adopt3` | three adoptable folders next to `init stack.toml`; one differs |
| `quickimport` | browse with one of each import case: an imported skill, an importable skill, a component needing a folder, a plan with collisions |
| `batchimport` | browse components with an eight-member library, an already-imported entry and a plan with collisions (batch plan) |
| `bad-stack` | the stack checkout setup screen; get stack clones and the gate lifts |
| `no-node` | the setup screen with node missing |
| `no-auth` | the setup screen with no GitHub auth: get stack fails with the one actionable error |
| `no-cli` | a valid stack whose command is not linked: the quiet [add stack command] line |
| `cli-foreign` | the quiet line when something else owns the `stack` name (no offer) |
| `offline` | the catalog loads, then the network drops after 1.5 s: Browse keeps the saved list; refresh shows the `Showing saved catalog` strip with Retry |
| `dirty` | a real import is refused because the project has uncommitted changes |
| `locked` | a real import is refused because git is busy in the project (index.lock) |
| `interrupted` | a real import stops halfway: one file landed, one did not; the project row then shows Missing files with Restore files / Remove |
| `no-path` | the quiet line when the bin dir is off PATH (no offer) |

A `+update-available` or `+update-error` suffix on any scenario drives the
footer updater fixture: `#populated+update-available,/project` offers the
invented 0.1.9 (the startup event fires, and checks answer it; `[install]`
streams progress), while `+update-error` fails checks. Without a suffix,
checks answer up to date.

A `+pick-<case>` suffix scripts the adopt folder picker:
`#adopt3+pick-differing,/project` makes `adopt a folder…` return a differing
folder. Cases are `matching` (identical), `differing`, `nomatch` (no entry
matches, so the id field shows), `multi` (two same-named entries), `outside`
(rejected like a real outside pick) and `cancel` (quiet, as if dismissed).
Without a suffix the picker returns the first adoptable folder, else a
non-matching folder.

A `+grows` suffix arms `window.__mockGrow()`, which adds one skill to the
catalog — call it after the first load, so the browse **refresh** visibly
picks it up. `+listfail` arms `window.__mockFailLists()`, which fails
later catalog lists, for the refresh error state. `+t3` populates mock T3
Code branch worktrees and threads (`#populated+t3,/project` or
`#populated+t3,/browse/skills/file-pr`).

### T3 Code branches and thread injection

When the open project has multiple git/T3 worktrees or `t3` is installed:

- **Worktree switcher (top bar):** switch the active `stack` target between the
  main checkout and any branch worktree in memory without polluting recent
  projects.
- **Worktrees & T3 threads (Project page):** switch target per worktree or
  thread, open a thread link, or run `[sync all worktrees]` to invoke
  `stack sync --json` across every worktree holding a `stack.toml`.
- **Direct thread injection (Browse entry detail):** send an entry into an
  existing T3 Code thread or start a `+ new thread` (optionally creating a
  branch worktree), either as **inject prompt** (inline summary + entry doc) or
  **import + notify** (import into that thread's worktree/root first, then
  send a prompt referencing the imported path or `$skill`).
