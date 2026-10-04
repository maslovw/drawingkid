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
// With a color guide, the areas are the guide's; without one, gaps where a line stops short
// of another are closed by the same invisible walls the fill uses (see lineEndWalls). Pixels
// in neither (walls, blends along an area's edge) then join an area next to them.
export function labelRegions(background, guide = null) {
  const { width: w, height: h } = background;
  const n = w * h;
  const gd = guide?.data;
  const { ink, walls } = lineArt(background, !gd);
  const labels = new Int32Array(n);
  const between = (i) => (walls && walls[i]) || (gd && !gd[i * 4 + 3]);
  for (let i = 0; i < n; i++) labels[i] = ink[i] || between(i) ? 0 : -1; // -1: not labelled yet
  let count = 0;
  const stack = [];
  for (let seed = 0; seed < n; seed++) {
    if (labels[seed] !== -1) continue;
    const label = ++count;
    const key = gd ? guideKey(gd, seed) : -1;
    const open = gd ? (j) => labels[j] === -1 && guideKey(gd, j) === key : (j) => labels[j] === -1;
    stack.push(seed);
    // Scanline flood fill, as in floodFill.
    while (stack.length) {
      let i = stack.pop();
      if (labels[i] !== -1) continue;
      const rowStart = i - (i % w);
      while (i > rowStart && open(i - 1)) i--;
      let upOpen = false;
      let downOpen = false;
      for (; i < rowStart + w && open(i); i++) {
        labels[i] = label;
        if (i >= w) {
          const next = open(i - w);
          if (next && !upOpen) stack.push(i - w);
          upOpen = next;
        }
        if (i < n - w) {
          const next = open(i + w);
          if (next && !downOpen) stack.push(i + w);
          downOpen = next;
        }
      }
    }
  }
  // Walls and blends are a few pixels thick: hand them out to their neighbors from the
  // outside in.
  let pending = [];
  for (let i = 0; i < n; i++) if (!ink[i] && between(i)) pending.push(i);
  while (pending.length) {
    const next = [];
    const found = [];
    for (const i of pending) {
      const cx = i % w;
      let label = 0;
      for (const [dx, dy] of NEIGHBORS) {
        const j = i + dy * w + dx;
        if (cx + dx >= 0 && cx + dx < w && j >= 0 && j < n && !ink[j] && labels[j] > 0) label = labels[j];
      }
      if (label) found.push(i, label);
      else next.push(i);
    }
    if (!found.length) break;
    for (let k = 0; k < found.length; k += 2) labels[found[k]] = found[k + 1];
    pending = next;
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

// Gaps in the outlines narrower than twice this (as a share of the page's long side) are
// closed by the fill: generated pages often leave a line a little short where objects overlap.
const GAP_RADIUS = 1 / 200;

// A line that stops short of another line within this reach (share of the long side) is
// extended to it by an invisible wall, the way a child sees the shape as closed.
const LINE_END_REACH = 1 / 40;

// Per background: which pixels are ink and how much each pixel darkens; with `closing`, also
// which are invisible walls closing line ends and how far each one is from ink or wall.
const lineArtCache = new WeakMap();

// Works out a page's lines ahead of its first fill (the result is cached). A page with a
// color guide (see colorguide.js) knows its areas already and needs no gap closing.
export function prepareFill(background, guide = null) {
  if (background) lineArt(background, !guide);
}

function lineArt(background, closing = true) {
  const { width: w, height: h, data: bg } = background;
  const n = w * h;
  let art = lineArtCache.get(background);
  if (!art) {
    const shade = new Float32Array(n);
    const ink = new Uint8Array(n);
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const lum = 0.299 * bg[o] + 0.587 * bg[o + 1] + 0.114 * bg[o + 2];
      ink[i] = lum < INK_LUMINANCE ? 1 : 0;
      shade[i] = Math.max(lum, 1) / 255;
    }
    art = { ink, shade };
    lineArtCache.set(background, art);
  }
  if (closing && !art.distance) {
    const walls = lineEndWalls(art.ink, w, h, Math.round(Math.max(w, h) * LINE_END_REACH));
    const blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) blocked[i] = art.ink[i] | walls[i];
    Object.assign(art, { walls, blocked, distance: inkDistance(blocked, w, h) });
  }
  return art;
}

