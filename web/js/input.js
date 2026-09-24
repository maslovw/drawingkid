// Turns pointer input (Apple Pencil, finger, mouse) into document ops, with a live preview.

import { WIDTH, HEIGHT, drawStroke } from './render.js';

const MIN_POINT_DISTANCE = 2; // canvas px

export class CanvasInput {
  constructor(surface, liveCanvas, doc, getBrush) {
    this.surface = surface;
    this.liveCtx = liveCanvas.getContext('2d');
    this.doc = doc;
    this.getBrush = getBrush;
    this.active = null; // { pointerId, stroke }
    this.frame = 0;

    surface.addEventListener('pointerdown', (e) => this.#down(e));
    surface.addEventListener('pointermove', (e) => this.#move(e));
    surface.addEventListener('pointerup', (e) => this.#up(e));
    surface.addEventListener('pointercancel', (e) => this.#cancel(e));
  }

  #toCanvas(e) {
    const rect = this.surface.getBoundingClientRect();
    const round = (v) => Math.round(v * 10) / 10;
    return [
      round(((e.clientX - rect.left) * WIDTH) / rect.width),
      round(((e.clientY - rect.top) * HEIGHT) / rect.height),
    ];
  }

  #down(e) {
    // One stroke at a time; ignore extra fingers/palm and non-primary mouse buttons.
    if (this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const brush = this.getBrush();
    const [x, y] = this.#toCanvas(e);
    if (brush.tool === 'fill') {
      this.doc.commit({ type: 'fill', x: Math.round(x), y: Math.round(y), color: brush.color });
      return;
    }
    this.surface.setPointerCapture(e.pointerId);
    this.active = {
      pointerId: e.pointerId,
      stroke: { type: 'stroke', tool: brush.tool, color: brush.color, size: brush.size, points: [x, y] },
    };
    this.#scheduleDraw();
  }

  #move(e) {
    if (e.pointerId !== this.active?.pointerId) return;
    const pts = this.active.stroke.points;
    // Coalesced events give the full Apple Pencil sample rate where supported.
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = this.#toCanvas(ev);
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      if (Math.hypot(x - lx, y - ly) >= MIN_POINT_DISTANCE) pts.push(x, y);
    }
    this.#scheduleDraw();
  }

  #up(e) {
    if (e.pointerId !== this.active?.pointerId) return;
    const { stroke } = this.#finish();
    this.doc.commit(stroke);
  }

  #cancel(e) {
    if (e.pointerId !== this.active?.pointerId) return;
    const { stroke } = this.#finish();
    // The eraser previews directly on the drawing layer, so restore it.
    if (stroke.tool === 'eraser') this.doc.renderAll();
  }

  #finish() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const active = this.active;
    this.active = null;
    this.liveCtx.clearRect(0, 0, WIDTH, HEIGHT);
    return active;
  }

  #scheduleDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.active) return;
      const { stroke } = this.active;
      if (stroke.tool === 'eraser') {
        // Erasing is idempotent, so redrawing the whole path each frame is safe.
        drawStroke(this.doc.drawCtx, stroke);
      } else {
        this.liveCtx.clearRect(0, 0, WIDTH, HEIGHT);
        drawStroke(this.liveCtx, stroke);
      }
    });
  }
}
