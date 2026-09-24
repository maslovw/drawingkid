// The drawing document: an operation log with undo/redo, rendered onto two layers
// (background image + drawing). Ops are small vector records, so undo is exact:
//   { type: 'stroke', tool, color, size, points }
//   { type: 'fill', x, y, color }
//   { type: 'background', imageId }
//   { type: 'clear', all }            all=true also removes the background
// Only the last MAX_UNDO ops are kept; older ones are "baked" into a base raster.
// Each page has its own size, chosen to fit the screen when the page is started.

import { DEFAULT_SIZE, createCanvas, canvasToBlob, drawStroke, floodFill, toLineArt } from './render.js';

const MAX_UNDO = 50;

export class DrawingDocument extends EventTarget {
  // `canvases` are the on-screen layers ({ bg, draw, live }); they're sized to the page.
  constructor(canvases) {
    super();
    this.canvases = canvases;
    this.bgCtx = canvases.bg.getContext('2d');
    this.drawCtx = canvases.draw.getContext('2d', { willReadFrequently: true });
    this.#reset(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    this.renderAll();
  }

  get canUndo() {
    return this.ops.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  // True when there's nothing to lose, so the page can be reshaped freely.
  get isBlank() {
    return !this.ops.length && !this.redoStack.length && !this.baseDirty;
  }

  // Starts over with an empty page of the given size. Clears undo history.
  newPage(width, height) {
    this.#reset(width, height);
    this.renderAll();
    this.#changed();
  }

  // Applies an op and records it. Returns false (and records nothing) for no-op fills.
  commit(op) {
    if (!this.#applyLive(op)) return false;
    this.ops.push(op);
    this.redoStack = [];
    if (this.ops.length > MAX_UNDO) this.#bake(this.ops.shift());
    this.#changed();
    return true;
  }

  undo() {
    if (!this.ops.length) return;
    this.redoStack.push(this.ops.pop());
    this.renderAll();
    this.#changed();
  }

  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    this.#applyLive(op);
    this.ops.push(op);
    this.#changed();
  }

  // Scales an image to fit the page (on white) and makes it the background.
  // `lineArt` cleans it up into crisp black-and-white for coloring.
  async importBackground(file, { lineArt = false } = {}) {
    const { width: W, height: H } = this;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d', { willReadFrequently: lineArt });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      if (lineArt) toLineArt(ctx);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      const imageId = crypto.randomUUID();
      this.images.set(imageId, { blob, bitmap: canvas });
      this.commit({ type: 'background', imageId });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Background + drawing flattened into one canvas (for export and AI).
  composite(width = this.width, height = this.height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.bgCtx.canvas, 0, 0, width, height);
    ctx.drawImage(this.drawCtx.canvas, 0, 0, width, height);
    return canvas;
  }

  // Replays base + ops from scratch (used after undo and on load).
  renderAll() {
    const ctx = this.drawCtx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.base, 0, 0);
    this.background = this.baseBackground;
    for (const op of this.ops) this.#apply(ctx, op, this);
    this.#renderBackground();
  }

  async serialize() {
    this.baseBlob ??= await canvasToBlob(this.base);
    const used = new Set(
      [...this.ops, ...this.redoStack].filter((op) => op.type === 'background').map((op) => op.imageId),
    );
    if (this.baseBackground) used.add(this.baseBackground);
    for (const id of this.images.keys()) if (!used.has(id)) this.images.delete(id);
    return {
      version: 2,
      width: this.width,
      height: this.height,
      base: this.baseBlob,
      baseDirty: this.baseDirty,
      baseBackground: this.baseBackground,
      ops: this.ops,
      redo: this.redoStack,
      images: Object.fromEntries([...used].map((id) => [id, this.images.get(id).blob])),
    };
  }

  async restore(data) {
    // Version 1 saves predate per-page sizes and were always 2048×1536.
    this.#reset(data.width ?? DEFAULT_SIZE.width, data.height ?? DEFAULT_SIZE.height);
    for (const [id, blob] of Object.entries(data.images ?? {})) {
      this.images.set(id, { blob, bitmap: await createImageBitmap(blob) });
    }
    if (data.base) this.baseCtx.drawImage(await createImageBitmap(data.base), 0, 0);
    this.baseBlob = data.base ?? null;
    this.baseDirty = data.baseDirty ?? Boolean(data.base && (data.ops?.length ?? 0) >= MAX_UNDO);
    this.baseBackground = data.baseBackground ?? null;
    this.ops = data.ops ?? [];
    this.redoStack = data.redo ?? [];
    this.renderAll();
    this.#changed();
  }

  #reset(width, height) {
    this.width = width;
    this.height = height;
    for (const canvas of Object.values(this.canvases)) {
      canvas.width = width;
      canvas.height = height;
    }
    this.base = createCanvas(width, height);
    this.baseCtx = this.base.getContext('2d', { willReadFrequently: true });
    this.baseDirty = false; // true once ops have been baked into `base`
    this.baseBackground = null;
    this.baseBlob = null; // cached PNG of `base` for saving
    this.ops = [];
    this.redoStack = [];
    this.images = new Map(); // imageId -> { blob, bitmap }
    this.background = null; // imageId currently shown
    this.bgCache = { id: null, data: null };
    this.version ??= 0;
    this.dispatchEvent(new Event('resize'));
  }

  #applyLive(op) {
    const changed = this.#apply(this.drawCtx, op, this);
    if (op.type === 'background' || op.type === 'clear') this.#renderBackground();
    return changed;
  }

  // `state.background` tracks which background is active at this point in the replay.
  #apply(ctx, op, state) {
    switch (op.type) {
      case 'stroke':
        drawStroke(ctx, op);
        return true;
      case 'fill':
        return floodFill(ctx, this.#backgroundData(state.background), op.x, op.y, op.color);
      case 'background':
        state.background = op.imageId;
        return true;
      case 'clear':
        ctx.clearRect(0, 0, this.width, this.height);
        if (op.all) state.background = null;
        return true;
      default:
        return false;
    }
  }

  #bake(op) {
    const state = { background: this.baseBackground };
    this.#apply(this.baseCtx, op, state);
    this.baseBackground = state.background;
    this.baseBlob = null;
    this.baseDirty = true;
  }

  #renderBackground() {
    const ctx = this.bgCtx;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.width, this.height);
    const image = this.background && this.images.get(this.background);
    if (image) ctx.drawImage(image.bitmap, 0, 0);
  }

  #backgroundData(id) {
    if (!id || !this.images.has(id)) return null;
    if (this.bgCache.id !== id) {
      const ctx = createCanvas(this.width, this.height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(this.images.get(id).bitmap, 0, 0);
      this.bgCache = { id, data: ctx.getImageData(0, 0, this.width, this.height) };
    }
    return this.bgCache.data;
  }

  #changed() {
    this.version++;
    this.dispatchEvent(new Event('change'));
  }
}
