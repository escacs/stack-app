#!/usr/bin/env bash
# Provision the escacs/stack checkout so first launch just works.
#
# The stack repo is private, so cloning needs auth. Strategy, least friction
# first:
#   1. If a usable checkout is already resolvable (settings, $ESCACS_STACK,
#      or ~/escacs/stack), keep it and persist its path to the app config.
#   2. Else if `gh` is authenticated, `gh repo clone escacs/stack`.
#   3. Else try an ssh clone in batch mode (fails fast, never prompts).
#   4. Else print fallback guidance: the app's first-run folder picker.
#
# Persistence goes to the app config's stack_path (settings override wins in
# the app's resolve order), because GUI-launched apps do not inherit shell
# profile env vars. $ESCACS_STACK is still honoured when set.
#
# Never handles credentials: auth stays inside gh/ssh.
#
# Usage: provision-stack.sh [--dir <path>] [--config-home <path>] [--json]
#   --dir         where the stack checkout should live (default ~/escacs/stack)
#   --config-home override for ${XDG_CONFIG_HOME:-$HOME/.config} (testing)
#   --json        print a one-line JSON result for other installers

set -u

APP_ID="codes.escacs.stack"
STACK_REPO="escacs/stack"
DEFAULT_DIR="$HOME/escacs/stack"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

DIR="$DEFAULT_DIR"
JSON="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --config-home) CONFIG_HOME="$2"; shift 2 ;;
    --json) JSON="yes"; shift ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *) echo "provision-stack.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

CONFIG_FILE="$CONFIG_HOME/$APP_ID/config.json"

say() {  # say <json-status> <message...>
  local status="$1"; shift
  if [ "$JSON" = "yes" ]; then
    printf '{"status":"%s","message":"%s"}\n' "$status" "$*" >&2
  else
    echo "$*"
  fi
}

# A checkout is usable when it is a git repo with HEAD and ships the CLI.
usable() {  # usable <dir>
  [ -f "$1/tools/stack/cli.mjs" ] && [ -f "$1/.git/HEAD" ]
}

# configured_path prints the stack_path already in config.json, if any.
configured_path() {
  [ -f "$CONFIG_FILE" ] || return 1
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
try:
    p = json.load(open(sys.argv[1])).get("stackPath")
    print(p or "")
except Exception:
    print("")' "$CONFIG_FILE" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e 'try{const c=require(process.argv[1]);console.log(c.stackPath||"")}catch(e){console.log("")}' "$CONFIG_FILE" 2>/dev/null
  else
    return 1
  fi
}

# persist_path <dir> merges stackPath into config.json, keeping other keys.
persist_path() {
  local dir="$1"
  mkdir -p "$(dirname "$CONFIG_FILE")"
  if command -v python3 >/dev/null 2>&1; then
    STACK_DIR="$dir" CONFIG_FILE="$CONFIG_FILE" python3 - <<'EOF'
import json, os
path = os.environ["CONFIG_FILE"]
try:
    with open(path) as f:
        cfg = json.load(f)
    if not isinstance(cfg, dict):
        cfg = {}
except (OSError, ValueError):
    cfg = {}
cfg["stackPath"] = os.environ["STACK_DIR"]
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
EOF
  elif command -v node >/dev/null 2>&1; then
    STACK_DIR="$dir" CONFIG_FILE="$CONFIG_FILE" node -e '
const fs = require("fs");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, "utf8")); } catch (e) { /* fresh */ }
if (typeof cfg !== "object" || cfg === null) cfg = {};
cfg.stackPath = process.env.STACK_DIR;
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");'
  elif [ ! -f "$CONFIG_FILE" ]; then
    # No JSON tooling and no existing config: a fresh minimal file is safe.
    esc_dir=$(printf '%s' "$dir" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{\n  "stackPath": "%s"\n}\n' "$esc_dir" >"$CONFIG_FILE"
  else
    return 1
  fi
}

# 1. Already resolvable? Keep it and make sure it is persisted.
for candidate in "$(configured_path 2>/dev/null)" "${ESCACS_STACK:-}" "$DIR"; do
  [ -n "$candidate" ] || continue
  if usable "$candidate"; then
    resolved="$(cd "$candidate" && pwd)"
    if persist_path "$resolved"; then
      say "ready" "stack checkout ready: $resolved (pinned in app settings)."
    else
      say "ready" "stack checkout ready: $resolved (could not write $CONFIG_FILE; the app will still find it via lookup)."
    fi
    [ "$JSON" = "yes" ] && printf '{"status":"ready","path":"%s"}\n' "$resolved"
    exit 0
  fi
done

# 2. Clone via gh when authenticated.
if [ ! -e "$DIR" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  say "clone" "cloning $STACK_REPO with gh to $DIR ..."
  if gh repo clone "$STACK_REPO" "$DIR" -- --depth 1 >&2; then
    usable "$DIR" && persist_path "$(cd "$DIR" && pwd)"
    [ "$JSON" = "yes" ] && printf '{"status":"ready","path":"%s"}\n' "$(cd "$DIR" && pwd)"
    exit 0
  else
    say "clone" "gh clone failed; trying ssh."
  fi
fi

# 3. Batch-mode ssh clone: fails fast, never prompts for passwords.
if [ ! -e "$DIR" ] && command -v git >/dev/null 2>&1; then
  say "clone" "trying ssh clone to $DIR (no prompts) ..."
  if GIT_TERMINAL_PROMPT=0 \
     git -c core.sshCommand='ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new' \
     clone --depth 1 "git@github.com:$STACK_REPO.git" "$DIR" >&2; then
    usable "$DIR" && persist_path "$(cd "$DIR" && pwd)"
    [ "$JSON" = "yes" ] && printf '{"status":"ready","path":"%s"}\n' "$(cd "$DIR" && pwd)"
    exit 0
  fi
  # Do not leave a half clone behind.
  rm -rf "$DIR"
fi

# 4. Fallback: the app's first-run folder picker.
if [ -e "$DIR" ]; then
  say "manual" "$DIR exists but is not a usable stack checkout (needs .git/HEAD and tools/stack/cli.mjs); leaving it alone."
else
  say "manual" "could not provision the stack checkout automatically (the $STACK_REPO repo is private and no GitHub auth was found)."
fi
echo ""
echo "On first launch the app asks for the stack folder. Either:"
echo "  - authenticate once, then re-run this script:  gh auth login"
echo "  - or clone it yourself and pick the folder in the app:"
echo "      git clone git@github.com:$STACK_REPO.git $DIR"
[ "$JSON" = "yes" ] && printf '{"status":"manual"}\n'
exit 3
