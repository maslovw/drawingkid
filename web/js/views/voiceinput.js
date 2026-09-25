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
  'mic-busy': () => "The microphone didn't start. Tap the microphone to try again.",
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
    // Leaving the page (app switch, tab switch, lock) must not leave the mic on.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
    });
    window.addEventListener('pagehide', () => this.stop());
    this.#sync();
  }

  // Must be called from a tap handler: browsers only start the microphone for a user gesture.
  start() {
    if (!this.available || this.recognition) return;
    if (this.reason === 'network' || this.reason === 'mic-busy') this.reason = null; // try again
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.addEventListener('result', (e) => {
      if (this.recognition !== recognition) return;
      this.input.value = Array.from(e.results, (r) => r[0].transcript).join('');
      // iPad Safari often keeps listening (mic indicator on) after the phrase is done
      // instead of ending by itself, so end it once the phrase is final.
      if (e.results[e.results.length - 1]?.isFinal) this.stop();
    });
    recognition.addEventListener('error', (e) => {
      // Blocked or unavailable: don't keep offering a microphone that can't work.
      // Safari reports a turned-off Dictation as 'service-not-allowed'.
      if (e.error === 'not-allowed') this.#unavailable('blocked');
      else if (e.error === 'service-not-allowed') this.#unavailable('dictation');
      // 'audio-capture' also happens when the previous session hasn't let go of the
      // microphone yet, so it's worth another try rather than a dead end.
      else if (e.error === 'audio-capture') this.#showReason('mic-busy');
      else if (e.error === 'network') this.#showReason('network');
    });
    recognition.addEventListener('end', () => {
      clearTimeout(this.#stopTimers.get(recognition));
      this.#stopTimers.delete(recognition);
      this.#endWaiters.get(recognition)?.();
      this.#endWaiters.delete(recognition);
      if (this.recognition === recognition) this.recognition = null;
      this.#sync();
    });

    this.recognition = recognition;
    this.#sync();
    // A previous session still winding down holds the microphone, and starting now fails
    // with 'audio-capture'. End it and wait for it to let go (at most a second) first.
    const previous = [...this.#stopTimers.keys()];
    if (previous.length === 0) this.#begin(recognition);
    else {
      Promise.race([
        Promise.all(previous.map((r) => new Promise((resolve) => this.#endWaiters.set(r, resolve)))),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]).then(() => {
        previous.forEach((r) => this.#endWaiters.delete(r));
        this.#begin(recognition);
      });
      previous.forEach((r) => this.#abort(r));
    }
  }

  #endWaiters = new Map();

  #begin(recognition) {
    if (this.recognition !== recognition) return; // stopped while waiting
    try {
      recognition.start();
    } catch (error) {
      console.warn('Speech recognition failed to start', error);
      this.recognition = null;
      this.#sync();
    }
  }

  #unavailable(reason) {
    this.available = false;
    this.#showReason(reason);
  }

  #showReason(reason) {
    this.reason = reason;
    this.#sync();
  }

  // Safari doesn't always end on stop(), which leaves the microphone on. Ask it to stop,
  // and abort only if it still hasn't ended a few seconds later. (Calling stop() and abort()
  // back to back left iPad Safari listening on the next start but recognizing nothing.)
  #stopTimers = new Map();

  stop() {
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      try {
        recognition.stop();
      } catch (error) {
        console.warn('Speech recognition failed to stop', error);
      }
      this.#stopTimers.set(
        recognition,
        setTimeout(() => this.#abort(recognition), 3000),
      );
    }
    this.#sync();
  }

  #abort(recognition) {
    clearTimeout(this.#stopTimers.get(recognition));
    this.#stopTimers.delete(recognition);
    try {
      recognition.abort();
    } catch (error) {
      console.warn('Speech recognition failed to abort', error);
    }
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
