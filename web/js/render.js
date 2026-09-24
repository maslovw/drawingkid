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
// `points` is a flat [x0, y0, x1, y1, ...] array.
export function drawStroke(ctx, stroke) {
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
    ctx.globalCompositeOperation = 'destination-out';
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

// Paint-bucket fill on the drawing layer. Region boundaries come from what the child *sees*
// (drawing composited over the background), so coloring-page outlines in an uploaded image
// contain the fill even though the fill itself only touches the drawing layer.
// Returns false when nothing changed.
export function floodFill(ctx, background, x, y, color, tone = DEFAULT_TONE, tolerance = 64) {
  const { width: w, height: h } = ctx.canvas;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return false;

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const bg = background?.data;
  const n = w * h;

  // What's visible at each pixel: drawing alpha-blended over background (white if none).
  const comp = new Uint8ClampedArray(n * 3);
  for (let i = 0, o = 0, c = 0; i < n; i++, o += 4, c += 3) {
    const a = d[o + 3] / 255;
    for (let k = 0; k < 3; k++) {
      const under = bg ? bg[o + k] : 255;
      comp[c + k] = d[o + k] * a + under * (1 - a);
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
      if (rainbow) {
        const c = columns[i - rowStart];
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
      } else {
        d[o] = fr;
        d[o + 1] = fg;
        d[o + 2] = fb;
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
