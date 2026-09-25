// Wires the document, input, view model and views together.

import { PAGE_LONG_SIDE, canvasToBlob } from './render.js';
import { colorValue, loadConfig, loadServerConfig } from './config.js';
import { icon, inkDefs } from './icons.js';
import { AppViewModel } from './viewmodel.js';
import { DrawingDocument } from './document.js';
import { CanvasInput } from './input.js';
import { loadDrawing, saveDrawing } from './storage.js';
import { PROVIDERS, generateColoringPage, loadApiKeys, setManagedApiKeys } from './imagegen.js';
import { recordRequest, estimateCost } from './usagelog.js';
import { LogView } from './views/log.js';
import { ToolbarView } from './views/toolbar.js';
import { SettingsView } from './views/settings.js';
import { ParentGate } from './views/parentgate.js';
import { VoiceInput } from './views/voiceinput.js';

const $ = (id) => document.getElementById(id);

const server = await loadServerConfig();
setManagedApiKeys(server.apiKeys);
const vm = new AppViewModel(loadConfig(server.settings), server.settings);
const doc = new DrawingDocument({ bg: $('bg'), draw: $('draw'), live: $('live') });
new CanvasInput($('paper'), $('live'), doc, () => vm.nextBrush());
new ToolbarView({ tools: $('tools'), sizes: $('sizes'), palettes: $('palettes'), colors: $('colors'), brush: $('brush') }, vm);
const settings = new SettingsView($('settings-dialog'), vm);
const parentGate = new ParentGate($('gate-dialog'));
const log = new LogView($('log-dialog'));
$('settings-log').addEventListener('click', () => log.open());
const voice = new VoiceInput({
  input: $('create-idea'),
  mic: $('create-mic'),
  keyboard: $('create-keyboard'),
  hint: $('create-voice-hint'),
});

// --- Page shape ----------------------------------------------------------
// The paper fills the space between the toolbars. A new page takes the shape of that
// space; if the screen is rotated later, the page keeps its shape and is fitted in.

function syncPaperShape() {
  $('paper').style.setProperty('--page-w', doc.width);
  $('paper').style.setProperty('--page-h', doc.height);
}
doc.addEventListener('resize', syncPaperShape);
syncPaperShape();

function screenPageSize() {
  const stage = $('stage');
  const style = getComputedStyle(stage);
  const w = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const h = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const aspect = Math.min(2, Math.max(0.5, w / h || 4 / 3));
  return aspect >= 1
    ? { width: PAGE_LONG_SIDE, height: Math.round(PAGE_LONG_SIDE / aspect) }
    : { width: Math.round(PAGE_LONG_SIDE * aspect), height: PAGE_LONG_SIDE };
}

function newPageForScreen() {
  const { width, height } = screenPageSize();
  doc.newPage(width, height);
}

// A blank page follows the screen, e.g. when the iPad is rotated before drawing starts.
function refitBlankPage() {
  if (!doc.isBlank) return;
  const { width, height } = screenPageSize();
  if (Math.abs(width / height - doc.width / doc.height) > 0.03) doc.newPage(width, height);
}
let refitTimer;
new ResizeObserver(() => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(refitBlankPage, 250);
}).observe($('stage'));

// Button glyphs: static buttons get theirs here; tool glyphs come from the toolbar view.
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
document.body.insertAdjacentHTML('afterbegin', inkDefs());

// The drawing tools' tips show the chosen colour. Only glyph parts use --ink; text uses --text.
function syncInk() {
  const value = colorValue(vm.color, vm.palette);
  const ink = value === 'rainbow' ? 'url(#dk-ink-rainbow)' : value === 'random' ? 'url(#dk-ink-surprise)' : value;
  document.body.style.setProperty('--ink', ink ?? '#EE5A45');
}
vm.addEventListener('change', syncInk);
syncInk();

function syncLayout() {
  document.body.dataset.hand = vm.config.leftHanded ? 'left' : 'right';
  document.body.dataset.labels = vm.config.showLabels ? 'on' : 'off';
}
vm.addEventListener('change', syncLayout);
syncLayout();

// --- Toast ---------------------------------------------------------------

let toastTimer;
function toast(message, ms = 2500) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// --- Action buttons ------------------------------------------------------

