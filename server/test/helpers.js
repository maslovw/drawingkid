// Test helpers: a server on a random port with the mock provider, and a signer that
// makes App Store JWS with the fake chain in test/fixtures.

import { X509Certificate, createPrivateKey, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDeviceCheck } from '../src/devicecheck.js';
import { createProvider } from '../src/provider.js';
import { AppStoreVerifier } from '../src/storekit.js';
import { Store } from '../src/store.js';

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const der = (name) => new X509Certificate(fixture(name)).raw.toString('base64');

export const TEST_ROOT = fixture('root.pem');
export const BUNDLE_ID = 'com.maslovw.drawingkid';

export function signJws(payload, { chain = ['leaf.pem', 'intermediate.pem', 'root.pem'], key = fixture('leaf.key') } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg: 'ES256', x5c: chain.map(der) })}.${enc(payload)}`;
  const signature = sign('sha256', Buffer.from(input), { key: createPrivateKey(key), dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

export function transaction(overrides = {}) {
  return {
    transactionId: String(Math.floor(Math.random() * 1e12)),
    originalTransactionId: '1000',
    bundleId: BUNDLE_ID,
    productId: 'drawingkid.stars10',
    environment: 'Sandbox',
    inAppOwnershipType: 'PURCHASED',
    signedDate: Date.now(),
    ...overrides,
  };
}

export async function startServer(env = {}, { clock } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'drawingkid-'));
  const config = loadConfig({ DEV_MODE: '1', PROVIDER: 'mock', DATA_DIR: dataDir, ADMIN_TOKEN: 'secret', ...env });
  const store = new Store(join(dataDir, 'test.sqlite'), clock ? { clock } : {});
  const provider = createProvider(config);
  const appStore = new AppStoreVerifier({ rootCert: TEST_ROOT, bundleId: config.bundleId, environments: config.appStoreEnvironments });
  const logs = [];
  const log = { log: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };
  const app = createApp({ config, store, provider, appStore, deviceCheck: createDeviceCheck(config), log });
  const server = app.server();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { account, body, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(account ? { 'X-Account-Token': account } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }

  return {
    config,
    store,
    provider,
    logs,
    call,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
