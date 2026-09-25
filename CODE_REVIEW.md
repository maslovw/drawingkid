# Code review: DrawingKid (native iPad app and web app)

Five reviewers read the code in parallel. None of them changed any files.

| Reviewer | Scope |
|---|---|
| Swift: bugs | `DrawingKid/**` |
| Swift: refactoring | `DrawingKid/**` and the docs |
| Web core: bugs | `document.js`, `render.js`, `input.js`, `viewmodel.js`, `app.js`, `storage.js`, `toolbar.js` |
| Web AI, settings and security | `imagegen.js`, `config.js`, `usagelog.js`, `settings.js`, `log.js`, `parentgate.js`, `voiceinput.js`, `serve_https.py` |
| Web refactoring, UI and accessibility | all of `web/`, including the CSS and HTML |

**Legend:** "(plausible)" means the finding depends on timing or platform behavior and was not proven by reading the code alone. Items marked ✔ were also spot-checked against the source by the coordinating session.

---

## Part 1. Native iPad app (Swift / PencilKit)

> The repo has no `.xcodeproj`, so none of this was compiled or run.

### Critical

1. **Undo saves the new state, not the previous one.** ✔
   - Where: `Views/DrawingCanvasView.swift:61-64` and `ViewModels/CanvasViewModel.swift:37-41`.
   - Cause: the coordinator first writes the drawing binding. `updateDrawing` then saves the already-updated `document.drawing`.
   - Result: the first Undo does nothing, and the blank canvas can never be restored.
   - Fix: save the old drawing before assigning the new one, and stop writing through the binding.
2. **Undo, redo and background import never trigger a redraw.**
   - Cause: `DrawingDocument` is a class held in a `@Published var` (`Models/DrawingDocument.swift:29`), and changing its properties doesn't publish. `canUndo`/`canRedo` forward from a nested ObservableObject that nobody observes (`CanvasViewModel.swift:28-29`).
   - Result: strokes stay on screen after Undo, Redo never becomes enabled, and an imported photo doesn't appear.
   - Fix: make the document a struct, or call `objectWillChange.send()` and publish `canUndo`/`canRedo`.
3. **Share crashes on iPad.** ✔
   - Where: `Views/MainDrawingView.swift:159-167`.
   - Cause: `UIActivityViewController` is presented without `popoverPresentationController.sourceView`. It is also presented from the root VC while a confirmation dialog is still being dismissed, and it uses `connectedScenes.first` even though multiple scenes are enabled.
   - Fix: use `ShareLink`, or set a popover anchor and present from the top view controller.

### High

4. **Programmatic drawing changes go back into the undo history.**
   - Cause: `updateUIView` sets `canvasView.drawing`, which calls the delegate, which calls `saveState`, which clears the redo stack (`DrawingCanvasView.swift:45-47`, `UndoRedoManager.swift:29`). SwiftUI also warns "publishing changes from within view updates".
   - Result: Redo never works.
   - Fix: set an `isApplyingExternalChange` flag in the coordinator while assigning.
5. **`redo()` pushes the wrong state onto the undo stack.** ✔
   - Where: `Services/UndoRedoManager.swift:51-58`. It pushes `next` instead of the current drawing.
   - Result: after a Redo, the next Undo is a no-op and one state is lost.
   - Fix: `redo(current:)`.
6. **Likely compile error.** ✔
   - Where: `DrawingCanvasView.swift:40`, `canvasView.tool != tool`.
   - Cause: `PKTool` is a protocol that isn't Equatable.
   - Fix: assign the tool unconditionally, or compare a lightweight key.
7. **Detection crops the drawing instead of scaling it, and the boxes land in the wrong place.**
   - Where: `CanvasViewModel.swift:90-95`, `PersistenceService.swift:106`, `DetectionOverlayView.swift:70-79`, `MainDrawingView.swift:43`.
   - Cause: `drawing.image(from: 0,0,800,600)` takes only the top-left 800×600 points. The overlay then stretches that rectangle over the whole view.
   - Fix: render the real canvas bounds and store detection boxes normalized.
