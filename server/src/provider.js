// Image generation and moderation. `openai` calls the OpenAI API; `mock` returns a
// placeholder PNG, for development and tests.

import { deflateSync } from 'node:zlib';

export class ProviderError extends Error {
  // `blocked`: the provider refused the content (no star is charged).
  constructor(message, { blocked = false } = {}) {
    super(message);
    this.blocked = blocked;
  }
}

// List prices in USD per 1M tokens (September 2026), matched by model-id prefix.
// Same table as web/js/usagelog.js.
const PRICES = [
  { prefix: 'gpt-image-2.5-flare', textIn: 5, imageIn: 8, out: 30 },
  { prefix: 'gpt-image-1', textIn: 5, imageIn: 10, out: 40 },
];

export function estimateCostUsd(model, usage, fallbackUsd) {
  const price = PRICES.find((p) => model === p.prefix || model.startsWith(`${p.prefix}-`));
  if (!price || !usage) return fallbackUsd;
  return ((usage.textIn ?? 0) * price.textIn + (usage.imageIn ?? 0) * price.imageIn + (usage.out ?? 0) * price.out) / 1e6;
}

export function createProvider(config, { fetch = globalThis.fetch } = {}) {
  if (config.provider === 'mock') return new MockProvider();
  if (config.provider === 'openai') return new OpenAIProvider(config, fetch);
  throw new Error(`Unknown PROVIDER "${config.provider}" (use openai or mock)`);
}

class OpenAIProvider {
  constructor(config, fetch) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not set');
    this.config = config;
    this.fetch = fetch;
  }

  async #post(path, body, signal) {
    let response;
    try {
      response = await this.fetch(`https://api.openai.com/v1/${path}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.openaiApiKey}` },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ProviderError(`OpenAI unreachable: ${error.message}`);
    }
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const code = json?.error?.code ?? '';
      // Content refusals come back as 400 moderation_blocked / content_policy_violation.
      const blocked = /moderation|content_policy|safety/i.test(code);
      throw new ProviderError(`OpenAI ${response.status}: ${json?.error?.message ?? 'no message'}`, { blocked });
    }
    return json;
  }

  // True if the text (and, if given, a PNG) is not fit for a young child.
  async flagged({ text, png }, signal) {
    const input = [];
    if (text) input.push({ type: 'text', text });
    if (png) input.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } });
    const body = await this.#post('moderations', { model: 'omni-moderation-latest', input }, signal);
    return (body.results ?? []).some((r) => r.flagged);
  }

  async generate(prompt, signal) {
    const { imageModel: model, imageSize: size, imageQuality: quality } = this.config;
    const body = await this.#post('images/generations', { model, prompt, n: 1, size, quality, moderation: 'auto' }, signal);
    const b64 = body?.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError('OpenAI returned no image');
    const u = body.usage;
    const imageIn = u?.input_tokens_details?.image_tokens ?? 0;
    const usage = u && {
      textIn: u.input_tokens_details?.text_tokens ?? Math.max(0, (u.input_tokens ?? 0) - imageIn),
      imageIn,
      out: u.output_tokens ?? 0,
    };
    return { png: Buffer.from(b64, 'base64'), model, costUsd: estimateCostUsd(model, usage, this.config.worstImageUsd) };
  }
}

class MockProvider {
  constructor() {
    this.calls = 0;
    this.failNext = null; // tests set this to a ProviderError to simulate a failure
    this.flagNext = false;
  }

  async flagged() {
    const flagged = this.flagNext;
    this.flagNext = false;
    return flagged;
  }

  async generate() {
    this.calls += 1;
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    return { png: placeholderPng(this.calls), model: 'mock', costUsd: 0.02 };
  }
}

// A white 64×64 PNG with a black frame and a diagonal, different per call.
function placeholderPng(seed) {
  const size = 64;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size, 255);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const edge = x < 3 || y < 3 || x >= size - 3 || y >= size - 3;
      if (edge || Math.abs(x - ((y + seed * 7) % size)) < 2) row[1 + x] = 0;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
