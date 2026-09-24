// Wires the document, input, view model and views together.

import { PAGE_LONG_SIDE, canvasToBlob } from './render.js';
import { colorValue, loadConfig, loadServerConfig } from './config.js';
import { icon, inkDefs } from './icons.js';
import { AppViewModel } from './viewmodel.js';
import { DrawingDocument } from './document.js';
import { CanvasInput } from './input.js';
import { loadDrawing, saveDrawing } from './storage.js';
import { PROVIDERS, generateColoringPage, loadApiKeys, setManagedApiKeys } from './imagegen.js';
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
new ToolbarView({ tools: $('tools'), sizes: $('sizes'), palettes: $('palettes'), colors: $('colors') }, vm);
const settings = new SettingsView($('settings-dialog'), vm);
const parentGate = new ParentGate($('gate-dialog'));
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

function syncActions() {
  $('undo').disabled = !doc.canUndo;
  $('redo').disabled = !doc.canRedo;
  $('create').hidden = !vm.config.enableImageGen;
}

doc.addEventListener('change', () => {
  syncActions();
  scheduleSave();
});
vm.addEventListener('change', syncActions);

$('undo').addEventListener('click', () => doc.undo());
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

// --- Coloring page generator --------------------------------------------

const IDEAS = ['A dinosaur eating ice cream', 'A cat astronaut on the moon', 'A castle with a friendly dragon', 'An underwater tea party'];
let generation = null; // AbortController while a page is being made

$('create-chips').replaceChildren(
  ...IDEAS.map((idea) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = idea;
    b.addEventListener('click', () => {
      voice.stop();
      $('create-idea').value = idea;
    });
    return b;
  }),
);

$('create').addEventListener('click', () => {
  const { imageProvider } = vm.config;
  $('create-status').textContent = loadApiKeys()[imageProvider]
    ? ''
    : `Ask a grown-up to add an API key for ${PROVIDERS[imageProvider].label} in Settings first.`;
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
  $('create-status').textContent = 'Drawing your page… this takes about 10–30 seconds.';
  try {
    const blob = await generateColoringPage({
      provider,
      model: imageModels[provider],
      apiKey: loadApiKeys()[provider],
      idea,
      aspect: doc.width / doc.height,
      signal: generation.signal,
    });
    await doc.importBackground(blob, { lineArt: true, clear: true });
    dialog.close();
    $('create-idea').value = '';
    vm.setTool(vm.config.visibleTools.includes('fill') ? 'fill' : vm.config.visibleTools[0]);
    toast('Your coloring page is ready! 🖍️');
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(error);
      $('create-status').textContent = error.message || 'Something went wrong. Please try again.';
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
    e.shiftKey ? doc.redo() : doc.undo();
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
