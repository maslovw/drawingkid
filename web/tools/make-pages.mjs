// Makes the pictures for the pre-made coloring pages in pages/library.json that don't
// have them yet, with the same prompt the Create button uses: one portrait and one
// landscape picture per page. Without --go it only lists what is missing.
//
//   node web/tools/make-pages.mjs                         # list missing pictures
//   OPENAI_API_KEY=sk-… node web/tools/make-pages.mjs --go [--only dinosaur,unicorn] [--model gpt-image-2.5-flare]

import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROVIDERS, coloringPrompt } from '../js/imagegen.js';

const pagesDir = resolve(import.meta.dirname, '..', 'pages');
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const go = args.includes('--go');
const only = option('--only')?.split(',');
const model = option('--model') ?? PROVIDERS.openai.defaultModel;
const SIZES = { portrait: '1024x1536', landscape: '1536x1024' };

const exists = (path) => access(path).then(() => true, () => false);
const { pages } = JSON.parse(await readFile(join(pagesDir, 'library.json'), 'utf8'));

const missing = [];
for (const page of pages) {
  if (only && !only.includes(page.id)) continue;
  for (const shape of Object.keys(SIZES)) {
    const file = page.images?.[shape] ?? `${page.id}-${shape}.png`;
    if (!(await exists(join(pagesDir, file)))) missing.push({ page, shape, file });
  }
}

console.log(`${missing.length} picture(s) missing${missing.length ? ':' : ''}`);
for (const { file, page } of missing) console.log(`  ${file}  (${page.prompt})`);
if (!go || !missing.length) process.exit(0);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Set OPENAI_API_KEY to make them.');
  process.exit(1);
}

for (const { page, shape, file } of missing) {
  process.stdout.write(`Making ${file}… `);
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt: coloringPrompt(page.prompt), n: 1, size: SIZES[shape], quality: 'medium' }),
  });
  const body = await response.json().catch(() => null);
  const b64 = body?.data?.[0]?.b64_json;
  if (!response.ok || !b64) {
    console.log(`failed: ${body?.error?.message ?? `HTTP ${response.status}`}`);
    continue;
  }
  await writeFile(join(pagesDir, file), Buffer.from(b64, 'base64'));
  console.log('done');
}
