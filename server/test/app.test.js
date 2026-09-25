import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { ProviderError } from '../src/provider.js';
import { BUNDLE_ID, signJws, startServer, transaction } from './helpers.js';

describe('stars and ideas', () => {
  let s;
  before(async () => (s = await startServer()));
  after(() => s.close());

  test('requires an account token', async () => {
    const r = await s.call('GET', '/v1/balance');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad-account');
  });

  test('the free star comes once', async () => {
    const account = randomUUID();
    assert.deepEqual((await s.call('GET', '/v1/balance', { account })).body, { stars: 0, fullStudio: false, freeStarClaimed: false });
    assert.equal((await s.call('POST', '/v1/stars/free', { account, body: {} })).body.granted, true);
    const again = await s.call('POST', '/v1/stars/free', { account, body: {} });
    assert.equal(again.body.granted, false);
    assert.equal(again.body.stars, 1);
  });

  test('no stars: ask a grown-up', async () => {
    const r = await s.call('POST', '/v1/ideas', { account: randomUUID(), body: { idea: 'a dragon' } });
    assert.equal(r.status, 402);
    assert.equal(r.body.error, 'no-stars');
  });

  test('one star buys the first page and 4 more tries', async () => {
    const account = randomUUID();
    await s.call('POST', '/v1/stars/free', { account, body: {} });
    const first = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a lighthouse with a whale' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.stars, 0);
    assert.equal(first.body.triesLeft, 4);
    assert.ok(Buffer.from(first.body.image, 'base64').subarray(1, 4).equals(Buffer.from('PNG')));

    let last;
    for (let i = 0; i < 4; i++) last = await s.call('POST', `/v1/ideas/${first.body.ideaId}/again`, { account });
    assert.equal(last.status, 200);
    assert.equal(last.body.triesLeft, 0);
    const over = await s.call('POST', `/v1/ideas/${first.body.ideaId}/again`, { account });
    assert.equal(over.status, 410);
    assert.equal(over.body.error, 'no-tries');
  });

  test("another account can't retry someone else's idea", async () => {
    const account = randomUUID();
    await s.call('POST', '/v1/stars/free', { account, body: {} });
    const first = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a snail race' } });
    const r = await s.call('POST', `/v1/ideas/${first.body.ideaId}/again`, { account: randomUUID() });
    assert.equal(r.status, 404);
  });

  test('a failed first page gives the star back', async () => {
    const account = randomUUID();
    await s.call('POST', '/v1/stars/free', { account, body: {} });
    s.provider.failNext = new ProviderError('down');
    const r = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a submarine' } });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'sleeping');
    assert.equal((await s.call('GET', '/v1/balance', { account })).body.stars, 1);
  });

  test('blocked ideas cost nothing', async () => {
    const account = randomUUID();
    await s.call('POST', '/v1/stars/free', { account, body: {} });
    const listed = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a pirate with a knife' } });
    assert.equal(listed.status, 422);
    s.provider.flagNext = true;
    const moderated = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a scary thing' } });
    assert.equal(moderated.status, 422);
    s.provider.failNext = new ProviderError('refused', { blocked: true });
    const refused = await s.call('POST', '/v1/ideas', { account, body: { idea: 'another scary thing' } });
    assert.equal(refused.body.error, 'blocked');
    assert.equal((await s.call('GET', '/v1/balance', { account })).body.stars, 1);
  });

  test('popular ideas come from the cache, and still cost a star', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    for (const account of [a, b]) await s.call('POST', '/v1/stars/free', { account, body: {} });
    await s.call('POST', '/v1/ideas', { account: a, body: { idea: 'A unicorn!' } });
    const calls = s.provider.calls;
    const r = await s.call('POST', '/v1/ideas', { account: b, body: { idea: 'a unicorn' } });
    assert.equal(r.status, 200);
    assert.equal(s.provider.calls, calls);
    assert.equal(r.body.stars, 0);
  });
});

