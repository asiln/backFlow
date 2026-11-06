# figma-export

Turns the running local app into Figma layers with no Figma MCP calls.

1. `walker.js` runs inside the page and reads computed styles, geometry, text, SVG icons and images.
2. `extract.mjs` logs in (local test accounts only), opens each screen in a batch, runs the walker, writes `out/<batch>.figma.json`, and reports problems (404, redirect to login, `???`, error toasts, spinners, empty screens).
3. `plugin/` is a Figma plugin. Paste the JSON (or pick the file) and it builds one named Section with all screens in a grid.
4. `run-all.mjs` runs a whole directory of batches and writes a combined `summary.json`.
5. `diff.mjs` compares a real screenshot against an HTML re-render built only from the JSON, to catch systematic extraction errors.

## Run

```
cd kheez-figma-export
npm install
node extract.mjs batches/test.json                 # -> out/test.figma.json
node extract.mjs batches/test.json --only dash     # only screens whose name contains "dash"
node extract.mjs batches/test.json --strict        # exit code 2 if any screen looks broken
node run-all.mjs batches/athlete                   # every *.json in the dir -> out/athlete/<batch>.figma.json + summary.json
node run-all.mjs batches/athlete --only programs   # filter by batch file name or screen name
node diff.mjs batches/test.json --screen Dashboard # -> out/diff/<slug>.{real,render,side}.png + pixel-diff report
```

Persian must never go through shell arguments (it turns into `???`). Put it in batch files; the extractor flags `???` in screen names, setup scripts and page text.

### Batch file

```json
{ "phone": "test-user-id", "width": 390, "height": 844, "fullPage": false,
  "screens": [ { "name": "Athlete / Dashboard / 390", "path": "/dashboard",
                 "setup": "click('^Save$'); await sleep(800)", "delayMs": 2500, "tutorial": false,
                 "fullPage": true, "selector": "[role=dialog]", "backdrop": true,
                 "width": 1280, "height": 800 } ] }
```

Omit `phone` for logged-out pages. `setup` is async JS with `sleep(ms)` and `click(regexString)`, for opening sheets, tabs and steps.

Optional batch / screen fields (all additive; old batches keep working):

| Field | Where | Meaning |
|---|---|---|
| `fullPage` | batch or screen | `true`: grow the viewport to the full content height and expand overflow auto/scroll containers to their scroll height before walking. Default `false` (unchanged). |
| `selector` | screen | CSS selector; capture only that element (frame size = element box, `src` = its page position). Waits up to 5 s for it to be visible. |
| `backdrop` | screen | With `selector`: capture the full-viewport fixed/absolute overlay wrapper around the element instead of the element alone (so the dimmed backdrop is included). |
| `width`, `height` | screen | Override the viewport for this screen. |
| `base`, `api` | batch | Unchanged (localhost only). |

### CLI

`node extract.mjs <batch.json> [out.json] [--only <substring>] [--strict]`, also importable: `import { runBatch } from './extract.mjs'`.
A crash in one screen no longer aborts the batch; it is reported as `ERROR: capture failed` and the screen is skipped.

### Warnings in the report

Each report entry has `warnings` (strings) and `broken` (true if any starts with `ERROR`).

- ERROR: HTTP status >= 400, navigation failure, 404 page, app error screen, redirect to login/register/otp when the path was not an auth page, `???` in text, 3+ skeleton placeholders, error toast (text with خطا/ناموفق/مشکل/error/failed), empty screen (fewer than 8 nodes or no text; for `selector` captures only "nothing matched").
- warn: spinner-like elements, loading text, other toasts, 1-2 skeleton elements, images that became placeholders, uncaught page errors.

## Install the plugin once (Figma desktop app)

Plugins, then Development, then Import plugin from manifest, then choose `plugin/manifest.json`.
Run it from Plugins, then Development, then Kheez Import. Paste or choose the JSON, then Build layers.

Options in the plugin window:

- **Section name** (default: the batch name from the JSON). Every import is wrapped in a Section placed to the right of existing content; frames are laid out in a grid, 80 px gaps, wrapping at about 6000 px.
- **Bind colours to local variables**: reads local COLOR variables (default mode of each collection, aliases resolved) and binds solid fills, strokes and text colours whose RGBA matches exactly. When several variables match, the collection named `Color` beats other collections, and `Primitives` is last. Does nothing if the file has no local COLOR variables.
- Progress bar, Cancel button, and a final summary with counts and failures (svg, image placeholders, nodes, style steps, plus the first error messages).

## JSON schema (summary)

`{ kheezFigma: 1, name?, assets?: { id: dataUrl }, frames: [node] }`

Node: `{ t: 'frame'|'text'|'svg'|'img', name, x, y, w, h, ... }`. Existing fields: `fill, stroke{c,w[4],style}, radius, shadow[], blur, bblur, opacity, clip, layout, children, text, font, svg, data`. Optional fields added later (older consumers can ignore them):

