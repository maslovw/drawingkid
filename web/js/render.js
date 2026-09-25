// Pure drawing helpers: stroke rendering and flood fill.

// Pages are sized to the screen when started; this is the size of pages saved before that.
export const DEFAULT_SIZE = Object.freeze({ width: 2048, height: 1536 });

// Long side of a page in canvas pixels (the short side follows the screen's shape).
export const PAGE_LONG_SIDE = 2048;

// Per-tool look. `width` multiplies the brush size.
const TOOL_STYLES = {
  pen: { width: 1, alpha: 1 },
  pencil: { width: 0.5, alpha: 0.8 },
  marker: { width: 2.2, alpha: 0.45 },
  eraser: { width: 2.5, alpha: 1 },
};

export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality),
  );
}

// Rainbow strokes run through the hues at this many degrees per canvas pixel drawn.
const RAINBOW_DEGREES_PER_PX = 0.35;

// `tone` ({ s, l } in %) is the palette's rainbow; strokes saved before palettes had none.
const DEFAULT_TONE = { s: 85, l: 52 };

export function rainbowCss(hue, tone = DEFAULT_TONE) {
  return `hsl(${Math.round(hue) % 360} ${tone.s}% ${tone.l}%)`;
}

// Draws a whole stroke as one path, so translucent tools don't darken where segments overlap.
// `points` is a flat [x0, y0, x1, y1, ...] array. With a `region` (see regionMask) the
// stroke only lands inside that area of the picture, eraser included.
export function drawStroke(ctx, stroke, region = null) {
  if (region) {
    drawClippedStroke(ctx, stroke, region);
    return;
  }
  if (stroke.color === 'rainbow' && stroke.tool !== 'eraser') {
    drawRainbowStroke(ctx, stroke);
    return;
  }
  const style = TOOL_STYLES[stroke.tool];
  const pts = stroke.points;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.size * style.width;
  ctx.globalAlpha = style.alpha;
  if (stroke.tool === 'eraser') {
    if (!stroke.asShape) ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = ctx.fillStyle = '#000';
  } else {
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
  }
  ctx.beginPath();
  if (pts.length === 2) {
    ctx.arc(pts[0], pts[1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(pts[0], pts[1]);
    // Smooth the polyline by curving through segment midpoints.
    for (let i = 2; i < pts.length - 2; i += 2) {
      const mx = (pts[i] + pts[i + 2]) / 2;
      const my = (pts[i + 1] + pts[i + 3]) / 2;
      ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

// Each smoothed piece of the path gets its own hue. The curve's direction is continuous where
// pieces meet, so they get flat ends there and only the stroke's two ends are rounded.
// Translucent tools are drawn opaque on a scratch canvas and then blended in once.
let scratch = null;
function drawRainbowStroke(ctx, stroke) {
  const style = TOOL_STYLES[stroke.tool];
  const pts = stroke.points;
  const { width, height } = ctx.canvas;
  let target = ctx;
  let box = null;
  if (style.alpha < 1) {
    if (!scratch || scratch.width !== width || scratch.height !== height) scratch = createCanvas(width, height);
    target = scratch.getContext('2d');
    box = strokeBounds(pts, stroke.size * style.width, width, height);
    target.clearRect(box.x, box.y, box.w, box.h);
  }
  target.save();
  target.lineCap = 'butt';
  target.lineJoin = 'round';
  target.lineWidth = stroke.size * style.width;
  let hue = stroke.hue ?? 0;
  const dot = (x, y) => {
    target.fillStyle = rainbowCss(hue, stroke.tone);
    target.beginPath();
    target.arc(x, y, target.lineWidth / 2, 0, Math.PI * 2);
    target.fill();
  };
  dot(pts[0], pts[1]);
  if (pts.length > 2) {
    // Same curve as drawStroke: through segment midpoints, then a line to the last point.
    let [sx, sy] = [pts[0], pts[1]];
    const piece = (draw, ex, ey, length) => {
      // Blend from this piece's hue to the next one's along the piece.
      if (length < 0.5) {
        target.strokeStyle = rainbowCss(hue, stroke.tone);
      } else {
        const gradient = target.createLinearGradient(sx, sy, ex, ey);
        gradient.addColorStop(0, rainbowCss(hue, stroke.tone));
        gradient.addColorStop(1, rainbowCss(hue + length * RAINBOW_DEGREES_PER_PX, stroke.tone));
        target.strokeStyle = gradient;
      }
      target.beginPath();
      target.moveTo(sx, sy);
      draw();
      target.stroke();
      hue += length * RAINBOW_DEGREES_PER_PX;
      [sx, sy] = [ex, ey];
    };
    for (let i = 2; i < pts.length - 2; i += 2) {
      const mx = (pts[i] + pts[i + 2]) / 2;
      const my = (pts[i + 1] + pts[i + 3]) / 2;
      const length = Math.hypot(pts[i] - sx, pts[i + 1] - sy) + Math.hypot(mx - pts[i], my - pts[i + 1]);
      piece(() => target.quadraticCurveTo(pts[i], pts[i + 1], mx, my), mx, my, length);
    }
    const [ex, ey] = [pts[pts.length - 2], pts[pts.length - 1]];
    const length = Math.hypot(ex - sx, ey - sy);
    piece(() => target.lineTo(ex, ey), ex, ey, length);
    dot(ex, ey);
  }
  target.restore();
  if (target !== ctx) {
    ctx.save();
    ctx.globalAlpha = style.alpha;
    ctx.drawImage(scratch, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    ctx.restore();
  }
}

// A clipped stroke is drawn on its own scratch canvas, cut to the region's mask there, and
// then painted (or, for the eraser, erased) onto the target.
let clipScratch = null;
function drawClippedStroke(ctx, stroke, region) {
  const { width, height } = ctx.canvas;
  const style = TOOL_STYLES[stroke.tool];
  const s = strokeBounds(stroke.points, stroke.size * style.width, width, height);
  const r = region.box;
  const x = Math.max(s.x, r.x);
  const y = Math.max(s.y, r.y);
  const w = Math.min(s.x + s.w, r.x + r.w) - x;
  const h = Math.min(s.y + s.h, r.y + r.h) - y;
  if (w <= 0 || h <= 0) return;
  if (!clipScratch || clipScratch.width !== width || clipScratch.height !== height) {
    clipScratch = createCanvas(width, height);
  }
  const sc = clipScratch.getContext('2d');
  sc.clearRect(x, y, w, h);
  drawStroke(sc, stroke.tool === 'eraser' ? { ...stroke, asShape: true } : stroke);
  sc.save();
  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(region.mask, x - r.x, y - r.y, w, h, x, y, w, h);
  sc.restore();
  ctx.save();
  if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(clipScratch, x, y, w, h, x, y, w, h);
  ctx.restore();
}

// Splits a picture into its areas: connected pixels that aren't outline ink. Returns
// { labels, count, width, height }, where labels[i] is the area of pixel i (0 = ink).
export function labelRegions(background) {
  const { width: w, height: h, data: bg } = background;
  const n = w * h;
  const labels = new Int32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const lum = 0.299 * bg[o] + 0.587 * bg[o + 1] + 0.114 * bg[o + 2];
    labels[i] = lum < INK_LUMINANCE ? 0 : -1; // -1: not labelled yet
  }
  let count = 0;
  const stack = [];
  for (let seed = 0; seed < n; seed++) {
    if (labels[seed] !== -1) continue;
    const label = ++count;
    stack.push(seed);
    // Scanline flood fill, as in floodFill.
    while (stack.length) {
      let i = stack.pop();
      if (labels[i] !== -1) continue;
      const rowStart = i - (i % w);
      while (i > rowStart && labels[i - 1] === -1) i--;
      let upOpen = false;
      let downOpen = false;
      for (; i < rowStart + w && labels[i] === -1; i++) {
        labels[i] = label;
        if (i >= w) {
          const open = labels[i - w] === -1;
          if (open && !upOpen) stack.push(i - w);
          upOpen = open;
        }
        if (i < n - w) {
          const open = labels[i + w] === -1;
          if (open && !downOpen) stack.push(i + w);
          downOpen = open;
        }
      }
    }
  }
  return { labels, count, width: w, height: h };
}

// A mask of one area, cropped to its bounding box: { mask: canvas, box }. The soft gray edge
// of an outline is only partly covered, so paint fades into the line instead of hiding it.
export function regionMask(regions, background, label) {
  const { labels, width: w, height: h } = regions;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== label) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const mask = createCanvas(box.w, box.h);
  const mctx = mask.getContext('2d');
  const image = mctx.createImageData(box.w, box.h);
  const d = image.data;
  const bg = background.data;
  for (let y = 0; y < box.h; y++) {
    for (let x = 0, i = (y + box.y) * w + box.x, o = y * box.w * 4; x < box.w; x++, i++, o += 4) {
      if (labels[i] !== label) continue;
      const b = i * 4;
      const lum = 0.299 * bg[b] + 0.587 * bg[b + 1] + 0.114 * bg[b + 2];
      d[o + 3] = Math.min(255, ((lum - INK_LUMINANCE) / (255 - INK_LUMINANCE - 20)) * 255);
    }
  }
  mctx.putImageData(image, 0, 0);
  return { mask, box };
}

// The stroke's bounding box, padded by its width and clamped to the canvas.
function strokeBounds(pts, lineWidth, width, height) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  const pad = lineWidth / 2 + 2;
  const x = Math.max(0, Math.floor(x0 - pad));
  const y = Math.max(0, Math.floor(y0 - pad));
  return {
    x,
    y,
    w: Math.max(1, Math.min(width, Math.ceil(x1 + pad)) - x),
    h: Math.max(1, Math.min(height, Math.ceil(y1 + pad)) - y),
  };
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Background pixels darker than this are outline "ink": fills stop at them and never cover them.
const INK_LUMINANCE = 128;

// Paint-bucket fill on the drawing layer. Region boundaries come from what the child *sees*
// (drawing composited over the background), so coloring-page outlines in an uploaded image
// contain the fill even though the fill itself only touches the drawing layer.
// The outlines themselves are never painted over: dark background pixels are walls, and the
// light gray pixels along their edges get the fill color shaded by the gray, so the lines keep
// their full, smooth width. Returns false when nothing changed.
export function floodFill(ctx, background, x, y, color, tone = DEFAULT_TONE, tolerance = 64) {
  const { width: w, height: h } = ctx.canvas;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return false;

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const bg = background?.data;
  const n = w * h;

  // How much the background darkens each pixel (1 = white), and which pixels are ink.
  const shade = bg ? new Float32Array(n) : null;
  const ink = bg ? new Uint8Array(n) : null;
  if (bg) {
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const lum = 0.299 * bg[o] + 0.587 * bg[o + 1] + 0.114 * bg[o + 2];
      ink[i] = lum < INK_LUMINANCE ? 1 : 0;
      shade[i] = Math.max(lum, 1) / 255;
    }
    if (ink[y * w + x]) return false;
  }

  // What's visible at each pixel (drawing alpha-blended over background, white if none),
  // with the background's shading divided back out, so an outline's soft gray edge counts
  // as part of the area next to it and a shaded fill matches its plain color.
  const comp = new Uint8ClampedArray(n * 3);
  for (let i = 0, o = 0, c = 0; i < n; i++, o += 4, c += 3) {
    const a = d[o + 3] / 255;
    const s = shade ? shade[i] : 1;
    for (let k = 0; k < 3; k++) {
      const under = bg ? bg[o + k] : 255;
      comp[c + k] = (d[o + k] * a + under * (1 - a)) / s;
    }
  }

  const start = (y * w + x) * 3;
  const sr = comp[start], sg = comp[start + 1], sb = comp[start + 2];
  // A rainbow fill runs through the hues from the left edge of the page to the right.
  const rainbow = color === 'rainbow';
  const columns = rainbow ? Array.from({ length: w }, (_, cx) => hslToRgb((cx / w) * 360, tone.s / 100, tone.l / 100)) : null;
  const [fr, fg, fb] = rainbow ? columns[x] : hexToRgb(color);
  const startOffset = (y * w + x) * 4;
  if (!rainbow && sr === fr && sg === fg && sb === fb && d[startOffset + 3] === 255) return false;

  const matches = (i) => {
    if (ink && ink[i]) return false;
    const c = i * 3;
    return (
      Math.abs(comp[c] - sr) <= tolerance &&
      Math.abs(comp[c + 1] - sg) <= tolerance &&
      Math.abs(comp[c + 2] - sb) <= tolerance
    );
  };

  // Scanline flood fill.
  const visited = new Uint8Array(n);
  const stack = [y * w + x];
  while (stack.length) {
    let i = stack.pop();
    if (visited[i]) continue;
    const row = Math.floor(i / w);
    const rowStart = row * w;
    while (i > rowStart && !visited[i - 1] && matches(i - 1)) i--;
    let upOpen = false;
    let downOpen = false;
    for (; i < rowStart + w && !visited[i] && matches(i); i++) {
      visited[i] = 1;
      const o = i * 4;
      const s = shade ? shade[i] : 1;
      if (rainbow) {
        const c = columns[i - rowStart];
        d[o] = c[0] * s;
        d[o + 1] = c[1] * s;
        d[o + 2] = c[2] * s;
      } else {
        d[o] = fr * s;
        d[o + 1] = fg * s;
        d[o + 2] = fb * s;
      }
      d[o + 3] = 255;
      if (row > 0) {
        const up = i - w;
        const open = !visited[up] && matches(up);
        if (open && !upOpen) stack.push(up);
        upOpen = open;
      }
      if (row < h - 1) {
        const down = i + w;
        const open = !visited[down] && matches(down);
        if (open && !downOpen) stack.push(down);
        downOpen = open;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

// Cleans generated line art: near-white becomes pure white and near-black pure black, so
// the fill bucket sees crisp regions. Mid-tones (anti-aliased edges) are kept as gray.
export function toLineArt(ctx) {
  const { width: w, height: h } = ctx.canvas;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let o = 0; o < d.length; o += 4) {
    const lum = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    const v = lum >= 200 ? 255 : lum <= 100 ? 0 : lum;
    d[o] = d[o + 1] = d[o + 2] = v;
    d[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
