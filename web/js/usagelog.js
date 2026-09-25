// Log of coloring-page requests: what was asked, which model, whether it worked, and what
// it cost. Kept in this browser's localStorage. Totals are stored apart from the entries,
// so trimming old entries never loses the counts.

const STORAGE_KEY = 'drawingkid.log';
const MAX_ENTRIES = 300;

// List prices in USD per 1M tokens (September 2026). Image models bill text input and
// image output tokens; the API responses report both. Matched by model-id prefix, so
// dated snapshots (gpt-image-2.5-flare-2026-09-08) count too. Unknown models: no estimate.
const PRICES = [
  { prefix: 'gpt-image-2.5-flare', textIn: 5, imageIn: 8, out: 30 },
  { prefix: 'gpt-image-1', textIn: 5, imageIn: 10, out: 40 },
  { prefix: 'gemini-3.1-flash-image', textIn: 0.5, out: 60 },
  { prefix: 'gemini-2.5-flash-image', textIn: 0.3, out: 30 },
];

export function priceFor(model) {
  return PRICES.find((p) => model === p.prefix || model?.startsWith(`${p.prefix}-`)) ?? null;
}

// `usage`: { textIn, imageIn, out } token counts. Returns USD, or null when unknown.
export function estimateCost(model, usage) {
  const price = priceFor(model);
  if (!price || !usage) return null;
  const perToken = (rate) => (rate ?? 0) / 1e6;
  return (
    (usage.textIn ?? 0) * perToken(price.textIn) +
    (usage.imageIn ?? 0) * perToken(price.imageIn ?? price.textIn) +
    (usage.out ?? 0) * perToken(price.out)
  );
}

function empty() {
  return { since: new Date().toISOString(), entries: [], totals: { images: 0, costUsd: 0, unpriced: 0 } };
}

export function loadLog() {
  try {
    const log = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (log?.entries && log?.totals) return log;
  } catch {
    // Unreadable: start over.
  }
  return empty();
}

function save(log) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or unavailable: the log just isn't kept.
  }
}

// entry: { text, provider, model, ok, error?, usage?, costUsd? }
export function recordRequest(entry) {
  const log = loadLog();
  log.entries.unshift({ at: new Date().toISOString(), ...entry });
  log.entries.length = Math.min(log.entries.length, MAX_ENTRIES);
  if (entry.ok) {
    log.totals.images += 1;
    if (entry.costUsd == null) log.totals.unpriced += 1;
    else log.totals.costUsd += entry.costUsd;
  }
  save(log);
  return log;
}

export function clearLog() {
  const log = empty();
  save(log);
  return log;
}

// Totals for the current calendar month, from the entries.
export function monthTotals(log, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const month = { images: 0, costUsd: 0, unpriced: 0 };
  for (const e of log.entries) {
    if (!e.ok || new Date(e.at).getTime() < start) continue;
    month.images += 1;
    if (e.costUsd == null) month.unpriced += 1;
    else month.costUsd += e.costUsd;
  }
  return month;
}

export class SpendError extends Error {}

// What OpenAI actually billed this calendar month (UTC), for the whole organization.
// Needs an Admin API key (sk-admin-…); regular project keys can't read costs.
export async function fetchOpenAISpend(adminKey, now = new Date()) {
  if (!adminKey) throw new SpendError('Add an OpenAI admin key first.');
  const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  let total = 0;
  let currency = 'usd';
  let page = null;
  for (let i = 0; i < 12; i++) {
    const url = new URL('https://api.openai.com/v1/organization/costs');
    url.searchParams.set('start_time', String(start));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.set('limit', '31');
    if (page) url.searchParams.set('page', page);
    let response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${adminKey}` } });
    } catch {
      throw new SpendError("Couldn't reach OpenAI. Check the internet connection.");
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new SpendError(`OpenAI said: ${body?.error?.message ?? `HTTP ${response.status}`}`);
    }
    for (const bucket of body?.data ?? []) {
      for (const result of bucket.results ?? []) {
        total += Number(result.amount?.value ?? 0);
        currency = result.amount?.currency ?? currency;
      }
    }
    if (!body?.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return { total, currency, since: new Date(start * 1000) };
}
