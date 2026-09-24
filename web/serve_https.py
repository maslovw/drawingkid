#!/usr/bin/env python3
"""Serve the app over HTTPS on the home network, so the iPad allows the microphone
(voice input) and the share sheet. Browsers only enable those on https:// pages.

Usage (from the web/ folder, after making a certificate with mkcert, see README):
    python3 serve_https.py 192.168.1.122.pem 192.168.1.122-key.pem [port]
Then open https://<this computer's IP>:8443 on the iPad.
"""

import http.server
import os
import ssl
import sys


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cert, key = sys.argv[1], sys.argv[2]
    port = int(sys.argv[3]) if len(sys.argv) > 3 else 8443
    root = os.path.dirname(os.path.abspath(__file__))

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)

    handler = lambda *args: http.server.SimpleHTTPRequestHandler(*args, directory=root)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"Serving {root} at https://0.0.0.0:{port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
