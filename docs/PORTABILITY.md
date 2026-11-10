# Portability

Linux-agnostic audit of the whole tree (code, scripts, workflows, docs),
Nov 2026. What was checked, what is supported, and the known limits.

## Distro support statement

Supported build/run distros, all x86_64:

| Distro | Versions | Notes |
|---|---|---|
| Debian | 12+ | `webkit2gtk-4.1` first shipped in bookworm |
| Ubuntu | 22.04+ | release baseline; `libwebkit2gtk-4.1-dev` verified on jammy |
| Fedora | 36+ | first with `webkit2gtk4.1` split packages |
| Arch | current | `webkit2gtk-4.1` from extra |

Older distros that only ship `webkit2gtk-4.0` (e.g. Ubuntu 20.04, Debian
11) cannot build or run this app: Tauri 2.12 / wry links against the 4.1
API. No other distro-specific code exists — the app reads `$HOME` /
`$XDG_CONFIG_HOME` / `$ESCACS_STACK` and shells out to `node` and `git`
found on `PATH`.

## What was checked

1. **Hardcoded machine paths.** Grepped code and scripts for `/home/`,
   `/var/home`, user names and user-specific cache paths. Clean: the only
   `/home/...` strings are the obviously fake `/home/dev/...` fixtures in
   `dev/mock-bridge.js` and `dev/mock-app-bridge.js`. Rust resolves the
   stack checkout from settings → `$ESCACS_STACK` → upward walk (no home
   assumptions); scan roots use `$HOME` with a `USERPROFILE` fallback.
   Scripts honour `$HOME` and `$XDG_CONFIG_HOME` (with `--dir` /
   `--config-home` / `--prefix` overrides) and were re-checked after the
   updater/installer agents' changes.
2. **Distro package matrix.** Every package name in
   [INSTALL.md](INSTALL.md#prerequisites) was verified, not copied from
   memory: Arch names against the local pacman db, Ubuntu names against
   packages.ubuntu.com (jammy), Fedora names against Bodhi, and the full
   build lines against the
   [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).
   Two corrections came out of it: Arch needs `xdotool` (ships `libxdo`)
   and `libayatana-appindicator` (`libappindicator-gtk3` no longer exists
   in Arch repos), and AppImage users need the WebKitGTK 4.1 *runtime*
   libs, which the bundle does not include.
3. **glibc baseline.** `.github/workflows/release.yml` builds on
   **ubuntu-22.04** (glibc 2.35) and carries a comment forbidding a casual
   runner bump — that glibc is the minimum the release AppImage/deb/rpm
   will run on. `check.yml` and `flatpak.yml` use `ubuntu-latest`, which is
   fine: neither produces redistributed native bundles (check only runs
   tests; Flatpak pins the GNOME 51 runtime).
4. **Flatpak manifest sanity.**
   - `command: stack-app` matches the Cargo package/binary name; app-id
     matches the Tauri identifier.
   - `finish-args` cover WebKit (`ipc`, `wayland` + `fallback-x11`,
     `dri`), updater/stack network fetches, and `--filesystem=home` for
     the checkout and projects. The file-chooser portal handles
     outside-home folders with no extra bus permissions.
   - `sdk-extensions` stay unpinned — the same form Fractal and Pika
     Backup ship — and CI now resolves them with
     `flatpak-builder --install-deps-from=flathub --user` instead of a
     manual install line that would fail on multiple branches.
   - The runtime `node` module uses the extension's `install.sh` (node
     binary only; names verified against
     `flathub/org.freedesktop.Sdk.Extension.node24`), not the whole-SDK
     copy.
   - A minimal `codes.escacs.stack.metainfo.xml` was added and is
     installed to `/app/share/metainfo`.
   - Config is deliberately NOT shared with the host: the sandbox
     remaps `XDG_CONFIG_HOME`, so the first sandboxed run re-picks the
     stack folder (or takes it from a `flatpak override
     --env=ESCACS_STACK=...`). See [flatpak/README.md](../flatpak/README.md).
   - Still draft: the generated npm/cargo vendor sources are uncommitted
     and no Flatpak build has run (see the Flatpak README).
5. **Updater config sanity.**
   - Endpoint `.../releases/latest/download/latest.json`,
     `plugins.updater.active`, and `bundle.createUpdaterArtifacts` are
     set in `tauri.conf.json`; the baked-in pubkey byte-matches the
     `/tmp/stack-app-updater.key.pub` generated alongside the release
     work.
   - Rust inits the updater + process plugins, capabilities allow
     `updater:default` + `process:allow-restart`, startup does one
     silent non-blocking check, and the settings view offers
     check/download+install/relaunch. No update URL is hardcoded in the
     frontend — everything flows through the Tauri config.
   - `release.yml` has `contents: write`, builds linux-only on the old
     runner via `tauri-action@v0`, and consumes the
     `TAURI_SIGNING_PRIVATE_KEY` secret (empty password, so no password
     secret needed). Still untested end to end: cutting the first `v*`
     release is a manual step in [UPDATES.md](UPDATES.md).
6. **Script robustness.** `provision-stack.sh`'s no-JSON-tooling fallback
   now escapes its path before writing `config.json`.

## Known limits

- The Flatpak has never been built (missing vendor sources, no
  `flatpak-builder` run). The manifest is reviewed but unproven.
- No real update has been served yet: needs the signing secret plus a
  first `v*` tag, then an older install checking against it.
- A locally built AppImage inherits its host glibc — only the CI
  (ubuntu-22.04) bundles are redistributable to older distros.
- `provision-stack.sh`'s `gh` path was never exercised live (no auth in
  test sandboxes by design); the ssh and manual paths were.
- The app never adds `~/escacs/stack` to its *own* auto-lookup (settings
  → env → upward walk only). A host-side clone is found after provisioning
  because the script pins it into `config.json`; if that file is wiped the
  app asks again instead of re-finding the clone. Candidates: teach
  `resolve_stack_dir_inner` the default dir, or leave the explicit picker
  as the backstop.
