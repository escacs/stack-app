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
- That endpoint fetches without credentials, so the repo must stay public
  (or the URL otherwise reachable without auth). Flipping the repo private
  makes every update check 404: the startup check logs it to stderr and the
  footer check shows it short (full text in a tooltip), but no install will
  ever see an update.
- Every artifact is signed at build time with the secret key whose public
  half is baked into `tauri.conf.json` as `plugins.updater.pubkey`. The app
  verifies that signature before installing anything.
- At startup the shell does one silent, non-blocking update check
  (`src-tauri/src/lib.rs` setup hook) and offers a newer release in the
  footer. The manual flow lives in the footer line (`src/views/Updates.tsx`,
  helpers in `src/updater.ts`): check for updates, download & install with progress,
  then relaunch. Errors show short and dim with the full text in a tooltip.
- On Linux the supported self-update path is the AppImage bundle (the new
  file replaces the old one). `latest.json` also carries `deb` and `rpm`
  entries, and a deb/rpm-installed copy will try to self-update through
  them by running `dpkg -i` / `rpm -U` as the app user — which needs root
  and is untested. Prefer the AppImage for self-updating installs; treat
  deb and rpm as manual downloads from the release page.
- Dev builds (`tauri dev`) can check but have nothing to update in place;
  only installed bundles self-update.

## Cutting a release

One-time setup first: generate the signing key **outside** `/tmp` (it is
tmpfs here and a reboot deletes it) with an **empty** password — that is a
known trade-off: whoever reads the file can sign releases, so its safety
is the safety of wherever you keep it:

```sh
npx tauri signer generate -w ~/stack-app-updater.key --ci
```

Back the key up to a password manager or encrypted backup **before**
anything else — the GitHub secret below is write-only, so a lost key
means existing installs can never verify a new artifact again (see
rotation). Then store it as a repo secret and shred the local copy:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo escacs/stack-app < ~/stack-app-updater.key
gh secret list --repo escacs/stack-app
shred -u ~/stack-app-updater.key ~/stack-app-updater.key.pub
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

Watch the `release` workflow, then install the previous bundle somewhere
and press `check for updates` in the footer. The version in the tag and the
three version fields must agree, otherwise the updater sees no newer release.

## Key rotation

Installed apps verify new artifacts with the public key baked into them at
build time, so a rotated key is not trusted by existing installs: rotation
forces one manual reinstall for every user. Steps:

1. `npx tauri signer generate -w ~/stack-app-updater-new.key --password "" --ci`
2. Replace `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` with the
   contents of `~/stack-app-updater-new.key.pub`.
3. Back the new key up to a password manager first, then
   `gh secret set TAURI_SIGNING_PRIVATE_KEY --repo escacs/stack-app < ~/stack-app-updater-new.key`
4. Shred the local copies (`shred -u ~/stack-app-updater-new.key*`), cut a
   release as above, and tell users to download that one by hand.
   Self-updates resume from the release after.
