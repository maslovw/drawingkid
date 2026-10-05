// Coloring-page generation from one sentence, via OpenAI (GPT Image) or Google Gemini
// ("Nano Banana"). Calls go straight from the browser with the parent's own API key.

import { t } from './i18n.js';

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    // Sept 2026: 2.5 Flare is OpenAI's recommended default; 1.5 and 1-mini shut down Dec 1, 2026.
    defaultModel: 'gpt-image-2.5-flare',
    models: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1'],
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Gemini (Nano Banana)',
    defaultModel: 'gemini-3.1-flash-image',
    models: ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'],
    keyHint: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
};

const KEYS_STORAGE = 'drawingkid.apikeys';
const MODELS_STORAGE = 'drawingkid.models';

// Keys from the server's config.local.json; they take precedence over keys typed on a device.
let managedKeys = {};

export function setManagedApiKeys(keys) {
  managedKeys = { ...keys };
}

export const isManagedKey = (provider) => provider in managedKeys;

function deviceApiKeys() {
  try {
    return JSON.parse(localStorage.getItem(KEYS_STORAGE)) ?? {};
  } catch {
    return {};
  }
}

export function loadApiKeys() {
  return { ...deviceApiKeys(), ...managedKeys };
}

export function saveApiKey(provider, key) {
  if (isManagedKey(provider)) return;
  const keys = deviceApiKeys();
  if (key) keys[provider] = key;
  else delete keys[provider];
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // Storage unavailable: the key only lasts until reload.
  }
}

// Model list shown in Settings: the last refreshed list, or the built-in suggestions.
export function knownModels(provider) {
  try {
    const cached = JSON.parse(localStorage.getItem(MODELS_STORAGE))?.[provider];
    if (cached?.length) return cached;
  } catch {
    // fall through to built-ins
  }
  return PROVIDERS[provider].models;
}

// Asks the provider which image models this key can use, newest first, and caches them.
export async function refreshModels(provider, apiKey) {
  if (!apiKey) throw new ImageGenError(t('error.addKey'));
  const name = PROVIDERS[provider].label;
  let models;
  try {
    models = provider === 'openai' ? await listOpenAIModels(apiKey) : await listGeminiModels(apiKey);
  } catch (error) {
    if (error instanceof ImageGenError) throw error;
    throw new ImageGenError(t('error.unreachable', { name }));
  }
  if (!models.length) throw new ImageGenError(t('error.noModels', { name }));
  try {
    const all = JSON.parse(localStorage.getItem(MODELS_STORAGE)) ?? {};
    all[provider] = models;
    localStorage.setItem(MODELS_STORAGE, JSON.stringify(all));
  } catch {
    // Not cached; the list is still returned.
  }
  return models;
}

async function listOpenAIModels(apiKey) {
  const body = await getJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${apiKey}` }, 'OpenAI');
  return (body.data ?? [])
    .filter((m) => /^(gpt-image|chatgpt-image)/.test(m.id))
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
    .map((m) => m.id);
}

async function listGeminiModels(apiKey) {
  const models = [];
  let pageToken = '';
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const body = await getJson(url, { 'x-goog-api-key': apiKey }, 'Gemini');
    models.push(...(body.models ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  // Nano Banana models are the Gemini models that generate images via generateContent.
  return models
    .filter((m) => /image/.test(m.name) && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

async function getJson(url, headers, name) {
  const response = await fetch(url, { headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ImageGenError(t('error.said', { name, detail: body?.error?.message ?? `HTTP ${response.status}` }));
  return body ?? {};
}

export function coloringPrompt(idea) {
  return [
    `A page from a children's coloring book for a young child showing: ${idea.trim()}.`,
    'Already colored in: every area is filled with one flat, solid color, and thick solid pure black outlines of even width go around every area, including inner parts like bellies, chests and inner ears.',
    'Use only 5 to 7 bright, clearly different colors in the whole picture, plus plain pure white for the background. Two areas that touch always have different colors, even parts of one thing (for example leaves, stems and grass in different greens).',
    // Gray is the one color the page's outlines blur into, so gray areas can't be told
    // from an outline's soft edge. Things that are gray in life get a bright color.
    'Never use gray, silver, beige, cream or off-white anywhere: things that are usually gray get a bright color instead (rails and roads brown or blue, rocks and metal blue or purple, an elephant or a mouse light blue).',
    'Black is only for the outlines and small details like pupils; tires, hair, noses, buttons and other solid shapes get a bright color, never black or a very dark color.',
    'Every outline is closed and joins up with the lines around it, with no gaps.',
    // A shape cut off by the page edge has no outline there.
    'The whole picture fits inside the page with a white margin all around; nothing is cut off by the edge of the page.',
    'Simple, friendly, cartoon style with a few large areas, each big enough to fill with a fingertip; keep things apart rather than piled up.',
    'Crisp, clean edges like vector art. No shading, no gradients, no highlights, no shadows, no glow, no texture, no patterns, no text, no border or frame.',
  ].join(' ');
}

