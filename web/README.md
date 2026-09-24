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
| Settings | Choose which tools and colors appear, the starting brush size, and whether the magic wand is shown. Saved in `localStorage`. |
| Magic wand | Detects objects and shows tappable boxes. Tapping one says what it is aloud and plays an emoji burst. |
| Autosave | The current drawing, its undo history and the background are kept in IndexedDB and restored on reload. |
| Save / share | Exports a 2048×1536 PNG through the share sheet (iPad) or as a download. |

## AI detection

Apple's Vision and Core ML aren't available in browsers, so the web version uses [TensorFlow.js](https://www.tensorflow.org/js) with the [COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) model (`lite_mobilenet_v2`). The scripts load from jsDelivr and the weights from Google Storage the first time the wand is tapped. After that, inference runs entirely in the browser, and the drawing is never uploaded.

**Limitation:** COCO-SSD was trained on photos of 80 everyday object classes. It reliably finds dogs, cats, people and cars in uploaded photos. It usually does **not** recognize children's line drawings, and in that case the app says "I'm not sure what that is". Doodle recognition would need a sketch-trained model, e.g. one trained on Google's Quick, Draw! dataset. It would plug into `detectObjects()` in `js/ai.js`.

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
    └── views/
        ├── toolbar.js    tools, sizes, palette
        ├── settings.js   settings dialog
        └── detections.js tappable detection overlay
```

The drawing is stored as a log of small operations (strokes, fills, clears, background changes) rather than bitmaps. That makes undo exact and the saved data small. Once there are more than 50 operations, the oldest are merged ("baked") into a base image.
