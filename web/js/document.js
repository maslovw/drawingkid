// The drawing document: an operation log with undo/redo, rendered onto two layers
// (background image + drawing). Ops are small vector records, so undo is exact:
//   { type: 'stroke', tool, color, size, points, hue?, tone?, inside? }
//                                    color 'rainbow' starts at `hue`; `inside` ([x, y]) keeps the
//                                    stroke within the picture's area at that point
//   { type: 'strokes', strokes }      several fingers drawing at once, undone together
//   { type: 'fill', x, y, color, tone? }    color 'rainbow' fills with a rainbow across the page;
//                                    `tone` is the palette's rainbow saturation/lightness
//   { type: 'background', imageId, clear? }  clear=true also wipes the drawing (a fresh page)
//   { type: 'clear', all }            all=true also removes the background
// Only the last MAX_UNDO ops are kept; older ones are "baked" into a base raster.
// Each page has its own size, chosen to fit the screen when the page is started.

import {
  DEFAULT_SIZE,
  createCanvas,
  canvasToBlob,
  drawStroke,
  floodFill,
  labelRegions,
  prepareFill,
  regionMask,
  toLineArt,
} from './render.js';
import { splitColoredPage } from './colorguide.js';

const MAX_UNDO = 50;

// `?debug=guide` shows a colored page's area guide over it (no area: see-through), and
// `?debug=source` shows the colored page as it came from the generator.
const DEBUG_VIEW = new URLSearchParams(globalThis.location?.search ?? '').get('debug');

// Draws an image as large as fits, centered on the canvas.
function drawFitted(ctx, image) {
  const { width: W, height: H } = ctx.canvas;
  const iw = image.naturalWidth ?? image.width;
  const ih = image.naturalHeight ?? image.height;
  const scale = Math.min(W / iw, H / ih);
  ctx.drawImage(image, (W - iw * scale) / 2, (H - ih * scale) / 2, iw * scale, ih * scale);
}
const MAX_REGION_MASKS = 64;

