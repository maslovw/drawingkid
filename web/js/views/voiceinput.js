// Voice-first idea box for the coloring page generator: kids who can't type yet just
// say what they want. Uses the browser's speech recognition (Safari and Chrome);
// where that's missing or the microphone is blocked, the box falls back to typing.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export class VoiceInput {
  constructor({ input, mic, keyboard }) {
    this.input = input;
    this.mic = mic;
    this.keyboard = keyboard;
    this.placeholder = input.placeholder;
    this.recognition = null;
    this.available = Boolean(Recognition);

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
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.addEventListener('result', (e) => {
      this.input.value = Array.from(e.results, (r) => r[0].transcript).join('');
    });
    recognition.addEventListener('error', (e) => {
      // Blocked or unavailable: don't keep offering a microphone that can't work.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.available = false;
      }
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
  }
}