export class ImageGenError extends Error {}

// Returns a Blob (PNG/JPEG) of the generated page.
const GEMINI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

// Closest shape each provider can produce for a page of the given width/height ratio.
function openAISize(aspect) {
  if (aspect > 1.2) return '1536x1024';
  if (aspect < 0.83) return '1024x1536';
  return '1024x1024';
}

function geminiRatio(aspect) {
  const value = (r) => r.split(':').reduce((a, b) => a / b);
  return GEMINI_RATIOS.reduce((best, r) =>
    Math.abs(Math.log(value(r) / aspect)) < Math.abs(Math.log(value(best) / aspect)) ? r : best,
  );
}

export async function generateColoringPage({ provider, model, apiKey, idea, aspect = 4 / 3, signal }) {
  if (!apiKey) throw new ImageGenError(t('error.addKeySettings'));
  const prompt = coloringPrompt(idea);
  const name = PROVIDERS[provider].label;
  let response;
  try {
    response = provider === 'openai'
      ? await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt, n: 1, size: openAISize(aspect), quality: 'medium' }),
        })
      : await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: geminiRatio(aspect) } },
            }),
          },
        );
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ImageGenError(`${t('error.unreachable', { name })} ${t('error.hosted')}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message ?? `HTTP ${response.status}`;
    throw new ImageGenError(t('error.said', { name, detail }));
  }
  const b64 = provider === 'openai' ? body?.data?.[0]?.b64_json : geminiImage(body);
  if (!b64) throw new ImageGenError(t('error.noPicture', { name }));
  const mime = provider === 'openai' ? 'image/png' : b64.mimeType;
  return { blob: base64ToBlob(provider === 'openai' ? b64 : b64.data, mime), usage: usageOf(provider, body) };
}

// Token counts the provider reports for the request, normalized to
// { textIn, imageIn, out }; null if the response has none.
function usageOf(provider, body) {
  if (provider === 'openai') {
    const u = body?.usage;
    if (!u) return null;
    const imageIn = u.input_tokens_details?.image_tokens ?? 0;
    const textIn = u.input_tokens_details?.text_tokens ?? Math.max(0, (u.input_tokens ?? 0) - imageIn);
    return { textIn, imageIn, out: u.output_tokens ?? 0 };
  }
  const u = body?.usageMetadata;
  if (!u) return null;
  return { textIn: u.promptTokenCount ?? 0, imageIn: 0, out: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
}

function geminiImage(body) {
  const blocked = body?.promptFeedback?.blockReason;
  if (blocked) throw new ImageGenError(t('error.blocked', { reason: blocked }));
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const part = parts.find((p) => p.inlineData?.data);
  return part && { data: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' };
}

function base64ToBlob(b64, type) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
