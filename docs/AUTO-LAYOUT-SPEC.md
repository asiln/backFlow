# Real Figma auto-layout from a rendered page: design spec

Status: research/spec only. Nothing in walker.js or plugin/code.js was changed. Date: 2026-11-06.

## 0. Sources and honesty about evidence

Verified locally (source of truth): the Figma plugin typings
`plugin-api-standalone.d.ts` (from the Figma plugin typings) (cited `d.ts:LINE`), plus sibling `gotchas.md` (`gotchas.md:LINE`) and `../SKILL.md` rules 12, 12b, 12c.

Not verified: open-source converters. WebFetch of BuilderIO/figma-html returned only "project has moved to the Builder.io Chrome extension"; raw source URLs 404'd. Anything said about html-to-figma, html.to.design or Figma's code-to-canvas is general knowledge, marked "(unverified)". The rules in A and B are derived from the typings plus CSS semantics. Items marked VERIFY need a quick experiment in a scratch Figma file (section D5).

Existing code (read-only inspection):
- walker.js emits `{t,name,x,y,w,h}` relative to parent plus visuals. A layout hint exists only for `display:flex|inline-flex` with `flex-wrap:nowrap`: `{dir,gap,pad,justify,align,rtl,rev}`. Block, grid, wrap, margins, min/max, position, flex-grow and per-child sizing intent are not emitted.
- plugin/code.js `build()` makes every frame `resize(w,h)` (FIXED/FIXED), then `tryAutoLayout()` brute-forces 12 align combos and keeps auto-layout only if children land within 1.5px. Everything stays FIXED, so nothing hugs or fills. Text is `NONE` (single line) or `HEIGHT` (multi-line).

## 1. Figma API facts that constrain the design

| Fact | Source |
|---|---|
| `layoutMode`: NONE, HORIZONTAL, VERTICAL, **GRID**. Switching to NONE does not restore old child positions. | d.ts:5212-5254 |
| `layoutSizingHorizontal/Vertical` FIXED/HUG/FILL. HUG only on auto-layout frames and TEXT. FILL only on a child of an auto-layout frame that is not ABSOLUTE. Unparented node throws. | d.ts:4939-5019; gotchas.md:560-614; SKILL.md rule 12 |
| `resize()` resets sizing modes to FIXED: call it BEFORE `layoutSizing*`. `resizeWithoutConstraints` also exists. | SKILL.md 12c; d.ts:5024-5053 |
| Frame enums `primaryAxisSizingMode/counterAxisSizingMode` = FIXED/AUTO, different from child `layoutSizing*`. | gotchas.md:624-647 |
| HUG parent gives FILL children no room (collapse). Parent must be FIXED/FILL on that axis. | gotchas.md:649-668 |
| Text defaults to WIDTH_AND_HEIGHT and ignores FILL (thread collapse). Wrapping text = `textAutoResize='HEIGHT'` + explicit width, set before `characters`. | gotchas.md:670-694; d.ts:8538 |
| `layoutGrow` (0/1) = FILL on primary axis; `layoutAlign STRETCH` = FILL on counter axis (legacy). Axis must be FIXED, not AUTO. | d.ts:6033-6048, 5278-5295 |
| `layoutPositioning='ABSOLUTE'`: out of flow, still nested, respects `constraints`, x/y/size settable, FILL illegal. | d.ts:6050-6082; gotchas.md:583 |
| `minWidth/maxWidth/minHeight/maxHeight` only on auto-layout frames and their direct children. | d.ts:4849-4865 |
| `layoutWrap` WRAP only on HORIZONTAL. `counterAxisSpacing` and `counterAxisAlignContent` (AUTO or SPACE_BETWEEN) need WRAP. AUTO + all children STRETCH = `align-content: stretch`. | d.ts:5377-5381, 5553-5562, 5616-5662 |
| `primaryAxisAlignItems` MIN/MAX/CENTER/SPACE_BETWEEN (doc block near d.ts:5440-5465 also shows SPACE_EVENLY/SPACE_AROUND; VERIFY the union). `counterAxisAlignItems` MIN/MAX/CENTER/BASELINE (BASELINE horizontal only). | d.ts:5440-5551 |
| `itemSpacing` is the only inter-child spacing. No margins, no flex-shrink/basis/order, no per-child align except STRETCH/ABSOLUTE. | d.ts (absence) |
| `strokesIncludedInLayout`: true = children inset by the stroke (like a CSS border); false = stroke overlaps children. | d.ts:5340-5371 |
| `itemReverseZIndex`: true = first child on top. Default false = last child on top (DOM paint order). | d.ts:5664 |
| **GRID layout exists**: `gridRowCount`, `gridColumnCount`, `gridRowGap`, `gridColumnGap`, `gridRowSizes[]`/`gridColumnSizes[]` of `{type:'FLEX'|'FIXED'|'HUG', value}` (FLEX = `fr`, HUG = fit-content), `gridItemsPositioning` MANUAL/ROW_AUTO_FLOW, `gridAutoTracks`; child: `setGridChildPosition(row,col)`, `gridRowSpan`, `gridColumnSpan`, anchor indexes, `gridChildHorizontalAlign/VerticalAlign`. FLEX tracks invalid if grid is HUG on that axis. | d.ts:5707-6020, 6100-6190 |
| `targetAspectRatio`, `lockAspectRatio()`; not with auto-resizing text. | d.ts:5080-5105 |
| **No RTL / direction property in the plugin API** (grep only hits unrelated enum members d.ts:1978-1979). Horizontal auto-layout puts child index 0 on the left. | grep |

