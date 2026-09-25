import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { AppStoreVerifier, VerificationError } from '../src/storekit.js';
import { BUNDLE_ID, TEST_ROOT, signJws, transaction } from './helpers.js';

const verifier = new AppStoreVerifier({ rootCert: TEST_ROOT, bundleId: BUNDLE_ID, environments: ['Sandbox'] });

test('accepts a transaction signed by the pinned chain', () => {
  const t = verifier.verifyTransaction(signJws(transaction({ productId: 'drawingkid.stars20' })));
  assert.equal(t.product.stars, 20);
});

test('rejects a tampered payload', () => {
  const [h, , s] = signJws(transaction()).split('.');
  const forged = Buffer.from(JSON.stringify(transaction({ productId: 'drawingkid.stars20' }))).toString('base64url');
  assert.throws(() => verifier.verifyTransaction(`${h}.${forged}.${s}`), /bad signature/);
});

test('rejects a chain that does not end at the pinned root', () => {
  const apple = new AppStoreVerifier({
    rootCert: readFileSync(new URL('../certs/AppleRootCA-G3.cer', import.meta.url)),
    bundleId: BUNDLE_ID,
    environments: ['Sandbox'],
  });
  assert.throws(() => apple.verifyTransaction(signJws(transaction())), /pinned Apple root/);
});

test('rejects a leaf without the App Store marker', () => {
  // The intermediate signing as if it were the leaf: its chain is wrong.
  assert.throws(
    () => verifier.verifyJws(signJws(transaction(), { chain: ['intermediate.pem', 'intermediate.pem', 'root.pem'] })),
    VerificationError,
  );
});

test('checks bundle, environment and product', () => {
  assert.throws(() => verifier.verifyTransaction(signJws(transaction({ bundleId: 'com.other.app' }))), /wrong bundle/);
  assert.throws(() => verifier.verifyTransaction(signJws(transaction({ environment: 'Production' }))), /environment/);
  assert.throws(() => verifier.verifyTransaction(signJws(transaction({ productId: 'drawingkid.free' }))), /unknown product/);
});
