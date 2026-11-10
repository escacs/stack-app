# Flatpak packaging (draft)

Status: manifest drafted, **not yet buildable**. The two generated vendor
files are missing, and `flatpak-builder` is not installed on the dev
machine, so nothing here has been built or run. The AppImage in
[INSTALL.md](../docs/INSTALL.md) is the working install story today.

## What is here

- `codes.escacs.stack.yml` — manifest on the GNOME 51 runtime/SDK
  (verified current on flathub, Nov 2026). WebKitGTK 4.1 and its headers
  come from the SDK; Rust and Node arrive via the freedesktop
  `rust-stable` / `node24` SDK extensions.
- `codes.escacs.stack.desktop` — sandbox desktop entry (id
  `codes.escacs.stack`, `StartupWMClass=stack-app` per tauri-bundler).
- `codes.escacs.stack.metainfo.xml` — minimal AppStream metainfo (id,
  name, summary, launchable, provided binary), installed to
  `/app/share/metainfo` by the manifest.

## What is missing and how to finish it

`flatpak-builder` builds offline, so every dependency must be vendored as
manifest sources. Two generated files are needed (both git-ignored until
they exist; commit them once generated):

1. **npm deps** (159 packages in `package-lock.json`, lockfile v3):
   ```sh
   pipx install git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node
   cd <repo-root>
   flatpak-node-generator npm package-lock.json -o flatpak/npm-sources.json
   ```
2. **cargo deps** (408 crates in `src-tauri/Cargo.lock`):
   ```sh
   python3 flatpak-cargo-generator.py src-tauri/Cargo.lock -o flatpak/cargo-sources.json
   # from flatpak-builder-tools/cargo (needs Python 3.9+, tomlkit, aiohttp)
   ```

   Then uncomment the two `- npm-sources.json` / `- cargo-sources.json`
   lines in the manifest's `sources` and build:
   ```sh
   flatpak install flathub org.gnome.{Platform,Sdk}//51 \
     org.freedesktop.Sdk.Extension.{rust-stable,node24}
   flatpak-builder --force-clean build-dir flatpak/codes.escacs.stack.yml
   ```
   Unpinned freedesktop SDK extensions under a GNOME SDK are the norm
   (Fractal and Pika Backup ship the same form); the builder resolves the
   branch against the SDK base, and CI passes `--install-deps-from=flathub`
   so it does the same there. If a build ever reports an extension
   missing, pin `//branch` in the manifest (both extensions exist on
   flathub at `//25.08` and `//26.08`).

Regenerate both files whenever `package-lock.json` or `Cargo.lock` changes;
CI fails early with a pointer here when they are absent (see
`.github/workflows/flatpak.yml`).

## Sandbox notes

- **Stack checkout + projects**: `--filesystem=home` covers
  `~/escacs/stack` and projects under home. Provision the checkout on the
  host first with `scripts/provision-stack.sh` — the sandbox cannot
  `gh auth login` for you.
- **App config is NOT shared with the host**: inside the sandbox
  `XDG_CONFIG_HOME` remaps to `~/.var/app/codes.escacs.stack/config`, so
  the host's pinned `stackPath` does not carry over (this is deliberate:
  portal paths for outside-home folders are per-sandbox and must never
  leak into the host config). On first sandboxed run, either pick the
  stack folder in the app's setup screen or pre-seed it with
  `flatpak override --user --env=ESCACS_STACK=$HOME/escacs/stack codes.escacs.stack`.
  Host env vars never reach the sandbox otherwise.
- **File picker**: tauri-plugin-dialog uses the file-chooser portal when
  sandboxed, so picking a folder outside home grants access to it. No extra
  bus permissions needed.
- **Node at runtime**: the app shells out to `node`, so the `node` module
  runs the extension's `install.sh` (node binary only, to
  `/app/node/bin/node`; script name verified against
  `flathub/org.freedesktop.Sdk.Extension.node24`) and symlinks
  `/app/bin/node` onto `PATH`.
- **Network**: `--share=network` for stack `update` commands and the
  in-app updater; all project operations run locally.

## Not planned while the repo is private

Flathub submission needs a public git source plus a metainfo file; this
repo is private, so distribution stays at local `flatpak-builder` builds
and CI-built `.flatpak` bundles for now.
