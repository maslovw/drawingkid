// Turns a generated page that's already colored in (flat colors, black outlines) into a
// black-and-white page to color plus a guide of its areas.
//
// The colors tell apart areas that the outlines alone don't: an outline with a gap, a circle
// inside a circle, two shapes that only meet by color. The page the child sees keeps only the
// outlines (with lines added where two colors meet without one); the guide keeps each area's
// flat color so the fill bucket and coloring mode know exactly where an area ends.

// Pixels whose brightest channel is below this are outline ink. Dark colors (navy, deep
// green) have one bright channel, so they don't count.
const INK_MAX = 100;

// A color takes a palette slot when it covers at least this share of the page.
const MIN_COLOR_SHARE = 0.0005;
// Palette colors closer than this (RGB distance) are the same color. It must stay below
// MAX_RESIDUAL, or a color just too far to match a palette color but too close to get its own
// slot would belong to no area at all.
const MERGE_DISTANCE = 36;
const MAX_COLORS = 16;
// Pixels farther than this from every palette color (after allowing for darkening toward an
// outline) are blends between two colors: they belong to no area.
const MAX_RESIDUAL = 44;
// Pixels at least this light (as a share of a palette color) are that color, flat. Darker
// ones are only an area's soft edge, so they're matched to the area they touch.
const FLAT_LIGHT = 0.9;
// ...unless some palette color explains them darkened better than this (RGB distance).
const FLAT_SLACK = 12;
// Areas smaller than this share of the page are specks from blending, not real areas.
const MIN_AREA_SHARE = 0.00003;
// Off-palette patches: neighbors differing by at most this much per channel are one patch,
// and a patch must be at least this thick (px) somewhere, or it's just a blend along an edge.
const LOOSE_STEP = 12;
const LOOSE_DEPTH = 4;
// An area is shaded, not flat, when more than this share of its pixels are farther than
// SHADED_OFFSET from its color.
const SHADED_OFFSET = 12;
const SHADED_SHARE = 0.25;
// Touching areas whose colors are closer than this blend into one when they meet smoothly.
const CLOSE_COLORS = 64;
// A real area is at least this thick somewhere (px from its edge to its middle, and at least
// this share of the outline width). Thinner ones are the blurred edge of an outline (gray on
// white, darker green on green): they join the area next to them instead of getting seams.
const MIN_DEPTH = 2.5;
const MIN_DEPTH_OF_LINE = 0.4;
// ...except a thin area outlines wall off from every other area, which is real if it's at
// least this thick (a narrow stripe, about 4 px across).
const MIN_STRIPE_DEPTH = 1.5;

