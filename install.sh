#!/usr/bin/env bash
#
# Panoptes, in one line:
#
#   curl -fsSL https://raw.githubusercontent.com/andreaderuvo/panoptes/master/install.sh | bash
#
# What it does, all of it:
#
#   ~/.local/share/panoptes       the code, downloaded as a tarball
#   ~/.local/share/panoptes/venv  a virtual environment with the four runtime dependencies
#   ~/.local/bin/panoptes         a three-line launcher
#
# What it does not do: touch anything outside your home, use sudo, install a package with
# your system's package manager, add a repository, phone anywhere, or start something in the
# background unless you ask with --service. There is nothing to consent to, which is why it
# does not ask — a `curl | bash` that cannot prompt (its stdin is the script) and asks anyway
# is theatre.
#
# Run it again to update: the code is replaced, the virtual environment is refreshed, and
# ~/.config/panoptes — your token, your devices, your journal — is never touched.
#
#   ... | bash -s -- --service     also install a systemd user service and start it
#   ... | bash -s -- --dir ~/opt   somewhere else
#   ... | bash -s -- uninstall     take it all back out
#
set -euo pipefail

REPO=${PANOPTES_REPO:-andreaderuvo/panoptes}
BRANCH=${PANOPTES_BRANCH:-master}
DIR=${PANOPTES_DIR:-$HOME/.local/share/panoptes}
BIN=${PANOPTES_BIN:-$HOME/.local/bin}
SERVICE=no
ACTION=install

# Colour only when somebody is looking at it.
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else B=''; G=''; Y=''; R=''; N=''; fi

say()  { printf '%s\n' "$*"; }
step() { printf '  %s%s%s\n' "$G" "$*" "$N"; }
warn() { printf '  %s%s%s\n' "$Y" "$*" "$N"; }
die()  { printf '\n  %s%s%s\n\n' "$R" "$*" "$N" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --service) SERVICE=yes ;;
    --dir) DIR=${2:?--dir wants a path}; shift ;;
    --branch) BRANCH=${2:?--branch wants a name}; shift ;;
    uninstall|--uninstall) ACTION=uninstall ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'; exit 0 ;;
    *) die "I do not know what --$1 means. --help lists what there is." ;;
  esac
  shift
done

say ""
say "  ${B}Panoptes${N} — one page for every machine you run agents on"
say ""

# ---------------------------------------------------------------- uninstall

if [ "$ACTION" = uninstall ]; then
  if command -v systemctl >/dev/null 2>&1 && [ -f "$HOME/.config/systemd/user/panoptes.service" ]; then
    systemctl --user disable --now panoptes.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/panoptes.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    step "the service is stopped and gone"
  fi
  rm -rf "$DIR"
  rm -f "$BIN/panoptes"
  step "removed $DIR and $BIN/panoptes"
  say ""
  say "  Your configuration is still at ${B}~/.config/panoptes${N} — the token, the machines you"
  say "  listed, the keys they gave you. Delete it yourself if you mean to; an uninstaller that"
  say "  throws away a fleet's worth of configuration is one that has overstepped."
  say ""
  exit 0
fi

# ----------------------------------------------------------------- preflight
#
# Everything is checked before anything is written, so a machine that cannot run Panoptes is a
# machine where nothing happened rather than one with half an install on it.

for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not here, and this script is made of it."
done

PY=""
for candidate in python3.14 python3.13 python3.12 python3.11 python3 python; do
  command -v "$candidate" >/dev/null 2>&1 || continue
  if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    PY=$candidate
    break
  fi
done
[ -n "$PY" ] || die "Panoptes wants Python 3.11 or newer, and I cannot find one.
  Debian/Ubuntu:  sudo apt install python3 python3-venv
  Fedora/RHEL:    sudo dnf install python3
  macOS:          brew install python@3.13"

step "python: $("$PY" -V 2>&1) at $(command -v "$PY")"

