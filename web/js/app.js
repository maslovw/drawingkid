// Wires the document, input, view model and views together.

import { WIDTH, HEIGHT, canvasToBlob } from './render.js';
import { loadConfig } from './config.js';
import { AppViewModel } from './viewmodel.js';
import { DrawingDocument } from './document.js';
import { CanvasInput } from './input.js';
import { loadDrawing, saveDrawing } from './storage.js';
import { detectObjects, emojiFor } from './ai.js';
import { ToolbarView } from './views/toolbar.js';
import { SettingsView } from './views/settings.js';
import { DetectionOverlay, speak } from './views/detections.js';

const $ = (id) => document.getElementById(id);

for (const canvas of $('paper').querySelectorAll('canvas')) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
}

const vm = new AppViewModel(loadConfig());
const doc = new DrawingDocument($('bg'), $('draw'));
new CanvasInput($('paper'), $('live'), doc, () => vm.brush);
new ToolbarView({ tools: $('tools'), sizes: $('sizes'), colors: $('colors') }, vm);
const settings = new SettingsView($('settings-dialog'), vm);
const detections = new DetectionOverlay($('detections'));

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
  $('analyze').hidden = !vm.config.enableAI;
}

doc.addEventListener('change', () => {
  syncActions();
  detections.hide(); // detections are stale once the drawing changes
  scheduleSave();
});
vm.addEventListener('change', syncActions);

$('undo').addEventListener('click', () => doc.undo());
$('redo').addEventListener('click', () => doc.redo());
$('settings').addEventListener('click', () => settings.open());

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

$('clear').addEventListener('click', () => {
  const dialog = $('clear-dialog');
  dialog.querySelector('[value="all"]').hidden = !doc.background;
  dialog.returnValue = '';
  dialog.showModal();
});
$('clear-dialog').addEventListener('close', (e) => {
  const choice = e.target.returnValue;
  if (choice === 'drawing' || choice === 'all') doc.commit({ type: 'clear', all: choice === 'all' });
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

let analyzing = false;
$('analyze').addEventListener('click', async () => {
  if (analyzing) return;
  analyzing = true;
  const button = $('analyze');
  button.setAttribute('aria-busy', 'true');
  const version = doc.version;
  toast('Looking at your drawing…', 10000);
  try {
    const found = await detectObjects(doc.composite(640, 480));
    if (doc.version !== version) return; // drawing changed meanwhile; results are stale
    if (!found.length) {
      toast("Hmm, I'm not sure what that is. Try drawing it bigger!");
      speak("Hmm, I'm not sure what that is.");
      return;
    }
    detections.show(found);
    const names = [...new Set(found.map((d) => d.label))];
    toast(`I see: ${names.map((n) => `${emojiFor(n)} ${n}`).join(', ')}`);
    speak(`I see ${listPhrase(names)}!`);
  } catch (error) {
    console.error(error);
    toast('The magic wand needs an internet connection the first time.');
  } finally {
    analyzing = false;
    button.removeAttribute('aria-busy');
  }
});

function listPhrase(names) {
  const withArticle = names.map((n) => `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`);
  return withArticle.length > 1
    ? `${withArticle.slice(0, -1).join(', ')} and ${withArticle.at(-1)}`
    : withArticle[0];
}

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
syncActions();
document.body.dataset.ready = 'true';
