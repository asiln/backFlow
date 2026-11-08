<p><img alt="Backflow" src="backflow-wordmark.svg" height="48"></p>

# Backflow brand guide

Assets in this folder: `backflow-wordmark*.svg`, `backflow-mark*.svg`, `backflow-icon*.svg` (built by `npm run build:brand`), `tokens.css` and `tokens.json` (DTCG), `fonts/` (Archivo and JetBrains Mono, SIL OFL). Logo exploration prompts: [LOGO-PROMPT.md](LOGO-PROMPT.md). Design prompt for Claude desktop: [CLAUDE-DESIGN-PROMPT.md](CLAUDE-DESIGN-PROMPT.md).

Backflow makes as-built drawings of web apps: drawn after construction, from what actually shipped, so design can review it. Every surface (the site, the README art, the Figma plugin) is a sheet from one drawing set: blueline ink on a cool sheet, red pen for what changed, numbers that were measured.

## Content fundamentals

- Write plainly and precisely. Short declarative sentences. State limits openly; report numbers and failure reasons instead of smoothing them over.
- Address the reader as "you". The project speaks as "Backflow", never "we" in product copy.
- Sentence case everywhere. Uppercase only in `label` type (title-block labels, table heads, stamps).
- Name things by what people recognise: "screens", "tokens", "components", "Preview", "Apply". Controls name their action; the result states what happened ("3 of 3 screens in 4.8 s").
- Numbers carry the copy: "58 variables · 17 styles from Backflow", "F0 · 83%". Separate facts with interpuncts. Use tabular figures wherever numbers compare.
- Never invent proof: no testimonials, user counts, benchmarks or press. Sample drawings are labelled "Sample screen".
- No emoji. No hype words ("magic", "revolutionary", "seamless").
- Real examples: "Your app, drawn as built." · "Preview changes nothing. Apply creates only what's missing." · "F3 is a floor, not a failure."

## Visual foundations

**Two themes, one drawing set.** `blueline` (light): a diazo print, `blue` linework on `sheet`. `blueprint` (dark): a cyanotype, white linework on Prussian blue. In Blueprint, `blue` becomes white and primary fills invert (white fill, `on-blue` Prussian text). The plugin follows Figma's theme; the site follows the system with a Blueline/Blueprint toggle.

**Colour carries meaning.**
- `blue` is the drawing itself: headings, linework, links, the primary action, the sheet border.
- `red` is the red pen: redlines, revision clouds, the REVISE stamp, failures, the armed confirm. Never decoration, never a section colour.
- `green` and `amber` appear only when they report a state (done/approved, needs attention).
- Body copy is `ink`; secondary copy `ink-2`; hints `ink-3`. All pass 4.5:1 on `sheet` and `paper` in both themes.
- Four printed inks only: no gradients, no glows, no midtone fills a printer couldn't print.

**Type.** Archivo for everything you read, using its width axis as the drawing's lettering: `display`/`h1` at width 118% for headings, 100% for body, 78% uppercase with +0.08em tracking for `label`. JetBrains Mono only for code, commands, dimensions and numerals in data. Site body is `body` (17/27); the plugin runs at `plugin-body` (12/17) with `plugin-title` (13/18, 640, `blue`).

**Drawing grammar** (use it as content, never as ornament):
- The sheet: a 1.5px `blue` border (`stroke-rule`) with grid bubbles (A, B, C…) on its top edge.
- Title block: cells of real facts under a 1.5px rule (Project, Drawn from, Rev, License).
- Dimension lines show values Backflow measures: widths, gaps, padding, Hug/Fill/Fixed.
- Revision clouds and deltas mark what changed; the previous value stays as a dashed ghost.
- Review stamps (Approved, Revise, Rejected) show the team's decision in Figma.
- Schedules (tables) instead of feature cards; General Notes (numbered) instead of icon grids.

**Space and shape.** A 4px rhythm: `space-4` inside chips, `space-8` between controls, `space-12` between blocks in a plugin row, `space-16` row padding and phone gutter, `space-96` between site sections. Corners are small: `radius-2` for controls, `radius-3` for panels. Structure is drawn with hairlines (`stroke-hair` in `line`); no cards inside cards, no coloured side borders.

**Depth.** Flat. Tone and hairlines separate things; `shadow-toast` is the only shadow.

**Motion.** One authored moment per surface: on the site the revision cloud draws itself (900 ms) and the stamp lands once; in the plugin, rows disclose (200 ms) and status glyphs pop (220 ms) on `cubic-bezier(.16, 1, .3, 1)`. Progress is `transform: scaleX`, never width. Under reduced motion everything is drawn at rest.

**States.** Hover: `sheet-2` (rows, secondary buttons) or `blue-hover` (primary). Pressed/selected: `blue-soft`. Focus: a 2px solid `blue` ring (white in Blueprint), 3:1 on every surface. Disabled: `sheet-2` with `ink-3` and a tooltip saying why.

## Iconography

Authored 16×16 stroke icons: no fill, `currentColor`, 1.25 stroke, round caps and joins, coloured by state. Status glyphs are built on a 6.25-radius circle (check, dashed ring, ring with dot, X, 3/4 arc) plus a triangle for warnings. No icon font, no emoji, no Unicode glyphs as icons.

## Logo

The mark is a "b" drawn as one continuous line whose bowl flows back into its own stem and ends in a drafting harpoon: the product's direction, from code back to design. It is the first letter of the wordmark (Archivo, width 112, weight 620). Use the files in Logos; never redraw it. Minimum size 16px for the mark, 80px wide for the wordmark.

## Using this system

- Load `tokens.css` and `components/bundle.css`; set `class="bf"` on the root.
- Theme by the `data-theme` attribute: `blueline` or `blueprint`.
- Fonts ship as files in `fonts/` (both SIL OFL). The plugin embeds them as data URIs because it has no network access.
