// Coloring-page generation from one sentence, via OpenAI (GPT Image) or Google Gemini
// ("Nano Banana"). Calls go straight from the browser with the parent's own API key.

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-image-1',
    models: ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-1-mini'],
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

export function loadApiKeys() {
  try {
    return JSON.parse(localStorage.getItem(KEYS_STORAGE)) ?? {};
  } catch {
    return {};
  }
}

export function saveApiKey(provider, key) {
  const keys = loadApiKeys();
  if (key) keys[provider] = key;
  else delete keys[provider];
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // Storage unavailable: the key only lasts until reload.
  }
}

export function coloringPrompt(idea) {
  return [
    `A coloring page for a young child showing: ${idea.trim()}.`,
    'Black and white line art only: thick, clean, closed black outlines on a pure white background.',
    'Simple, friendly, cartoon style with large open areas to color in.',
    'No shading, no gray, no color fills, no hatching, no text, no border. Landscape composition.',
  ].join(' ');
}

export class ImageGenError extends Error {}

// Returns a Blob (PNG/JPEG) of the generated page.
export async function generateColoringPage({ provider, model, apiKey, idea, signal }) {
  if (!apiKey) throw new ImageGenError('Add an API key in Settings first.');
  const prompt = coloringPrompt(idea);
  const name = PROVIDERS[provider].label;
  let response;
  try {
    response = provider === 'openai'
      ? await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt, n: 1, size: '1536x1024', quality: 'medium' }),
        })
      : await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:3' } },
            }),
          },
        );
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ImageGenError(
      `Couldn't reach ${name}. Check the internet connection. (The copy hosted on claude.ai can't call outside services; run the app from your own site for this feature.)`,
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message ?? `HTTP ${response.status}`;
    throw new ImageGenError(`${name} said: ${detail}`);
  }
  const b64 = provider === 'openai' ? body?.data?.[0]?.b64_json : geminiImage(body);
  if (!b64) throw new ImageGenError(`${name} didn't return a picture. Try describing it differently.`);
  const mime = provider === 'openai' ? 'image/png' : b64.mimeType;
  return base64ToBlob(provider === 'openai' ? b64 : b64.data, mime);
}

function geminiImage(body) {
  const blocked = body?.promptFeedback?.blockReason;
  if (blocked) throw new ImageGenError(`Gemini wouldn't draw that (${blocked}). Try something else.`);
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const part = parts.find((p) => p.inlineData?.data);
  return part && { data: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' };
}

function base64ToBlob(b64, type) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