let undoBusy = false;
function syncActions() {
  $('undo').disabled = undoBusy || !doc.canUndo;
  $('redo').disabled = !doc.canRedo;
  $('create').hidden = !vm.config.enableImageGen;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
async function performUndo() {
  if (undoBusy || !doc.canUndo) return;
  undoBusy = true;
  syncActions();
  try {
    // Let the disabled state paint before a deep replay blocks the main thread.
    await nextFrame();
    await nextFrame();
    doc.undo();
    // Keep it disabled until the restored drawing has reached a painted frame.
    await nextFrame();
    await nextFrame();
  } finally {
    undoBusy = false;
    syncActions();
  }
}

doc.addEventListener('change', () => {
  vm.setHasPicture(doc.hasPicture);
  syncActions();
  scheduleSave();
});
vm.addEventListener('change', syncActions);

// Coloring mode needs the picture's areas; find them before the first stroke.
let prepareTimer;
function prepareInside() {
  clearTimeout(prepareTimer);
  if (vm.inside && doc.hasPicture) prepareTimer = setTimeout(() => doc.prepareInside(), 300);
}
doc.addEventListener('change', prepareInside);
vm.addEventListener('change', prepareInside);

$('undo').addEventListener('click', performUndo);
$('redo').addEventListener('click', () => doc.redo());
$('settings').addEventListener('click', async () => {
  if (await parentGate.ask()) settings.open();
});

$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    await doc.importBackground(file);
  } catch {
    toast("Oops, that picture couldn't be opened.");
  }
});

// --- Phone popovers --------------------------------------------------------
// On a phone the brush sizes and palettes, and the less used actions, sit in popovers
// opened from the Brush and More buttons. Elsewhere those buttons are hidden by CSS.

const popovers = [
  { anchor: $('brush'), el: $('brush-tray'), show: (el, on) => el.classList.toggle('open', on) },
  { anchor: $('more'), el: $('more-menu'), show: (el, on) => (el.hidden = !on) },
];

function isOpen(p) {
  return p.anchor.getAttribute('aria-expanded') === 'true';
}

function setOpen(p, on) {
  p.show(p.el, on);
  p.anchor.setAttribute('aria-expanded', String(on));
  if (on) placePopover(p.el, p.anchor);
}

function closePopovers() {
  for (const p of popovers) if (isOpen(p)) setOpen(p, false);
}

// Beside the anchor in landscape (towards the paper), above or below it in portrait.
function placePopover(el, anchor) {
  const a = anchor.getBoundingClientRect();
  const p = el.getBoundingClientRect();
  const gap = 10;
  const edge = 8;
  const clamp = (v, max) => Math.min(Math.max(v, edge), max - edge);
  let left, top;
  if (innerWidth > innerHeight) {
    left = a.left + a.width / 2 < innerWidth / 2 ? a.right + gap : a.left - gap - p.width;
    top = clamp(a.top + a.height / 2 - p.height / 2, innerHeight - p.height);
  } else {
    left = clamp(a.left + a.width / 2 - p.width / 2, innerWidth - p.width);
    top = a.top + a.height / 2 < innerHeight / 2 ? a.bottom + gap : a.top - gap - p.height;
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

for (const p of popovers) {
  p.anchor.addEventListener('click', () => {
    const on = !isOpen(p);
    closePopovers();
    setOpen(p, on);
  });
}
document.addEventListener(
  'pointerdown',
  (e) => {
    for (const p of popovers) if (isOpen(p) && !p.el.contains(e.target) && !p.anchor.contains(e.target)) setOpen(p, false);
  },
  true,
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopovers();
});
addEventListener('resize', closePopovers);

for (const item of $('more-menu').querySelectorAll('[data-for]')) {
  item.addEventListener('click', () => {
    closePopovers();
    $(item.dataset.for).click();
  });
}

// --- Coloring page generator --------------------------------------------

// Idea pictures read without words: tapping one fills in its sentence.
const IDEAS = [
  { glyph: 'dino', label: 'Dinosaur', text: 'A friendly dinosaur having a picnic' },
  { glyph: 'rocket', label: 'Rocket', text: 'A rocket flying to the moon' },
  { glyph: 'castle', label: 'Castle', text: 'A castle with a friendly dragon' },
  { glyph: 'fish', label: 'Fish', text: 'A happy fish under the sea' },
];
let generation = null; // AbortController while a page is being made

const ideaTiles = IDEAS.map((idea) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'idea-tile';
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', idea.text);
  b.innerHTML = `<span class="icon" aria-hidden="true">${icon(idea.glyph)}</span><span class="caption">${idea.label}</span>`;
  b.addEventListener('click', () => {
    voice.stop();
    $('create-idea').value = idea.text;
    syncIdeaTiles();
  });
  return b;
});
$('create-chips').replaceChildren(...ideaTiles);

