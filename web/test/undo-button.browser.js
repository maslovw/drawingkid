const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
for (let i = 0; i < 60 && document.body.dataset.ready !== 'true'; i++) await frame();
if (document.body.dataset.ready !== 'true') throw new Error('app did not become ready');
const fill = document.querySelector('#tools button[aria-label="Fill"]');
if (!fill) throw new Error('Fill tool is unavailable');
fill.click();
const paper = document.getElementById('paper');
const rect = paper.getBoundingClientRect();
const tap = () => paper.dispatchEvent(new PointerEvent('pointerdown', {
  bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0,
  clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
}));
tap();
const nextColor = document.querySelector('#colors button.swatch[aria-pressed="false"]');
if (!nextColor) throw new Error('Second color is unavailable');
nextColor.click();
tap();
const undo = document.getElementById('undo');
const redo = document.getElementById('redo');
if (undo.disabled) throw new Error('two fills did not create undo history');
undo.click();
if (!undo.disabled || getComputedStyle(undo).opacity !== '0.35') throw new Error('Undo did not gray out while running');
document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'z', ctrlKey: true }));
await frame();
if (!undo.disabled) throw new Error('Undo re-enabled before its busy state could paint');
for (let i = 0; i < 8; i++) await frame();
if (undo.disabled) throw new Error('Undo did not re-enable after finishing');
if (redo.disabled) throw new Error('queued keyboard Undo consumed the remaining step');
return { passed: true };
