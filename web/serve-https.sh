#!/usr/bin/env bash
# Serve web/ over HTTPS so an iPad on the same Wi-Fi gets a secure context
# (needed for the Web Share API "Save to Photos" sheet).
#
#   ./serve-https.sh        serve the app at https://<lan-ip>:8443
#   ./serve-https.sh ca     serve mkcert's root CA at http://<lan-ip>:8001 for the iPad to install
#
# Needs mkcert (brew install mkcert). Certificates are kept outside web/ so the
# private key is never served.
set -euo pipefail

WEB_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8443}"
CA_PORT="${CA_PORT:-8001}"
CERT_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/drawingkid-certs"

if ! command -v mkcert >/dev/null; then
  echo "mkcert not found. Install it with: brew install mkcert && mkcert -install" >&2
  exit 1
fi

lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null ||
    hostname -I 2>/dev/null | awk '{print $1}'
}
IP="$(lan_ip || true)"

if [[ "${1:-}" == "ca" ]]; then
  CA_DIR="$(mktemp -d)"
  trap 'rm -rf "$CA_DIR"' EXIT
  # Only the public certificate; rootCA-key.pem stays in the CA root.
  cp "$(mkcert -CAROOT)/rootCA.pem" "$CA_DIR/DrawingKid-rootCA.crt"
  cat <<EOF
On the iPad:
  1. Safari: http://${IP:-<lan-ip>}:$CA_PORT/DrawingKid-rootCA.crt  -> Allow
  2. Settings -> Profile Downloaded -> Install
  3. Settings -> General -> About -> Certificate Trust Settings -> turn on the mkcert CA
Press Ctrl+C when done.
EOF
  (cd "$CA_DIR" && python3 -m http.server "$CA_PORT" --bind 0.0.0.0)
  exit
fi

# Reissue the certificate when the LAN IP changes.
NAMES="localhost 127.0.0.1 ${IP}"
mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_DIR/cert.pem" || "$(cat "$CERT_DIR/names" 2>/dev/null)" != "$NAMES" ]]; then
  # shellcheck disable=SC2086
  mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" $NAMES
  echo "$NAMES" > "$CERT_DIR/names"
fi

echo "Serving https://localhost:$PORT${IP:+ and https://$IP:$PORT}"
exec python3 - "$CERT_DIR/cert.pem" "$CERT_DIR/key.pem" "$WEB_DIR" "$PORT" <<'EOF'
import http.server, os, ssl, sys

cert, key, root, port = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
os.chdir(root)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)

class Server(http.server.ThreadingHTTPServer):
    def finish_request(self, request, client_address):
        # Handshake in the worker thread, so a stalled client can't block accept()
        try:
            request = ctx.wrap_socket(request, server_side=True)
        except (ssl.SSLError, OSError) as e:
            # "certificate unknown" here means the device doesn't trust the mkcert CA yet
            print(f"TLS handshake failed from {client_address[0]}: {e}", flush=True)
            return
        super().finish_request(request, client_address)

Server(("0.0.0.0", port), http.server.SimpleHTTPRequestHandler).serve_forever()
EOF
