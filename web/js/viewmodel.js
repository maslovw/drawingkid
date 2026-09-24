// UI state: selected tool/color/size and the AppConfig. Views listen for 'change'.

import { TOOLS, COLORS, SIZES, DEFAULT_CONFIG, applyManaged, saveConfig, surpriseColor, colorValue, paletteById } from './config.js';

const PALETTE_KEY = 'drawingkid.palette';

export class AppViewModel extends EventTarget {
  // `managed` holds settings fixed by the server's config.local.json.
  constructor(config, managed = {}) {
    super();
    this.managed = managed;
    this.config = config;
    this.tool = config.visibleTools[0];
    this.lastDrawingTool = this.tool;
    this.color = config.visibleColors[0];
    this.size = config.defaultSize;
    this.palette = paletteById(readPalette()).id;
  }

  // True when config.local.json sets this (for imageModels: this provider's model).
  isManaged(key, provider) {
    if (!(key in this.managed)) return false;
    return key === 'imageModels' ? provider in (this.managed.imageModels ?? {}) : true;
  }

  // The brush for a new stroke or fill. The Surprise color picks a new palette color
  // each time; the Rainbow color stays 'rainbow' and is drawn as a changing hue.
  nextBrush() {
    let color = colorValue(this.color, this.palette);
    if (color === 'random') color = this.lastSurprise = surpriseColor(this.lastSurprise, this.palette);
    return {
      tool: this.tool,
      color,
      size: SIZES.find((s) => s.id === this.size).px,
      tone: paletteById(this.palette).tone,
    };
  }

  setTool(id) {
    this.tool = id;
    if (id !== 'eraser') this.lastDrawingTool = id;
    this.#changed();
  }

  // Picking a color while erasing switches back to drawing, which is what kids expect.
  setColor(id) {
    this.color = id;
    if (this.tool === 'eraser' && this.config.visibleTools.includes(this.lastDrawingTool)) {
      this.tool = this.lastDrawingTool;
    }
    this.#changed();
  }

  // Switching palettes keeps the selected slot (red stays red, just a different red).
  setPalette(id) {
    this.palette = paletteById(id).id;
    try {
      localStorage.setItem(PALETTE_KEY, this.palette);
    } catch {
      // Not remembered, but still switched.
    }
    this.#changed();
  }

  setSize(id) {
    this.size = id;
    this.#changed();
  }

  setToolVisible(id, visible) {
    this.#updateConfig({ visibleTools: toggled(TOOLS, this.config.visibleTools, id, visible) });
  }

  setColorVisible(id, visible) {
    this.#updateConfig({ visibleColors: toggled(COLORS, this.config.visibleColors, id, visible) });
  }

  setDefaultSize(id) {
    this.size = id;
    this.#updateConfig({ defaultSize: id });
  }

  setLeftHanded(leftHanded) {
    this.#updateConfig({ leftHanded });
  }

  setShowLabels(showLabels) {
    this.#updateConfig({ showLabels });
  }

  setImageGenEnabled(enabled) {
    this.#updateConfig({ enableImageGen: enabled });
  }

  setImageProvider(provider) {
    this.#updateConfig({ imageProvider: provider });
  }

  setImageModel(provider, model) {
    this.#updateConfig({ imageModels: { ...this.config.imageModels, [provider]: model } });
  }

  resetConfig() {
    this.size = DEFAULT_CONFIG.defaultSize;
    this.#updateConfig(DEFAULT_CONFIG);
  }

  #updateConfig(patch) {
    this.config = applyManaged({ ...this.config, ...patch }, this.managed);
    saveConfig(this.config);
    // Keep the current selection valid if it was just hidden.
    if (!this.config.visibleTools.includes(this.tool)) this.tool = this.config.visibleTools[0];
    if (!this.config.visibleColors.includes(this.color)) this.color = this.config.visibleColors[0];
    this.#changed();
  }

  #changed() {
    this.dispatchEvent(new Event('change'));
  }
}

function toggled(all, current, id, visible) {
  return all.map((x) => x.id).filter((x) => (x === id ? visible : current.includes(x)));
}

function readPalette() {
  try {
    return localStorage.getItem(PALETTE_KEY);
  } catch {
    return null;
  }
}
