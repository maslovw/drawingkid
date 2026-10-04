// Verifies App Store signed data (JWS): StoreKit 2 transactions sent by the app, and App
// Store Server Notifications V2. Each JWS carries its certificate chain in the `x5c`
// header; the chain must end at Apple Root CA - G3, which we pin.

import { X509Certificate, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Marker extensions Apple puts on the signing certificates.
const LEAF_OID = '1.2.840.113635.100.6.11.1';
const INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';

export const PRODUCTS = {
  'drawingkid.fullstudio': { stars: 3, fullStudio: true },
  'drawingkid.stars3': { stars: 3 },
  'drawingkid.stars10': { stars: 10 },
  'drawingkid.stars20': { stars: 20 },
};

export class VerificationError extends Error {}

const b64url = (s) => Buffer.from(s, 'base64url');

// The DER bytes of an X.509 extension OID, to find it in a certificate without an ASN.1
// parser (node's X509Certificate doesn't expose custom extensions).
function oidBytes(oid) {
  const parts = oid.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const n of parts.slice(2)) {
    const bytes = [n & 0x7f];
    for (let v = n >>> 7; v; v >>>= 7) bytes.unshift((v & 0x7f) | 0x80);
    out.push(...bytes);
  }
  return Buffer.from([0x06, out.length, ...out]);
}

const hasExtension = (cert, oid) => cert.raw.includes(oidBytes(oid));

export class AppStoreVerifier {
  // `rootCert`: DER or PEM of the trusted root. `now`: clock, for tests.
  constructor({ rootCert, rootCertPath, bundleId, environments, now = () => new Date() }) {
    this.root = new X509Certificate(rootCert ?? readFileSync(rootCertPath));
    this.bundleId = bundleId;
    this.environments = new Set(environments);
    this.now = now;
  }

  // Returns the JWS payload if it is signed by Apple; throws VerificationError otherwise.
  verifyJws(jws) {
    const parts = String(jws ?? '').split('.');
    if (parts.length !== 3) throw new VerificationError('not a JWS');
    let header;
    let payload;
    try {
      header = JSON.parse(b64url(parts[0]).toString('utf8'));
      payload = JSON.parse(b64url(parts[1]).toString('utf8'));
    } catch {
      throw new VerificationError('malformed JWS');
    }
    if (header.alg !== 'ES256') throw new VerificationError(`unexpected alg ${header.alg}`);
    if (!Array.isArray(header.x5c) || header.x5c.length !== 3) throw new VerificationError('x5c must hold 3 certificates');

    const [leaf, intermediate, root] = header.x5c.map((c) => new X509Certificate(Buffer.from(c, 'base64')));
    if (!root.raw.equals(this.root.raw)) throw new VerificationError('chain does not end at the pinned Apple root');
    if (!intermediate.verify(root.publicKey)) throw new VerificationError('intermediate not signed by root');
    if (!leaf.verify(intermediate.publicKey)) throw new VerificationError('leaf not signed by intermediate');
    if (!hasExtension(intermediate, INTERMEDIATE_OID)) throw new VerificationError('intermediate is not an Apple WWDR certificate');
    if (!hasExtension(leaf, LEAF_OID)) throw new VerificationError('leaf is not an App Store signing certificate');

    // Checked at the time Apple signed it, so old transactions still verify on restore.
    const signedAt = payload.signedDate ? new Date(payload.signedDate) : this.now();
    for (const cert of [leaf, intermediate, root]) {
      if (signedAt < new Date(cert.validFrom) || signedAt > new Date(cert.validTo)) {
        throw new VerificationError('certificate not valid at signing time');
      }
    }

    const ok = verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: createPublicKey(leaf.publicKey.export({ type: 'spki', format: 'pem' })), dsaEncoding: 'ieee-p1363' },
      b64url(parts[2]),
    );
    if (!ok) throw new VerificationError('bad signature');
    return payload;
  }

  // A verified in-app purchase transaction, checked against this app and product list.
  verifyTransaction(signedTransaction) {
    const t = this.verifyJws(signedTransaction);
    if (t.bundleId !== this.bundleId) throw new VerificationError(`wrong bundle ${t.bundleId}`);
    if (!this.environments.has(t.environment)) throw new VerificationError(`environment ${t.environment} not accepted`);
    const product = PRODUCTS[t.productId];
    if (!product) throw new VerificationError(`unknown product ${t.productId}`);
    return { ...t, product };
  }

  // A verified App Store Server Notification V2, with its transaction decoded.
  verifyNotification(signedPayload) {
    const n = this.verifyJws(signedPayload);
    if (n.data?.bundleId !== this.bundleId) throw new VerificationError(`wrong bundle ${n.data?.bundleId}`);
    const transaction = n.data?.signedTransactionInfo ? this.verifyJws(n.data.signedTransactionInfo) : null;
    return { ...n, transaction };
  }
}
