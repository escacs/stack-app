#!/usr/bin/env bash
# Install the Stack AppImage for the current user (no root).
#
#   scripts/install-appimage.sh <Stack_x.y.z_amd64.AppImage> [options]
#
# Installs the AppImage to ~/.local/bin, writes a desktop entry plus icons
# (the bundler's own id: stack-app, StartupWMClass=stack-app), then runs
# provision-stack.sh so first launch finds the stack checkout, and symlinks
# the checkout's bin/stack into the prefix bin so `stack` is on PATH.
#
# Options:
#   --prefix <dir>   install prefix (default ~/.local)
#   --icons <dir>    Tauri icons dir (32x32.png, 64x64.png, 128x128.png,
#                    128x128@2x.png, icon.png); default: extract from AppImage
#   --stack <dir>    use this stack checkout instead of auto-provisioning
#   --no-provision   skip stack provisioning entirely
#   --reinstall      replace an existing install without prompting
#
# Upgrades are the same command with the new AppImage: it overwrites in place.

set -u

APP_BIN="stack-app"
APP_NAME="Stack"
APP_COMMENT="escacs stack desktop shell (Tauri 2)"
APPIMAGE_NAME="stack-app.AppImage"

PREFIX="$HOME/.local"
ICONS_DIR=""
STACK_DIR=""
PROVISION="yes"
REINSTALL="no"
APPIMAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --icons) ICONS_DIR="$2"; shift 2 ;;
    --stack) STACK_DIR="$2"; shift 2 ;;
    --no-provision) PROVISION="no"; shift ;;
    --reinstall) REINSTALL="yes"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) echo "install-appimage.sh: unknown option: $1" >&2; exit 2 ;;
    *) APPIMAGE="$1"; shift ;;
  esac
done

[ -n "$APPIMAGE" ] || { echo "usage: install-appimage.sh <AppImage> [options]" >&2; exit 2; }
[ -f "$APPIMAGE" ] || { echo "install-appimage.sh: not found: $APPIMAGE" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$PREFIX/bin"
DESKTOP_DIR="$PREFIX/share/applications"
ICON_BASE="$PREFIX/share/icons/hicolor"
TARGET="$BIN_DIR/$APPIMAGE_NAME"
DESKTOP_FILE="$DESKTOP_DIR/$APP_BIN.desktop"

if [ -e "$TARGET" ] && [ "$REINSTALL" != "yes" ]; then
  echo "already installed at $TARGET; re-run with --reinstall to upgrade." >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$DESKTOP_DIR"
cp "$APPIMAGE" "$TARGET"
chmod +x "$TARGET"
echo "installed $TARGET"

# --- icons ---
install_icon() {  # install_icon <size> <file>
  local size="$1" file="$2"
  [ -f "$file" ] || return 0
  mkdir -p "$ICON_BASE/${size}x${size}/apps"
  cp "$file" "$ICON_BASE/${size}x${size}/apps/$APP_BIN.png"
  echo "icon ${size}x${size}"
}

if [ -n "$ICONS_DIR" ]; then
  # Tauri's default icon set (see the linux-desktop-entry skill).
  install_icon 32  "$ICONS_DIR/32x32.png"
  install_icon 64  "$ICONS_DIR/64x64.png"
  install_icon 128 "$ICONS_DIR/128x128.png"
  install_icon 256 "$ICONS_DIR/128x128@2x.png"
  install_icon 512 "$ICONS_DIR/icon.png"
else
  # Fallback: the AppImage embeds its own 512px icon. (Pattern extraction
  # is broken in this AppRun runtime, so this extracts the whole image to
  # temp space and cleans up after itself — pass --icons to skip it.)
  echo "extracting the bundled icon (one-time, slower than --icons) ..."
  tmp="$(mktemp -d)"
  if (cd "$tmp" && "$TARGET" --appimage-extract >/dev/null 2>&1) \
     && [ -f "$tmp/squashfs-root/stack-app.png" ]; then
    install_icon 512 "$tmp/squashfs-root/stack-app.png"
  else
    echo "warning: no icons installed (pass --icons <src-tauri/icons>)" >&2
  fi
  rm -rf "$tmp"
fi

# --- desktop entry (matches what tauri-bundler generates) ---
cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=$APP_COMMENT
Exec=$TARGET
Icon=$APP_BIN
StartupWMClass=$APP_BIN
Terminal=false
Categories=Utility;
EOF
echo "desktop entry $DESKTOP_FILE"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true

# --- stack checkout provisioning (hard requirement) ---
if [ -n "$STACK_DIR" ]; then
  "$SCRIPT_DIR/provision-stack.sh" --dir "$STACK_DIR"
elif [ "$PROVISION" = "yes" ]; then
  "$SCRIPT_DIR/provision-stack.sh" || true
fi

# --- put `stack` on PATH ---
# Whatever checkout provisioning settled on (--stack, a fresh clone, or a
# previously pinned path): link its bin/stack shim into the prefix bin.
resolve_stack_dir() {
  if [ -n "$STACK_DIR" ]; then
    (cd "$STACK_DIR" && pwd 2>/dev/null) || true
    return 0
  fi
  cfg="${XDG_CONFIG_HOME:-$HOME/.config}/codes.escacs.stack/config.json"
  [ -f "$cfg" ] || return 0
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("stackPath") or "")' "$cfg" 2>/dev/null \
    || node -e 'try { process.stdout.write(require(process.argv[1]).stackPath || "") } catch (e) {}' "$cfg" 2>/dev/null \
    || true
}