// A guide pixel's area color as one number, or -1 where the guide has no area.
function guideKey(guide, i) {
  const o = i * 4;
  return guide[o + 3] ? (guide[o] << 16) | (guide[o + 1] << 8) | guide[o + 2] : -1;
}

// The pixel of an area nearest to (x, y), for taps that land on an area's soft edge; -1 when
// there's none close by.
function nearestGuided(guide, ink, w, h, x, y) {
  for (let r = 0; r <= GUIDE_SNAP; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const i = ny * w + nx;
        if (!ink[i] && guideKey(guide, i) >= 0) return i;
      }
    }
  }
  return -1;
}

// How far (px) a tap may be from an area and still fill it, and how far a guided fill spreads
// past its area into the blended pixels along its edge.
const GUIDE_SNAP = 8;
const GUIDE_FRINGE = 3;

// Thins ink to one-pixel-wide center lines (Zhang-Suen).
function skeletonize(ink, w, h) {
  const s = Uint8Array.from(ink);
  let pixels = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (s[y * w + x]) pixels.push(y * w + x);
  for (let changed = true; changed; ) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove = [];
      for (const i of pixels) {
        if (!s[i]) continue;
        // Neighbors clockwise from north.
        const p = [s[i - w], s[i - w + 1], s[i + 1], s[i + w + 1], s[i + w], s[i + w - 1], s[i - 1], s[i - w - 1]];
        const count = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7];
        if (count < 2 || count > 6) continue;
        let rises = 0;
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) rises++;
        if (rises !== 1) continue;
        if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        remove.push(i);
      }
      for (const i of remove) s[i] = 0;
      if (remove.length) changed = true;
    }
    pixels = pixels.filter((i) => s[i]);
  }
  return s;
}

// Skeleton neighbors of `i`, not counting ones in `skip`.
function skeletonNeighbors(skel, w, i, skip) {
  const out = [];
  for (const [dx, dy] of NEIGHBORS) {
    const j = i + dy * w + dx;
    if (skel[j] && !skip.has(j)) out.push(j);
  }
  return out;
}

const adjacent = (w, a, b) => Math.abs((a % w) - (b % w)) <= 1 && Math.abs(Math.floor(a / w) - Math.floor(b / w)) <= 1;

