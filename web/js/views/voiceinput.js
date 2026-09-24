// Voice-first idea box for the coloring page generator: kids who can't type yet just
// say what they want. Uses the browser's speech recognition (Safari and Chrome);
// where that's missing or the microphone is blocked, the box falls back to typing.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Why voice is off, for the grown-up setting things up. Kids just get the text box.
const REASONS = {
  insecure: () =>
    `Voice needs a secure address (https://). This page is ${location.origin}, so the browser won't allow the microphone here. Type the idea instead, or open the app over https (see README).`,
  blocked: () => 'The microphone is blocked for this site. In Safari tap aA → Website Settings → Microphone → Allow, then reopen this box.',
  dictation: () => 'Voice needs Dictation. On iPad: Settings → General → Keyboard → turn on Dictation, then reopen this box.',
  'no-mic': () => 'No microphone was found.',
  network: () => 'Voice needs an internet connection. Type the idea instead.',
};

export class VoiceInput {
  constructor({ input, mic, keyboard, hint }) {
    this.input = input;
    this.mic = mic;
    this.keyboard = keyboard;
    this.hint = hint;
    this.placeholder = input.placeholder;
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
    recognition.lang = navigator.language || 'en-US';
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
    this.input.placeholder = listening ? 'Listening… say what to draw!' : this.placeholder;
    if (this.hint) {
      this.hint.textContent = this.reason ? REASONS[this.reason]() : '';
      this.hint.hidden = !this.reason;
    }
  }
}
