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
| Multi-touch | Several fingers draw at once, each with the current tool and color. Lines drawn together undo together. While Apple Pencil is down, touches are ignored so a resting palm doesn't draw. |
| Palette | 10 colors plus two special ones, and 3 brush sizes. **Rainbow** 🌈 changes color smoothly along the line; with the fill bucket it fills an area with a rainbow. **Surprise color** picks a random palette color for every line, tap and finger (never white, never the same twice in a row). Picking a color while erasing switches back to the last drawing tool. |
| Palettes | Three buttons under the brush sizes switch between **Classic**, **Vibrant** (neon) and **Pastel** colors. Each button shows four dots of its colors. The same color slots are used in every palette, so Settings still chooses which ones show. Rainbow and Surprise follow the palette (a pastel rainbow is soft). Lines already drawn keep their color. The choice is remembered on the device. |
| Undo / redo | 50 steps, including fills, clears and background changes. ⌘Z / ⇧⌘Z / Ctrl+Y also work. |
| Picture upload | Becomes a background layer. The eraser doesn't erase it, and the fill bucket respects its outlines, so coloring pages work. |
| Settings | Choose which tools and colors appear, the starting brush size, left- or right-handed layout, whether buttons show words or only pictures (for kids who don't read yet), and the coloring page generator. Protected by a parent check (a small multiplication like 7 × 8). Saved in `localStorage`. |
| Create | Type one sentence ("a dinosaur eating ice cream") and get a black-and-white coloring page from OpenAI or Gemini. |
| Autosave | The current drawing, its undo history and the background are kept in IndexedDB and restored on reload. |
| Clear | Clear the drawing (keeps the picture, can be undone) or start a new blank page sized to the screen. |
| Save / share | Exports a 2048×1536 PNG through the share sheet (iPad) or as a download. |

## HTTPS on the home network (needed for voice)

Safari only allows the microphone, and the share sheet, on `https://` pages (or `localhost`). Over plain `http://192.168.x.x` the Create dialog explains that voice is off, and kids can still type. Clearing Safari's website data doesn't change this. To get voice on the iPad, serve the app over HTTPS with a certificate the iPad trusts:

1. On the Mac: `brew install mkcert`, then `mkcert -install`.
2. In the `web/` folder, make a certificate for the Mac's address: `mkcert 192.168.1.122`. This creates `192.168.1.122.pem` and `192.168.1.122-key.pem`; `*.pem` files are ignored by git.
3. Start the server: `python3 serve_https.py 192.168.1.122.pem 192.168.1.122-key.pem`. It listens on port 8443.
4. Make the iPad trust the certificate:
   - Find the file with `open "$(mkcert -CAROOT)"` and AirDrop `rootCA.pem` to the iPad.
   - On the iPad, go to Settings → Profile Downloaded → Install.
   - Then turn it on under Settings → General → About → Certificate Trust Settings.
5. On the iPad, open `https://192.168.1.122:8443` and add it to the Home Screen again.

`https://…:8443` is a different site to the browser than `http://…:8000`. Drawings and settings saved on the old address don't carry over. `config.local.json` works the same on both.

If the address is https and voice still doesn't start, the Create dialog says why:
- **Microphone blocked:** in Safari, tap aA → Website Settings → Microphone → Allow.
- **Dictation turned off:** Settings → General → Keyboard → Dictation.

## Button glyphs

Every button uses one sticker-style SVG glyph (`js/icons.js`) made for 3–4-year-olds who can't read yet:
- **Real objects:** each glyph is something they already know, such as a felt pen, a yellow pencil, a fat marker, a paint bucket, the red-and-blue school eraser, a magic wand, a photo, a drawing with a heart, a bin, and a gear for grown-ups.
- **One look:** flat colours from one palette and a single warm-black outline.
- **Tip shows the colour:** the drawing tools lean the same way, and their tip, cap and paint show the chosen colour (Rainbow and Surprise included).

The design is on the "Drawing Kid Icons" canvas: https://claude.ai/artifact/MfMgibuFqkwuee9m5nwByW

## Shared settings: `config.local.json`

To set things up once for every device, copy `config.local.example.json` to `config.local.json` in the same folder as `index.html` and fill it in:

```json
{
  "apiKeys": { "openai": "sk-…", "gemini": "AIza…" },
  "imageProvider": "openai",
  "imageModels": { "openai": "gpt-image-2.5-flare" }
}
```

Every device that opens the app from this server loads the file at startup:

- **API keys** in the file are used on every device and can't be viewed or changed in Settings.
- **Settings** in the file win over each device's own choices and are shown locked (🔒) in Settings. Any setting can go in the file: `visibleTools`, `visibleColors`, `defaultSize`, `leftHanded`, `showLabels`, `enableImageGen`, `imageProvider` and `imageModels`. It uses the same values as the app's saved settings, for example `"visibleTools": ["pen", "marker", "fill"]` or `"defaultSize": "large"`. Settings not in the file can still be changed per device.
- Changes take effect the next time the app is opened or reloaded.

`config.local.json` is in `.gitignore`, so keys don't end up in the repository. The server hands the file to anyone who can reach it, so anyone on your home network could read the keys. Serve the app only on your home network, and use keys with a spending limit.

## Layout (tuned for iPad mini)

The iPad mini's screen is 1133×744 points, and Safari's bars take more of the height. The paper takes about 77% of the screen in either orientation.

- **Landscape:** controls sit in side rails, because height is the scarce dimension. Tools, brush sizes, palettes and colors are on the left, within reach of a right-handed child's free hand (the same idea as Procreate's sidebar). Undo, redo and the actions are on the right, with Clear and Settings last. Settings has a **Left-handed** option that swaps the sides.
- **Portrait:** undo and the actions are in a slim bar on top, and tools, sizes, palettes and colors are along the bottom.
- **Touch targets:** every button is at least 44pt, Apple's minimum; color swatches are 44pt and tool buttons 56–60pt.
- **Page shape:** a new page takes the shape of the space between the controls, so it fills the screen. If the iPad is rotated after drawing has started, the page keeps its shape and is fitted in; a blank page reshapes itself. **Clear → New blank page** starts a page sized for the current orientation. Generated coloring pages are requested in the closest matching shape.