# No tmux check, and no tmux: a board holds one read-only key per machine and asks each one
# over HTTP. It has no shell, no filesystem and no terminal of its own — which is the whole
# security story and also why this installer is shorter than Argus's.

# ------------------------------------------------------------------ download
#
# A tarball rather than a clone: git is not on every machine, the app has no build step, and
# there is nothing here that a working tree buys. Into a temporary directory first, so a
# download that fails halfway leaves the copy you already had running.

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

step "downloading $REPO ($BRANCH)…"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" \
  | tar xz -C "$TMP" || die "the download failed. Is $REPO/$BRANCH the right place?"

FRESH=$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)
[ -f "$FRESH/app/main.py" ] || die "that tarball is not Panoptes — no app/main.py in it."

mkdir -p "$DIR" "$BIN"
# The venv is kept across an update: rebuilding it every time is thirty seconds of nothing.
KEEP=""
[ -d "$DIR/venv" ] && KEEP=yes
find "$DIR" -maxdepth 1 -mindepth 1 ! -name venv -exec rm -rf {} +
find "$FRESH" -maxdepth 1 -mindepth 1 -exec cp -R {} "$DIR/" \;
step "code in $DIR"

# --------------------------------------------------------------------- venv

if [ -z "$KEEP" ]; then
  "$PY" -m venv "$DIR/venv" 2>/dev/null || die "python could not make a virtual environment.
  On Debian and Ubuntu that means one more package:  sudo apt install python3-venv"
  step "virtual environment made"
fi

# Only the runtime block: everything below the `# Tests` line is for people working on Panoptes,
# and pytest has no business in an install.
sed '/^# Tests/,$d' "$DIR/requirements.txt" > "$TMP/runtime.txt"
"$DIR/venv/bin/python" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || true
"$DIR/venv/bin/python" -m pip install --quiet --upgrade -r "$TMP/runtime.txt" \
  || die "installing the dependencies failed. The five of them are in $DIR/requirements.txt."
step "dependencies: $(sed -n 's/^\([a-z-]*\).*/\1/p' "$TMP/runtime.txt" | grep -v '^$' | paste -sd' ' -)"

# ----------------------------------------------------------------- launcher

cat > "$BIN/panoptes" <<LAUNCH
#!/bin/sh
# Written by install.sh. Everything after \`panoptes\` is passed straight through.
cd "$DIR" || exit 1
exec "$DIR/venv/bin/python" -m app.main "\$@"
LAUNCH
chmod +x "$BIN/panoptes"
step "launcher at $BIN/panoptes"

# ------------------------------------------------------------------ service

if [ "$SERVICE" = yes ]; then
  if command -v systemctl >/dev/null 2>&1; then
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/panoptes.service" <<UNIT
[Unit]
Description=Panoptes — one board over every machine you run agents on
After=network.target

[Service]
Type=simple
ExecStart=$BIN/panoptes
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now panoptes.service
    step "service installed and started (systemctl --user status panoptes)"
    warn "It stops when you log out unless lingering is on, which is one command:"
    warn "    sudo loginctl enable-linger $USER"
  else
    warn "no systemd here, so no service. On macOS: put $BIN/panoptes in a launchd plist,"
    warn "or just run it in a tmux session of its own — it is one process."
  fi
fi

# --------------------------------------------------------------------- done

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) warn "$BIN is not on your PATH. Add it:"
     warn "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc" ;;
esac

say ""
say "  ${B}Done.${N} Start it:"
say ""
say "      panoptes                      # prints a URL with a token in it"
say "      panoptes --qr                 # and a code to photograph with a phone"
say ""
say "  The first run writes ~/.config/panoptes/config.yaml with a fresh token. Then tell it"
say "  about your machines — or tell your machines about it, both directions work:"
say "  https://github.com/$REPO/wiki/Machines-on-the-board"
say ""
say "  A board cannot get into anything: one read-only key per machine, never handed to a"
say "  browser, and no shell of its own. Losing it loses a list of session names."
say ""
say "  Run this same line again to update. To remove it: … | bash -s -- uninstall"
say ""