8. **Exported images don't match the screen.**
   - Where: `PersistenceService.swift:89-108`, `MainDrawingView.swift:152,157`.
   - Cause: the export is a 2048×1536 crop. The background is stretched and drawn at full opacity, while the screen shows it aspect-fit at 50%. The render runs at `UIScreen.main.scale`, which makes a bitmap of about 4096×3072 (roughly 50 MB) on the main thread.
9. **Nothing is ever saved.**
   - `saveDocument`, `loadDocument` and `listDrawings` are never called (`CanvasViewModel.swift:108-123`).
   - The README's "Auto-Save" feature doesn't exist, and all work is lost when the app is killed.
10. **The tool-width setting does nothing.**
    - `config.defaultToolWidth` is never read, and `toolWidth` is always 5 (`CanvasViewModel.swift:18`).
11. **(plausible) Double `continuation.resume` crash.**
    - Where: `Services/AIAnalyzer.swift:26-70, 81-102`.
    - Cause: both the Vision completion handler and the `catch` can resume the continuation.
    - Fix: read `request.results` after the synchronous `perform`.

### Medium

12. **Dark mode makes ink invisible.** PencilKit inverts ink colors for dark mode, so black strokes turn white on the fixed white canvas, both on screen and in exports. Fix: `overrideUserInterfaceStyle = .light`, and render the export inside a light trait collection.
13. **Detection is essentially useless on drawings.** `VNRecognizeAnimalsRequest` only finds cats and dogs in photos. The `VNClassifyImageRequest` result is thrown away (`AIAnalyzer.swift:26, 59-62`).
14. **The coordinator's `parent` is never refreshed** (`DrawingCanvasView.swift:50-58`). Fix: `context.coordinator.parent = self` in `updateUIView`.
15. **Every SwiftUI update serializes both drawings.** The `dataRepresentation()` comparison at `DrawingCanvasView.swift:45` costs time proportional to drawing size on the main thread for every update.
16. **Loading a document creates a fake undo entry.** It has the same root cause as #1 and #4 (`CanvasViewModel.swift:116-123`).
17. **Persistence isn't safe** (`PersistenceService.swift:36-49`):
    - writes aren't atomic;
    - a removed background's `background.png` is never deleted, so it comes back on load;
    - `pngData()` drops orientation, so portrait photos come back rotated;
    - directory creation errors are swallowed by `try?`.
18. **The selected tool or color can be one that Settings has hidden.** Re-enabling an item also appends it at the end, which changes the toolbar order (`ConfigViewModel.swift:20-45`).
19. **Stale detections and no re-entry guard** (`CanvasViewModel.swift:85-105`, `MainDrawingView.swift:130-136`):
    - boxes stay on screen after the drawing changes;
    - `isAnalyzing` is never read, so repeated taps start parallel analyses;
    - the wand button stays enabled when AI detection is disabled.

### Low

20. **Info.plist:**
    - `armv7` is listed as a required capability; it should be `arm64` or removed.
    - `UISupportsDocumentBrowser` is set, but there is no document browser.
    - Multiple scenes are enabled, but the code assumes a single scene.
21. **Saving to Photos reports nothing.** `UIImageWriteToSavedPhotosAlbum` has no completion handler, so failures are silent (`MainDrawingView.swift:153`).
22. **Config doesn't sync between windows.** Each window loads its own copy once.
23. **One decoding error resets every setting.** If AppConfig fails to decode (for example, a ToolType is renamed later), all settings silently go back to defaults (`AppConfig.swift:28-34`).
24. **Swift 6 concurrency.** `AIAnalyzer` isn't Sendable, and a `UIImage` crosses actors. `UIScreen.main` is deprecated.
25. **The detection overlay gets in the way.** Its boxes catch touches, so the child can't draw inside them (add `.allowsHitTesting(false)`). Labels at the top edge go off-screen.
26. **Clear has no confirmation** (`MainDrawingView.swift:125-128`). The code's own comment says an alert should be shown.