## Coloring page generator

The **Create** button turns one sentence into a coloring page. It works with either provider; pick one in Settings and paste an API key:

| Provider | Default model | Get a key |
|---|---|---|
| OpenAI (GPT Image) | `gpt-image-2.5-flare` | https://platform.openai.com/api-keys (image models may require organization verification) |
| Google Gemini ("Nano Banana") | `gemini-3.1-flash-image` | https://aistudio.google.com/apikey |

Model names change often, so Settings has a **Refresh** button next to the model list. It asks the provider which image models your key can use (`GET /v1/models` for OpenAI, `models.list` for Gemini), fills the dropdown newest first and opens it. The list is remembered in this browser. Before the first refresh, the dropdown offers built-in suggestions: `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2`, `gpt-image-1` for OpenAI, and `gemini-3.1-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-2.5-flash-image` for Gemini. OpenAI shuts down `gpt-image-1.5` and `gpt-image-1-mini` on December 1, 2026. If the provider rejects a model, the app shows the provider's error message.

Kids don't have to type. The dialog starts listening as soon as it opens (the browser's speech recognition, in the device's language), and the words appear in the box. Tap the microphone to say it again, or the keyboard button to type instead. Voice needs HTTPS (or `localhost`, see *HTTPS on the home network*) and microphone permission. On iPad, Dictation must be turned on (Settings → General → Keyboard). Safari sends the audio to Apple and Chrome sends it to Google for transcription. If speech recognition isn't available or the microphone is blocked, the dialog shows a plain text box.

The app wraps the sentence in a coloring-page prompt (thick closed outlines, no shading, no text). It then cleans the result into pure black and white, so the fill bucket stays inside the lines. The canvas is cleared and the page becomes the background layer. One undo brings back the previous drawing.

The browser calls the provider's API directly with the key. The key comes from `config.local.json` (see above) or is typed in Settings and stored in this browser's `localStorage` only. Anyone using the device can read the key, so use a key with a spending limit. Hosts that block outside connections (such as a page hosted on claude.ai) can't use this feature.

## Code layout

```
web/
├── index.html            markup, dialogs
├── config.local.example.json  template for shared settings and API keys
├── serve_https.py        HTTPS server for the home network (voice needs https)
├── styles.css
└── js/
    ├── app.js            wiring: buttons, autosave, page shape, shortcuts
    ├── config.js         tools/colors/sizes + AppConfig (localStorage)
    ├── viewmodel.js      selected tool/color/size, config updates
    ├── document.js       op log, undo/redo, layer rendering, (de)serialization
    ├── render.js         stroke drawing + flood fill
    ├── input.js          pointer events → strokes/fills, live preview
    ├── storage.js        IndexedDB autosave
    ├── imagegen.js       coloring pages via OpenAI / Gemini
    ├── icons.js          button glyphs (SVG) in one sticker style
    └── views/
        ├── toolbar.js    tools, sizes, palette
        ├── settings.js   settings dialog
        ├── parentgate.js grown-ups-only math check
        └── voiceinput.js speak-your-idea box for Create
```

The drawing is stored as a log of small operations (strokes, fills, clears, background changes) rather than bitmaps. That makes undo exact and the saved data small. Once there are more than 50 operations, the oldest are merged ("baked") into a base image.
