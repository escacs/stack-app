#!/usr/bin/env bash
# Remove a user-local Stack install created by install-appimage.sh.
#
#   scripts/uninstall-stack-app.sh [--prefix ~/.local] [--config] [--yes]
#
# Removes the AppImage, desktop entry, installed icons, and the `stack`
# PATH symlink (only when it points at a stack checkout's bin/stack).
# Never touches the stack checkout or any project. With --config also
# removes the app config dir (~/.config/codes.escacs.stack), which forgets
# the stack path and recent projects.

set -u

APP_BIN="stack-app"
APP_ID="codes.escacs.stack"
APPIMAGE_NAME="stack-app.AppImage"

PREFIX="$HOME/.local"
WITH_CONFIG="no"
YES="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --config) WITH_CONFIG="yes"; shift ;;
    --yes) YES="yes"; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "uninstall-stack-app.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

remove() {
  if [ -e "$1" ] || [ -L "$1" ]; then
    rm -f "$1"
    echo "removed $1"
  fi
}

if [ "$YES" != "yes" ]; then
  printf "remove the Stack install under %s? [y/N] " "$PREFIX"
  read -r answer
  case "$answer" in
    [Yy]*) ;;
    *) echo "aborted."; exit 0 ;;
  esac
fi

remove "$PREFIX/bin/$APPIMAGE_NAME"
remove "$PREFIX/share/applications/$APP_BIN.desktop"
if [ -L "$PREFIX/bin/stack" ]; then
  case "$(readlink "$PREFIX/bin/stack")" in
    */bin/stack) remove "$PREFIX/bin/stack" ;;
    *) echo "keeping $PREFIX/bin/stack (not a stack shim link)" ;;
  esac
fi
for size in 32 64 128 256 512; do
  remove "$PREFIX/share/icons/hicolor/${size}x${size}/apps/$APP_BIN.png"
done

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true

if [ "$WITH_CONFIG" = "yes" ]; then
  if [ -d "$CONFIG_HOME/$APP_ID" ]; then
    rm -rf "$CONFIG_HOME/$APP_ID"
    echo "removed $CONFIG_HOME/$APP_ID"
  fi
fi

echo "done. Your stack checkout and projects were left untouched."
