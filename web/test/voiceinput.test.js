import assert from 'node:assert/strict';
import test from 'node:test';

class Element extends EventTarget {
  constructor() {
    super();
    this.hidden = false;
    this.placeholder = 'Say it or type it';
    this.classList = { toggle() {} };
  }
  setAttribute() {}
}

class Recognition extends EventTarget {
  static instances = [];
  constructor() {
    super();
    this.started = false;
    this.aborted = false;
    Recognition.instances.push(this);
  }
  start() {
    if (this.started) throw new Error('already started');
    this.started = true;
    this.dispatchEvent(new Event('start'));
  }
  stop() {
    this.started = false;
    // Safari may deliver `end` after the dialog has already reopened.
  }
  abort() {
    this.aborted = true;
    this.started = false;
  }
  finish() { this.dispatchEvent(new Event('end')); }
  say(words) {
    // A recognizer interrupted by abort can light the mic yet yield no results.
    if (this.aborted) return;
    const result = [{ transcript: words }];
    result.isFinal = true;
    const event = new Event('result');
    event.results = [result];
    this.dispatchEvent(event);
  }
}

test('reopening during a delayed end still transcribes the next idea', async () => {
  globalThis.window = { SpeechRecognition: Recognition, isSecureContext: true, addEventListener() {} };
  globalThis.document = { addEventListener() {} };
  const { VoiceInput } = await import('../js/views/voiceinput.js');
  const input = new Element();
  const voice = new VoiceInput({ input, mic: new Element(), keyboard: new Element(), hint: new Element() });

  voice.start();
  const recognition = Recognition.instances[0];
  recognition.say('a cat');
  assert.equal(input.value, 'a cat');
  voice.start(); // the panel reopens before Safari dispatches `end`
  recognition.finish();
  recognition.say('a dog');

  assert.equal(input.value, 'a dog');
  assert.equal(Recognition.instances.length, 1);
  voice.stop();
  recognition.finish();
});

test('reopening does not stay visually active if Safari never ends the old session', async () => {
  globalThis.window = { SpeechRecognition: Recognition, isSecureContext: true, addEventListener() {} };
  globalThis.document = { addEventListener() {} };
  const { VoiceInput } = await import('../js/views/voiceinput.js');
  const input = new Element();
  const mic = new Element();
  const hint = new Element();
  const voice = new VoiceInput({ input, mic, keyboard: new Element(), hint });

  voice.start();
  Recognition.instances.at(-1).say('a cat');
  voice.start();
  await new Promise((resolve) => setTimeout(resolve, 3100));

  assert.equal(voice.listening, false);
  assert.equal(input.placeholder, 'Say it or type it');
  assert.match(hint.textContent, /didn't start/);
});

test('reopening after a stalled session starts a usable recognizer', async () => {
  globalThis.window = { SpeechRecognition: Recognition, isSecureContext: true, addEventListener() {} };
  globalThis.document = { addEventListener() {} };
  const { VoiceInput } = await import('../js/views/voiceinput.js');
  const input = new Element();
  const voice = new VoiceInput({ input, mic: new Element(), keyboard: new Element(), hint: new Element() });

  voice.start();
  Recognition.instances.at(-1).say('a cat');
  await new Promise((resolve) => setTimeout(resolve, 3100));
  voice.start();
  Recognition.instances.at(-1).say('a dog');

  assert.equal(input.value, 'a dog');
  voice.stop();
  Recognition.instances.at(-1).finish();
});
