// Pre-made coloring pages (pages/library.json): the Create dialog offers a few of them
// each time it opens, so a page is there instantly, for free and without an API key.

const BASE = new URL('../pages/', import.meta.url);

export async function loadLibrary() {
  try {
    const response = await fetch(new URL('library.json', BASE), { cache: 'no-cache' });
    if (!response.ok) return [];
    const { pages } = await response.json();
    return Array.isArray(pages) ? pages.filter((p) => p?.id && p.prompt) : [];
  } catch (error) {
    console.warn('Could not load the coloring page library', error);
    return [];
  }
}

export function pageLabel(page, language) {
  return page.label?.[language] ?? page.label?.en ?? page.prompt;
}

// Picture URLs to try, the one matching the paper's shape first.
export function pageImages(page, landscape) {
  const images = { portrait: `${page.id}-portrait.png`, landscape: `${page.id}-landscape.png`, ...page.images };
  const order = landscape ? [images.landscape, images.portrait] : [images.portrait, images.landscape];
  return order.filter(Boolean).map((file) => new URL(file, BASE).href);
}

// A page's thumbnail: a small, simple emoji-like picture of its subject for the tile.
export function pageThumb(page) {
  return new URL(page.images?.thumb ?? `${page.id}-thumb.webp`, BASE).href;
}

// The prompt for a page's thumbnail. `thumbPrompt` in the entry names the subject;
// otherwise its English label does.
export function thumbPrompt(page) {
  const subject = page.thumbPrompt ?? page.label?.en ?? page.prompt;
  return [
    `One simple emoji-style icon of: ${subject}.`,
    'A single cute subject, centered and filling most of the square, seen from the front or side.',
    'Chunky rounded shapes, flat bright colors, a thick dark rounded outline, at most one tiny highlight.',
    'Transparent background: no scene, no ground, no frame, no shadow, no text.',
    'It must read clearly when shown very small, like an emoji.',
  ].join(' ');
}

// The first of the page's pictures that exists (checked once per page and shape), or null.
const found = new Map();
export function findPage(page, landscape) {
  const key = `${page.id}:${landscape}`;
  if (!found.has(key)) {
    found.set(
      key,
      (async () => {
        for (const url of pageImages(page, landscape)) {
          try {
            if ((await fetch(url, { method: 'HEAD' })).ok) return url;
          } catch {
            // offline or blocked: try the next one
          }
        }
        found.delete(key); // try again next time, e.g. after the pictures are added
        return null;
      })(),
    );
  }
  return found.get(key);
}

export async function fetchPage(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

// `count` random pages, leaving out the ones in `avoid` (the last set shown) while
// there are enough others.
export function pickPages(pages, count, avoid = new Set()) {
  const fresh = shuffle(pages.filter((p) => !avoid.has(p.id)));
  const rest = shuffle(pages.filter((p) => avoid.has(p.id)));
  return [...fresh, ...rest].slice(0, count);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