function syncIdeaTiles() {
  const value = $('create-idea').value;
  ideaTiles.forEach((b, i) => b.setAttribute('aria-pressed', String(IDEAS[i].text === value)));
}
$('create-idea').addEventListener('input', syncIdeaTiles);

$('create').addEventListener('click', () => {
  const { imageProvider } = vm.config;
  $('create-status').textContent = loadApiKeys()[imageProvider]
    ? ''
    : `Ask a grown-up to add the ${PROVIDERS[imageProvider].label} key in Settings.`;
  syncIdeaTiles();
  $('create-dialog').showModal();
  voice.start(); // listen straight away; the keyboard button is there for typing
});

$('create-idea').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('create-go').click();
  }
});

$('create-go').addEventListener('click', async () => {
  voice.stop();
  const idea = $('create-idea').value.trim();
  if (!idea) {
    voice.available ? voice.start() : $('create-idea').focus();
    return;
  }
  if (generation) return;
  const dialog = $('create-dialog');
  const { imageProvider: provider, imageModels } = vm.config;
  generation = new AbortController();
  dialog.setAttribute('aria-busy', 'true');
  $('create-go').disabled = true;
  $('create-status').textContent = '';
  try {
    const model = imageModels[provider];
    let result;
    try {
      result = await generateColoringPage({
        provider,
        model,
        apiKey: loadApiKeys()[provider],
        idea,
        aspect: doc.width / doc.height,
        signal: generation.signal,
      });
    } catch (error) {
      if (error.name !== 'AbortError') recordRequest({ text: idea, provider, model, ok: false, error: error.message });
      throw error;
    }
    recordRequest({
      text: idea,
      provider,
      model,
      ok: true,
      usage: result.usage,
      costUsd: estimateCost(model, result.usage),
    });
    await doc.importBackground(result.blob, { colored: true, clear: true });
    dialog.close();
    $('create-idea').value = '';
    syncIdeaTiles();
    vm.setTool(vm.config.visibleTools.includes('fill') ? 'fill' : vm.config.visibleTools[0]);
    toast('Your coloring page is ready! 🖍️');
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(error);
      $('create-status').textContent = `Oops! Let's try again. (${error.message || 'Something went wrong.'})`;
    }
  } finally {
    generation = null;
    dialog.removeAttribute('aria-busy');
    $('create-go').disabled = false;
  }
});

$('create-dialog').addEventListener('close', () => {
  voice.stop();
  generation?.abort();
});

$('clear').addEventListener('click', () => {
  const dialog = $('clear-dialog');
  dialog.returnValue = '';
  dialog.showModal();
});
$('clear-dialog').addEventListener('close', (e) => {
  const choice = e.target.returnValue;
  if (choice === 'drawing') doc.commit({ type: 'clear', all: false });
  if (choice === 'new') newPageForScreen();
});

$('export').addEventListener('click', async () => {
  const blob = await canvasToBlob(doc.composite());
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = new File([blob], `drawing-${stamp}.png`, { type: 'image/png' });
  // On iPad this opens the share sheet, which includes "Save Image" to Photos.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My drawing' });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  // No share sheet (desktop, or a host that blocks it): show the picture so it can be
  // saved with a long-press / right-click, plus a download button where downloads work.
  const url = URL.createObjectURL(file);
  const dialog = $('save-dialog');
  $('save-image').src = url;
  $('save-download').onclick = () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
  };
  dialog.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
  dialog.showModal();
});

// --- Keyboard shortcuts --------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    e.shiftKey ? doc.redo() : performUndo();
  } else if (key === 'y') {
    e.preventDefault();
    doc.redo();
  }
});

// --- Autosave ------------------------------------------------------------

let saveTimer;
function scheduleSave(delay = 800) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveDrawing(await doc.serialize());
    } catch (error) {
      console.warn('Autosave failed', error);
    }
  }, delay);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') scheduleSave(0);
});

try {
  const saved = await loadDrawing();
  if (saved) await doc.restore(saved);
} catch (error) {
  console.warn('Could not restore the last drawing', error);
}
refitBlankPage();
syncActions();
document.body.dataset.ready = 'true';