### Refactoring (Swift)

- **R1. Use one update path, and make the document a value type.** `DrawingCanvasView` should take a `let drawing` plus an `onChange` callback, with no binding. Replace the `dataRepresentation` comparison with a revision counter.
- **R2. Delete `UndoRedoManager` and use the system `UndoManager`.**
  - The canvas's `undoManager` already records every stroke, so the custom stack duplicates it and keeps up to 50 full `PKDrawing`s in memory.
  - Watch the undo-manager notifications to update `canUndo`/`canRedo`.
  - Make Clear and background import undoable with `registerUndo`.
  - This also adds Cmd-Z and the three-finger undo gesture for free.
- **R3. Add dependency injection.** Define `DrawingStore`, `ObjectDetecting`, `ConfigStore` and `DrawingRenderer` protocols. Build them all in `DrawingKidApp`. This removes the `PersistenceService.shared` singleton and the static `UserDefaults` use, and makes the view models unit-testable.
- **R4. Move view-model work out of `MainDrawingView`.** It currently does photo loading, the AI gating, the Photos export and the share presentation. Move these into the VM (`importPhoto`, `analyze`, `saveToPhotos`) and use `ShareLink`.
- **R5. Use one shared settings object.** Inject a single `@Observable AppSettings` into both view models instead of having the view carry values between them.
- **R6. Switch to `@Observable`** (iOS 17 is already the minimum). Drop `ObservableObject`, `@Published` and the unused `import Combine`.
- **R7. Add one `DrawingRenderer` and a `CanvasSpec` constant.** 800×600 and 2048×1536 are hard-coded in several files. Use normalized detection boxes.
- **R8. Improve error handling.** Replace `print` and `try?` with `os.Logger` plus an `AppAlert` enum shown through `.alert(item:)`.
- **R9. Concurrency.**
  - Make the detector a Sendable struct that takes a `CGImage`.
  - Make persistence an actor, or use async I/O off the main thread.
  - Keep the analysis task in the view model so it can be cancelled.
- **R10. Remove dead code:**
  - `DrawingCommand`
  - `detectText`
  - the unused classify request
  - `import CoreML`
  - `DrawingCanvasView.backgroundImage`
  - `selectTool`
  - `backgroundImageName` and `title`
  - `listDrawings` and `delete`
  - `analysisError`
  - the commented-out ruler line
- **R11. Store colors as `ColorOption`.** Selection currently compares SwiftUI `Color` values. Pass the palette either a binding or a callback, not both.
- **R12. Remove UIKit, PencilKit and persistence code from the models.** Move `makePKTool` to a bridge file and UserDefaults access to `ConfigStore`.
- **R13. Split `MainDrawingView`:**
  - pull out a `CanvasStack` subview;
  - replace the six toolbar closures with one `ToolbarAction` enum;
  - replace the five Bool sheet flags with one `ActiveSheet` enum.
- **R14. Remove duplicated code:**
  - one `ColorSwatch` view instead of two copies;
  - `Binding` setters that ignore their value (`ConfigView`);
  - store visible items as a `Set` and display them in `allCases` order.
- **R15. Name the magic numbers:** 50, 0.5, `1...20`, opacity 0.5, the button sizes and the render sizes.
- **R16. Replace deprecated APIs:**
  - `NavigationView` → `NavigationStack`
  - `.foregroundColor` → `.foregroundStyle`
  - `.cornerRadius` → `.clipShape(.rect(cornerRadius:))`
  - `.navigationBarLeading/Trailing` → `.topBarLeading/Trailing`
- **R17. Renames:**
  - `getCurrentPKTool` → `currentTool`
  - `touch()` → `markModified()`
  - `AIAnalyzer` → `ObjectDetector`
  - `showClearAlert` → `requestClear`
