// Object detection in the browser with TensorFlow.js + COCO-SSD (the web stand-in for
// Apple Vision/Core ML). The model is fetched lazily on first use and runs on-device.

const SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
];

const MIN_SCORE = 0.4;
const MAX_OBJECTS = 10;

let modelPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(script);
  });
}

function loadModel() {
  modelPromise ??= (async () => {
    for (const src of SCRIPTS) await loadScript(src);
    // Hosts that can't reach Google Storage can serve the weights themselves.
    return window.cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: window.DRAWINGKID_MODEL_URL });
  })().catch((error) => {
    modelPromise = null; // allow retry, e.g. after coming back online
    throw error;
  });
  return modelPromise;
}

// Returns [{ label, score, box: { x, y, w, h } }] with the box normalized to 0..1.
export async function detectObjects(canvas) {
  const model = await loadModel();
  const predictions = await model.detect(canvas, MAX_OBJECTS, MIN_SCORE);
  return predictions.map(({ class: label, score, bbox: [x, y, w, h] }) => ({
    label,
    score,
    box: { x: x / canvas.width, y: y / canvas.height, w: w / canvas.width, h: h / canvas.height },
  }));
}

const EMOJI = {
  person: '🧑', bicycle: '🚲', car: '🚗', motorcycle: '🏍️', airplane: '✈️', bus: '🚌',
  train: '🚆', truck: '🚚', boat: '⛵', 'traffic light': '🚦', bird: '🐦', cat: '🐱',
  dog: '🐶', horse: '🐴', sheep: '🐑', cow: '🐮', elephant: '🐘', bear: '🐻', zebra: '🦓',
  giraffe: '🦒', umbrella: '☂️', kite: '🪁', 'sports ball': '⚽', banana: '🍌', apple: '🍎',
  orange: '🍊', broccoli: '🥦', carrot: '🥕', pizza: '🍕', donut: '🍩', cake: '🎂',
  chair: '🪑', 'teddy bear': '🧸', clock: '🕐', cup: '☕', book: '📚', scissors: '✂️',
};

const SOUNDS = {
  dog: 'Woof woof!', cat: 'Meow!', cow: 'Moo!', sheep: 'Baa!', horse: 'Neigh!',
  bird: 'Tweet tweet!', elephant: 'Toot toot!', bear: 'Roar!', car: 'Vroom vroom!',
  train: 'Choo choo!', airplane: 'Zoom!', boat: 'Splash!',
};

export const emojiFor = (label) => EMOJI[label] ?? '✨';

export function phraseFor(label) {
  const article = /^[aeiou]/.test(label) ? 'an' : 'a';
  return `That's ${article} ${label}! ${SOUNDS[label] ?? ''}`.trim();
}