Consequence: RTL is solved by ordering children by visual position; CSS margins by spacer arithmetic.

## A. CSS to Figma mapping

P = primary axis, C = counter axis.

### A1. Flexbox containers

| CSS | Figma | Notes |
|---|---|---|
| `row` LTR | HORIZONTAL, DOM order | |
| `row` in RTL | HORIZONTAL, children sorted by **visual x ascending** (reverse of DOM) | no RTL in API |
| `row-reverse` | same rule | Robust rule: ALWAYS sort siblings by rendered rect on P, ignore DOM order and `order`; DOM order only as tiebreak |
| `column`, `column-reverse` | VERTICAL, sorted by visual y | RTL does not change top-to-bottom |
| `wrap` | HORIZONTAL + `layoutWrap='WRAP'`, `column-gap`->`itemSpacing`, `row-gap`->`counterAxisSpacing` | row direction only. `column`+wrap, `wrap-reverse`: fallback. RTL wrap: rows fill right-to-left in CSS but Figma wraps left-to-right, so validate or use per-row frames |
| `gap` | `itemSpacing` (P), `counterAxisSpacing` (C, wrap only) | column direction: P gap = `row-gap` |
| `justify-content` | start/end/center/space-between -> MIN/MAX/CENTER/SPACE_BETWEEN; space-around/evenly -> SPACE_AROUND/SPACE_EVENLY (VERIFY) | Decide MIN vs MAX from geometry (lead/trail free space), not from start/end + RTL reasoning. In RTL row, start = right = MAX |
| `align-items: stretch` | FILL on C for children with auto cross size that really stretch; C align MIN | per child |
| `align-items: start/end/center` | MIN/MAX/CENTER | In an RTL **column**, cross-start is physical right = MAX |
| `align-items: baseline` | HORIZONTAL only: BASELINE | column: MIN |
| `align-self` differing from container | slot wrapper frame (transparent, HUG on P, FILL on C, own C align) or ABSOLUTE if a lone oddity | `align-self: stretch` -> FILL on C |
| `align-content` (wrap) | flex-start/center/end -> AUTO + `counterAxisAlignItems`; space-between -> SPACE_BETWEEN; stretch -> AUTO with all STRETCH; others fallback | d.ts:5553 |
| `flex-grow>0` | FILL on P | Figma only 0/1. Equal siblings = equal split. Unequal factors or basis: FIXED and flag |
| `flex-shrink` | ignored | shrink 0 -> FIXED/HUG; shrinking text -> FILL |
| `flex-basis` | ignored, rendered size decides | `flex:1 1 0` FILL; `0 0 Npx` FIXED; auto + grow 0 HUG |
| `order` | ignored (sort by rect) | |
| `min/max-width|height` | `minWidth/maxWidth/...` when authored (not computed defaults) | |
| `inline-flex` | same as flex; parent sees inline-level box; width HUG unless authored | |
| `margin-inline-start:auto` | one auto margin splitting two groups -> SPACE_BETWEEN; else spacer frame FILL | |

### A2. Block / normal flow

A block container with block-level children is a **vertical stack**. Test: >= 1 in-flow element child; sort by top; every child `top >= prev.bottom - 0.5` and no two children overlap in y. If so, VERTICAL with `itemSpacing` = common gap (else spacers, A4). Block child horizontal = FILL when `width:auto`/`100%` and filling the container; vertical = HUG unless authored height. Container C align MIN.

Inline content:
- Block with only text nodes and inline elements: ONE text node (use range styling for `<b>`/`<span>` styles; current walker emits them as separate positioned nodes, acceptable in fallback). Never model line boxes as auto-layout.
- Single visual line of icon + text spans: HORIZONTAL, gap measured from rects (whitespace is real width), C CENTER (BASELINE if validation prefers).
- `inline-block` siblings on one row: HORIZONTAL (WRAP if several visual rows, or row frames).
- Mixed block and inline children: wrap each run of inline children in an anonymous HORIZONTAL/text frame, then VERTICAL for the whole.
- `<br>`: starts a new row frame.

Margin collapse: adjacent vertical margins collapse (max, not sum); first/last child margins can collapse through parent; negatives combine algebraically. **Never compute spacing from CSS margins. Use measured rects**: `gap_i = child[i+1].top - child[i].bottom`. This absorbs collapse automatically. Horizontal margins do not collapse but the same method works.

### A3. CSS grid

Preferred: **Figma GRID** (d.ts:5768-6020).