- **R18. Accessibility.** The icon-only action buttons have no `accessibilityLabel`.
- **R19. The docs claim things the code doesn't do:**
  - Auto-save;
  - UIDocument and iCloud;
  - a test suite (there is no test target);
  - "detects animals and objects";
  - Combine;
  - the canvas-size instructions point at the wrong place;
  - "Tap Done to save".

---

## Part 2. Web app: drawing core

1. **HIGH (plausible). A blank-page refit can run in the middle of `restore()` and corrupt the saved drawing.**
   - Where: `app.js:65-74`, `document.js:146-160`.
   - Cause: `restore()` resets first, so the page counts as blank while it waits for images to decode. Meanwhile the ResizeObserver's refit (250 ms) calls `newPage()` with the screen's size. The result is autosaved, so the damage is permanent.
   - Fix: decode everything into temporaries, then swap them in synchronously, or skip refits while restoring.
2. **HIGH (performance). Undo replays every fill, about 200 ms each, for up to 50 ops.**
   - Where: `document.js:117-124` (`renderAll`) and `render.js:187-284`.
   - Cause: each fill allocates about 40 MB of typed arrays.
   - Result: one Undo on a well-colored page freezes the iPad for seconds.
   - Fix: raster checkpoints, or store each fill as a dirty-rect patch, and reuse the buffers.
3. **MED-HIGH (verified). `serialize()` races with bake.**
   - Where: `document.js:127`, `this.baseBlob ??= await canvasToBlob(...)`.
   - Cause: the stale pre-bake blob is written back after the await.
   - Result: the saved drawing loses the op that was just baked.
   - Fix: use a version counter, or take the snapshot synchronously.
4. **MED-HIGH. A failed restore leaves a blank document, and the next stroke autosaves over the real drawing** (`document.js:146-160`, `app.js:303-308`). Fix: decode before resetting. On failure, disable saving and tell the user.
5. **MEDIUM. Strokes drawn before restore finishes are lost.** Input is live at `app.js:24`, but restore only runs at the end. Fix: keep the paper inert until `data-ready` is set.
6. **MEDIUM. Palm rejection has gaps** (`input.js:41-50`):
   - fill taps are never in `active`, so a resting palm can trigger a fill;
   - a palm between Pencil strokes is committed as a mark.
   - Fix: once a pen has been seen, ignore touch.
7. **MEDIUM. A gesture only commits when every pointer is up** (`input.js:79-83`):
   - a resting finger keeps strokes uncommitted, so they aren't autosaved and Undo hits an older op;
   - a lost `pointerup` stops all commits until reload.
   - Fix: commit per pointer, and handle `lostpointercapture`, `blur` and `visibilitychange`.
8. **MEDIUM (plausible). Canvas memory grows with every imported or generated picture.** Each one keeps a roughly 12.6 MB canvas (`document.js:89-100, 232`), so iOS Safari's canvas memory limit is reached after about 20–30 pictures. Fix: keep ImageBitmaps or blobs instead, zero out canvases after use, and reuse one cache canvas.
9. **MEDIUM (plausible). IndexedDB connection loss stops autosave for the session.** `storage.js:7-27` caches a rejected or closed `dbPromise` forever. Fix: reset it on error and on close, then retry once.
10. **LOW-MED. Fills leave a light halo along hand-drawn strokes.** Tolerance is measured against the seed color, so anti-aliased edge pixels stay unfilled (`render.js:232-240`).
11. **LOW-MED. Long strokes get slow.** Every frame redraws all points of the gesture, which is quadratic, and rainbow strokes make one gradient per segment (`input.js:118-128`).
12. **LOW (verified). A fill tap on the last pixel column or row is ignored.** `Math.round` can give `w` (`input.js:47`). Fix: `floor` and clamp.
13. **LOW. `importBackground` reads `W` and `H` before its awaits** (`document.js:83`). A page change during decode commits an image of the wrong size.
14. **LOW. Cmd/Ctrl+Z works in text inputs and open dialogs** (`app.js:274-284`). It undoes the drawing instead of the text.
15. **LOW. The final pointer position is dropped.** Stroke ends fall up to about 2 px short (`input.js:74,79`).
16. **LOW. The UI can still be zoomed.** iOS ignores `user-scalable=no`, and `touch-action: manipulation` is only set on buttons. Fix: set it on `html` and `body`.
17. **LOW. Tapping Save twice quickly throws.** A second `showModal()` raises `InvalidStateError`, and the object URL leaks (`app.js:244-270`).
18. **LOW.**
    - The fixed 2048 px page looks soft on large high-DPI screens.
    - Pencil pressure and tilt are unused (a feature gap).
