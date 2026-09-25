const { DrawingDocument } = await import('/js/document.js');
const { CanvasInput } = await import('/js/input.js');
const canvas = () => document.createElement('canvas');
const makeDoc = (w = 96, h = 72) => {
  const canvases = { bg: canvas(), draw: canvas(), live: canvas() };
  const doc = new DrawingDocument(canvases);
  doc.newPage(w, h);
  return { doc, canvases };
};
const pixels = (ctx) => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
const equal = (a, b, label) => {
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error(label);
};
const checkReplay = (doc, label) => {
  const drawing = new Uint8Array(pixels(doc.drawCtx));
  const background = new Uint8Array(pixels(doc.bgCtx));
  const id = doc.background;
  const cache = new Map([...doc.undoCache].map(([op, state]) => [op, {
    pixels: new ImageData(new Uint8ClampedArray(state.pixels.data), doc.width, doc.height),
    background: state.background,
  }]));
  doc.renderAll();
  equal(drawing, pixels(doc.drawCtx), `${label}: drawing differs from replay`);
  equal(background, pixels(doc.bgCtx), `${label}: background differs from replay`);
  if (id !== doc.background) throw new Error(`${label}: background id differs from replay`);
  doc.undoCache = cache;
  if (doc.undoPool) doc.undoPool.free = Array.from({ length: doc.undoPool.count }, (_, i) => i);
};
const stroke = (x, color = '#ff0000', tool = 'pen') => ({ type: 'stroke', tool, color, size: 8, points: [x, 10, x, 60] });
const { doc } = makeDoc();
const bg = canvas(); bg.width = 96; bg.height = 72;
bg.getContext('2d').fillStyle = '#00ff00'; bg.getContext('2d').fillRect(0, 0, 96, 72);
doc.images.set('green', { bitmap: bg, blob: await new Promise((resolve) => bg.toBlob(resolve)) });
doc.commit(stroke(20));
doc.commit({ type: 'fill', x: 70, y: 30, color: '#0000ff' });
doc.commit(stroke(20, '#000000', 'eraser'));
doc.commit({ type: 'background', imageId: 'green' });
doc.commit({ type: 'clear', all: false });
doc.commit(stroke(50));
let replays = 0;
const realRender = doc.renderAll.bind(doc);
doc.renderAll = (...args) => { replays++; return realRender(...args); };
doc.undo();
if (replays) throw new Error('recent undo replayed operations');
checkReplay(doc, 'stroke undo');
doc.undo(); checkReplay(doc, 'clear undo');
doc.undo(); checkReplay(doc, 'background undo');
doc.undo(); checkReplay(doc, 'eraser undo');
doc.undo(); checkReplay(doc, 'fill undo');
doc.redo(); checkReplay(doc, 'fill redo');
doc.undo(); checkReplay(doc, 'fill undo after redo');
doc.commit({ type: 'clear', all: true });
doc.undo(); checkReplay(doc, 'clear all undo');
doc.commit({ type: 'background', imageId: 'green', clear: true });
doc.undo(); checkReplay(doc, 'background with clear undo');

// The cache is a runtime accelerator; a restore rebuilds it without changing save data.
const saved = await doc.serialize();
if ('undoCache' in saved) throw new Error('cache leaked into saved drawing');
const restored = makeDoc();
await restored.doc.restore(saved);
checkReplay(restored.doc, 'reload');
let restoreReplays = 0;
const restoreRender = restored.doc.renderAll.bind(restored.doc);
restored.doc.renderAll = (...args) => { restoreReplays++; return restoreRender(...args); };
restored.doc.undo();
if (restoreReplays) throw new Error('recent undo after reload replayed operations');
checkReplay(restored.doc, 'reload undo');