| CSS | Figma |
|---|---|
| `repeat(3,1fr)` | `layoutMode='GRID'`, `gridColumnCount=3`, `gridColumnSizes[i].type='FLEX'` |
| fixed px track | `FIXED` + value |
| auto/min/max/fit-content | `HUG` |
| gaps | `gridRowGap`, `gridColumnGap` |
| placement | `gridItemsPositioning='MANUAL'` then `child.setGridChildPosition(r,c)`; spans via `gridRowSpan/gridColumnSpan`; pure auto-flow grids may use ROW_AUTO_FLOW if visual order = child order |
| `justify/align-self` | `gridChildHorizontalAlign/VerticalAlign`, or FILL for stretch |
| RTL | column 0 is leftmost in Figma; derive column indexes from measured x, reverse the track list |

Recover tracks: `getComputedStyle(grid).gridTemplateColumns/Rows` resolve to px lists, giving counts and sizes. fr intent: probe by resizing the grid +-20px (B2); track that moves is FLEX, else FIXED. Item cell: tracks whose [start,end] intersect the item rect (more reliable than `gridColumnStart`).

Fallback (subgrid, overlapping `grid-template-areas`, dense holes, `auto-fill/auto-fit`): VERTICAL frame of HORIZONTAL row frames grouped by top (1px), row FILL, children FILL when fr-equal else FIXED. Wrapping lists of equal cards: HORIZONTAL+WRAP with FIXED cards.

### A4. Margins, padding, borders

| CSS | Figma | Rule |
|---|---|---|
| padding | `padding*` | getComputedStyle returns physical sides; use as is (RTL safe) |
| border | stroke INSIDE with per-side weights (existing) plus `strokesIncludedInLayout=true` | do NOT add border width to padding in that case. VERIFY with a 4px border; else `false` and padding = css padding + border |
| margin equal to the container gap | `itemSpacing` = mode of measured gaps | |
| unequal gaps | invisible spacer frame of size `measuredGap - itemSpacing`, or wrapper frame with padding when that child is FILL | prefer padding wrapper for margin on a single FILL child |
| `margin:auto` centering | container C CENTER if all children are centered, else slot wrapper | |
| negative margin | `itemSpacing` negative (VERIFY; typings say "positive" only for counterAxisSpacing d.ts:5616); overlap -> ABSOLUTE the overlapped child | |
| first/last child margin | absorbed into padding via measured offset | |

Padding cross-check: `padTop = firstChild.top - (container.top + border.top)`. Use CSS padding if it agrees within 0.5px, else measured.

### A5. Width/height: HUG vs FILL vs FIXED

Computed width/height are always px, so intent must be recovered.

- **FILL**: in a P axis: `flex-grow>0` or basis 0. In a C axis: `align-items/self: stretch` and cross size auto. Block in a stack: `width:auto` or `100%`. Must also hold that the rendered size equals the parent's available size.
- **HUG**: `inline-flex`, `inline-block`, `fit-content`, `max-content`, abs-pos with auto width, floats, `flex:0 0 auto`, buttons/badges. Almost all heights (`height:auto`).
- **FIXED**: authored px/rem/%/vw sizes not recoverable as fill, aspect-ratio boxes, images/svg with explicit size, `overflow` containers with explicit height, inputs.

Detection (priority order):
1. **Style-override probe, measure, restore** (exact). Set inline `width` to `auto`, `max-content`, `min-content` (important), read the rect each time, restore exactly. Decision: `auto != orig` -> authored explicit -> FIXED; `auto == orig` and `max-content == orig` -> HUG; `auto == orig` and `max-content < orig` -> FILL (block stretches beyond content). Height: `auto != orig` -> FIXED else HUG; cross-axis stretch needs the explicit rule (stretch makes `auto == orig`): parent flex with stretch/normal, child cross size auto, child cross size == parent content cross -> FILL.
2. Cheap hints, no reflow: `flex-grow`; rect equals parent content width and display block.
3. Parent-resize probe (+-20px on parent width, re-measure child): delta equal -> FILL, zero -> FIXED/HUG, proportional -> percent. Use only where 1 is ambiguous (grid fr).

`min/max`: computed `minWidth` is `0px`/`auto`, `maxWidth` is `none` by default. Emit only non-default. `max-w-md mx-auto` -> `maxWidth=448`, FILL, parent C CENTER.

`aspect-ratio`: computed gives `1 / 1` or `auto`. Images/rects: FIXED width + `lockAspectRatio()` after resize (d.ts:5105), or FILL width + lock so height follows. Frames with text content: FIXED/FIXED.

Quick reference:

