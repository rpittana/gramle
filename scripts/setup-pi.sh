#!/usr/bin/env bash
# One-time setup for running Gramle on a Raspberry Pi.
# Installs Node deps, Python + Instaloader (in a venv), creates the cache
# directory, and installs the systemd unit. Run from the project root:
#   bash scripts/setup-pi.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${CACHE_DIR:-/var/cache/game}"
SERVICE_USER="${SERVICE_USER:-$(whoami)}"
VENV_DIR="$APP_DIR/venv"

# nvm-installed Node isn't on a non-interactive shell's PATH by default (it's
# only wired up via .bashrc), so pick it up here if present. This also makes
# sure the *absolute* node path (below) is one systemd can use directly,
# since systemd services don't source .bashrc/.profile either.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found on PATH (checked nvm too). Install Node first." >&2
  exit 1
fi
NODE_BIN="$(command -v node)"

echo "==> Installing system packages (python3, venv, build deps for sharp)"
sudo apt-get update
sudo apt-get install -y python3 python3-venv

echo "==> Creating a Python venv for Instaloader at $VENV_DIR"
# Debian/Raspberry Pi OS marks the system Python as "externally managed"
# (PEP 668) and refuses a plain `pip install`, even with --user. A venv
# sidesteps that instead of forcing --break-system-packages on the OS Python.
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install --upgrade instaloader
INSTALOADER_BIN="$VENV_DIR/bin/instaloader"

echo "==> Installing Node dependencies"
cd "$APP_DIR"
npm install --omit=dev

echo "==> Creating cache directory at $CACHE_DIR"
sudo mkdir -p "$CACHE_DIR"
sudo chown "$SERVICE_USER":"$SERVICE_USER" "$CACHE_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> No .env found — copying .env.example. Set GAME_PASSWORD before starting!"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

echo "==> Pointing INSTALOADER_BIN at the venv binary in .env"
if grep -q '^INSTALOADER_BIN=' "$APP_DIR/.env"; then
  sed -i "s|^INSTALOADER_BIN=.*|INSTALOADER_BIN=$INSTALOADER_BIN|" "$APP_DIR/.env"
else
  echo "INSTALOADER_BIN=$INSTALOADER_BIN" >> "$APP_DIR/.env"
fi

echo "==> Installing systemd unit (node: $NODE_BIN)"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__SERVICE_USER__|$SERVICE_USER|g" -e "s|__NODE_BIN__|$NODE_BIN|g" \
  "$APP_DIR/systemd/gramle.service" | sudo tee /etc/systemd/system/gramle.service > /dev/null
sudo systemctl daemon-reload

echo "==> Done. Edit $APP_DIR/.env (set GAME_PASSWORD), then:"
echo "    sudo systemctl enable --now gramle"
