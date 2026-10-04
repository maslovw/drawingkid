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

// What a tile shows: the small thumbnail if the page has one, else its pictures.
export function pageThumbs(page, landscape) {
  const thumb = page.images?.thumb ? [new URL(page.images.thumb, BASE).href] : [];
  return [...thumb, ...pageImages(page, landscape)];
}

// The first of the page's pictures that downloads.
export async function fetchPage(page, landscape, signal) {
  let error;
  for (const url of pageImages(page, landscape)) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) return await response.blob();
      error = new Error(`HTTP ${response.status}`);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      error = e;
    }
  }
  throw error;
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