| Case | horizontal | vertical |
|---|---|---|
| block div in vertical stack, `width:auto` / `w-full` | FILL | HUG |
| `flex:1` item in row | FILL | FILL if stretched else HUG |
| `shrink-0 w-12` | FIXED | HUG/FIXED |
| inline-flex, badge, auto button | HUG | HUG |
| explicit `h-12` | per width rule | FIXED |
| root `min-h-screen` | FIXED viewport W | FIXED page H |
| img `w-full h-48 object-cover` | FILL | FIXED |
| svg icon | FIXED | FIXED (leaves are never HUG) |
| input/textarea | FILL if full width else FIXED | FIXED |
| button | HUG, or FILL if `w-full`/grow | HUG |
| absolute | FIXED | FIXED (+constraints) |

### A6. Position absolute, fixed, sticky

- `absolute|fixed`: if the parent is auto-layout set `layoutPositioning='ABSOLUTE'` (d.ts:6050), then x, y, resize (FIXED), then `constraints`.
- Which inset sides are authored: in Chrome computed `top/left` for positioned boxes are used px values, not `auto`. Probe: set the side to `auto` inline, see whether the rect changed, restore (code in D2).
- Constraints: left only -> MIN; right only -> MAX; both -> STRETCH; centered via translate(-50%)/margin auto -> CENTER. Same for top/bottom. Computed `left/right` are physical in RTL, so no flip.
- Compute x/y from rects relative to the DOM parent rect (the walker nests under the DOM parent even when the CSS containing block is another ancestor).
- `fixed` (bottom nav, sheets, toasts, FAB): hoist as ABSOLUTE child of the screen root; bottom nav -> STRETCH horizontal, MAX vertical, which pins correctly when the frame is resized. Preserve z order when hoisting.
- `sticky`: treat as in-flow, name `[sticky]`.
- `relative` with offsets: ignore if <= 8px, else ABSOLUTE.
- Transforms (rotate/translate/scale) on flow children: ABSOLUTE or wrapper frame (untransformed box in flow, transformed child inside, `clipsContent=false`).
- A parent whose in-flow children are none (only absolute): keep `layoutMode='NONE'` with constraints, not auto-layout.

### A7. Overflow, z-index

| CSS | Figma |
|---|---|
| `overflow` hidden/auto/scroll/clip | `clipsContent=true` (existing). Frames do not scroll: keep box size FIXED on the scroll axis, children at full measured extent. Scroll container as flex item with `min-height:0; flex:1` -> FILL |
| visible | `clipsContent=false` |
| z-index | Only sibling order. Positioned/z-indexed children become ABSOLUTE (free to reorder); in-flow children keep flow order. Overlapping z-indexed flex items -> ABSOLUTE |

### A8. Text

| Case | Figma |
|---|---|
| Single line, in a row or HUG parent | `textAutoResize='WIDTH_AND_HEIGHT'`, HUG/HUG |
| Wraps, width from container | `textAutoResize='HEIGHT'`, resize(measuredW), append, then `layoutSizingHorizontal='FILL'`; verify `width>0` (gotchas.md:674-694) |
| Wraps, width fixed by authored max-width/box | `HEIGHT` + FIXED width (+ `maxWidth`) |
| `truncate`/`line-clamp-n` | `textTruncation='ENDING'`, `maxLines=n` (d.ts:1708-1709, 8544), horizontal FILL for `min-width:0` flex items |
| Label centered in fixed box | prefer HUG + container P/C CENTER; else FILL + `textAlignHorizontal` |
| RTL | CSS `start` + rtl -> `textAlignHorizontal='RIGHT'`. Figma bidi follows characters |
| `line-height: normal` | walker sends null; send `lhPx = rectHeight/lines` and set explicit |
| `white-space:nowrap` | HUG/HUG, never FILL |
| inputs | `textAutoResize='NONE'` or `HEIGHT`, FIXED |

Text height is derived by Figma (HUG) except NONE for exact boxes. Walker already knows `lines`; emit it plus `lhPx`, `nowrap`, `truncate`.

### A9. Replaced and form elements

| Element | Figma |
|---|---|
| img | rectangle with IMAGE fill; FIXED/FIXED, or FILL width + `lockAspectRatio` when `h:auto`; `object-fit` cover -> FILL, contain -> FIT |
| inline svg | FIXED/FIXED (vector node); FILL+lock only if `w-full` |
| input/textarea/select | HORIZONTAL frame, padding = css padding, FILL if full width, FIXED height, inner text FILL/`NONE`, C CENTER (textarea: top) |
| button | HORIZONTAL, P and C CENTER, css padding, HUG or FILL |
| video/canvas/iframe | placeholder rectangle FIXED (+ lock) |
| table | grid by rect-intersection or rows with FIXED cell widths |
| list markers / pseudo-elements | not DOM; synthesize in-flow `::before/::after` boxes (P2) or accept validation downgrade |

## B. The algorithm

### B1. Pipeline

```
walker v2 (in page): raw facts + sizing probes
normalize.mjs (Node, pure, unit-testable): prune, infer, legalise -> layoutSpec per node
plugin v2: build in strict order
validator: compare built rects to expected, run fallback ladder
```
Do inference in Node (easy to iterate/debug with Playwright), not in the plugin sandbox.

### B2. What the walker must emit