describe('purchases and refunds', () => {
  let s;
  before(async () => (s = await startServer({ APPSTORE_ENVIRONMENTS: 'Sandbox' })));
  after(() => s.close());

  test('a star pack is credited once', async () => {
    const account = randomUUID();
    const signedTransaction = signJws(transaction({ appAccountToken: account }));
    const first = await s.call('POST', '/v1/purchases', { account, body: { signedTransaction } });
    assert.equal(first.body.credited, true);
    assert.equal(first.body.stars, 10);
    const replay = await s.call('POST', '/v1/purchases', { account, body: { signedTransaction } });
    assert.equal(replay.body.credited, false);
    assert.equal(replay.body.stars, 10);
  });

  test("a purchase made for another account isn't credited here", async () => {
    const r = await s.call('POST', '/v1/purchases', {
      account: randomUUID(),
      body: { signedTransaction: signJws(transaction({ appAccountToken: randomUUID() })) },
    });
    assert.equal(r.status, 403);
  });

  test('forged transactions are rejected', async () => {
    const r = await s.call('POST', '/v1/purchases', { account: randomUUID(), body: { signedTransaction: 'a.b.c' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad-transaction');
  });

  test('Full Studio: 3 stars for the buyer, none through Family Sharing', async () => {
    const buyer = randomUUID();
    const bought = await s.call('POST', '/v1/purchases', {
      account: buyer,
      body: { signedTransaction: signJws(transaction({ productId: 'drawingkid.fullstudio', appAccountToken: buyer })) },
    });
    assert.deepEqual([bought.body.stars, bought.body.fullStudio], [3, true]);

    const sibling = randomUUID();
    const shared = await s.call('POST', '/v1/purchases', {
      account: sibling,
      body: { signedTransaction: signJws(transaction({ productId: 'drawingkid.fullstudio', inAppOwnershipType: 'FAMILY_SHARED' })) },
    });
    assert.deepEqual([shared.body.stars, shared.body.fullStudio], [0, true]);
  });

  test('a refund takes back unspent stars and Full Studio', async () => {
    const account = randomUUID();
    const t = transaction({ productId: 'drawingkid.fullstudio', appAccountToken: account });
    await s.call('POST', '/v1/purchases', { account, body: { signedTransaction: signJws(t) } });
    await s.call('POST', '/v1/ideas', { account, body: { idea: 'a rocket' } }); // spends 1 of 3

    const signedPayload = signJws({
      notificationType: 'REFUND',
      signedDate: Date.now(),
      data: { bundleId: BUNDLE_ID, signedTransactionInfo: signJws(t) },
    });
    assert.equal((await s.call('POST', '/v1/appstore/notifications', { body: { signedPayload } })).status, 200);
    assert.deepEqual((await s.call('GET', '/v1/balance', { account })).body, { stars: 0, fullStudio: false, freeStarClaimed: false });
  });
});

describe('limits', () => {
  test('the daily cap puts the magic star to sleep', async () => {
    // Mock pages cost $0.02; a new one is refused once spend + $0.025 would pass $0.05.
    const s = await startServer({ DAILY_CAP_USD: '0.05', WORST_IMAGE_USD: '0.025' });
    try {
      const account = randomUUID();
      await s.call('POST', '/v1/admin/grant', { headers: { Authorization: 'Bearer secret' }, body: { account, stars: 5 } });
      assert.equal((await s.call('POST', '/v1/ideas', { account, body: { idea: 'a frog' } })).status, 200);
      assert.equal((await s.call('POST', '/v1/ideas', { account, body: { idea: 'a toad' } })).status, 200);
      assert.ok(s.logs.some((l) => /80% of the \$0.05 cap/.test(l.join(' '))));
      const r = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a newt' } });
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'sleeping');
      assert.equal((await s.call('GET', '/v1/balance', { account })).body.stars, 3);
    } finally {
      await s.close();
    }
  });

  test('too many pictures in an hour', async () => {
    const s = await startServer({ IMAGES_PER_HOUR: '2' });
    try {
      const account = randomUUID();
      await s.call('POST', '/v1/admin/grant', { headers: { Authorization: 'Bearer secret' }, body: { account, stars: 5 } });
      const first = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a frog' } });
      await s.call('POST', `/v1/ideas/${first.body.ideaId}/again`, { account });
      const r = await s.call('POST', `/v1/ideas/${first.body.ideaId}/again`, { account });
      assert.equal(r.status, 429);
    } finally {
      await s.close();
    }
  });

  test('browsers are refused: the web app uses its own key', async () => {
    const s = await startServer();
    try {
      const account = randomUUID();
      for (const headers of [
        { Origin: 'https://play.maslovw.de' },
        { 'Sec-Fetch-Site': 'same-origin' },
      ]) {
        const r = await s.call('POST', '/v1/ideas', { account, headers, body: { idea: 'a cat' } });
        assert.equal(r.status, 403);
        assert.equal(r.body.error, 'app-only');
        assert.equal(r.headers.get('access-control-allow-origin'), null);
      }
      assert.equal((await s.call('GET', '/health', { headers: { Origin: 'https://x.example' } })).status, 200);
      assert.equal((await s.call('GET', '/v1/balance', { account })).status, 200); // the app: no browser headers
    } finally {
      await s.close();
    }
  });

  test('admin endpoints need the token', async () => {
    const s = await startServer();
    try {
      const r = await s.call('POST', '/v1/admin/grant', { body: { account: randomUUID(), stars: 5 } });
      assert.equal(r.status, 401);
      const stats = await s.call('GET', '/v1/admin/stats', { headers: { Authorization: 'Bearer secret' } });
      assert.equal(stats.status, 200);
    } finally {
      await s.close();
    }
  });

  test('prompt text is deleted after 24 hours', async () => {
    let now = Date.now();
    const s = await startServer({}, { clock: () => now });
    try {
      const account = randomUUID();
      await s.call('POST', '/v1/stars/free', { account, body: {} });
      const first = await s.call('POST', '/v1/ideas', { account, body: { idea: 'a hedgehog' } });
      now += 25 * 3600_000;
      s.store.purge(s.config);
      assert.equal(s.store.idea(first.body.ideaId).prompt, null);
      const r = await s.call('POST', `/v1/ideas/${first.body.ideaId}/again`, { account });
      assert.equal(r.body.error, 'expired');
    } finally {
      await s.close();
    }
  });
});
