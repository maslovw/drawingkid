// UI state: selected tool/color/size and the AppConfig. Views listen for 'change'.

import { TOOLS, COLORS, SIZES, DEFAULT_CONFIG, normalizeConfig, saveConfig } from './config.js';

export class AppViewModel extends EventTarget {
  constructor(config) {
    super();
    this.config = config;
    this.tool = config.visibleTools[0];
    this.lastDrawingTool = this.tool;
    this.color = config.visibleColors[0];
    this.size = config.defaultSize;
  }

  get brush() {
    return {
      tool: this.tool,
      color: COLORS.find((c) => c.id === this.color).value,
      size: SIZES.find((s) => s.id === this.size).px,
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

  setAIEnabled(enabled) {
    this.#updateConfig({ enableAI: enabled });
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
    this.config = normalizeConfig({ ...this.config, ...patch });
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
