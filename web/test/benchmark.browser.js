const { DrawingDocument } = await import('/js/document.js');
const canvas = () => document.createElement('canvas');
const layers = { bg: canvas(), draw: canvas(), live: canvas() };
for (const layer of Object.values(layers)) {
  layer.style.cssText = 'position:absolute;left:0;top:0;width:800px;height:600px';
  document.body.append(layer);
}
const doc = new DrawingDocument(layers);
doc.newPage(2048, 1536);
const bitmap = canvas();
bitmap.width = 2048;
bitmap.height = 1536;
const bg = bitmap.getContext('2d');
bg.fillStyle = '#fff';
bg.fillRect(0, 0, 2048, 1536);
bg.fillStyle = '#000';
bg.lineWidth = 3;
for (let x = 64; x < 2048; x += 64) {
  bg.beginPath(); bg.moveTo(x, 0); bg.lineTo(x, 1536); bg.stroke();
}
doc.images.set('bench', { bitmap });
doc.commit({ type: 'background', imageId: 'bench' });
const commit = [];
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  doc.commit({ type: 'fill', x: 20 + i * 64, y: 700, color: i % 2 ? '#e04040' : '#40a0e0' });
  commit.push(performance.now() - start);
}
const handler = [];
const paint = [];
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  doc.undo();
  handler.push(performance.now() - start);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  paint.push(performance.now() - start);
  doc.redo();
}
const strokeCommit = [];
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  doc.commit({ type: 'stroke', tool: 'pen', color: '#111111', size: 3, points: [10 + i * 60, 50, 10 + i * 60, 1400] });
  strokeCommit.push(performance.now() - start);
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * .95) - 1];
return { chrome: navigator.userAgent, handler: { median: median(handler), p95: p95(handler), samples: handler }, paint: { median: median(paint), p95: p95(paint), samples: paint }, fillCommit: { median: median(commit), p95: p95(commit), samples: commit }, strokeCommit: { median: median(strokeCommit), p95: p95(strokeCommit), samples: strokeCommit } };