- images: `data` (png/jpeg data URL) or `asset` (key into top-level `assets`, used when the same image appears twice), `fit` (`FILL|FIT|CROP|TILE`), `tf` (2x3 crop transform for `CROP`), `iw/ih`, `alt`, `failed` / `needsFetch` (placeholder reason), `radiusArr` (per-corner radii if not uniform). `fill/stroke/shadow` also appear on img nodes.
- frame backgrounds: `layers` = CSS-ordered (top first) list of `{k:'grad',...}` and `{k:'img', data|asset, mode, tf, scale}`; `grads` is still emitted for gradient-only backgrounds.
- text: `runs: [{s,e,family?,size?,weight?,color?,deco?}]` (ranges where inline spans differ from the base style), `font.shadow {c,x,y,blur}`.
- effects: `shadow[].inset` (becomes INNER_SHADOW), several shadows per node.
- `xf: [a,b,c,d,tx,ty]` rotation/flip in parent space (children are measured untransformed), `blend` (mix-blend-mode), `pos` (`fixed|sticky`), `z` (non-zero z-index; siblings are already emitted in paint order).
- root: `src {x,y}` (page position of a selector capture).
- names: aria-label, data-testid, role, or a semantic tag (`button · label text`, `nav`, `h2 · title`, `overlay`).

## What the walker handles

- **Images**: `<img>`, `<canvas>`, `<video>` frame, and CSS `background-image: url()` are re-encoded in the page via canvas to PNG (JPEG when PNG would exceed ~1.5 MB), downscaled to at most 1600 px, so webp/avif/svg all work. `object-fit`/`object-position`, `background-size`/`position`/`repeat`, and border-radius (px, %, rounded-full) are mapped to scale modes. Cross-origin images that the page cannot read are downloaded by Playwright and converted. If everything fails the node becomes a labelled gray placeholder (never a crash).
- **SVG**: computed `fill`, `stroke`, widths, caps, dashes, opacity, `stop-color` are written onto every cloned element (so CSS classes and `currentColor` survive), `<use>` and `<symbol>` are expanded, gradients/clipPaths defined elsewhere in the page are pulled in, the root keeps its `viewBox` and is sized to the rendered box.
- **Text**: plain inline markup (`b`, `span`, `a`, `br`...) becomes one text node with `runs`; text split by block/inline-block children becomes one node per run of text; line-box half-leading is added back so Figma text lands where the browser drew it; gradient text uses its first stop; text containing Persian falls back to Vazirmatn when the CSS stack named a Latin-only font first.
- **Layout fidelity**: z-index paint order among siblings, fixed/sticky bars kept in place (the plugin adds constraints), rotate/flip, `mix-blend-mode`, text-shadow, inset and multiple box-shadows.

## Fidelity check (`diff.mjs`)

