// HTTP API. The app identifies itself with its StoreKit appAccountToken (a random UUID)
// in the X-Account-Token header; there are no logins and no personal data.
//
// Errors carry a code, never text for the child. The app shows a picture for each:
//   no-stars      402  ask a grown-up
//   blocked       422  try another idea (nothing charged)
//   sleeping      503  the magic star is asleep: provider down or daily budget used up
//   slow-down     429  too many pictures this hour
//   no-tries      410  this star's retries are used up
//   expired       410  the idea is too old to retry

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { PromptRejected, cacheKeyText, cleanIdea, coloringPrompt } from './prompt.js';
import { ProviderError } from './provider.js';
import { PRODUCTS, VerificationError } from './storekit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 64 * 1024;
const ALERT_PERCENTS = [80, 100];

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function createApp({ config, store, provider, appStore, deviceCheck, fetch = globalThis.fetch, log = console }) {
  const cacheDir = join(config.dataDir, 'cache');
  mkdirSync(cacheDir, { recursive: true });

  // --- Helpers ---------------------------------------------------------------

  function accountOf(req) {
    const token = req.headers['x-account-token'];
    if (!token || !UUID.test(token)) throw new HttpError(400, 'bad-account');
    return token.toLowerCase();
  }

  function requireAdmin(req) {
    const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
    const expected = Buffer.from(config.adminToken);
    if (!config.adminToken || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError(401, 'unauthorized');
    }
  }

  function balance(account) {
    const a = store.account(account);
    return { stars: a.stars, fullStudio: a.fullStudio, freeStarClaimed: a.freeStarClaimed };
  }

  function checkLimits(account) {
    if (store.imagesInLastHour(account) >= config.imagesPerHourPerAccount) {
      store.count('rate-limited');
      throw new HttpError(429, 'slow-down');
    }
    if (store.spendToday().usd + config.worstImageUsd > config.dailyCapUsd) {
      store.count('capped');
      throw new HttpError(503, 'sleeping');
    }
  }

  async function alertOnSpend() {
    const { usd, alerted_at_percent: alerted } = store.spendToday();
    const percent = ALERT_PERCENTS.filter((p) => usd >= (config.dailyCapUsd * p) / 100).at(-1);
    if (!percent || percent <= alerted) return;
    store.markAlerted(percent);
    const text = `Drawing Kid: today's image spend is $${usd.toFixed(2)} (${percent}% of the $${config.dailyCapUsd} cap).`;
    log.warn(text);
    if (!config.alertWebhookUrl) return;
    try {
      await fetch(config.alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (error) {
      log.error('alert webhook failed:', error.message);
    }
  }

  // Makes one image for the prompt and checks it. Throws HttpError blocked/sleeping.
  async function makeImage(prompt) {
    let result;
    try {
      result = await provider.generate(coloringPrompt(prompt));
    } catch (error) {
      if (error instanceof ProviderError && error.blocked) throw new HttpError(422, 'blocked');
      log.error('generation failed:', error.message);
      throw new HttpError(503, 'sleeping');
    }
    if (config.moderateImages && (await moderate({ png: result.png }))) throw new HttpError(422, 'blocked');
    return result;
  }

  // True if flagged. If the moderation service is down, nothing is generated.
  async function moderate(input) {
    try {
      return await provider.flagged(input);
    } catch (error) {
      log.error('moderation failed:', error.message);
      throw new HttpError(503, 'sleeping');
    }
  }

  function imageReply(account, ideaId, png, images) {
    return {
      ideaId,
      image: png.toString('base64'),
      mimeType: 'image/png',
      triesLeft: Math.max(0, 1 + config.retriesPerStar - images),
      stars: store.account(account).stars,
    };
  }

  // --- Routes ------------------------------------------------------------------

  const routes = {
    'GET /health': () => ({ ok: true }),

    'GET /v1/balance': ({ req }) => balance(accountOf(req)),

    // One free star per account and per iPad (DeviceCheck survives reinstalls).
    'POST /v1/stars/free': async ({ req, body }) => {
      const account = accountOf(req);
      if (store.account(account).freeStarClaimed) return { granted: false, ...balance(account) };
      if (!deviceCheck) throw new HttpError(503, 'sleeping');
      if (!config.devMode && typeof body.deviceToken !== 'string') throw new HttpError(400, 'bad-request');
      try {
        if (await deviceCheck.freeStarUsed(body.deviceToken)) {
          store.count('free-star-refused');
          return { granted: false, ...balance(account) };
        }
        // Marked before crediting: if Apple can't be reached, no star is given.
        await deviceCheck.markFreeStarUsed(body.deviceToken);
      } catch (error) {
        log.error('DeviceCheck failed:', error.message);
        throw new HttpError(503, 'sleeping');
      }
      const granted = store.claimFreeStar(account);
      if (granted) store.count('free-star');
      return { granted, ...balance(account) };
    },

    // The app sends each StoreKit 2 transaction (Transaction.jwsRepresentation) here,
    // then finishes it. Replays and restores are credited only once.
    'POST /v1/purchases': ({ req, body }) => {
      const account = accountOf(req);
      let t;
      try {
        t = appStore.verifyTransaction(body.signedTransaction);
      } catch (error) {
        if (error instanceof VerificationError) {
          log.warn('purchase rejected:', error.message);
          throw new HttpError(400, 'bad-transaction');
        }
        throw error;
      }
      if (t.revocationDate) throw new HttpError(400, 'revoked');
      const familyShared = t.inAppOwnershipType === 'FAMILY_SHARED';
      const tokenMatches = t.appAccountToken?.toLowerCase() === account;
      if (t.appAccountToken && !tokenMatches) throw new HttpError(403, 'wrong-account');
      // Stars only go to the account the purchase was made for; a family-shared Full
      // Studio unlocks the tools but brings FAMILY_SHARED_STARS stars (0 by default).
      const stars = familyShared ? (t.product.fullStudio ? config.familySharedStars : 0) : tokenMatches ? t.product.stars : 0;
      const credited = store.recordTransaction({
        transactionId: String(t.transactionId),
        originalTransactionId: String(t.originalTransactionId ?? t.transactionId),
        account,
        productId: t.productId,
        stars,
        fullStudio: Boolean(t.product.fullStudio),
        ownership: t.inAppOwnershipType ?? 'PURCHASED',
        environment: t.environment,
      });
      if (credited) store.count(`purchase:${t.productId}`);
      return { credited, ...balance(account) };
    },

    // App Store Server Notifications V2. Refunds and revocations take the purchase back.
    'POST /v1/appstore/notifications': ({ body }) => {
      let n;
      try {
        n = appStore.verifyNotification(body.signedPayload);
      } catch (error) {
        if (error instanceof VerificationError) {
          log.warn('notification rejected:', error.message);
          throw new HttpError(400, 'bad-notification');
        }
        throw error;
      }
      store.count(`notification:${n.notificationType}`);
      if ((n.notificationType === 'REFUND' || n.notificationType === 'REVOKE') && n.transaction) {
        const product = PRODUCTS[n.transaction.productId];
        const revoked = store.revokeTransaction(String(n.transaction.transactionId), { fullStudio: Boolean(product?.fullStudio) });
        if (revoked) store.count('refund');
      }
      return { ok: true };
    },

    // A new idea: takes a star, returns the first page. The star comes back if no page
    // could be made.
    'POST /v1/ideas': async ({ req, body }) => {
      const account = accountOf(req);
      checkLimits(account);
      let prompt;
      try {
        prompt = cleanIdea(body.idea);
      } catch (error) {
        if (!(error instanceof PromptRejected)) throw error;
        store.count('blocked');
        throw new HttpError(422, 'blocked');
      }
      if (!store.takeStar(account)) throw new HttpError(402, 'no-stars');

      const ideaId = randomUUID();
      store.createIdea({ id: ideaId, account, prompt, charged: true });
      store.count('star-spent');
      const key = createHash('sha256').update(`${cacheKeyText(prompt)}|${config.imageSize}|${config.imageModel}`).digest('hex');
      try {
        const cachedFile = store.cached(key);
        if (cachedFile) {
          store.countImage(ideaId);
          store.recordGeneration({ account, ideaId, cached: true, costUsd: 0 });
          store.count('cache-hit');
          return imageReply(account, ideaId, readFileSync(join(cacheDir, cachedFile)), 1);
        }
        if (await moderate({ text: prompt })) throw new HttpError(422, 'blocked');
        const { png, costUsd } = await makeImage(prompt);
        store.countImage(ideaId);
        store.recordGeneration({ account, ideaId, cached: false, costUsd });
        store.count('image');
        writeFileSync(join(cacheDir, `${key}.png`), png);
        store.putCache(key, `${key}.png`);
        await alertOnSpend();
        return imageReply(account, ideaId, png, 1);
      } catch (error) {
        store.refundIdea(ideaId);
        store.count('star-refunded');
        if (error.code === 'blocked') store.count('blocked');
        throw error;
      }
    },

    // Another page for the same idea, free until the star's retries are used up.
    'POST /v1/ideas/:id/again': async ({ req, params }) => {
      const account = accountOf(req);
      const idea = store.idea(params.id);
      if (!idea || idea.account !== account) throw new HttpError(404, 'not-found');
      if (idea.images >= 1 + config.retriesPerStar) throw new HttpError(410, 'no-tries');
      if (idea.prompt === null) throw new HttpError(410, 'expired');
      checkLimits(account);
      const { png, costUsd } = await makeImage(idea.prompt).catch((error) => {
        if (error.code === 'blocked') store.count('blocked');
        throw error;
      });
      store.countImage(idea.id);
      store.recordGeneration({ account, ideaId: idea.id, cached: false, costUsd });
      store.count('image');
      store.count('retry');
      await alertOnSpend();
      return imageReply(account, idea.id, png, idea.images + 1);
    },

    // --- Grown-up / operator endpoints (ADMIN_TOKEN) -----------------------------

    // Stars for an account without a purchase: the family web app, support, testing.
    'POST /v1/admin/grant': ({ req, body }) => {
      requireAdmin(req);
      const stars = Number(body.stars);
      if (!UUID.test(body.account ?? '') || !Number.isInteger(stars) || stars < 1 || stars > 1000) {
        throw new HttpError(400, 'bad-request');
      }
      store.addStars(body.account.toLowerCase(), stars);
      store.count('admin-grant', stars);
      return balance(body.account.toLowerCase());
    },

    // Counters for the launch metrics, plus today's spend.
    'GET /v1/admin/stats': ({ req, url }) => {
      requireAdmin(req);
      const since = url.searchParams.get('since') ?? '0000-00-00';
      return { spendToday: store.spendToday().usd, counts: Object.fromEntries(store.stats(since).map((r) => [r.name, r.count])) };
    },
  };

  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, path] = key.split(' ');
    const names = [];
    const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, name) => (names.push(name), '([^/]+)'))}$`);
    return { method, re, names, handler };
  });

  function route(method, pathname) {
    for (const r of compiled) {
      const m = r.method === method && pathname.match(r.re);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }

  // --- HTTP plumbing -----------------------------------------------------------

  // The server's OpenAI key is for the iPad app only; the web app uses the parent's own
  // key. Browsers mark requests with Origin and/or Sec-Fetch-Site (Safari 16.4+, Chrome,
  // Firefox); the app's URLSession, Apple's notification servers and curl send neither.
  // (Sec-Fetch-Mode alone proves nothing: Node's fetch sends it too.) No CORS either, so
  // a page on another site can't read the answers.
  const fromBrowser = (req) => Boolean(req.headers.origin || req.headers['sec-fetch-site']);

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'too-large');
      chunks.push(chunk);
    }
    if (!size) return {};
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return body && typeof body === 'object' ? body : {};
    } catch {
      throw new HttpError(400, 'bad-json');
    }
  }

  function send(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(json);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const match = route(req.method, url.pathname);
    try {
      if (url.pathname !== '/health' && fromBrowser(req)) throw new HttpError(403, 'app-only');
      if (!match) throw new HttpError(404, 'not-found');
      const body = req.method === 'POST' ? await readJson(req) : {};
      send(res, 200, await match.handler({ req, body, url, params: match.params }));
    } catch (error) {
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.code, ...error.extra });
      } else {
        log.error(error);
        send(res, 500, { error: 'server' });
      }
    }
  }

  return { handle, server: () => createServer(handle) };
}