// Walls that close gaps where a line stops short of another: each line end is followed back
// along its center line to get its direction, then extended; if the extension meets ink
// within `reach`, the stretch in between becomes a wall. Short strokes and branch stubs
// (smile ticks, the tips of stars, thinning artifacts) are skipped, as their direction is
// unreliable, and so are lines that belong to small drawings of their own (a balloon's
// highlight, eyelashes, stars on a hat): only the outlines of whole things get closed.
function lineEndWalls(ink, w, h, reach) {
  const walls = new Uint8Array(w * h);
  const skel = skeletonize(ink, w, h);
  const sizes = inkComponentSizes(ink, w, h);
  const minSize = 3 * reach * reach;
  const trace = Math.max(8, Math.round(reach / 2));
  const thickness = Math.max(1, Math.round(reach / 30));
  const inside = (x, y) => x >= 1 && y >= 1 && x < w - 1 && y < h - 1;

  for (let i = 0; i < skel.length; i++) {
    if (!skel[i] || !inside(i % w, Math.floor(i / w)) || sizes[i] < minSize) continue;
    const first = skeletonNeighbors(skel, w, i, new Set());
    const isEnd = first.length === 1 || (first.length === 2 && adjacent(w, first[0], first[1]));
    if (!isEnd) continue;

    // Walk back along the line.
    const seen = new Set([i]);
    let cur = i;
    let steps = 0;
    for (; steps < trace; steps++) {
      let next = skeletonNeighbors(skel, w, cur, seen);
      // Staircase corners give two touching candidates: take the straight one.
      if (next.length === 2 && adjacent(w, next[0], next[1])) {
        next = [next.find((j) => j % w === cur % w || Math.floor(j / w) === Math.floor(cur / w)) ?? next[0]];
      }
      if (next.length !== 1) break;
      for (const j of skeletonNeighbors(skel, w, cur, seen)) seen.add(j);
      cur = next[0];
      if (!inside(cur % w, Math.floor(cur / w))) break;
    }
    if (steps < trace) continue;

    const ex = i % w, ey = Math.floor(i / w);
    let dx = ex - (cur % w), dy = ey - Math.floor(cur / w);
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;

    // Out through the line's own rounded end, then across the gap.
    let t = 1;
    const at = (t) => {
      const x = Math.round(ex + dx * t), y = Math.round(ey + dy * t);
      return inside(x, y) ? y * w + x : -1;
    };
    while (t < reach && at(t) >= 0 && ink[at(t)]) t++;
    const gapStart = t;
    while (t < gapStart + reach && at(t) >= 0 && !ink[at(t)]) t++;
    if (at(t) < 0 || !ink[at(t)] || t === gapStart) continue;
    for (let k = gapStart - 1; k <= t; k++) {
      const x = Math.round(ex + dx * k), y = Math.round(ey + dy * k);
      for (let oy = -thickness; oy <= thickness; oy++) {
        for (let ox = -thickness; ox <= thickness; ox++) {
          if (inside(x + ox, y + oy) && !ink[(y + oy) * w + x + ox]) walls[(y + oy) * w + x + ox] = 1;
        }
      }
    }
  }
  return walls;
}

// For each ink pixel, how many pixels its connected piece of ink has.
function inkComponentSizes(ink, w, h) {
  const sizes = new Uint32Array(w * h);
  const piece = [];
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || sizes[s]) continue;
    piece.length = 0;
    piece.push(s);
    sizes[s] = 1;
    for (let k = 0; k < piece.length; k++) {
      const i = piece[k];
      const cx = i % w;
      for (const [dx, dy] of NEIGHBORS) {
        const j = i + dy * w + dx;
        if (cx + dx < 0 || cx + dx >= w || j < 0 || j >= ink.length || !ink[j] || sizes[j]) continue;
        sizes[j] = 1;
        piece.push(j);
      }
    }
    for (const i of piece) sizes[i] = piece.length;
  }
  return sizes;
}

