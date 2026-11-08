# Backflow logo: gpt-image prompts and palette

The vector logo already exists (`backflow-wordmark.svg`, `backflow-mark.svg`, `backflow-icon.svg`, built by `scripts/build-brand.mjs`). Use these prompts to explore alternatives, make marketing renders, or produce a hand-drawn variant. Whatever image the model returns, the shipped logo stays vector: trace a chosen direction back into `scripts/build-brand.mjs` rather than shipping a raster.

## Palette (exact)

| Role | Name | Hex | Use in prompts as |
|---|---|---|---|
| Ink | Blueline | `#1F4FA8` | "diazo blueline blue, hex #1F4FA8" |
| Ground | Sheet | `#EEF2F5` | "cool pale blue-grey drawing paper, hex #EEF2F5" |
| Dark ground | Prussian | `#0F2A55` | "Prussian cyanotype blue, hex #0F2A55" |
| Accent | Red pen | `#B5261A` | "red drafting pencil, hex #B5261A" (only for revision marks) |
| Text | Graphite | `#1B1F24` | "graphite, hex #1B1F24" |
| Line | Hairline | `#C5D1E0` | "faint blueline grid, hex #C5D1E0" |

## The idea to hold on to

**Backflow** turns a running web app back into a design file. The mark is a lowercase **b** drawn as **one continuous line**: the stem comes down, the bowl goes around, and instead of closing, the stroke **flows back into its own stem** and ends in a small **drafting harpoon** (a one-sided arrowhead, like a leader line on an architectural drawing). Monoline, round caps, heavy stroke. It is the first letter of the wordmark "backflow".

## Prompt 1: the mark (gpt-image-1, 1024×1024, background transparent)

```
A minimal vector logo mark on a transparent background. A lowercase letter "b" drawn as a single continuous monoline stroke with round caps and round joins, stroke colour diazo blueline blue #1F4FA8. The stroke starts at the top of the tall vertical stem, runs straight down, sweeps around a circular bowl counter-clockwise, and instead of closing the bowl it turns back left at the top of the bowl and flows back into its own stem, ending in a small one-sided harpoon arrowhead pointing up and to the right, like a leader arrow on an architectural drawing. Heavy uniform stroke weight, about one fifth of the letter height. Perfectly geometric, centred, generous empty space around it. Flat colour only: no gradient, no shadow, no 3D, no texture, no outline, no other shapes, no text.
```

## Prompt 2: wordmark lockup (1536×1024, background #EEF2F5)

```
A flat vector wordmark "backflow" in lowercase, set in a wide grotesque sans-serif similar to Archivo SemiExpanded at semibold weight, tight letter spacing, colour blueline blue #1F4FA8, centred on a flat cool pale blue-grey ground #EEF2F5. The first letter "b" is replaced by a custom monoline glyph of the same height and weight: a "b" drawn as one continuous stroke with round caps whose bowl flows back into its own stem and ends in a small one-sided drafting harpoon arrow. The rest of the word is ordinary type. No tagline, no icon box, no gradient, no shadow, no texture. Crisp, minimal, print-ready.
```

## Prompt 3: app icon (1024×1024)

```
A square app icon with rounded corners (corner radius about 22% of the width), flat fill Prussian cyanotype blue #0F2A55. Centred on it, a white monoline lowercase "b" drawn as one continuous stroke with round caps whose bowl flows back into its own stem and ends in a small one-sided harpoon arrow. In each corner of the tile, a thin L-shaped crop mark in light blue #9CC2FF at 60% opacity, like the corner ticks on a drawing sheet. Flat colours only: no gradient, no gloss, no shadow, no texture, no text.
```

## Prompt 4: hero render for social posts (1536×1024, background #EEF2F5)

```
A technical architectural drawing on cool pale blue-grey drafting paper #EEF2F5, drawn in fine blueline ink #1F4FA8. Centre: an elevation of a smartphone app screen drawn as clean linework: a title "Today", a card with diagonal hatching, three list rows with checkboxes, and a wide rounded button. Thin grey-blue dimension lines with 45-degree ticks measure it: "390" across the top, "844" down the left side, "12" for a gap. A red drafting-pencil revision cloud (#B5261A, a scalloped outline) surrounds the button, with a small red triangle containing the number 1, and a red rubber stamp reading "REVISE" placed at a slight angle beside it. Along the top edge, a row of small grid bubbles lettered A, B, C, D. A title block strip along the bottom edge with the labels PROJECT, DRAWN FROM, REV. Flat, precise, no perspective, no shadows, no people, no photographs.
```

Tips: keep the hex codes in the prompt; ask for "flat vector" and "no gradient" every time; generate 4 to 8 variations of Prompt 1 and pick the one where the harpoon reads clearly at 32px; reject any result where the bowl closes into an ordinary "b" or where the arrow points away from the stem.

## Don'ts

- Don't use Figma's colours, shapes or the Figma logo in any Backflow mark.
- Don't add gradients, glows, neon, or 3D. Backflow is printed in four inks.
- Don't put the mark in a circle or a speech bubble.
