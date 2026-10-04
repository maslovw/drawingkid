#!/bin/sh
# Deploys the Drawing Kid server and web app to lsp (play.maslovw.de). Needs the one-time
# setup-lsp.sh first. Runs as lumpy; the only sudo is the allowed service restart.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Server code (data, .env and secrets on lsp are left alone).
rsync -a --delete --exclude data --exclude secrets --exclude .env --exclude test --exclude deploy \
  "$ROOT/server/" lsp:/opt/drawingkid-server/

# Web app. It has no config.local.json on purpose: on the public site parents type their
# own API key in Settings; the server's key is for the iPad app only.
rsync -a --delete --exclude config.local.json --exclude '*.pem' --exclude '*.py' --exclude '*.sh' \
  "$ROOT/web/" lsp:/var/www/play/drawingkid/
ssh lsp 'rm -f /var/www/play/drawingkid/config.local.json'

ssh lsp 'sudo systemctl restart drawingkid-server && sleep 2 && curl -fsS http://127.0.0.1:8787/health && echo'