19. **LOW. Refilling a rainbow-filled area with a solid color only fills a vertical band.**

**Checked and fine:**
- coordinate mapping and rotation;
- pointer capture and `pointercancel`;
- `touch-action: none` on the paper;
- scanline fill (no stack overflow);
- the vector-ops undo with a 50-op bake;
- autosave in IndexedDB rather than localStorage;
- EXIF orientation;
- no listener leaks.

---

## Part 3. Web app: AI, settings and security

### High

1. **The TLS private key can be downloaded.** ✔
   - Cause: the README tells the parent to create `*-key.pem` inside `web/`, and `serve_https.py` serves all of `web/`.
   - Result: anyone on the Wi-Fi can fetch it at `https://192.168.1.122:8443/192.168.1.122-key.pem`.
   - Fix: create the certs outside `web/`, or return 404 for `.pem`, `.py` and dotfiles.
2. **API keys, including an OpenAI admin key, are public from `config.local.json`.**
   - Cause: it is a plain static file. The example invites putting `openaiAdmin` in it, and the README's Deploy section says to upload `web/` to any static host.
   - Result: after a drag-and-drop deploy, anyone can read the keys.
   - Fix: remove `openaiAdmin` from the example, add a warning to the Deploy section, and in the long run put a proxy in front.
3. **Create has no gate and no limit** (`app.js:157-226`). A child can make unlimited paid requests at about $0.03–$0.10 each. Fix: add `maxPagesPerDay` and a cooldown.

### Medium

4. **The parent gate is easy to get past** (`parentgate.js`):
   - three buttons and unlimited retries;
   - the correct answer is the middle value in 4 of 6 layouts, so "always tap the middle" wins about 2/3 of the time.
   - Fix: add a lockout, more choices, and wrong answers that aren't adjacent.
5. **A cancelled generation is logged as "failed", and its billed cost is lost** (`imagegen.js:66`). `.catch(() => null)` swallows the AbortError.
6. **No request has a timeout.** Examples are "Drawing your page…" and the "Asking…" label on Refresh, both of which can spin forever. Fix: `AbortSignal.any([signal, AbortSignal.timeout(...)])`.
7. **`gpt-image-1-mini` is priced as `gpt-image-1`.** ✔
   - Where: `usagelog.js:9-19`. The `startsWith('gpt-image-1-')` check matches `-mini`, so it is overestimated about 4–5×.
   - Also: `gpt-image-1.5`, `gpt-image-2` and `chatgpt-image-*` get no price at all.
8. **Voice hints say "reopen this box", but reopening never retries** (`voiceinput.js:12-58`). `available = false` is never reset without a page reload.
9. **The child's words reach the prompt unfiltered** (`imagegen.js:88-92`):
   - no kid-safety instruction in the prompt;
   - no Gemini `safetySettings`;
   - voice input bypasses `maxlength=200`, and newlines aren't stripped.
10. **(plausible) API keys in `localStorage`, including the admin key, are readable by other sites on the same origin**, for example other GitHub Pages projects under the same `user.github.io`.

### Low

