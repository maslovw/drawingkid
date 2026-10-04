// Makes the pictures for the pre-made coloring pages in pages/library.json that don't
// have them yet: a portrait and a landscape page (the Create button's prompt) and a
// small emoji-like thumbnail for the tile. Without --go it only lists what is missing.
//
//   node web/tools/make-pages.mjs                          # list missing pictures
//   OPENAI_API_KEY=sk-… node web/tools/make-pages.mjs --go  # make them
//   options: --only dinosaur,unicorn   --pages (no thumbnails)   --thumbs (only thumbnails)
//            --model gpt-image-2.5-flare

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROVIDERS, coloringPrompt } from '../js/imagegen.js';
import { thumbPrompt } from '../js/library.js';

const pagesDir = resolve(import.meta.dirname, '..', 'pages');
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const go = args.includes('--go');
const only = option('--only')?.split(',');
const model = option('--model') ?? PROVIDERS.openai.defaultModel;
const KINDS = {
  portrait: { size: '1024x1536', file: (page) => page.images?.page ?? page.images?.portrait ?? `${page.id}-portrait.png`, prompt: (page) => coloringPrompt(page.prompt) },
  landscape: { size: '1536x1024', file: (page) => page.images?.page ?? page.images?.landscape ?? `${page.id}-landscape.png`, prompt: (page) => coloringPrompt(page.prompt) },
  // Smallest size the API makes; webp on a transparent background keeps the file small.
  thumb: {
    size: '1024x1024',
    file: (page) => page.images?.thumb ?? `${page.id}-thumb.webp`,
    prompt: thumbPrompt,
    extra: { background: 'transparent', output_format: 'webp', output_compression: 70 },
  },
};
const kinds = args.includes('--thumbs') ? ['thumb'] : args.includes('--pages') ? ['portrait', 'landscape'] : Object.keys(KINDS);

const exists = (path) => access(path).then(() => true, () => false);
const { pages, pictures = '.' } = JSON.parse(await readFile(join(pagesDir, 'library.json'), 'utf8'));
// The pictures aren't in git: they go where library.json's "pictures" says (web/gallery/).
const picturesDir = resolve(pagesDir, pictures);
await mkdir(picturesDir, { recursive: true });

const missing = [];
for (const page of pages) {
  if (only && !only.includes(page.id)) continue;
  for (const kind of kinds) {
    // A page with a preview shows it on its tile, not an emoji thumbnail.
    if (kind === 'thumb' && page.images?.preview) continue;
    const file = KINDS[kind].file(page);
    // One picture for both shapes (`images.page`) is made once.
    if (missing.some((m) => m.file === file)) continue;
    if (!(await exists(join(picturesDir, file)))) missing.push({ page, kind, file });
  }
}

console.log(`${missing.length} picture(s) missing${missing.length ? ':' : ''}`);
for (const { file, page, kind } of missing) console.log(`  ${file}  (${kind === 'thumb' ? page.thumbPrompt ?? page.label?.en : page.prompt})`);
if (!go || !missing.length) process.exit(0);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Set OPENAI_API_KEY to make them.');
  process.exit(1);
}

for (const { page, kind, file } of missing) {
  const { size, prompt, extra } = KINDS[kind];
  process.stdout.write(`Making ${file}… `);
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt: prompt(page), n: 1, size, quality: 'medium', ...extra }),
  });
  const body = await response.json().catch(() => null);
  const b64 = body?.data?.[0]?.b64_json;
  if (!response.ok || !b64) {
    console.log(`failed: ${body?.error?.message ?? `HTTP ${response.status}`}`);
    continue;
  }
  await writeFile(join(picturesDir, file), Buffer.from(b64, 'base64'));
  console.log('done');
}
