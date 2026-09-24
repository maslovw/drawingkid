// Tools, colors, sizes and the persisted AppConfig (which of them are visible).

import { PROVIDERS } from './imagegen.js';

export const TOOLS = [
  { id: 'pen', label: 'Pen', icon: '🖊️' },
  { id: 'pencil', label: 'Pencil', icon: '✏️' },
  { id: 'marker', label: 'Marker', icon: '🖍️' },
  { id: 'fill', label: 'Fill', icon: '🪣' },
  { id: 'eraser', label: 'Eraser', icon: '🧽' },
];

export const COLORS = [
  { id: 'black', label: 'Black', value: '#1f1f1f' },
  { id: 'red', label: 'Red', value: '#e53935' },
  { id: 'orange', label: 'Orange', value: '#fb8c00' },
  { id: 'yellow', label: 'Yellow', value: '#fdd835' },
  { id: 'green', label: 'Green', value: '#43a047' },
  { id: 'blue', label: 'Blue', value: '#1e88e5' },
  { id: 'purple', label: 'Purple', value: '#8e24aa' },
  { id: 'pink', label: 'Pink', value: '#f06292' },
  { id: 'brown', label: 'Brown', value: '#6d4c41' },
  { id: 'white', label: 'White', value: '#ffffff' },
  // Special colors: `value` is resolved per stroke rather than being a fixed color.
  { id: 'rainbow', label: 'Rainbow', value: 'rainbow', special: true },
  { id: 'random', label: 'Surprise color', value: 'random', special: true },
];

// Colors the Surprise color picks from (white wouldn't show on the paper).
const SURPRISE_COLORS = COLORS.filter((c) => !c.special && c.id !== 'white');

// CSS background showing a palette color: solid, a smooth rainbow, or the Surprise
// color's slices of the palette.
export function colorCss(id) {
  const color = COLORS.find((c) => c.id === id);
  if (id === 'rainbow') {
    return 'conic-gradient(#f44336, #ff9800, #ffeb3b, #4caf50, #2196f3, #9c27b0, #f44336)';
  }
  if (id === 'random') {
    const step = 360 / SURPRISE_COLORS.length;
    const slices = SURPRISE_COLORS.map((c, i) => `${c.value} ${i * step}deg ${(i + 1) * step}deg`);
    return `conic-gradient(${slices.join(', ')})`;
  }
  return color.value;
}

// A palette color for one stroke of the Surprise color, never the same twice in a row.
export function surpriseColor(previous) {
  const choices = SURPRISE_COLORS.filter((c) => c.value !== previous);
  return choices[Math.floor(Math.random() * choices.length)].value;
}

// Brush sizes in canvas pixels (the canvas is 2048×1536).
export const SIZES = [
  { id: 'small', label: 'Small', px: 8 },
  { id: 'medium', label: 'Medium', px: 18 },
  { id: 'large', label: 'Large', px: 40 },
];

export const DEFAULT_CONFIG = Object.freeze({
  visibleTools: TOOLS.map((t) => t.id),
  visibleColors: COLORS.map((c) => c.id),
  defaultSize: 'medium',
  leftHanded: false,
  showLabels: true,
  enableImageGen: true,
  imageProvider: 'openai',
  imageModels: { openai: PROVIDERS.openai.defaultModel, gemini: PROVIDERS.gemini.defaultModel },
});

const STORAGE_KEY = 'drawingkid.config';

const SETTING_KEYS = Object.keys(DEFAULT_CONFIG);

// Optional config.local.json next to index.html, shared by every device that opens the
// app from this server. Settings it contains win over each device's own choices, and
// its API keys are used on every device. Missing or invalid file: nothing is managed.
export async function loadServerConfig() {
  try {
    const response = await fetch('config.local.json', { cache: 'no-store' });
    if (!response.ok) return { settings: {}, apiKeys: {} };
    const file = await response.json();
    const settings = Object.fromEntries(SETTING_KEYS.filter((k) => k in file).map((k) => [k, file[k]]));
    const apiKeys = Object.fromEntries(
      Object.entries(file.apiKeys ?? {}).filter(([, key]) => typeof key === 'string' && key.trim()),
    );
    return { settings, apiKeys };
  } catch (error) {
    console.warn('Ignoring config.local.json', error);
    return { settings: {}, apiKeys: {} };
  }
}

// Overlays the server's settings onto a device config (models merge per provider).
export function applyManaged(config, managed = {}) {
  return normalizeConfig({
    ...config,
    ...managed,
    imageModels: { ...config.imageModels, ...managed.imageModels },
  });
}

export function loadConfig(managed = {}) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    // Corrupt or unavailable storage: fall back to defaults.
  }
  // Tools and colors added since the settings were saved start out visible.
  for (const [key, all, known] of [
    ['visibleTools', TOOLS, saved.knownTools],
    ['visibleColors', COLORS, saved.knownColors],
  ]) {
    if (!Array.isArray(saved[key])) continue;
    const added = all.map((x) => x.id).filter((id) => !(known ?? DEFAULT_KNOWN[key]).includes(id));
    saved[key] = [...saved[key], ...added];
  }
  return applyManaged({ ...DEFAULT_CONFIG, ...saved }, managed);
}

// What existed before saved settings recorded the tools and colors they knew about.
const DEFAULT_KNOWN = {
  visibleTools: ['pen', 'pencil', 'marker', 'fill', 'eraser'],
  visibleColors: ['black', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'white'],
};

export function saveConfig(config) {
  try {
    const known = { knownTools: TOOLS.map((t) => t.id), knownColors: COLORS.map((c) => c.id) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, ...known }));
  } catch {
    // Private mode / quota: settings just won't persist.
  }
}

// Drop unknown ids, keep canonical order, and never leave a list empty.
export function normalizeConfig(config) {
  const pick = (all, ids, fallback) => {
    const list = all.map((x) => x.id).filter((id) => ids?.includes(id));
    return list.length ? list : fallback;
  };
  return {
    visibleTools: pick(TOOLS, config.visibleTools, DEFAULT_CONFIG.visibleTools),
    visibleColors: pick(COLORS, config.visibleColors, DEFAULT_CONFIG.visibleColors),
    defaultSize: SIZES.some((s) => s.id === config.defaultSize) ? config.defaultSize : DEFAULT_CONFIG.defaultSize,
    leftHanded: config.leftHanded === true,
    showLabels: config.showLabels !== false,
    enableImageGen: config.enableImageGen !== false,
    imageProvider: config.imageProvider in PROVIDERS ? config.imageProvider : DEFAULT_CONFIG.imageProvider,
    imageModels: Object.fromEntries(
      Object.keys(PROVIDERS).map((p) => [p, config.imageModels?.[p]?.trim() || DEFAULT_CONFIG.imageModels[p]]),
    ),
  };
}
