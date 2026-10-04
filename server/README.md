# Drawing Kid — server

The backend from [`handover.md`](../handover.md). It holds the OpenAI key, turns a child's idea into a coloring page, keeps each device's magic-star balance, verifies App Store purchases and caps daily spending. It's plain Node (22.13+) with no npm dependencies: SQLite comes from `node:sqlite`, and signatures from `node:crypto`.

```bash
cd server
npm test        # 27 tests, mock image provider
npm run dev     # http://127.0.0.1:8787, mock provider, dev mode
```

## How stars work

- **Accounts:** a device is known only by a random UUID, the StoreKit `appAccountToken`, sent as `X-Account-Token`. The iPad app keeps it in the Keychain and iCloud key-value store. The balance itself lives only here.
- **One star = one idea.** `POST /v1/ideas` takes a star and returns the first page, and `…/again` makes up to 4 more for free. If the first page fails or is blocked, the star goes back.
- **Free star:** once per account, and once per iPad through DeviceCheck bit 0, which survives reinstalls. Without DeviceCheck keys, free stars are refused (except in dev mode).
- **Purchases:** the app posts each StoreKit 2 transaction (`jwsRepresentation`). The server checks the chain up to the pinned Apple Root CA G3 (`certs/`), plus the bundle, environment and product, and credits it once.
  - Star packs credit only the account in the transaction's `appAccountToken`.
  - A Full Studio that arrives through Family Sharing unlocks the tools and brings `FAMILY_SHARED_STARS` stars (0 by default, an open question in the handover).
- **Refunds:** App Store Server Notifications V2 (`REFUND`, `REVOKE`) take back unspent stars and Full Studio.

## iPad app only

The public web app at `play.maslovw.de/drawingkid/` never uses this server. There, parents type their own OpenAI or Gemini key in Settings, and pages cost them their own money, not stars. The server enforces this: requests carrying the headers every browser sends (`Origin` or `Sec-Fetch-Site`) get `403 app-only`, and there's no CORS. The iPad app's URLSession, Apple's notification servers and `curl` don't send those headers.

This isn't authentication: someone could call the API from a script. But they'd only spend stars, and stars come only from App Store purchases, DeviceCheck free stars and your grants. App Attest (below) will close that too.

## Safety and privacy

- **Personal details:** removed from the idea before it goes anywhere (`src/prompt.js`): capitalized names and places after the first word, numbers, emails, links, "my/our". "me and Anna at our house in Berlin" becomes "a child and at a house". A name as the very first word ("Anna on a horse") still gets through, because dictation capitalizes the first word of every sentence anyway.
- **Moderation:** a short blocklist (EN/DE/RU), then OpenAI moderation on the text and on the returned image. If moderation can't be reached, nothing is generated.
- **Retention:** prompt text is deleted after 24 hours and idea rows after 7 days. The prompt cache stores only a hash and the picture.
- **Spending:**
  - `DAILY_CAP_USD` stops generation for the day, with an alert at 80% and 100% (log line plus optional `ALERT_WEBHOOK_URL`).
  - `IMAGES_PER_HOUR` limits each account.
  - nginx also rate-limits each IP address.

The child never sees an error text. Every failure is a code (`no-stars`, `blocked`, `sleeping`, `slow-down`, `no-tries`, `expired`) that the app shows as a picture.

## API

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/health` | | `{ ok }` |
| GET | `/v1/balance` | | `{ stars, fullStudio, freeStarClaimed }` |
| POST | `/v1/stars/free` | `{ deviceToken }` (DeviceCheck) | `{ granted, …balance }` |
| POST | `/v1/purchases` | `{ signedTransaction }` | `{ credited, …balance }` |
| POST | `/v1/appstore/notifications` | `{ signedPayload }` (Apple calls this) | `{ ok }` |
| POST | `/v1/ideas` | `{ idea }` | `{ ideaId, image (base64 PNG), mimeType, triesLeft, stars }` |
| POST | `/v1/ideas/:id/again` | | same as above |
| POST | `/v1/admin/grant` | `{ account, stars }`, `Authorization: Bearer $ADMIN_TOKEN` | balance |
| GET | `/v1/admin/stats?since=YYYY-MM-DD` | admin token | today's spend and counters for the launch metrics |

For support or testing, `deploy/grant.sh <account> [stars]` gives stars to an account (it reads the admin token on lsp with sudo). By hand:

```bash
curl -X POST https://play.maslovw.de/api/drawingkid/v1/admin/grant -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"account":"<id>","stars":10}'
```

## Deploy on lsp

The server lives at `https://play.maslovw.de/api/drawingkid/`, next to the web app at `https://play.maslovw.de/drawingkid/`. Future games get their own folders under `play.maslovw.de`.

- **How it runs:** as a systemd service behind nginx (like `diabetic-recipes`), using Node 22 on the host. A `Dockerfile` and `docker-compose.yml` are included for hosts that have Docker; lsp doesn't.
- **Cookies:** nginx strips the family-login cookie, so no game ever receives it.

**First time** (needs sudo on lsp):

1. Upload the code: `rsync -a --exclude data --exclude .git ./ lsp:~/drawingkid-staging/` from the repo root.
2. Optionally, put the OpenAI key in `lsp:~/drawingkid-staging/openai.key`. The setup script moves it into `.env` and deletes the file.
3. Run `ssh -t lsp 'sudo sh ~/drawingkid-staging/server/deploy/setup-lsp.sh'`. It creates:
   - the `drawingkid` user and `.env` with a random admin token;
   - the systemd service and the nginx site;
   - a sudoers rule that lets `lumpy` restart this one service.
4. Get the certificate: `ssh -t lsp 'sudo certbot --nginx -d play.maslovw.de'`.
5. Deploy: `server/deploy/deploy.sh`.

**Every deploy after that:** `server/deploy/deploy.sh`. It copies the server and the web app (never a `config.local.json`) and restarts the service. No password is needed.

**App Store Connect:** the App Store Server Notifications V2 URL is `https://play.maslovw.de/api/drawingkid/v1/appstore/notifications`.

## Not done yet

- **App Attest:** the handover asks that only the real app can call the proxy. It needs the app to exist, and until then the admin token, the per-account and per-IP limits and the daily cap are the guard.
- **iPad app side:** StoreKit 2 purchases with `appAccountToken`, DeviceCheck tokens, and the Keychain/iCloud copy of the account ID. The Swift app has none of this yet.
