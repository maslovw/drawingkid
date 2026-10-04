#!/bin/sh
# Gives magic stars to a device: server/deploy/grant.sh <account-id> [stars]
# The account id is shown in the app under Settings → Log. Asks for the sudo password
# on lsp, because the admin token lives in the root-only .env.
set -e
[ -n "$1" ] || { echo "usage: $0 <account-id> [stars]" >&2; exit 1; }
ssh -t lsp "T=\$(sudo sed -n 's/^ADMIN_TOKEN=//p' /opt/drawingkid-server/.env) && \
  curl -sS -X POST -H \"Authorization: Bearer \$T\" -H 'Content-Type: application/json' \
  -d '{\"account\":\"$1\",\"stars\":${2:-10}}' http://127.0.0.1:8787/v1/admin/grant && echo"
