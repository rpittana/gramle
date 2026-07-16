#!/usr/bin/env bash
# One-time setup for running Gramle on a Raspberry Pi.
# Installs Node deps, Python + Instaloader, creates the cache directory, and
# installs the systemd unit. Run from the project root: bash scripts/setup-pi.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${CACHE_DIR:-/var/cache/game}"
SERVICE_USER="${SERVICE_USER:-$(whoami)}"

echo "==> Installing system packages (python3, pip, build deps for sharp)"
sudo apt-get update
sudo apt-get install -y python3 python3-pip

echo "==> Installing Instaloader"
pip3 install --user --upgrade instaloader
# Make sure the service can find the instaloader binary Node spawns.
INSTALOADER_BIN="$(python3 -m site --user-base)/bin"
if ! command -v instaloader >/dev/null 2>&1; then
  echo "NOTE: add $INSTALOADER_BIN to PATH (e.g. in ~/.profile) so 'instaloader' resolves."
fi

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

echo "==> Installing systemd unit"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__SERVICE_USER__|$SERVICE_USER|g" \
  "$APP_DIR/systemd/gramle.service" | sudo tee /etc/systemd/system/gramle.service > /dev/null
sudo systemctl daemon-reload

echo "==> Done. Edit $APP_DIR/.env (set GAME_PASSWORD), then:"
echo "    sudo systemctl enable --now gramle"
