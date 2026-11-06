# Verify the unverified Figma behaviours (run once)

The auto-layout import relies on nine Figma runtime behaviours that the typings do not settle (see `AUTO-LAYOUT-SPEC.md`, section D5). `plugin/verify/` is a small plugin that runs all nine in throwaway nodes on the current page, deletes them again, and prints the answers plus a ready-to-paste `CFG` block.

## Run it

1. Open a scratch Figma file (desktop app). Install Vazirmatn Regular from Google Fonts if V9 should run.
2. Plugins, Development, Import plugin from manifest, choose `plugin/verify/manifest.json`.
3. Run Plugins, Development, Kheez Auto-layout Verify. Wait a few seconds, press Copy all, and send the text back.
4. Optional, for V9: `node plugin/verify/chrome-ref.mjs` prints Chrome's widths for the same ten strings (needs the local app on :3000). Compare the two lists; a consistent ratio tells us the text tolerance.

## What each experiment answers

| # | Question | Config constant in `plugin/code.js` (`CFG`) |
|---|---|---|
| V1 | With a 4 px border and `strokesIncludedInLayout = true`, do children sit at padding + stroke (14) or at padding (10)? | `strokeInLayout` |
| V2 | Is a negative `itemSpacing` accepted and does it overlap children? | `allowNegativeSpacing` |
| V3 | Does `primaryAxisAlignItems` accept `SPACE_AROUND` and `SPACE_EVENLY`, and where do two 20 px children land in 200 px? | `spaceAround` |
| V4 | Which sizing modes does a resized frame have right after `layoutMode` is set, and after `resize()`? | informational (the plugin always sets both modes explicitly) |
| V5 | Does `layoutWrap = 'WRAP'` with `counterAxisSpacing` give the expected rows? | `wrap` |
| V6 | Do `gridColumnSizes[i].type = ...` changes persist, is `HUG` accepted, what does auto placement do, do `setGridChildPosition`, `appendChildAt`, `gridColumnSpan` work? | `grid`, `gridAppendChildAt` |
| V7 | Does a text node with `textAutoResize = 'HEIGHT'` then `layoutSizingHorizontal = 'FILL'` get a real width (and what does the default mode do)? | `fillTextWorks` |
| V8 | Does an ABSOLUTE child with a STRETCH constraint follow a parent resize? | `absoluteConstraints` |
| V9 | How wide is Vazirmatn text in Figma compared with Chrome? | informational (sets the text tolerance) |

## Applying the answers

The printed block at the end looks like

```json
{ "strokeInLayout": true, "allowNegativeSpacing": false, "spaceAround": true, "wrap": true, "grid": true, "gridAppendChildAt": true, "fillTextWorks": true, "absoluteConstraints": true }
```

Copy the values into the `CFG` object at the top of `plugin/code.js`. Nothing else needs to change: the plugin reads those constants when it configures frames (padding minus stroke width, wrap, grid, text FILL, ...), and `normalize.mjs` never emits features the constants disable (for example a `GRID` container becomes a plain frame at fallback level F3 when `grid` is false).

## What to look for in a real import

After importing a screen the log shows `auto-layout containers N: F0 a, F1 b, F2 c, F3 d (degraded in Figma: m)`. `degraded` counts containers where the real Figma result deviated from Chrome's rectangles and the plugin stepped down the ladder on the spot. A few degraded containers are normal while the text metrics are unknown. If many are, send the "Degraded containers" lines of the log; they show which child deviated and by how much.