// `image` is { width, height, data } (RGBA). Returns { lineArt, guide, colors }: two RGBA
// arrays of the same size, and how many palette colors were found. `lineArt` is the page to
// show (gray outlines on white); in `guide` every area pixel has its area's flat color and
// alpha 255, and everything else has alpha 0.
export function splitColoredPage(image) {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const palette = findPalette(data, n);

  // Each pixel as a palette color darkened by `t` toward black (an outline's soft edge).
  // Flat pages repeat the same few thousand colors, so each is worked out once.
  // First only near-flat matches (t ≥ FLAT_LIGHT): any neutral gray is also white darkened,
  // so a gray area would otherwise split into white and gray specks with seams between them.
  const color = new Int16Array(n).fill(-1);
  const light = new Float32Array(n);
  const known = new Map();
  const maxResidual2 = MAX_RESIDUAL * MAX_RESIDUAL;
  const darkened = (o, k) => {
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const [pr, pg, pb] = palette[k];
    const t = Math.min(1, (r * pr + g * pg + b * pb) / (pr * pr + pg * pg + pb * pb || 1));
    const dr = r - t * pr, dg = g - t * pg, db = b - t * pb;
    return [dr * dr + dg * dg + db * db, t];
  };
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const r = data[o], g = data[o + 1], b = data[o + 2];
    if (r < INK_MAX && g < INK_MAX && b < INK_MAX) continue;
    const rgb = (r << 16) | (g << 8) | b;
    let match = known.get(rgb);
    if (match === undefined) {
      let best = -1;
      let bestResidual = Infinity;
      let bestT = 0;
      let anyResidual = Infinity;
      for (let k = 0; k < palette.length; k++) {
        let [residual, t] = darkened(o, k);
        anyResidual = Math.min(anyResidual, residual);
        if (t < FLAT_LIGHT) {
          const [pr, pg, pb] = palette[k];
          const dr = r - FLAT_LIGHT * pr, dg = g - FLAT_LIGHT * pg, db = b - FLAT_LIGHT * pb;
          residual = dr * dr + dg * dg + db * db;
          t = FLAT_LIGHT;
        }
        if (residual < bestResidual) {
          best = k;
          bestResidual = residual;
          bestT = t;
        }
      }
      // A pixel some color explains much better darkened than any color does flat is a soft
      // edge, left for the growing below.
      const flat = bestResidual <= maxResidual2 && Math.sqrt(bestResidual) - Math.sqrt(anyResidual) <= FLAT_SLACK;
      match = flat ? [best, bestT] : null;
      known.set(rgb, match);
    }
    if (match) {
      color[i] = match[0];
      light[i] = match[1];
    }
  }
  // Then each color grows into the darker pixels next to it (its soft edge toward an outline),
  // nearest first, taking only pixels that are that color darkened.
  let front = [];
  for (let i = 0; i < n; i++) if (color[i] >= 0) front.push(i);
  while (front.length) {
    const next = [];
    for (const i of front) {
      const k = color[i];
      const x = i % w;
      for (let side = 0; side < 4; side++) {
        const j = side === 0 ? (x > 0 ? i - 1 : -1) : side === 1 ? (x < w - 1 ? i + 1 : -1) : side === 2 ? i - w : i + w;
        if (j < 0 || j >= n || color[j] >= 0) continue;
        const o = j * 4;
        if (data[o] < INK_MAX && data[o + 1] < INK_MAX && data[o + 2] < INK_MAX) continue;
        const [residual, t] = darkened(o, k);
        if (residual > maxResidual2) continue;
        color[j] = k;
        light[j] = t;
        next.push(j);
      }
    }
    front = next;
  }
  const ink = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    ink[i] = data[o] < INK_MAX && data[o + 1] < INK_MAX && data[o + 2] < INK_MAX ? 1 : 0;
  }

  // Areas: connected pixels of one palette color. Specks are dropped.
  const area = new Int32Array(n);
  const minArea = Math.max(16, Math.round(n * MIN_AREA_SHARE));
  let areas = 0;
  const stack = [];
  const members = [];
  for (let s = 0; s < n; s++) {
    if (color[s] < 0 || area[s]) continue;
    const id = ++areas;
    members.length = 0;
    stack.push(s);
    area[s] = id;
    while (stack.length) {
      const i = stack.pop();
      members.push(i);
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < n - w) visit(i + w);
    }
    if (members.length < minArea) for (const i of members) area[i] = -1;

    function visit(j) {
      if (!area[j] && color[j] === color[s]) {
        area[j] = id;
        stack.push(j);
      }
    }
  }

  // Patches in a color the palette missed (a rare color, a pale or gradient fill) are areas
  // too. Pixels whose neighbors change color only a little are one patch; a patch that fades
  // into a palette area joins it, and one with only thin blends along an edge is dropped.
  const loose = new Uint8Array(n);
  for (let i = 0; i < n; i++) loose[i] = !ink[i] && area[i] <= 0 ? 1 : 0;
  const notLoose = new Uint8Array(n);
  for (let i = 0; i < n; i++) notLoose[i] = loose[i] ? 0 : 1;
  const depth = chamferDistance(notLoose, w, h);
  const similar = (i, j) => {
    const a = i * 4, b = j * 4;
    return (
      Math.abs(data[a] - data[b]) <= LOOSE_STEP &&
      Math.abs(data[a + 1] - data[b + 1]) <= LOOSE_STEP &&
      Math.abs(data[a + 2] - data[b + 2]) <= LOOSE_STEP
    );
  };
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (!loose[s] || seen[s]) continue;
    members.length = 0;
    stack.push(s);
    seen[s] = 1;
    let deepest = 0;
    let joins = 0;
    let sum = [0, 0, 0];
    while (stack.length) {
      const i = stack.pop();
      members.push(i);
      deepest = Math.max(deepest, depth[i]);
      for (let k = 0; k < 3; k++) sum[k] += data[i * 4 + k];
      const x = i % w;
      for (let side = 0; side < 4; side++) {
        const j = side === 0 ? (x > 0 ? i - 1 : -1) : side === 1 ? (x < w - 1 ? i + 1 : -1) : side === 2 ? i - w : i + w;
        if (j < 0 || j >= n || !similar(i, j)) continue;
        if (loose[j]) {
          if (!seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        } else if (area[j] > 0 && !joins) {
          joins = j;
        }
      }
    }
    if (members.length < minArea || deepest < LOOSE_DEPTH) continue;
    let index;
    let id;
    if (joins) {
      index = color[joins];
      id = area[joins];
    } else {
      // A color of its own, nudged until it's unlike any palette color already used.
      const mean = sum.map((v) => Math.round(v / members.length));
      while (palette.some((p) => p[0] === mean[0] && p[1] === mean[1] && p[2] === mean[2])) mean[2] ^= 1;
      palette.push(mean);
      index = palette.length - 1;
      id = ++areas;
    }
    for (const i of members) {
      color[i] = index;
      light[i] = 1;
      area[i] = id;
    }
  }

  // Two areas that blend smoothly into each other are one area, with the color of its larger
  // part, when their colors are close (two near-identical greens on one body) or both are
  // shaded (a gradient the palette cut in two). A soft edge between two clearly different flat
  // colors (a pink inner ear on an orange head) stays a border.
  const areaColor = new Int32Array(areas + 1);
  const areaSize = new Float64Array(areas + 1);
  const flatCount = new Float64Array(areas + 1);
  const offCount = new Float64Array(areas + 1);
  for (let i = 0; i < n; i++) {
    const a = area[i];
    if (a <= 0) continue;
    areaColor[a] = color[i];
    areaSize[a]++;
    if (light[i] < 0.97) continue;
    const [pr, pg, pb] = palette[color[i]];
    const o = i * 4;
    const dr = data[o] - pr, dg = data[o + 1] - pg, db = data[o + 2] - pb;
    flatCount[a]++;
    if (dr * dr + dg * dg + db * db > SHADED_OFFSET * SHADED_OFFSET) offCount[a]++;
  }
  const shaded = (a) => flatCount[a] > 0 && offCount[a] / flatCount[a] > SHADED_SHARE;
  const closeColors = (k, l) => {
    const [r1, g1, b1] = palette[k];
    const [r2, g2, b2] = palette[l];
    return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2 < CLOSE_COLORS * CLOSE_COLORS;
  };
  const parent = Int32Array.from({ length: areas + 1 }, (_, k) => k);
  const find = (k) => {
    while (parent[k] !== k) k = parent[k] = parent[parent[k]];
    return k;
  };
  let merged = false;
  for (let i = 0; i < n; i++) {
    const a = area[i];
    if (a <= 0) continue;
    for (let side = 0; side < 2; side++) {
      const j = side ? i + w : i % w < w - 1 ? i + 1 : -1;
      if (j < 0 || j >= n || area[j] <= 0 || area[j] === a || !similar(i, j)) continue;
      if (!closeColors(areaColor[a], areaColor[area[j]]) && !(shaded(a) && shaded(area[j]))) continue;
      const ra = find(a), rb = find(area[j]);
      if (ra === rb) continue;
      // The larger part stays the root, so the group keeps its color.
      if (areaSize[ra] >= areaSize[rb]) {
        parent[rb] = ra;
        areaSize[ra] += areaSize[rb];
      } else {
        parent[ra] = rb;
        areaSize[rb] += areaSize[ra];
      }
      merged = true;
    }
  }
  if (merged) {
    for (let i = 0; i < n; i++) {
      if (area[i] <= 0) continue;
      const root = find(area[i]);
      if (root !== area[i]) {
        area[i] = root;
        color[i] = areaColor[root];
        light[i] = 1;
      }
    }
  }

  // Thin areas are an outline's blurred edge, not areas: an anti-aliased or blurry black line
  // on white leaves bands of gray that match a real gray area's color flat. Their pixels join
  // the thick area next to them, nearest first, as its soft edge.
  const lineWidth = outlineWidth(data, w, h);
  const edge = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = area[i];
    if (a <= 0) {
      edge[i] = 1;
      continue;
    }
    const x = i % w;
    if ((x > 0 && area[i - 1] !== a) || (x < w - 1 && area[i + 1] !== a) || (i >= w && area[i - w] !== a) || (i < n - w && area[i + w] !== a)) {
      edge[i] = 1;
    }
  }
  const inside = chamferDistance(edge, w, h);
  const areaDepth = new Float32Array(areas + 1);
  for (let i = 0; i < n; i++) if (area[i] > 0 && inside[i] > areaDepth[area[i]]) areaDepth[area[i]] = inside[i];
  const minDepth = Math.max(MIN_DEPTH, lineWidth * MIN_DEPTH_OF_LINE);
  const thin = (a) => a > 0 && areaDepth[a] < minDepth;
  const wasArea = new Int32Array(n); // a thin pixel's own area, until a thick one takes it
  const absorbed = new Uint8Array(areas + 1);
  front = [];
  let thinPixels = 0;
  for (let i = 0; i < n; i++) {
    if (thin(area[i])) {
      wasArea[i] = area[i];
      area[i] = 0;
      thinPixels++;
    } else if (area[i] > 0) {
      front.push(i);
    }
  }
  while (thinPixels && front.length) {
    const next = [];
    for (const i of front) {
      const x = i % w;
      for (let side = 0; side < 4; side++) {
        const j = side === 0 ? (x > 0 ? i - 1 : -1) : side === 1 ? (x < w - 1 ? i + 1 : -1) : side === 2 ? i - w : i + w;
        if (j < 0 || j >= n || area[j] !== 0 || color[j] < 0 || ink[j]) continue;
        absorbed[wasArea[j]] = 1;
        area[j] = area[i];
        color[j] = color[i];
        light[j] = darkened(j * 4, color[i])[1];
        next.push(j);
      }
    }
    front = next;
  }
  // A thin area walled off by outlines, a few pixels across, is a real narrow area (a stripe),
  // so it stays one; a hairline or the rest of a band a thick area took part of is no area.
  for (let i = 0; i < n; i++) {
    if (area[i] !== 0 || color[i] < 0) continue;
    const a = wasArea[i];
    area[i] = absorbed[a] || areaDepth[a] < MIN_STRIPE_DEPTH ? -1 : a;
  }

  // Where two areas meet with no outline between them, the page gets one drawn in, about as
  // thick as the page's outlines (the band where both areas are within reach is ~2·reach wide).
  const reach = 2;
  const radius = Math.max(0.75, lineWidth / 2 - reach);
  const seam = new Uint8Array(n);
  for (let y = reach; y < h - reach; y++) {
    for (let x = reach; x < w - reach; x++) {
      const i = y * w + x;
      if (ink[i]) continue;
      let a = 0;
      let meets = false;
      let inked = false;
      for (let k = -reach; k <= reach && !inked; k++) {
        const across = i + k;
        const down = i + k * w;
        if (ink[across] || ink[down]) inked = true;
        for (let side = 0, id = area[across]; side < 2; side++, id = area[down]) {
          if (id <= 0) continue;
          if (!a) a = id;
          else if (id !== a) meets = true;
        }
      }
      if (meets && !inked) seam[i] = 1;
    }
  }
  const seamDistance = chamferDistance(seam, w, h);
  // Only pixels right next to an outline are its soft edge; farther in, a darker color is
  // just a darker color.
  const inkDistance = chamferDistance(ink, w, h);

  const lineArt = new Uint8ClampedArray(n * 4);
  const guide = new Uint8ClampedArray(n * 4);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    let v;
    if (color[i] < 0) {
      // Ink, or a blend of two colors (drawn as the lighter side, so it stays clean).
      const mx = Math.max(data[o], data[o + 1], data[o + 2]);
      v = mx < INK_MAX ? mx * 0.6 : 255;
    } else {
      v = inkDistance[i] <= 2 ? Math.min(255, (light[i] / 0.85) * 255) : 255;
    }
    const d = seamDistance[i];
    if (d <= radius) v = 0;
    else if (d < radius + 1) v = Math.min(v, (d - radius) * 255);
    lineArt[o] = lineArt[o + 1] = lineArt[o + 2] = v;
    lineArt[o + 3] = 255;

    if (area[i] > 0 && d > radius) {
      const [r, g, b] = palette[color[i]];
      guide[o] = r;
      guide[o + 1] = g;
      guide[o + 2] = b;
      guide[o + 3] = 255;
    }
  }
  return { lineArt, guide, colors: palette.length };
}

