# Drawing Kid — Web version

A browser version of the iPad app. It works in Safari on iPad (including "Add to Home Screen" for full-screen use), and in desktop Chrome, Edge, Firefox and Safari. It's plain HTML, CSS and ES modules, so there is no build step and nothing to install.

## Run it locally

ES modules have to be served over HTTP, so opening `index.html` directly from disk won't work:

```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000
```

To try it on an iPad on the same Wi-Fi, open `http://<your-computer-ip>:8000`. Sharing to Photos uses the Web Share API, which needs HTTPS (or `localhost`). Over plain HTTP the Save button downloads a PNG instead.

## Deploy

Upload the `web/` folder to any static host, such as GitHub Pages, Netlify, Cloudflare Pages or S3. All of them serve HTTPS, which also enables the iPad share sheet.

## Features

| Feature | How it works |
|---|---|
| Tools | Pen, pencil, marker (translucent), fill bucket, eraser. Works with Apple Pencil, touch and mouse. |
| Palette | 10 colors, 3 brush sizes. Picking a color while erasing switches back to the last drawing tool. |
| Undo / redo | 50 steps, including fills, clears and background changes. ⌘Z / ⇧⌘Z / Ctrl+Y also work. |
| Picture upload | Becomes a background layer. The eraser doesn't erase it, and the fill bucket respects its outlines, so coloring pages work. |
| Settings | Choose which tools and colors appear, the starting brush size, and whether the magic wand is shown. Protected by a parent check (a small multiplication like 7 × 8). Saved in `localStorage`. |
| Create | Type one sentence ("a dinosaur eating ice cream") and get a black-and-white coloring page from OpenAI or Gemini. |
| Magic wand | Detects objects and shows tappable boxes. Tapping one says what it is aloud and plays an emoji burst. |
| Autosave | The current drawing, its undo history and the background are kept in IndexedDB and restored on reload. |
| Clear | Clear the drawing (keeps the picture, can be undone) or start a new blank page sized to the screen. |
| Save / share | Exports a 2048×1536 PNG through the share sheet (iPad) or as a download. |

## Layout (tuned for iPad mini)

The iPad mini's screen is 1133×744 points, and Safari's bars take more of the height. The paper takes about 77% of the screen in either orientation.

- **Landscape:** controls sit in side rails, because height is the scarce dimension. Tools, brush sizes and colors are on the left, within reach of a right-handed child's free hand (the same idea as Procreate's sidebar). Undo, redo and the actions are on the right, with Clear and Settings last. Settings has a **Left-handed** option that swaps the sides.
- **Portrait:** undo and the actions are in a slim bar on top, and tools, sizes and colors are along the bottom.
- **Touch targets:** every button is at least 44pt, Apple's minimum; color swatches are 44pt and tool buttons 56–60pt.
- **Page shape:** a new page takes the shape of the space between the controls, so it fills the screen. If the iPad is rotated after drawing has started, the page keeps its shape and is fitted in; a blank page reshapes itself. **Clear → New blank page** starts a page sized for the current orientation. Generated coloring pages are requested in the closest matching shape.

## AI detection

Apple's Vision and Core ML aren't available in browsers, so the web version uses [TensorFlow.js](https://www.tensorflow.org/js) with the [COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) model (`lite_mobilenet_v2`). The scripts load from jsDelivr and the weights from Google Storage the first time the wand is tapped. After that, inference runs entirely in the browser, and the drawing is never uploaded.

To serve the weights yourself (for example on a host that can't reach Google Storage), download the `ssdlite_mobilenet_v2` model files and set `window.DRAWINGKID_MODEL_URL` to their `model.json` before `js/app.js` loads.

**Limitation:** COCO-SSD was trained on photos of 80 everyday object classes. It reliably finds dogs, cats, people and cars in uploaded photos. It usually does **not** recognize children's line drawings, and in that case the app says "I'm not sure what that is". Doodle recognition would need a sketch-trained model, e.g. one trained on Google's Quick, Draw! dataset. It would plug into `detectObjects()` in `js/ai.js`.

## Coloring page generator

The **Create** button turns one sentence into a coloring page. It works with either provider; pick one in Settings and paste an API key:

| Provider | Default model | Get a key |
|---|---|---|
| OpenAI (GPT Image) | `gpt-image-2.5-flare` | https://platform.openai.com/api-keys (image models may require organization verification) |
| Google Gemini ("Nano Banana") | `gemini-3.1-flash-image` | https://aistudio.google.com/apikey |

Model names change often, so Settings has a **Refresh** button next to the model list. It asks the provider which image models your key can use (`GET /v1/models` for OpenAI, `models.list` for Gemini), fills the dropdown newest first and opens it. The list is remembered in this browser. Before the first refresh, the dropdown offers built-in suggestions: `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2`, `gpt-image-1` for OpenAI, and `gemini-3.1-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-2.5-flash-image` for Gemini. OpenAI shuts down `gpt-image-1.5` and `gpt-image-1-mini` on December 1, 2026. If the provider rejects a model, the app shows the provider's error message.

The app wraps the sentence in a coloring-page prompt (thick closed outlines, no shading, no text). It then cleans the result into pure black and white, so the fill bucket stays inside the lines. The page becomes the background layer, and undo removes it.

The browser calls the provider's API directly with the key, which is stored in this browser's `localStorage` only. Anyone using the device can read the key, so use a key with a spending limit. Hosts that block outside connections (such as a page hosted on claude.ai) can't use this feature.

## Code layout

```
web/
├── index.html            markup, dialogs
├── styles.css
└── js/
    ├── app.js            wiring: buttons, autosave, magic wand, shortcuts
    ├── config.js         tools/colors/sizes + AppConfig (localStorage)
    ├── viewmodel.js      selected tool/color/size, config updates
    ├── document.js       op log, undo/redo, layer rendering, (de)serialization
    ├── render.js         stroke drawing + flood fill
    ├── input.js          pointer events → strokes/fills, live preview
    ├── storage.js        IndexedDB autosave
    ├── ai.js             TensorFlow.js COCO-SSD loader + labels
    ├── imagegen.js       coloring pages via OpenAI / Gemini
    └── views/
        ├── toolbar.js    tools, sizes, palette
        ├── settings.js   settings dialog
        ├── parentgate.js grown-ups-only math check
        └── detections.js tappable detection overlay
```

The drawing is stored as a log of small operations (strokes, fills, clears, background changes) rather than bitmaps. That makes undo exact and the saved data small. Once there are more than 50 operations, the oldest are merged ("baked") into a base image.
