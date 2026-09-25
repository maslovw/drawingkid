#!/bin/sh
# One-time setup of play.maslovw.de on lsp. Run from the uploaded copy as root:
#   ssh -t lsp 'sudo sh ~/drawingkid-staging/server/deploy/setup-lsp.sh'
# Safe to run again: existing .env, data and certificates are kept.
set -e
STAGE=/home/lumpy/drawingkid-staging
APP=/opt/drawingkid-server
WEB=/var/www/play/drawingkid

# Service user that owns only the data folder.
id drawingkid >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin drawingkid

# Code and web files belong to lumpy, so later deploys (deploy.sh) need no sudo.
mkdir -p "$APP/data" "$WEB"
chown lumpy:lumpy "$APP" /var/www/play "$WEB"
chown drawingkid:drawingkid "$APP/data" && chmod 700 "$APP/data"

# Secrets: .env readable by root only (systemd reads it before dropping to drawingkid).
if [ ! -f "$APP/.env" ]; then
  cp "$STAGE/server/.env.example" "$APP/.env"
  sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$(openssl rand -hex 32)|" "$APP/.env"
  if [ -f "$STAGE/openai.key" ]; then
    sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$(cat "$STAGE/openai.key")|" "$APP/.env"
  fi
fi
rm -f "$STAGE/openai.key"
chown root:root "$APP/.env" && chmod 600 "$APP/.env"

# lumpy may restart the service without a password (and nothing else).
echo 'lumpy ALL=(root) NOPASSWD: /usr/bin/systemctl restart drawingkid-server, /usr/bin/systemctl status drawingkid-server' \
  > /etc/sudoers.d/drawingkid && chmod 440 /etc/sudoers.d/drawingkid && visudo -cf /etc/sudoers.d/drawingkid

cp "$STAGE/server/deploy/drawingkid-server.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable drawingkid-server

# Only the first time: certbot adds its HTTPS lines to this file afterwards.
[ -f /etc/nginx/sites-available/play ] || cp "$STAGE/server/deploy/nginx-play.conf" /etc/nginx/sites-available/play
[ -L /etc/nginx/sites-enabled/play ] || ln -s /etc/nginx/sites-available/play /etc/nginx/sites-enabled/play
nginx -t && systemctl reload nginx

echo
echo "Setup done. Next:"
echo "  1. sudo certbot --nginx -d play.maslovw.de     (once DNS answers)"
echo "  2. from the Mac: server/deploy/deploy.sh"
echo "  Admin token: sudo grep ADMIN_TOKEN $APP/.env"
