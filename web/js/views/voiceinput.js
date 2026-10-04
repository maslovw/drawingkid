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
  'mic-busy': () => t('voice.micBusy'),
  network: () => t('voice.network'),
};

export class VoiceInput {
  constructor({ input, mic, keyboard, hint }) {
    this.input = input;
    this.mic = mic;
    this.keyboard = keyboard;
    this.hint = hint;
    this.recognition = null; // a new one for every session
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
  #audio = null; // see #holdAudioSession

  #create() {
    const recognition = new Recognition();
    recognition.lang = speechLocale(); // listen in the app's language
    recognition.interimResults = true;
    recognition.continuous = false;
    const log = (e) => console.debug('[voice]', e.type, e.error || '');
    for (const type of ['start', 'audiostart', 'speechstart', 'speechend', 'audioend', 'nomatch']) {
      recognition.addEventListener(type, log);
    }
    recognition.addEventListener('result', (e) => {
      if (this.recognition !== recognition || !this.listening) return;
      // A stopped session still delivers its last words, possibly after the kid has
      // reopened. They belong to the old phrase and must not cancel the waiting restart.
      if (this.#afterEnd) return;
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
      const awake = this.#wakeAudioSession();
      const next = this.#afterEnd;
      this.#afterEnd = null;
      if (next) awake.then(next);
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
    this.#holdAudioSession();
    this.listening = true;
    this.#sync();
    if (!this.#active) return this.#begin();
    // The previous stop is still winding down. Interrupting it with abort() can
    // leave Safari's next session showing a live mic but returning no words.
    // Wait for its end before restarting the same recognizer.
    this.#afterEnd = () => this.#begin();
  }

  #begin() {
    if (!this.listening) return; // stopped while waiting
    this.recognition = this.#create();
    try {
      this.recognition.start();
    } catch (error) {
      console.warn('Speech recognition failed to start', error);
      this.listening = false;
      this.#sync();
      return;
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
        if (!this.#active) return;
        // Safari never delivered `end`. Treat the session as over either way, so the
        // next start doesn't wait for an `end` that won't come.
        this.#active = false;
        if (!this.#afterEnd) {
          // Nobody is waiting: just turn the mic off.
          this.#abort();
          this.#wakeAudioSession();
          return;
        }
        // A restart is waiting on a recognizer that is truly stuck. Retire it before
        // aborting so a late event cannot restart a session that has lost its microphone.
        this.#afterEnd = null;
        const stalled = this.recognition;
        this.recognition = null;
        try {
          stalled.abort();
        } catch (error) {
          console.warn('Speech recognition failed to abort', error);
        }
        this.#wakeAudioSession();
        this.listening = false;
        this.#showReason('mic-busy');
      }, 3000);
    }
    this.#sync();
  }

  // iOS 27 Safari switches its audio session off when a speech session ends and never
  // back on, so every later session in the tab hears silence, even after a reload
  // (WebKit bug 326069). Tested on an iPad: a silent audio graph that keeps running, plus
  // an empty utterance after each session, keeps the microphone working. Neither alone
  // does, and nothing revives a tab that has already gone deaf, so this has to start
  // with the first session. Created in the tap that starts listening, so it may play.
  #holdAudioSession() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.#audio) {
      this.#audio = new AudioContext();
      const silence = this.#audio.createGain();
      silence.gain.value = 0;
      const source = this.#audio.createConstantSource();
      source.connect(silence).connect(this.#audio.destination);
      source.start();
    }
    this.#audio.resume().catch((error) => console.warn('Audio session hold failed', error));
  }

  // Resolves once the utterance is done (or after half a second), for a restart to wait on.
  #wakeAudioSession() {
    const { speechSynthesis, SpeechSynthesisUtterance } = window;
    if (!speechSynthesis || !SpeechSynthesisUtterance) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.onend = utterance.onerror = resolve;
      setTimeout(resolve, 500);
      speechSynthesis.speak(utterance);
    });
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
    this.input.placeholder = t(listening ? 'create.listening' : 'create.placeholder');
    if (this.hint) {
      this.hint.textContent = this.reason ? REASONS[this.reason]() : '';
      this.hint.hidden = !this.reason;
    }
  }
}
