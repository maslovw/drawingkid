// Interactive overlay for AI detections: tap a box to hear what it is and get an emoji burst.

import { emojiFor, phraseFor } from '../ai.js';

export class DetectionOverlay {
  constructor(el) {
    this.el = el;
    // Taps on the overlay must not start a stroke on the canvas underneath.
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  show(detections) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'detections-close';
    close.setAttribute('aria-label', 'Hide');
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    // Largest first, so smaller boxes nested inside bigger ones stay on top and tappable.
    const bySize = [...detections].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
    this.el.replaceChildren(...bySize.map((d) => this.#box(d)), close);
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
    this.el.replaceChildren();
  }

  #box({ label, box }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'detection';
    Object.assign(b.style, {
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.w * 100}%`,
      height: `${box.h * 100}%`,
    });
    const tag = document.createElement('span');
    tag.className = 'detection-label';
    tag.textContent = `${emojiFor(label)} ${label}`;
    b.append(tag);
    b.addEventListener('click', () => {
      speak(phraseFor(label));
      b.classList.remove('bounce');
      void b.offsetWidth; // restart the animation
      b.classList.add('bounce');
      burst(b, emojiFor(label));
    });
    return b;
  }
}

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.2;
  speechSynthesis.speak(utterance);
}

function burst(target, emoji) {
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    p.textContent = emoji;
    const angle = (i / 8) * Math.PI * 2;
    p.style.setProperty('--dx', `${Math.cos(angle) * 90}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * 90}px`);
    p.addEventListener('animationend', () => p.remove());
    target.append(p);
  }
}