Per element, under `css` (short keys ok): `disp, pos, dirn, wm, z` (and stacking context), flex container `fd fw jc ai ac rg cg`, grid container `gtc gtr gaf`, child props `fg fs fb as ord`, grid child `gcs gce grs gre`, margins `m[4]`, `bor[4]`, `pad[4]`, `box`, `minW maxW minH maxH`, `ar`, `ovx ovy`, `tr`, `ins {t,r,b,l: set?}` (probed), `inFlow`, `cb` (content box relative to node), stable `id`, and `sz {w,h:'fill'|'hug'|'fixed', wMax, wMin, wAuto}`. Text: `lines`, `lhPx`, `nowrap`, `truncate`, `ws`. Flatten `display:contents`. Keep `opacity:0` boxes (they hold space) as invisible nodes.

Probe runner:

```js
function measureAxis(el, prop) {
  const st = el.style, saved = st.getPropertyValue(prop), pr = st.getPropertyPriority(prop);
  const rect = () => el.getBoundingClientRect()[prop], out = { orig: rect() };
  try {
    for (const v of (prop === 'width' ? ['auto', 'max-content', 'min-content'] : ['auto'])) {
      st.setProperty(prop, v, 'important'); out[v] = rect();
    }
  } finally { saved ? st.setProperty(prop, saved, pr) : st.removeProperty(prop); }
  return out;
}
function sizingIntent(el, parentFlexRow, parentFlexCol) {
  const W = measureAxis(el, 'width'), H = measureAxis(el, 'height');
  const eq = (a, b) => Math.abs(a - b) < 0.75, grow = parseFloat(getComputedStyle(el).flexGrow) > 0;
  const w = grow && parentFlexRow ? 'fill' : !eq(W.auto, W.orig) ? 'fixed' : eq(W['max-content'], W.orig) ? 'hug' : 'fill';
  const h = grow && parentFlexCol ? 'fill' : !eq(H.auto, H.orig) ? 'fixed' : 'hug';
  return { w, h, wMax: W['max-content'], wMin: W['min-content'] };
}
```
Pitfalls: use `offsetWidth/Height` when a transform is set; `!important` to beat stylesheets; flex-basis explicit reads as fixed (correct); stretch cross-axis needs the extra rule; wait for `document.fonts.ready`; disable animations/transitions; restore in `finally`; batch (read all, then write all) to avoid layout thrash.

### B3. Normalization (per frame N)

1. Prune inert wrappers: no fill/stroke/shadow/radius/opacity/clip, one in-flow child, same rect (0.5) -> promote child. Keep if padding or alignment is meaningful.
2. Layout kind: flex -> explicit `fd`; grid -> grid path; block/others -> rect inference (all y-disjoint -> V; x-disjoint with y-overlap -> H; rows of H items -> grid/wrap; else NONE).
3. Order: sort by rendered P position (RTL handled).
4. Spacing: gaps from rects; `itemSpacing` = mode if it covers >= 60%; residuals > 0.5 -> spacers. With space-between/around/evenly use the CSS gap.
5. Padding: CSS padding (+border if not strokesIncludedInLayout), cross-check against measured.
6. P align from geometry: `lead` and `trail` free space; equal and >1 -> CENTER; lead 0 -> MIN; trail 0 -> MAX. CSS only as tiebreak.
7. C align: majority geometry; outliers -> slot wrapper; BASELINE only if CSS says baseline.
8. Sizing legalisation: (a) a HUG container with a FILL child on that axis must become FIXED (or FILL) using the rect size; walk up to the first FIXED/FILL ancestor; (b) text with FILL needs `HEIGHT`; (c) absolute children never FILL; (d) root screen FIXED W and FIXED H.
9. Grid: `{kind:'GRID', cols, rows, cg, rg, cells}`.
10. Absolute children: `{abs:true,x,y,w,h,cons}`.
11. Structure signature (C3).
12. Emit `layoutSpec = {kind, order, gap, gap2, pad, pAlign, cAlign, sizeP, sizeC, min/max, spacers, strokeInLayout, expected:[{id,x,y,w,h}]}`.

### B4. Plugin order of operations (avoids the resize trap)

```
build(n, parent):
 1 create node
 2 static visuals: fills, strokes, strokeAlign, weights, radius, effects, clipsContent, opacity
 3 resize(n.w, n.h) once, while FIXED and layoutMode NONE
 4 parent.appendChild(node)                      // before any FILL/HUG
 5 if auto-layout: layoutMode, layoutWrap, itemSpacing, counterAxisSpacing, padding, primary/counter align,
   counterAxisAlignContent, strokesIncludedInLayout (GRID: counts, gaps, track types)
 6 build children in spec order (spacers inserted); absolute children: append, layoutPositioning='ABSOLUTE', x/y/resize, constraints
 7 after children exist: per child  textAutoResize -> resize -> layoutSizingHorizontal -> layoutSizingVertical; min/max
 8 then the node's own primary/counterAxisSizingMode (AUTO for hug, FIXED otherwise); for FIXED re-resize
 9 second pass top-down: re-assert FILL sizes; detect collapsed FILL text (width < 4) and downgrade to FIXED
```
Hard rules: `resize()` before `layoutSizing*`; `appendChild` before FILL/HUG; never FILL under a HUG chain; set `textAutoResize` before `characters`/sizing; HUG only on frames with auto-layout and on text; read x/width sparingly (each read can force relayout).

