// Apple DeviceCheck: two bits per device that survive reinstalls. Bit 0 = "this iPad
// already got its free star". The app sends a token from DCDevice.generateToken().

import { createPrivateKey, randomUUID, sign } from 'node:crypto';

export class DeviceCheckError extends Error {}

export function createDeviceCheck(config, { fetch = globalThis.fetch } = {}) {
  const dc = config.deviceCheck;
  if (dc.teamId && dc.keyId && dc.privateKey) return new DeviceCheck(dc, fetch);
  if (config.devMode) return new NoDeviceCheck();
  return null; // free stars are refused until DeviceCheck is configured
}

// Development without Apple keys: every device counts as new.
class NoDeviceCheck {
  async freeStarUsed() {
    return false;
  }

  async markFreeStarUsed() {}
}

class DeviceCheck {
  constructor({ teamId, keyId, privateKey, development }, fetch) {
    this.teamId = teamId;
    this.keyId = keyId;
    this.key = createPrivateKey(privateKey);
    this.base = development ? 'https://api.development.devicecheck.apple.com/v1' : 'https://api.devicecheck.apple.com/v1';
    this.fetch = fetch;
  }

  #jwt() {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc({ alg: 'ES256', kid: this.keyId })}.${enc({ iss: this.teamId, iat: Math.floor(Date.now() / 1000) })}`;
    const signature = sign('sha256', Buffer.from(input), { key: this.key, dsaEncoding: 'ieee-p1363' });
    return `${input}.${signature.toString('base64url')}`;
  }

  async #call(path, body) {
    const response = await this.fetch(`${this.base}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#jwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, transaction_id: randomUUID(), timestamp: Date.now() }),
    });
    const text = await response.text();
    if (!response.ok) throw new DeviceCheckError(`DeviceCheck ${response.status}: ${text}`);
    return text;
  }

  async freeStarUsed(deviceToken) {
    const text = await this.#call('query_two_bits', { device_token: deviceToken });
    // A device whose bits were never set answers 200 with a plain-text message.
    if (!text.trim().startsWith('{')) return false;
    return JSON.parse(text).bit0 === true;
  }

  async markFreeStarUsed(deviceToken) {
    await this.#call('update_two_bits', { device_token: deviceToken, bit0: true });
  }
}
