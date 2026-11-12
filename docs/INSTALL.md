# Installing Stack (Linux)

Two install methods: **AppImage** (works today) and **Flatpak** (draft —
see [flatpak/README.md](../flatpak/README.md)). All installs are user-local
unless noted; nothing here needs root.

Every method ends with **stack provisioning**: first launch must find a
usable `escacs/stack` checkout with no manual `git` commands (details
below). The stack repo is private, so provisioning uses your existing
GitHub auth (`gh` or ssh) and falls back to the app's first-run folder
picker when there is none.

## Prerequisites

The app shells out to `node` for every stack operation, so **Node.js 22+**
must be on `PATH` — no install method bundles it. (If it is missing, first
launch tells you exactly that.) Get it from [nodejs.org](https://nodejs.org)
or a version manager; distro packages often lag.

Running the AppImage also needs **FUSE 2** (`libfuse.so.2`) and the
**WebKitGTK 4.1 runtime** (the AppImage does not bundle the webview):

| Distro | FUSE 2 | WebKitGTK 4.1 runtime |
|---|---|---|
| Debian/Ubuntu | `sudo apt install libfuse2` | `sudo apt install libwebkit2gtk-4.1-0` |
| Fedora | `sudo dnf install fuse-libs` | `sudo dnf install webkit2gtk4.1` |
| Arch | `sudo pacman -S fuse2` | `sudo pacman -S webkit2gtk-4.1` |

Without FUSE 2, launching fails with a mount error; without the webview
libs it fails with a missing `libwebkit2gtk-4.1.so` error.

Building from source additionally needs the webview toolchain plus Rust
stable (the Debian/Ubuntu line matches what CI installs in
`.github/workflows/release.yml`; the others are the
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
translated per distro):

| Distro | Command |
|---|---|
| Debian/Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf` |
| Fedora | `sudo dnf group install "c-development"` then `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libxdo-devel libappindicator-gtk3-devel librsvg2-devel patchelf` |
| Arch | `sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl xdotool libayatana-appindicator librsvg patchelf` |

Notes:

- Arch has no `libxdo` / `libappindicator-gtk3` packages: `libxdo` ships
  inside `xdotool`, and `libayatana-appindicator` is the maintained
  appindicator provider. (This app has no tray icon today, so the
  appindicator/xdo libs are a harmless superset kept for parity with the
  Tauri docs — the strictly required ones are webkit, librsvg, ssl,
  patchelf and a compiler.)
- `webkit2gtk-4.1` is what Tauri 2.12 / wry links against. It is
  available as shown above on Debian 12+, Ubuntu 22.04+, Fedora 36+
  and current Arch. Older distros that only ship `webkit2gtk-4.0`
  cannot build or run this app.
- Portability of the bundles: CI builds releases on **ubuntu-22.04**
  (glibc 2.35), so the release AppImage/deb/rpm run on any distro
  with glibc 2.35 or newer. An AppImage built locally inherits its
  host glibc instead — do not redistribute one built on Arch or
  Fedora to users on older distros.

## AppImage

Build it (bundle lands at
`src-tauri/target/release/bundle/appimage/Stack_<version>_amd64.AppImage`):

```sh
npm ci
npx tauri build --bundles appimage
```

Or download the AppImage from the release page. Then install from a
`stack-app` checkout:

```sh
scripts/install-appimage.sh <Stack_x.y.z_amd64.AppImage> --icons src-tauri/icons
```

Without `--icons`, the installer extracts the single icon embedded in the
AppImage instead (slower, 512px only). What it does:

- copies the AppImage to `~/.local/bin/stack-app.AppImage`
- writes `~/.local/share/applications/stack-app.desktop` plus hicolor icons
  (id `stack-app`, matching what tauri-bundler generates)
- runs `scripts/provision-stack.sh` (skip with `--no-provision`, or point
  at an existing checkout with `--stack <dir>`)
- symlinks the checkout's `bin/stack` to `~/.local/bin/stack`, so the `stack`
  terminal command is on `PATH` (skipped with a warning when something else
  already owns that name; removed on uninstall only if it still points at a
  stack checkout)
- refreshes the desktop and icon caches

Options: `--prefix <dir>` (default `~/.local`), `--reinstall`.

No checkout? The AppImage also runs standalone — `chmod +x` it and launch
directly — but then there is no menu entry and no installer provisioning;
the app's first-run screen covers it instead with one click (get stack,
below).

**Upgrade**: re-run the installer with the new AppImage plus `--reinstall`
(or accept the in-app update when offered — that upgrades in place).
Your stack path and settings survive.

**Uninstall**:

```sh
scripts/uninstall-stack-app.sh            # keeps app config
scripts/uninstall-stack-app.sh --config   # also forgets stack path, recents
```

Never touches the stack checkout or your projects.

## Flatpak

Draft only. The manifest, desktop file, and CI sketch exist, but the
generated npm/cargo vendor sources are not committed and no build has been
validated — see [flatpak/README.md](../flatpak/README.md) for status and
how to finish it. Provisioning inside the sandbox story: run
`scripts/provision-stack.sh` on the host first; the sandbox cannot
authenticate to GitHub for you.

## System packages (.deb/.rpm)

Tauri also builds `deb` and `rpm` targets. When attached to a release they
install system-wide (`sudo apt/dnf install ./stack_x.y.z_arch.ext`) with
the desktop entry included; afterwards provision the stack checkout with
`scripts/provision-stack.sh` from a checkout (or pick the folder in the
app on first run).

## Stack auto-provisioning

`scripts/provision-stack.sh` runs at the end of every installer. In order:

1. **Already have one?** If `~/escacs/stack`, `$ESCACS_STACK`, or the
   already-pinned app setting is a usable checkout (git `HEAD` plus
   `tools/stack/cli.mjs`), it is kept and pinned in the app settings.
2. **`gh` clone** — when `gh` is installed and authenticated, clones
   `escacs/stack` to `~/escacs/stack` and pins it.
3. **ssh clone** — batch-mode `git clone` (fails fast, never prompts).
4. **Folder picker** — otherwise first launch shows the existing setup
   screen: authenticate (`gh auth login`) and re-run the script, or clone
   manually and pick the folder.

The pin is written to `~/.config/codes.escacs.stack/config.json` as
`stackPath` (the settings override wins in the app's resolve order), which
is why GUI launches find it without shell env vars. `$ESCACS_STACK` is
still honoured when set. The script never sees credentials — auth stays
inside `gh`/`ssh`. Re-run it any time; it never overwrites an existing
checkout.

The app itself provisions the same way: when no usable checkout resolves,
the first-run screen offers **get stack** (primary) next to the folder
picker (secondary). It runs the same steps in the same order — keep, `gh`
clone, ssh clone — then pins `stackPath`, and links the checkout's
`bin/stack` to `~/.local/bin/stack` with the installer's rules (never
replaces a non-symlink or a link to something else; warns when
`~/.local/bin` is not on `PATH`). The folder picker auto-links too. When a
valid stack's command is not linked, one quiet dismissible line offers to
add it. So on a machine with `gh` authenticated and no stack checkout,
launching the AppImage directly ends, after one click, with
`~/escacs/stack` cloned, the app working, and `stack --help` working in a
new terminal.

## Troubleshooting

- **AppImage won't start, mount/FUSE error** — install FUSE 2 (table above).
- **AppImage won't start, `libwebkit2gtk-4.1.so` missing** — install the
  WebKitGTK 4.1 runtime (table above). The AppImage never bundles the
  webview.
- **AppImage won't start, `GLIBC_X.XX not found`** — the bundle was built
  on a newer distro than yours. Use the release build (ubuntu-22.04
  baseline) instead of a locally built one.
- **"node was not found on PATH"** — install Node.js 22+, relaunch.
- **"stack checkout not found" / setup screen on launch** — nothing
  provisioned the checkout yet. Press **get stack** (needs `gh` auth or an
  ssh key for the private repo); if it reports no auth, `gh auth login`
  and retry, or clone `git@github.com:escacs/stack.git` yourself and pick
  the folder.
- **Window shows a generic icon** — the desktop entry expects
  `StartupWMClass=stack-app` (verified against tauri-bundler output). If
  your desktop still mismatches, report the `WM_CLASS` from
  `xprop | grep WM_CLASS` after clicking the window.