Takes a real screenshot and a screenshot of an HTML re-render built from the JSON (absolutely positioned boxes, text, inline svg, images, the app's own @font-face renamed to Vazirmatn / Space Grotesk / JetBrains Mono), prints the pixel-difference percentage (channel delta above `--threshold`, default 24), per-type averages, the worst nodes and hot 60 px cells, and saves `<slug>.side.png` (real | render | diff). Text anti-aliasing alone gives roughly 25-30% difference inside text boxes; look for large blocks in the diff panel instead. `fixtures/serve.mjs` + `batches/fixture.json` is a local test page covering images, svg, transforms, runs, scroll containers and a bottom sheet.

`plugin-mock.mjs <file.figma.json> [bind]` runs the plugin code against a mocked Figma API (see above). It catches JS errors and API misuse, not rendering differences.

## Real auto-layout (`ls`)

Design and rationale: `docs/AUTO-LAYOUT-SPEC.md`. Things still to be confirmed in real Figma: `docs/VERIFY-IN-FIGMA.md` (a small test plugin in `plugin/verify/`).

Pipeline: `walker.js` collects layout facts (`lf`: display, flex/grid props, margins, min/max, positions, text lines/line height/truncation) and runs style-override probes on every frame (width auto, width max-content, height auto, height with `align-self:flex-start`, which inset sides are authored, grid `fr` tracks). Probes restore the inline styles; they are capped at 9 s per screen (`probeBudgetMs`) and cost about 100-200 ms per screen in practice. `normalize.mjs` (called by `extract.mjs`) turns the facts into a compact `ls` object per node, checks it with a small auto-layout simulator (`layout-sim.mjs`, tolerance 1.5 px) and applies the ladder per container:

| Level | Meaning |
|---|---|
| F0 | auto-layout with FIXED / HUG / FILL children as inferred |
| F1 | same container, every child FIXED at its measured size |
| F2 | offenders become ABSOLUTE children, the rest stays in flow |
| F3 | no auto-layout (`k: 'N'`), children keep absolute x/y (the pre-`ls` behaviour) |

`ls` fields. Container: `k` (`H`, `V`, `W` wrapping row, `G` grid, `N` none), `lv` (planned level 0-3), `g` item spacing, `g2` counter-axis spacing (wrap), `p` [top,right,bottom,left] content offset (CSS padding + border), `bw` the part of `p` that is a drawn stroke, `pa` primary and `ca` counter alignment, `cols`/`rows`/`cg`/`rg` for grids (`{t:'FLEX'|'FIXED'|'HUG', v}`). Child: `s` [horizontal, vertical] each `F` fixed, `H` hug, `L` fill; `abs` + `cn` [horizontal, vertical constraint] for out-of-flow children; `mn`/`mx` min and max size; `gp` [row, col, rowSpan, colSpan] and `ga` for grid cells; `sp` marks a spacer frame. Text: `tx` {`l` lines, `lh` line height px, `nw` nowrap, `tr` truncation lines, `ta` text-align override, `bx` the box is the container's content box}. Everything is optional: JSON without `ls` (older exports) imports exactly as before.

Structure changes the normalizer makes: inert single-child wrappers are merged away; RTL rows are ordered by visual x (Figma has no direction property); uneven gaps become an `itemSpacing` plus invisible spacer frames named `gap`; children that do not follow the container's cross alignment get a transparent `align` wrapper frame (or text-align when they are text); wrapped rows become `W`, CSS grids become `G`.

Plugin side (`plugin/code.js`): builds in the order create, style, `resize` once, append, `layoutMode` and padding, children, child sizing (`textAutoResize` then `resize` then `FILL`), min/max; ABSOLUTE children get `layoutPositioning` and constraints. After a container is built, the plugin compares each child's real bounds with the measured rectangles (text size errors from different font metrics are tolerated and budgeted) and steps that container down the ladder if it deviates (F0, F1, F2, F3). The import log prints counts per level, how many containers degraded in Figma, and the first reasons. Unverified runtime facts are constants in `CFG` at the top of `plugin/code.js`.

Options and flags:

- Plugin window: "Auto layout (when the JSON has it)" checkbox (default on). Off imports with absolute positions.
- `node extract.mjs batch.json --no-layout` skips the walker probes and normalizer (old output); batch/screen field `"layout": false` does the same per screen.
- Report entries carry `layout`: percent of containers at F0..F3, container kinds, wrappers, spacers, absolute children, sizing counts (hug/fill/fixed), failure causes and the walker timing.
- `node diff.mjs batch.json --ls` re-renders the JSON with Chrome flexbox/grid built from `ls` (HUG/FILL/gaps/alignment) instead of absolute boxes, so a wrong spec shows up as a pixel difference. Without `--ls` the render is unchanged.
- `node plugin-mock.mjs file.figma.json [--text-scale=1.05] [--no-grid] [--no-layout]` runs the plugin against a mock with its own layout engine, reports violations of documented API rules (FILL outside auto-layout, HUG on a rectangle, text FILL with WIDTH_AND_HEIGHT, resize after layoutSizing ...) and a position-fidelity percentage. It is not Figma.

Known limits: BASELINE alignment is approximated by geometry (and may need an `align` wrapper), `position:fixed` children stay inside their DOM parent instead of being hoisted to the screen, grid subgrid/dense/auto-fill layouts only work when the computed tracks are plain pixels, negative margins fall to F2/F3, RTL wrap rows start on the left in Figma, aspect ratio is not locked, percent/viewport sizes are frozen at the captured width (each width is its own frame).

## Notes and known limits

- Local app only (the extractor refuses non-localhost). Never run it against production.
- Auto-layout: see "Real auto-layout" above. Containers that cannot be reproduced keep absolute positions (F3).
- Needs Vazirmatn, Space Grotesk and JetBrains Mono available in Figma (all Google Fonts).
- Not captured: pseudo-elements (`::before/::after`), `clip-path`/`mask`, filters other than blur, `backdrop-filter` other than blur, video frames from cross-origin sources, `foreignObject` in SVG, repeating gradients (drawn as plain gradients), `list-style` markers (ignored on purpose).
- Rotated elements with a non-unit scale lose the scale (Figma transforms cannot scale). Skew is ignored.
- Bidi isolates (`dir="ltr"` spans inside RTL text) become separate text nodes when they are inline-block; inline ones rely on Figma's own bidi ordering.
- `fullPage` resizes the viewport (max 20000 px) so `100vh` layouts and fixed bars end up at the bottom of the capture; very tall pages with lazy content may need a larger `delayMs`.
- A batch with many large photos produces large JSON (each image is at most ~1.5 MB; images used more than once are stored once under `assets`).

## Configuration and private files

Nothing project-specific or secret lives in the tool itself.

- `kheez.config.json` (gitignored, copy from `kheez.config.example.json`): base and API URLs, login endpoint and field names, locale, localStorage keys to pre-set. Override the path with `$KHEEZ_CONFIG`.
- Test password: `$KHEEZ_TEST_PASSWORD` (never committed, never in a batch file).
- `batches/` (gitignored): your real screen lists. `batches.example/` shows the format.
- `out/` (gitignored): exports. `state-*.json` (gitignored): saved sessions.
- Use local or staging apps and test accounts only. The extractor refuses non-localhost origins.
