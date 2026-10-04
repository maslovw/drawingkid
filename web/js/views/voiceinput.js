// Voice-first idea box for the coloring page generator: kids who can't type yet just
// say what they want. Uses the browser's speech recognition (Safari and Chrome);
// where that's missing or the microphone is blocked, the box falls back to typing.

import { speechLocale, t } from '../i18n.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Why voice is off, for the grown-up setting things up. Kids just get the text box.
const REASONS = {
  insecure: () => t('voice.insecure', { origin: location.origin }),
  blocked: () => t('voice.blocked'),
  dictation: () => t('voice.dictation'),
  'no-mic': () => t('voice.noMic'),
  network: () => t('voice.network'),
};

export class VoiceInput {
  constructor({ input, mic, keyboard, hint }) {
    this.input = input;
    this.mic = mic;
    this.keyboard = keyboard;
    this.hint = hint;
    this.recognition = null;
    this.reason = null;
    this.available = Boolean(Recognition);
    // Browsers only allow the microphone on https:// (or localhost). Safari still offers
    // speech recognition on plain http, but every start fails, so don't try.
    if (this.available && !window.isSecureContext) this.#unavailable('insecure');

    mic.addEventListener('click', () => (this.recognition ? this.stop() : this.start()));
    keyboard.addEventListener('click', () => {
      this.stop();
      input.focus();
    });
    this.#sync();
  }

  // Must be called from a tap handler: browsers only start the microphone for a user gesture.
  start() {
    if (!this.available || this.recognition) return;
    if (this.reason === 'network') this.reason = null; // try again
    const recognition = new Recognition();
    recognition.lang = speechLocale(); // listen in the app's language
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.addEventListener('result', (e) => {
      this.input.value = Array.from(e.results, (r) => r[0].transcript).join('');
    });
    recognition.addEventListener('error', (e) => {
      // Blocked or unavailable: don't keep offering a microphone that can't work.
      // Safari reports a turned-off Dictation as 'service-not-allowed'.
      if (e.error === 'not-allowed') this.#unavailable('blocked');
      else if (e.error === 'service-not-allowed') this.#unavailable('dictation');
      else if (e.error === 'audio-capture') this.#unavailable('no-mic');
      else if (e.error === 'network') this.#showReason('network');
    });
    recognition.addEventListener('end', () => {
      if (this.recognition === recognition) this.recognition = null;
      this.#sync();
    });

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      console.warn('Speech recognition failed to start', error);
      this.recognition = null;
    }
    this.#sync();
  }

  #unavailable(reason) {
    this.available = false;
    this.#showReason(reason);
  }

  #showReason(reason) {
    this.reason = reason;
    this.#sync();
  }

  stop() {
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.abort();
    this.#sync();
  }

  #sync() {
    const listening = Boolean(this.recognition);
    this.mic.hidden = !this.available;
    this.keyboard.hidden = !this.available;
    this.mic.classList.toggle('listening', listening);
    this.mic.setAttribute('aria-pressed', String(listening));
    this.input.placeholder = t(listening ? 'create.listening' : 'create.placeholder');
    if (this.hint) {
      this.hint.textContent = this.reason ? REASONS[this.reason]() : '';
      this.hint.hidden = !this.reason;
    }
  }
}
