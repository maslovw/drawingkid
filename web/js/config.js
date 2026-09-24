// Tools, colors, sizes and the persisted AppConfig (which of them are visible).

import { PROVIDERS } from './imagegen.js';

export const TOOLS = [
  { id: 'pen', label: 'Pen' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'marker', label: 'Marker' },
  { id: 'fill', label: 'Fill' },
  { id: 'eraser', label: 'Eraser' },
];

// Color slots. Each palette fills the same slots, so the Settings choice of which colors
// to show applies to every palette.
export const COLORS = [
  { id: 'black', label: 'Black' },
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'brown', label: 'Brown' },
  { id: 'white', label: 'White' },
  // Special colors, resolved per stroke rather than being a fixed color.
  { id: 'rainbow', label: 'Rainbow', special: true },
  { id: 'random', label: 'Surprise color', special: true },
];

// `tone` is the saturation/lightness (%) of that palette's Rainbow; `preview` is the four
// slots its picker button shows, chosen so the three buttons look clearly different.
export const PALETTES = [
  {
    id: 'classic',
    label: 'Classic colors',
    tone: { s: 85, l: 52 },
    preview: ['red', 'yellow', 'blue', 'green'],
    colors: {
      black: '#1f1f1f', red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047',
      blue: '#1e88e5', purple: '#8e24aa', pink: '#f06292', brown: '#6d4c41', white: '#ffffff',
    },
  },
  {
    id: 'vibrant',
    label: 'Vibrant colors',
    tone: { s: 100, l: 50 },
    preview: ['pink', 'green', 'purple', 'yellow'],
    colors: {
      black: '#000000', red: '#ff1744', orange: '#ff6d00', yellow: '#ffea00', green: '#00e676',
      blue: '#2979ff', purple: '#d500f9', pink: '#ff4081', brown: '#a0522d', white: '#ffffff',
    },
  },
  {
    id: 'pastel',
    label: 'Pastel colors',
    tone: { s: 80, l: 80 },
    preview: ['pink', 'yellow', 'blue', 'green'],
    colors: {
      black: '#5b5670', red: '#ff9aa2', orange: '#ffc49b', yellow: '#fff1a8', green: '#b5ead7',
      blue: '#a7c7e7', purple: '#c9b6e4', pink: '#f8c8dc', brown: '#c8a993', white: '#ffffff',
    },
  },
];

export const paletteById = (id) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

// A color slot's value in a palette: a hex color, or 'rainbow' / 'random'.
export function colorValue(id, paletteId) {
  if (id === 'rainbow' || id === 'random') return id;
  return paletteById(paletteId).colors[id];
}

export function rainbowHsl(hue, tone = PALETTES[0].tone) {
  return `hsl(${Math.round(hue) % 360} ${tone.s}% ${tone.l}%)`;
}

// Colors the Surprise color picks from (white wouldn't show on the paper).
const surpriseColors = (paletteId) =>
  COLORS.filter((c) => !c.special && c.id !== 'white').map((c) => colorValue(c.id, paletteId));

// CSS background showing a palette color: solid, a smooth rainbow, or the Surprise
// color's slices of the palette.
export function colorCss(id, paletteId) {
  if (id === 'rainbow') {
    const { tone } = paletteById(paletteId);
    const hues = [0, 36, 60, 120, 210, 280, 360].map((h) => rainbowHsl(h, tone));
    return `conic-gradient(${hues.join(', ')})`;
  }
  if (id === 'random') {
    const colors = surpriseColors(paletteId);
    const step = 360 / colors.length;
    const slices = colors.map((c, i) => `${c} ${i * step}deg ${(i + 1) * step}deg`);
    return `conic-gradient(${slices.join(', ')})`;
  }
  return colorValue(id, paletteId);
}

// A palette color for one stroke of the Surprise color, never the same twice in a row.
export function surpriseColor(previous, paletteId) {
  const choices = surpriseColors(paletteId).filter((c) => c !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
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