// Undo past the memory window may replay, but must still match exact pixels.
const many = makeDoc(64, 48).doc;
for (let i = 0; i < 15; i++) many.commit(stroke(5 + i * 3, i % 2 ? '#222222' : '#eeeeee'));
if (many.undoCache.size !== 8) throw new Error('recent cache exceeded eight operations');
many.undoCache.clear();
let deepReplays = 0;
const deepRender = many.renderAll.bind(many);
many.renderAll = (...args) => { deepReplays++; return deepRender(...args); };
for (let i = 0; i < 15; i++) { many.undo(); checkReplay(many, `deep undo ${i}`); }
if (!deepReplays) throw new Error('deep undo never replayed after cache miss');
many.newPage(64, 48);
if (many.canUndo) throw new Error('new page kept undo history');
if (many.undoCache.size) throw new Error('new page kept undo snapshots');

const large = makeDoc(2048, 1536).doc;
for (let i = 0; i < 8; i++) large.commit(stroke(10 + i * 20));
if (large.undoCache.size !== 5) throw new Error('recent cache exceeded 64 MiB');
const oversized = makeDoc(4097, 4097).doc;
oversized.captureUndoState = () => { throw new Error('oversized page captured a snapshot'); };
oversized.commit(stroke(20));

const noOp = makeDoc().doc;
noOp.commit({ type: 'fill', x: 40, y: 30, color: '#aa0000' });
if (noOp.commit({ type: 'fill', x: 40, y: 30, color: '#aa0000' })) throw new Error('same-color fill recorded an operation');
for (let i = 0; i < 8; i++) noOp.commit(stroke(5 + i * 9));
for (let i = 0; i < 12; i++) {
  if (noOp.commit({ type: 'fill', x: -1, y: 30, color: '#000' })) throw new Error('outside fill recorded an operation');
}
if (noOp.undoCache.size !== 8 || [...noOp.undoCache.keys()].some((op, i) => op !== noOp.ops.at(-8 + i))) {
  throw new Error('no-op fill evicted a recent undo snapshot');
}
noOp.commit(stroke(25));
noOp.undo(); checkReplay(noOp, 'undo after repeated no-op fills');

// An eraser preview must not become the snapshot used by Undo.
const surface = document.createElement('div');
surface.style.width = '96px'; surface.style.height = '72px';
surface.setPointerCapture = () => {};
surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 96, height: 72 });
document.body.append(surface);
const eraser = makeDoc();
eraser.doc.commit(stroke(30));
new CanvasInput(surface, eraser.canvases.live, eraser.doc, () => ({ tool: 'eraser', color: '#000', size: 9 }));
const pointer = (type, id) => surface.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'mouse', button: 0, clientX: 30, clientY: 30 }));
pointer('pointerdown', 1);
await new Promise((resolve) => requestAnimationFrame(resolve));
pointer('pointerup', 1);
eraser.doc.undo(); checkReplay(eraser.doc, 'preview eraser undo');
pointer('pointerdown', 2);
await new Promise((resolve) => requestAnimationFrame(resolve));
pointer('pointercancel', 2);
if (eraser.doc.canRedo === false) throw new Error('cancelled eraser changed history');
checkReplay(eraser.doc, 'cancelled eraser');

pointer('pointerdown', 3);
await new Promise((resolve) => requestAnimationFrame(resolve));
eraser.doc.commit(stroke(70, '#0000ff'));
pointer('pointerup', 3);
eraser.doc.undo(); checkReplay(eraser.doc, 'eraser undo after intervening commit');

const surface2 = surface.cloneNode();
surface2.setPointerCapture = () => {};
surface2.getBoundingClientRect = surface.getBoundingClientRect;
document.body.append(surface2);
const uncached = makeDoc();
uncached.doc.commit(stroke(30));
const realCapture = uncached.doc.captureUndoState.bind(uncached.doc);
uncached.doc.captureUndoState = () => null;
new CanvasInput(surface2, uncached.canvases.live, uncached.doc, () => ({ tool: 'eraser', color: '#000', size: 9 }));
const pointer2 = (type) => surface2.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 4, pointerType: 'mouse', button: 0, clientX: 30, clientY: 30 }));
pointer2('pointerdown');
uncached.doc.captureUndoState = realCapture;
await new Promise((resolve) => requestAnimationFrame(resolve));
uncached.doc.commit({ type: 'fill', x: 30, y: 30, color: '#0000ff' });
pointer2('pointerup');
checkReplay(uncached.doc, 'uncached eraser with intervening fill');
return { passed: true };