11. **One stalled TLS client blocks the whole server.** `serve_https.py` wraps the listening socket, so the handshake runs in the accept loop with no timeout.
12. **The server listens on every network interface (`0.0.0.0`).** On café Wi-Fi it serves the keys and the `.pem` files to anyone.
13. **A bad `imageModels` value in `config.local.json` breaks Settings.** A string value makes `provider in "..."` throw a TypeError, and there is no type checking (`config.js:136-138`).
14. **Values forced by `config.local.json` are saved into each device's own settings** (`viewmodel.js:109`). They stay in force after the file changes.
15. **Gemini cost is overestimated.** Thinking and text tokens are priced at the image-output rate.
16. **Blocked Gemini images get a vague error** (the `finishReason` isn't shown), and their cost is dropped.
17. **The OpenAI spend figure goes stale.** `spendChecked` is never reset when the key changes.
18. **Costs under a tenth of a cent show as "$0.000".**
19. **(edge case) A Gemini model id starting with `models/` becomes `models%2F…` in the URL and returns 404.**
20. **The Settings text says the key is "stored only in this browser"**, which is wrong when it comes from `config.local.json`.
21. **`.gitignore` only covers `web/*.pem`.** Add `*.key`, `*.crt` and `config.local*.json`, keeping an exception for the example file.

**Checked and fine:**
- **XSS:** the child's text, API errors and log entries all go into the page through `textContent` or `new Option()`.
- double-submission guards;
- API endpoints and response parsing;
- OpenAI Costs paging;
- a missing or invalid `config.local.json`.

---

## Part 4. Web app: refactoring, UI and accessibility

### Bugs and quick fixes

1. **Log errors show grey, not red.** ✔ In `styles.css:879-883`, a later rule with the same specificity sets `color: var(--muted)` on `.log-entry-error`.
2. **Contrast fails WCAG AA:**
   - white on the `--accent` orange buttons is about 2.3:1 (Done, Make my page, Download);
   - `.danger` is about 3.7:1;
   - `--muted` on beige is about 4.3:1, and the captions are tiny (0.68rem).
3. **Dialogs have no accessible names** (the titles are `<p>`). The Clear dialog auto-focuses the destructive button. Pressing Enter in the Log dialog's admin-key field submits the form and closes the dialog.
4. **The ARIA roles don't match how the controls behave.**
   - `role="toolbar"` has no arrow-key navigation, and single-choice groups aren't radio groups.
   - `<nav>` is used for button groups.
   - Size and palette selection are shown by color alone.
   - The white swatch's border is about 1.1:1.
   - `.voice-btn` and the gate buttons have no focus outline.
5. **Smaller accessibility gaps:**
   - the canvas has no role or label;
   - the toast is unhidden after its text is set, so VoiceOver may not announce it;
   - `autofocus` is on a hidden mic button;
   - `.confirm` dialogs have no `max-height`, so the Create dialog is cut off when the keyboard is up in landscape.

### Structure

6. **`app.js` does too much.** It holds the whole Create flow (the paid calls), Save/Export, Clear, the toast, autosave and page sizing. Split these into `controllers/create.js`, `controllers/export.js`, `ui/toast.js` and `autosave.js`.
7. **The viewmodel is only half a viewmodel.**
   - Its fields are public and changed from outside.
   - SettingsView and LogView call `imagegen` and `usagelog` directly.
   - The palette is stored under its own key instead of in the config.
   - Fix: a VM that exposes a read-only snapshot and intent methods.
8. **Every tap rebuilds about 25 toolbar buttons**, which loses keyboard and VoiceOver focus. The closed Settings dialog also re-syncs, parsing localStorage each time. Fix: build buttons once and only toggle `aria-pressed`.
9. **The same code is written out several times.**
   - The localStorage try/catch JSON pattern appears about 9 times. Fix: a `prefs.js` with one table of keys.
   - The fetch → JSON → error code appears 3 times. Fix: `http.js` and one `ServiceError`, replacing `ImageGenError` and `SpendError`.
10. **The modules are layered the wrong way round.**
    - `config.js` (the domain) imports from `imagegen.js` (the network).
    - `imagegen.js` mixes the provider catalog, key storage, the model cache and HTTP.
    - `usagelog.js` mixes pricing and the ledger with an Admin API client.
    - Fix: split into `providers.js`, `apikeys.js`, `api/openai.js`, `api/gemini.js`, and a pure `usagelog.js`.
11. **Programming errors are shown to the child** (`error.message` in the UI). The claude.ai hosting note is baked into the generic network error message.
12. **DOM and dialog code is repeated.** There are four different ways of building elements, and the `q` helper is redefined five times. Fix: a `dom.js` `h()` helper and a `DialogView` base class.
13. **Rainbow and color constants are defined more than once** (`render.js`, `config.js`, `icons.js`), and the ink fallback `#EE5A45` is repeated in several files.
14. **Dead code:**
    - `DrawingDocument.version` is never read;
    - `composite()` ignores its parameters;
    - `.voice-btn[hidden]` is redundant with the global `[hidden]` rule;
    - `class="wide"` and `class="log"` have no styles;
    - some CSS rules are split between distant sections.
15. **Stale comments and docs:**
    - "Bottom toolbar" (it is a side rail in landscape);
    - "canvas is 2048×1536" (the page size now varies);
    - "Pure drawing helpers" (the module holds state);
    - the README's export size.
16. **Magic numbers:**
    - the aspect clamp and refit tolerance;
    - the debounce, toast and autosave timings;
    - the 1.2 and 0.83 ratio thresholds;
    - fill tolerance 64;
    - line-art thresholds 200 and 100;
    - the toast's 76px offset.
17. **Global state:** `managedKeys` is module-level. The top-level `await loadServerConfig()` has no timeout.
18. **Inconsistent names:**
    - `random`, "Surprise" and `surpriseColor` for one color;
    - `leftHanded`, `data-hand` and `lefty` for one setting;
    - `enableImageGen`, "Create" and `imagegen` for one feature.
19. **Colors are hard-coded in the CSS.** There are three almost identical beiges, and other hex values sit outside `:root`. Fix: tokens, plus a stylelint rule to keep them.
20. **Safari polish:**
    - add `-webkit-tap-highlight-color: transparent`;
    - set `touch-action: manipulation` on `body`;
    - drop `user-scalable=no`, which blocks zoom in the parent Settings sheet;
    - add `color-scheme: light`;
    - turn off the swatch animation under reduced motion.
21. **The two apps have drifted apart.**
    - Their config shapes differ.
    - Swift has lasso but no fill; web has fill but no lasso.
    - Suggestion: a `shared/catalog.json` for tools, colors, palettes and sizes, with an id-parity test on each side.

### Suggested testing

- **`node --test` on the pure modules:**
  - `normalizeConfig` and `applyManaged`;
  - `priceFor` and `estimateCost`;
  - `monthTotals`;
  - the viewmodel's tool and eraser logic;
  - the gate question generator.
- **Make fill testable in Node:** let `floodFill` and `toLineArt` take `{data, width, height}` instead of a canvas context.
- **Playwright (WebKit, iPad profile):** draw, undo, fill, the parent gate and Settings, and Create with mocked APIs.
- **Accessibility and linting:** `@axe-core/playwright`, ESLint and stylelint.

---

## Suggested priority order

1. **Security and money.** Web Part 3 #1 (the downloadable TLS key) and #2 (keys in the public `config.local.json`). Then #3 (the spending cap) and #4 (the parent gate lockout).
2. **Data loss.** Web core #1, #3, #4 and #5 (restore, serialize and autosave).
3. **Native app blockers.** Swift #6 (the compile error), #3 (the share crash), and #1, #2, #4 and #5 (undo). Fix the undo items by adopting `UndoManager` (R2) and not by patching the custom stack.
4. **iPad experience.** Web core #2 (undo freeze), #6 and #7 (palm and gesture handling), and #8 (canvas memory). Swift #12 (dark mode).
5. **Quick UI and accessibility fixes.** Web Part 4 #1 through #5.
6. **Structural refactors.** Swift R1, R3 and R6. Web Part 4 #6 through #10. Then tests.