# Lexical absolute path, working when the target dangles (GNU coreutils).
lexical_path() {
  if command -v realpath >/dev/null 2>&1; then realpath -m "$1" 2>/dev/null && return; fi
  readlink -m "$1" 2>/dev/null || readlink -f "$1" 2>/dev/null || printf '%s\n' "$1"
}

link_stack_shim() {  # link_stack_shim <stackdir>
  local shim="$1/bin/stack"
  local link="$BIN_DIR/stack"
  [ -x "$shim" ] || { echo "warning: no executable bin/stack in $1; \`stack\` left off PATH" >&2; return 0; }
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "warning: $link exists and is not a symlink; leaving it alone" >&2
    return 0
  fi
  # Same rules as the app (provision.rs link_cli_for): a symlink to
  # something else is left alone; only a missing link (or one already
  # pointing at this stack's shim) is created.
  if [ -L "$link" ]; then
    local current got want
    current="$(readlink "$link")"
    want="$(lexical_path "$shim")"
    case "$current" in
      /*) got="$(lexical_path "$current")" ;;
      *) got="$(lexical_path "$BIN_DIR/$current")" ;;
    esac
    if [ "$got" != "$want" ]; then
      echo "warning: $link points at $current, not at the stack shim; leaving it alone" >&2
      return 0
    fi
  fi
  ln -sf "$shim" "$link"
  echo "linked $link -> $shim"
  case ":$PATH:" in
    *":$BIN_DIR:"*)
      if command -v stack >/dev/null 2>&1; then
        echo "stack on PATH: $(command -v stack)"
      else
        echo "warning: $link not resolving yet; open a new shell" >&2
      fi
      ;;
    *) echo "warning: $BIN_DIR is not on PATH; add: export PATH=\"$BIN_DIR:\$PATH\"" >&2 ;;
  esac
}

resolved="$(resolve_stack_dir)"
if [ -n "$resolved" ]; then
  link_stack_shim "$resolved"
else
  echo "warning: no stack checkout resolved; \`stack\` left off PATH (re-run after provisioning)" >&2
fi

echo ""
echo "done. Launch '$APP_NAME' from your app menu."
echo "To uninstall: scripts/uninstall-stack-app.sh --prefix $PREFIX"
