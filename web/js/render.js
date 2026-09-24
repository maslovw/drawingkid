// Pure drawing helpers: stroke rendering and flood fill.

export const WIDTH = 2048;
export const HEIGHT = 1536;

// Per-tool look. `width` multiplies the brush size.
const TOOL_STYLES = {
  pen: { width: 1, alpha: 1 },
  pencil: { width: 0.5, alpha: 0.8 },
  marker: { width: 2.2, alpha: 0.45 },
  eraser: { width: 2.5, alpha: 1 },
};

export function createCanvas(width = WIDTH, height = HEIGHT) {
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

// Draws a whole stroke as one path, so translucent tools don't darken where segments overlap.
// `points` is a flat [x0, y0, x1, y1, ...] array.
export function drawStroke(ctx, stroke) {
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

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Paint-bucket fill on the drawing layer. Region boundaries come from what the child *sees*
// (drawing composited over the background), so coloring-page outlines in an uploaded image
// contain the fill even though the fill itself only touches the drawing layer.
// Returns false when nothing changed.
export function floodFill(ctx, background, x, y, color, tolerance = 64) {
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
  const [fr, fg, fb] = hexToRgb(color);
  const startOffset = (y * w + x) * 4;
  if (sr === fr && sg === fg && sb === fb && d[startOffset + 3] === 255) return false;

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
      d[o] = fr;
      d[o + 1] = fg;
      d[o + 2] = fb;
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
