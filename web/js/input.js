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
    this.unseeded = new Set(); // strokes staying inside the lines that haven't left a line yet
    this.frame = 0;
    this.preGestureState = null;
    this.preGestureVersion = null;

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
      const fill = { type: 'fill', x: Math.round(x), y: Math.round(y), color: brush.color };
      if (brush.color === 'rainbow') fill.tone = brush.tone;
      this.doc.commit(fill);
      return;
    }
    if (brush.tool === 'eraser' && !this.preGestureState) {
      this.preGestureState = this.doc.captureUndoState(true);
      this.preGestureVersion = this.doc.version;
    }
    this.surface.setPointerCapture(e.pointerId);
    const stroke = { type: 'stroke', tool: brush.tool, color: brush.color, size: brush.size, points: [x, y] };
    // Each rainbow stroke starts at its own hue, so fingers drawing together differ.
    if (brush.color === 'rainbow') {
      stroke.hue = Math.floor(Math.random() * 360);
      stroke.tone = brush.tone;
    }
    // In coloring mode a stroke on a picture stays in the area where it starts. Started on a
    // line, it waits (drawing nothing) until it reaches an area.
    if (brush.inside && this.doc.hasPicture) {
      const seed = this.doc.insideSeed(stroke.points);
      if (seed) stroke.inside = seed;
      else this.unseeded.add(stroke);
    }
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
    if (this.unseeded.has(active.stroke)) {
      const seed = this.doc.insideSeed(pts);
      if (seed) {
        active.stroke.inside = seed;
        this.unseeded.delete(active.stroke);
      }
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
      this.unseeded.delete(stroke);
    }
    // The eraser previews directly on the drawing layer, so restore it; strokes still
    // going are redrawn on the next frame.
    if (entries.some(([, a]) => a.stroke.tool === 'eraser')) this.doc.renderAll();
    if (!this.strokes.some((stroke) => stroke.tool === 'eraser')) {
      this.preGestureState = null;
      this.preGestureVersion = null;
    }
    if (this.active.size) this.#scheduleDraw();
    else this.#commit();
  }

  // Ends the gesture: everything drawn in it becomes one undo step.
  #commit() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const strokes = this.strokes.filter((s) => !this.unseeded.has(s));
    this.strokes = [];
    this.unseeded.clear();
    this.liveCtx.clearRect(0, 0, this.doc.width, this.doc.height);
    if (strokes.length) {
      if (this.preGestureVersion !== null && this.preGestureVersion !== this.doc.version) {
        // Another operation landed while the eraser preview was drawing. Rebuild the
        // committed page, then snapshot the state the eraser will actually modify.
        this.doc.renderAll();
        this.preGestureState = this.doc.captureUndoState(true);
      }
      this.doc.commit(strokes.length === 1 ? strokes[0] : { type: 'strokes', strokes }, this.preGestureState);
    }
    this.preGestureState = null;
    this.preGestureVersion = null;
  }

  #scheduleDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.liveCtx.clearRect(0, 0, this.doc.width, this.doc.height);
      for (const stroke of this.strokes) {
        if (this.unseeded.has(stroke)) continue;
        const region = stroke.inside ? this.doc.insideRegion(stroke.inside) : null;
        if (stroke.inside && !region) continue;
        // Erasing is idempotent, so redrawing the whole path each frame is safe.
        drawStroke(stroke.tool === 'eraser' ? this.doc.drawCtx : this.liveCtx, stroke, region);
      }
    });
  }
}
