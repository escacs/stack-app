# Updates

Stack self-updates from its GitHub releases page via
[tauri-plugin-updater v2](https://v2.tauri.app/plugin/updater/)
(Rust `tauri-plugin-updater =2.12.0`, npm `@tauri-apps/plugin-updater 2.12.0`,
plus `@tauri-apps/plugin-process 2.4.0` for relaunch).

## How it works

- Each `v*` tag runs `.github/workflows/release.yml` (linux-only,
  ubuntu-22.04 for an old glibc), which builds the deb/rpm/appimage bundles
  plus the signed updater artifacts and creates the GitHub release with a
  `latest.json` manifest attached.
- The app polls
  `https://github.com/escacs/stack-app/releases/latest/download/latest.json`
  (see `plugins.updater` in `src-tauri/tauri.conf.json`).
- Every artifact is signed at build time with the secret key whose public
  half is baked into `tauri.conf.json` as `plugins.updater.pubkey`. The app
  verifies that signature before installing anything.
- At startup the shell does one silent, non-blocking update check
  (`src-tauri/src/lib.rs` setup hook) and ignores the result. The manual
  flow lives in the settings view (`src/views/Project.tsx`, helpers in
  `src/updater.ts`): check for updates, download & install with progress,
  then relaunch. Errors are shown verbatim.
- On Linux the self-update path ships through the AppImage bundle; deb and
  rpm stay available on the release page as manual downloads.
- Dev builds (`tauri dev`) can check but have nothing to update in place;
  only installed bundles self-update.

## Cutting a release

One-time setup first: the private key file is
`/tmp/stack-app-updater.key` (generated with an **empty** password via
`npx tauri signer generate`). Back it up somewhere safe (password manager
or encrypted backup) — losing it means existing installs can never verify
a new artifact again (see rotation below). Then store it as a repo secret:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo escacs/stack-app < /tmp/stack-app-updater.key
gh secret list --repo escacs/stack-app
```

No `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is needed (empty password). To test
end to end, bump the version everywhere to the same number, commit, tag,
push:

```sh
# set version 0.2.0 in package.json, src-tauri/tauri.conf.json and
# src-tauri/Cargo.toml (all three must match), then:
git commit -am "release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

Watch the `release` workflow, then install the previous bundle somewhere,
open settings, and check for updates. The version in the tag and the three
version fields must agree, otherwise the updater sees no newer release.

## Key rotation

Installed apps verify new artifacts with the public key baked into them at
build time, so a rotated key is not trusted by existing installs: rotation
forces one manual reinstall for every user. Steps:

1. `npx tauri signer generate -w /tmp/stack-app-updater-new.key --password "" --ci`
2. Replace `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` with the
   contents of `/tmp/stack-app-updater-new.key.pub`.
3. `gh secret set TAURI_SIGNING_PRIVATE_KEY --repo escacs/stack-app < /tmp/stack-app-updater-new.key`
4. Back up the new private key, delete the `/tmp` copies, cut a release as
   above, and tell users to download that one by hand. Self-updates resume
   from the release after.
