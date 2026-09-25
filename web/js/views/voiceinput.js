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
    this.recognition = null; // one recognizer, reused: iPad Safari hears nothing on a second new one
    this.listening = false; // what the kid sees
    this.reason = null;
    this.available = Boolean(Recognition);
    // Browsers only allow the microphone on https:// (or localhost). Safari still offers
    // speech recognition on plain http, but every start fails, so don't try.
    if (this.available && !window.isSecureContext) this.#unavailable('insecure');

    mic.addEventListener('click', () => (this.listening ? this.stop() : this.start()));
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

  #active = false; // between recognition.start() and its 'end'
  #stopTimer = null;
  #afterEnd = null; // a start waiting for the previous session to let go of the microphone

  #create() {
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    const log = (e) => console.debug('[voice]', e.type, e.error || '');
    for (const type of ['start', 'audiostart', 'speechstart', 'speechend', 'audioend', 'nomatch']) {
      recognition.addEventListener(type, log);
    }
    recognition.addEventListener('result', (e) => {
      if (this.recognition !== recognition || !this.listening) return;
      const last = e.results[e.results.length - 1];
      console.debug('[voice] result', last?.isFinal ? 'final' : 'interim');
      this.input.value = Array.from(e.results, (r) => r[0].transcript).join('');
      // iPad Safari often keeps listening (mic indicator on) after the phrase is done
      // instead of ending by itself, so end it once the phrase is final.
      if (last?.isFinal) this.stop();
    });
    recognition.addEventListener('error', (e) => {
      log(e);
      if (this.recognition !== recognition) return;
      // Blocked or unavailable: don't keep offering a microphone that can't work.
      // Safari reports a turned-off Dictation as 'service-not-allowed'.
      if (e.error === 'not-allowed') this.#unavailable('blocked');
      else if (e.error === 'service-not-allowed') this.#unavailable('dictation');
      // 'audio-capture' also happens when the previous session hasn't let go of the
      // microphone yet, so it's worth another try rather than a dead end.
      else if (e.error === 'audio-capture') this.#showReason('mic-busy');
      else if (e.error === 'network') this.#showReason('network');
    });
    recognition.addEventListener('end', (e) => {
      log(e);
      if (this.recognition !== recognition) return;
      this.#active = false;
      clearTimeout(this.#stopTimer);
      const next = this.#afterEnd;
      this.#afterEnd = null;
      if (next) next();
      else {
        this.listening = false;
        this.#sync();
      }
    });
    return recognition;
  }

  // Must be called from a tap handler: browsers only start the microphone for a user gesture.
  start() {
    if (!this.available || this.listening) return;
    if (this.reason === 'network' || this.reason === 'mic-busy') this.reason = null; // try again
    this.recognition ??= this.#create();
    this.listening = true;
    this.#sync();
    if (!this.#active) return this.#begin();
    // The previous session is still winding down and holds the microphone. End it and
    // start once it lets go, or after a second if Safari never says so.
    const fallback = setTimeout(() => {
      this.#afterEnd = null;
      this.#begin();
    }, 1000);
    this.#afterEnd = () => {
      clearTimeout(fallback);
      this.#begin();
    };
    this.#abort();
  }

  #begin() {
    if (!this.listening) return; // stopped while waiting
    try {
      this.recognition.start();
    } catch (error) {
      // Still busy with a session that never ended: start over with a fresh recognizer.
      console.warn('Speech recognition failed to start', error);
      this.#abort();
      this.recognition = this.#create();
      try {
        this.recognition.start();
      } catch (retryError) {
        console.warn('Speech recognition failed to start again', retryError);
        this.listening = false;
        this.#sync();
        return;
      }
    }
    this.#active = true;
    console.debug('[voice] started');
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
  stop() {
    if (!this.listening) return;
    this.listening = false;
    this.#afterEnd = null;
    if (this.#active) {
      try {
        this.recognition.stop();
      } catch (error) {
        console.warn('Speech recognition failed to stop', error);
      }
      clearTimeout(this.#stopTimer);
      this.#stopTimer = setTimeout(() => {
        if (this.#active && !this.listening) this.#abort();
      }, 3000);
    }
    this.#sync();
  }

  #abort() {
    clearTimeout(this.#stopTimer);
    try {
      this.recognition?.abort();
    } catch (error) {
      console.warn('Speech recognition failed to abort', error);
    }
  }

  #sync() {
    const { listening } = this;
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