### B5. RTL verification

No API support, so correctness = (1) child order is visual left-to-right, (2) MIN/MAX are physical, (3) `textAlignHorizontal` is physical. The validator catches mistakes because a mirrored order yields a large |dx| for every child. Add an assert: in an RTL H container the first Figma child has the smallest expected x. Fixtures: Farsi header (title right, close left), 4-tab bar, 5-icon bottom nav, chevron-on-left list rows, `row-reverse` row, RTL wrap list, RTL grid.

## C. Validation

### C1. Round trip

After a subtree is built (post-order), for every child of an auto-layout/grid frame compare `node.x/y/width/height` against `expected` with tol 1.5px. Text gets looser tolerance (width +-3, height +-2) because Chrome and Figma shape Vazirmatn slightly differently. Report two tiers: structural (order/alignment/gap correct relative to siblings) and absolute (per-screen percent of nodes within 2/4/8px) instead of all-or-nothing. Flag a parent only if its total height drifts more than 8px from text effects.

```js
function validate(frame, spec, tol = 1.5) {
  const errs = [];
  for (const c of spec.expected) {
    const k = byId.get(c.id);
    const d = [k.x - c.x, k.y - c.y, k.width - c.w, k.height - c.h];
    if (d.some((v) => Math.abs(v) > tol)) errs.push({ id: c.id, d });
  }
  return { ok: !errs.length && Math.abs(frame.width - spec.selfW) <= tol && Math.abs(frame.height - spec.selfH) <= tol, errs };
}
```

### C2. Fallback ladder per node (first that validates wins)

