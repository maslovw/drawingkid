// Gallery: every coloring page there is, full screen. "Made by me" holds the pages the
// kid generated (kept in IndexedDB, newest first); "Ready to color" the developer's
// pre-made pages whose pictures exist. Tapping one puts it on the paper.

import { t, getLanguage } from '../i18n.js';
import { icon } from '../icons.js';
import { deletePage, listPages } from '../storage.js';
import { fetchPage, findPage, pageImages, pageLabel, pageThumb } from '../library.js';

const THUMB_SIZE = 320;

// A small JPEG of a page for its gallery tile.
export async function makeThumb(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

export class GalleryView {
  // onPick({ blob, options }) puts a page on the paper; confirmDelete() asks a grown-up.
  constructor(dialog, { library, landscape, onPick, confirmDelete }) {
    this.dialog = dialog;
    this.library = library;
    this.landscape = landscape;
    this.onPick = onPick;
    this.confirmDelete = confirmDelete;
    this.urls = []; // object URLs of the current tiles, revoked on close
    dialog.querySelector('.gallery-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => this.#revoke());
  }

  async open() {
    this.dialog.showModal();
    await this.render();
  }

  async render() {
    this.#revoke();
    const mine = await listPages().catch(() => []);
    mine.sort((a, b) => b.createdAt - a.createdAt);
    const landscape = this.landscape();
    const premade = (await Promise.all(this.library.map(async (page) => ({ page, url: await findPage(page, landscape) })))).filter((p) => p.url);

    const mineGrid = this.dialog.querySelector('#gallery-mine');
    const premadeGrid = this.dialog.querySelector('#gallery-premade');
    mineGrid.replaceChildren(...mine.map((record) => this.#mineTile(record)));
    premadeGrid.replaceChildren(...premade.map(({ page, url }) => this.#premadeTile(page, url, landscape)));
    this.dialog.querySelector('#gallery-mine-section').hidden = !mine.length;
    this.dialog.querySelector('#gallery-premade-section').hidden = !premade.length;
    this.dialog.querySelector('#gallery-empty').hidden = Boolean(mine.length || premade.length);
  }

  #mineTile(record) {
    const thumbUrl = URL.createObjectURL(record.thumb ?? record.blob);
    this.urls.push(thumbUrl);
    const tile = this.#tile(thumbUrl, record.text, () => ({ blob: record.blob, options: { colored: true } }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'gallery-delete';
    remove.title = t('gallery.delete');
    remove.setAttribute('aria-label', t('gallery.delete'));
    remove.innerHTML = `<span class="icon" aria-hidden="true">${icon('close')}</span>`;
    remove.addEventListener('click', async () => {
      if (!(await this.confirmDelete())) return;
      await deletePage(record.id);
      await this.render();
    });
    tile.append(remove);
    return tile;
  }

  #premadeTile(page, url, landscape) {
    const tile = this.#tile(pageThumb(page), pageLabel(page, getLanguage()), async () => ({
      blob: await fetchPage(url),
      options: page.style === 'lineArt' ? { lineArt: true } : { colored: true },
    }));
    // No thumbnail yet: show the page itself.
    const img = tile.querySelector('img');
    const fallbacks = pageImages(page, landscape);
    img.addEventListener('error', () => {
      img.classList.remove('emoji');
      if (fallbacks.length) img.src = fallbacks.shift();
    });
    img.classList.add('emoji');
    return tile;
  }

  #tile(src, label, load) {
    const item = document.createElement('li');
    item.className = 'gallery-item';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gallery-tile';
    b.setAttribute('aria-label', label);
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = src;
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = label;
    b.append(img, caption);
    b.addEventListener('click', async () => {
      if (this.dialog.querySelector('.gallery-tile[aria-busy]')) return;
      b.setAttribute('aria-busy', 'true');
      try {
        await this.onPick(await load());
        this.dialog.close();
      } catch (error) {
        console.error(error);
      } finally {
        b.removeAttribute('aria-busy');
      }
    });
    item.append(b);
    return item;
  }

  #revoke() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }
}