// Approximate distance from each pixel to the nearest blocked pixel (two-pass chamfer, 1 and √2).
// Every pixel's value comes from a neighbor one step closer to the ink, which the gap-closing
// fill relies on to reach all the way to the lines.
function inkDistance(blocked, w, h) {
  const d = new Float32Array(w * h);
  const D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

// Paint-bucket fill on the drawing layer. Region boundaries come from what the child *sees*
// (drawing composited over the background), so coloring-page outlines in an uploaded image
// contain the fill even though the fill itself only touches the drawing layer.
// The outlines themselves are never painted over: dark background pixels are walls, and the
// light gray pixels along their edges get the fill color shaded by the gray, so the lines keep
// their full, smooth width. Returns false when nothing changed.
//
// Small gaps in the outlines are closed. The fill first covers only pixels farther than the
// gap radius from any ink, which can't squeeze through a gap, then grows from there toward
// the lines, stepping only to pixels strictly closer to ink. Inside a gap the distance to ink
// rises again past its narrowest point, so the growth stops there instead of spilling out.
// Wider gaps, where a line simply stops short of another, are closed by invisible walls
// (see lineEndWalls) that the fill treats like ink and then colors in.
export function floodFill(ctx, background, x, y, color, tone = DEFAULT_TONE, { guide = null, tolerance = 64 } = {}) {
  const { width: w, height: h } = ctx.canvas;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return false;

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const bg = background?.data;
  const n = w * h;

  // How much the background darkens each pixel (1 = white), which pixels are ink, and how
  // far each pixel is from ink.
  // With a color guide the areas are known, so only the ink blocks (no gap closing).
  // A tap on a spot the guide has no area for fills the plain way (without gap closing), so
  // a tap never does nothing.
  let gd = guide?.data;
  const art = bg ? lineArt(background, !gd) : {};
  const { shade = null, walls = null, distance = null } = art;
  const blocked = art.blocked ?? art.ink ?? null;
  let tap = gd ? nearestGuided(gd, art.ink, w, h, x, y) : y * w + x;
  if (tap < 0) {
    gd = null;
    tap = y * w + x;
  }
  if (blocked && blocked[tap]) return false;
  x = tap % w;
  y = (tap - x) / w;

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

  const sameColor = (i) => {
    const c = i * 3;
    return (
      Math.abs(comp[c] - sr) <= tolerance &&
      Math.abs(comp[c + 1] - sg) <= tolerance &&
      Math.abs(comp[c + 2] - sb) <= tolerance
    );
  };
  const matches = (i) => !(blocked && blocked[i]) && sameColor(i);

  const visited = new Uint8Array(n);
  const paint = (i) => {
    visited[i] = 1;
    const o = i * 4;
    const s = shade ? shade[i] : 1;
    const c = rainbow ? columns[i % w] : null;
    d[o] = (c ? c[0] : fr) * s;
    d[o + 1] = (c ? c[1] : fg) * s;
    d[o + 2] = (c ? c[2] : fb) * s;
    d[o + 3] = 255;
  };

  // Where the gap-closing fill starts: the tap itself, or, when the tap is close to a line,
  // the first pixel clear of the gap radius found by walking away from the lines. A region
  // too narrow to have one is filled the plain way.
  const gap = Math.max(3, Math.round(Math.max(w, h) * GAP_RADIUS));
  let seed = y * w + x;
  if (distance) {
    while (distance[seed] <= gap) {
      const next = farthestNeighbor(distance, w, h, seed, matches);
      if (next < 0) break;
      seed = next;
    }
  }
  const closing = distance && distance[seed] > gap;
  const area = gd ? guideKey(gd, seed) : -1;
  const inside = gd
    ? (i) => guideKey(gd, i) === area && matches(i)
    : closing
      ? (i) => distance[i] > gap && matches(i)
      : matches;
  // Pixels at the edge of the first pass, where the growth toward the lines starts.
  const edge = [];

  // Scanline flood fill.
  const stack = [seed];
  while (stack.length) {
    let i = stack.pop();
    if (visited[i]) continue;
    const row = Math.floor(i / w);
    const rowStart = row * w;
    while (i > rowStart && !visited[i - 1] && inside(i - 1)) i--;
    let upOpen = false;
    let downOpen = false;
    for (; i < rowStart + w && !visited[i] && inside(i); i++) {
      paint(i);
      if (closing && distance[i] <= gap + 2) edge.push(i);
      else if (gd && ((i % w > 0 && !gd[(i - 1) * 4 + 3]) || (i % w < w - 1 && !gd[(i + 1) * 4 + 3]) ||
        (row > 0 && !gd[(i - w) * 4 + 3]) || (row < h - 1 && !gd[(i + w) * 4 + 3]))) edge.push(i);
      if (row > 0) {
        const up = i - w;
        const open = !visited[up] && inside(up);
        if (open && !upOpen) stack.push(up);
        upOpen = open;
      }
      if (row < h - 1) {
        const down = i + w;
        const open = !visited[down] && inside(down);
        if (open && !downOpen) stack.push(down);
        downOpen = open;
      }
    }
  }

  // A guided fill also covers the blended pixels along its area's edge, which belong to no area.
  if (gd) {
    let ring = edge.splice(0);
    for (let step = 0; step < GUIDE_FRINGE && ring.length; step++) {
      const next = [];
      for (const i of ring) {
        const cx = i % w;
        for (const [dx, dy] of NEIGHBORS) {
          const j = i + dy * w + dx;
          if (cx + dx < 0 || cx + dx >= w || j < 0 || j >= n) continue;
          if (visited[j] || gd[j * 4 + 3] || !matches(j)) continue;
          paint(j);
          next.push(j);
        }
      }
      ring = next;
    }
  }

  // Grow toward the lines, only ever stepping closer to ink. Pixels it can't step to are
  // remembered: they're either past a gap or in a narrow nook beyond a pinch.
  const skipped = [];
  while (edge.length) {
    const i = edge.pop();
    const cx = i % w;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const j = i + dy * w + dx;
      if (nx < 0 || nx >= w || j < 0 || j >= n) continue;
      if (visited[j] || !matches(j)) continue;
      if (distance[j] >= distance[i]) {
        skipped.push(j);
        continue;
      }
      paint(j);
      edge.push(j);
    }
  }

  // A nook left beyond a pinch is filled when it's small; past a gap there's always the next
  // area, which is too big to count as a nook.
  if (skipped.length) {
    const explored = new Uint8Array(n);
    const maxNook = 12 * gap * gap;
    for (const s of skipped) {
      if (visited[s] || explored[s]) continue;
      const nook = [s];
      explored[s] = 1;
      let open = false;
      for (let k = 0; k < nook.length && !open; k++) {
        const i = nook[k];
        const cx = i % w;
        for (const [dx, dy] of NEIGHBORS) {
          const nx = cx + dx;
          const j = i + dy * w + dx;
          if (nx < 0 || nx >= w || j < 0 || j >= n) continue;
          if (visited[j] || explored[j] || !matches(j)) continue;
          if (nook.length >= maxNook) {
            open = true;
            break;
          }
          explored[j] = 1;
          nook.push(j);
        }
      }
      if (!open) nook.forEach(paint);
    }
  }

  // The invisible walls take the color of the area they close, where it's still unpainted.
  if (walls) {
    const stack = [];
    for (let i = 0; i < n; i++) if (walls[i] && !visited[i] && sameColor(i) && touches(visited, w, h, i)) stack.push(i);
    while (stack.length) {
      const i = stack.pop();
      if (visited[i]) continue;
      paint(i);
      const cx = i % w;
      for (const [dx, dy] of NEIGHBORS) {
        const j = i + dy * w + dx;
        if (cx + dx >= 0 && cx + dx < w && j >= 0 && j < n && walls[j] && !visited[j] && sameColor(j)) stack.push(j);
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return true;
}

const NEIGHBORS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Whether any neighbor of pixel `i` is set in `mask`.
function touches(mask, w, h, i) {
  const cx = i % w;
  for (const [dx, dy] of NEIGHBORS) {
    const j = i + dy * w + dx;
    if (cx + dx >= 0 && cx + dx < w && j >= 0 && j < w * h && mask[j]) return true;
  }
  return false;
}

// The neighbor of pixel `i` farthest from ink, if it's farther than `i` and passes `ok`; else -1.
function farthestNeighbor(distance, w, h, i, ok) {
  const cx = i % w;
  let best = -1;
  let bestDistance = distance[i];
  for (const [dx, dy] of NEIGHBORS) {
    const nx = cx + dx;
    const j = i + dy * w + dx;
    if (nx < 0 || nx >= w || j < 0 || j >= w * h) continue;
    if (distance[j] > bestDistance && ok(j)) {
      best = j;
      bestDistance = distance[j];
    }
  }
  return best;
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