// crypto.randomUUID only exists on HTTPS/localhost pages; getRandomValues works everywhere,
// including the app opened over plain http:// on the home network.
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

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
  // `lineArt` cleans it up into crisp black-and-white for coloring; `colored` takes a page
  // that's already colored in, keeps only its outlines, and keeps its colors as a guide to
  // its areas (see colorguide.js); `clear` starts a fresh page (in the same undo step, so one
  // undo brings the old drawing back).
  async importBackground(file, { lineArt = false, colored = false, clear = false } = {}) {
    const { width: W, height: H } = this;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d', { willReadFrequently: lineArt || colored });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      drawFitted(ctx, img);
      let guide = null;
      let source = null;
      if (colored) {
        // The colored original is kept too, so a page whose areas come out wrong can be
        // looked at later (see DEBUG_VIEW).
        source = { blob: file, bitmap: await createImageBitmap(file) };
        const page = splitColoredPage(ctx.getImageData(0, 0, W, H));
        ctx.putImageData(new ImageData(page.lineArt, W, H), 0, 0);
        const guideCanvas = createCanvas(W, H);
        guideCanvas.getContext('2d').putImageData(new ImageData(page.guide, W, H), 0, 0);
        guide = { blob: await canvasToBlob(guideCanvas), bitmap: guideCanvas };
      } else if (lineArt) {
        toLineArt(ctx);
      }
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      const imageId = newId();
      this.images.set(imageId, { blob, bitmap: canvas, guide, source });
      this.commit(clear ? { type: 'background', imageId, clear } : { type: 'background', imageId });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // True when a picture is showing, so strokes can stay inside its lines.
  get hasPicture() {
    return Boolean(this.background && this.images.has(this.background));
  }

  // Where a stroke staying inside the lines is kept: the first of its points that lies in an
  // area of the current picture (not on an outline). Null when there's no picture, or when
  // every point is on a line.
  insideSeed(points) {
    const background = this.#backgroundData(this.background);
    if (!background) return null;
    const { labels } = this.#regions(this.background, background);
    for (let i = 0; i < points.length; i += 2) {
      const x = Math.floor(points[i]);
      const y = Math.floor(points[i + 1]);
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      if (labels[y * this.width + x] > 0) return [x, y];
    }
    return null;
  }

  // Finds the current picture's areas ahead of time (it takes a moment on a big page), so
  // the first stroke in coloring mode starts without a pause.
  prepareInside() {
    const background = this.#backgroundData(this.background);
    if (background) this.#regions(this.background, background);
  }

  // The area of the current picture a stroke with this seed stays in (for the live preview).
  insideRegion(seed) {
    return this.#region(this.background, seed);
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
      guides: Object.fromEntries(
        [...used].filter((id) => this.images.get(id).guide).map((id) => [id, this.images.get(id).guide.blob]),
      ),
      sources: Object.fromEntries(
        [...used].filter((id) => this.images.get(id).source).map((id) => [id, this.images.get(id).source.blob]),
      ),
    };
  }

  async restore(data) {
    // Version 1 saves predate per-page sizes and were always 2048×1536.
    this.#reset(data.width ?? DEFAULT_SIZE.width, data.height ?? DEFAULT_SIZE.height);
    for (const [id, blob] of Object.entries(data.images ?? {})) {
      const guideBlob = data.guides?.[id];
      const guide = guideBlob ? { blob: guideBlob, bitmap: await createImageBitmap(guideBlob) } : null;
      const sourceBlob = data.sources?.[id];
      const source = sourceBlob ? { blob: sourceBlob, bitmap: await createImageBitmap(sourceBlob) } : null;
      this.images.set(id, { blob, bitmap: await createImageBitmap(blob), guide, source });
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
    this.images = new Map(); // imageId -> { blob, bitmap, guide, source }; the last two are { blob, bitmap } | null
    this.background = null; // imageId currently shown
    this.bgCache = { id: null, data: null };
    this.guideCache = { id: null, data: null };
    this.regionCache = { id: null, regions: null, masks: new Map() };
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
        this.#drawStroke(ctx, op, state.background);
        return true;
      case 'strokes':
        for (const stroke of op.strokes) this.#drawStroke(ctx, stroke, state.background);
        return true;
      case 'fill':
        return floodFill(ctx, this.#backgroundData(state.background), op.x, op.y, op.color, op.tone, {
          guide: this.#guideData(state.background),
        });
      case 'background':
        if (op.clear) ctx.clearRect(0, 0, this.width, this.height);
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

  #drawStroke(ctx, stroke, background) {
    if (!stroke.inside) {
      drawStroke(ctx, stroke);
      return;
    }
    const region = this.#region(background, stroke.inside);
    if (region) drawStroke(ctx, stroke, region);
  }

  // Area masks of one picture at a time, made on first use.
  #regions(id, background) {
    if (this.regionCache.id !== id) {
      this.regionCache = { id, regions: labelRegions(background, this.#guideData(id)), masks: new Map() };
    }
    return this.regionCache.regions;
  }

  #region(id, [x, y]) {
    const background = this.#backgroundData(id);
    if (!background) return null;
    const regions = this.#regions(id, background);
    const label = regions.labels[y * this.width + x];
    if (!(label > 0)) return null;
    const { masks } = this.regionCache;
    let region = masks.get(label);
    if (region === undefined) {
      if (masks.size >= MAX_REGION_MASKS) masks.delete(masks.keys().next().value);
      region = regionMask(regions, background, label);
    }
    masks.delete(label); // most recently used last
    masks.set(label, region);
    return region;
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
    if (image?.source && DEBUG_VIEW === 'source') drawFitted(ctx, image.source.bitmap);
    if (image?.guide && DEBUG_VIEW === 'guide') {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(image.guide.bitmap, 0, 0);
      ctx.globalAlpha = 1;
    }
    // Finding where the page's lines need closing takes a moment: do it before the first tap.
    const id = this.background;
    if (image) {
      setTimeout(() => this.background === id && prepareFill(this.#backgroundData(id), this.#guideData(id)), 50);
    }
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

  // The current picture's color guide as pixels, or null for a picture without one.
  #guideData(id) {
    const guide = id && this.images.get(id)?.guide;
    if (!guide) return null;
    if (this.guideCache.id !== id) {
      const ctx = createCanvas(this.width, this.height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(guide.bitmap, 0, 0);
      this.guideCache = { id, data: ctx.getImageData(0, 0, this.width, this.height) };
    }
    return this.guideCache.data;
  }

  #changed() {
    this.version++;
    this.dispatchEvent(new Event('change'));
  }
}