- F0: auto-layout with HUG/FILL per intent.
- F1: same direction/gap/padding/alignment, every child FIXED at measured size.
- F2: F1 but offending children `layoutPositioning='ABSOLUTE'` at measured x/y.
- F3: `layoutMode='NONE'` with cached absolute positions (today's fallback; positions are lost on switch, d.ts:5212, so cache first).
Test bottom-up; a child's fallback does not force its parent's. Store `setPluginData('rung','F0'..)` and print a per-screen histogram.

### C3. Repeated structures

`sig(n) = hash(kind, dir, round(gap), round(pad), sizeP, sizeC, hasFill, hasStroke, radius, [sig(child)])`, excluding text and image content. Two levels: `shapeSig` (structure) and `styleSig` (+fills). Group nodes with equal `shapeSig`: >= 3 times within a screen, or in >= 2 screens (bottom nav, headers, buttons, cards, list rows). Report candidates ranked by occurrences x size. Later phase only, after layout validates: `createComponent` from the first, `createInstance()` for the rest with text/image overrides. Cheap first step: consistent naming and a candidate report.

## D. Implementation plan

### D1. Priorities

P0: (1) walker `css` facts, text `lines/lhPx/nowrap`, drop the flex-nowrap restriction, emit `cb` and ids; (2) normalize.mjs v1: direction by rects, visual sort (RTL), gap mode, padding, geometric P/C align, wrapper pruning, absolute detection; (3) plugin B4 order, F0 with simple hints (flex-grow, full-width block FILL, inline-flex/button HUG, text HUG/HEIGHT), validator, ladder F0->F1->F3; (4) test on login, dashboard, workout day, with RTL assertions.
P1: (5) sizing probes, min/max, aspect-ratio, stretch; (6) ABSOLUTE + constraints + fixed hoisting; (7) spacers and slot wrappers; (8) WRAP; (9) truncation and explicit line height.
P2: (10) GRID; (11) F2 rung and reports; (12) repeated-structure report then components; (13) pseudo-elements, inline rich text ranges.

### D2. Walker additions

```js
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const maybe = (v, none) => (v === none || v === 'auto' ? null : num(v));
function cssFacts(el, cs) {
  const ar = cs.aspectRatio, grid = cs.display.includes('grid');
  return {
    disp: cs.display, pos: cs.position, dirn: cs.direction, wm: cs.writingMode,
    z: cs.zIndex === 'auto' ? null : +cs.zIndex,
    fd: cs.flexDirection, fw: cs.flexWrap, jc: cs.justifyContent, ai: cs.alignItems, ac: cs.alignContent,
    rg: px(cs.rowGap), cg: px(cs.columnGap),
    gtc: grid ? cs.gridTemplateColumns : null, gtr: grid ? cs.gridTemplateRows : null,
    fg: num(cs.flexGrow), fs: num(cs.flexShrink), fb: cs.flexBasis, as: cs.alignSelf, ord: num(cs.order),
    m: [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)],
    minW: maybe(cs.minWidth, '0px') || null, maxW: maybe(cs.maxWidth, 'none'),
    minH: maybe(cs.minHeight, '0px') || null, maxH: maybe(cs.maxHeight, 'none'),
    box: cs.boxSizing, ar: ar === 'auto' ? null : ar.split('/').map(parseFloat),
    ovx: cs.overflowX, ovy: cs.overflowY, tr: cs.transform === 'none' ? null : cs.transform,
    inFlow: !(cs.position === 'absolute' || cs.position === 'fixed' || cs.float !== 'none'),
  };
}
function contentBox(cs, r) {
  const L = px(cs.borderLeftWidth) + px(cs.paddingLeft), T = px(cs.borderTopWidth) + px(cs.paddingTop);
  return { x: L, y: T, w: r.width - L - px(cs.borderRightWidth) - px(cs.paddingRight),
           h: r.height - T - px(cs.borderBottomWidth) - px(cs.paddingBottom) };
}
function insetSet(el) {                       // which sides are authored (computed values are used px)
  const st = el.style, base = el.getBoundingClientRect(), out = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const sv = st.getPropertyValue(side), sp = st.getPropertyPriority(side);
    st.setProperty(side, 'auto', 'important');
    const r = el.getBoundingClientRect();
    out[side] = ['left', 'top', 'width', 'height'].some((k) => Math.abs(r[k] - base[k]) > 0.5);
    sv ? st.setProperty(side, sv, sp) : st.removeProperty(side);
  }
  return out;
}
```
Fix existing walker issues: layout hint only for flex-nowrap (drop); `lh=null` for `normal`; no stable ids; rect under transform (use offsetWidth/Height); `display:contents` not flattened; `opacity:0` nodes dropped though they occupy space.

### D3. Plugin functions

```js
async function buildNode(n, parent, ctx) {
  if (n.t === 'text') return buildText(n, parent, ctx);
  if (n.t === 'svg' || n.t === 'img') return buildLeaf(n, parent, ctx);
  const f = figma.createFrame(); f.name = n.name || 'frame';
  styleFrame(f, n);                                   // existing visuals
  f.resize(Math.max(n.w, 1), Math.max(n.h, 1));       // 1 resize first
  parent.appendChild(f);                              // 2 parent before FILL/HUG
  const L = n.layoutSpec, auto = L && L.kind !== 'NONE';
  if (auto) applyContainer(f, L, n);                  // 3 layoutMode, gaps, padding, aligns
  const kids = new Map();
  for (const id of (auto ? L.order : n.children.map((c) => c.id))) {
    const c = n.byId[id];
    if (c.spacerBefore) f.appendChild(makeSpacer(L.kind, c.spacerBefore));
    kids.set(id, await buildNode(c, f, ctx));
  }
  for (const c of n.absChildren || []) makeAbsolute(await buildNode(c, f, ctx), c);
  if (auto) applyChildSizing(f, L, n, kids);          // 4 sizing after children exist
  return f;
}
function applyContainer(f, L, n) {
  if (L.kind === 'GRID') return applyGrid(f, L);
  f.layoutMode = L.kind === 'V' ? 'VERTICAL' : 'HORIZONTAL';
  if (L.kind === 'WRAP') { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = L.gap2; if (L.alignContent) f.counterAxisAlignContent = L.alignContent; }
  f.itemSpacing = L.gap;
  [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft] = L.pad;
  f.primaryAxisAlignItems = L.pAlign; f.counterAxisAlignItems = L.cAlign;
  f.strokesIncludedInLayout = !!n.stroke;             // VERIFY (A4)
  f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
}
function applyChildSizing(f, L, n, kids) {
  for (const [id, k] of kids) {
    const c = n.byId[id], s = c.sz;
    if (k.type === 'TEXT') { setTextSizing(k, c, s); continue; }
    const isAuto = 'layoutMode' in k && k.layoutMode !== 'NONE';
    if (s.w === 'fill') k.layoutSizingHorizontal = 'FILL'; else if (s.w === 'hug' && isAuto) k.layoutSizingHorizontal = 'HUG';
    if (s.h === 'fill') k.layoutSizingVertical = 'FILL'; else if (s.h === 'hug' && isAuto) k.layoutSizingVertical = 'HUG';
    for (const p of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) if (c[p] != null) k[p] = c[p];
  }
  const m = (s) => (s === 'hug' ? 'AUTO' : 'FIXED'), horiz = L.kind !== 'V';
  f.primaryAxisSizingMode = m(horiz ? n.sz.w : n.sz.h);
  f.counterAxisSizingMode = m(horiz ? n.sz.h : n.sz.w);
}
function setTextSizing(t, c, s) {
  if (c.nowrap || (c.lines <= 1 && s.w !== 'fill')) t.textAutoResize = 'WIDTH_AND_HEIGHT';
  else {
    t.textAutoResize = 'HEIGHT'; t.resize(Math.max(c.w, 1), t.height);
    if (s.w === 'fill') t.layoutSizingHorizontal = 'FILL';
    if (t.width < 4) { t.layoutSizingHorizontal = 'FIXED'; t.resize(Math.max(c.w, 1), t.height); }  // thread guard
  }
  if (c.truncate) { t.textTruncation = 'ENDING'; t.maxLines = c.truncate.lines; }
}
function makeAbsolute(k, c) {
  k.layoutPositioning = 'ABSOLUTE';
  k.resize(Math.max(c.w, 1), Math.max(c.h, 1)); k.x = c.x; k.y = c.y;
  k.constraints = { horizontal: c.cons.h, vertical: c.cons.v };
}
function applyGrid(f, L) {
  f.layoutMode = 'GRID';
  f.gridColumnCount = L.cols.length; f.gridRowCount = L.rows.length;
  f.gridColumnGap = L.cg; f.gridRowGap = L.rg;
  L.cols.forEach((c, i) => { const t = f.gridColumnSizes[i]; t.type = c.t; if (c.t !== 'HUG') t.value = c.v; });
  L.rows.forEach((r, i) => { const t = f.gridRowSizes[i]; t.type = r.t; if (r.t !== 'HUG') t.value = r.v; });
  [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft] = L.pad;
  // children: child.setGridChildPosition(r, c); gridRowSpan/gridColumnSpan  (VERIFY ordering with gridItemsPositioning)
}
async function buildWithLadder(n, parent, ctx) {     // call in post-order for nested nodes
  const f = await buildNode(n, parent, ctx);
  let r = validate(f, n.layoutSpec);
  if (r.ok) { f.setPluginData('rung', 'F0'); return f; }
  downgradeToFixed(f, n);                              // F1
  if (validate(f, n.layoutSpec).ok) { f.setPluginData('rung', 'F1'); return f; }
  absoluteOffenders(f, n, r.errs);                     // F2
  if (validate(f, n.layoutSpec).ok) { f.setPluginData('rung', 'F2'); return f; }
  freezeToNone(f, n);                                  // F3, positions cached before switching
  f.setPluginData('rung', 'F3'); return f;
}
```

### D4. CSS that cannot map well

| CSS | Problem | What to do |
|---|---|---|
| margin collapse, negative margins | no margins in Figma | measured gaps; overlap -> ABSOLUTE |
| unequal per-child gaps | no per-child spacing | spacer or padding wrapper |
| unequal `flex-grow`, `flex-basis`, `flex-shrink` | FILL is equal-split only | FIXED, flag |
| per-child `align-self` | container-wide counter align | slot wrapper, else ABSOLUTE |
| `order` | none | sort by rect |
| RTL in general | no direction in API | order + physical aligns; RTL wrap/grid via rect-derived indexes |
| `column`+wrap, `wrap-reverse`, exotic `align-content` | wrap only on HORIZONTAL; limited enum | F1/F3 or row frames |
| percent widths other than 100%, `calc`, `vw/vh/dvh`, `clamp` | no expressions | FIXED measured; FILL if equal to container less padding |
| sticky, scroll containers | no scroll/sticky | static, annotate |
| transforms in flow | not in auto-layout | wrapper or ABSOLUTE |
| `position:fixed` | viewport-relative | hoist ABSOLUTE to screen root with constraints |
| z-index among flow siblings | order = layout order | overlapping ones ABSOLUTE |
| mixed-style inline text with inline icons | text cannot contain frames | single text with ranges; icons as siblings/ABSOLUTE |
| Chrome vs Figma text metrics | wrapping/width drift | HUG/HEIGHT sizing, tolerance tiers, make sure Vazirmatn is installed |
| `line-height:normal` | different ascent/descent | explicit px line-height |
| pseudo-elements, list markers | not DOM | synthesize (P2) or accept downgrade |
| `display:contents` | no box | flatten in walker |
| table, subgrid, overlapping areas, `auto-fill/fit` | no semantic equivalent | fixed-track GRID from computed px, or row frames |
| backdrop-filter, blend, mask, clip-path, text gradient | visual only | approximate/ignore |
| media/container queries | one breakpoint per capture | capture each width as its own frame (responsive variants are not inferred) |
| HUG on rect/svg/img | HUG only for frames and text | FIXED, or wrap in HUG frame |
| animations mid-state | unstable measurement | disable before probing |

### D5. Experiments to run first (30 min, scratch Figma file)

1. `strokesIncludedInLayout` vs CSS box model with a 4px border.
2. Negative `itemSpacing` accepted?
3. SPACE_AROUND / SPACE_EVENLY accepted by `primaryAxisAlignItems`?
4. Default sizing modes after setting `layoutMode` on a resized frame.
5. HORIZONTAL+WRAP with `counterAxisSpacing`, RTL-ordered rows.
6. GRID: track types FLEX/FIXED/HUG, `setGridChildPosition` under both `gridItemsPositioning` values, persistence of `gridColumnSizes[i].type = ...`.
7. FILL text path and the thread-collapse guard.
8. Absolute child with STRETCH constraints follows a parent resize.
9. Vazirmatn text width Chrome vs Figma for 10 Farsi strings (sets text tolerance).
