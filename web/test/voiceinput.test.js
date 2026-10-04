import assert from 'node:assert/strict';
import test from 'node:test';

class Element extends EventTarget {
  constructor() {
    super();
    this.hidden = false;
    this.value = '';
    this.placeholder = 'Say it or type it';
    this.classList = { toggle() {} };
  }
  setAttribute() {}
}

// iOS 27 Safari (WebKit bug 326069): the first session in a tab hears; after a session
// ends, later ones get silence unless a running AudioContext holds the audio session and
// an utterance has been spoken since the end.
const tab = { used: false, held: false, awake: true };

class Recognition extends EventTarget {
  static instances = [];
  constructor() {
    super();
    this.started = false;
    this.deaf = false;
    Recognition.instances.push(this);
  }
  start() {
    if (this.started) throw new Error('already started');
    this.started = true;
    this.deaf = tab.used && !(tab.held && tab.awake);
    tab.used = true;
    this.dispatchEvent(new Event('start'));
  }
  stop() {
    this.started = false;
    // Safari may deliver `end` after the dialog has already reopened.
  }
  abort() {
    this.started = false;
    tab.awake = false;
  }
  finish() {
    tab.awake = false;
    this.dispatchEvent(new Event('end'));
  }
  say(words) {
    if (this.deaf) return;
    const result = [{ transcript: words }];
    result.isFinal = true;
    const event = new Event('result');
    event.results = [result];
    this.dispatchEvent(event);
  }
}

class AudioContext {
  destination = {};
  createGain() {
    return { gain: { value: 1 }, connect: (node) => node };
  }
  createConstantSource() {
    return { connect: (node) => node, start() {} };
  }
  resume() {
    tab.held = true;
    return Promise.resolve();
  }
}

class SpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
  }
}

const speechSynthesis = {
  speak(utterance) {
    if (tab.held) tab.awake = true;
    setTimeout(() => utterance.onend?.(), 0);
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function setup({ workaround = true } = {}) {
  Object.assign(tab, { used: false, held: false, awake: true });
  globalThis.window = {
    SpeechRecognition: Recognition,
    isSecureContext: true,
    addEventListener() {},
    ...(workaround && { AudioContext, speechSynthesis, SpeechSynthesisUtterance }),
  };
  globalThis.document = { addEventListener() {} };
  const { VoiceInput } = await import('../js/views/voiceinput.js');
  const input = new Element();
  const mic = new Element();
  const hint = new Element();
  const voice = new VoiceInput({ input, mic, keyboard: new Element(), hint });
  return { voice, input, mic, hint };
}

// One idea: listen, hear it, Safari ends the session.
async function session(voice, words) {
  voice.start();
  await tick();
  const recognition = Recognition.instances.at(-1);
  recognition.say(words);
  recognition.finish();
  await tick();
  return recognition;
}

test('the mock reproduces iOS 27: without the workaround the second session is deaf', async () => {
  const { voice, input } = await setup({ workaround: false });
  await session(voice, 'a cat');
  assert.equal(input.value, 'a cat');
  await session(voice, 'a dog');
  assert.equal(input.value, 'a cat');
});

test('every session hears, not just the first one in the tab', async () => {
  const { voice, input } = await setup();
  for (const words of ['a cat', 'a dog', 'a unicorn', 'a train']) {
    await session(voice, words);
    assert.equal(input.value, words);
  }
  assert.equal(voice.listening, false);
});

test('reopening during a delayed end still transcribes the next idea', async () => {
  const { voice, input } = await setup();

  voice.start();
  const recognition = Recognition.instances.at(-1);
  recognition.say('a cat');
  assert.equal(input.value, 'a cat');
  voice.start(); // the panel reopens before Safari dispatches `end`
  recognition.finish();
  await tick(); // the restart waits for the audio session to wake
  const next = Recognition.instances.at(-1);
  assert.notEqual(next, recognition);
  next.say('a dog');

  assert.equal(input.value, 'a dog');
  voice.stop();
  next.finish();
});

test('reopening does not stay visually active if Safari never ends the old session', async () => {
  const { voice, input, hint } = await setup();

  voice.start();
  Recognition.instances.at(-1).say('a cat');
  voice.start();
  await new Promise((resolve) => setTimeout(resolve, 3100));

  assert.equal(voice.listening, false);
  assert.equal(input.placeholder, 'Say it or type it');
  assert.match(hint.textContent, /didn't start/);
});

test('reopening after a stalled session still hears', async () => {
  const { voice, input } = await setup();

  voice.start();
  const recognition = Recognition.instances.at(-1);
  recognition.say('a cat');
  await new Promise((resolve) => setTimeout(resolve, 3100)); // Safari never ends it
  voice.start();
  await tick();
  Recognition.instances.at(-1).say('a dog');

  assert.equal(input.value, 'a dog');
  voice.stop();
  Recognition.instances.at(-1).finish();
});

test('a late result from the closed session neither leaks in nor cancels the restart', async () => {
  const { voice, input } = await setup();

  voice.start();
  const recognition = Recognition.instances.at(-1);
  voice.stop(); // the dialog closes mid-phrase
  voice.start(); // and reopens before the stopped session has finished
  recognition.say('a cat'); // stop() still delivers what it heard

  assert.equal(input.value, '');
  assert.equal(voice.listening, true);
  recognition.finish();
  await tick();
  const next = Recognition.instances.at(-1);
  assert.equal(next.started, true);
  next.say('a dog');

  assert.equal(input.value, 'a dog');
  voice.stop();
  next.finish();
});
