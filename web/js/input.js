// Turns pointer input (Apple Pencil, finger, mouse) into document ops, with a live preview.
// Several fingers can draw at once, each with its own stroke in the current tool and color.
// Strokes drawn together are committed as one op, so a single Undo removes them all.

import { drawStroke } from './render.js';

const MIN_POINT_DISTANCE = 2; // canvas px

export class CanvasInput {
  constructor(surface, liveCanvas, doc, getBrush) {
    this.surface = surface;
    this.liveCtx = liveCanvas.getContext('2d');
    this.doc = doc;
    this.getBrush = getBrush;
    this.active = new Map(); // pointerId -> { pointerType, stroke }, fingers still down
    this.strokes = []; // every stroke of the current gesture, in the order they started
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
      round(((e.clientX - rect.left) * this.doc.width) / rect.width),
      round(((e.clientY - rect.top) * this.doc.height) / rect.height),
    ];
  }

  get #penDown() {
    return [...this.active.values()].some((a) => a.pointerType === 'pen');
  }

  #down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Palm rejection: while Apple Pencil draws, touches are the resting hand.
    if (e.pointerType === 'touch' && this.#penDown) return;
    e.preventDefault();
    if (e.pointerType === 'pen') this.#dropTouches();
    const brush = this.getBrush();
    const [x, y] = this.#toCanvas(e);
    if (brush.tool === 'fill') {
      this.doc.commit({ type: 'fill', x: Math.round(x), y: Math.round(y), color: brush.color });
      return;
    }
    this.surface.setPointerCapture(e.pointerId);
    const stroke = { type: 'stroke', tool: brush.tool, color: brush.color, size: brush.size, points: [x, y] };
    this.active.set(e.pointerId, { pointerType: e.pointerType, stroke });
    this.strokes.push(stroke);
    this.#scheduleDraw();
  }

  #move(e) {
    const active = this.active.get(e.pointerId);
    if (!active) return;
    const pts = active.stroke.points;
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
    if (!this.active.delete(e.pointerId)) return;
    if (this.active.size) return; // other fingers are still drawing
    this.#commit();
  }

  #cancel(e) {
    const active = this.active.get(e.pointerId);
    if (active) this.#drop([[e.pointerId, active]]);
  }

  // A touch that was down when Apple Pencil arrived was the palm, not a finger drawing.
  #dropTouches() {
    this.#drop([...this.active].filter(([, a]) => a.pointerType === 'touch'));
  }

  #drop(entries) {
    if (!entries.length) return;
    for (const [id, { stroke }] of entries) {
      this.active.delete(id);
      this.strokes.splice(this.strokes.indexOf(stroke), 1);
    }
    // The eraser previews directly on the drawing layer, so restore it; strokes still
    // going are redrawn on the next frame.
    if (entries.some(([, a]) => a.stroke.tool === 'eraser')) this.doc.renderAll();
    if (this.active.size) this.#scheduleDraw();
    else this.#commit();
  }

  // Ends the gesture: everything drawn in it becomes one undo step.
  #commit() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const strokes = this.strokes;
    this.strokes = [];
    this.liveCtx.clearRect(0, 0, this.doc.width, this.doc.height);
    if (strokes.length) this.doc.commit(strokes.length === 1 ? strokes[0] : { type: 'strokes', strokes });
  }

  #scheduleDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.liveCtx.clearRect(0, 0, this.doc.width, this.doc.height);
      for (const stroke of this.strokes) {
        // Erasing is idempotent, so redrawing the whole path each frame is safe.
        drawStroke(stroke.tool === 'eraser' ? this.doc.drawCtx : this.liveCtx, stroke);
      }
    });
  }
}