// The page's main flat colors, most common first.
function findPalette(data, n) {
  const bins = new Map();
  for (let o = 0; o < n * 4; o += 4) {
    const r = data[o], g = data[o + 1], b = data[o + 2];
    if (Math.max(r, g, b) < INK_MAX) continue;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bin = bins.get(key);
    if (!bin) bins.set(key, (bin = [0, 0, 0, 0]));
    bin[0] += r;
    bin[1] += g;
    bin[2] += b;
    bin[3]++;
  }
  const palette = [];
  const minCount = n * MIN_COLOR_SHARE;
  for (const [r, g, b, count] of [...bins.values()].sort((a, b) => b[3] - a[3])) {
    if (count < minCount || palette.length >= MAX_COLORS) break;
    const c = [r / count, g / count, b / count];
    if (palette.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > MERGE_DISTANCE)) palette.push(c);
  }
  return palette.map((c) => c.map(Math.round));
}

// Typical outline thickness: the median length of horizontal runs of ink.
function outlineWidth(data, w, h) {
  const runs = [];
  for (let y = 0; y < h; y += 4) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (Math.max(data[o], data[o + 1], data[o + 2]) < INK_MAX) run++;
      else {
        if (run >= 2 && run <= 40) runs.push(run);
        run = 0;
      }
    }
  }
  runs.sort((a, b) => a - b);
  return runs.length ? runs[runs.length >> 1] : 6;
}

// Approximate distance from each pixel to the nearest set pixel of `mask` (chamfer 1, √2).
export function chamferDistance(mask, w, h) {
  const d = new Float32Array(w * h);
  const D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : Infinity;
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
